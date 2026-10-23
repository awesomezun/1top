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
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from .controls import Controller, ActionError, target_key, process_start
from .resources import ResourceSampler
from .usage import session_usage, window_usage, WINDOWS
from .discovery import inventory, context, applications, orca_executable
from . import __version__

BASE = Path(__file__).resolve().parent
HOME = Path.home()
DATA = Path(os.environ.get('ONETOP_DATA',os.environ.get('AGENT_MONITOR_DATA',str(HOME/'Library/Application Support/1top'))))
KINDS = ['Claude', 'Codex', 'GLM', 'Antigravity']
ZERO = [0, 0, 0, 0]  # fresh input, cache read, cache write, output


def epoch(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e12 else value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return 0


def run(args, timeout=8):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout)


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
    if payload.get('success') is not True or payload.get('code',0) not in (0,200):return []
    windows=[]
    for w in (payload.get('data') or {}).get('limits',[]):
        if w.get('type') not in ('TOKENS_LIMIT','CREDIT_LIMIT'):continue
        pct=w.get('percentage')
        cap=w.get('usage')
        if isinstance(cap,(int,float)) and cap>0:
            current=w.get('currentValue')
            if current is None and isinstance(w.get('remaining'),(int,float)):current=cap-w['remaining']
            if isinstance(current,(int,float)):pct=current/cap*100
        if not isinstance(pct,(int,float)):continue
        mins={1:1440,3:60,5:1,6:10080}.get(w.get('unit'),0)*(w.get('number') or 0)
        reset=epoch(w.get('nextResetTime'))
        label='5시간' if mins==300 else '주간' if mins==10080 else f'{mins//60}시간' if mins else '플랜 한도'
        windows.append({'label':label,'pct':min(100,max(0,pct)) if not reset or reset>now else None,'reset':reset,'t':now})
    return windows


def terminal_for(meta, terminals):
    """Join a process to a live Orca tab by identity, never by its directory."""
    for field, key in [('orca_handle','handle'),('orca_tab','tabId')]:
        matches=[t for t in terminals if meta.get(field) and t.get(key)==meta[field]]
        if len(matches)==1:
            t=matches[0]
            return {k:t.get(k) for k in ('handle','tabId','title','worktreePath','incarnationId')}
    return None


def pane_thread_name(title, cwd):
    suffix=' | '+Path(cwd).name
    if not title.endswith(suffix):return None
    name=title[:-len(suffix)]
    # Codex decorates the stable thread name with a Braille activity spinner.
    return re.sub(r'^[\u2800-\u28ff]\s+', '', name)


def bind_terminal(spec, metadata, terminals, pane_titles, specs):
    pids=spec['pids']
    source='프로세스의 Orca 터미널 ID'
    if spec['kind']=='Codex' and not spec.get('process_only'):
        name=spec.get('thread_name')
        unique=name and sum(s.get('thread_name')==name and s['cwd']==spec['cwd']
                            for s in specs if s['kind']=='Codex')==1
        matches=[pid for pid in pids if unique and
                 pane_thread_name(pane_titles.get(metadata.get(pid,{}).get('tmux_pane'),''),spec['cwd'])==name]
        # A shared backend's environment belongs to only one of its clients.
        # Never attach that terminal to every thread, or pick a same-directory client.
        if len(matches)!=1:
            spec.update(orca_terminal=None,terminal_match='unverified',
                        terminal_note='세션과 터미널 화면 제목의 고유한 일치를 확인하지 못했습니다.')
            return
        pids=matches
        source='Codex 세션명·프로젝트와 터미널 화면 제목의 고유한 일치 → Orca 터미널 ID'
        spec['pids']=matches
    meta=metadata.get(pids[0],{}) if len(pids)==1 else {}
    terminal=terminal_for(meta,terminals)
    spec.update(orca_terminal=terminal,terminal_match='confirmed' if terminal else 'unavailable',
                terminal_note=source if terminal else '프로세스는 실행 중이지만 현재 Orca 탭 목록에서 연결을 확인하지 못했습니다.')


