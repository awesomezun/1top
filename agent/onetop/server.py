#!/usr/bin/env python3
"""Local system/session monitor; explicit controls; no transcript bodies in the API."""
import argparse
import collections
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import secrets
import psutil
import platform
from contextlib import closing
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from .controls import Controller, ActionError, target_key, process_start
from .resources import ResourceSampler
from .usage import session_usage, window_usage, WINDOWS
from . import session_archive
from .time_ranges import parse_period, extend_snapshot
from .session_order import ordered_snapshot
from .history import HistoryStore, initialize_capture
from . import weekly_usage
from . import reports
from .discovery import inventory, context, applications, orca_executable, registry_status, claude_transcript
from . import __version__
from .context_usage import request_context, stored_context
from .platform_support import data_directory
from .hierarchy import codex_metadata, annotate as annotate_hierarchy, group_sessions
from .effort import codex_level, backfill_codex, apply_statusline
from .telemetry import TelemetryStore, session_index, bind_account, enrich
from . import claude_continuation
from . import account_aliases
from .diagnostics import failure

BASE = Path(__file__).resolve().parent
HOME = Path.home()
DATA = data_directory()
KINDS = ['Claude', 'Codex', 'GLM', 'Antigravity', 'Aside', 'Devin']
ZERO = [0, 0, 0, 0]  # fresh input, cache read, cache write, output


class DashboardHTTPServer(ThreadingHTTPServer):
    # WebView loads scripts, styles and fonts together at startup. Windows
    # rejects connections beyond the small default listen backlog instead of
    # letting every dependency reach its handler.
    request_queue_size = 64


def epoch(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e12 else value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return 0


def run(args, timeout=8):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout)


def first_codex_report(info, total):
    """A Codex token report whose cumulative total equals its own request: the thread's first."""
    last = info.get('last_token_usage')
    return isinstance(last, dict) and sum(total) > 0 and vector(last, True) == total


def vector(usage, codex=False):
    def n(key):
        try:
            return max(0, int(usage.get(key) or 0))
        except (ValueError, TypeError):
            return 0
    if codex:
        cached = n('cached_input_tokens')
        return [max(0, n('input_tokens') - cached), cached, n('cache_write_input_tokens'), n('output_tokens')]
    return [n('input_tokens'), n('cache_read_input_tokens'), n('cache_creation_input_tokens'), n('output_tokens')]


def claude_windows(entries, now):
    # The legacy tap has no account ID. Never combine windows from different reports.
    latest = max((e for e in entries if e.get('rl')), key=lambda e:e.get('t',0), default=None)
    windows = []
    if latest:
        for key,label in [('five_hour','5시간'),('seven_day','주간')]:
            w=latest['rl'].get(key) or {}
            if w.get('used_percentage') is None:continue
            reset=epoch(w.get('resets_at'))
            windows.append({'label':label,'pct':w['used_percentage'] if reset>now else None,
                            'reset':reset,'t':latest.get('t',0)})
    return windows,latest


def glm_windows(payload, now):
    # Compatibility parser for older integrations. Collection uses account pools.
    from .provider_quotas import glm_windows as parse, ProviderError
    try:return parse(payload, now)
    except ProviderError:return []


from .sessions.terminals import terminal_for, bind_terminal, pane_thread_name


class Ledger:
    """Deduplicate streamed Claude message revisions and cumulative Codex reports."""
    def __init__(self, kind, state=None):
        self.s = state or {'kind': kind, 'offset': 0, 'inode': None, 'total': ZERO[:],
                           'seen': {}, 'models': [], 'last_usage': 0, 'model': '',
                           'status': 'unknown', 'status_at': 0, 'known': False,
                           'effort_schema': 1}

    def consume(self, d):
        s = self.s
        t = epoch(d.get('timestamp'))
        p = d.get('payload') or {}
        if d.get('cwd'):
            s['cwd'] = d['cwd']
        if d.get('type') in ('session_meta', 'turn_context') and p.get('cwd'):
            s['cwd'] = p['cwd']
        if s['kind'] == 'Codex':
            if d.get('type') == 'turn_context':
                if p.get('model') and p['model']!=s['model']:
                    s.update(context_usage=None,request_input=None,context_size=None)
                s['model'] = p.get('model') or s['model']
                s['model_at'] = t
                s['effort_schema'] = 1
                # This turn is authoritative. An absent level must not retain
                # an earlier turn/model's level or the CLI launch default.
                s['effort'] = codex_level(p)
                s['effort_updated'] = t if s['effort'] else None
            if d.get('type') == 'event_msg':
                typ = p.get('type')
                statuses = {'task_started': 'working', 'task_complete': 'idle',
                            'turn_aborted': 'interrupted', 'turn_complete': 'idle'}
                if typ in statuses:
                    s['status'], s['status_at'] = statuses[typ], t
                if typ == 'token_count':
                    if p.get('rate_limits'):
                        s['quota'] = {'t': t, 'rl': p['rate_limits']}
                    info = p.get('info') or {}
                    if t>=s.get('context_at',0):
                        ctx=request_context(info.get('last_token_usage'),t,s['model'],info.get('model_context_window'),codex=True)
                        if ctx is not None:s.update(context_usage=ctx,context_at=t)
                    u = info.get('total_token_usage')
                    if not u:
                        return None
                    v = vector(u, True)
                    old = s['total']
                    was_known = s['known']
                    # A decreasing cumulative counter is a reset, never negative spend.
                    reset = was_known and any(a < b for a, b in zip(v, old))
                    # The thread's first request: its cumulative total is that one request, so it counts
                    # from zero. A fork or a tail read starts above its own request and stays a baseline.
                    first = not was_known and first_codex_report(info, v)
                    delta = [max(0, a-b) for a,b in zip(v, old)] if was_known and not reset else v[:] if first else ZERO[:]
                    if reset:
                        s['counter_reset'] = True
                    s['total'], s['known'] = v, True
                    last = info.get('last_token_usage') or {}
                    s['request_input'] = last.get('input_tokens')
                    s['context_size'] = info.get('model_context_window')
                    if sum(delta) or not was_known:
                        s['last_usage'] = t
                    return (t, delta) if sum(delta) else None
            return None
        if s['kind']=='Aside':
            if d.get('role')!='assistant' or not isinstance(d.get('usage'),dict):return None
            usage=d['usage']
            mid=d.get('responseId')
            if not mid:return None
            d={'type':'assistant','message':{'id':mid,'model':d.get('model',''),'usage':{
                'input_tokens':usage.get('input'),'output_tokens':usage.get('output'),
                'cache_read_input_tokens':usage.get('cacheRead'),'cache_creation_input_tokens':usage.get('cacheWrite')}}}
        if d.get('type') != 'assistant':
            return None
        m = d.get('message') or {}
        model = m.get('model') or ''
        if model == '<synthetic>' or not isinstance(m.get('usage'), dict):
            return None
        mid = m.get('id') or d.get('uuid')
        if not mid:
            return None
        v = vector(m['usage'])
        old = s['seen'].get(mid, ZERO)
        # Repeated content blocks share a message ID; retain each field's maximum.
        new = [max(a, b) for a,b in zip(v, old)]
        delta = [a-b for a,b in zip(new, old)]
        s['seen'][mid] = new
        s['total'] = [a+b for a,b in zip(s['total'], delta)]
        s['known'] = True
        if t>=s.get('context_at',0):
            usage=dict(m['usage'])
            # Repeated streamed revisions of one message must not shrink input.
            if s.get('context_mid')==mid:
                for key,value in zip(('input_tokens','cache_read_input_tokens','cache_creation_input_tokens'),new[:3]):usage[key]=value
            ctx=request_context(usage,t,model,(d.get('context_window') or {}).get('context_window_size'))
            if ctx is not None:s.update(context_usage=ctx,context_at=t,context_mid=mid)
        if model and t >= s.get('model_at', 0):
            s['model'] = model
            s['model_at'] = t
        if model:
            if model not in s['models']:
                s['models'].append(model)
        if sum(delta):
            s['last_usage'] = max(s['last_usage'], t)
            s['request_input'] = sum(v[:3])
        return (t, delta) if sum(delta) else None


