"""Local inference gateway with account affinity, quota preflight and fallback.

Selection/failure primitives are ported in routing_policy.py from OmniRoute.
Native protocols are preserved; retries stop before the first streamed byte.
"""
import hashlib
import hmac
import io
import json
import math
import os
import secrets
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from contextlib import closing
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

import certifi
from .accounts import NoRedirect,read_json
from .claude_profiles import CredentialError
from .routing_credentials import Credentials
from .routing_policy import choose,failure_policy

MAX_BODY=16*1024*1024
ROUTES={'/claude/v1/messages':('Claude','messages'),'/v1/messages':(None,'messages'),
        '/codex/v1/responses':('Codex','responses'),'/v1/responses':('Codex','responses'),
        '/glm/v1/messages':('GLM','messages'),'/glm/v1/chat/completions':('GLM','chat/completions'),
        '/claude/v1/messages/count_tokens':('Claude','messages/count_tokens'),
        '/v1/messages/count_tokens':(None,'messages/count_tokens'),
        '/glm/v1/messages/count_tokens':('GLM','messages/count_tokens'),
        '/codex/v1/responses/compact':('Codex','responses/compact'),
        '/v1/responses/compact':('Codex','responses/compact')}
CLIENT_HEADERS={'anthropic-version','anthropic-beta','user-agent','x-app','accept',
                'session_id','conversation_id','openai-beta'}


class TrackedStream:
    def __init__(self,stream,finish):self.stream=stream;self.finish=finish;self.closed=False
    def read(self,n=-1):return self.stream.read(n)
    def read1(self,n=-1):return self.stream.read1(n) if hasattr(self.stream,'read1') else self.stream.read(n)
    def __iter__(self):return iter(self.stream)
    def close(self):
        if not self.closed:
            self.closed=True
            try:self.stream.close()
            finally:
                try:self.finish()
                except sqlite3.Error:pass


def prepare(provider,endpoint,credentials,payload,headers):
    """Fixed provider hosts only; a local key is never forwarded upstream."""
    headers={k:v for k,v in headers.items() if k.lower() in CLIENT_HEADERS or k.lower().startswith('x-stainless-')}
    headers.update({k:v for k,v in credentials.items() if not k.startswith('_')})
    headers['Content-Type']='application/json'
    if provider=='Claude':
        url='https://api.anthropic.com/v1/'+endpoint
        headers.setdefault('anthropic-version','2023-06-01')
        beta=headers.get('anthropic-beta','').split(',')
        headers['anthropic-beta']=','.join(dict.fromkeys([v.strip() for v in beta if v.strip()]+['oauth-2025-04-20']))
        # Account identity must follow the selected credential, including fallback.
        payload=dict(payload);metadata=dict(payload.get('metadata') or {})
        user=metadata.get('user_id')
        if isinstance(user,str):
            try:bound=json.loads(user)
            except ValueError:bound=None
            if isinstance(bound,dict):
                bound['account_uuid']=credentials.get('_account_uuid','')
                metadata['user_id']=json.dumps(bound,separators=(',',':'))
            else:
                # Legacy Claude Code form: device, account UUID, session UUID.
                import re
                metadata['user_id']=re.sub(r'_account_[^_]*_session_',
                    '_account_'+credentials.get('_account_uuid','')+'_session_',user)
        payload['metadata']=metadata
    elif provider=='Codex':
        url='https://chatgpt.com/backend-api/codex/'+endpoint
        if endpoint=='responses':payload={**payload,'store':False}
    elif provider=='GLM':
        host=credentials.get('_host')
        if host not in ('api.z.ai','open.bigmodel.cn'):raise CredentialError('provider_unavailable')
        path='/api/anthropic/v1/'+endpoint if endpoint.startswith('messages') else '/api/coding/paas/v4/chat/completions'
        url='https://'+host+path
    else:raise CredentialError('provider_unavailable')
    return url,headers,json.dumps(payload,separators=(',',':'),allow_nan=False).encode()


def transport(url,headers,body):
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=certifi.where())))
    try:return opener.open(urllib.request.Request(url,data=body,headers=headers,method='POST'),timeout=120)
    except urllib.error.HTTPError as response:return response