class Ledger:
    """Deduplicate streamed Claude message revisions and cumulative Codex reports."""
    def __init__(self, kind, state=None):
        self.s = state or {'kind': kind, 'offset': 0, 'inode': None, 'total': ZERO[:],
                           'seen': {}, 'models': [], 'last_usage': 0, 'model': '',
                           'status': 'unknown', 'status_at': 0, 'known': False}

    def consume(self, d):
        s = self.s
        t = epoch(d.get('timestamp'))
        p = d.get('payload') or {}
        if s['kind'] == 'Codex':
            if d.get('type') == 'turn_context':
                s['model'] = p.get('model') or s['model']
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
                    u = info.get('total_token_usage')
                    if not u:
                        return None
                    v = vector(u, True)
                    old = s['total']
                    was_known = s['known']
                    # A decreasing cumulative counter is a reset, never negative spend.
                    reset = was_known and any(a < b for a, b in zip(v, old))
                    delta = [max(0, a-b) for a,b in zip(v, old)] if was_known and not reset else ZERO[:]
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
        if model:
            s['model'] = model
            if model not in s['models']:
                s['models'].append(model)
        if sum(delta):
            s['last_usage'] = max(s['last_usage'], t)
            s['request_input'] = sum(v[:3])
        return (t, delta) if sum(delta) else None


