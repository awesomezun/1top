"""Read-only Aside session adapter. Prompt bodies never leave their transcript files."""
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
import psutil

ACTIVE={'running','working','streaming','executing'}

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
                source=conn.execute('''SELECT id,title,status,model,cwd,created_at,updated_at
                    FROM sessions WHERE archived_at IS NULL AND incognito=0 AND ephemeral=0
                    AND (updated_at>? OR status IN ('running','working','streaming','executing','waiting'))
                    ORDER BY updated_at DESC LIMIT 100''',(now-86400,)).fetchall()
            finally:conn.close()
            paths={p.parent.name.rsplit('_',1)[-1]:str(p) for p in (db.parent/'sessions').glob('*/messages.jsonl')}
            for sid,title,status,model,cwd,created,updated in source:
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}',sid):continue
                try:configuration=json.loads(model)
                except ValueError:configuration={}
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
        except (OSError,sqlite3.Error):continue
    return rows


def resolve(sid,key):
    return next((s for s in discover() if s['id']==sid and s.get('control_key')==key),None)
