"""Verified Claude foreground-to-background continuations, never directory guesses."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import time
from collections import Counter

_SID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


_VERSIONED = re.compile(r'^\d+(?:\.\d+){1,3}$')


def process_name(command):
    """The process name a Claude Code executable runs under, from ps's full command path.

    Claude Code 2.1.31x runs background sessions and their spares from a versioned binary
    (~/.local/share/claude/versions/2.1.316) under a PTY host; those are Claude too.
    """
    name = command.rsplit('/', 1)[-1].lower()
    if _VERSIONED.fullmatch(name) and '/claude/versions/' in command:
        return 'claude'
    return name


def role(name, arguments=()):
    from .observe.processes import describe
    result=describe({'argv':list(arguments) or [name], 'kind':'Claude' if name.startswith('claude') else None})
    return result['role'] if result['kind']=='Claude' else None


def registry(root, pid):
    try:
        path = Path(root)/'sessions'/f'{pid}.json'
        with path.open('rb') as stream:
            raw = stream.read(65537)
        value = json.loads(raw) if len(raw) <= 65536 else None
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def completed_shell_turn(record, path):
    """Background shells can outlive a completed turn; require its durable end.

    New input/API activity or a newer busy/waiting registry always wins.
    """
    if record.get('status') != 'shell' or not path:
        return None
    try:
        with Path(path).open('rb') as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - 262144))
            raw = stream.read()
            if raw and not raw.endswith(b'\n'):
                return None
            lines = raw.splitlines()
        if size > 262144:
            lines = lines[1:]
        completed = None
        for line in lines:
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                completed = None
                continue
            if not isinstance(row, dict):
                continue
            if row.get('type') in ('api-request', 'user', 'assistant'):
                completed = None
            elif row.get('type') == 'system' and row.get('subtype') == 'turn_duration':
                stamp = row.get('timestamp')
                completed = datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() if isinstance(stamp, str) else None
        updated = float(record.get('statusUpdatedAt', 0)) / 1000
        if completed and updated - 2 <= completed <= time.time() + 1:
            return completed
    except (OSError, ValueError, TypeError):
        pass
    return None


def verified(record, process):
    """The registry records process start in UTC, unlike local ps output."""
    try:
        started = datetime.strptime(record['procStart'], '%a %b %d %H:%M:%S %Y').replace(tzinfo=timezone.utc).timestamp()
        return (record.get('pid') == process['pid'] and
                bool(_SID.fullmatch(record.get('sessionId', ''))) and
                abs(started - process['birth']) < 1.1)
    except (KeyError, TypeError, ValueError):
        return False


def chains(processes, records, metadata):
    """Compatibility entry point; the session contract owns R1–R6."""
    from .sessions.identity import resolve
    procs=[]
    for pid,p in processes.items():
        role=p.get('claude_role')
        argv=['claude','--bg-pty-host'] if role=='helper' else ['claude','--bg-spare'] if role=='background' else ['claude']
        procs.append({**p,'argv':argv,'config_dir':metadata.get(pid,{}).get('config_dir','~/.claude')})
    rows=resolve({'processes':procs,'claude_registry':{str(k):v for k,v in records.items()}})
    return {run['pid']:[run['pid'],run['active_pid']] for row in rows for run in row['runs'] if run['pid']!=run['active_pid']}
