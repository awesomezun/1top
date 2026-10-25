"""Explicit, same-origin controls for individually verified CLI processes."""
import hashlib
import platform
import psutil
import json
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from .discovery import orca_executable


class ActionError(Exception):
    def __init__(self,message,status=409):
        super().__init__(message)
        self.status=status


def target_key(spec):
    terminal=spec.get('orca_terminal') or {}
    identity=[spec['id'],spec['pids'],spec.get('process_started'),spec.get('process_birth'),
              terminal.get('handle'),terminal.get('incarnationId')]
    return hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()


def process_start(pid):
    if platform.system()=='Windows':
        try:return time.strftime('%a %b %d %H:%M:%S %Y',time.localtime(psutil.Process(pid).create_time()))
        except psutil.Error:return None
    try:
        raw=subprocess.check_output(['ps','-p',str(pid),'-o','lstart='],text=True,
                                    stderr=subprocess.DEVNULL,timeout=3)
        return ' '.join(raw.split()) or None
    except (OSError,subprocess.SubprocessError):return None


def terminate_pid(pid,started):
    if pid<=1 or pid==os.getpid() or not started or process_start(pid)!=started:
        raise ActionError('프로세스가 변경되었습니다. 새로고침 후 다시 확인하세요.')
    try:os.kill(pid,signal.SIGTERM)
    except ProcessLookupError:return True
    until=time.monotonic()+3
    while time.monotonic()<until:
        if process_start(pid)!=started:return True
        time.sleep(.15)
    return False


RESUME_PROMPT='이전에 중단된 작업을 이어서 진행해 주세요. 먼저 현재 진행 상태와 이미 완료한 변경을 확인하고, 중복 실행을 피해서 계속해 주세요.'