def result(status,code,retry_at=None):
    body={'error':{'type':'onetop_gateway_error','code':code}}
    headers={'Content-Type':'application/json'}
    if retry_at:
        body['error']['retry_at']=retry_at
        headers['Retry-After']=str(max(1,math.ceil(retry_at-time.time())))
    return status,headers,io.BytesIO(json.dumps(body).encode())


class Router:
    def __init__(self,directory,sampler,credentials=None,send=transport,clock=time.time):
        self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.db_path=self.directory/'gateway.sqlite'
        self.sampler=sampler;self.credentials=credentials or Credentials(sampler)
        self.send=send;self.clock=clock;self.lock=threading.RLock();self.affinity={}
        with closing(sqlite3.connect(self.db_path)) as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS cooldown(account TEXT,model TEXT,until REAL,reason TEXT,PRIMARY KEY(account,model));
                CREATE TABLE IF NOT EXISTS requests(id TEXT,at REAL,account TEXT,model TEXT,status INTEGER,attempt INTEGER,reason TEXT);
                CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,sid TEXT,account TEXT,kind TEXT,start REAL,end REAL);
                CREATE INDEX IF NOT EXISTS binding_start ON bindings(start);''')
        os.chmod(self.db_path,0o600)

    def _cooldowns(self):
        with self.lock,closing(sqlite3.connect(self.db_path)) as db:
            return {(a,m):until for a,m,until in db.execute('SELECT account,model,until FROM cooldown WHERE until>?',(self.clock(),))}

    def _record(self,rid,account,model,status,attempt,reason,until=0):
        now=self.clock()
        with self.lock,closing(sqlite3.connect(self.db_path)) as db,db:
            if until>now:
                cooldown_model='*' if reason in ('authentication','login_required','login_expired','account_changed',
                    'credential_store_unavailable','refresh_pending') else model
                db.execute('INSERT INTO cooldown VALUES(?,?,?,?) ON CONFLICT(account,model) DO UPDATE SET until=MAX(until,excluded.until),reason=excluded.reason',
                           (account,cooldown_model,until,reason))
            db.execute('DELETE FROM cooldown WHERE until<=?',(now,))
            db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?)',(rid,now,account,model,status,attempt,reason))
            db.execute('DELETE FROM requests WHERE rowid NOT IN (SELECT rowid FROM requests ORDER BY rowid DESC LIMIT 2000)')

    def _track(self,rid,sid,account,kind,start,response):
        if not sid:return response
        with self.lock,closing(sqlite3.connect(self.db_path)) as db,db:
            db.execute('INSERT INTO bindings VALUES(?,?,?,?,?,NULL)',(rid,sid,account,kind,start))
            db.execute('DELETE FROM bindings WHERE start<?',(start-8*86400,))
        def finish():
            with self.lock,closing(sqlite3.connect(self.db_path)) as db,db:
                db.execute('UPDATE bindings SET end=? WHERE id=?',(self.clock(),rid))
        return TrackedStream(response,finish)

    def status(self):
        with self.lock,closing(sqlite3.connect(self.db_path)) as db:
            recent=[dict(zip(('request_id','at','account_id','model','status','attempt','reason'),row)) for row in
                    db.execute('SELECT * FROM requests ORDER BY rowid DESC LIMIT 50')]
        accounts=[{k:a[k] for k in ('id','kind','account_label','windows','stale','status') if k in a}
                  for a in self.sampler.snapshot()]
        return {'providers':['Claude','Codex','GLM'],'accounts':accounts,'recent_requests':recent}

    def route(self,path,payload,headers):
        provider,endpoint=ROUTES[path]
        model=payload.get('model')
        if not isinstance(model,str) or not model or len(model)>200:return (*result(400,'model_required'),None,None)
        if provider is None:provider='GLM' if model.lower().startswith('glm-') else 'Claude'
        rid=secrets.token_hex(12);excluded=set();retry_at=None
        headers={k.lower():v for k,v in headers.items()}
        metadata=payload.get('metadata') or {}
        if not isinstance(metadata,dict):return (*result(400,'invalid_metadata'),None,rid)
        from .routing_attribution import session_id
        native_sid=session_id(payload,headers)
        session=headers.get('x-onetop-session') or native_sid or metadata.get('user_id')
        affinity=hashlib.sha256((provider+'|'+model+'|'+str(session)).encode()).hexdigest() if session else None
        settings=read_json(self.directory/'gateway.json')
        threshold=settings.get('threshold',100)
        if not isinstance(threshold,(int,float)) or isinstance(threshold,bool) or not 1<=threshold<=100:threshold=100
        priority=settings.get('account_priority',[])
        if not isinstance(priority,list):priority=[]
        priority=[v for v in priority if isinstance(v,str)]
        for attempt in range(1,33):
            now=self.clock()
            with self.lock:
                self.affinity={k:v for k,v in self.affinity.items() if v[1]>now}
                preferred=self.affinity.get(affinity,(None,0))[0]
            account,deadline=choose(self.sampler.snapshot(),provider,model,now,excluded,self._cooldowns(),preferred,priority,threshold)
            if deadline:retry_at=min(retry_at,deadline) if retry_at else deadline
            if account is None:return (*result(503,'no_available_account',retry_at),None,rid)
            key=account['id'];excluded.add(key)
            try:
                creds=self.credentials.get(account)
                response=self.send(*prepare(provider,endpoint,creds,payload,headers))
                if response.status==401:
                    response.close()
                    creds=self.credentials.get(account,force=True,rejected=creds.get('Authorization'))
                    response=self.send(*prepare(provider,endpoint,creds,payload,headers))
            except CredentialError as error:
                until=now+120
                self._record(rid,key,model,0,attempt,error.code,until)
                retry_at=min(retry_at,until) if retry_at else until
                continue
            except (OSError,TimeoutError,ValueError):
                # A lost network response may already represent an accepted request.
                self._record(rid,key,model,502,attempt,'transport_unknown')
                return (*result(502,'upstream_connection_failed'),key,rid)
            if response.status<400:
                with self.lock:
                    if affinity:
                        if len(self.affinity)>=4096:self.affinity.pop(next(iter(self.affinity)))
                        self.affinity[affinity]=(key,now+3600)
                self._record(rid,key,model,response.status,attempt,'accepted')
                return response.status,dict(response.headers),self._track(rid,native_sid if endpoint!='messages/count_tokens' else None,key,provider,now,response),key,rid
            status=response.status;response_headers=dict(response.headers)
            try:raw=response.read(65536)
            except (OSError,ValueError):raw=b''
            finally:response.close()
            try:error_body=json.loads(raw)
            except ValueError:error_body={}
            decision=failure_policy(status,response_headers,error_body,now)
            self._record(rid,key,model,status,attempt,decision['reason'],decision['until'])
            if not decision['retry']:return status,response_headers,io.BytesIO(raw),key,rid
            until=decision['until'];retry_at=min(retry_at,until) if retry_at else until
        return (*result(503,'no_available_account',retry_at),None,rid)


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def setup(self):
        super().setup();self.connection.settimeout(130)
    def _authorize(self):
        host=self.headers.get('Host','')
        token=self.headers.get('Authorization','')
        token=token[7:] if token.startswith('Bearer ') else self.headers.get('x-api-key','')
        return (host in ('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port))
                and self.headers.get('Origin') is None and hmac.compare_digest(token.encode(),self.server.key.encode()))
    def _reply(self,status,headers,stream,account=None,rid=None):
        self.send_response(status)
        for key,value in headers.items():
            if key.lower() in ('content-type','content-encoding','retry-after','cache-control'):
                self.send_header(key,value)
        if account:self.send_header('X-1top-Account',account)
        if rid:self.send_header('X-1top-Request-Id',rid)
        self.send_header('Connection','close');self.end_headers();self.close_connection=True
        try:
            while True:
                data=stream.read1(65536) if hasattr(stream,'read1') else stream.read(65536)
                if not data:break
                self.wfile.write(data);self.wfile.flush()
        except (OSError,ValueError):pass
        finally:stream.close()
    def do_GET(self):
        if not self._authorize():return self._reply(*result(401,'local_key_required'))
        if self.path!='/status':return self._reply(*result(404,'not_found'))
        self._reply(200,{'Content-Type':'application/json'},io.BytesIO(json.dumps(self.server.router.status()).encode()))
    def do_POST(self):
        if not self._authorize():return self._reply(*result(401,'local_key_required'))
        path=urlsplit(self.path).path
        if path not in ROUTES:return self._reply(*result(404,'unsupported_endpoint'))
        lengths=self.headers.get_all('Content-Length',[])
        if self.headers.get('Transfer-Encoding') or len(lengths)!=1 or not lengths[0].isascii() or not lengths[0].isdigit():
            return self._reply(*result(400,'invalid_length'))
        length=int(lengths[0])
        if not 0<length<=MAX_BODY:return self._reply(*result(413,'body_too_large'))
        try:
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError()
            def reject(value):raise ValueError('nonfinite')
            payload=json.loads(raw,parse_constant=reject)
            if not isinstance(payload,dict):raise ValueError()
        except (ValueError,OSError):return self._reply(*result(400,'invalid_json'))
        self._reply(*self.server.router.route(path,payload,dict(self.headers)))


def server(directory,sampler,port=18767,router=None):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    key_path=directory/'gateway-key.json'
    try:
        fd=os.open(key_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:
        key=read_json(key_path).get('key')
        if not isinstance(key,str) or len(key)<32:raise ValueError('Invalid gateway key file')
    else:
        key=secrets.token_urlsafe(32)
        with os.fdopen(fd,'w') as stream:json.dump({'key':key},stream)
    key_path.chmod(0o600)
    httpd=ThreadingHTTPServer(('127.0.0.1',port),GatewayHandler)
    try:httpd.daemon_threads=True;httpd.key=key;httpd.router=router or Router(directory,sampler)
    except Exception:
        httpd.server_close();raise
    return httpd


def run(directory,port=18767):
    from .accounts import AccountQuotaSampler
    sampler=AccountQuotaSampler();sampler.start()
    httpd=server(directory,sampler,port)
    print('1top gateway: http://127.0.0.1:'+str(httpd.server_port),flush=True)
    print('Local credential file: '+str(Path(directory)/'gateway-key.json'),flush=True)
    try:httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:httpd.server_close()


class GatewayService:
    """Desktop-owned listener sharing the collector's existing quota sampler."""
    def __init__(self,directory,sampler,port=18767):
        self.directory=Path(directory);self.sampler=sampler;self.port=port
        self.lock=threading.RLock();self.httpd=None;self.thread=None;self.error=None

    def start_saved(self):
        value=read_json(self.directory/'gateway.json')
        if value.get('enabled') is True:
            try:self.configure(value)
            except OSError:self.error='listener_unavailable'
            except (ValueError,sqlite3.Error):self.error='configuration_unavailable'

    def configure(self,value):
        from .bridge import save_private
        if not isinstance(value,dict) or type(value.get('enabled')) is not bool:raise ValueError('enabled is required')
        threshold=value.get('threshold',100);priority=value.get('account_priority',[])
        if not isinstance(threshold,(int,float)) or isinstance(threshold,bool) or not 1<=threshold<=100:
            raise ValueError('Invalid threshold')
        if (not isinstance(priority,list) or len(priority)>64 or
                any(not isinstance(v,str) or not v or len(v)>100 for v in priority)):
            raise ValueError('Invalid priority')
        settings={'enabled':value['enabled'],'threshold':threshold,'account_priority':list(dict.fromkeys(priority))}
        with self.lock:
            started=False
            if settings['enabled'] and self.httpd is None:
                self.httpd=server(self.directory,self.sampler,self.port)
                self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True)
                self.thread.start();started=True
            try:save_private(self.directory/'gateway.json',settings)
            except OSError:
                if started:self.close()
                raise
            if not settings['enabled']:self.close()
            self.error=None
            return self.status()

    def close(self):
        with self.lock:
            if self.httpd:
                self.httpd.shutdown();self.httpd.server_close()
                if self.thread:self.thread.join(timeout=2)
                self.httpd=None;self.thread=None

    def status(self):
        with self.lock:
            settings=read_json(self.directory/'gateway.json')
            result={'enabled':settings.get('enabled') is True,'running':self.httpd is not None,
                    'threshold':settings.get('threshold',100),'account_priority':settings.get('account_priority',[]),
                    'port':self.httpd.server_port if self.httpd else self.port,'error':self.error,
                    'providers':['Claude','Codex','GLM']}
            if self.httpd:result.update(self.httpd.router.status())
            return result
