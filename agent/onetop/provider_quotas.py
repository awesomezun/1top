"""Read-only Antigravity and Z.ai allowance adapters.

Provider credentials stay in the local process. Each provider's independent
quota pool/window is retained; a five-hour allowance is never called weekly.
"""
import copy
import hashlib
import json
import math
import os
import re
import secrets
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit

import certifi
import psutil

from .account_login import executable, managed_profiles_dir
from .discovery import cli_kind
from .platform_support import cli_command, data_directory

HOSTS = ('api.z.ai', 'open.bigmodel.cn')
MAX_BYTES = 1024 * 1024
PERIODS = {'5h': ('5H', 18000), 'weekly': ('주간', 604800),
           'daily': ('24H', 86400), 'monthly': ('월간', None)}


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def epoch(value):
    if number(value) is not None:
        return value / 1000 if value > 1e12 else value
    if not isinstance(value, str):
        return 0
    try:
        return max(0, datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())
    except (ValueError, OverflowError):
        return 0


def text(value, limit=80):
    return ''.join(c for c in value if c.isprintable())[:limit] if isinstance(value, str) else ''


def account_id(provider, value):
    return provider.lower() + ':' + hashlib.sha256(value.encode()).hexdigest()[:20]


def read_json(path):
    try:
        with Path(path).open('rb') as f:
            raw = f.read(MAX_BYTES + 1)
        data = json.loads(raw) if len(raw) <= MAX_BYTES else None
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def installation_scope(home):
    """Non-secret local UUID: identical home paths on two Macs are not accounts."""
    root = data_directory(home)
    path = root / 'provider-profile-v1.json'
    scope = read_json(path).get('id')
    if isinstance(scope, str) and re.fullmatch(r'[0-9a-f]{32}', scope):
        return scope
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    scope = secrets.token_hex(16)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        value = read_json(path).get('id')
        if isinstance(value, str) and re.fullmatch(r'[0-9a-f]{32}', value):
            return value
        raise ProviderError('invalid_profile') from None
    with os.fdopen(fd, 'w') as stream:
        json.dump({'id': scope}, stream)
    return scope


def quota_window(key, period, percentage, reset, now, **extra):
    label, seconds = PERIODS.get(period, (text(period) or '플랜 한도', None))
    reset = epoch(reset)
    value = number(percentage)
    return {'key': text(key), 'period': period, 'label': label,
            'pct': min(100, value) if value is not None and (not reset or reset > now) else None,
            'reset': reset, 'seconds': seconds, **extra}


def glm_windows(payload, now):
    if not isinstance(payload, dict) or payload.get('success') is not True or number(payload.get('code', 0)) not in (0, 200):
        raise ProviderError('provider_unavailable')
    data = payload.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('limits'), list):
        raise ProviderError('invalid_response')
    windows = []
    for i, item in enumerate(data['limits'][:32]):
        if not isinstance(item, dict) or item.get('type') not in ('TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'):
            continue
        meter = item['type']
        cap, used, remaining = (number(item.get(k)) for k in ('usage', 'currentValue', 'remaining'))
        pct = number(item.get('percentage'))
        if cap is not None and cap > 0:
            if used is None and remaining is not None and remaining <= cap:
                used = cap - remaining
            if used is not None:
                pct = used / cap * 100
        unit, count = item.get('unit'), number(item.get('number'))
        # The legacy MCP TIME_LIMIT uses unit=5 for a calendar month; it is
        # not a five-minute token limit. Do not infer periods from array order.
        if meter == 'TIME_LIMIT' and unit == 5:
            period = 'monthly'
        else:
            seconds = {1: 86400, 3: 3600, 6: 604800}.get(unit, 0) * (count or 0)
            period = {18000: '5h', 604800: 'weekly', 86400: 'daily'}.get(seconds, 'unknown')
        key = f'{meter.lower()}:{unit}:{count}:{i}'
        window = quota_window(key, period, pct, item.get('nextResetTime'), now,
                              meter=meter, scope='mcp' if meter == 'TIME_LIMIT' else 'models')
        if meter == 'TIME_LIMIT':
            window['label'] = 'MCP · ' + window['label']
        windows.append(window)
    # Representative display: weekly models, then 5h, then other model limits;
    # the separate MCP budget must not replace the model allowance.
    return sorted(windows, key=lambda w: (w['scope'] == 'mcp', {'weekly': 0, '5h': 1, 'daily': 2}.get(w['period'], 3)))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def glm_query(host, token):
    if host not in HOSTS or not isinstance(token, str) or not token or len(token) > 8192 or any(c.isspace() for c in token):
        raise ProviderError('invalid_credentials')
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=certifi.where())))
    # Z.ai's own usage plugin sends the existing key as Authorization, without
    # forwarding it through a custom gateway or the 1top relay.
    request = urllib.request.Request(f'https://{host}/api/monitor/usage/quota/limit',
        headers={'Authorization': token, 'Accept': 'application/json', 'User-Agent': '1top-quota/1.0'})
    with opener.open(request, timeout=8) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ProviderError('invalid_response')
    return json.loads(raw)