class Controller:
    def __init__(self,collector,factory,state_file=None):
        self.collector=collector
        self.factory=factory
        self.lock=threading.Lock()
        self.receipts={}
        self.interrupted={}
        self.state_lock=threading.Lock()
        self.state_file=state_file
        self.paused={};self.audit=[]
        if state_file:
            try:
                saved=json.loads(Path(state_file).read_text());self.paused=saved.get('paused',{});self.audit=saved.get('audit',[])[-50:]
            except (OSError,ValueError):pass

    def save_state(self):
        if not self.state_file:return
        path=Path(self.state_file);path.parent.mkdir(parents=True,exist_ok=True)
        tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps({'paused':self.paused,'audit':self.audit[-50:]},ensure_ascii=False))
        tmp.chmod(0o600);tmp.replace(path)

    def remember(self,spec,phase):
        with self.state_lock:
            if phase:self.paused[spec['id']]={'key':spec['control_key'],'phase':phase,'at':time.time()}
            else:self.paused.pop(spec['id'],None)
            self.save_state()

    def decorate(self,snapshot):
        sessions=[];changed=False
        with self.state_lock:
            for src in snapshot.get('sessions',[]):
                s=dict(src);mark=self.paused.get(s['id']);s['display_status']=s.get('status','unknown')
                if mark and mark['key']!=s.get('control_key'):
                    self.paused.pop(s['id'],None);mark=None;changed=True
                if mark and s.get('status')=='working' and s.get('status_at',0)>mark['at']:
                    self.paused.pop(s['id'],None);mark=None;changed=True
                if mark:
                    s['pause_state']=dict(mark)
                    if mark['phase']=='resuming':s['display_status']='resuming'
                    elif s.get('status') in ('idle','interrupted'):s['display_status']='paused'
                sessions.append(s)
            if changed:self.save_state()
            return {**snapshot,'sessions':sessions,'actions':list(self.audit[-20:]),'resume_prompt':RESUME_PROMPT}

    def resolve(self,sid,key):
        if sid.startswith('aside:'):
            from .aside import resolve
            spec=resolve(sid,key)
            if not spec:raise ActionError('Aside 세션 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.')
            return spec
        fresh=self.factory();fresh.discover()
        spec=next((s for s in fresh.specs if s['id']==sid),None)
        if not spec or not spec.get('control_key') or spec['control_key']!=key:
            raise ActionError('세션이나 터미널 연결이 변경되었습니다. 새로고침 후 다시 확인하세요.')
        if len(spec['pids'])!=1:raise ActionError('개별 CLI 프로세스를 확인할 수 없습니다.')
        return spec

    def status(self,spec):
        if spec['kind']!='Codex':return spec.get('status','unknown')
        with self.collector.lock:
            snapshot=self.collector.snapshot
            if time.time()-snapshot.get('updated',0)>20:return 'unknown'
            row=next((s for s in snapshot.get('sessions',[]) if s['id']==spec['id'] and s.get('control_key')==spec['control_key']),None)
            return row.get('status','unknown') if row else 'unknown'

    def orca(self,*args):
        try:
            p=subprocess.run([orca_executable(),'terminal',*args,'--json'],
                             text=True,capture_output=True,timeout=8)
            result=json.loads(p.stdout)
        except (OSError,ValueError,subprocess.SubprocessError):
            raise ActionError('Orca 응답을 확인하지 못했습니다. 터미널 상태를 확인하세요.',502)
        if p.returncode or result.get('ok') is not True:
            raise ActionError('Orca에서 동작을 처리하지 못했습니다. 터미널 연결을 확인하세요.',502)
        return result.get('result') or {}

    def interrupt(self,spec):
        terminal=spec.get('orca_terminal')
        if not terminal:raise ActionError('연결된 Orca 터미널이 없습니다.')
        if spec.get('input_verified') is False:
            raise ActionError('이 터미널의 입력을 받을 CLI를 하나로 확인할 수 없습니다. 터미널에서 직접 확인하세요.')
        if spec['kind'] not in ('Claude','GLM','Codex'):
            raise ActionError('이 CLI의 작업 중단 키는 아직 검증되지 않았습니다.')
        key=spec['control_key']
        if time.monotonic()-self.interrupted.get(key,0)<8:
            raise ActionError('중단 요청을 이미 보냈습니다. 상태 갱신을 기다려 주세요.')
        # Escape cancels a turn without the double-Ctrl-C CLI exit behavior.
        self.orca('send','--terminal',terminal['handle'],'--text','\x1b')
        self.interrupted[key]=time.monotonic()

    def wait_stopped(self,spec):
        until=time.monotonic()+9
        while time.monotonic()<until:
            time.sleep(.4)
            current=self.resolve(spec['id'],spec['control_key'])
            if self.status(current) in ('idle','interrupted'):return current
        raise ActionError('중단 요청은 보냈지만 완료를 아직 확인하지 못해 CLI 종료를 보류했습니다. 터미널에서 확인 후 다시 시도하세요.')

    def execute(self,payload):
        action=payload.get('action');sid=payload.get('session_id');key=payload.get('control_key');rid=payload.get('request_id')
        if action not in ('focus','interrupt','pause','resume','terminate') or not all(isinstance(x,str) and x for x in (sid,key,rid)):
            raise ActionError('잘못된 동작 요청입니다.',400)
        if not self.lock.acquire(blocking=False):raise ActionError('이전 동작을 처리 중입니다. 잠시 후 다시 시도하세요.')
        try:
            request=(action,sid,key)
            if rid in self.receipts:
                previous,result=self.receipts[rid]
                if previous!=request:raise ActionError('요청 ID가 이미 사용되었습니다.')
                return result
            spec=self.resolve(sid,key);terminal=spec.get('orca_terminal')
            if spec['kind']=='Aside' and action!='focus':
                if action not in ('pause','interrupt'):raise ActionError('Aside에서는 작업 중단만 지원합니다. CLI 종료 대상이 아닙니다.')
                if spec['status'] not in ('working','waiting'):raise ActionError('현재 Aside 작업 중 상태를 확인하지 못했습니다.')
                from .aside import cli_path
                try:
                    completed=subprocess.run([str(cli_path()),'session','stop',spec['aside_session'],'--account',spec['aside_account']],
                        capture_output=True,text=True,timeout=12)
                    if completed.returncode:raise ActionError('Aside 중단 결과를 확인하지 못했습니다.')
                except (OSError,subprocess.TimeoutExpired):raise ActionError('Aside 응답을 확인하지 못했습니다. 앱에서 상태를 확인하세요.')
                result={'message':'Aside 세션의 작업 중단을 요청했습니다. 실제 상태는 다음 수집 때 확인합니다.'}
            elif action=='focus':
                if terminal:
                    self.orca('switch','--terminal',terminal['handle'])
                    result={'message':f"{terminal['title']} 터미널로 이동했습니다."}
                elif spec.get('location',{}).get('app_path'):
                    app=spec['location']['app_path']
                    if platform.system()=='Windows':
                        from .windows_discovery import focus_process
                        if not focus_process(spec['pids'][0]):raise ActionError('Windows could not bring the host window forward. Open it from the taskbar.')
                    else:subprocess.run(['/usr/bin/open','-a',app],check=True,timeout=5,capture_output=True)
                    result={'message':'Sent a request to bring the host application forward on that computer.'}
                else:raise ActionError('The host application cannot be focused automatically.')
            else:
                state=self.status(spec)
                if action=='terminate' and not terminal:
                    # Explicit CLI termination for non-Orca hosts; never target the IDE root.
                    exited=terminate_pid(spec['pids'][0],spec['process_started'])
                    result={'message':'CLI exit confirmed.' if exited else 'Termination requested; exit is not yet confirmed.','exited':exited}
                elif action=='resume':
                    with self.state_lock:mark=self.paused.get(sid)
                    if not mark or mark['key']!=key or mark['phase']!='paused':
                        raise ActionError('이 모니터에서 일시정지한 세션이 아니거나 이미 재개를 요청했습니다.')
                    if state not in ('idle','interrupted') or not terminal or spec.get('input_verified') is False:
                        raise ActionError('현재 대기 상태와 터미널 연결을 확인할 수 없습니다.')
                    # Persist before input. An ambiguous transport result must never duplicate a prompt.
                    self.remember(spec,'resuming')
                    receipt=self.orca('send','--terminal',terminal['handle'],'--text',RESUME_PROMPT,'--enter','--wait-submit','2')
                    started='turn_started' in (receipt.get('send',{}).get('prompt',{}).get('stages') or [])
                    result={'message':'이어서 작업하는 새 요청을 보냈습니다.'+(' 새 작업 시작을 확인했습니다.' if started else ' 실제 시작은 상태 갱신으로 확인합니다.'),'started':started}
                elif action=='pause':
                    if state in ('working','waiting'):
                        self.interrupt(spec);spec=self.wait_stopped(spec)
                    elif state not in ('idle','interrupted'):
                        raise ActionError('작업 상태를 확인할 수 없어 일시정지를 보류했습니다.')
                    self.remember(spec,'paused')
                    result={'message':'작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다.'}
                elif action=='interrupt':
                    if state in ('idle','interrupted'):
                        result={'message':'이미 작업이 멈춘 상태입니다. 세션을 유지했습니다.'}
                    elif state not in ('working','waiting'):
                        raise ActionError('작업 상태를 확인할 수 없습니다. 터미널에서 확인하세요.')
                    else:
                        self.interrupt(spec)
                        result={'message':'작업 중단을 요청했습니다. 실제 상태는 다음 수집 때 갱신됩니다.'}
                else:
                    if state in ('working','waiting'):
                        self.interrupt(spec);spec=self.wait_stopped(spec)
                    elif state not in ('idle','interrupted'):
                        raise ActionError('작업 상태를 확인할 수 없어 CLI 종료를 보류했습니다. 터미널에서 확인하세요.')
                    spec=self.resolve(sid,key)
                    if self.status(spec) not in ('idle','interrupted'):
                        raise ActionError('새 작업이 시작되어 종료를 보류했습니다.')
                    exited=terminate_pid(spec['pids'][0],spec['process_started'])
                    if exited:self.remember(spec,None)
                    result={'message':'CLI 종료를 확인했습니다. Orca 탭과 대화 기록은 유지됩니다.' if exited else
                            'CLI 종료 신호를 보냈습니다. 아직 프로세스 종료가 확인되지 않았습니다.','exited':exited}
            if action!='focus':
                with self.state_lock:
                    self.audit.append({'t':time.time(),'action':action,'sid':sid,'terminal':(terminal or {}).get('title'),
                                       'project':Path(spec.get('cwd','')).name,'message':result['message']})
                    self.audit=self.audit[-50:];self.save_state()
            self.receipts[rid]=(request,result)
            if len(self.receipts)>100:self.receipts.pop(next(iter(self.receipts)))
            return result
        finally:self.lock.release()
