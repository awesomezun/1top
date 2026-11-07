import gzip
import http.client
import json
import tempfile
import threading
import time
import tomllib
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from contextlib import closing

from onetop.accounts import identity
from onetop.server import DashboardHTTPServer, Handler
from onetop.telemetry import (TelemetryStore, bind_account, decode, enrich,
                              normalize, receiver_key, session_index, MAX_BODY)
from onetop.telemetry_setup import enable, disable


def attributes(values):
    return [{'key': k, 'value': {'stringValue': str(v)}} for k,v in values.items()]


def logs(values=None, now=None, sid='session-1', kind='Claude'):
    now = time.time() if now is None else now
    a = {'event.name': 'api_request', 'session.id': sid, 'model': 'claude-test',
         'input_tokens': 10, 'cache_read_tokens': 20, 'cache_creation_tokens': 30,
         'output_tokens': 40, 'request_id': 'request-1'} if kind == 'Claude' else {
         'event.name': 'codex.sse_event', 'event.kind': 'response.completed',
         'conversation.id': sid, 'model': 'gpt-test', 'input_token_count': 100,
         'cached_token_count': 60, 'output_token_count': 20, 'reasoning_token_count': 10}
    a.update(values or {})
    return {'resourceLogs': [{'resource': {'attributes': attributes({'service.name': 'claude-code' if kind == 'Claude' else 'codex_cli_rs'})},
        'scopeLogs': [{'logRecords': [{'timeUnixNano': str(int(now*1e9)),
            'body': {'stringValue': 'SECRET PROMPT'}, 'attributes': attributes(a)}]}]}]}


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.store = TelemetryStore(self.directory)
        self.now = time.time()

    def test_request_tokens_cache_and_retry_dedup_survive_restart(self):
        data = logs(now=self.now)
        self.assertEqual(self.store.ingest('logs', data)['accepted'], 1)
        self.assertEqual(self.store.ingest('logs', data)['duplicates'], 1)
        restarted = TelemetryStore(self.directory)
        self.assertEqual(restarted.ingest('logs', logs(now=self.now+1))['duplicates'], 1)
        s = restarted.snapshot(self.now+2)['sessions'][0]
        self.assertEqual(s['tokens_24h'], [10,20,30,40])
        self.assertEqual(s['request_count'], 1)

    def test_codex_cache_and_reasoning_not_double_counted(self):
        self.store.ingest('logs', logs(kind='Codex', now=self.now))
        s = self.store.snapshot(self.now+1)['sessions'][0]
        self.assertEqual(s['tokens_24h'], [40,60,0,20])

    def test_codex_zero_timestamp_uses_reported_event_time_and_nullable_oneof(self):
        data=logs({'event.timestamp':datetime.fromtimestamp(self.now,timezone.utc).isoformat()},kind='Codex',now=self.now)
        record=data['resourceLogs'][0]['scopeLogs'][0]['logRecords'][0]
        record['timeUnixNano']='0';record['body']=None
        record['attributes'].append({'key':'cache_write_token_count','value':{'stringValue':None,'intValue':'5','boolValue':None}})
        self.store.ingest('logs',data)
        s=self.store.snapshot(self.now+1)['sessions'][0]
        self.assertEqual(s['tokens_24h'],[40,60,5,20])

    def test_metrics_and_traces_do_not_add_request_tokens(self):
        self.store.ingest('logs', logs(now=self.now))
        a = attributes({'service.name':'claude-code', 'session.id':'session-1', 'type':'input'})
        data = {'resourceMetrics': [{'resource': {'attributes': a}, 'scopeMetrics': [{'metrics': [
            {'name': 'claude_code.token.usage', 'sum': {'aggregationTemporality': 2, 'dataPoints': [
                {'timeUnixNano': str(int(self.now*1e9)), 'asInt': '1000'}]}}]}]}]}
        self.store.ingest('metrics', data)
        trace = {'resourceSpans': [{'resource': {'attributes': a}, 'scopeSpans': [{'spans': [
            {'name':'claude_code.llm_request', 'endTimeUnixNano':str(int(self.now*1e9)),
             'startTimeUnixNano':str(int((self.now-2)*1e9)), 'spanId':'1122334455667788',
             'attributes':attributes({'input_tokens':1000,'output_tokens':50})}]}]}]}
        self.store.ingest('traces', trace)
        s = self.store.snapshot(self.now+1)['sessions'][0]
        self.assertEqual(s['tokens_24h'], [10,20,30,40])
        self.assertEqual(s['signals'], ['logs','metrics','traces'])
        self.assertEqual(s['duration_ms'], 2000)

    def test_no_prompt_tool_content_or_raw_identity_stored(self):
        self.store.ingest('logs', logs({'prompt':'PRIVATE-PROMPT','arguments':'PRIVATE-COMMAND',
            'output':'PRIVATE-OUTPUT', 'user.email':'PRIVATE-EMAIL', 'user.account_uuid':'private-account',
            'organization.id':'private-org', 'error':'PRIVATE-ERROR'}, now=self.now))
        with closing(self.store.connect()) as db:
            data = db.execute('SELECT data FROM records').fetchone()[0]
        for secret in ['PRIVATE-', 'SECRET PROMPT', 'private-account', 'private-org']:
            self.assertNotIn(secret, data)
        s = self.store.snapshot(self.now+1)['sessions'][0]
        self.assertEqual(s['account_id'], identity('Claude','private-account','private-org'))
        self.assertEqual(s['error_count'], 1)

    def test_exact_identity_binding_no_retroactive_or_model_based_guess(self):
        self.store.ingest('logs', logs({'user.account_uuid':'a','organization.id':'o'}, now=self.now))
        index = session_index(self.store.snapshot(self.now+1))
        key = identity('Claude','a','o')
        roots = {Path('/profile'): (key,'Claude',self.now-100)}
        spec = {'id':'session-1','kind':'Claude','account_binding':('wrong',0)}
        bind_account(spec,index,roots,self.now+1)
        self.assertEqual(spec['account_binding'], (key,self.now))
        wrong = {'id':'other','kind':'Claude','account_binding':None}
        bind_account(wrong,index,roots,self.now+1)
        self.assertIsNone(wrong['account_binding'])
        bind_account(spec,index,{},self.now+1)
        self.assertIsNone(spec['account_binding'])

    def test_login_switch_uses_latest_request_identity_not_old_cumulative_metrics(self):
        self.now -= 180
        for offset,account in [(0,'old'),(60,'new')]:
            self.store.ingest('logs',logs({'user.account_uuid':account,'organization.id':'o',
                'request_id':f'request-{offset}'},now=self.now+offset))
        data={'resourceMetrics':[{'resource':{'attributes':attributes({'service.name':'claude-code',
            'session.id':'session-1','user.account_uuid':'old','organization.id':'o'})},'scopeMetrics':[{'metrics':[
            {'name':'claude_code.token.usage','sum':{'aggregationTemporality':2,'dataPoints':[
                {'timeUnixNano':str(int((self.now+120)*1e9)),'asInt':'1000'}]}}]}]}]}
        self.store.ingest('metrics',data)
        report=self.store.snapshot(self.now+130)['sessions'][0]
        self.assertEqual(report['account_id'],identity('Claude','new','o'))
        self.assertEqual(report['account_since'],self.now+60)
        spec={'id':'session-1','kind':'Claude','account_binding':('wrong',0)}
        bind_account(spec,session_index(self.store.snapshot(self.now+3600)),
                     {Path('/profile'):(identity('Claude','new','o'),'Claude',0)},self.now+3600)
        self.assertEqual(spec['account_binding'],(identity('Claude','new','o'),self.now+60))

    def test_conflicting_accounts_disable_profile_guess(self):
        for i in range(2):
            self.store.ingest('logs', logs({'user.account_uuid':str(i),'request_id':f'req-{i}'},now=self.now+i))
        index = session_index(self.store.snapshot(self.now+2))
        spec = {'id':'session-1','kind':'Claude','account_binding':('wrong',0)}
        bind_account(spec,index,{Path('/profile'):('wrong','Claude',0)},self.now+2)
        self.assertIsNone(spec['account_binding'])

    def test_model_effort_freshness_and_agent_scope(self):
        self.store.ingest('logs', logs({'effort':'xhigh'},now=self.now))
        index = session_index(self.store.snapshot(self.now+1))
        spec = {'id':'session-1','kind':'Claude','model':'old','model_updated':self.now-2,'tokens':[1,2,3,4]}
        enrich(spec,index)
        self.assertEqual((spec['model'],spec['effort']),('claude-test','xhigh'))
        self.assertEqual(spec['tokens'],[1,2,3,4])
        spec['model'] = 'new';spec['model_updated'] = self.now+5
        enrich(spec,index)
        self.assertEqual(spec['model'],'new')
        index[('Claude','session-1')]['agent_id'] = 'child-1'
        spec['model_updated'] = 0
        enrich(spec,index)
        self.assertEqual(spec['model'],'new')

    def test_invalid_negative_missing_or_future_tokens_not_spend(self):
        for values in [{'input_tokens':-1},{'input_tokens':'nan'},{'input_tokens':None},
                       {'cache_read_tokens':-10},{'output_tokens':1.5}]:
            records,_ = normalize('logs',logs(values,now=self.now),self.now)
            self.assertIsNone(records[0]['tokens'])
        self.assertEqual(normalize('logs',logs(now=self.now+500),self.now)[0],[])
        self.assertEqual(normalize('logs',logs({'session.id':''},now=self.now),self.now)[0],[])

    def test_metric_for_old_model_cannot_change_current_model(self):
        self.store.ingest('logs',logs({'effort':'high'},now=self.now-2))
        data={'resourceMetrics':[{'resource':{'attributes':attributes({'service.name':'claude-code','session.id':'session-1'})},
            'scopeMetrics':[{'metrics':[{'name':'claude_code.token.usage','sum':{'dataPoints':[{
                'timeUnixNano':str(int(self.now*1e9)),'asInt':'100',
                'attributes':attributes({'model':'OLD-MODEL','effort':'low'})}]}}]}]}]}
        self.store.ingest('metrics',data)
        s=self.store.snapshot(self.now+1)['sessions'][0]
        self.assertEqual((s['model'],s['effort']),('claude-test','high'))

    def test_remote_snapshot_does_not_include_local_telemetry(self):
        from onetop.bridge import export_snapshot
        data={'sessions':[{'id':'s','kind':'Claude','telemetry':{'private_detail':'local-only'}}],
              'telemetry':{'private_detail':'local-only'}}
        remote=export_snapshot(data)
        self.assertNotIn('telemetry',json.dumps(remote))
        self.assertNotIn('local-only',json.dumps(remote))

    def test_json_gzip_and_protobuf_transport(self):
        document = logs(now=self.now)
        self.assertEqual(decode(gzip.compress(json.dumps(document).encode()),'logs','application/json','gzip'),document)
        from google.protobuf.json_format import ParseDict
        from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
        encoded = ParseDict(document,ExportLogsServiceRequest()).SerializeToString()
        result = decode(encoded,'logs','application/x-protobuf')
        self.assertEqual(normalize('logs',result,self.now)[0],normalize('logs',document,self.now)[0])
        with self.assertRaises(ValueError):
            decode(gzip.compress(b'x'*(MAX_BODY+1)),'logs','application/json','gzip')

    def test_receiver_auth_browser_rejection_and_real_http_dedup(self):
        server = DashboardHTTPServer(('127.0.0.1',0),Handler)
        server.telemetry_key = receiver_key(self.directory)
        server.collector = SimpleNamespace(telemetry=self.store)
        thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def post(extra):
            conn = http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            conn.request('POST','/v1/logs',json.dumps(logs(now=self.now)),
                {'Content-Type':'application/json',**extra})
            r = conn.getresponse();code = r.status;r.read();conn.close();return code
        self.assertEqual(post({}),403)
        self.assertEqual(post({'X-1top-Telemetry-Key':server.telemetry_key,'Origin':'http://evil.test'}),403)
        self.assertEqual(post({'X-1top-Telemetry-Key':server.telemetry_key}),200)
        self.assertEqual(post({'X-1top-Telemetry-Key':server.telemetry_key}),200)
        self.assertEqual(self.store.snapshot(self.now+1)['stored_records'],1)
        self.assertNotIn(server.telemetry_key,json.dumps(self.store.snapshot(self.now+1)))


