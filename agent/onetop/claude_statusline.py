"""Capture Claude Code's non-secret statusline limits without reading credentials.

The official callback supplies rate limits and current model/effort on stdin.
Only these allowlisted fields and local associations are persisted; stdin is
forwarded unchanged to the user's existing renderer.
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from .platform_support import data_directory

MAX_INPUT = 1024 * 1024
MAX_CONFIG = 64 * 1024


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _read_object(path, limit=MAX_CONFIG):
    try:
        with Path(path).open('rb') as stream:
            raw = stream.read(limit + 1)
        value = json.loads(raw) if len(raw) <= limit else None
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def profile_root(profile=None):
    """A CLI's explicit profile environment wins over an inherited wrapper."""
    return Path(os.environ.get('CLAUDE_CONFIG_DIR') or profile or Path.home()/'.claude').expanduser().resolve()


def _account(root):
    path = Path.home()/'.claude.json' if root == (Path.home()/'.claude').resolve() else root/'.claude.json'
    account = _read_object(path, 8 * 1024 * 1024).get('oauthAccount')
    if not isinstance(account, dict):
        return None
    uuid = account.get('accountUuid')
    org = account.get('organizationUuid') or ''
    if not isinstance(uuid, str) or not uuid or len(uuid) > 256 or not isinstance(org, str) or len(org) > 256:
        return None
    identity = 'claude:' + hashlib.sha256((uuid + '|' + org).encode()).hexdigest()[:20]
    plan = account.get('seatTier')
    return identity, plan[:80] if isinstance(plan, str) else ''


def sanitize_limits(payload):
    value = payload.get('rate_limits')
    if not isinstance(value, dict):
        return {}
    windows = {}
    for name in ('five_hour', 'seven_day'):
        window = value.get(name)
        if not isinstance(window, dict):
            continue
        used = window.get('used_percentage')
        if not _number(used) or not 0 <= used <= 100:
            continue
        result = {'used_percentage': used}
        if 'resets_at' in window:
            reset = window['resets_at']
            if not _number(reset) or not 0 <= reset < 1e12:
                continue
            result['resets_at'] = reset
        windows[name] = result
    return windows


def _literal(value, limit):
    return value if (isinstance(value, str) and 0 < len(value) <= limit
                     and value.strip() == value and not any(ord(c) < 32 for c in value)) else None


