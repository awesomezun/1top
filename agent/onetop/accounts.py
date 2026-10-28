"""Local account-scoped limits. Only 1top-enrolled profiles may refresh their login."""
import base64
import copy
import hashlib
import json
import queue
from .platform_support import cli_command
import math
import os
import selectors
import shutil
import ssl
import subprocess
import threading
import time
import unicodedata
import getpass
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

import certifi
import psutil
from .account_login import managed_profiles_dir
from .claude_profiles import CredentialError, keychain_document, refresh_managed


def read_json(path):
    try:
        if path.stat().st_size > 8 * 1024 * 1024:return {}
        value=json.loads(path.read_text())
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}


def timestamp(value):
    if isinstance(value,(float,int)) and math.isfinite(value):return value/1000 if value>1e12 else value
    try:return datetime.fromisoformat(str(value).replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError):return 0


def pct(value):
    return max(0,min(100,value)) if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) else None


def window(label,value,reset,now):
    reset=timestamp(reset)
    return {'label':label,'pct':pct(value) if not reset or reset>now else None,'reset':reset}


def identity(kind,account,workspace=''):
    return kind.lower()+':'+hashlib.sha256((str(account)+'|'+str(workspace)).encode()).hexdigest()[:20]


def claude_windows(payload,now):
    return [window(label,(payload.get(key) or {}).get('utilization'),(payload.get(key) or {}).get('resets_at'),now)
            for key,label in [('five_hour','5H'),('seven_day','주간')]]


def codex_windows(result,now):
    snapshots=result.get('rateLimitsByLimitId') or {}
    snap=snapshots.get('codex') or result.get('rateLimits') or {}
    # Never replace the main allowance with a model-specific limit.
    if not isinstance(snap,dict) or snap.get('limitId') not in (None,'codex'):snap={}
    found={};unrecognized=False
    for key in ('primary','secondary'):
        w=snap.get(key)
        if w is None:continue
        if not isinstance(w,dict):unrecognized=True;continue
        minutes=w.get('windowDurationMins')
        label={300:'5H',10080:'주간'}.get(minutes)
        if label:found[label]=window(label,w.get('usedPercent'),w.get('resetsAt'),now)
        else:unrecognized=True
    # A recognized main allowance snapshot defines its applicable windows.
    # Weekly-only plans must not acquire a fabricated, unknown five-hour limit.
    # Keep reported zero/expired counters, and preserve uncertainty for absent
    # responses or windows whose duration we cannot interpret.
    if found and not unrecognized:
        return [found[label] for label in ('5H','주간') if label in found],snap.get('planType')
    # Positions alone do not establish window duration (some plans use monthly limits).
    return [found.get(label,window(label,None,0,now)) for label in ('5H','주간')],snap.get('planType')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def claude_usage(token):
    # Credentials go only to this fixed provider endpoint, never the 1top relay.
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    req=urllib.request.Request('https://api.anthropic.com/api/oauth/usage',headers={
        'Authorization':'Bearer '+token,'anthropic-beta':'oauth-2025-04-20',
        'User-Agent':'1top/3.9.0','Accept':'application/json'})
    with opener.open(req,timeout=8) as response:
        data=response.read(512*1024)
        value=json.loads(data)
        if not isinstance(value,dict):raise ValueError('Invalid usage response')
        return value


def codex_executable():
    candidate=shutil.which('codex')
    if candidate:return candidate
    home=Path.home()
    candidates=[home/'.local/bin/codex',Path('/opt/homebrew/bin/codex')]
    candidates+=sorted((home/'.nvm/versions/node').glob('*/bin/codex'),reverse=True)
    return next((str(p) for p in candidates if p.is_file() and os.access(p,os.X_OK)),None)