class TelemetryEnrollmentTests(unittest.TestCase):
    def test_round_trip_preserves_user_settings_and_restores_owned_keys_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);claude=root/'claude';codex=root/'codex';data=root/'data'
            claude.mkdir();codex.mkdir()
            settings = {'statusLine':{'command':'my-renderer'},'env':{'KEEP':'yes'}}
            (claude/'settings.json').write_text(json.dumps(settings))
            (codex/'config.toml').write_text('model = "keep-model"\n# keep comment\n')
            result = enable(data,[('Claude',claude),('Codex',codex)])
            self.assertEqual([r['status'] for r in result['profiles']],['enabled','enabled'])
            config = tomllib.loads((codex/'config.toml').read_text())
            self.assertEqual(config['model'],'keep-model')
            self.assertIn('otlp-http',config['otel']['exporter'])
            updated = json.loads((claude/'settings.json').read_text());updated['newSetting']=True
            (claude/'settings.json').write_text(json.dumps(updated))
            self.assertEqual(enable(data,[('Claude',claude)])['profiles'][0]['status'],'already_enrolled')
            disable(data)
            self.assertEqual(json.loads((claude/'settings.json').read_text()),{**settings,'newSetting':True})
            self.assertNotIn('otel',tomllib.loads((codex/'config.toml').read_text()))
            self.assertIn('# keep comment',(codex/'config.toml').read_text())

    def test_existing_external_exporters_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);claude=root/'claude';codex=root/'codex';claude.mkdir();codex.mkdir()
            cc='{"env":{"OTEL_EXPORTER_OTLP_ENDPOINT":"https://existing.test"}}'
            cx='[otel]\nexporter = "none"\n'
            (claude/'settings.json').write_text(cc);(codex/'config.toml').write_text(cx)
            result=enable(root/'data',[('Claude',claude),('Codex',codex)])
            self.assertTrue(all(r['status']=='existing_telemetry_preserved' for r in result['profiles']))
            self.assertEqual((claude/'settings.json').read_text(),cc)
            self.assertEqual((codex/'config.toml').read_text(),cx)
