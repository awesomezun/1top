"""Outbound-only cloud connection. No inbound ports exposed to the network."""
import json,os,platform,secrets,socket,threading,time,urllib.request,urllib.error,ssl,webbrowser,subprocess
from pathlib import Path
import certifi
import websocket
from . import __version__

RELAY='https://onetop-relay.gitreels.workers.dev'
SSL=ssl.create_default_context(cafile=certifi.where())

def open_url(url):
    # Open with the macOS default browser via Launch Services.
    # Pass the URL as one argument without shell interpolation.
    if platform.system()=='Darwin':
        subprocess.run(['/usr/bin/open',url],check=True,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    else:webbrowser.open(url)


def request(path,payload):
    raw=json.dumps(payload).encode()
    req=urllib.request.Request(RELAY+path,data=raw,headers={'Content-Type':'application/json','User-Agent':'1top/'+__version__},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=15,context=SSL) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
        try:return e.code,json.load(e)
        except (ValueError,UnicodeDecodeError):return e.code,{'error':'Connection service returned HTTP '+str(e.code)+'. Please try again later.'}
        finally:e.close()


def save_private(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=path.with_suffix('.tmp')
    with os.fdopen(os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as f:json.dump(value,f)
    tmp.replace(path)


def export_snapshot(state):
    sessions=[]
    for s in state.get('sessions',[]):
        loc=s.get('location') or {};term=s.get('orca_terminal') or {};r=s.get('resources') or {};u=s.get('usage') or {}
        capabilities=[]
        identified=bool(s.get('control_key'))
        status=s.get('status','unknown')
        if identified and (term or loc.get('app_path')):capabilities.append('focus')
        can_pause=identified and term and s.get('input_verified') is not False and s['kind'] in ('Claude','GLM','Codex')
        if (can_pause or identified and s['kind']=='Aside') and status in ('working','waiting'):capabilities.append('pause')
        if can_pause and s.get('display_status')=='paused' and status in ('idle','interrupted'):capabilities.append('resume')
        if s['kind']!='Aside' and identified and (not term or status in ('idle','interrupted') or can_pause and status in ('working','waiting')):capabilities.append('terminate')
        sessions.append({'id':s['id'],'control_key':s.get('control_key',''),'kind':s['kind'],
            'app':'Orca' if term else loc.get('app') or 'Unknown',
            'terminal':term.get('title') or loc.get('terminal',''),
            'project':s.get('project',''),'title':s.get('project','')+' · '+s['kind'],
            'model':s.get('model',''),'status':s.get('display_status') or status,'tokens':s.get('tokens'),
            'rate':u.get('rate'),'windows':u.get('windows',{}),'cpu':r.get('cpu'),'rss':r.get('rss'),
            'capabilities':capabilities})
    host=state.get('system',{}).get('host',{});memory=host.get('memory',{})
    ops=state.get('operations',{})
    operations={'updated':ops.get('updated'), 'installed_skills':len(ops.get('skills',[])) if ops else None,
        'observed_events':len(ops.get('events',[])) if ops else None,
        'goals':[{k:g.get(k) for k in ('thread_id','runtime','status','tokens_used','time_used_seconds','session_connected','evidence')}
                 for g in ops.get('goals',[])], 'loop_state':'not_verified','skill_runtime':'partial'}
    return {'version':__version__,'updated':state.get('updated',0),'recording_started':state.get('started',0),
        'operations':operations,
        'account_quotas':[{'id':q['id'],'kind':q['kind'],'account_label':q['kind']+' · '+q['id'][-6:],
            'plan':q.get('plan',''),'windows':[{k:w.get(k) for k in ('label','pct','reset')} for w in q.get('windows',[])[:8]],
            'updated':q.get('updated',0),'stale':q.get('stale',True),'note':q.get('note','')} for q in state.get('account_quotas',[])[:24]],
        'sessions':sessions,'applications':[{'name':a['name'],'evidence':a['evidence']} for a in state.get('applications',[])],'host':{'cpu':host.get('cpu'),'used_memory':memory.get('used',0),
        'total_memory':memory.get('total',0),'cores':host.get('cores',0)},
        'periods':[{k:w[k] for k in ('key','label','tokens','partial','observed_seconds')} for w in state.get('period_usage',{}).get('windows',[])]}


class CloudLink:
    def __init__(self,collector,controller,data_dir):
        self.collector=collector;self.controller=controller;self.data_dir=data_dir
        self.config_file=data_dir/'device.json';self.receipt_file=data_dir/'remote-receipts.json'
        self.stop=threading.Event();self.action_lock=threading.Lock();self.ws=None
        self.status='Not connected'
        try:self.config=json.loads(self.config_file.read_text())
        except (OSError,ValueError):self.config=None
        try:self.receipts=json.loads(self.receipt_file.read_text())
        except (OSError,ValueError):self.receipts={}

    def pair(self,open_browser=True):
        code,result=request('/api/pair/start',{'name':socket.gethostname().removesuffix('.local'),'platform':platform.system()})
        if code!=200:raise RuntimeError(result.get('error','Could not start connection'))
        url=result['verification_uri_complete'];self.status='Waiting for Google sign-in'
        if open_browser:open_url(url)
        deadline=time.monotonic()+result['expires_in']
        while not self.stop.wait(result['interval']) and time.monotonic()<deadline:
            status,data=request('/api/pair/poll',{'device_code':result['device_code']})
            if status==202:continue
            if status==200:
                # The relay origin is pinned; never accept a credential destination supplied in a response.
                self.config={'device_id':data['device_id'],'device_token':data['device_token']}
                save_private(self.config_file,self.config);return
            if status==429:continue
            raise RuntimeError(data.get('error','Connection expired'))
        raise RuntimeError('Connection expired. Open 1top to connect again.')

    def result(self,rid,ok,message):
        result={'type':'result','request_id':rid,'ok':ok,'message':message}
        self.receipts[rid]=result
        self.receipts=dict(list(self.receipts.items())[-200:]);save_private(self.receipt_file,self.receipts)
        try:self.ws.send(json.dumps(result))
        except Exception:pass

    def command(self,data):
        rid=data.get('request_id','')
        if not isinstance(rid,str) or len(rid)!=36:return
        if data.get('device_id')!=self.config['device_id']:return
        if rid in self.receipts:
            try:self.ws.send(json.dumps(self.receipts[rid]))
            except Exception:pass
            return
        if data.get('expires_at',0)<time.time()*1000:return self.result(rid,False,'Request expired before delivery. Nothing executed.')
        if not self.action_lock.acquire(blocking=False):return self.result(rid,False,'Another action is running. Check the device first.')
        try:
            # Mark before executing: never replay an uncertain action after a crash/reconnect.
            self.receipts[rid]={'type':'result','request_id':rid,'ok':False,'message':'Previous execution is unconfirmed. Check the session before requesting another action.'}
            save_private(self.receipt_file,self.receipts)
            if data.get('action') not in ('focus','pause','resume','terminate'):raise ValueError('Unsupported action')
            result=self.controller.execute({k:data.get(k) for k in ('action','session_id','control_key','request_id')})
            self.result(rid,True,result.get('message','Completed'))
        except Exception as e:
            from .controls import ActionError
            self.result(rid,False,str(e) if isinstance(e,ActionError) else 'The action could not be confirmed. Check this computer.')
        finally:self.action_lock.release()

    def run(self):
        delay=1
        while not self.stop.is_set() and self.config:
            try:
                self.ws=websocket.create_connection(RELAY.replace('https://','wss://')+'/api/device/socket',
                    header={'Authorization':'Bearer '+self.config['device_token'],'User-Agent':'1top/'+__version__},timeout=3,
                    suppress_origin=True,sslopt={'ca_certs':certifi.where()})
                self.status='Connected';delay=1;last=0
                while not self.stop.is_set():
                    if time.monotonic()-last>=3:
                        with self.collector.lock:state=self.collector.snapshot
                        if state.get('ready'):
                            payload=export_snapshot(self.controller.decorate(state))
                            self.ws.send(json.dumps({'type':'snapshot','data':payload},ensure_ascii=False))
                        last=time.monotonic()
                    try:
                        raw=self.ws.recv()
                        if not raw:break
                        if raw=='pong':continue
                        message=json.loads(raw)
                        if message.get('type')=='action':threading.Thread(target=self.command,args=(message,),daemon=True).start()
                    except websocket.WebSocketTimeoutException:continue
            except websocket.WebSocketBadStatusException as e:
                if e.status_code in (401,403):self.status='Disconnected by account. Open 1top to reconnect.';return
                self.status='Reconnecting'
            except Exception:self.status='Reconnecting'
            finally:
                if self.ws:
                    try:self.ws.close()
                    except Exception:pass
            if self.stop.wait(delay):break
            delay=min(60,delay*2+secrets.randbelow(3))
