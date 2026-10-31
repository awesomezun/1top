"""Identities of recorded sessions, independent of the current process list."""
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .time_ranges import parse_period
from .usage import WINDOWS


def clean(value, limit=200):
    return ''.join(c for c in value if c.isprintable()).strip()[:limit] if isinstance(value, str) else ''


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS session_catalog (
        sid TEXT PRIMARY KEY, kind TEXT, title TEXT, project TEXT, app TEXT,
        model TEXT, first_seen REAL, last_seen REAL, source TEXT)''')


def remember(db, sessions, now):
    initialize(db)
    for s in sessions:
        sid = clean(s.get('id'), 200)
        if not sid:
            continue
        term, loc = s.get('orca_terminal') or {}, s.get('location') or {}
        title = clean(term.get('title') or s.get('thread_name') or s.get('title'))
        values = (sid, clean(s.get('kind'), 40), title, clean(s.get('project'), 100),
                  'Orca' if term else clean(loc.get('app'), 80), clean(s.get('model'), 160),
                  now, now, 'collector')
        db.execute('''INSERT INTO session_catalog VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(sid) DO UPDATE SET
            title=COALESCE(NULLIF(excluded.title,''),session_catalog.title),
            project=COALESCE(NULLIF(excluded.project,''),session_catalog.project),
            app=COALESCE(NULLIF(excluded.app,''),session_catalog.app),
            model=COALESCE(NULLIF(excluded.model,''),session_catalog.model),
            last_seen=excluded.last_seen,source=excluded.source''', values)


def recover(db, home=None, roots=None):
    """Backfill metadata for already-ended sessions; never import prompt bodies."""
    initialize(db)
    home = home or Path.home()
    columns = {r[1] for r in db.execute('PRAGMA table_info(events)')}
    model, cwd = ('model' if 'model' in columns else 'NULL'), ('cwd' if 'cwd' in columns else 'NULL')
    # Ordered latest events supply model/project; token totals remain in events.
    db.execute(f'''INSERT OR IGNORE INTO session_catalog
        SELECT sid,kind,'',COALESCE({cwd},''),'',COALESCE({model},''),first,last,'events'
        FROM (SELECT *,MIN(t) OVER (PARTITION BY sid) AS first,MAX(t) OVER (PARTITION BY sid) AS last,
            ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t DESC,rowid DESC) AS position
            FROM events WHERE sid NOT IN (SELECT sid FROM session_catalog)) WHERE position=1''')
    for sid, project in db.execute("SELECT sid,project FROM session_catalog WHERE source='events'").fetchall():
        db.execute('UPDATE session_catalog SET project=? WHERE sid=?', (clean(Path(project).name, 100), sid))
    wanted = {r[0] for r in db.execute("SELECT sid FROM session_catalog WHERE source!='collector'")}
    if not wanted:
        return

    def save(sid, title, project, app, source):
        if sid not in wanted:
            return
        title = clean(title)
        # Imported thread titles can contain the initial system/instruction text.
        if title.startswith(('# AGENTS', '<', 'You are')):
            title = ''
        db.execute('''UPDATE session_catalog SET title=COALESCE(NULLIF(?,''),title),
            project=COALESCE(NULLIF(?,''),project),app=?,source=? WHERE sid=?''',
            (title, clean(Path(project).name, 100) if project else '', app, source, sid))

    if roots is None:
        roots = [('Claude', home/'.claude'), ('Codex', home/'.codex')]
    for kind, root in roots:
        root = Path(root)
        if kind == 'Codex':
            for path in sorted(root.glob('state_*.sqlite'), reverse=True)[:1]:
                try:
                    with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=.5)) as source:
                        cols = {r[1] for r in source.execute('PRAGMA table_info(threads)')}
                        name = 'thread_name' if 'thread_name' in cols else 'NULL'
                        for sid, title, cwd, thread in source.execute(f'SELECT id,title,cwd,{name} FROM threads'):
                            save(sid, thread or title, cwd, '', 'codex_threads')
                except (OSError, sqlite3.Error):
                    pass
        elif kind == 'Claude':
            for path in root.glob('projects/*/sessions-index.json'):
                try:
                    if path.stat().st_size > 8*1024*1024:
                        continue
                    for row in json.loads(path.read_text()).get('entries', []):
                        save(row.get('sessionId'), row.get('customTitle') or row.get('summary'),
                             row.get('projectPath'), '', 'claude_session_index')
                except (OSError, ValueError, TypeError, AttributeError):
                    pass
            # New Claude versions do not always maintain sessions-index.json.
            # Read bounded metadata at the ends of only already-recorded logs.
            for path in root.glob('projects/*/*.jsonl'):
                sid=path.stem
                if sid not in wanted:
                    continue
                try:
                    with path.open('rb') as stream:
                        chunks=[stream.read(65536)]
                        if path.stat().st_size>65536:
                            stream.seek(max(65536,path.stat().st_size-524288))
                            stream.readline();chunks.append(stream.read(524288))
                    title=summary=slug=''
                    for chunk in chunks:
                        for line in chunk.splitlines():
                            if not any(key in line for key in (b'"customTitle"',b'"slug"',b'"summary"')):
                                continue
                            try:record=json.loads(line)
                            except (ValueError,TypeError):continue
                            if record.get('sessionId') not in (None,sid):continue
                            if record.get('type')=='custom-title':title=clean(record.get('customTitle')) or title
                            if record.get('type')=='summary':summary=clean(record.get('summary')) or summary
                            slug=clean(record.get('slug')) or slug
                    if title or summary or slug:
                        save(sid,title or summary or slug,'','',
                             'claude_custom_title' if title else 'claude_summary' if summary else 'claude_slug')
                except OSError:
                    pass
    for path in (home/'.aside/u').glob('*/state.db'):
        if not path.parent.name.isdigit():
            continue
        try:
            with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=.5)) as source:
                for sid, title, cwd in source.execute('SELECT id,title,cwd FROM sessions WHERE incognito=0 AND ephemeral=0'):
                    save(f'aside:{path.parent.name}:{sid}', title, cwd, 'Aside', 'aside_registry')
        except (OSError, sqlite3.Error):
            pass


def response(db, state, period='1h', offset=0, limit=100):
    """Paginated exact recorded-session breakdown, including absent/ended sessions."""
    if any(isinstance(v,bool) or not (isinstance(v,int) or isinstance(v,str) and v.isascii() and v.isdecimal()) for v in (offset,limit)):
        raise ValueError('Invalid page')
    offset, limit = int(offset), int(limit)
    if offset < 0 or not 1 <= limit <= 200:
        raise ValueError('Invalid page')
    seconds = dict((k, n) for k, _, n in WINDOWS).get(period)
    duration = parse_period(period)
    now = state['updated']
    started = state.get('history_started', state.get('started', now)) if seconds is None else state['started']
    seconds = seconds or (max(600, now-started) if duration == 'all' else duration)
    start = max(started, now-seconds)
    args = (now-seconds, now, started)
    where = 't>? AND t<=? AND t>=?'
    count, *total = db.execute(f'SELECT COUNT(DISTINCT sid),SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE {where}', args).fetchone()
    page = db.execute(f'''SELECT sid,kind,SUM(fresh),SUM(cached),SUM(written),SUM(output),MIN(t),MAX(t)
        FROM events WHERE {where} GROUP BY sid ORDER BY SUM(fresh+cached+written+output) DESC,sid
        LIMIT ? OFFSET ?''', (*args, limit, offset)).fetchall()
    live = {s['id']: s for s in state.get('sessions', [])}
    has_catalog = db.execute("SELECT 1 FROM sqlite_master WHERE name='session_catalog'").fetchone()
    columns = {r[1] for r in db.execute('PRAGMA table_info(events)')}
    model_column = 'model' if 'model' in columns else 'NULL'
    cwd_column = 'cwd' if 'cwd' in columns else 'NULL'
    entries = []
    for sid, kind, *values in page:
        tokens, first, last = values[:4], values[4], values[5]
        stored = db.execute('SELECT title,project,app,model,source FROM session_catalog WHERE sid=?', (sid,)).fetchone() if has_catalog else None
        latest = db.execute(f'SELECT {model_column},{cwd_column} FROM events WHERE sid=? AND t<=? ORDER BY t DESC LIMIT 1', (sid, now)).fetchone()
        title, project, app, last_model, source = stored or ('', Path(latest[1]).name if latest and latest[1] else '', '', '', 'events')
        current = live.get(sid, {})
        title = clean((current.get('orca_terminal') or {}).get('title') or current.get('thread_name') or current.get('title') or title)
        models = []
        for model, *vector in db.execute(f'SELECT {model_column},SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE sid=? AND {where} GROUP BY 1', (sid, *args)):
            model = clean(model, 160)
            models.append({'model': model if model and model.lower() not in ('unknown','<synthetic>') else None, 'tokens': vector})
        entries.append({'id': sid, 'kind': kind, 'title': title or None,
            'project': clean(current.get('project') or project, 100) or None,
            'app': clean(('Orca' if current.get('orca_terminal') else (current.get('location') or {}).get('app')) or app, 80) or None,
            'model': clean(latest[0] if latest else last_model, 160) or None,
            'identity_source': 'collector' if current else source,
            'listed': sid in live, 'tokens': tokens, 'models': models,
            'first_usage': first, 'last_usage': last})
    return {'view': 'sessions', 'period': period, 'as_of': now, 'start': start, 'end': now,
            'session_count': count, 'tokens': [v or 0 for v in total], 'offset': offset,
            'next_offset': offset+len(entries) if offset+len(entries) < count else None,
            'sessions': entries}