class Collector:
    def __init__(self):
        from .operations import OperationalMonitor
        self.operations = OperationalMonitor()
        from .accounts import AccountQuotaSampler
        self.accounts = AccountQuotaSampler()
        self.lock = threading.Lock()
        self.range_lock = threading.Lock()
        self.range_cache = {}
        self.snapshot = {'ready': False, 'version': __version__, 'updated': 0, 'sessions': [], 'error': None}
        self.trackers = {}
        self.index = {}
        self.index_at = 0
        self.process_cache = {}
        self.discovery_at = 0
        self.specs = []
        self.process_counts = {}
        self.terminals = []
        self.last_error = None
        self.resources = None
        self.shared_roots = []
        self.session_metadata = {}
        self.telemetry = None
        self.history = None
        self.controller = None
        self.db = None

    def initialize(self):
        try:self._initialize()
        except Exception:
            if self.db is not None:
                self.db.close()
                self.db = None
            self.spans = None
            raise

    def _initialize(self):
        DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:self.telemetry = TelemetryStore(DATA)
        except (OSError, sqlite3.Error):pass  # Auxiliary intake must not stop JSONL collection.
        self.db = sqlite3.connect(DATA/'monitor.sqlite')
        self.db.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS trackers (path TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t REAL, sid TEXT, kind TEXT,
                fresh INTEGER, cached INTEGER, written INTEGER, output INTEGER);
            CREATE INDEX IF NOT EXISTS event_time ON events(t);''')
        weekly_usage.initialize(self.db)
        initialize_capture(self.db)
        self.reports_ready()
        from .accounts import profile_roots
        session_archive.recover(self.db, roots=profile_roots())
        row = self.db.execute("SELECT value FROM meta WHERE key='started'").fetchone()
        self.started = float(row[0]) if row else time.time()
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('started',?)", (str(self.started),))
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('history_started',?)",
                        (str(max(self.started, time.time() - 86400)),))
        self.history_started = float(self.db.execute("SELECT value FROM meta WHERE key='history_started'").fetchone()[0])
        self.db.commit()
        self.history = HistoryStore(DATA)

    def usage_sessions(self, period='1h', offset=0, limit=100):
        with self.lock:
            state = self.snapshot
        if not state.get('ready'):
            raise ValueError('Collector is starting')
        with closing(sqlite3.connect((DATA/'monitor.sqlite').as_uri()+'?mode=ro', uri=True, timeout=5)) as db:
            db.execute('BEGIN')
            return session_archive.response(db, state, period, offset, limit)

    def state_for_period(self, key):
        duration = parse_period(key)
        with self.lock:
            snapshot = self.snapshot
        if duration is None or not snapshot.get('ready'):
            return snapshot
        with self.range_lock:
            cached = self.range_cache.get(key)
            if cached and cached['updated'] == snapshot['updated']:
                return cached
            with closing(sqlite3.connect((DATA/'monitor.sqlite').as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
                db.execute('BEGIN')
                result = extend_snapshot(db, snapshot, key)
            if len(self.range_cache) >= 8:
                self.range_cache.clear()
            self.range_cache[key] = result
            return result

    def state_for_cloud(self):
        from .relay_data import all_periods
        with self.lock:snapshot=self.snapshot
        if not snapshot.get('ready'):return snapshot
        with self.range_lock:
            cached=getattr(self,'cloud_cache',None)
            if cached and snapshot['updated']==cached['updated']:return cached
            with closing(sqlite3.connect((DATA/'monitor.sqlite').as_uri()+'?mode=ro',uri=True,timeout=5)) as db:
                db.execute('BEGIN')
                result=all_periods(db,snapshot)
            self.cloud_cache=result
            return result

    def speed_for_cloud(self, snapshot):
        from .fleet_usage import speed_windows
        with self.range_lock:
            cached = getattr(self, 'speed_cache', None)
            if cached and 0 <= snapshot['updated'] - cached[0] < 30:
                return cached[1]
            with closing(sqlite3.connect((DATA/'monitor.sqlite').as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
                rows = speed_windows(db, snapshot)
            self.speed_cache = (snapshot['updated'], rows)
            return rows

    def discover(self):
        from .observe import Observer
        from .sessions import resolve
        if not hasattr(self, 'observer'):
            self.observer = Observer(HOME, self.known_locations())
        record = self.observer.read(run)
        self.remember_locations()
        specs = resolve(record)
        self.observation = record
        self.specs = specs
        self.app_inventory = {p['pid']: p for p in record['processes']}
        self.apps = applications(self.app_inventory)
        self.terminals = record.get('orca_terminals') or []
        self.terminal_count = len(self.terminals) if record.get('orca_terminals') is not None else None
        self.shared_roots = [p['pid'] for p in record['processes'] if p.get('kind') == 'Codex' and p.get('role') == 'helper']
        self.process_counts = dict(collections.Counter(s['kind'] for s in specs))
        self.discovery_at = record['captured_at']

    def refresh_sessions(self):
        from .sessions import resolve
        if hasattr(self, 'observation'):
            self.observation = self.observer.refresh(self.observation)
            self.specs = resolve(self.observation)

    def read_tracker(self, spec):
        from .routing_attribution import attach
        if not hasattr(self,'routing_reconciled'):self.routing_reconciled={}
        attach(spec,getattr(self,'routing_bindings',{}),self.db,self.routing_reconciled)
        path = spec['path']
        ledger_path = spec.get('_ledger_path') or path
        if ledger_path not in self.trackers:
            row = self.db.execute('SELECT data FROM trackers WHERE path=?',(ledger_path,)).fetchone()
            self.trackers[ledger_path] = Ledger(spec['kind'],json.loads(row[0]) if row else None)
        tracker = self.trackers[ledger_path]
        s = tracker.s
        cursors = None
        if spec.get('_ledger_path'):
            cursors = s.setdefault('continuation_cursors', {
                ledger_path: {'offset': s['offset'], 'inode': s['inode']}})
            cursor = cursors.setdefault(path, {'offset': 0, 'inode': None})
            s.update(cursor)
        st = os.stat(path)
        if (s['inode'] is not None and s['inode'] != st.st_ino) or st.st_size < s['offset']:
            if cursors is not None:
                s.update(offset=0, inode=None)
            else:
                tracker = self.trackers[ledger_path] = Ledger(spec['kind'])
                s = tracker.s
        s['inode'] = st.st_ino
        effort_migrated = backfill_codex(s, path) if spec['kind'] == 'Codex' else False
        if s['offset']==0 and spec['kind']=='Codex' and st.st_size>16*1024*1024:
            # Codex already reports authoritative cumulative totals; no need to reread gigabytes.
            with open(path,'rb') as f:
                f.seek(st.st_size-16*1024*1024)
                f.readline()
                s['offset']=f.tell()
        start = s['offset']
        if start < st.st_size:
            with open(path,'rb') as f:
                f.seek(start)
                while f.tell()-start < 24*1024*1024:
                    pos = f.tell()
                    line = f.readline()
                    if not line or not line.endswith(b'\n'):
                        f.seek(pos)
                        break
                    # Avoid decoding tool output / embedded images / user prompts.
                    interesting = b'"usage"' in line or b'"token_count"' in line or b'"turn_context"' in line or b'"event_msg"' in line or b'"session_meta"' in line
                    if interesting:
                        try:
                            record = json.loads(line)
                            event = tracker.consume(record)
                            if event and event[0]>=self.started:
                                t,v=event
                                event_model = ((record.get('message') or {}).get('model')
                                               if spec['kind'] in ('Claude', 'GLM') else None) or s.get('model')
                                self.db.execute('INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) VALUES(?,?,?,?,?,?,?,?,?,?)',
                                                (t,spec['id'],spec['kind'],*v,weekly_usage.event_account(spec,t),
                                                 event_model or None,s.get('cwd') or spec.get('cwd')))
                        except (ValueError, TypeError, KeyError):
                            pass
                s['offset'] = f.tell()
        spec['loading'] = s['offset'] < st.st_size
        spec['progress'] = round(100*s['offset']/max(1,st.st_size))
        spec['tokens'] = s['total'] if s['known'] and not spec['loading'] else None
        spec['model'] = s['model'] or spec.get('configured_model','')
        spec['model_updated'] = s.get('model_at', s.get('last_usage', 0))
        if spec['kind'] == 'Codex':
            for key in ('effort', 'effort_source', 'effort_updated'):
                spec.pop(key, None)
            if s.get('effort'):
                spec.update(effort=s['effort'], effort_source='codex_turn_context',
                            effort_updated=s.get('effort_updated'))
        elif spec['kind'] == 'Aside' and spec['model'] != spec.get('effort_model'):
            for key in ('effort', 'effort_source', 'effort_updated'):
                spec.pop(key, None)
        spec['models'] = s.get('models',[])
        spec['last_usage'] = s['last_usage']
        spec['request_input'] = s.get('request_input')
        spec['context_size'] = s.get('context_size')
        spec['context_usage'] = stored_context(s) if not spec['loading'] else None
        spec['quota'] = s.get('quota')
        spec['counter_reset'] = s.get('counter_reset',False)
        if spec['kind']=='Codex' and 'display_status' not in spec:
            spec['status'],spec['status_at']=s['status'],s['status_at']
        if not spec['loading'] and not s['known']:
            spec['note']='대화 기록에 유효한 사용량 보고가 없습니다. 0으로 간주하지 않습니다.'
        if cursors is not None:
            cursors[path] = {'offset': s['offset'], 'inode': s['inode']}
            s.update(cursors[ledger_path])
        if start < st.st_size or effort_migrated or cursors is not None:
            self.db.execute('INSERT OR REPLACE INTO trackers VALUES (?,?)',(ledger_path,json.dumps(s,separators=(',',':'))))

    def read_openmausbot(self, now):
        """T5: OpenMausBot's ledger turns become events once each (the ledger only grows) and per-thread totals."""
        from .observe import openmausbot
        totals = {}
        for path in openmausbot.ledgers(HOME, now):
            key = 'openmausbot:' + str(path)
            row = self.db.execute('SELECT data FROM trackers WHERE path=?', (key,)).fetchone()
            s = json.loads(row[0]) if row else {}
            try:
                st = os.stat(path)
                if s.get('inode') != st.st_ino or st.st_size < s.get('offset', 0):
                    s = {'inode': st.st_ino, 'offset': 0, 'threads': {}}
                if s['offset'] < st.st_size:
                    with open(path, 'rb') as f:
                        f.seek(s['offset'])
                        raw = f.read(min(st.st_size - s['offset'], 64*1024*1024))
                    end = raw.rfind(b'\n') + 1  # an unfinished last line waits
                    for line in raw[:end].split(b'\n')[:-1]:
                        try:
                            item = openmausbot.turn(json.loads(line))
                        except (ValueError, UnicodeError):
                            continue
                        if not item:
                            continue
                        thread = s['threads'].setdefault(item['thread'], {'tokens': ZERO[:], 'model': '', 'last': 0})
                        thread['tokens'] = [a + b for a, b in zip(thread['tokens'], item['tokens'])]
                        if item['t'] >= thread['last']:
                            thread.update(model=item['model'], last=item['t'])
                        if item['t'] >= self.started and sum(item['tokens']):
                            self.db.execute('INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) VALUES(?,?,?,?,?,?,?,?,?,?)',
                                            (item['t'], 'openmausbot:' + item['thread'], item['kind'], *item['tokens'], None, item['model'] or None, None))
                    if end:
                        s['offset'] += end
                        self.db.execute('INSERT OR REPLACE INTO trackers VALUES (?,?)', (key, json.dumps(s, separators=(',', ':'))))
            except OSError:
                continue
            for thread_id, thread in s.get('threads', {}).items():
                total = totals.setdefault(thread_id, {'tokens': ZERO[:], 'model': '', 'last': 0})
                total['tokens'] = [a + b for a, b in zip(total['tokens'], thread['tokens'])]
                if thread['last'] >= total['last']:
                    total.update(model=thread['model'], last=thread['last'])
        return totals

    def adapter_state(self, key):
        """A conversation's running totals and the responses it has counted, kept across restarts (trackers)."""
        cache = self.__dict__.setdefault('adapter_cache', {})
        if key not in cache:
            row = self.db.execute('SELECT data FROM trackers WHERE path=?', (key,)).fetchone()
            cache[key] = json.loads(row[0]) if row else {'tokens': ZERO[:], 'model': '', 'last': 0, 'seen': {}, 'new': True}
        return cache[key]

    def count_response(self, key, kind, sid, item):
        """One model response into its conversation's totals, and its tokens into events once: a repeated copy of
        the response adds only what grew. True when anything changed."""
        s = self.adapter_state(key)
        old = s['seen'].get(item['id'], ZERO)
        new = [max(a, b) for a, b in zip(item['tokens'], old)]
        delta = [a - b for a, b in zip(new, old)]
        if not sum(delta):
            return False
        s['seen'][item['id']] = new
        s['tokens'] = [a + b for a, b in zip(s['tokens'], delta)]
        if item['t'] >= s['last']:
            s.update(model=item.get('session_model', item['model']) or s['model'], last=item['t'])
        if item['t'] >= self.started:
            self.db.execute('INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) VALUES(?,?,?,?,?,?,?,?,?,?)',
                            (item['t'], sid, kind, *delta, None, item['model'] or None, item.get('cwd') or None))
        return True

    def save_adapter(self, key, kind, sid, item, now):
        s = self.adapter_state(key)
        if s.pop('new', False):
            # Named in the catalog at once, so a period view names it after it has left the list.
            from .sessions.devin import seat
            cwd = item.get('cwd') or ''
            name = seat(cwd, (getattr(self, 'observation', None) or {}).get('openbot_agents'))
            session_archive.remember(self.db, [{'id': sid, 'kind': kind, 'title': item.get('title') or '', 'model': s['model'],
                'project': name or Path(cwd).name, 'location': {'app': 'OpenBot' if name or cwd == 'OpenBot' else item.get('app', '')}}], now)
        self.db.execute('INSERT OR REPLACE INTO trackers VALUES (?,?)', (key, json.dumps(s, separators=(',', ':'))))

    def known_locations(self):
        """Data folders seen in earlier runs (observe/locations.py): an account's folder stays known after its process."""
        try:
            row = self.db.execute("SELECT data FROM trackers WHERE path='locations'").fetchone()
            self.locations_saved = json.loads(row[0]) if row else {}
        except (AttributeError, TypeError, ValueError, sqlite3.Error):
            self.locations_saved = {}
        return self.locations_saved

    def remember_locations(self):
        try:
            known = json.loads(json.dumps(self.observer.locations.known()))
            if known == getattr(self, 'locations_saved', None) or not self.db:
                return
            self.db.execute("INSERT OR REPLACE INTO trackers VALUES ('locations',?)", (json.dumps(known),))
            self.locations_saved = known
        except (AttributeError, TypeError, sqlite3.Error):
            pass

    def read_devin(self, now):
        """T5: Devin's per-response reports become events once each; per-session totals for the listed rows."""
        from .observe import devin
        places = getattr(getattr(self, 'observer', None), 'locations', None)
        rows = self.__dict__.setdefault('devin_row', {})
        for path in places.devin_databases() if places else [devin.database(HOME)]:
            key = 'devin:' + str(path)
            if not path.is_file():
                continue
            if key not in rows:
                row = self.db.execute('SELECT data FROM trackers WHERE path=?', (key,)).fetchone()
                rows[key] = (json.loads(row[0]) if row else {}).get('row', 0)
            try:
                for _ in range(4):
                    last, found = devin.usage(path, rows[key], now)
                    touched = {}
                    for item in found:
                        sid, item = 'devin:' + item['session'], {**item, 'app': 'Devin'}
                        if self.count_response(sid, 'Devin', sid, item):
                            touched[sid] = item
                    for sid, item in touched.items():
                        self.save_adapter(sid, 'Devin', sid, item, now)
                    if last == rows[key]:
                        break
                    rows[key] = last
                    self.db.execute('INSERT OR REPLACE INTO trackers VALUES (?,?)', (key, json.dumps({'row': last})))
            except (OSError, sqlite3.Error):
                pass
        return {s['conversation_id']: self.adapter_state(s['id']) for s in self.specs if s.get('usage_adapter') == 'devin'}

    def read_antigravity(self, now, budget=24):
        """Antigravity's per-response reports in each conversation's own database become events once each.
        Files are read again only when they or their write-ahead log change, newest first, a few a collection."""
        from .observe import antigravity
        places = getattr(getattr(self, 'observer', None), 'locations', None)
        files = {}
        for root in places.antigravity_roots() if places else antigravity.roots(HOME):
            for path in (root/'conversations').glob('*.db'):
                if not antigravity.CONVERSATION.fullmatch(path.stem):
                    continue
                try:
                    st, wal = path.stat(), Path(str(path) + '-wal')
                    mark = [st.st_mtime, st.st_size, *((wal.stat().st_mtime, wal.stat().st_size) if wal.exists() else (0, 0))]
                except OSError:
                    continue
                # A conversation copied to another folder (an account moved) is read where it last changed.
                at = max(mark[0], mark[2])
                if path.stem not in files or at > files[path.stem][0]:
                    files[path.stem] = (at, root, path, mark)
        catalogs = {}
        for _, root, path, mark in sorted(files.values(), key=lambda f: -f[0]):
            key = 'antigravity:' + path.stem
            s = self.adapter_state(key)
            if s.get('mark') == mark:
                continue
            if budget <= 0:
                break
            budget -= 1
            if root not in catalogs:
                catalogs[root] = antigravity.catalog(root)
            info = catalogs[root].get(path.stem, {})
            try:
                last, found = antigravity.usage(path, s.get('step', -1))
            except (OSError, ValueError, sqlite3.Error):
                # Unreadable as it stands (another layout, or busy): tried again once it changes.
                last, found = s.get('step', -1), []
            for item in found:
                self.count_response(key, 'Antigravity', path.stem, {**item, 'cwd': info.get('cwd') or ''})
            # Only responses that the next read can meet again need their ids; older steps are not read again.
            if found:
                again = {i['id'] for i in found}
                s['seen'] = {rid: v for rid, v in s['seen'].items() if rid in again}
            s.update(mark=mark, step=last)
            # Agy CLI runs in whichever terminal; its app is known only while it is listed.
            self.save_adapter(key, 'Antigravity', path.stem, {'cwd': info.get('cwd') or '', 'title': info.get('title') or ''}, now)
        return {s['conversation_id']: self.adapter_state('antigravity:' + s['conversation_id'])
                for s in self.specs if s['kind'] == 'Antigravity' and not s.get('path')}

    def read_continuation(self, spec, roots, telemetry_sessions, now):
        from .claude_statusline import session_binding
        sources = [source for source in spec['continuation_sources'] if source.get('path')]
        if not sources:
            return
        active_id, active_path = spec['active_session_id'], spec['path']
        for source in sources:
            part = {**spec, 'path': source['path'], 'active_session_id': source['session_id'],
                    '_ledger_path': sources[0]['path']}
            part['account_binding'] = weekly_usage.account_for(part, roots)
            part.pop('account_binding_source', None)
            captured = session_binding(part, now=now, quotas=self.accounts.snapshot(now))
            if part.get('account_binding_uncertain'):
                part['account_binding'] = None
                part['account_binding_source'] = 'claude_identity_unconfirmed'
            if captured:
                part.update(account_binding=captured, account_binding_source='claude_statusline_session')
            bind_account(part, telemetry_sessions, roots, now)
            self.read_tracker(part)
            spec.pop('account_binding_source', None)
            spec.update(part)
            # Consume original context first; one ledger deduplicates copied IDs.
            if part.get('loading'):
                break
        spec.update(active_session_id=active_id, path=active_path)
        spec.pop('_ledger_path', None)

    def claude_quota(self, now):
        entries = []
        p = HOME/'Library/Logs/proc-logger/claude-limits.jsonl'
        try:
            with p.open('rb') as f:
                if p.stat().st_size>1024*1024:
                    f.seek(-1024*1024,2);f.readline()
                for line in f:
                    try:
                        e=json.loads(line)
                    except ValueError:
                        continue
                    entries.append(e)
        except OSError:
            pass
        windows,latest=claude_windows(entries,now)
        return {'kind':'Claude','windows':windows,'updated':latest.get('t',0) if latest else 0,
                'note':'가장 최근 상태줄 보고 · 계정 전체 합계 아님'}

    def quotas(self, sessions, now):
        out=[self.claude_quota(now)]
        q=max([s['quota'] for s in sessions if s.get('quota')] or [{'t':0,'rl':{}}],key=lambda v:v['t'])
        windows=[]
        for key in ['primary','secondary']:
            w=q['rl'].get(key)
            if not w:continue
            mins=w.get('window_minutes',0)
            reset=epoch(w.get('resets_at'))
            windows.append({'label':'주간' if mins==10080 else '5시간' if mins==300 else f'{mins}분',
                            'pct':w.get('used_percent') if reset>now else None,'reset':reset,'t':q['t']})
        out.append({'kind':'Codex','windows':windows,'updated':q['t'],'note':'가장 최근 세션이 보고한 계정 한도'})
        # Legacy and account readers share one owner of provider polling.
        out.extend(self.accounts.providers.snapshot(now))
        return out

    def collect(self):
        collect_started=time.monotonic()
        if time.time()-self.discovery_at>9:
            self.discover()
        else:
            self.refresh_sessions()
        now=time.time()
        sessions=[]
        roots=self.accounts.roots()
        account_quotas=self.accounts.snapshot(now)
        from .routing_attribution import load as routing_bindings
        self.routing_bindings=routing_bindings(DATA,now)
        try:telemetry = self.telemetry.snapshot(now) if self.telemetry else {'available':False}
        except sqlite3.Error:telemetry = {'available':False}
        telemetry_sessions = session_index(telemetry)
        mausbot = self.read_openmausbot(now)
        devin = self.read_devin(now)
        antigravity = self.read_antigravity(now)
        for src in self.specs:
            from .sessions import public
            s=public(src)
            s['account_binding']=(weekly_usage.bind_adapter(self.db,s,roots,now) if s['kind']=='Aside' else weekly_usage.account_for(s,roots))
            s.pop('billing_account',None)
            from .claude_statusline import session_binding
            captured_binding = session_binding(s, now=now, quotas=account_quotas)
            if s.get('account_binding_uncertain'):
                s['account_binding'] = None
                s['account_binding_source'] = 'claude_identity_unconfirmed'
            if captured_binding:
                s['account_binding'] = captured_binding
                s['account_binding_source'] = 'claude_statusline_session'
            bind_account(s, telemetry_sessions, roots, now)
            s.update(tokens=None,model=s.get('configured_model',''),last_usage=0,loading=False)
            if s.get('usage_adapter') == 'openmausbot' and s.get('conversation_id') in mausbot:
                ledger = mausbot[s['conversation_id']]
                s.update(tokens=ledger['tokens'], model=ledger['model'] or s['model'], last_usage=ledger['last'])
            # T5: Devin's sessions and Antigravity's conversations, counted from their own response reports. An
            # Antigravity conversation not read yet (a few files a collection) is still loading, not zero.
            ledger = (devin if s.get('usage_adapter') == 'devin' else antigravity if s['kind'] == 'Antigravity' else {}).get(s.get('conversation_id'))
            if ledger and (s['kind'] == 'Devin' or 'mark' in ledger):
                s.update(tokens=ledger['tokens'][:], model=ledger['model'] or s['model'], last_usage=ledger['last'])
            elif ledger is not None:
                s['loading'] = True
            if s['path']:
                try:
                    if s.get('continuation_sources'):
                        self.read_continuation(s, roots, telemetry_sessions, now)
                    else:
                        self.read_tracker(s)
                except OSError:s['note']='세션 기록을 읽을 수 없습니다.'
            if s['kind'] in ('Claude', 'GLM'):
                apply_statusline(s, now)
            enrich(s, telemetry_sessions)
            # Registry states are reported, not inferred from CPU or a refreshing terminal clock.
            if s['status'] not in ('working','subagents','done','idle','waiting','interrupted','disconnected'):
                s['status']='unknown'
            # T5: an app seat is named by its agent or app, not by its workspace folder's id.
            s['project']=s.get('project_name') or Path(s['cwd']).name or '알 수 없음'
            sessions.append(s)
        # Keep display identity after its process/terminal leaves discovery.
        session_archive.remember(self.db, sessions, now)
        # Retain local reports for user-selected ranges beyond 24 hours.
        self.db.commit()
        # The browser needs a chart, not a growing raw event log. Bound payloads by minute/provider.
        events=[dict(zip(['t','kind','fresh','cached','written','output'],r)) for r in
                self.db.execute('SELECT CAST(t/60 AS INTEGER)*60,kind,SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE t>? AND t<=? GROUP BY 1,2 ORDER BY 1',(now-86400,now))]
        recent={r[0]:list(r[1:]) for r in self.db.execute('SELECT kind,SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE t>? GROUP BY kind',(now-300,))}
        quotas=self.quotas(sessions,now)
        for s in sessions:
            s.pop('quota',None)
        minute,five,history,window=session_usage(self.db,now,self.started)
        periods,session_periods=window_usage(self.db,now,self.started,
                                            (s['kind'] for s in sessions if s['tokens'] is not None))
        account_quotas=self.accounts.snapshot(now)
        weekly_usage.restore_bound_claude_accounts(self.db,account_quotas,sessions,now)
        weekly_usage.restore_claude_last_report(self.db,account_quotas,now)
        account_aliases.apply(account_quotas,DATA)
        weekly_usage.record(self.db,account_quotas,now)
        self.reports_ready()
        try:self.spans.record(self.db,sessions,now)
        except sqlite3.Error as e:print('state spans:',type(e).__name__,flush=True)
        weekly,estimates=weekly_usage.snapshot(self.db,account_quotas,now,
            bindings={s['id']:s['account_binding'][0] for s in sessions if s.get('account_binding')},
            recording_started=self.started)
        self.db.commit()
        for s in sessions:
            binding=s.pop('account_binding',None)
            s.pop('_routing_intervals',None)
            s.pop('_routing_original_binding',None)
            known=s['tokens'] is not None
            v=minute.get(s['id'],ZERO[:]) if known else None
            s['usage']={'last_minute':v,'last_five_minutes':five.get(s['id'],ZERO[:]) if known else None,
                        'rate':sum(v)/window if v is not None else None,
                        'output_rate':v[3]/window if v is not None else None,
                        'window_seconds':window,'history':history.get(s['id'],[]),
                        'weekly_estimate':estimates.get(s['id'],{}) if known and not s.get('loading') else {},
                        'weekly_account':binding[0] if binding else None,
                        'windows':{key:session_periods.get(s['id'],{}).get(key,ZERO[:]) if known else None
                                   for key,_,_ in WINDOWS}}
        if self.resources is None:self.resources=ResourceSampler()
        system=self.resources.sample(sessions,self.shared_roots)
        roots = group_sessions(sessions)
        report,notice_list,notice_settings=self.reports_snapshot(account_quotas,weekly,now)
        result={'ready':True,'version':__version__,'updated':now,'started':self.started,'sessions':sessions,
                'reports':report,'notices':notice_list,'notification_settings':notice_settings,
                'history_started':getattr(self,'history_started',self.started),
                'root_sessions':roots,
                'events':events,'recent':recent,'period_usage':periods,'quotas':quotas,'process_counts':self.process_counts,
                'orca_terminals':self.terminal_count,'error':None,'poll_seconds':3,
                'applications':getattr(self,'apps',[]),'system':system,'operations':self.operations.sample(sessions),
                'account_quotas':account_quotas,'weekly_usage':weekly,
                'telemetry':{k:v for k,v in telemetry.items() if k!='sessions'},
                'collection_ms':round((time.monotonic()-collect_started)*1000,1)}
        with self.lock:self.snapshot=result

    def reports_ready(self):
        # Made on first use, so a collector built without initialize() (as the tests do) still collects.
        if getattr(self,'spans',None) is not None:return
        try:reports.initialize(self.db)
        except sqlite3.Error:pass
        self.spans=reports.Spans();self.value_report=reports.Value();self.reports_value=None;self.reports_job=None;self.reports_weekly=(0,None,None)

    def reports_snapshot(self,account_quotas,weekly,now):
        """The reports and notices for this snapshot. The month's value is computed off the collection thread (the
        first run reads five past months); the week and the notices are cheap and read every time."""
        job=self.reports_job
        if getattr(self,'history',None) is not None and (job is None or not job.is_alive()) and (self.reports_value is None or now-self.reports_value['end']>=60):
            quotas=[dict(q) for q in account_quotas];overrides=reports.read_plans(DATA)
            def compute():
                try:self.reports_value=self.value_report.compute(self.history.model_totals,quotas,overrides,time.time())
                except Exception as e:failure('reports',e)
            self.reports_job=threading.Thread(target=compute,daemon=True,name='1top-reports');self.reports_job.start()
        if now-self.reports_weekly[0]>=30:
            try:self.reports_weekly=(now,reports.weekly(self.db,now),reports.last_week(self.db,now))
            except sqlite3.Error:self.reports_weekly=(now,None,None)
        week,last=self.reports_weekly[1],self.reports_weekly[2]
        names={q['id']:(q.get('alias') or (('Claude Code' if q.get('kind')=='Claude' else 'Agy CLI' if q.get('kind')=='Antigravity' else q.get('kind',''))+(' '+str(q.get('plan') or '').title() if q.get('plan') else ''))).strip() for q in account_quotas if q.get('id')}
        try:items,settings=reports.notices(DATA,account_quotas,weekly,names,last,self.reports_value,now)
        except (OSError,ValueError,TypeError) as e:print('notices:',type(e).__name__,flush=True);items,settings=[],reports.read_settings(DATA)
        report={'version':1,'as_of':now,**({'value':self.reports_value} if self.reports_value else {}),**({'weekly':week} if week else {})}
        return report,items,settings

    def tick_mailbox(self):
        # Terminal admission can take seconds. Keep collection fresh while a
        # single dispatcher drains the durable queue; never spawn overlapping sends.
        worker=getattr(self,'mailbox_worker',None)
        if self.controller is None or worker and worker.is_alive():return
        def dispatch():
            try:self.controller.flush_mailbox()
            except Exception as e:failure('mailbox',e)
        self.mailbox_worker=threading.Thread(target=dispatch,daemon=True,name='1top-mailbox')
        self.mailbox_worker.start()

    def loop(self):
        initialized=False
        while True:
            before=time.monotonic()
            try:
                if not initialized:
                    self.accounts.start()
                    self.initialize()
                    initialized=True
                self.history.start()
                self.collect()
            except Exception as e:
                # No raw exception messages: paths and tool responses can contain private text.
                with self.lock:self.snapshot={**self.snapshot,'error':type(e).__name__}
                failure('collector',e)
            # Local conversations still drain after a failed collection tick.
            if initialized:
                try:self.tick_mailbox()
                except Exception as e:failure('mailbox',e)
            time.sleep(max(.2,3-(time.monotonic()-before)))



class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path in ('/v1/logs', '/v1/metrics', '/v1/traces'):
            from .telemetry import handle_http
            handle_http(self)
            return
        host=self.headers.get('Host','')
        allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if (host not in allowed or self.headers.get('Origin')!='http://'+host or
            not secrets.compare_digest(self.headers.get('X-Monitor-Token',''),self.server.action_token)):
            self.send_error(403);return
        route=urlsplit(self.path).path
        if route not in ('/api/action','/api/mailbox','/api/accounts/login','/api/accounts/authorize','/api/accounts/alias','/api/routing','/api/notifications','/api/reports/plan'):self.send_error(404);return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>(2200000 if route=='/api/action' else 4096) or self.headers.get('Content-Type')!='application/json':
                self.send_error(400);return
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):raise ValueError()
            if route=='/api/mailbox':
                result={'messages':self.server.controller.read_mailbox(payload.get('session_id'),payload.get('control_key'))}
            elif route=='/api/routing':
                result=self.server.routing.configure(payload)
            elif route=='/api/accounts/login':
                result=self.server.account_login.start(payload.get('kind'))
            elif route=='/api/accounts/authorize':
                result=self.server.account_login.authorize_claude(payload.get('account_id'))
            elif route=='/api/notifications':
                result={'settings':reports.set_settings(DATA,payload)}
            elif route=='/api/reports/plan':
                collector=self.server.collector
                with collector.lock:rows=collector.snapshot.get('account_quotas',[])
                saved=reports.set_plan(DATA,payload.get('account_id'),payload.get('plan'),payload.get('price'),{r['id'] for r in rows})
                collector.reports_value=None;collector.value_report.current=None
                result={'plan':saved}
            elif route=='/api/accounts/alias':
                collector=self.server.collector
                with collector.lock:
                    rows=collector.snapshot.get('account_quotas',[])
                    alias=account_aliases.set_alias(DATA,payload.get('account_id'),payload.get('alias'),{r['id'] for r in rows})
                    account_aliases.apply(rows,DATA)
                result={'alias':alias}
            else:result=self.server.controller.execute(payload)
            self.json_response(200,{'ok':True,**result})
        except (ValueError,TypeError):self.json_response(400,{'ok':False,'message':'잘못된 요청입니다.'})
        except ActionError as e:self.json_response(e.status,{'ok':False,'message':str(e)})
        except Exception:self.json_response(500,{'ok':False,'message':'동작을 확인하지 못했습니다. 터미널에서 현재 상태를 확인하세요.'})

    def json_response(self,status,payload):
        data=json.dumps(payload,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
        self.end_headers();self.wfile.write(data)

    def do_GET(self):
        host=self.headers.get('Host','').split(':')[0]
        if host not in ('127.0.0.1','localhost'):
            self.send_error(403);return
        route=urlsplit(self.path).path
        if route=='/api/routing':
            routing=getattr(self.server,'routing',None)
            self.json_response(200,routing.status() if routing else {'enabled':False,'running':False});return
        if route=='/api/usage-sessions':
            query=parse_qs(urlsplit(self.path).query)
            try:
                result=self.server.collector.usage_sessions(query.get('period',['1h'])[0],
                    query.get('offset',['0'])[0],query.get('limit',['100'])[0])
            except (ValueError,OverflowError,TypeError):
                self.json_response(400,{'ok':False,'message':'Invalid period or page'});return
            except sqlite3.Error:
                self.json_response(503,{'ok':False,'message':'Session archive is starting'});return
            self.json_response(200,result);return
        if route=='/api/history':
            history=getattr(self.server.collector,'history',None)
            if history is None:
                self.json_response(503,{'ok':False,'message':'History collector is starting'});return
            query=parse_qs(urlsplit(self.path).query)
            with self.server.collector.lock:snapshot=self.server.collector.snapshot
            try:
                result=history.response(query.get('period',['1h'])[0],query.get('step',['60'])[0],
                                        query.get('kind',[None])[0],snapshot)
            except (ValueError,OverflowError):
                self.json_response(400,{'ok':False,'message':'Invalid history period or step; maximum 400 bins'});return
            except sqlite3.Error:
                self.json_response(503,{'ok':False,'message':'History collector is starting'});return
            self.json_response(200,result);return
        if route=='/api/state':
            period = parse_qs(urlsplit(self.path).query).get('period', [None])[0]
            if period is not None:
                try:snapshot=self.server.collector.state_for_period(period)
                except ValueError:
                    self.json_response(400,{'ok':False,'message':'유효한 기간을 입력하세요. 최소 10분입니다.'});return
                except (sqlite3.Error,OSError):
                    self.json_response(503,{'ok':False,'error':'state_temporarily_unavailable'});return
            else:
                with self.server.collector.lock:snapshot=self.server.collector.snapshot
            snapshot=self.server.controller.decorate(snapshot)
            snapshot=ordered_snapshot(snapshot, period or '1h')
            bridge = getattr(self.server, 'bridge', None)
            if bridge:
                snapshot = {**snapshot, 'workspace_usage': bridge.workspace_usage}
            data=json.dumps({**snapshot,'action_token':self.server.action_token},ensure_ascii=False).encode()
            mime='application/json; charset=utf-8'
        elif route=='/api/notifications':
            self.json_response(200,{'ok':True,'settings':reports.read_settings(DATA)});return
        elif route=='/api/telemetry':
            telemetry=getattr(self.server.collector,'telemetry',None)
            self.json_response(200,telemetry.snapshot() if telemetry else {'ready':False});return
        elif route=='/api/updates':
            self.json_response(200,getattr(self.server,'updates',None).value if getattr(self.server,'updates',None) else {});return
        elif route in ('/','/index.html','/app.js','/style.css','/maps.js','/ranges.js','/speed.js','/weekly.js','/history.js','/maps.css','/typography.css','/benchmark.json','/dashboard.js','/dashboard.css','/i18n.js','/effects.js','/conversation.js','/quick.html','/quick.js','/quick.css','/cluster.js','/cluster.css','/cluster-pages.js','/layout.js','/customize.js','/reports.js','/cluster-themes.js',
                       '/themes/core.js','/themes/catalog.json','/themes/mini.json','/themes/pairs.js','/themes/compact.js','/themes/t01-06.js','/themes/t07-17.js','/themes/t18-28.js','/themes/t29-39.js','/themes/t40-50.js','/themes/t51-61.js','/themes/t62-72.js'):
            name='index.html' if route=='/' else route[1:]
            data=(BASE/'dist'/name).read_bytes()
            mime={'html':'text/html','js':'application/javascript','css':'text/css','json':'application/json'}[name.rsplit('.',1)[1]]+'; charset=utf-8'
        elif route=='/brand-mark_v1.1.0.png':
            data=(BASE/'dist'/'brand-mark_v1.1.0.png').read_bytes()
            mime='image/png'
        elif route in {f'/fonts/ibm-plex/v1.0.0/{name}.woff2' for name in (
            'IBMPlexSans', 'IBMPlexSansKR-Regular', 'IBMPlexSansKR-Medium',
            'IBMPlexSansKR-SemiBold', 'IBMPlexSansKR-Bold') }:
            data=(BASE/'dist'/route[1:]).read_bytes()
            mime='font/woff2'
        elif route=='/health':
            self.json_response(200,{'ok':True,'app':'1top','version':__version__,
                                    'ready':self.server.collector.snapshot.get('ready',False)})
            return
        else:self.send_error(404);return
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(data)

    def log_message(self,*args):pass


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=18765);args=ap.parse_args()
    collector=Collector()
    server=DashboardHTTPServer(('127.0.0.1',args.port),Handler)
    server.collector=collector
    server.action_token=secrets.token_urlsafe(32)
    from .account_login import AccountLogin
    server.account_login=AccountLogin()
    server.controller=Controller(collector,Collector,state_file=DATA/'controls-v5.json')
    collector.controller=server.controller
    threading.Thread(target=collector.loop,daemon=True).start()
    print(f'1top v{__version__} http://127.0.0.1:{args.port}',flush=True)
    server.serve_forever()


if __name__=='__main__':main()
