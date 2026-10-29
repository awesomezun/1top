"""Outbound-only cloud connection. No inbound ports exposed to the network."""
import json,math,os,platform,secrets,socket,threading,time,urllib.request,urllib.error,ssl,webbrowser,subprocess
from urllib.parse import urlsplit
from pathlib import Path
import certifi
import websocket
from . import __version__
from .controls import accepts_instruction, accepts_message
from .mailbox import readable as mailbox_readable

RELAY='https://onetop-relay.gitreels.workers.dev'
SSL=ssl.create_default_context(cafile=certifi.where())

def open_url(url):
    # Open with the macOS default browser via Launch Services.
    # Pass the URL as one argument without shell interpolation.
    if platform.system()=='Darwin':
        subprocess.run(['/usr/bin/open',url],check=True,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    else:webbrowser.open(url)


def relay_origin(value):
    parsed=urlsplit(value)
    if (parsed.scheme!='https' or not parsed.hostname or '.' not in parsed.hostname or
        parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or
        parsed.port not in (None,443)):
        raise ValueError('Use the HTTPS origin of your relay, without a path or credentials.')
    return 'https://'+parsed.hostname.lower()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Relay redirects are not allowed.')


def request(path,payload,relay=RELAY):
    raw=json.dumps(payload).encode()
    req=urllib.request.Request(relay_origin(relay)+path,data=raw,headers={'Content-Type':'application/json','User-Agent':'1top/'+__version__},method='POST')
    try:
        with urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=SSL)).open(req,timeout=15) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
        try:return e.code,json.load(e)
        except (ValueError,UnicodeDecodeError):return e.code,{'error':'Connection service returned HTTP '+str(e.code)+'. Please try again later.'}
        finally:e.close()


