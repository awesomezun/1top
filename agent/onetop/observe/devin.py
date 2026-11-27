"""Devin CLI (also as OpenBot's Devin runtime): its sessions and the tokens each response reports, read-only
from its own database. Names, folders and numbers only; message bodies are never read into 1top."""
import re
from contextlib import closing
from datetime import datetime
from pathlib import Path
import sqlite3

from .readonly import connect
from .. import _rust_bridge

ID = re.compile(r'[A-Za-z0-9_.:-]{1,120}')
# Devin's own helper calls (summarising a long conversation) report their tokens under a role name, not the model
# the session runs on; they count, but do not rename the session's model.
HELPERS = {'compactor'}
# A turn still open (its last response asked for tools, or a tool or the user spoke last) is working only this
# long without a new message; Devin keeps no state for a turn the process lost.
OPEN_TURN = 300
USAGE = '''SELECT m.row_id, m.session_id, m.created_at, json_extract(m.chat_message,'$.message_id'),
    json_extract(m.chat_message,'$.metadata.request_id'), json_extract(m.chat_message,'$.metadata.generation_model'),
    json_extract(m.chat_message,'$.metadata.metrics.input_tokens'), json_extract(m.chat_message,'$.metadata.metrics.cache_read_tokens'),
    json_extract(m.chat_message,'$.metadata.metrics.cache_creation_tokens'), json_extract(m.chat_message,'$.metadata.metrics.output_tokens'),
    s.working_directory, s.title
    FROM message_nodes m LEFT JOIN sessions s ON s.id=m.session_id
    WHERE m.row_id>? AND json_extract(m.chat_message,'$.role')='assistant' ORDER BY m.row_id LIMIT ?'''


def database(home):
    return Path(home)/'.local'/'share'/'devin'/'cli'/'sessions.db'


def count(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def stamp(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value/1000 if value > 1e12 else float(value)
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return 0


def state(role, finish, at, now):
    """The last message of a session: a final answer closed the turn; anything else leaves it open."""
    if role == 'assistant' and finish not in ('tool_calls', 'tool_use'):
        return 'idle'
    return 'busy' if 0 <= now - at < OPEN_TURN else 'idle'


def read(home, now, window=86400, databases=None):
    """Sessions with activity in the last day, newest first, in every database Devin keeps."""
    found = {}
    for path in databases if databases is not None else [database(home)]:
        for row in sessions(path, now, window):
            if row['id'] not in found or row['updated'] > found[row['id']]['updated']:
                found[row['id']] = row
    return sorted(found.values(), key=lambda r: -r['updated'])[:200]


def _py_sessions(path, now, window):
    if not path.is_file():
        return []
    try:
        with closing(connect(path)) as db:
            rows = db.execute('''SELECT id, working_directory, model, title, created_at, last_activity_at FROM sessions
                WHERE hidden=0 AND last_activity_at>? ORDER BY last_activity_at DESC LIMIT 200''', (now - window,)).fetchall()
            found = []
            for sid, cwd, model, title, created, updated in rows:
                if not ID.fullmatch(str(sid)):
                    continue
                # System notes are appended when a session is opened again; the conversation's last word is not one.
                last = db.execute('''SELECT json_extract(chat_message,'$.role') AS role, json_extract(chat_message,'$.metadata.finish_reason'),
                    created_at FROM message_nodes WHERE session_id=? AND role IS NOT 'system' ORDER BY row_id DESC LIMIT 1''', (sid,)).fetchone()
                role, finish, at = last or ('', '', stamp(updated))
                found.append({'id': sid, 'cwd': str(cwd or ''), 'model': str(model or '')[:160],
                              'title': ''.join(c for c in str(title or '') if c.isprintable()).strip()[:200],
                              'created': stamp(created), 'updated': stamp(updated),
                              'status': state(role, finish, stamp(at), now), 'status_at': stamp(at)})
            return found
    except (OSError, ValueError, sqlite3.Error):
        return []


def sessions(path, now, window):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_sessions(path, now, window)
    if m == 'new':
        return _rust_bridge.native.devin_sessions(str(path), float(now), float(window))
    return _rust_bridge.shadow_check(
        'devin.sessions',
        _py_sessions(path, now, window),
        _rust_bridge.native.devin_sessions(str(path), float(now), float(window)),
    )


def _py_usage(path, after=0, now=None, limit=5000):
    """Responses stored after row `after`: (last row read, [response]). A response kept twice (a branch of the
    conversation copies its messages) has one id; the caller counts each id once. A response just stored without
    its numbers yet is read again next time."""
    with closing(connect(path, timeout=2)) as db:
        # A database made anew numbers its rows from one again.
        if (db.execute('SELECT MAX(row_id) FROM message_nodes').fetchone()[0] or 0) < after:
            after = 0
        rows = db.execute(USAGE, (after, limit)).fetchall()
    out, last = [], after
    for row, sid, created, mid, request, model, fresh, cached, written, output, cwd, title in rows:
        tokens = [count(fresh), count(cached), count(written), count(output)]
        if not sum(tokens) and now is not None and now - stamp(created) < 120:
            break
        last = row
        key = mid or request
        if not key or not sum(tokens) or not ID.fullmatch(str(sid)):
            continue
        model = str(model or '')[:160]
        out.append({'session': sid, 'id': str(key)[:120], 't': stamp(created), 'model': model, 'tokens': tokens,
                    'session_model': '' if model in HELPERS else model,
                    'cwd': str(cwd or ''), 'title': ''.join(c for c in str(title or '') if c.isprintable()).strip()[:200]})
    return last, out


def usage(path, after=0, now=None, limit=5000):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_usage(path, after, now, limit)
    now_arg = None if now is None else float(now)
    if m == 'new':
        try:
            return _rust_bridge.native.devin_usage(str(path), int(after), now_arg, int(limit))
        except RuntimeError as err:
            _rust_bridge.reraise_sqlite(err)
    py_res = _py_usage(path, after, now, limit)
    try:
        rs_res = _rust_bridge.native.devin_usage(str(path), int(after), now_arg, int(limit))
    except RuntimeError as err:
        _rust_bridge.reraise_sqlite(err)
    return _rust_bridge.shadow_check('devin.usage', py_res, rs_res)
