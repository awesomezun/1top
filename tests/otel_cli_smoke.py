"""Exercise installed CLI exporters against LOCAL fake model APIs, never paid APIs.

Usage: PYTHONPATH=agent python tests/otel_cli_smoke.py [claude|codex]
All configuration, token reports and transcripts stay in a temporary directory.
"""
import json
import os
import shutil
import queue
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from onetop.server import DashboardHTTPServer, Handler
from onetop.telemetry import TelemetryStore, receiver_key, SIGNALS, attrs
from onetop.telemetry_setup import enable


class ModelFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append(self.path)
        model=data.get('model','fixture-model')
        if self.path.endswith('/messages') or '/messages?' in self.path:
            message={'id':'msg_onetop_smoke','type':'message','role':'assistant','content':[],
                     'model':model,'stop_reason':None,'stop_sequence':None,
                     'usage':{'input_tokens':11,'output_tokens':0,'cache_read_input_tokens':0,'cache_creation_input_tokens':0}}
            events=[('message_start',{'type':'message_start','message':message}),
                    ('content_block_start',{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}}),
                    ('content_block_delta',{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'OK'}}),
                    ('content_block_stop',{'type':'content_block_stop','index':0}),
                    ('message_delta',{'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':1}}),
                    ('message_stop',{'type':'message_stop'})]
        elif self.path.endswith('/responses'):
            time.sleep(6)  # Give the real CLI's batched exporter time to flush.
            item={'id':'msg_fixture','type':'message','role':'assistant','status':'completed',
                  'content':[{'type':'output_text','text':'OK','annotations':[]}]}
            response={'id':'resp_fixture','object':'response','created_at':int(time.time()),'model':model,
                      'status':'completed','output':[item],
                      'usage':{'input_tokens':11,'input_tokens_details':{'cached_tokens':0},
                               'output_tokens':1,'output_tokens_details':{'reasoning_tokens':0},'total_tokens':12}}
            events=[('response.created',{'type':'response.created','response':{**response,'status':'in_progress','output':[]}}),
                    ('response.output_item.added',{'type':'response.output_item.added','output_index':0,'item':{**item,'status':'in_progress','content':[]}}),
                    ('response.output_text.delta',{'type':'response.output_text.delta','item_id':'msg_fixture','output_index':0,'content_index':0,'delta':'OK'}),
                    ('response.output_item.done',{'type':'response.output_item.done','output_index':0,'item':item}),
                    ('response.completed',{'type':'response.completed','response':response})]
        else:
            self.send_response(404);self.end_headers();return
        raw=''.join('event: '+name+'\ndata: '+json.dumps(payload)+'\n\n' for name,payload in events).encode()
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        self.send_response(404);self.end_headers()
    def log_message(self,*args):pass


def codex_server(cmd, env, root):
    """Use the same long-lived app-server transport as desktop integrations."""
    with (root/'stderr.log').open('w+') as errors:
        process=subprocess.Popen(cmd,env=env,cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                 stderr=errors,text=True,bufsize=1)
        def send(message):
            process.stdin.write(json.dumps(message)+'\n');process.stdin.flush()
        send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'1top_smoke','version':'1.0.0'},
                                                    'capabilities':{'experimentalApi':True}}})
        deadline=time.monotonic()+40;done=False;diagnostic=[]
        incoming=queue.Queue()
        def read_lines():
            for line in process.stdout:incoming.put(line)
        reader=threading.Thread(target=read_lines,daemon=True);reader.start()
        try:
            while time.monotonic()<deadline and process.poll() is None:
                try:line=incoming.get(timeout=.2)
                except queue.Empty:continue
                row=json.loads(line)
                if row.get('error'):diagnostic.append(row['error'])
                if row.get('id')==1:
                    send({'method':'initialized'})
                    send({'id':2,'method':'thread/start','params':{'model':'gpt-5.1','modelProvider':'onetop_fixture',
                          'cwd':str(root),'approvalPolicy':'never','sandbox':'read-only'}})
                if row.get('id')==2 and row.get('result'):
                    send({'id':3,'method':'turn/start','params':{'threadId':row['result']['thread']['id'],
                          'input':[{'type':'text','text':'Reply OK.'}]}})
                if row.get('method')=='turn/completed':
                    done=True;time.sleep(6);break
            process.stdin.close()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=5)
        finally:
            if process.poll() is None:process.kill();process.wait()
            reader.join(2);process.stdout.close()
        errors.seek(0)
        return SimpleNamespace(returncode=0 if done else 1,stdout=json.dumps(diagnostic),stderr=errors.read())


