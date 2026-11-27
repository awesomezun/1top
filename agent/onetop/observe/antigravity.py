"""Antigravity conversations: the presence lock a process holds, its summary row, and the tokens each model
response reports in the conversation's own database. Titles, folders and numbers only."""
import json
import re
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

from . import openbot
from .readonly import connect
from .. import _rust_bridge

LOCK = re.compile(r'^n(.+)/presence/([0-9a-f-]{36})\.lock$')
CONVERSATION = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
# The data folder of the ACP runtime that apps (OpenBot) start with --app-data-dir=antigravity-acp. Agy CLI's is
# antigravity-cli; each account an app keeps has a folder of its own (observe/locations.py).
APP_ROOT = 'antigravity-acp'
# A run the runtime lost keeps RUNNING in its summary; past this without a change it is over.
STALE_RUN = 600
# Steps read again on each change: a step can gain its usage after it was first stored.
REREAD = 32
# The last name seen for a model's number, for a response whose own generation record is not readable: one number
# can stand for several models (gemini-4-argon-trial, -c and -e).
MODELS = {}


def stamp(value):
    try:
        text = re.sub(r'\.(\d{1,6})\d*', lambda m: '.' + m[1].ljust(6, '0'), str(value).replace(' ', 'T', 1))
        return datetime.fromisoformat(text).timestamp()
    except (TypeError, ValueError):
        return 0


def roots(home):
    """Antigravity's own data folders, and those of the accounts OpenBot keeps."""
    found = set()
    for base, pattern in ((Path(home)/'.gemini', '*'), (openbot.database(home).parent/'provider-accounts', '*/*')):
        for name in ('conversations', 'conversation_summaries.db'):
            try:
                found.update(p.parent for p in base.glob(pattern + '/' + name))
            except OSError:
                continue
    return sorted(found)


def _varint(data, i):
    value = shift = 0
    while True:
        byte = data[i]
        i += 1
        value |= (byte & 0x7f) << shift
        shift += 7
        if byte < 0x80:
            return value, i
        if shift > 63:
            raise ValueError('varint')