def save_private(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=path.with_suffix('.tmp')
    with os.fdopen(os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as f:json.dump(value,f)
    tmp.replace(path)


def export_flow(state):
    """Same snapshot clock and buckets as DesktopFlow; no session double counting."""
    from .usage import WINDOWS
    now = state.get('updated', 0)
    if not isinstance(now, (int, float)) or not math.isfinite(now):return {}
    finish = math.floor(now / 60) * 60 + 60
    result = {}
    for key, _, seconds in WINDOWS:
        step = 900 if seconds > 18000 else 300 if seconds > 3600 else 60
        start = finish - seconds
        bins = [{} for _ in range(seconds // step)]
        for event in state.get('events') or []:
            t = event.get('t', 0)
            if not isinstance(t, (int, float)) or not start <= t < finish or t > now:continue
            values = [event.get(k, 0) for k in ('fresh', 'cached', 'written', 'output')]
            if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in values):continue
            kind = event.get('kind') or 'unknown'; total = sum(values)
            bucket = bins[min(len(bins)-1, int((t-start)//step))]
            bucket[kind] = bucket.get(kind, 0) + total
        result[key] = {'step':step,'start':start,'end':finish,'as_of':now,
                       'reported':state.get('events') is not None,'bins':bins}
    return result


def export_weekly(usage):
    """Only numeric conversion evidence crosses the relay boundary."""
    result = {}
    for key, value in (usage.get('weekly_estimate') or {}).items():
        if not isinstance(value, dict):continue
        estimate = {k:value.get(k) for k in ('used_pp','partial','period_seconds','tokens','account_id')}
        calibration = value.get('calibration')
        if isinstance(calibration, dict):
            estimate['calibration'] = {k:calibration.get(k) for k in
                ('pp_per_token','confidence','from','to','valid_until','source')}
        result[key] = estimate
    return result


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
        if accepts_instruction(s):capabilities.append('prompt')
        if identified and mailbox_readable(s):
            capabilities.append('mailbox')
            if accepts_message(s):capabilities.append('message')
            if accepts_message(s) and s['kind'] in ('Claude','GLM','Codex'):capabilities.append('message_images')
        if s['kind']!='Aside' and identified and (not term or status in ('idle','interrupted') or can_pause and status in ('working','waiting')):capabilities.append('terminate')
        sessions.append({'id':s['id'],'control_key':s.get('control_key',''),'kind':s['kind'],
            'app':'Orca' if term else loc.get('app') or 'Unknown',
            'terminal':term.get('title') or loc.get('terminal',''),
            'project':s.get('project',''),'title':s.get('project','')+' · '+s['kind'],
            'model':s.get('model',''),'effort':s.get('effort'),
            'effort_source':s.get('effort_source'),'effort_updated':s.get('effort_updated'),
            'status':s.get('display_status') or status,'tokens':s.get('tokens'),
            'context_usage':{k:s['context_usage'].get(k) for k in ('basis','input_tokens','capacity','parts','observed_at','model')} if isinstance(s.get('context_usage'),dict) else None,
            'rate':u.get('rate'),'windows':u.get('windows',{}),'cpu':r.get('cpu'),'rss':r.get('rss'),
            'weekly_estimate':export_weekly(u),'weekly_account':u.get('weekly_account'),
            'root_session_id':s.get('root_session_id',s['id']),
            'parent_session_id':s.get('parent_session_id'),
            'capabilities':capabilities})
    host=state.get('system',{}).get('host',{});memory=host.get('memory',{})
    ops=state.get('operations',{})
    operations={'updated':ops.get('updated'), 'installed_skills':len(ops.get('skills',[])) if ops else None,
        'observed_events':len(ops.get('events',[])) if ops else None,
        'goals':[{k:g.get(k) for k in ('thread_id','runtime','status','tokens_used','time_used_seconds','session_connected','evidence')}
                 for g in ops.get('goals',[])], 'loop_state':'not_verified','skill_runtime':'partial'}
    weekly = {a['id']:a for a in state.get('weekly_usage',{}).get('accounts',[])}
    return {'version':__version__,'updated':state.get('updated',0),'recording_started':state.get('started',0),
        'flow':export_flow(state),
        'operations':operations,
        'account_quotas':[{'id':q['id'],'kind':q['kind'],'account_label':q['kind']+' · '+q['id'][-6:], 'alias':q.get('alias',''),
            'plan':q.get('plan',''),'windows':[{k:w.get(k) for k in ('label','pct','reset')} for w in q.get('windows',[])[:8]],
            'updated':q.get('updated',0),'stale':q.get('stale',True),'note':q.get('note',''),'status':q.get('status',''),
            'weekly':{key:{k:value.get(k) for k in ('used_pp','observed_seconds','partial')}
                      for key,value in weekly.get(q['id'],{}).get('periods',{}).items()},
            'usage_points':weekly.get(q['id'],{}).get('usage_points',[])[-60:]}
            for q in state.get('account_quotas',[])[:24]],
        'sessions':sessions,'applications':[{'name':a['name'],'evidence':a['evidence']} for a in state.get('applications',[])],'host':{'cpu':host.get('cpu'),'used_memory':memory.get('used',0),
        'total_memory':memory.get('total',0),'cores':host.get('cores',0)},
        'periods':[{k:w[k] for k in ('key','label','tokens','partial','observed_seconds')} for w in state.get('period_usage',{}).get('windows',[])]}


class CloudLink:
    def __init__(self,collector,controller,data_dir,relay=None):
        self.collector=collector;self.controller=controller;self.data_dir=data_dir
        self.config_file=data_dir/'device.json';self.receipt_file=data_dir/'remote-receipts.json'
        self.stop=threading.Event();self.action_lock=threading.Lock();self.ws=None
        self.status='Not connected'
        self.workspace_usage={'devices':[], 'updated':0}
        try:self.config=json.loads(self.config_file.read_text())
        except (OSError,ValueError):self.config=None
        saved=(self.config or {}).get('relay',RELAY)
        self.relay=relay_origin(relay or saved)
        if self.config and self.relay!=saved:self.config=None
        try:self.receipts=json.loads(self.receipt_file.read_text())
        except (OSError,ValueError):self.receipts={}

    def pair(self,open_browser=True):
        code,result=request('/api/pair/start',{'name':socket.gethostname().removesuffix('.local'),'platform':platform.system()},self.relay)
        if code!=200:raise RuntimeError(result.get('error','Could not start connection'))
        url=result['verification_uri_complete']
        verify=urlsplit(url)
        if verify.scheme!='https' or verify.netloc!='1top.si' or verify.path!='/connect':raise RuntimeError('Unexpected sign-in address')
        self.status='Waiting for Google sign-in'
        if open_browser:open_url(url)
        deadline=time.monotonic()+result['expires_in']
        while not self.stop.wait(result['interval']) and time.monotonic()<deadline:
            status,data=request('/api/pair/poll',{'device_code':result['device_code']},self.relay)
            if status==202:continue
            if status==200:
                # The relay origin is pinned; never accept a credential destination supplied in a response.
                self.config={'device_id':data['device_id'],'device_token':data['device_token'],'relay':self.relay}
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
            if data.get('action') not in ('focus','pause','resume','terminate','prompt','message'):raise ValueError('Unsupported action')
            result=self.controller.execute({k:data.get(k) for k in ('action','session_id','control_key','request_id','prompt','attachments') if k in data})
            self.result(rid,True,result.get('message','Completed'))
        except Exception as e:
            if data.get('action')=='message':self.controller.mailbox.delivery(rid,'delivery_unconfirmed')
            from .controls import ActionError
            self.result(rid,False,str(e) if isinstance(e,ActionError) else 'The action could not be confirmed. Check this computer.')
        finally:self.action_lock.release()

    def read_mailbox(self,data):
        rid=data.get('request_id','')
        if not isinstance(rid,str) or len(rid)!=36 or data.get('device_id')!=self.config['device_id']:return
        if data.get('expires_at',0)<time.time()*1000:return
        try:
            rows=self.controller.read_mailbox(data.get('session_id'),data.get('control_key'))
            reply={'type':'mailbox','request_id':rid,'session_id':data.get('session_id'),'messages':rows}
        except Exception:
            reply={'type':'mailbox','request_id':rid,'session_id':data.get('session_id'),'error':'This session mailbox is unavailable.'}
        try:self.ws.send(json.dumps(reply,ensure_ascii=False))
        except Exception:pass

    def flush_mailbox(self):
        if not self.action_lock.acquire(blocking=False):return
        try:self.controller.flush_mailbox()
        finally:self.action_lock.release()

    def run(self):
        delay=1
        while not self.stop.is_set() and self.config:
            try:
                self.ws=websocket.create_connection(self.relay.replace('https://','wss://')+'/api/device/socket',
                    header={'Authorization':'Bearer '+self.config['device_token'],'User-Agent':'1top/'+__version__},timeout=3,
                    suppress_origin=True,redirect_limit=0,sslopt={'ca_certs':certifi.where()})
                self.status='Connected';delay=1;last=0;interval=60;mailbox_tick=0
                while not self.stop.is_set():
                    if time.monotonic()-mailbox_tick>=3:
                        mailbox_tick=time.monotonic();threading.Thread(target=self.flush_mailbox,daemon=True).start()
                    if time.monotonic()-last>=interval:
                        with self.collector.lock:state=self.collector.snapshot
                        if state.get('ready'):
                            payload=export_snapshot(self.controller.decorate(state))
                            payload['speed_periods']=self.collector.speed_for_cloud(state)
                            self.ws.send(json.dumps({'type':'snapshot','data':payload},ensure_ascii=False))
                            self.read_workspace_usage()
                        last=time.monotonic()
                    try:
                        raw=self.ws.recv()
                        if not raw:break
                        if raw=='pong':continue
                        message=json.loads(raw)
                        if message.get('type')=='report_policy':
                            interval=3 if message.get('interval')==3 else 60
                            if interval==3:last=0
                        if message.get('type')=='mailbox_request':threading.Thread(target=self.read_mailbox,args=(message,),daemon=True).start()
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

    def read_workspace_usage(self):
        # The existing paired device credential reads numerical totals only.
        # Network failure never replaces the local collector's measurements.
        if time.time()-getattr(self,'workspace_checked',0)<15:
            return
        self.workspace_checked=time.time()
        try:
            req=urllib.request.Request(self.relay+'/api/device/usage',
                headers={'Authorization':'Bearer '+self.config['device_token'],
                         'User-Agent':'1top/'+__version__})
            with urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=SSL)).open(req,timeout=3) as response:
                value=json.loads(response.read(128000))
            if isinstance(value.get('devices'),list):
                self.workspace_usage={'devices':value['devices'][:25], 'updated':time.time()}
        except Exception:
            pass
