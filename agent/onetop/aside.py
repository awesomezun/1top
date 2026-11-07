"""Read-only Aside session adapter. Prompt bodies never leave their transcript files."""
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
import psutil
from .effort import level
from .hierarchy import annotate
from .accounts import identity, read_json

ACTIVE={'running','working','streaming','executing'}
PROVIDERS={'openai-codex':'Codex','claude-code':'Claude','zai':'GLM','google':'Antigravity'}

def billing_accounts(directory):
    """Read identity metadata only. Never return or refresh provider credentials."""
    credentials=read_json(directory/'credentials.json')
    codex=credentials.get('openai-codex')
    account=codex.get('accountId') if isinstance(codex,dict) else None
    return {'openai-codex':identity('Codex',account)} if isinstance(account,str) and account.strip() else {}

def cli_path(home=None):
    return (home or Path.home())/'.aside/cli/Aside CLI.app/Contents/MacOS/aside'

def discover(home=None,now=None,running=None):
    home=home or Path.home();now=now or time.time();rows=[]
    if running is None:
        running=any(p.info.get('name')=='aside-daemon' for p in psutil.process_iter(['name']))
    for db in sorted((home/'.aside/u').glob('*/state.db'))[:12]:
        if not db.parent.name.isdigit():continue
        try:
            conn=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,timeout=.2)
            try:
                conn.execute('PRAGMA query_only=ON')
                columns={r[1] for r in conn.execute('PRAGMA table_info(sessions)')}
                parent_column='parent_id' if 'parent_id' in columns else 'NULL'
                trigger_column='trigger' if 'trigger' in columns else 'NULL'
                select=f'SELECT id,title,status,model,cwd,created_at,updated_at,{parent_column},{trigger_column} FROM sessions '
                public='archived_at IS NULL AND incognito=0 AND ephemeral=0'
                source=conn.execute(select+f'''WHERE {public}
                    AND (updated_at>? OR status IN ('running','working','streaming','executing','waiting'))
                    ORDER BY updated_at DESC LIMIT 100''',(now-86400,)).fetchall()
                # Include recorded ancestors even when their last update is older
                # than the recent-session list. Never include private/archived rows.
                seen={r[0] for r in source}
                for _ in range(32):
                    missing={r[7] for r in source if r[7] and r[7] not in seen}
                    if not missing or len(source)>=250:break
                    found=[]
                    for sid in sorted(missing)[:250-len(source)]:
                        seen.add(sid)
                        parent=conn.execute(select+f'WHERE {public} AND id=?',(sid,)).fetchone()
                        if parent:found.append(parent)
                    if not found:break
                    source.extend(found)
            finally:conn.close()
            accounts=billing_accounts(db.parent)
            paths={p.parent.name.rsplit('_',1)[-1]:str(p) for p in (db.parent/'sessions').glob('*/messages.jsonl')}
            for sid,title,status,model,cwd,created,updated,parent,trigger in source:
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}',sid):continue
                try:configuration=json.loads(model)
                except (ValueError,TypeError):configuration={}
                if not isinstance(configuration,dict):configuration={}
                try:origin=json.loads(trigger or '{}')
                except (ValueError,TypeError):origin={}
                if not isinstance(origin,dict):origin={}
                parent=parent if isinstance(parent,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}',parent) and parent!=sid else None
                key=hashlib.sha256(f'{db}:{sid}:{created}'.encode()).hexdigest()
                display='working' if status in ACTIVE and running else 'waiting' if status=='waiting' and running else 'idle' if status=='idle' else 'interrupted' if status in ('aborted','interrupted') else 'unknown'
                rows.append({'id':f'aside:{db.parent.name}:{sid}','kind':'Aside','cwd':cwd or str(home),'title':title,
                    'project':Path(cwd).name or 'Aside','status':display,'status_at':updated,'pids':[],'pid':None,
                    'configured_model':configuration.get('modelId',''),'provider':configuration.get('provider',''),
                    'path':paths.get(sid),'connected':running,'process_started':None,'process_birth':None,
                    'control_key':key if running else None,'orca_terminal':None,'input_verified':False,
                    'location':{'app':'Aside','app_path':'/Applications/Aside.app','terminal':'Aside 내부 세션','match':'aside_database'},
                    'source':'Aside local session database and per-request usage reports',
                    'terminal_note':'Aside 내부 세션 · 터미널 CLI가 아님 · 바로가기는 Aside 앱 열기',
                    'note':'최근 24시간 저장 세션 또는 작업 중 세션 · 제공자 토큰 보고 · 개별 프로세스 자원 미귀속',
                    'aside_account':'u'+db.parent.name,'aside_session':sid,'native_status':status})
                rows[-1].update(is_subagent=bool(parent) or origin.get('type')=='subagent',
                    parent_session_id=f'aside:{db.parent.name}:{parent}' if parent else None,
                    billing_kind=PROVIDERS.get(configuration.get('provider')),
                    billing_account=accounts.get(configuration.get('provider')))
                effort = level(configuration.get('thinkingLevel'))
                if effort and configuration.get('modelId'):
                    rows[-1].update(effort=effort, effort_model=configuration['modelId'],
                                    effort_source='aside_session_configuration', effort_updated=updated)
        except (OSError,sqlite3.Error):continue
    return annotate(rows)


def resolve(sid,key):
    return next((s for s in discover() if s['id']==sid and s.get('control_key')==key),None)