def _py_fields(data):
    """One protobuf message's own fields, {number: [value]}: varints as int, length-delimited as bytes."""
    out, i, size = {}, 0, len(data or b'')
    while i < size:
        key, i = _varint(data, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(data, i)
        elif wire == 2:
            length, i = _varint(data, i)
            if i + length > size:
                raise ValueError('truncated')
            value, i = bytes(data[i:i+length]), i + length
        elif wire in (1, 5):
            i += 8 if wire == 1 else 4
            continue
        else:
            raise ValueError('wire type')
        out.setdefault(number, []).append(value)
    return out


def fields(data):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_fields(data)
    raw = bytes(data or b'')
    if m == 'new':
        return _rust_bridge.native.ag_fields(raw)
    py_res = _py_fields(data)
    rs_res = _rust_bridge.native.ag_fields(raw)
    return _rust_bridge.shadow_check('antigravity.fields', py_res, rs_res)


def _int(values):
    return values[0] if values and isinstance(values[0], int) else 0


def _text(values):
    try:
        return values[0].decode()[:160] if values and isinstance(values[0], bytes) else ''
    except UnicodeDecodeError:
        return ''


def _seconds(values):
    if not values or not isinstance(values[0], bytes):
        return 0
    stamp_fields = fields(values[0])
    return _int(stamp_fields.get(1)) + _int(stamp_fields.get(2)) / 1e9


def _py_response(metadata):
    """A step's model usage (its metadata field 9): input, output, cache write and read, the model's number and the
    response id. Input excludes the cache read. None for a step that called no model."""
    top = _py_fields(metadata)
    if not top.get(9) or not isinstance(top[9][0], bytes):
        return None
    usage = _py_fields(top[9][0])
    rid = _text(usage.get(7)) or _text(usage.get(11))
    tokens = [_int(usage.get(2)), _int(usage.get(5)), _int(usage.get(4)), _int(usage.get(3))]
    if not rid or not sum(tokens):
        return None
    # Created, then started, generated and completed: the response is counted when it ended.
    at = max(_seconds(top.get(n)) for n in (1, 6, 7, 8))
    return {'id': rid, 'tokens': tokens, 'model': _int(usage.get(1)), 't': at}


def response(metadata):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_response(metadata)
    raw = bytes(metadata or b'')
    if m == 'new':
        return _rust_bridge.native.ag_response(raw)
    py_res = _py_response(metadata)
    rs_res = _rust_bridge.native.ag_response(raw)
    return _rust_bridge.shadow_check('antigravity.response', py_res, rs_res)


def model_names(db, count):
    """({response id: model id}, {model number: model id}) as the conversation's newest generation records name them
    (gemini-4-neon). A record names its model (19) and number (3), and the response by its usage (4: ids 7 and 11)."""
    responses, numbers = {}, {}
    for (data,) in db.execute('SELECT data FROM gen_metadata WHERE length(data)<65536 ORDER BY idx DESC LIMIT ?', (count + 8,)):
        try:
            top = fields(data)
            generation = fields(top[1][0]) if top.get(1) and isinstance(top[1][0], bytes) else {}
            number, name = _int(generation.get(3)), _text(generation.get(19))
            usage = generation.get(4) or [b'']
            ids = fields(usage[0]) if isinstance(usage[0], bytes) else {}
        except (ValueError, IndexError):
            continue
        if not name:
            continue
        for rid in (_text(ids.get(7)), _text(ids.get(11))):
            if rid:
                responses.setdefault(rid, name)
        if number:
            numbers.setdefault(number, name)
    return responses, numbers


def _py_usage(path, after=-1):
    """Model responses in steps after index `after`, the last REREAD of those read again: (last index, [response]).
    The caller counts each response id once."""
    with closing(connect(path)) as db:
        # A conversation stored anew numbers its steps from zero again.
        top = db.execute('SELECT MAX(idx) FROM steps').fetchone()[0]
        if (-1 if top is None else top) < after:
            after = -1
        rows = db.execute('SELECT idx,metadata FROM steps WHERE idx>? ORDER BY idx', (max(-1, after - REREAD),)).fetchall()
        found = []
        for idx, metadata in rows:
            try:
                item = _py_response(metadata or b'')
            except (ValueError, IndexError):
                continue
            if item:
                found.append({**item, 'idx': idx})
        names, numbers = {}, {}
        if found:
            try:
                names, numbers = model_names(db, len(found))
            except sqlite3.Error:
                pass
    MODELS.update(numbers)
    for item in found:
        item['model'] = names.get(item['id']) or MODELS.get(item['model'], '')
    return (rows[-1][0] if rows else after), found


def usage(path, after=-1):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_usage(path, after)
    if m == 'new':
        try:
            last, found, numbers = _rust_bridge.native.ag_usage(str(path), int(after), MODELS)
        except RuntimeError as err:
            _rust_bridge.reraise_sqlite(err)
        MODELS.update(numbers)
        return last, found
    before_models = dict(MODELS)
    py_res = _py_usage(path, after)
    try:
        last, found, _ = _rust_bridge.native.ag_usage(str(path), int(after), before_models)
    except RuntimeError as err:
        _rust_bridge.reraise_sqlite(err)
    return _rust_bridge.shadow_check('antigravity.usage', py_res, (last, found))


def _py_workspace(uris):
    """The first local folder among a summary's workspace URIs."""
    try:
        values = json.loads(uris or '[]')
    except ValueError:
        return ''
    for value in values if isinstance(values, list) else []:
        parts = urlsplit(str(value))
        path = unquote(parts.path).rstrip('/')
        if parts.scheme == 'file' and path:
            # OpenBot's own one-off checks run in a fresh temporary folder each: they are OpenBot's, not a project.
            return 'OpenBot' if re.search(r'/openbot-profile-[^/]+$', path) else path
    return ''


def workspace(uris):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_workspace(uris)
    arg = None if uris is None else str(uris)
    if m == 'new':
        return _rust_bridge.native.ag_workspace(arg)
    return _rust_bridge.shadow_check('antigravity.workspace', _py_workspace(uris), _rust_bridge.native.ag_workspace(arg))


def _py_catalog(root):
    """A folder's summaries: {conversation id: {title, cwd, status, modified, parent}}."""
    try:
        with closing(connect(Path(root)/'conversation_summaries.db')) as db:
            rows = db.execute('''SELECT conversation_id,title,workspace_uris,status,last_modified_time,parent_conversation_id
                FROM conversation_summaries''').fetchall()
    except (OSError, ValueError, sqlite3.Error):
        return {}
    out = {}
    for cid, title, uris, status, modified, parent in rows:
        at = stamp(modified)
        if not CONVERSATION.fullmatch(str(cid)):
            continue
        out[cid] = {'id': cid, 'title': ''.join(c for c in str(title or '') if c.isprintable()).strip()[:200],
                    'cwd': _py_workspace(uris), 'status': str(status or ''), 'modified': at, 'root': str(root),
                    'parent': parent if CONVERSATION.fullmatch(str(parent or '')) else None}
    return out


def catalog(root):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_catalog(root)
    if m == 'new':
        return _rust_bridge.native.ag_catalog(str(root))
    return _rust_bridge.shadow_check('antigravity.catalog', _py_catalog(root), _rust_bridge.native.ag_catalog(str(root)))


def changed(row):
    """When a conversation last changed: its summary, or its own database while a long run stores only there."""
    path, at = Path(row['root'])/'conversations'/(row['id'] + '.db'), row['modified']
    for name in (path, Path(str(path) + '-wal')):
        try:
            at = max(at, name.stat().st_mtime)
        except OSError:
            continue
    return at


def conversations(home, now, window=86400, folders=None):
    """Conversations of the ACP runtime that apps start, changed in the last day, in every folder it writes. One that
    started them is listed with them, however long ago its own last word was."""
    if folders is None:
        folders = [r for r in roots(home) if r.name == APP_ROOT]
    known = {}
    for root in folders:
        for cid, row in catalog(root).items():
            if cid not in known or row['modified'] > known[cid]['modified']:
                known[cid] = row
    recent = sorted((r for r in known.values() if r['modified'] >= now - window), key=lambda r: -r['modified'])[:200]
    found = {r['id']: r for r in recent}
    for row in recent:
        while row['parent'] in known and row['parent'] not in found:
            row = known[row['parent']]
            found[row['id']] = row
    for row in found.values():
        if row['status'] == 'CASCADE_RUN_STATUS_RUNNING':
            row['modified'] = min(now, changed(row)) if changed(row) > row['modified'] else row['modified']
            if now - row['modified'] > STALE_RUN:
                row['status'] = 'CASCADE_RUN_STATUS_IDLE'
    return sorted(found.values(), key=lambda r: -r['modified'])


def summaries(root, ids):
    try:
        with closing(connect(Path(root)/'conversation_summaries.db')) as db:
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