class Collector:
    def __init__(self):
        self.lock = threading.Lock()
        self.snapshot = {'ready': False, 'updated': 0, 'sessions': [], 'error': None}
        self.agy_quota = {'kind': 'Antigravity', 'windows': [], 'note': '한도 확인 중', 'updated': 0}
        self.glm_quota = {'kind': 'GLM', 'windows': [], 'note': '연결된 GLM 계정 한도 확인 중', 'updated': 0}
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

    def initialize(self):
        DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(DATA/'monitor.sqlite')
        self.db.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS trackers (path TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t REAL, sid TEXT, kind TEXT,
                fresh INTEGER, cached INTEGER, written INTEGER, output INTEGER);
            CREATE INDEX IF NOT EXISTS event_time ON events(t);''')
        row = self.db.execute("SELECT value FROM meta WHERE key='started'").fetchone()
        self.started = float(row[0]) if row else time.time()
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('started',?)", (str(self.started),))
        self.db.commit()

    def processes(self):
        rows = {}
        for line in run(['ps','-axo','pid=,ppid=,tty=,rss=,pcpu=,lstart=,comm=']).splitlines():
            p = line.split(None, 10)
            if len(p) != 11:
                continue
            name = os.path.basename(p[10]).lower()
            if name not in ('claude','codex','agy') or int(p[1]) == os.getpid():
                continue
            pid = int(p[0])
            try:birth=psutil.Process(pid).create_time()
            except psutil.Error:continue
            rows[pid] = {'pid': pid, 'ppid': int(p[1]), 'tty': p[2], 'rss': int(p[3])/1024,
                         'cpu': float(p[4]), 'exe': name, 'started':' '.join(p[5:10]),'birth':birth}
        return rows

    def metadata(self, process):
        pid = process['pid']
        if pid not in self.process_cache or self.process_cache[pid].get('started')!=process.get('started') or self.process_cache[pid].get('birth')!=process.get('birth'):
            info = {'provider': '', 'configured_model': '', 'config_dir': str(HOME/'.claude')}
            info['started']=process.get('started')
            info['birth']=process.get('birth')
            try:
                raw = run(['ps','eww','-p',str(pid),'-o','command='])
                # Deliberately whitelist metadata. Credentials never leave this function.
                safe_ids={'ORCA_TERMINAL_HANDLE':'orca_handle','ORCA_TAB_ID':'orca_tab','TMUX_PANE':'tmux_pane'}
                for key in ('ANTHROPIC_BASE_URL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_MODEL','CLAUDE_CONFIG_DIR',*safe_ids):
                    match = re.search(r'(?:^|\s)'+key+r'=([^\s]*)',raw)
                    if match:
                        val = match.group(1)
                        if key in safe_ids:
                            info[safe_ids[key]]=val
                        elif key.endswith('BASE_URL'):
                            info['provider'] = urlsplit(val).hostname or ''
                        elif key == 'CLAUDE_CONFIG_DIR':
                            info['config_dir'] = val
                        else:
                            info['configured_model'] = val
                del raw
            except (OSError, subprocess.SubprocessError):
                pass
            self.process_cache[pid] = info
        return self.process_cache[pid]

    def discover(self):
        processes = self.processes()
        self.process_cache = {k:v for k,v in self.process_cache.items() if k in processes}
        specs, counts = [], collections.Counter()
        cwds, open_logs = {}, {}
        if processes:
            try:
                raw = run(['lsof','-p',','.join(map(str,processes)),'-Fn'], timeout=10)
                pid, fd = None, ''
                for l in raw.splitlines():
                    if l.startswith('p') and l[1:].isdigit():
                        pid = int(l[1:])
                    elif l.startswith('f'):
                        fd = l[1:]
                    elif l.startswith('n'):
                        if fd == 'cwd':
                            cwds[pid] = l[1:]
                        if '/.codex/' in l and l.endswith('.jsonl') and '/sessions/' in l:
                            open_logs[l[1:]] = pid
            except (OSError, subprocess.SubprocessError):
                pass
        if time.time() - self.index_at > 60:
            self.index = {p.stem: str(p) for p in (HOME/'.claude/projects').glob('*/*.jsonl')}
            self.index_at = time.time()
        for pid, p in processes.items():
            if p['exe'] == 'codex':
                if p['tty'] != '??':
                    counts['Codex'] += 1
                    self.metadata(p)
                continue
            meta = self.metadata(p)
            kind = 'Antigravity' if p['exe']=='agy' else ('GLM' if meta['provider'] in ('api.z.ai','open.bigmodel.cn') or meta['configured_model'].lower().startswith('glm') else 'Claude')
            counts[kind] += 1
            reg = {}
            try:
                reg = json.loads((Path(meta['config_dir'])/'sessions'/f'{pid}.json').read_text())
            except (OSError, ValueError):
                pass
            sid = reg.get('sessionId') or f'process-{pid}'
            cwd = cwds.get(pid) or reg.get('cwd') or ''
            path = self.index.get(sid)
            spec = {'id': sid, 'kind': kind, 'cwd': cwd, 'title': reg.get('name') or Path(cwd).name,
                    'pid': pid, 'pids': [pid], 'cpu': p['cpu'], 'rss': round(p['rss']),
                    'status': reg.get('status','unknown'), 'status_at': epoch(reg.get('statusUpdatedAt')),
                    'waiting_for': reg.get('waitingFor'), 'path': path,
                    'configured_model': meta['configured_model'], 'provider': meta['provider'],
                    'source': 'Claude Code 세션 레지스트리' if reg else 'macOS 프로세스', 'connected': True}
            if kind == 'Antigravity':
                spec['note'] = '실행 상태는 확인됩니다. 이 설치의 대화 DB에는 검증된 토큰 필드가 없어 세션 토큰은 표시하지 않습니다.'
            elif not path:
                spec['note'] = '열린 프로세스는 확인되지만 해당 세션의 대화 기록을 찾지 못했습니다.'
            specs.append(spec)
        records = {}
        try:
            dbpath = max((HOME/'.codex').glob('state_*.sqlite'), key=lambda p:p.stat().st_mtime)
            with sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True,timeout=1) as db:
                columns={r[1] for r in db.execute('PRAGMA table_info(threads)')}
                name_column='name' if 'name' in columns else 'NULL'
                for r in db.execute(f'SELECT id,rollout_path,cwd,title,model,{name_column} FROM threads WHERE archived=0'):
                    if r[1] in open_logs:
                        records[r[1]] = r
        except (OSError, ValueError, sqlite3.Error):
            pass
        for path, owner in open_logs.items():
            r = records.get(path)
            if not r:
                try:
                    with open(path) as f:
                        p = json.loads(f.readline()).get('payload',{})
                    r = (p.get('id',Path(path).stem),path,p.get('cwd',''),'',None,None)
                except (OSError, ValueError):
                    continue
            matching = [p['pid'] for p in processes.values() if p['exe']=='codex' and p['tty']!='??' and cwds.get(p['pid'])==r[2]]
            title = (r[5] or r[3] or '').split('\n',1)[0][:90]
            if title.startswith(('# AGENTS','<','You are')):
                title = Path(r[2]).name
            specs.append({'id':r[0], 'path':path, 'kind':'Codex', 'cwd':r[2], 'title':title or Path(r[2]).name,
                          'thread_name':r[5],
                          'configured_model':r[4] or '', 'pid':owner, 'pids':matching, 'cpu':None, 'rss':None,
                          'status':'unknown', 'status_at':0, 'connected':True,
                          'source':'Codex 백엔드가 열고 있는 세션 기록',
                          'note':'여러 CLI가 한 백엔드를 공유할 수 있습니다. 세션 수와 CLI 프로세스 수는 다를 수 있습니다.'})
        try:
            r = json.loads(run([orca_executable(),'terminal','list','--json'],timeout=5))['result']
            self.terminals=r.get('terminals',[])
            self.terminal_count = r.get('totalCount',len(r.get('terminals',[])))
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            self.terminals=[]
            self.terminal_count = None
        pane_titles={}
        try:
            raw=run(['tmux','list-panes','-a','-F','#{pane_id}\t#{pane_title}'],timeout=3)
            pane_titles=dict(line.split('\t',1) for line in raw.splitlines() if '\t' in line)
        except (OSError, ValueError, subprocess.SubprocessError):pass
        for spec in specs:
            bind_terminal(spec,self.process_cache,self.terminals,pane_titles,specs)
            if len(spec['pids'])==1 and spec['terminal_match']!='unverified':
                spec['process_started']=processes[spec['pids'][0]]['started']
                spec['process_birth']=processes[spec['pids'][0]]['birth']
                spec['control_key']=target_key(spec)
        attached={pid for s in specs if s.get('control_key') for pid in s['pids']}
        for pid,p in processes.items():
            if p['exe']!='codex' or p['tty']=='??' or pid in attached:continue
            cwd=cwds.get(pid,'');meta=self.process_cache.get(pid,{})
            name=pane_thread_name(pane_titles.get(meta.get('tmux_pane'),''),cwd)
            spec={'id':f'process-codex-{pid}','kind':'Codex','cwd':cwd,'title':name or 'Codex 세션 연결 미확인',
                  'pid':pid,'pids':[pid],'path':None,'configured_model':'','cpu':None,'rss':None,
                  'status':'unknown','status_at':0,'connected':True,'process_only':True,
                  'source':'macOS CLI 프로세스 · 세션 기록 연결 미확인',
                  'note':'터미널과 CLI 실행은 확인됐지만 대화 세션 ID·토큰 기록의 연결은 아직 확인되지 않았습니다.'}
            bind_terminal(spec,self.process_cache,self.terminals,pane_titles,specs)
            spec['process_started']=p['started'];spec['process_birth']=p['birth'];spec['control_key']=target_key(spec);specs.append(spec)
        self.shared_roots=[pid for pid,p in processes.items() if p['exe']=='codex' and p['tty']=='??']
        handles=collections.defaultdict(set)
        for spec in specs:
            if spec.get('orca_terminal') and spec.get('control_key'):
                handles[spec['orca_terminal']['handle']].update(spec['pids'])
        for spec in specs:
            term=spec.get('orca_terminal') or {}
            spec['input_verified']=bool(len(spec['pids'])==1 and term and
                processes[spec['pids'][0]]['tty']!='??' and len(handles[term['handle']])==1)
        self.app_inventory=inventory()
        self.apps=applications(self.app_inventory)
        tracked={pid for spec in specs for pid in spec['pids']}
        for spec in specs:
            spec['location']=context(spec['pids'][0],self.app_inventory) if len(spec['pids'])==1 else {'app':'Unknown','terminal':'','match':'unverified'}
        for pid,row in self.app_inventory.items():
            if not row['kind'] or pid in tracked:continue
            parent=row['ppid'];visited=set();nested=False
            while parent in self.app_inventory and parent not in visited:
                visited.add(parent)
                if parent in tracked:nested=True;break
                parent=self.app_inventory[parent]['ppid']
            if nested:continue
            # Observe unsupported CLI resources without inventing token usage or pause semantics.
            specs.append({'id':f'cli-{pid}-{row["birth"]}', 'kind':row['kind'], 'cwd':row['cwd'],
                'title':row['kind'], 'pid':pid, 'pids':[pid], 'path':None, 'configured_model':'',
                'status':'unknown','status_at':0,'connected':True,'process_only':True,
                'process_birth':row['birth'],'location':context(pid,self.app_inventory),
                'source':'CLI executable and process ancestry','note':'CLI detected. Token and turn-control adapter not available yet.'})
            specs[-1]['process_started']=process_start(pid)
            if specs[-1]['process_started']:specs[-1]['control_key']=target_key(specs[-1])
            counts[row['kind']]+=1
        self.specs, self.process_counts = specs, dict(counts)
        self.discovery_at = time.time()

    def read_tracker(self, spec):
        path = spec['path']
        if path not in self.trackers:
            row = self.db.execute('SELECT data FROM trackers WHERE path=?',(path,)).fetchone()
            self.trackers[path] = Ledger(spec['kind'],json.loads(row[0]) if row else None)
        tracker = self.trackers[path]
        s = tracker.s
        st = os.stat(path)
        if (s['inode'] is not None and s['inode'] != st.st_ino) or st.st_size < s['offset']:
            tracker = self.trackers[path] = Ledger(spec['kind'])
            s = tracker.s
        s['inode'] = st.st_ino
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
                    interesting = b'"usage"' in line or b'"token_count"' in line or b'"turn_context"' in line or b'"event_msg"' in line
                    if interesting:
                        try:
                            event = tracker.consume(json.loads(line))
                            if event and event[0]>=self.started:
                                t,v=event
                                self.db.execute('INSERT INTO events(t,sid,kind,fresh,cached,written,output) VALUES(?,?,?,?,?,?,?)',
                                                (t,spec['id'],spec['kind'],*v))
                        except (ValueError, TypeError, KeyError):
                            pass
                s['offset'] = f.tell()
            self.db.execute('INSERT OR REPLACE INTO trackers VALUES (?,?)',(path,json.dumps(s,separators=(',',':'))))
        spec['loading'] = s['offset'] < st.st_size
        spec['progress'] = round(100*s['offset']/max(1,st.st_size))
        spec['tokens'] = s['total'] if s['known'] and not spec['loading'] else None
        spec['model'] = s['model'] or spec.get('configured_model','')
        spec['models'] = s.get('models',[])
        spec['last_usage'] = s['last_usage']
        spec['request_input'] = s.get('request_input')
        spec['context_size'] = s.get('context_size')
        spec['quota'] = s.get('quota')
        spec['counter_reset'] = s.get('counter_reset',False)
        if spec['kind']=='Codex':
            spec['status'],spec['status_at']=s['status'],s['status_at']
        if not spec['loading'] and not s['known']:
            spec['note']='대화 기록에 유효한 사용량 보고가 없습니다. 0으로 간주하지 않습니다.'

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
        with self.lock:
            out.append(dict(self.glm_quota))
            out.append(dict(self.agy_quota))
        return out

    def collect(self):
        collect_started=time.monotonic()
        if time.time()-self.discovery_at>9:
            self.discover()
        now=time.time()
        sessions=[]
        for src in self.specs:
            s=dict(src)
            s.update(tokens=None,model=s.get('configured_model',''),last_usage=0,loading=False)
            if s['path']:
                try:self.read_tracker(s)
                except OSError:s['note']='세션 기록을 읽을 수 없습니다.'
            # Registry states are reported, not inferred from CPU or a refreshing terminal clock.
            if s['status'] not in ('working','idle','waiting','interrupted'):
                s['status']='unknown'
            s['project']=Path(s['cwd']).name or '알 수 없음'
            sessions.append(s)
        self.db.execute('DELETE FROM events WHERE t<?',(now-86400,))
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
        for s in sessions:
            known=s['tokens'] is not None
            v=minute.get(s['id'],ZERO[:]) if known else None
            s['usage']={'last_minute':v,'last_five_minutes':five.get(s['id'],ZERO[:]) if known else None,
                        'rate':sum(v)/window if v is not None else None,
                        'output_rate':v[3]/window if v is not None else None,
                        'window_seconds':window,'history':history.get(s['id'],[]),
                        'windows':{key:session_periods.get(s['id'],{}).get(key,ZERO[:]) if known else None
                                   for key,_,_ in WINDOWS}}
        if self.resources is None:self.resources=ResourceSampler()
        system=self.resources.sample(sessions,self.shared_roots)
        result={'ready':True,'version':__version__,'updated':now,'started':self.started,'sessions':sessions,
                'events':events,'recent':recent,'period_usage':periods,'quotas':quotas,'process_counts':self.process_counts,
                'orca_terminals':self.terminal_count,'error':None,'poll_seconds':3,
                'applications':getattr(self,'apps',[]),'system':system,'collection_ms':round((time.monotonic()-collect_started)*1000,1)}
        with self.lock:self.snapshot=result

    def loop(self):
        self.initialize()
        while True:
            before=time.monotonic()
            try:self.collect()
            except Exception as e:
                # No raw exception messages: paths and tool responses can contain private text.
                with self.lock:self.snapshot={**self.snapshot,'error':type(e).__name__}
                command = os.path.basename(e.cmd[0]) if isinstance(e,subprocess.TimeoutExpired) and isinstance(e.cmd,list) else ''
                print('collector:',type(e).__name__,command,flush=True)
            time.sleep(max(.2,3-(time.monotonic()-before)))

    def agy_loop(self):
        exe=HOME/'.local/bin/agy'
        if not exe.exists():return
        try:
            version=run([str(exe),'--version'],5).strip()
            if tuple(map(int,version.split('.')[:3]))<(1,1,11):return
        except Exception:return
        while True:
            q={'kind':'Antigravity','windows':[],'updated':time.time(),'note':'공식 한도를 확인하지 못했습니다.'}
            try:
                env={**os.environ,'AGY_CLI_DISABLE_AUTO_UPDATE':'true'}
                p=subprocess.run([str(exe),'-p','/usage','--output-format','json','--print-timeout','20s'],
                                 env=env,cwd=str(HOME),capture_output=True,text=True,timeout=28)
                for line in p.stdout.splitlines():
                    try:e=json.loads(line)
                    except ValueError:continue
                    if e.get('num_turns',0)>0 or e.get('conversation_id'):
                        q['note']='이 CLI에서는 안전한 한도 조회를 확인하지 못해 자동 조회를 중단했습니다.'
                        with self.lock:self.agy_quota=q
                        return
                    cmd=e.get('command') or {}
                    if e.get('status')!='SUCCESS' or cmd.get('name')!='usage':continue
                    for group in (cmd.get('data') or {}).get('groups',[]):
                        for b in group.get('buckets',[]):
                            if b.get('disabled') or not isinstance(b.get('remaining_fraction'),(int,float)):continue
                            reset=epoch(b.get('reset_time'))
                            q['windows'].append({'label':group.get('name','')+' · '+('주간' if b.get('window')=='weekly' else b.get('window','')),
                                                 'pct':max(0,min(100,(1-b['remaining_fraction'])*100)) if reset>time.time() else None,
                                                 'reset':reset,'t':q['updated']})
                    if q['windows']:q['note']='agy /usage 공식 한도 · 10분마다 확인'
            except (OSError,subprocess.SubprocessError):pass
            with self.lock:self.agy_quota=q
            time.sleep(600)

    def glm_loop(self):
        while True:
            specs=[s for s in self.specs if s['kind']=='GLM']
            if not specs:
                time.sleep(5);continue
            q={'kind':'GLM','windows':[],'updated':0,'note':'공식 한도를 확인하지 못했습니다. 세션 토큰은 계속 수집합니다.'}
            try:
                # Use the active session's existing credential only with its allowlisted provider.
                raw=run(['ps','eww','-p',str(specs[0]['pid']),'-o','command='])
                host=specs[0].get('provider')
                match=re.search(r'(?:^|\s)ANTHROPIC_AUTH_TOKEN=([^\s]+)',raw)
                if not match:match=re.search(r'(?:^|\s)ANTHROPIC_API_KEY=([^\s]+)',raw)
                if match and host in ('api.z.ai','open.bigmodel.cn'):
                    key=match.group(1)
                    if '\n' in key or '\r' in key:raise ValueError('Invalid credential')
                    header=key.replace('\\','\\\\').replace('"','\\"')
                    config=f'url = "https://{host}/api/monitor/usage/quota/limit"\nheader = "Authorization: {header}"\nheader = "Accept-Language: en-US,en"\n'
                    result=subprocess.run(['/usr/bin/curl','--silent','--show-error','--fail','--max-time','15','--config','-'],
                                          input=config,capture_output=True,text=True,timeout=18)
                    del key,header,config,raw
                    if result.returncode==0:
                        payload=json.loads(result.stdout)
                        q['windows']=glm_windows(payload,time.time())
                        if q['windows']:
                            q['updated']=time.time();q['note']='실행 중인 GLM 세션의 계정 · 공식 API · 2분마다 확인'
            except (OSError,ValueError,subprocess.SubprocessError):pass
            with self.lock:self.glm_quota=q
            time.sleep(120)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        host=self.headers.get('Host','')
        allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if (host not in allowed or self.headers.get('Origin')!='http://'+host or
            not secrets.compare_digest(self.headers.get('X-Monitor-Token',''),self.server.action_token)):
            self.send_error(403);return
        if urlsplit(self.path).path!='/api/action':self.send_error(404);return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>4096 or self.headers.get('Content-Type')!='application/json':
                self.send_error(400);return
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):raise ValueError()
            result=self.server.controller.execute(payload)
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
        if route=='/api/state':
            with self.server.collector.lock:snapshot=self.server.collector.snapshot
            snapshot=self.server.controller.decorate(snapshot)
            data=json.dumps({**snapshot,'action_token':self.server.action_token},ensure_ascii=False).encode()
            mime='application/json; charset=utf-8'
        elif route in ('/','/index.html','/app.js','/style.css','/benchmark.json'):
            name='index.html' if route=='/' else route[1:]
            data=(BASE/'dist'/name).read_bytes()
            mime={'html':'text/html','js':'application/javascript','css':'text/css','json':'application/json'}[name.rsplit('.',1)[1]]+'; charset=utf-8'
        elif route=='/health':
            data=b'{"ok":true,"version":"1.0.0"}';mime='application/json'
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
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.collector=collector
    server.action_token=secrets.token_urlsafe(32)
    server.controller=Controller(collector,Collector,state_file=DATA/'controls-v5.json')
    threading.Thread(target=collector.loop,daemon=True).start()
    threading.Thread(target=collector.agy_loop,daemon=True).start()
    threading.Thread(target=collector.glm_loop,daemon=True).start()
    print(f'1top v1.0.0 http://127.0.0.1:{args.port}',flush=True)
    server.serve_forever()


if __name__=='__main__':main()
