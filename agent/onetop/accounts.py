"""Local account-scoped limits from CLI reports and verified provider queries."""
import base64
import copy
import hashlib
import json
import queue
from .platform_support import cli_command, data_directory
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
from itertools import islice
from pathlib import Path

import certifi
import psutil
from .account_login import managed_profiles_dir
from .claude_profiles import CredentialError, keychain_document, refresh_managed, managed


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


def claude_statusline_report(root,key,now):
    """Read only reports attributable to the profile's current signed-in account."""
    latest=None;root=root.resolve()
    for path in islice((data_directory()/'claude-statusline').glob('*.json'),4096):
        if path.is_symlink():continue
        try:
            if path.stat().st_size>16*1024:continue
            with path.open('rb') as stream:raw=stream.read(16*1024+1)
            if len(raw)>16*1024:continue
            report=json.loads(raw)
        except (OSError,ValueError):continue
        if not isinstance(report,dict):continue
        if report.get('schema')!=1 or isinstance(report.get('schema'),bool):continue
        if report.get('source')!='claude_statusline' or report.get('account_id')!=key:continue
        profile=report.get('profile');reported=report.get('t');session=report.get('session_id')
        if not isinstance(profile,str) or not Path(profile).is_absolute():continue
        try:
            if Path(profile).resolve()!=root:continue
        except (OSError,ValueError):continue
        if not isinstance(session,str) or not session or len(session)>1024:continue
        if not isinstance(reported,(int,float)) or isinstance(reported,bool) or not math.isfinite(reported) or not 0<reported<=now+5:continue
        limits=report.get('rl')
        if not isinstance(limits,dict):continue
        windows=[]
        for name,label in [('five_hour','5H'),('seven_day','주간')]:
            value=limits.get(name)
            if not isinstance(value,dict):continue
            used=value.get('used_percentage');reset=value.get('resets_at')
            if pct(used) is None or not 0<=used<=100:continue
            if not isinstance(reset,(int,float)) or isinstance(reset,bool) or not math.isfinite(reset) or reset<=0:continue
            windows.append(window(label,used,reset,now))
        if not windows:continue
        if latest is None or reported>latest['updated']:
            latest={'windows':windows,'updated':reported,'source':'claude_statusline',
                    'verified_activity':report.get('verified_activity') is True}
    return latest


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


def claude_api(token, resource):
    from . import __version__
    if resource not in ('usage','profile'):raise ValueError('Invalid account resource')
    # Credentials go only to this fixed provider endpoint, never the 1top relay.
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    req=urllib.request.Request('https://api.anthropic.com/api/oauth/'+resource,headers={
        'Authorization':'Bearer '+token,'anthropic-beta':'oauth-2025-04-20',
        'User-Agent':'1top/'+__version__,'Accept':'application/json','Cache-Control':'no-cache'})
    with opener.open(req,timeout=8) as response:
        data=response.read(512*1024)
        value=json.loads(data)
        if not isinstance(value,dict):raise ValueError('Invalid usage response')
        return value


def claude_usage(token):
    return claude_api(token,'usage')


def claude_identity(token):
    profile=claude_api(token,'profile')
    account=profile.get('account') or {};organization=profile.get('organization') or {}
    if not isinstance(account,dict) or not isinstance(organization,dict) or not account.get('uuid') or not organization.get('uuid'):
        raise CredentialError('invalid_response')
    return identity('Claude',account['uuid'],organization['uuid'])


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
    from .credential_store import enrolled_document
    enrolled=enrolled_document(root)
    if enrolled and isinstance(enrolled.get('claudeAiOauth'),dict):return enrolled['claudeAiOauth']
    fallback=read_json(root/'.credentials.json').get('claudeAiOauth') or {}
    if not isinstance(fallback,dict):fallback={}
    # Claude Code stores its current macOS login in Keychain. A migrated
    # .credentials.json may remain on disk long after that token has expired.
    try:value=keychain_document(root)
    except CredentialError:
        if fallback and (not fallback.get('expiresAt') or timestamp(fallback['expiresAt'])>time.time()
                         or (managed(root) and fallback.get('refreshToken'))):return fallback
        raise
    current=value.get('claudeAiOauth') if value else None
    if isinstance(current,dict) and current.get('accessToken'):return current
    return fallback