@dataclass(repr=False)
class Source:
    kind: str
    id: str
    host: str = ''
    token: str = field(default='', repr=False)
    cli: str = ''


def glm_source(env):
    if not isinstance(env, dict):
        return None
    base = env.get('ANTHROPIC_BASE_URL')
    token = env.get('ANTHROPIC_AUTH_TOKEN') or env.get('ANTHROPIC_API_KEY')
    if not base and env.get('ZAI_API_KEY'):
        base, token = 'https://api.z.ai', env['ZAI_API_KEY']
    try:
        parsed = urlsplit(base or '')
        if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.port not in (None, 443) or parsed.username or parsed.password:
            return None
    except (ValueError, TypeError):
        return None
    if not isinstance(token, str):
        return None
    token = token.strip()
    if token.startswith('Bearer '):
        token = token[7:]
    if not token or len(token) > 8192 or any(c.isspace() for c in token):
        return None
    return Source('GLM', account_id('GLM', parsed.hostname + '|' + token), host=parsed.hostname, token=token)


def discover(home=None):
    home = home or Path.home()
    found = {}
    def add(env):
        source = glm_source(env)
        if source and len(found) < 32:
            found[source.id] = source
    add(os.environ)
    roots = {home / '.claude'}
    if os.environ.get('CLAUDE_CONFIG_DIR'):
        roots.add(Path(os.environ['CLAUDE_CONFIG_DIR']).expanduser())
    roots.update(p for p in (managed_profiles_dir(home) / 'claude').glob('*') if p.is_dir() and not p.is_symlink())
    for root in sorted(roots)[:64]:
        add(read_json(root / 'settings.json').get('env'))
    # Inspect only known CLI processes, and never serialize their environment.
    for process in psutil.process_iter(['name', 'exe', 'cmdline']):
        info = process.info
        name = (info.get('name') or '').lower().removesuffix('.exe')
        kind = cli_kind(name, info.get('cmdline') or [], info.get('exe'))
        if kind not in ('Claude', 'Codex', 'OpenCode') and name != 'zcode':
            continue
        try:
            add(process.environ())
        except (psutil.Error, OSError):
            pass
    cli = executable('agy')
    if cli:
        # /usage identifies allowance pools but does not report account identity.
        # Keep this explicit and never calibrate historical account rates from it.
        try:
            key = account_id('Antigravity', installation_scope(home) + '|default-cli-profile')
            found[key] = Source('Antigravity', key, cli=cli)
        except (OSError, ProviderError):
            pass
    return list(found.values())


def agy_rows(payload, source_id, now):
    if not isinstance(payload, dict) or number(payload.get('num_turns')) != 0 or payload.get('conversation_id'):
        raise ProviderError('unsafe_cli_response')
    usage = payload.get('usage') or {}
    if not isinstance(usage, dict) or any(number(v) is None or v != 0 for v in usage.values()):
        raise ProviderError('unsafe_cli_response')
    command = payload.get('command') or {}
    if payload.get('status') != 'SUCCESS' or not isinstance(command, dict) or command.get('name') != 'usage':
        raise ProviderError('provider_unavailable')
    data = command.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('groups'), list):
        raise ProviderError('invalid_response')
    rows = []
    for group in data['groups'][:16]:
        if not isinstance(group, dict) or not isinstance(group.get('buckets'), list):
            continue
        pool = text(group.get('name'))
        windows = []
        for bucket in group['buckets'][:16]:
            if not isinstance(bucket, dict) or bucket.get('disabled'):
                continue
            fraction = number(bucket.get('remaining_fraction'))
            if fraction is not None and fraction > 1:
                fraction = None
            period = bucket.get('window') if bucket.get('window') in PERIODS else 'unknown'
            windows.append(quota_window(bucket.get('id') or period, period,
                (1 - fraction) * 100 if fraction is not None else None, bucket.get('reset_time'), now))
        if not windows:
            continue
        key = account_id('Antigravity', source_id + '|' + pool)
        windows.sort(key=lambda w: {'weekly': 0, '5h': 1, 'daily': 2}.get(w['period'], 3))
        rows.append({'id': key, 'kind': 'Antigravity', 'account_label': pool,
                     'plan': '', 'pool': pool, 'provider': 'Google Antigravity',
                     'identity_verified': False, 'identity_source': 'cli_profile',
                     'windows': windows, 'updated': now, 'stale': False,
                     'source': 'agy_usage', 'note': 'agy /usage 공식 한도 · 2분마다 확인'})
    if not rows:
        raise ProviderError('invalid_response')
    return rows