def _write_report(path, report):
    fd, temporary = tempfile.mkstemp(prefix='.report-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(report, stream, separators=(',', ':'), allow_nan=False)
            stream.flush()
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def _capture_session(payload, root, session, directory, now):
    # API-backed tools can report effort without subscription limits or OAuth.
    # Every callback explicitly clears an absent effort/model instead of keeping
    # a previous model's setting. This file contains no account credentials.
    target = directory.parent/'claude-statusline-sessions'
    if target.is_symlink():
        return None
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    effort = payload.get('effort')
    model = payload.get('model')
    report = {'schema': 1, 'profile': str(root), 'session_id': session, 'updated': now,
              'effort': _literal(effort.get('level'), 64) if isinstance(effort, dict) else None,
              'model': _literal(model.get('id'), 256) if isinstance(model, dict) else None}
    key = hashlib.sha256((str(root) + '|' + session).encode()).hexdigest()
    return _write_report(target/(key + '.json'), report)


def session_binding(spec, directory=None, now=None):
    """A session's last verified identity survives unrelated profile logins.

    The callback's identity is session-scoped. A profile file describes the next
    login and must not retroactively move idle or running sessions to it.
    OTel's explicit session identity, when available, takes precedence later.
    """
    if spec.get('kind') != 'Claude' or not spec.get('config_dir'):
        return None
    root = Path(spec['config_dir']).expanduser().resolve()
    sid = spec['id']
    key = hashlib.sha256((str(root) + '|' + sid).encode()).hexdigest()
    directory = Path(directory) if directory is not None else data_directory()/'claude-statusline'
    report = _read_object(directory/(key+'.json'))
    now = time.time() if now is None else now
    if (report.get('schema') != 1 or report.get('session_id') != sid or
            report.get('profile') != str(root) or report.get('verified_activity') is not True or
            not _number(report.get('t')) or not 0 < report['t'] <= now or
            not _literal(report.get('account_id'), 128)):
        return None
    since = report.get('account_since', report['t'])
    return (report['account_id'], since if _number(since) and 0 < since <= now else report['t'])


def _verified_switch(previous, payload, limits, account_id, directory, now):
    """Accept a real in-session login only with new API work and a known reset.

    A changed profile alone is insufficient. Match the newly reported weekly
    cycle to a previously verified callback from the new account. An unmatched
    switch remains unknown until explicit OTel identity or a new session.
    """
    work = (payload.get('cost') or {}).get('total_api_duration_ms')
    old = previous.get('api_work_ms')
    reset = (limits.get('seven_day') or {}).get('resets_at')
    if not (_number(work) and _number(old) and work > old and _number(reset) and reset > now):
        return False
    prior_reset = (previous.get('rl', {}).get('seven_day') or {}).get('resets_at')
    if _number(prior_reset) and abs(prior_reset-reset) <= 60:
        return False
    for path in directory.glob('*.json'):
        known = _read_object(path)
        known_reset = (known.get('rl', {}).get('seven_day') or {}).get('resets_at')
        if (known.get('account_id') == account_id and known.get('verified_activity') is True and
                _number(known_reset) and abs(known_reset-reset) <= 60):
            return True
    return False


def capture(payload, profile=None, directory=None, now=None):
    """Write a bounded, allowlisted report, returning its path or None.

    t is when this CLI report first arrived or its limits/API-work counter
    changed. observed_at is the callback receipt time. Identical callbacks do
    not refresh t, so an idle cached statusline cannot pretend to be a fresh
    provider observation. No credential or conversation field is persisted.
    """
    if not isinstance(payload, dict):
        return None
    session = payload.get('session_id')
    if not isinstance(session, str) or not 1 <= len(session) <= 160 or any(ord(c) < 32 for c in session):
        return None
    root = profile_root(profile)
    now = time.time() if now is None else now
    if not _number(now) or now <= 0:
        return None
    directory = Path(directory) if directory is not None else data_directory()/'claude-statusline'
    try:
        _capture_session(payload, root, session, directory, now)
    except OSError:
        pass  # Session metadata failure must not prevent independent quota capture.
    limits = sanitize_limits(payload)
    if not limits:
        return None
    account = _account(root)
    if account is None:
        return None
    account_id, plan = account
    if directory.is_symlink():
        return None
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = hashlib.sha256((str(root) + '|' + session).encode()).hexdigest()
    path = directory/(key + '.json')
    previous = _read_object(path)
    if (previous.get('schema') == 1 and previous.get('profile') == str(root)
            and previous.get('session_id') == session
            and previous.get('account_id') != account_id):
        work = (payload.get('cost') or {}).get('total_api_duration_ms')
        prior_work = previous.get('api_work_ms')
        reset = (limits.get('seven_day') or {}).get('resets_at')
        prior_reset = (previous.get('rl', {}).get('seven_day') or {}).get('resets_at')
        continuing = (previous.get('verified_activity') is True and _number(work) and
                      _number(prior_work) and work > prior_work and _number(reset) and
                      reset > now and _number(prior_reset) and abs(reset-prior_reset) <= 60)
        if continuing:
            # Another terminal's login changes the shared profile on disk, but
            # this process can keep its prior login. New work in its verified
            # quota cycle remains attributed to that session's existing account.
            account_id = previous['account_id']; plan = previous.get('plan', '')
        elif _verified_switch(previous, payload, limits, account_id, directory, now):
            previous = {}  # A real switch starts a new observation interval.
        else:
            return None
    # Only local observations generated for this exact account/session apply.
    same = (previous.get('schema') == 1 and previous.get('profile') == str(root)
            and previous.get('account_id') == account_id and previous.get('session_id') == session)
    cost = payload.get('cost') or {}
    work = cost.get('total_api_duration_ms') if isinstance(cost, dict) else None
    work = work if _number(work) and work >= 0 else None
    prior_work = previous.get('api_work_ms') if same else None
    prior_work = prior_work if _number(prior_work) and prior_work >= 0 else None
    prior_t = previous.get('t') if same else None
    valid_previous = _number(prior_t) and 0 < prior_t <= now
    activity = (same and valid_previous and (previous.get('rl') != limits
                or (work is not None and prior_work is not None and work > prior_work)))
    changed = not valid_previous or activity
    # The first callback can contain a cached CLI value from an earlier turn.
    # Display it as a last report until this session shows new provider activity.
    verified = bool(activity or (same and valid_previous and previous.get('verified_activity') is True))
    report = {'schema': 1, 'source': 'claude_statusline', 'verified_activity': verified,
              't': now if changed else prior_t, 'observed_at': now,
              'profile': str(root), 'account_id': account_id,
              'session_id': session, 'plan': plan, 'rl': limits}
    report['account_since'] = previous.get('account_since', prior_t) if same and valid_previous else now
    if work is not None or prior_work is not None:
        report['api_work_ms'] = max(v for v in (work, prior_work) if v is not None)
    # A concurrent account switch must not bind an old callback to a new account.
    if _account(root) != account:
        return None
    return _write_report(path, report)


def run(config_path, stream=None):
    """Run the capture plus the original renderer; never print capture errors."""
    config = _read_object(config_path)
    command = config.get('original_command')
    if not isinstance(command, str) or len(command) > 48 * 1024:
        command = ''
    stream = stream if stream is not None else sys.stdin.buffer
    raw = stream.read(MAX_INPUT + 1)
    if len(raw) <= MAX_INPUT:
        try:
            directory = config.get('report_directory')
            if directory is not None and (not isinstance(directory, str) or not Path(directory).is_absolute()):
                raise ValueError('Report directory must be absolute')
            capture(json.loads(raw), profile=config.get('profile'), directory=directory)
        except (OSError, ValueError, TypeError, OverflowError):
            pass
    if not command:
        return 0
    try:
        depth = int(os.environ.get('ONETOP_STATUSLINE_DEPTH', '0'))
    except ValueError:
        depth = 0
    if depth >= 4:
        return 0
    env = {**os.environ, 'ONETOP_STATUSLINE_DEPTH': str(depth + 1)}
    shell = ['cmd.exe', '/d', '/s', '/c'] if os.name == 'nt' else ['/bin/sh', '-c']
    try:
        process = subprocess.Popen([*shell, command], stdin=subprocess.PIPE, env=env)
        # Oversize callbacks are not parsed or stored, but the original renderer
        # still receives every byte. Streaming avoids unbounded in-memory input.
        def feed():
            try:
                process.stdin.write(raw)
                if len(raw) > MAX_INPUT:
                    while chunk := stream.read(65536):
                        process.stdin.write(chunk)
            except (OSError, ValueError):
                pass
            finally:
                try: process.stdin.close()
                except (OSError, ValueError): pass
        threading.Thread(target=feed, daemon=True).start()
        try:
            return process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
            return 0
    except OSError:
        return 0
