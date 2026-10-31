import io
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock,patch

from onetop.accounts import identity
from onetop.claude_profiles import CredentialError
from onetop.gateway import GatewayService,Router,prepare,server
from onetop.routing_credentials import Credentials
from onetop.routing_policy import choose,failure_policy,quota_deadline,retry_seconds


def account(key,kind='Claude',windows=None):
    return {'id':key,'kind':kind,'windows':windows or [],'stale':False}


class Response(io.BytesIO):
    def __init__(self,status,body=b'ok',headers=None):
        super().__init__(body);self.status=status;self.headers=headers or {'Content-Type':'text/event-stream'}


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)
        self.sampler=Mock();self.sampler.snapshot.return_value=[account('a'),account('b')]
        self.credentials=Mock();self.credentials.get.side_effect=lambda a,**kwargs:{'Authorization':'Bearer '+a['id'],'_account_uuid':a['id']}
        self.send=Mock(return_value=Response(200))
        self.router=Router(self.directory,self.sampler,self.credentials,self.send,clock=lambda:1000)

    def route(self,router=None,session=None):
        return (router or self.router).route('/claude/v1/messages',{'model':'claude-opus','messages':[]},
                                            {'x-onetop-session':session} if session else {})

    def test_all_applicable_windows_gate_accounts_and_expired_reports_do_not(self):
        a=account('a',windows=[{'pct':100,'reset':1100},{'pct':100,'reset':5000},
                               {'pct':100,'reset':9000,'scope':'mcp'}])
        self.assertEqual(quota_deadline(a,'claude-opus',1000),5000)
        self.sampler.snapshot.return_value=[a,account('b')]
        status,_,stream,key,_=self.route();stream.close()
        self.assertEqual((status,key),(200,'b'))
        self.assertEqual(self.send.call_args.args[1]['Authorization'],'Bearer b')
        self.assertIsNone(quota_deadline(a,'claude-opus',6000))
        a['stale']=True;self.assertIsNone(quota_deadline(a,'claude-opus',1000))
        self.assertIsNone(quota_deadline(account('x',windows=[{'pct':100,'model':'other'}]),'claude-opus',1000))

    def test_429_rotates_once_and_persists_cooldown_without_prompt_or_credentials(self):
        self.send.side_effect=[Response(429,b'{"error":{"code":"usage_limit_reached"}}',{'Retry-After':'60'}),Response(200,b'data: done\n\n')]
        status,_,stream,key,rid=self.route(session='test-session');self.assertEqual(stream.read(),b'data: done\n\n');stream.close()
        self.assertEqual((status,key),(200,'b'));self.assertEqual(self.send.call_count,2)
        self.assertEqual(self.router._cooldowns(),{('a','claude-opus'):1060})
        restarted=Router(self.directory,self.sampler,self.credentials,Mock(return_value=Response(200)),clock=lambda:1001)
        response=self.route(restarted);response[2].close();self.assertEqual(response[3],'b')
        recent=self.router.status()['recent_requests']
        self.assertEqual([row['reason'] for row in recent],['accepted','accepted','quota'])
        self.assertNotIn('Bearer',self.directory.joinpath('gateway.sqlite').read_bytes().decode(errors='ignore'))
        self.assertNotIn('test-session',str(recent))
        self.assertEqual(recent[-1]['request_id'],rid)

    def test_affinity_survives_cooldown_expiry_and_does_not_cross_provider(self):
        self.send.side_effect=[Response(429),Response(200),Response(200)]
        first=self.route(session='same');first[2].close()
        self.router.clock=lambda:2000
        second=self.route(session='same');second[2].close()
        self.assertEqual(first[3],second[3]);self.assertEqual(second[3],'b')
        selected,_=choose([account('b'),account('z','Codex')],'Codex','gpt',1000,set(),{},preferred='b')
        self.assertEqual(selected['id'],'z')

    def test_401_refreshes_same_account_then_falls_back_after_second_rejection(self):
        self.send.side_effect=[Response(401),Response(401),Response(200)]
        response=self.route();response[2].close();self.assertEqual(response[3],'b')
        calls=self.credentials.get.call_args_list
        self.assertEqual(calls[1].kwargs,{'force':True,'rejected':'Bearer a'})
        self.assertEqual([c.args[0]['id'] for c in calls],['a','a','b'])

    def test_successful_refresh_does_not_change_account(self):
        self.send.side_effect=[Response(401),Response(200)]
        response=self.route();response[2].close();self.assertEqual(response[3],'a')
        self.assertEqual(self.send.call_count,2)

    def test_account_changed_before_send_falls_back(self):
        self.credentials.get.side_effect=[CredentialError('account_changed'),{'Authorization':'Bearer b'}]
        response=self.route();response[2].close()
        self.assertEqual(response[3],'b');self.assertEqual(self.send.call_count,1)

    def test_request_error_and_uncertain_transport_are_not_replayed(self):
        self.send.side_effect=[Response(400,b'{"error":{"message":"bad model"}}')]
        response=self.route();self.assertEqual(response[0],400);response[2].close()
        self.assertEqual(self.send.call_count,1)
        self.send.reset_mock();self.send.side_effect=TimeoutError()
        response=self.route();self.assertEqual(response[0],502);response[2].close()
        self.assertEqual(self.send.call_count,1)

    def test_no_available_account_reports_reset_and_never_sends(self):
        self.sampler.snapshot.return_value=[account('a',windows=[{'pct':100,'reset':1200}]),account('b',windows=[{'pct':100,'reset':1500}])]
        response=self.route();self.assertEqual(response[0],503)
        self.assertEqual(json.load(response[2])['error']['retry_at'],1200);response[2].close();self.send.assert_not_called()

    def test_failure_policy_distinguishes_rate_quota_and_temporary(self):
        rate=failure_policy(429,{}, {},1000);quota=failure_policy(429,{}, {'error':{'type':'usage_limit_reached','resets_at':9000}},1000)
        self.assertEqual((rate['reason'],rate['until']),('rate_limit',1030))
        self.assertEqual((quota['reason'],quota['until']),('quota',9000))
        self.assertEqual(failure_policy(503,{'Retry-After':'25'},{},1000)['until'],1025)
        self.assertEqual(retry_seconds('Thu, 01 Jan 1970 00:20:00 GMT',1000),200)

    def test_protocol_metadata_binds_selected_account_without_mutating_original(self):
        payload={'model':'claude-opus','metadata':{'user_id':json.dumps({'account_uuid':'old','session_id':'session','device_id':'device'})}}
        url,headers,body=prepare('Claude','messages',{'Authorization':'Bearer private','_account_uuid':'new'},payload,
                                 {'authorization':'Bearer local','x-api-key':'local','anthropic-beta':'feature','user-agent':'native'})
        self.assertEqual(url,'https://api.anthropic.com/v1/messages')
        self.assertNotIn('local',str(headers));self.assertNotIn('_account_uuid',headers)
        self.assertEqual(json.loads(json.loads(body)['metadata']['user_id']),{'account_uuid':'new','session_id':'session','device_id':'device'})
        self.assertEqual(json.loads(payload['metadata']['user_id'])['account_uuid'],'old')
        self.assertEqual(headers['anthropic-beta'],'feature,oauth-2025-04-20')

    def test_http_auth_streaming_and_no_replay_after_stream_begins(self):
        self.send.return_value=Response(200,b'data: {"delta":"test"}\n\ndata: [DONE]\n\n')
        httpd=server(self.directory,self.sampler,0,self.router)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        self.addCleanup(thread.join);self.addCleanup(httpd.server_close);self.addCleanup(httpd.shutdown)
        url='http://127.0.0.1:'+str(httpd.server_port)
        def request(path,key=None,origin=None):
            headers={'Content-Type':'application/json'}
            if key:headers['x-api-key']=key
            if origin:headers['Origin']=origin
            req=urllib.request.Request(url+path,json.dumps({'model':'claude-opus','messages':[]}).encode(),headers)
            try:return urllib.request.urlopen(req)
            except urllib.error.HTTPError as error:return error
        with request('/claude/v1/messages') as r:self.assertEqual(r.status,401)
        with request('/claude/v1/messages',httpd.key,'https://example.com') as r:self.assertEqual(r.status,401)
        self.send.assert_not_called()
        with request('/claude/v1/messages',httpd.key) as r:
            self.assertEqual(r.status,200);self.assertEqual(r.headers['X-1top-Account'],'a')
            self.assertIn(b'[DONE]',r.read())
        self.send.return_value=Response(200,b'{"input_tokens":3}',{'Content-Type':'application/json'})
        with request('/claude/v1/messages/count_tokens?beta=true',httpd.key) as r:
            self.assertEqual(json.load(r),{'input_tokens':3})
        self.assertEqual(self.send.call_args.args[0],'https://api.anthropic.com/v1/messages/count_tokens')
        class BrokenStream(Response):
            def read1(self,n):raise OSError('connection lost after headers')
        self.send.return_value=BrokenStream(200)
        with request('/claude/v1/messages',httpd.key) as r:self.assertEqual(r.read(),b'')
        self.assertEqual(self.send.call_count,3)
        self.assertEqual((self.directory/'gateway-key.json').stat().st_mode&0o777,0o600)

    def test_native_launcher_keeps_profile_and_secrets_out_of_arguments(self):
        from onetop.gateway_client import command
        (self.directory/'gateway-key.json').write_text(json.dumps({'key':'k'*40}))
        context=Mock();context.__enter__=Mock(return_value=Mock(status=200));context.__exit__=Mock(return_value=False)
        with patch('onetop.gateway_client.urllib.request.urlopen',return_value=context),patch('onetop.gateway_client.executable',return_value='/test/codex'):
            argv,env=command('Codex',['--version'],self.directory)
            self.assertNotIn('k'*40,str(argv));self.assertEqual(env['ONETOP_GATEWAY_KEY'],'k'*40)
            self.assertIn('model_providers.onetop.supports_websockets=false',argv)
            self.assertIn('model_providers.onetop.base_url="http://127.0.0.1:18767/codex/v1"',argv)
            self.assertEqual(argv[-1],'--version')
        self.assertFalse((self.directory/'config.toml').exists())

    def test_control_endpoint_authorization_lifecycle_and_saved_start(self):
        from http.server import ThreadingHTTPServer
        from onetop.server import Handler
        service=GatewayService(self.directory,self.sampler,0)
        httpd=ThreadingHTTPServer(('127.0.0.1',0),Handler);httpd.action_token='monitor';httpd.routing=service
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        self.addCleanup(service.close);self.addCleanup(thread.join);self.addCleanup(httpd.server_close);self.addCleanup(httpd.shutdown)
        url='http://127.0.0.1:'+str(httpd.server_port)
        def post(origin,token,value):
            req=urllib.request.Request(url+'/api/routing',json.dumps(value).encode(),
                {'Origin':origin,'X-Monitor-Token':token,'Content-Type':'application/json'})
            try:return urllib.request.urlopen(req)
            except urllib.error.HTTPError as e:return e
        with patch.object(Handler,'log_message'):
            with post('https://elsewhere','monitor',{'enabled':True}) as r:self.assertEqual(r.status,403)
            self.assertFalse(service.status()['running'])
            with post(url,'monitor',{'enabled':True,'threshold':95,'account_priority':['b','a']}) as r:
                data=json.load(r);self.assertEqual(r.status,200);self.assertTrue(data['running']);self.assertEqual(data['threshold'],95)
            with post(url,'monitor',{'enabled':True,'threshold':True}) as r:self.assertEqual(r.status,400)
            service.close();service.start_saved();self.assertTrue(service.status()['running'])
            self.assertNotIn('key',json.dumps(service.status()))
            with post(url,'monitor',{'enabled':False}) as r:self.assertFalse(json.load(r)['running'])
            service.start_saved();self.assertFalse(service.status()['running'])

    def test_bad_saved_config_never_prevents_monitor_start(self):
        (self.directory/'gateway.json').write_text(json.dumps({'enabled':True,'threshold':-1}))
        service=GatewayService(self.directory,self.sampler,0);service.start_saved()
        self.assertEqual(service.status()['error'],'configuration_unavailable')
        self.assertFalse(service.status()['running'])

    def test_actual_account_attribution_survives_switch_and_repairs_collector_race(self):
        from onetop.routing_attribution import load,attach,account_at,session_id
        from onetop.weekly_usage import event_account
        from contextlib import closing
        self.send.side_effect=[Response(200),Response(429),Response(200)]
        payload={'model':'claude-opus','metadata':{'user_id':json.dumps({'session_id':'sid','account_uuid':'original'})}}
        first=self.router.route('/claude/v1/messages',payload,{})
        self.router.clock=lambda:1010;first[2].close()
        self.router.clock=lambda:1020
        second=self.router.route('/claude/v1/messages',payload,{})
        self.router.clock=lambda:1030;second[2].close()
        self.assertEqual((first[3],second[3]),('a','b'))
        bindings=load(self.directory,1030);self.assertEqual(len(bindings['sid']),2)
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('CREATE TABLE events(sid,t,account)')
            db.executemany('INSERT INTO events VALUES(?,?,?)',[('sid',995,'original'),('sid',1005,'original'),('sid',1025,'original')])
            spec={'id':'sid','kind':'Claude','account_binding':('original',990)}
            attach(spec,bindings,db)
            self.assertEqual([event_account(spec,t) for t in (995,1005,1025)],['original','a','b'])
            self.assertEqual([r[0] for r in db.execute('SELECT account FROM events ORDER BY t')],['original','a','b'])
            self.assertEqual(spec['account_binding_source'],'gateway_session')
            self.assertEqual(account_at(bindings['sid'],1030.5),'b')
            self.assertIsNone(account_at([('a','Claude',1,5),('b','Claude',2,6)],3))
        self.assertEqual(session_id({'metadata':{'user_id':'user_device_account_account_session_sid'}},{}),'sid')
        self.assertIsNone(session_id({}, {'session_id':'private prompt with spaces'}))


