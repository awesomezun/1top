"""Bounded, cached transcript facts. Bodies and tool inputs are never retained."""
import json
from pathlib import Path
from .. import _rust_bridge

TAIL = 262144
LIMIT = 64 * 1024 * 1024
RECENT = 200


LOCAL = ('<command-name>', '<local-command-', '<bash-input>', '<bash-stdout>', '<bash-stderr>')
INTERRUPT = '[Request interrupted by user'


def opening(content):
    """The first words of a user row's text, only to recognise its shape."""
    if isinstance(content, str):
        return content.lstrip()[:40]
    for item in content if isinstance(content, list) else []:
        if isinstance(item, dict) and item.get('type') == 'text':
            return str(item.get('text', '')).lstrip()[:40]
    return ''


def fact(row):
    message = row.get('message') if isinstance(row.get('message'), dict) else {}
    raw = message.get('content')
    content = raw if isinstance(raw, list) else []
    payload = row.get('payload') if isinstance(row.get('payload'), dict) else {}
    head = opening(raw) if row.get('type') == 'user' else ''
    return {k: v for k, v in {'t': row.get('timestamp'), 'type': row.get('type'),
        'subtype': row.get('subtype'), 'stop': message.get('stop_reason'),
        'sidechain': row.get('isSidechain'), 'payload': payload.get('type'),
        'meta': bool(row.get('isMeta') or row.get('isCompactSummary')) or None,
        'local': head.startswith(LOCAL) or None,
        'interrupt': head.startswith(INTERRUPT) or None,
        'tool_use': any(x.get('type') == 'tool_use' for x in content if isinstance(x, dict)) or None,
        'tool_result': any(x.get('type') == 'tool_result' for x in content if isinstance(x, dict)) or None}.items() if v is not None}


def boundary(event):
    """§4 shape of one recorded row: 'start', 'end', 'interrupt' or None."""
    if event.get('sidechain'):
        return None
    typ, sub, payload = event.get('type'), event.get('subtype'), event.get('payload')
    if event.get('interrupt') or payload == 'turn_aborted':
        return 'interrupt'
    if sub in ('turn_duration', 'stop_hook_summary') or event.get('stop') == 'end_turn' \
            or payload in ('task_complete', 'turn_complete'):
        return 'end'
    if (typ == 'user' and not (event.get('meta') or event.get('local'))
            or typ in ('api-request', 'queued-message') or payload in ('task_started', 'user_message')):
        return 'start'
    return None


def _py_facts(raw):
    events = []
    for line in raw.split(b'\n'):
        try:
            row = json.loads(line)
            if isinstance(row, dict):
                events.append(fact(row))
        except (ValueError, UnicodeError):
            continue
    return events


def facts(raw):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_facts(raw)
    buf = bytes(raw)
    if m == 'new':
        return _rust_bridge.native.transcript_facts(buf)
    return _rust_bridge.shadow_check('transcripts.facts', _py_facts(raw), _rust_bridge.native.transcript_facts(buf))


def latest(events):
    """Keep the newest row of every shape: the same last start and end, bounded memory."""
    kept = {}
    for index, event in enumerate(events):
        kept[tuple(sorted((k, v) for k, v in event.items() if k != 't'))] = index
    recent = max(0, len(events) - RECENT)
    return [e for i, e in enumerate(events) if i >= recent or kept[tuple(sorted((k, v) for k, v in e.items() if k != 't'))] == i]


class Reader:
    def __init__(self):
        self.cache = {}
        self.used = set()

    def read(self, path):
        """Follow the file: first from its end (further back while no turn boundary
        is in sight), then only what was appended. An unfinished last line waits."""
        if not path:
            return None
        path = str(path); self.used.add(path)
        try:
            stat = Path(path).stat()
            signature = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
            cached = self.cache.get(path)
            if cached and cached[0] == signature:
                return cached[1]
            state = cached[2] if cached and cached[2]['inode'] == stat.st_ino and cached[2]['offset'] <= stat.st_size else None
            with open(path, 'rb') as stream:
                if state is None:
                    window, events = TAIL, []
                    while True:
                        begin = max(0, stat.st_size - window)
                        stream.seek(begin)
                        raw = stream.read(stat.st_size - begin)
                        if begin:
                            raw = raw[raw.find(b'\n') + 1:] if b'\n' in raw else b''
                        end = raw.rfind(b'\n') + 1
                        events = facts(raw[:end])
                        if not begin or window >= LIMIT or any(boundary(e) for e in events):
                            break
                        window *= 8
                    state = {'inode': stat.st_ino, 'offset': begin + (stat.st_size - begin - len(raw)) + end, 'events': events}
                else:
                    stream.seek(state['offset'])
                    raw = stream.read(min(stat.st_size - state['offset'], LIMIT))
                    end = raw.rfind(b'\n') + 1
                    state = {'inode': stat.st_ino, 'offset': state['offset'] + end, 'events': state['events'] + facts(raw[:end])}
            state['events'] = latest(state['events'])
            result = {'path': path, 'mtime': stat.st_mtime, 'events': state['events'], 'partial': False}
            self.cache[path] = (signature, result, state)
            return result
        except OSError:
            return None

    def claude(self, path, now):
        value = self.read(path)
        if value is None:
            return None
        p = Path(path)
        subs = []
        for child in (p.parent/p.stem/'subagents').glob('agent-*.jsonl'):
            try:
                if now - child.stat().st_mtime >= 86400:
                    continue
                observation = self.read(child)
                if observation:
                    subs.append({'id': child.stem, **observation})
            except OSError:
                continue
        return {**value, 'subagents': subs}

    def prune(self):
        self.cache = {p: value for p, value in self.cache.items() if p in self.used}
        self.used.clear()
