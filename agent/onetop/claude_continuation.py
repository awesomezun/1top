"""Verified Claude foreground-to-background continuations, never directory guesses."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import time

_SID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


def role(name, arguments=()):
    if name == 'claude bg-spare':
        return 'background'
    if name == 'claude bg-pty-host':
        return 'helper'
    if name == 'claude':
        if list(arguments[1:3]) == ['daemon', 'run']:
            return 'helper'
        return 'interactive'
    return None


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
    """Return unique live job chains anchored to their original interactive process.

    A matching job ID alone is insufficient: require process ancestry, profile,
    registry birth and a single candidate. Daemon/PTY helpers are transport only.
    """
    result = {}
    def descendant(child, parent):
        seen = set()
        while child in processes and child not in seen:
            if child == parent:
                return True
            seen.add(child)
            child = processes[child]['ppid']
        return False
    for pid, process in processes.items():
        if process.get('claude_role') != 'interactive' or not verified(records.get(pid, {}), process):
            continue
        chain, current = [pid], pid
        for _ in range(16):
            job = records[current].get('parkedJobId')
            if not isinstance(job, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', job):
                break
            candidates = [p for p, row in processes.items()
                          if p not in chain and row.get('claude_role') == 'background'
                          and verified(records.get(p, {}), row)
                          and records[p].get('kind') == 'bg' and records[p].get('jobId') == job
                          and metadata[p].get('config_dir') == metadata[pid].get('config_dir')
                          and descendant(p, current)]
            if len(candidates) != 1:
                break
            current = candidates[0]
            chain.append(current)
        if len(chain) > 1:
            result[pid] = chain
    return result