class AccountQuotaSampler:
    def __init__(self):
        from .provider_quotas import ProviderQuotaSampler
        self.providers=ProviderQuotaSampler()
        self.lock=threading.Lock();self.rows=[];self.cached={};self.thread=None;self.refresh_failures={};self.profile_accounts={};self.profile_jobs={};self.profile_timeout=25
        self.local_refresh_lock=threading.Lock();self.next_local_refresh=0
        self.claude_verified={};self.claude_backoff={}
    def start(self):
        if self.thread:return
        self.providers.start()
        self.thread=threading.Thread(target=self.loop,daemon=True);self.thread.start()
    def loop(self):
        while True:
            try:self.sample()
            except Exception:pass  # Never log OAuth responses, identities or credentials.
            time.sleep(120)
    def snapshot(self,now=None):
        now=now or time.time()
        self.refresh_claude_reports(now)
        with self.lock:rows=copy.deepcopy(self.rows)
        for row in rows:
            row['stale']=row['stale'] or now-row['updated']>300
            for w in row['windows']:
                if w['reset'] and w['reset']<=now:w['pct']=None
        return rows+self.providers.snapshot(now)
    def refresh_claude_reports(self,now):
        """Refresh known local reports without spawning CLIs or rediscovering profiles."""
        if time.monotonic()<self.next_local_refresh or not self.local_refresh_lock.acquire(blocking=False):return
        try:
            self.next_local_refresh=time.monotonic()+1
            with self.lock:bindings={root:value for root,value in self.profile_accounts.items() if value[1]=='Claude'}
            updates={}
            for root,binding in bindings.items():
                job=self.profile_jobs.get(('Claude',str(root)))
                if job is not None and not job['done'].is_set():continue
                try:row=self.claude(root,now)
                except (OSError,ValueError,TypeError):continue
                # Full sampling owns identity changes; this path refreshes known accounts only.
                if row is None or row['id']!=binding[0]:continue
                existing=updates.get(row['id'])
                if existing is None or (not row['stale'],row['updated'])>(not existing['stale'],existing['updated']):updates[row['id']]=row
            with self.lock:
                current_ids={value[0] for root,value in self.profile_accounts.items() if bindings.get(root)==value}
                for index,previous in enumerate(self.rows):
                    row=updates.get(previous['id'])
                    if row and row['id'] in current_ids and (row['updated']>previous['updated'] or
                            (row['updated']==previous['updated'] and previous['stale'] and not row['stale'])):
                        self.rows[index]=row;self.cached[row['id']]=copy.deepcopy(row)
        finally:self.local_refresh_lock.release()
    def roots(self):
        with self.lock:return dict(self.profile_accounts)
    def claude(self,root,now):
        config_path=Path.home()/'.claude.json' if root.resolve()==(Path.home()/'.claude').resolve() else root/'.claude.json'
        config=read_json(config_path);account=config.get('oauthAccount') or {}
        if not isinstance(account,dict):return None
        account_id=account.get('accountUuid')
        if not account_id:return None
        key=identity('Claude',account_id,account.get('organizationUuid',''))
        # This fast path runs on snapshot reads and stays entirely local.
        # The two-minute background sampler owns credential/provider access.
        row={'id':key,'kind':'Claude','account_label':account.get('emailAddress') or account.get('displayName') or 'Claude 계정 '+key[-6:],
             'plan':account.get('seatTier') or ('max' if '_claude_max_' in str(account.get('organizationRateLimitTier') or '') else ''),
             'windows':claude_windows({},now),'updated':0,'stale':True,'status':'report_pending',
             'note':'Claude Code의 다음 사용량 보고를 기다립니다.'}
        previous=self.cached.get(key)
        if previous:
            row.update(windows=copy.deepcopy(previous['windows']),updated=previous['updated'])
            if previous.get('source'):row['source']=previous['source']
            if previous.get('verified_activity') is True:row['verified_activity']=True
        cache=config.get('cachedUsageUtilization') or {}
        if (isinstance(cache,dict) and cache.get('accountUuid')==account_id
                and cache.get('organizationUuid')==account.get('organizationUuid') and isinstance(cache.get('utilization'),dict)):
            reported=timestamp(cache.get('fetchedAtMs'))
            if row['updated']<reported<=now:
                row.update(windows=claude_windows(cache['utilization'],now),updated=reported,source='claude_cache')
        report=claude_statusline_report(root,key,now)
        if report and report['updated']>=row['updated']:row.update(report)
        # An account switch while reading must not attribute the previous user's report.
        after=read_json(config_path).get('oauthAccount') or {}
        if not isinstance(after,dict) or (after.get('accountUuid'),after.get('organizationUuid'))!=(account_id,account.get('organizationUuid')):return None
        for value in row['windows']:
            if value['reset'] and value['reset']<=now:value['pct']=None
        has_value=any(value['pct'] is not None for value in row['windows'])
        if row.get('source')=='claude_oauth' and now-row['updated']<=300 and has_value:
            row.update(stale=False,note='Claude 계정 사용률 · 2분마다 확인');row.pop('status',None)
        elif row.get('source')=='claude_statusline' and row.get('verified_activity') is True and now-row['updated']<=300 and has_value:
            row.update(stale=False,note='Claude Code 상태줄 보고')
            row.pop('status',None)
        elif row.get('source')=='claude_statusline' and row.get('verified_activity') is not True and row['updated']:
            row.update(status='last_report',note='Claude Code 마지막 보고값 · 다음 응답에서 갱신')
        elif row['updated']:
            row['note']='Claude Code 상태줄 보고 · 마지막 보고값' if row.get('source')=='claude_statusline' else 'Claude 계정 캐시 · 마지막 보고값'
        return row
    def claude_live(self,root,now):
        row=self.claude(root,now)
        if row is None or (not row['stale'] and now-row['updated']<120):return row
        key=row['id'];failure_key=(str(root),key)
        failure=self.refresh_failures.get(failure_key)
        backoff=self.claude_backoff.get(key)
        def failed(code):
            row['status']=code
            row['note']={
                'credential_store_unavailable':'Claude 인증 저장소 접근 필요 · 마지막 보고값',
                'login_required':'Claude 계정 재연결 필요 · 마지막 보고값',
                'login_expired':'Claude 계정 재연결 필요 · 마지막 보고값',
                'account_changed':'Claude 계정 확인 필요 · 마지막 보고값',
                'rate_limited':'Claude 조회 대기 · 마지막 보고값',
            }.get(code,'Claude 계정 조회 지연 · 마지막 보고값')
            return row
        if failure and now<failure[0]:return failed(failure[1])
        if backoff and now<backoff:return failed('rate_limited')
        try:
            credentials=claude_credentials(root)
            if not credentials.get('accessToken'):raise CredentialError('login_required')
            if timestamp(credentials.get('expiresAt'))<=now+30:
                credentials=refresh_managed(root,now)
            token=credentials['accessToken'];fingerprint=hashlib.sha256(token.encode()).hexdigest()
            # A profile's name/config does not prove who owns its stored token.
            # Confirm with the provider before accepting any usage measurement.
            if self.claude_verified.get(fingerprint)!=key:
                if claude_identity(token)!=key:raise CredentialError('account_changed')
                if len(self.claude_verified)>128:self.claude_verified.clear()
                self.claude_verified[fingerprint]=key
            usage=claude_usage(token)
            after=self.claude(root,now)
            if after is None or after['id']!=key:return None
            windows=claude_windows(usage,now)
            if not any(w['pct'] is not None for w in windows):raise CredentialError('invalid_response')
            row.update(windows=windows,updated=now,stale=False,source='claude_oauth',
                       note='Claude 계정 사용률 · 2분마다 확인')
            row.pop('status',None);row.pop('verified_activity',None)
            self.refresh_failures.pop(failure_key,None)
            return row
        except urllib.error.HTTPError as error:
            code={401:'login_required',403:'access_denied',429:'rate_limited'}.get(error.code,'provider_unavailable')
            retry=0
            if error.headers:
                try:retry=float(error.headers.get('Retry-After','0'))
                except (ValueError,TypeError):
                    from email.utils import parsedate_to_datetime
                    try:retry=parsedate_to_datetime(error.headers['Retry-After']).timestamp()-now
                    except (ValueError,TypeError,KeyError):pass
            if not math.isfinite(retry):retry=0
            error.close()
            if code=='rate_limited':self.claude_backoff[key]=now+max(120,min(3600,retry or 300))
        except CredentialError as error:code=error.code
        except (OSError,ValueError,TypeError):code='provider_unavailable'
        self.refresh_failures[failure_key]=(now+(600 if code in ('login_required','login_expired') else 120),code)
        return failed(code)
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
    def profile(self,kind,root,now):
        # Keep a slow provider subprocess from stalling every other account.
        job_key=(kind,str(root));job=self.profile_jobs.get(job_key)
        if job is None:
            job={'done':threading.Event(),'row':None}
            self.profile_jobs[job_key]=job
            def query():
                try:job['row']=self.claude_live(root,now) if kind=='Claude' else self.codex(root,now)
                except Exception:pass
                finally:job['done'].set()
            threading.Thread(target=query,daemon=True).start()
            job['done'].wait(self.profile_timeout)
        if job['done'].is_set():
            self.profile_jobs.pop(job_key,None)
            return job['row']
        if kind=='Claude':
            config=Path.home()/'.claude.json' if root==Path.home()/'.claude' else root/'.claude.json'
            account=read_json(config).get('oauthAccount') or {}
            if not account.get('accountUuid'):return None
            key=identity(kind,account['accountUuid'],account.get('organizationUuid',''))
            label=account.get('emailAddress') or 'Claude 계정 '+key[-6:]
            windows=claude_windows({},now)
        else:
            account=(read_json(root/'auth.json').get('tokens') or {}).get('account_id')
            if not account:return None
            key=identity(kind,account);label='Codex 계정 '+key[-6:];windows=codex_windows({},now)[0]
        row=copy.deepcopy(self.cached.get(key) or {'id':key,'kind':kind,'account_label':label,
                          'plan':'','windows':windows,'updated':0})
        row.update(stale=True,status='refresh_pending',note='계정 조회 응답을 기다립니다.')
        return row
    def sample(self):
        now=time.time();rows={};bindings={}
        for kind,root in profile_roots():
            if kind=='Claude':
                config=Path.home()/'.claude.json' if root==Path.home()/'.claude' else root/'.claude.json'
                account=read_json(config).get('oauthAccount') or {}
                existing=rows.get(identity('Claude',account.get('accountUuid'),account.get('organizationUuid','')))
                # A recent cached value can survive a failed credential lookup.
                # Still try other profiles of the same account so an enrolled
                # login can refresh it without another authorization prompt.
                if existing and ((not existing['stale'] and not existing.get('status')) or existing.get('status')=='refresh_pending'):
                    bindings[root.resolve()]=(existing['id'],kind,now)
                    continue
            row=self.profile(kind,root,now)
            if row:bindings[root.resolve()]=(row['id'],kind,now)
            if row and (row['id'] not in rows or (not row['stale'],row['updated'])>(not rows[row['id']]['stale'],rows[row['id']]['updated'])):rows[row['id']]=row
        self.cached=copy.deepcopy(rows)
        with self.lock:
            # Keep a binding start only while the profile identity stays unchanged.
            for root,value in bindings.items():
                old=self.profile_accounts.get(root)
                if old and old[:2]==value[:2]:bindings[root]=old
            self.profile_accounts=bindings
            self.rows=list(rows.values())