def agy_query(source, now):
    env = {**os.environ, 'AGY_CLI_DISABLE_AUTO_UPDATE': 'true'}
    version = subprocess.run(cli_command(source.cli, '--version'), env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, text=True)
    match = re.search(r'(\d+)\.(\d+)\.(\d+)', version.stdout)
    if not match or tuple(map(int, match.groups())) < (1, 1, 11):
        raise ProviderError('unsupported_cli')
    result = subprocess.run(cli_command(source.cli, '-p', '/usage', '--output-format', 'json',
        '--print-timeout', '20s', '--log-file', os.devnull,
        '--settings', '{"disableSlashCommands":false}'), env=env, cwd=str(Path.home()),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=28, text=True)
    if result.returncode or len(result.stdout.encode()) > MAX_BYTES:
        raise ProviderError('provider_unavailable')
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        raise ProviderError('invalid_response') from None
    return agy_rows(payload, source.id, now)


class ProviderQuotaSampler:
    """Independent background workers; collector snapshot reads never do I/O."""
    def __init__(self):
        self.lock = threading.Lock()
        self.rows = []
        self.cached = {}
        self.sources = {}
        self.retry_after = {}
        self.disabled = set()
        self.thread = None

    def start(self):
        if self.thread:
            return
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def loop(self):
        while True:
            try:
                self.sample()
            except Exception:
                pass  # Never emit credentials, raw responses or CLI diagnostics.
            time.sleep(120)

    def query(self, source, now):
        previous = copy.deepcopy(self.cached.get(source.id, []))
        code = 'provider_unavailable'
        try:
            retry = self.retry_after.get(source.id)
            if retry and now < retry[0]:
                raise ProviderError(retry[1])
            if source.id in self.disabled:
                raise ProviderError('unsafe_cli_response')
            if source.kind == 'Antigravity':
                rows = agy_query(source, now)
                self.retry_after.pop(source.id, None)
                return rows
            payload = glm_query(source.host, source.token)
            windows = glm_windows(payload, now)
            if not windows:
                raise ProviderError('no_quota')
            self.retry_after.pop(source.id, None)
            return [{'id': source.id, 'kind': 'GLM', 'account_label': 'GLM · ' + source.id[-6:],
                     'provider': 'Z.ai' if source.host == 'api.z.ai' else 'Zhipu',
                     'plan': '', 'identity_source': 'credential_fingerprint',
                     'windows': windows, 'updated': now, 'stale': False,
                     'source': 'zai_usage', 'note': '공식 API · 2분마다 확인'}]
        except ProviderError as error:
            code = error.code
            if code == 'unsafe_cli_response':
                self.disabled.add(source.id)
        except urllib.error.HTTPError as error:
            code = {401: 'login_required', 403: 'access_denied', 429: 'rate_limited'}.get(error.code, 'provider_unavailable')
            delay = 600 if code == 'login_required' else 120
            if code == 'rate_limited':
                try:
                    header = error.headers.get('Retry-After', '300')
                    try:
                        value = float(header)
                    except (ValueError, TypeError):
                        deadline = parsedate_to_datetime(header)
                        if deadline.tzinfo is None:
                            deadline = deadline.replace(tzinfo=timezone.utc)
                        value = deadline.timestamp() - now
                    delay = max(120, min(3600, value)) if math.isfinite(value) else 300
                except (ValueError, TypeError, AttributeError, OverflowError):
                    delay = 300
            self.retry_after[source.id] = (now + delay, code)
            error.close()
        except (OSError, ValueError, TypeError, subprocess.SubprocessError):
            pass
        if not previous:
            previous = [{'id': source.id, 'kind': source.kind, 'account_label': source.kind,
                         'plan': '', 'windows': [], 'updated': 0}]
        for row in previous:
            row.update(stale=True, status=code, note='계정 조회 지연 · 마지막 보고값')
        return previous

    def sample(self):
        now = time.time()
        for source in discover():
            if source.id in self.sources or len(self.sources) < 33:
                self.sources[source.id] = source
        # Remember discovered keys in memory so closing a CLI does not remove
        # its allowance mid-session. Never copy credentials onto disk/keychain.
        sources = list(self.sources.values())
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix='provider-quota') as pool:
            values = list(pool.map(lambda source: self.query(source, now), sources))
        self.cached = {source.id: rows for source, rows in zip(sources, values)}
        with self.lock:
            self.rows = [row for rows in values for row in rows]

    def snapshot(self, now):
        with self.lock:
            rows = copy.deepcopy(self.rows)
        for row in rows:
            row['stale'] = row['stale'] or now - row['updated'] > 300
            for window in row['windows']:
                if window['reset'] and window['reset'] <= now:
                    window['pct'] = None
        return rows