def codex_rpc(root,executable=None):
    executable=executable or codex_executable()
    if not executable:raise OSError('Codex unavailable')
    # The owned subprocess handles its own auth. These are read-only RPCs, not turns.
    env={**os.environ,'CODEX_HOME':str(root)}
    env['PATH']=str(Path(executable).parent)+os.pathsep+env.get('PATH','')
    p=subprocess.Popen(cli_command(executable,'app-server'),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
    selector=None;chunks=queue.Queue()
    if os.name=='nt':
        def read_pipe():
            try:
                while True:
                    chunk=p.stdout.read1(65536);chunks.put(chunk)
                    if not chunk:break
            except (OSError,ValueError):chunks.put(b'')
        threading.Thread(target=read_pipe,daemon=True).start()
    else:
        selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
    buffer=b'';results={};deadline=time.monotonic()+18
    def send(rid,method,params):
        message={'method':method,'params':params}
        if rid is not None:message['id']=rid
        p.stdin.write((json.dumps(message)+'\n').encode());p.stdin.flush()
    try:
        send(1,'initialize',{'clientInfo':{'name':'onetop_usage','version':'2.1.0'}})
        while time.monotonic()<deadline:
            if selector:
                if not selector.select(.2):continue
                chunk=os.read(p.stdout.fileno(),65536)
            else:
                try:chunk=chunks.get(timeout=.2)
                except queue.Empty:continue
            if not chunk:break
            buffer+=chunk
            if len(buffer)>1024*1024:raise ValueError('Oversized RPC')
            while b'\n' in buffer:
                raw,buffer=buffer.split(b'\n',1)
                try:message=json.loads(raw)
                except ValueError:continue
                rid=message.get('id')
                if rid==1:
                    if 'error' in message:raise ValueError('Initialization failed')
                    send(None,'initialized',{})
                    send(2,'account/read',{'refreshToken':False})
                    send(3,'account/rateLimits/read',None)
                elif rid in (2,3):
                    if 'error' in message:raise ValueError('Usage unavailable')
                    results[rid]=message.get('result') or {}
                    if len(results)==2:return results[2].get('account') or {},results[3]
        raise TimeoutError('Usage unavailable')
    finally:
        if selector:selector.close()
        if p.poll() is None:p.terminate()
        try:p.wait(timeout=3)
        except subprocess.TimeoutExpired:p.kill();p.wait()
        p.stdin.close();p.stdout.close()


def profile_roots(home=Path.home()):
    roots={('Claude',str(home/'.claude')),('Codex',str(home/'.codex'))}
    for kind in ('Claude','Codex'):
        for path in (managed_profiles_dir(home)/kind.lower()).glob('*'):
            if path.is_dir() and not path.is_symlink():roots.add((kind,str(path)))
    for kind,key in [('Claude','CLAUDE_CONFIG_DIR'),('Codex','CODEX_HOME')]:
        if os.environ.get(key):roots.add((kind,os.environ[key]))
    for process in psutil.process_iter(['name']):
        name=(process.info.get('name') or '').lower().removesuffix('.exe')
        if name not in ('claude','codex'):continue
        try:
            env=process.environ()
            for kind,key in [('Claude','CLAUDE_CONFIG_DIR'),('Codex','CODEX_HOME')]:
                if env.get(key):roots.add((kind,env[key]))
        except (psutil.Error,OSError):pass
    return [(kind,Path(root).expanduser()) for kind,root in sorted(roots)[:64]]


def claude_credentials(root):
    fallback=read_json(root/'.credentials.json').get('claudeAiOauth') or {}
    if not isinstance(fallback,dict):fallback={}
    # Claude Code stores its current macOS login in Keychain. A migrated
    # .credentials.json may remain on disk long after that token has expired.
    try:value=keychain_document(root)
    except CredentialError:
        if fallback and (not fallback.get('expiresAt') or timestamp(fallback['expiresAt'])>time.time()):return fallback
        raise
    current=value.get('claudeAiOauth') if value else None
    if isinstance(current,dict) and current.get('accessToken'):return current
    return fallback


class AccountQuotaSampler:
    def __init__(self):
        self.lock=threading.Lock();self.rows=[];self.cached={};self.thread=None;self.refresh_failures={}
    def start(self):
        if self.thread:return
        self.thread=threading.Thread(target=self.loop,daemon=True);self.thread.start()
    def loop(self):
        while True:
            try:self.sample()
            except Exception:pass  # Never log OAuth responses, identities or credentials.
            time.sleep(120)
    def snapshot(self,now=None):
        now=now or time.time()
        with self.lock:rows=copy.deepcopy(self.rows)
        for row in rows:
            row['stale']=row['stale'] or now-row['updated']>300
            for w in row['windows']:
                if w['reset'] and w['reset']<=now:w['pct']=None
        return rows
    def claude(self,root,now):
        config_path=Path.home()/'.claude.json' if root==Path.home()/'.claude' else root/'.claude.json'
        config=read_json(config_path);account=config.get('oauthAccount') or {}
        account_id=account.get('accountUuid')
        if not account_id:return None
        key=identity('Claude',account_id,account.get('organizationUuid',''))
        auth_issue=None
        try:credentials=claude_credentials(root)
        except CredentialError as error:credentials={};auth_issue=error.code
        row={'id':key,'kind':'Claude','account_label':account.get('emailAddress') or account.get('displayName') or 'Claude 계정 '+key[-6:],
             'plan':credentials.get('subscriptionType') or account.get('seatTier') or '',
             'windows':claude_windows({},now),'updated':0,'stale':True,'note':'계정 한도를 확인하지 못했습니다.'}
        if key in self.cached:
            row.update(windows=copy.deepcopy(self.cached[key]['windows']),updated=self.cached[key]['updated'])
        cache=config.get('cachedUsageUtilization') or {}
        if cache.get('accountUuid')==account_id and isinstance(cache.get('utilization'),dict) and timestamp(cache.get('fetchedAtMs'))>row['updated']:
            row.update(windows=claude_windows(cache['utilization'],now),updated=timestamp(cache.get('fetchedAtMs')),note='Claude 계정 캐시 · 마지막 보고값',stale=True)
        token=credentials.get('accessToken')
        issue=auth_issue
        if token and timestamp(credentials.get('expiresAt'))<=now+60:
            # Revoked logins retry only after a credential change; transient failures back off.
            fingerprint=hashlib.sha256(str(credentials.get('refreshToken','')).encode()).hexdigest()
            failed=self.refresh_failures.get(str(root))
            if failed and failed[0]==fingerprint and now<failed[1]:issue=failed[2]
            else:
                try:
                    credentials=refresh_managed(root,now);token=credentials.get('accessToken')
                    self.refresh_failures.pop(str(root),None)
                except CredentialError as error:issue=error.code
                except (OSError,ValueError):issue='provider_unavailable'
                if issue:self.refresh_failures[str(root)]=(fingerprint,now+(86400 if issue=='login_required' else 300),issue)
        if isinstance(token,str) and token and timestamp(credentials.get('expiresAt'))>now:
            try:
                usage=claude_usage(token)
                # An account switch during a request invalidates its association.
                after=(read_json(config_path).get('oauthAccount') or {})
                if (after.get('accountUuid'),after.get('organizationUuid'))!=(account_id,account.get('organizationUuid')):return None
                row.update(windows=claude_windows(usage,now),updated=now,stale=False,note='Claude 계정 사용률 · 2분마다 확인')
            except urllib.error.HTTPError as error:
                issue={401:'login_required',403:'access_denied',429:'rate_limited'}.get(error.code,'provider_unavailable')
                error.close()
            except (OSError,ValueError):issue='provider_unavailable'
        elif not issue:issue='login_required' if not token else 'login_expired'
        if issue and row['stale']:
            row['status']=issue
            row['note']={
                'login_required':'로그인을 다시 연결해 주세요. 저장된 인증을 갱신할 수 없습니다.',
                'login_expired':'로그인이 만료됐습니다. 이 프로필의 Claude Code에서 로그인해 주세요.',
                'refresh_pending':'로그인 갱신 중 · 잠시 후 다시 확인합니다.',
                'access_denied':'이 로그인으로 한도 조회가 허용되지 않았습니다.',
                'rate_limited':'제공자 조회 제한 · 잠시 후 다시 확인합니다.',
                'credential_store_unavailable':'macOS 키체인 등 로그인 저장소의 접근 권한을 확인해 주세요.',
                'account_changed':'계정이 변경됐습니다. 다음 조회에서 다시 확인합니다.',
            }.get(issue,'제공자 연결 지연 · 잠시 후 다시 확인합니다.')
            if row['updated']:row['note']+=' 마지막 보고값을 표시합니다.'
        return row
    def codex(self,root,now):
        auth=read_json(root/'auth.json');tokens=auth.get('tokens') or {}
        account_id=tokens.get('account_id')
        # API key plans do not expose ChatGPT 5H / weekly subscription allowances.
        if not account_id:return None
        key=identity('Codex',account_id)
        label='Codex 계정 '+key[-6:]
        try:
            part=tokens.get('id_token','').split('.')[1];claims=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))
            if isinstance(claims.get('email'),str):label=claims['email']
        except (ValueError,IndexError,TypeError):pass
        row={'id':key,'kind':'Codex','account_label':label,'plan':'','windows':codex_windows({},now)[0],
             'updated':0,'stale':True,'note':'계정 한도를 확인하지 못했습니다.'}
        if key in self.cached:row={**copy.deepcopy(self.cached[key]),'stale':True,'note':'계정 조회 지연 · 마지막 보고값'}
        try:
            account,usage=codex_rpc(root)
            after=(read_json(root/'auth.json').get('tokens') or {}).get('account_id')
            if account_id!=after or usage.get('accountId',account_id)!=account_id:return None
            if account.get('type')!='chatgpt':return None
            windows,plan=codex_windows(usage,now)
            row.update(account_label=account.get('email') or label,plan=plan or account.get('planType') or '',
                       windows=windows,updated=now,stale=False,note='Codex 계정 사용률 · 2분마다 확인')
        except Exception:pass
        return row
    def sample(self):
        now=time.time();rows={}
        for kind,root in profile_roots():
            if kind=='Claude':
                config=Path.home()/'.claude.json' if root==Path.home()/'.claude' else root/'.claude.json'
                account=read_json(config).get('oauthAccount') or {}
                existing=rows.get(identity('Claude',account.get('accountUuid'),account.get('organizationUuid','')))
                if existing and not existing['stale']:continue
            row=self.claude(root,now) if kind=='Claude' else self.codex(root,now)
            if row and (row['id'] not in rows or (not row['stale'],row['updated'])>(not rows[row['id']]['stale'],rows[row['id']]['updated'])):rows[row['id']]=row
        self.cached=copy.deepcopy(rows)
        with self.lock:self.rows=list(rows.values())
