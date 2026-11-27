"""OpenMausBot: the per-turn usage its own ledger reports. Its Claude runs keep no transcript, so the
ledger (~/.openmausbot/usage/YYYY-MM.jsonl) is the only record of their tokens. Names and numbers only."""
import json
import re
import time
from datetime import datetime
from pathlib import Path
from .. import _rust_bridge

ID = re.compile(r'[A-Za-z0-9_-]{1,120}')
KINDS = {'claudeAgent': 'Claude', 'codexAgent': 'Codex'}


def root(home):
    return Path(home)/'.openmausbot'


def ledgers(home, now):
    """This month's ledger and the previous one, oldest first."""
    folder = root(home)/'usage'
    months = sorted({time.strftime('%Y-%m', time.gmtime(now)), time.strftime('%Y-%m', time.gmtime(now - 32*86400))})
    return [folder/f'{month}.jsonl' for month in months if (folder/f'{month}.jsonl').is_file()]


def stamp(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return 0


def count(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def turn(row):
    """One completed turn: [fresh input, cache read, cache write, output]. Its input includes the cache read."""
    if not isinstance(row, dict) or not ID.fullmatch(str(row.get('threadId') or '')):
        return None
    t = stamp(row.get('endedAt') or row.get('at'))
    if not t:
        return None
    cached, prompt = count(row.get('cachedInput')), count(row.get('input'))
    return {'thread': row['threadId'], 'bot': str(row.get('botName') or '').strip()[:120],
            'kind': KINDS.get(row.get('driverKind'), 'Claude'), 'model': str(row.get('model') or '')[:120],
            'turn': str(row.get('turnId') or ''), 't': t,
            'tokens': [max(0, prompt - cached), cached, 0, count(row.get('output'))]}


def _py_read(home, now, window=86400):
    """Threads with a turn in the last day, for their session rows."""
    threads = {}
    for path in ledgers(home, now):
        try:
            with open(path, 'rb') as stream:
                lines = stream.read(64*1024*1024).split(b'\n')[:-1]
        except OSError:
            continue
        for line in lines:
            try:
                item = turn(json.loads(line))
            except (ValueError, UnicodeError):
                continue
            if item and item['t'] > now - window:
                thread = threads.setdefault(item['thread'], {'id': item['thread'], 'turns': 0, 'updated': 0})
                thread['turns'] += 1
                if item['t'] >= thread['updated']:
                    thread.update(bot=item['bot'], kind=item['kind'], model=item['model'], updated=item['t'])
    return sorted(threads.values(), key=lambda r: -r['updated'])


def read(home, now, window=86400):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_read(home, now, window)
    if m == 'new':
        return _rust_bridge.native.obs_openmausbot_read(str(home), float(now), float(window))
    return _rust_bridge.shadow_check(
        'openmausbot.read',
        _py_read(home, now, window),
        _rust_bridge.native.obs_openmausbot_read(str(home), float(now), float(window)),
    )