def main():
    provider=sys.argv[1] if len(sys.argv)>1 else 'claude'
    with tempfile.TemporaryDirectory(prefix='1top-otel-smoke-') as tmp:
        root=Path(tmp);profile=root/'profile';profile.mkdir()
        store=TelemetryStore(root/'data')
        shapes=[]
        ingest=store.ingest
        def capture_shape(signal,document,now=None):
            group_key,scope_key,records_key=SIGNALS[signal]
            for group in document.get(group_key,[])[:10]:
                for scope in group.get(scope_key,[])[:20]:
                    for record in scope.get(records_key,[])[:256]:
                        a=attrs(record.get('attributes'))
                        point=(record.get('sum') or record.get('histogram') or {}).get('dataPoints',[{}])[0]
                        text=(record.get('body') or {}).get('stringValue') or ''
                        try:body=json.loads(text)
                        except (ValueError,TypeError):body={}
                        shapes.append({'signal':signal,'record_keys':sorted(record),'attribute_keys':sorted(a),
                                       'event_name':a.get('event.name'),'name':record.get('name'),'body_keys':sorted(record.get('body') or {}),
                                       'metric_attribute_keys':sorted(attrs(point.get('attributes'))),
                                       'body_json_keys':sorted(body) if isinstance(body,dict) else [],
                                       'body_preview':text[:250] if signal=='logs' else '',
                                       'resource_keys':sorted(attrs((group.get('resource') or {}).get('attributes')))})
            return ingest(signal,document,now)
        store.ingest=capture_shape
        received_headers=[]
        class ProbeHandler(Handler):
            def do_POST(self):
                received_headers.append({k:self.headers.get(k) for k in ('Content-Length','Content-Type','Content-Encoding','Transfer-Encoding')})
                super().do_POST()
        receiver=DashboardHTTPServer(('127.0.0.1',0),ProbeHandler)
        receiver.telemetry_key=receiver_key(root/'data')
        receiver.collector=SimpleNamespace(telemetry=store)
        model=ThreadingHTTPServer(('127.0.0.1',0),ModelFixture);model.requests=[]
        for server in (receiver,model):
            threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            enable(root/'data',[(provider.title(),profile)],receiver.server_port)
            env={k:v for k,v in os.environ.items() if not k.startswith(('OTEL_','ANTHROPIC_','OPENAI_','CODEX_','CLAUDE_CODE_OAUTH')) and k not in ('CLAUDECODE','CLAUDE_CONFIG_DIR')}
            if provider=='claude':
                env.update(CLAUDE_CONFIG_DIR=str(profile),ANTHROPIC_API_KEY='local-fixture-only',
                           ANTHROPIC_BASE_URL=f'http://127.0.0.1:{model.server_port}',
                           CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
                # That switch disables telemetry too: opt in explicitly for this test.
                env.pop('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
                cmd=[shutil.which('claude'),'-p','--model','claude-sonnet-4-6','--max-turns','1',
                     '--tools','','--no-session-persistence','--output-format','json','Reply OK.']
            else:
                env.update(CODEX_HOME=str(profile),ONETOP_FIXTURE_KEY='local-fixture-only')
                cmd=[shutil.which('codex'),
                     '-c','model_provider="onetop_fixture"',
                     '-c','model_providers.onetop_fixture.name="Local fixture"',
                     '-c',f'model_providers.onetop_fixture.base_url="http://127.0.0.1:{model.server_port}/v1"',
                     '-c','model_providers.onetop_fixture.env_key="ONETOP_FIXTURE_KEY"',
                     '-c','model_providers.onetop_fixture.wire_api="responses"',
                     'app-server','--listen','stdio://']
            process=(subprocess.run(cmd,env=env,cwd=root,capture_output=True,text=True,timeout=50)
                     if provider=='claude' else codex_server(cmd,env,root))
            snapshot=store.snapshot(time.time()+1)
            result={'provider':provider,'exit_code':process.returncode,'model_requests':model.requests,
                    'stored_records':snapshot.get('stored_records',0),
                    'received_records':snapshot.get('received_records',0),'wire_shapes':([s for s in shapes if s['signal']=='logs'] or shapes)[:12],
                    'metric_names':sorted({s['name'] for s in shapes if s.get('name')}),
                    'receiver_error_type':getattr(receiver,'telemetry_last_error',None),'request_headers':received_headers[:8],
                    'sessions':snapshot['sessions'],'isolated_local_fixture':True}
            if process.returncode or not snapshot['sessions']:
                result['diagnostic']=(process.stderr+'\n'+process.stdout)[-2500:]
            print(json.dumps(result,indent=2))
            if process.returncode or not any(s['token_reports'] for s in snapshot['sessions']):
                return 1
            return 0
        finally:
            for server in (receiver,model):server.shutdown();server.server_close()


if __name__=='__main__':sys.exit(main())
