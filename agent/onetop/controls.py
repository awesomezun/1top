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
from .mailbox import Mailbox, readable as mailbox_readable
from .message_images import ImageStore, decode_images, public_images
from .platform_support import data_directory


class ActionError(Exception):
    def __init__(self,message,status=409):
        super().__init__(message)
        self.status=status


class ActionBusy(ActionError):
    """No terminal input occurred; a queued message can be retried safely."""


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

def instruction_text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>4000 or any(ord(c)<32 and c not in '\n\t' or ord(c)==127 for c in value):
        raise ActionError('지시는 1–4,000자 텍스트로 입력하세요. 제어 문자는 사용할 수 없습니다.',400)
    return value


def terminal_title(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ActionError('터미널 제목은 제어 문자 없이 1–80자로 입력하세요.', 400)
    return value.strip()


def accepts_instruction(spec):
    if not spec.get('control_key'):return False
    state=spec.get('status','unknown')
    if spec['kind']=='Aside':return state in ('working','idle','interrupted')
    return bool(spec.get('orca_terminal') and spec.get('input_verified') is True and
                spec['kind'] in ('Claude','GLM','Codex') and state in ('idle','interrupted') and
                spec.get('display_status')!='resuming')


def accepts_message(spec):
    if not mailbox_readable(spec):return False
    if accepts_instruction(spec):return True
    return bool(spec.get('control_key') and spec.get('orca_terminal') and
                spec.get('input_verified') is True and spec['kind'] in ('Claude','GLM','Codex') and
                spec.get('status') in ('working','idle','interrupted'))


class Controller:
    def __init__(self,collector,factory,state_file=None):
        self.collector=collector
        self.factory=factory
        self.lock=threading.Lock()
        self.receipts={}
        self.interrupted={}
        self.state_lock=threading.Lock()
        self.state_file=state_file
        self.mailbox=Mailbox(Path(state_file).with_name('session-mailbox.json') if state_file else None)
        self.images=ImageStore(Path(state_file).parent/'attachments' if state_file else data_directory()/'attachments')
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
                if mark and s.get('status_at',0)>mark['at'] and (s.get('status')=='working' or mark['phase']=='resuming' and s.get('status') in ('idle','interrupted')):
                    self.paused.pop(s['id'],None);mark=None;changed=True
                if mark:
                    s['pause_state']=dict(mark)
                    if mark['phase']=='resuming':s['display_status']='resuming'
                    elif s.get('status') in ('idle','interrupted'):s['display_status']='paused'
                sessions.append(s)
            if changed:self.save_state()
            result = {**snapshot,'sessions':sessions,'actions':list(self.audit[-20:]),'resume_prompt':RESUME_PROMPT}
            if 'root_sessions' in snapshot:
                decorated = {s['id']: s for s in sessions}
                result['root_sessions'] = [{**s, 'display_status': decorated.get(s['id'], {}).get('display_status', s.get('status', 'unknown'))}
                                           for s in snapshot['root_sessions']]
            return result

    def resolve(self,sid,key,allow_continuation=False):
        if sid.startswith('aside:'):
            from .aside import resolve
            spec=resolve(sid,key)
            if not spec:raise ActionError('Aside 세션 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.')
            return spec
        fresh=self.factory();fresh.discover()
        spec=next((s for s in fresh.specs if s['id']==sid),None)
        if (not spec or not spec.get('control_key') or
                spec['control_key']!=key and not (allow_continuation and key in spec.get('continuation_keys', []))):
            raise ActionError('세션이나 터미널 연결이 변경되었습니다. 새로고침 후 다시 확인하세요.')
        if len(spec['pids'])!=1:raise ActionError('개별 CLI 프로세스를 확인할 수 없습니다.')
        return spec

    def flush_mailbox(self):
        if self.lock.locked():return
        with self.collector.lock:snapshot=self.collector.snapshot
        if time.time()-snapshot.get('updated',0)>20:return
        # Replies continue to be collected while the phone is disconnected.
        pending = self.mailbox.pending_sessions()
        for spec in snapshot.get('sessions',[]):
            if spec['id'] in pending:self.mailbox.read(spec)
        seen = set()
        for row in self.mailbox.queued():
            spec=next((s for s in snapshot.get('sessions',[]) if s['id']==row['session_id']),None)
            if (time.time()-row['created']>900 or spec and
                    spec.get('control_key')!=row['control_key'] and row['control_key'] not in spec.get('continuation_keys', [])):
                self.mailbox.delivery(row['id'],'not_delivered');continue
            if row['session_id'] in seen:continue
            seen.add(row['session_id'])
            if not spec or not accepts_instruction(spec):continue
            with self.state_lock:mark=self.paused.get(row['session_id'])
            if mark and mark['phase']=='resuming':continue
            try:
                result = self.execute({'action':'message','session_id':row['session_id'],'control_key':row['control_key'],
                              'request_id':row['id'],'prompt':row['text']}, _dispatch_queued=True)
                if not result.get('queued'):break
            except ActionBusy:
                continue
            except Exception:
                self.mailbox.delivery(row['id'],'delivery_unconfirmed')

    def read_mailbox(self,sid,key):
        with self.collector.lock:
            snapshot=self.collector.snapshot
            if time.time()-snapshot.get('updated',0)>20:raise ActionError('Computer report is stale.')
            spec=next((s for s in snapshot.get('sessions',[]) if s['id']==sid and
                       (s.get('control_key')==key or key in s.get('continuation_keys', []))),None)
        if not spec or not key or not mailbox_readable(spec):raise ActionError('Session reply source is unavailable.')
        return self.mailbox.read(spec)

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

    def enqueue_message(self, sid, key, rid, prompt, images):
        # Admit correspondence quickly, independently of long-running controls.
        # Dispatch re-discovers the process before any terminal input.
        with self.collector.lock:
            snapshot = self.collector.snapshot
            if time.time()-snapshot.get('updated',0)>20:raise ActionError('Computer report is stale. Nothing sent.')
            spec = next((dict(s) for s in snapshot.get('sessions',[]) if s['id']==sid and
                         (s.get('control_key')==key or key in s.get('continuation_keys',[]))),None)
        if not spec or not accepts_message(spec):raise ActionError('This session cannot receive messages right now.')
        try:
            if images:
                if spec['kind'] not in ('Claude','GLM','Codex'):raise ActionError('This session cannot receive photos right now.')
                images = self.images.stage(rid,sid,images)
            row = self.mailbox.enqueue(spec,rid,prompt,images)
        except (ValueError,OSError) as error:
            raise ActionError(str(error) if isinstance(error,ValueError) else 'Could not save this message. Nothing sent.') from None
        return {'message':'메시지를 저장했습니다. 현재 작업이 끝나면 접수 순서대로 전달합니다.' if row['status']=='queued' else '이미 접수한 메시지입니다. 대화에서 결과를 확인하세요.',
                'queued':row['status']=='queued','status':row['status']}

    def execute(self,payload, _dispatch_queued=False):
        action=payload.get('action');sid=payload.get('session_id');key=payload.get('control_key');rid=payload.get('request_id')
        if action not in ('focus','interrupt','pause','resume','terminate','prompt','message','rename') or not all(isinstance(x,str) and x for x in (sid,key,rid)):
            raise ActionError('잘못된 동작 요청입니다.',400)
        prompt=instruction_text(payload.get('prompt')) if action in ('prompt','message') else None
        title=terminal_title(payload.get('title')) if action=='rename' else None
        queued = next((r for r in self.mailbox.queued() if r['id']==rid and r['session_id']==sid), None) if _dispatch_queued else None
        if payload.get('attachments') and action != 'message':raise ActionError('Photos require a conversation message.',400)
        try:
            images = queued.get('attachments', []) if queued else decode_images(payload.get('attachments', []))
        except ValueError as error:raise ActionError(str(error),400) from None
        if action == 'message' and not _dispatch_queued:
            return self.enqueue_message(sid,key,rid,prompt,images)
        if _dispatch_queued and not queued:raise ActionError('Queued message no longer exists.')
        if not self.lock.acquire(blocking=False):raise ActionBusy('이전 동작을 처리 중입니다. 잠시 후 다시 시도하세요.')
        try:
            content=title if action=='rename' else prompt
            if images:content=json.dumps([content,public_images(images)],sort_keys=True,separators=(',',':'))
            request=(action,sid,key,hashlib.sha256(content.encode()).hexdigest() if content is not None else None)
            if rid in self.receipts:
                previous,result=self.receipts[rid]
                if previous!=request:raise ActionError('요청 ID가 이미 사용되었습니다.')
                if not (_dispatch_queued and result.get('queued')):return result
            # Only correspondence may follow a proven continuation. A stale
            # destructive control must still be reconfirmed against the new PID.
            spec=self.resolve(sid,key,allow_continuation=True) if action=='message' else self.resolve(sid,key)
            terminal=spec.get('orca_terminal')
            if action=='rename':
                if not terminal or not terminal.get('handle'):
                    raise ActionError('제목을 변경할 Orca 터미널 연결을 확인할 수 없습니다.')
                self.orca('rename','--terminal',terminal['handle'],'--title',title)
                # Publish the confirmed metadata immediately; re-discover on the next tick.
                with self.collector.lock:
                    for row in (*self.collector.snapshot.get('sessions', []),
                                *self.collector.snapshot.get('root_sessions', []),
                                *getattr(self.collector, 'specs', [])):
                        current = row.get('orca_terminal') or {}
                        if (current.get('handle'), current.get('incarnationId')) == (terminal['handle'], terminal.get('incarnationId')):
                            row['orca_terminal'] = {**current, 'title': title}
                    self.collector.discovery_at = 0
                result={'message':f'터미널 제목을 {title}(으)로 변경했습니다.','title':title}
            elif action in ('prompt','message'):
                current={**spec,'status':self.status(spec)}
                if images:
                    if current['kind'] not in ('Claude','GLM','Codex') or not accepts_message(current):
                        raise ActionError('This session cannot receive photos right now.')
                    try:images = self.images.restore(rid,sid,images) if queued else self.images.stage(rid,sid,images)
                    except (ValueError,OSError) as error:raise ActionError(str(error) if isinstance(error,ValueError) else 'The attached photo could not be read. Nothing sent.') from None
                with self.state_lock:mark=self.paused.get(sid)
                if mark and mark['key']==key and mark['phase']=='resuming':
                    raise ActionBusy('이미 지시 전송을 요청했습니다. 세션에서 결과를 확인하세요.')
                if action=='message' and current['kind']!='Aside' and current['status']=='working' and accepts_message(current):
                    result={'message':'작업을 중단하지 않고 세션이 대기 상태가 되면 메시지를 전달합니다.','queued':True}
                    self.receipts[rid]=(request,result)
                    return result
                if not accepts_instruction(current):
                    raise ActionError('이 세션의 입력 가능한 대기 상태를 확인할 수 없습니다. 실행 중이면 작업을 중단한 뒤 다시 확인하세요.')
                # Save an uncertain receipt before input, so transport errors never replay it.
                self.receipts[rid]=(request,{'message':'이 지시의 전달 결과가 미확인입니다. 세션에서 확인한 뒤 새 요청을 보내세요.','started':False})
                if action=='message':
                    try:prompt=self.mailbox.begin(spec,rid,prompt,images)
                    except (OSError,ValueError):raise ActionError('이 세션의 답신 연결을 확인하지 못했습니다. 메시지를 전송하지 않았습니다.')
                if spec['kind']=='Aside':
                    from .aside import cli_path
                    mode='queue' if current['status']=='working' else 'resume'
                    try:
                        sent=subprocess.run([str(cli_path()),'session',mode,'--account',spec['aside_account'],'--',spec['aside_session'],prompt],capture_output=True,text=True,timeout=12)
                        if sent.returncode:raise ActionError('Aside에서 지시 접수 여부를 확인하지 못했습니다. 세션을 확인하세요.')
                    except (OSError,subprocess.TimeoutExpired):raise ActionError('지시 전달 결과가 미확인입니다. 자동으로 다시 보내지 않습니다.')
                    result={'message':'다음 단계에 실행할 지시를 접수했습니다.' if mode=='queue' else 'AI 세션에 지시를 전달했습니다. 작업 시작은 상태 갱신으로 확인합니다.','started':False}
                else:
                    self.remember(spec,'resuming')
                    receipt=self.orca('send','--terminal',terminal['handle'],'--text',prompt,'--enter','--wait-submit','2')
                    started='turn_started' in (receipt.get('send',{}).get('prompt',{}).get('stages') or [])
                    result={'message':'AI 지시를 보냈고 새 작업 시작을 확인했습니다.' if started else 'AI 지시를 보냈습니다. 새 작업 시작은 아직 미확인입니다.','started':started}
                if action=='message':self.mailbox.delivery(rid,'awaiting_reply')
            elif spec['kind']=='Aside' and action!='focus':
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
