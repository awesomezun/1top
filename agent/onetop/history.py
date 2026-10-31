"""Private, incremental token history. No conversation content is persisted."""
import bisect
import collections
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

from .time_ranges import parse_period
from .usage import WINDOWS

FIXED = {key: seconds for key, _, seconds in WINDOWS}
STEPS = {'60': 60, '300': 300, '900': 900, '3600': 3600}


def initialize_capture(db):
    columns = {r[1] for r in db.execute('PRAGMA table_info(events)')}
    for name in ('model', 'cwd'):
        if columns and name not in columns:
            db.execute(f'ALTER TABLE events ADD COLUMN {name} TEXT')
    if columns:
        db.execute('CREATE INDEX IF NOT EXISTS event_session_time ON events(sid,t)')


def edges_for(start, end, step):
    if not math.isfinite(start) or start < 0:
        raise ValueError('Unsupported history range')
    if step in STEPS:
        size = STEPS[step]
        local = datetime.fromtimestamp(start)
        first = local.replace(second=0, microsecond=0, minute=(local.minute//(size//60))*(size//60) if size < 3600 else 0).timestamp()
        count = int((end-first)//size)+1
        if count > 400:
            raise ValueError('More than 400 bins')
        return [first+i*size for i in range(count)]
    if step not in ('day', 'week'):
        raise ValueError('Invalid step')
    local = datetime.fromtimestamp(start).replace(hour=0, minute=0, second=0, microsecond=0)
    if step == 'week':
        local -= timedelta(days=local.weekday())
    result = []
    while local.timestamp() <= end:
        if len(result) >= 400:
            raise ValueError('More than 400 bins')
        result.append(local.timestamp())
        local += timedelta(days=7 if step == 'week' else 1)
    return result


def _epoch(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value/1000 if value > 1e12 else value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, OverflowError):
        return 0


class HistoryStore:
    def __init__(self, directory, monitor=None):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory/'history.sqlite'
        self.monitor = Path(monitor).resolve() if monitor else self.directory/'monitor.sqlite'
        self.lock = threading.Lock()
        self.cache = {}
        self.heat_cache = {}
        self.stop_event = threading.Event()
        self.thread = None
        self.generation = 0
        self.progress = {'running': False, 'files_done': 0, 'files_total': 0, 'failed': 0}
        with closing(self.connect()) as db:
            db.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, inode TEXT, offset INTEGER,
                    state TEXT, completed REAL, error TEXT);
                CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY, sid TEXT, source TEXT,
                    kind TEXT, t REAL, model TEXT, cwd TEXT, fresh INTEGER, cached INTEGER,
                    written INTEGER, output INTEGER);
                CREATE INDEX IF NOT EXISTS history_time ON records(t);
                CREATE INDEX IF NOT EXISTS history_kind_time ON records(kind,t);
                CREATE INDEX IF NOT EXISTS history_coverage ON records(source,kind,t);
                CREATE TABLE IF NOT EXISTS metadata(sid TEXT, t REAL, model TEXT, cwd TEXT,
                    PRIMARY KEY(sid,t));''')
            db.commit()
        try:self.path.chmod(0o600)
        except OSError:pass

    def connect(self):
        db = sqlite3.connect(self.path.as_uri(), uri=True, timeout=10)
        db.execute('PRAGMA busy_timeout=10000')
        return db

    def files(self):
        from .accounts import profile_roots
        seen = set()
        for kind, root in profile_roots():
            pattern = 'rollout-*.jsonl' if kind == 'Codex' else '*.jsonl'
            folders = [root/'sessions',root/'archived_sessions'] if kind == 'Codex' else [root/'projects']
            for path in (p for folder in folders for p in folder.rglob(pattern)):
                try:
                    st = path.stat(); key = (st.st_dev, st.st_ino)
                    if key in seen:continue
                    seen.add(key)
                    yield kind, path, st.st_mtime
                except OSError:continue
        # Aside already supplies per-request tokens to the collector. Import
        # only its event-time model metadata, without inventing older totals.
        for path in (Path.home()/'.aside/u').glob('*/sessions/*/messages.jsonl'):
            try:yield 'Aside',path,path.stat().st_mtime
            except OSError:continue

    def import_file(self, kind, path, chunk=8*1024*1024):
        """Atomic offset + usage update; resumed streams and copied messages deduplicate."""
        from .server import vector
        path = Path(path); stat = path.stat(); inode = f'{stat.st_dev}:{stat.st_ino}'
        with closing(self.connect()) as db:
            prior = db.execute('SELECT inode,offset,state FROM files WHERE path=?', (str(path),)).fetchone()
            offset, state = (prior[1], json.loads(prior[2])) if prior and prior[0] == inode and prior[1] <= stat.st_size else (0, {})
            if kind == 'Codex' and state.get('metadata_schema') != 2:
                offset,state = 0, {'metadata_schema':2}
            if offset == stat.st_size and prior:
                return True
            state.setdefault('sid', path.stem)
            state.setdefault('model', 'unknown'); state.setdefault('cwd', 'unknown')
            source = 'codex_sessions' if kind == 'Codex' else 'claude_transcripts'
            with path.open('rb') as stream:
                stream.seek(offset)
                while stream.tell()-offset < chunk:
                    position = stream.tell(); line = stream.readline()
                    if not line or not line.endswith(b'\n'):
                        stream.seek(position); break
                    if not any(mark in line for mark in (b'"usage"', b'"token_count"', b'"turn_context"', b'"session_meta"')):
                        continue
                    try:row = json.loads(line)
                    except (ValueError, UnicodeError):continue
                    if not isinstance(row, dict):continue
                    t = _epoch(row.get('timestamp'))
                    if not math.isfinite(t) or not 0 < t <= time.time()+60:continue
                    if kind == 'Aside':
                        if row.get('role') == 'assistant' and isinstance(row.get('usage'),dict):
                            sid = f'aside:{path.parents[2].name}:{path.parent.name.rsplit("_",1)[-1]}'
                            db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?)',
                                (sid,t,row.get('model') or 'unknown',row.get('cwd') or 'unknown'))
                        continue
                    payload = row.get('payload') or {}
                    if kind == 'Codex':
                        if row.get('type') == 'session_meta':
                            state.update(sid=payload.get('id') or state['sid'], cwd=payload.get('cwd') or state['cwd'])
                        elif row.get('type') == 'turn_context':
                            state.update(model=payload.get('model') or 'unknown', cwd=payload.get('cwd') or state['cwd'])
                        elif row.get('type') == 'event_msg' and payload.get('type') == 'token_count':
                            usage = (payload.get('info') or {}).get('total_token_usage')
                            if not isinstance(usage, dict):continue
                            # Forked rollouts can replay their parent's session_meta.
                            # The collector's thread ID is the physical rollout UUID;
                            # preserve that alias for event-time model attribution.
                            alias = re.search(r'([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$',path.stem)
                            for sid in {state['sid'],alias.group(1) if alias else state['sid']}:
                                db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?)',
                                           (sid,t,state['model'],state['cwd']))
                            values = vector(usage, True); old = state.get('total'); state['total'] = values
                            if old is None or any(a < b for a,b in zip(values,old)):continue
                            delta = [a-b for a,b in zip(values,old)]
                            if not sum(delta):continue
                            key = 'codex:'+hashlib.sha256(json.dumps([state['sid'],t,values],separators=(',',':')).encode()).hexdigest()
                            db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                                       (key,state['sid'],source,kind,t,state['model'],state['cwd'],*delta))
                            db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?)',
                                       (state['sid'],t,state['model'],state['cwd']))
                        continue
                    if row.get('type') != 'assistant':continue
                    msg = row.get('message') or {}; usage = msg.get('usage')
                    model = msg.get('model') or 'unknown'
                    if model == '<synthetic>' or not isinstance(usage,dict):continue
                    mid = msg.get('id') or row.get('uuid')
                    if not mid:continue
                    runtime = 'GLM' if model.lower().startswith('glm') else kind
                    sid = row.get('sessionId') or path.stem
                    # agent-*.jsonl belongs to its own agent, not the parent's sessionId.
                    if path.stem.startswith('agent-'):sid = path.stem
                    cwd = row.get('cwd') or 'unknown'; values = vector(usage)
                    key = 'claude:'+hashlib.sha256(json.dumps([runtime,mid,row.get('requestId') or ''],separators=(',',':')).encode()).hexdigest()
                    db.execute('''INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
                        t=MIN(records.t,excluded.t), fresh=MAX(records.fresh,excluded.fresh),
                        cached=MAX(records.cached,excluded.cached),written=MAX(records.written,excluded.written),
                        output=MAX(records.output,excluded.output)''', (key,sid,source,runtime,t,model,cwd,*values))
                    db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?,?,?)', (sid,t,model,cwd))
                at = stream.tell()
            db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,NULL)',
                       (str(path),inode,at,json.dumps(state,separators=(',',':')),time.time() if at >= stat.st_size else None))
            db.commit()
        self.generation += 1
        return at >= stat.st_size or at == offset  # Incomplete final JSON waits for the next scan.

    def start(self):
        if self.thread and self.thread.is_alive():return
        self.thread = threading.Thread(target=self._loop, name='1top-history', daemon=True)
        self.thread.start()

    def close(self):
        self.stop_event.set()
        if self.thread:self.thread.join(3)

    def _loop(self):
        while not self.stop_event.is_set():
            paths = sorted(self.files(), key=lambda item:item[2])
            self.progress = {'running': True, 'files_done': 0, 'files_total': len(paths), 'failed': 0}
            for kind,path,_ in paths:
                if self.stop_event.is_set():return
                try:
                    while not self.import_file(kind,path):
                        if self.stop_event.wait(.005):return
                except (OSError, sqlite3.Error, ValueError, TypeError):
                    self.progress['failed'] += 1
                self.progress['files_done'] += 1
            self.progress['running'] = False
            self.stop_event.wait(60)

    def _coverage(self, db, now, started, kind):
        args = (kind,) if kind else ()
        where = 'WHERE kind=?' if kind else ''
        coverage = []
        for source,k,first,last in db.execute(f'SELECT source,kind,MIN(t),MAX(t) FROM records {where} GROUP BY source,kind', args):
            end = min(last,started,now)
            if first < end:coverage.append({'source':source,'kind':k,'from':first,'to':end})
        if started <= now:
            coverage.append({'source':'collector','kind':kind,'from':started,'to':now})
        return coverage

    def _rows(self, db, start, now, started, kind):
        args = [start, min(now,started)]; where = ''
        if kind:where = ' AND kind=?';args.append(kind)
        for row in db.execute('SELECT t,kind,model,cwd,fresh+cached+written+output FROM records WHERE t>? AND t<?'+where, args):
            yield row
        args = [max(start,started-0.000001),now];where = ''
        if kind:where = ' AND e.kind=?';args.append(kind)
        # Legacy collector rows acquire exact event-time metadata from transcripts.
        # Its tokens remain authoritative over the entire collector coverage span.
        columns = {r[1] for r in db.execute('PRAGMA collector.table_info(events)')}
        model = "COALESCE(NULLIF(e.model,''),m.model,'unknown')" if 'model' in columns else "COALESCE(m.model,'unknown')"
        cwd = "COALESCE(NULLIF(e.cwd,''),m.cwd,'unknown')" if 'cwd' in columns else "COALESCE(m.cwd,'unknown')"
        sql = f'''SELECT e.t,e.kind,{model},{cwd},e.fresh+e.cached+e.written+e.output FROM collector.events e
            LEFT JOIN metadata m ON m.sid=e.sid AND m.t=e.t WHERE e.t>? AND e.t<=?{where}'''
        yield from db.execute(sql,args)

    @staticmethod
    def _known(coverage, a, b):
        return any(c['from'] < b and c['to'] >= a for c in coverage)

    def _heat_rows(self, db, start, now, started, kind):
        # Aggregate in SQLite so the long-lived heatmap does not decode every
        # event's model/path on each minute boundary.
        for table, lower, upper, upper_op in (
                ('records', start, min(now,started), '<'),
                ('collector.events', max(start,started-.000001), now, '<=')):
            args = [lower,upper];where = ''
            if kind:where = ' AND kind=?';args.append(kind)
            yield from db.execute(f'''SELECT strftime('%Y-%m-%d',t,'unixepoch','localtime'),
                CAST(strftime('%H',t,'unixepoch','localtime') AS INTEGER),
                SUM(fresh+cached+written+output) FROM {table}
                WHERE t>? AND t{upper_op}?{where} GROUP BY 1,2''',args)

    def response(self, period='1h', step='60', kind=None, snapshot=None):
        if not isinstance(period,str) or (period not in FIXED and parse_period(period) is None):
            raise ValueError('Invalid period')
        if kind is not None and (not isinstance(kind,str) or not kind or len(kind)>80):
            raise ValueError('Invalid kind')
        snapshot = snapshot or {}; now = snapshot.get('updated') or time.time()
        started = snapshot.get('started')
        key = (period,step,kind,now,self.generation)
        with self.lock:
            if key in self.cache:return self.cache[key]
            with closing(self.connect()) as db:
                db.execute('ATTACH DATABASE ? AS collector', (self.monitor.as_uri()+'?mode=ro',))
                if started is None:
                    row = db.execute("SELECT value FROM collector.meta WHERE key='started'").fetchone()
                    started = float(row[0]) if row else now
                # meta.started can survive an older database purge. It is not
                # evidence that retained collector events cover the deleted days.
                first = db.execute('SELECT MIN(t) FROM collector.events WHERE t<=?',(now,)).fetchone()[0]
                started = max(started,first) if first is not None else now
                coverage = self._coverage(db,now,started,kind)
                earliest = min((c['from'] for c in coverage),default=now)
                duration = FIXED.get(period)
                if duration is None:duration = max(600,now-earliest) if period == 'all' else parse_period(period)
                start = now-duration
                edges = edges_for(start,now,step); bounds = edges+[now+.001]
                empty = [0 if self._known(coverage,max(a,start),b) else None for a,b in zip(bounds,bounds[1:])]
                total = empty[:]; models = {}; projects = {}; model_kind = collections.defaultdict(collections.Counter)
                for t,k,model,cwd,tokens in self._rows(db,start,now,started,kind):
                    i = bisect.bisect_right(edges,t)-1
                    if i < 0:continue
                    total[i] = (total[i] or 0)+tokens
                    model = model or 'unknown';cwd = cwd or 'unknown'
                    m = models.setdefault(model,empty[:]);m[i] = (m[i] or 0)+tokens
                    p = projects.setdefault(cwd,empty[:]);p[i] = (p[i] or 0)+tokens
                    model_kind[model][k] += tokens
                def ranked(rows, project=False):
                    ordered = sorted(rows,key=lambda k:(-sum(v or 0 for v in rows[k]),k))
                    result = []
                    for name in ordered[:12]:
                        item = {'key':name,'tokens':rows[name]}
                        item.update({'label':Path(name).name if name!='unknown' else '알 수 없음'} if project else {'kind':model_kind[name].most_common(1)[0][0]})
                        result.append(item)
                    if len(ordered)>12:
                        rest = ordered[12:]
                        result.append({'key':'__other__','folded':len(rest),'tokens':[None if v is None else sum(rows[k][i] or 0 for k in rest) for i,v in enumerate(empty)]})
                    return result
                heat_key = (kind,int(now//60),self.generation)
                if heat_key not in self.heat_cache:
                    by_day = collections.Counter();by_hour = collections.Counter()
                    for day,hour,tokens in self._heat_rows(db,earliest-.001,now,started,kind):
                        by_day[day] += tokens;by_hour[(day,hour)] += tokens
                    today = datetime.fromtimestamp(now).replace(hour=0,minute=0,second=0,microsecond=0)
                    days = [];date = datetime.fromtimestamp(earliest).replace(hour=0,minute=0,second=0,microsecond=0)
                    while date <= today:
                        end = (date+timedelta(days=1)).timestamp();name = date.date().isoformat()
                        days.append([name,by_day[name] if self._known(coverage,date.timestamp(),end) else None]);date += timedelta(days=1)
                    hours = []
                    for offset in range(30):
                        date = today-timedelta(days=29-offset)
                        for hour in range(24):
                            at = date.replace(hour=hour);stamp = at.timestamp();name = date.date().isoformat()
                            # Nonexistent spring-forward hours are unknown; repeated fall hours aggregate.
                            valid = datetime.fromtimestamp(stamp).hour == hour and stamp <= now and self._known(coverage,stamp,stamp+3600)
                            hours.append([name,hour,by_hour[(name,hour)] if valid else None])
                    self.heat_cache = {heat_key:{'hours':hours,'days':days}}
                result = {'as_of':now,'coverage':coverage,'import':dict(self.progress),
                          'series':{'start':edges[0],'end':now,'step':step,'bins':edges,'total':total,
                                    'by_model':ranked(models),'by_project':ranked(projects,True)},
                          'heatmap':self.heat_cache[heat_key]}
                if len(self.cache)>16:self.cache.clear()
                self.cache[key] = result
                return result
