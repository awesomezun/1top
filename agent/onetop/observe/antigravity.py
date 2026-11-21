"""Antigravity conversations: the presence lock a process holds, and its summary row."""
import re
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime
from pathlib import Path

LOCK = re.compile(r'^n(.+)/presence/([0-9a-f-]{36})\.lock$')


def stamp(value):
    try:
        text = re.sub(r'\.(\d{1,6})\d*', lambda m: '.' + m[1].ljust(6, '0'), str(value).replace(' ', 'T', 1))
        return datetime.fromisoformat(text).timestamp()
    except (TypeError, ValueError):
        return 0


def summaries(root, ids):
    try:
        with closing(sqlite3.connect((Path(root)/'conversation_summaries.db').as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            marks = ','.join('?' * len(ids))
            return {r[0]: {'title': r[1], 'status': r[2], 'modified': stamp(r[3])} for r in db.execute(
                f'SELECT conversation_id,title,status,last_modified_time FROM conversation_summaries WHERE conversation_id IN ({marks})', list(ids))}
    except (OSError, ValueError, sqlite3.Error):
        return {}


def refresh(rows):
    by_root = {}
    for row in rows:
        by_root.setdefault(row['root'], set()).add(row['session_id'])
    found = {root: summaries(root, ids) for root, ids in by_root.items()}
    return [{**row, **found.get(row['root'], {}).get(row['session_id'], {})} for row in rows]


def read(processes, run):
    pids = [p['pid'] for p in processes if p.get('kind') == 'Antigravity']
    if not pids:
        return []
    held, pid = {}, None
    try:
        for line in run(['lsof', '-p', ','.join(map(str, pids)), '-Fn'], timeout=10).splitlines():
            if line.startswith('p') and line[1:].isdigit():
                pid = int(line[1:])
            match = LOCK.match(line)
            if match and pid is not None:
                held.setdefault(pid, set()).add((match[1], match[2]))
    except (OSError, subprocess.SubprocessError):
        return []
    rows = refresh([{'pid': pid, 'root': root, 'session_id': sid} for pid, locks in held.items() for root, sid in locks])
    newest = {}
    for row in rows:  # a process that moved on still holds its earlier lock
        if row.get('status') is not None and row.get('modified', 0) >= newest.get(row['pid'], {}).get('modified', -1):
            newest[row['pid']] = row
    return list(newest.values())