class CredentialTests(unittest.TestCase):
    def test_concurrent_401s_rotate_once_and_account_changes_invalidate_cache(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);row=account(identity('Claude','uuid','org'))
            (root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'uuid','organizationUuid':'org'}}))
            sampler=Mock();sampler.roots.return_value={root:(row['id'],'Claude',0)}
            credentials=Credentials(sampler)
            old={'accessToken':'old','expiresAt':9999999999000}
            new={'accessToken':'new','expiresAt':9999999999000}
            with patch('onetop.routing_credentials.claude_credentials',return_value=old),patch('onetop.routing_credentials.claude_identity',return_value=row['id']),patch('onetop.routing_credentials.refresh_managed',return_value=new) as refresh:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    results=list(pool.map(lambda _:credentials.get(row,force=True,rejected='Bearer old'),range(8)))
                self.assertEqual(refresh.call_count,1);self.assertTrue(all(r['Authorization']=='Bearer new' for r in results))
                (root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'other'}}))
                with self.assertRaisesRegex(CredentialError,'account_changed'):credentials.get(row)

    def test_claude_token_owner_must_match_profile_account(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);row=account(identity('Claude','a','org'))
            (root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'a','organizationUuid':'org'}}))
            sampler=Mock();sampler.roots.return_value={root:(row['id'],'Claude',0)}
            with patch('onetop.routing_credentials.claude_credentials',return_value={'accessToken':'token-from-b','expiresAt':9999999999000}),patch('onetop.routing_credentials.claude_identity',return_value=identity('Claude','b','org')):
                with self.assertRaisesRegex(CredentialError,'account_changed'):Credentials(sampler).get(row)

    def test_codex_native_refresh_does_not_overwrite_new_identity(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);path=root/'auth.json';path.write_text(json.dumps({'tokens':{'account_id':'old','access_token':'old-token'}}))
            row=account(identity('Codex','old'),'Codex');sampler=Mock();sampler.roots.return_value={root:(row['id'],'Codex',0)}
            credentials=Credentials(sampler)
            def refresh(*args,**kwargs):path.write_text(json.dumps({'tokens':{'account_id':'new','access_token':'new-token'}}))
            with patch('onetop.routing_credentials.codex_rpc',side_effect=refresh) as rpc:
                with self.assertRaisesRegex(CredentialError,'account_changed'):credentials.get(row,force=True)
                rpc.assert_called_once_with(root,refresh=True)
                self.assertEqual(json.loads(path.read_text())['tokens']['account_id'],'new')


if __name__=='__main__':unittest.main()
