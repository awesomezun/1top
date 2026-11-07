import copy,json,sqlite3,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import Mock
from onetop.bridge import CloudLink,export_snapshot
from onetop.relay_data import all_periods,public_history
from onetop.usage import window_usage

class RelayParity(unittest.TestCase):
    def test_host_cpu_basis_is_preserved_without_redividing_metrics(self):
        state={'sessions':[{'id':'s','kind':'Claude','resources':{'cpu':6.25}}],
            'system':{'cpu_basis':'host_total','host':{'cpu':50,'cores':16},
                'top':[{'pid':10,'cpu':6.25}], 'monitor':{'cpu':6.25}}}
        payload=export_snapshot(state)
        self.assertEqual(payload['system']['cpu_basis'],'host_total')
        self.assertEqual(payload['system']['top'][0]['cpu'],6.25)
        self.assertEqual(payload['sessions'][0]['cpu'],6.25)
        self.assertEqual(payload['host']['cpu'],50)
        state['system']['cpu_basis']='/private/path'
        self.assertIsNone(export_snapshot(state)['system']['cpu_basis'])

    def test_every_slider_period_reconciles_flow_and_account_attribution(self):
        with sqlite3.connect(':memory:') as db:
            db.executescript('''CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER,account TEXT);
                CREATE TABLE weekly_samples(account TEXT,kind TEXT,t REAL,pct REAL,reset REAL);''')
            now=2_000_000;started=now-10*86400
            db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',[
                (now-9*86400,'s','Claude',100,0,0,0,'old'),(now-26*3600,'s','Claude',20,0,0,0,'new'),
                (now-100,'s','Claude',3,0,0,0,'new'),(now+10,'s','Claude',999,0,0,0,'new')])
            db.execute('ALTER TABLE events ADD COLUMN model TEXT')
            db.execute("UPDATE events SET model='claude-opus-5-5'")
            db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)',
                       (now-50,'closed','Aside',7,1,2,3,None,'gpt-6.1-sol'))
            period,usage=window_usage(db,now,started,['Claude'])
            base={'ready':True,'updated':now,'started':started,'history_started':started,'period_usage':period,
                'sessions':[{'id':'s','kind':'Claude','tokens':[123,0,0,0],'usage':{**usage['s'],'windows':usage['s'],'weekly_account':'new'}}],
                'weekly_usage':{'accounts':[{'id':'new','kind':'Claude','periods':{},'calibration':{'tokens':100,'seconds':300,'used_pp':1,'pp_per_token':.01}}]},
                'account_quotas':[{'id':'new','kind':'Claude'}]}
            original=copy.deepcopy(base);result=all_periods(db,base)
            self.assertEqual(base,original)
            payload=export_snapshot(result)
            self.assertEqual(len(payload['periods']),19)
            for p in payload['periods']:
                self.assertEqual([sum(r['tokens'][i] for r in p['by_model']) for i in range(4)],p['tokens'])
                self.assertIn(dict(kind='Aside',model='gpt-6.1-sol',tokens=[7,1,2,3],session_count=1),p['by_model'])
                if p['key'] in result['remote_flows']:
                    self.assertEqual(sum(sum(b.values()) for b in payload['flow'][p['key']]['bins']),sum(p['tokens']))
                    self.assertLessEqual(len(payload['flow'][p['key']]['bins']),240)
            self.assertEqual(result['sessions'][0]['usage']['windows']['all'],[123,0,0,0])
            estimate=payload['sessions'][0]['weekly_estimate']['all']
            self.assertEqual(estimate['tokens'],23) # switched account's 100 never relabelled
            self.assertTrue(estimate['partial']);self.assertEqual(estimate['calibration']['seconds'],300)
            self.assertEqual(payload['account_quotas'][0]['calibration']['tokens'],100)

    def test_model_breakdown_preserves_missing_and_empty_and_only_exports_metrics(self):
        windows=[dict(key='1h',tokens=[4,0,0,0]),dict(key='10m',tokens=[0,0,0,0],by_model=[]),
                 dict(key='5h',tokens=[4,0,0,0],by_model=[dict(kind='Claude',model=None,
                      tokens=[4,0,0,0],session_count=2,cwd='/private/path',prompt='PRIVATE',account='SECRET')])]
        periods=export_snapshot({'period_usage':{'windows':windows}})['periods']
        self.assertNotIn('by_model',periods[0])
        self.assertEqual(periods[1]['by_model'],[])
        self.assertEqual(periods[2]['by_model'],[dict(kind='Claude',model=None,tokens=[4,0,0,0],session_count=2)])
        for secret in ('/private','PRIVATE','SECRET'):
            self.assertNotIn(secret,json.dumps(periods))

    def test_extended_metrics_exclude_paths_and_private_operations(self):
        state={'sessions':[{'id':'s','kind':'Claude','title':'PRIVATE PROMPT','pids':[4],'effort':'high',
            'usage':{'last_minute':[1,2,3,4],'output_rate':4}}],
            'system':{'host':{'disk':{'path':'/private/disk','total':100},'network':{'rx':12}},
                'top':[{'name':'python','pid':4,'cmdline':'PRIVATE COMMAND','cwd':'/private','cpu':2}],
                'monitor':{'pid':1,'cpu':3,'rss':100}},'operations':{'goals':[{'objective':'PRIVATE GOAL'}]}}
        data=export_snapshot(state);self.assertNotIn('PRIVATE',json.dumps(data));self.assertNotIn('/private',json.dumps(data))
        self.assertEqual(data['sessions'][0]['effort'],'high');self.assertEqual(data['host']['network']['rx'],12)
        self.assertEqual(data['system']['monitor']['cpu'],3)

    def test_process_owners_only_reference_exported_sessions_or_shared_backends(self):
        state={'sessions':[{'id':'s','kind':'Claude'}], 'system':{
            'shared':[{'id':'backend:7','pid':7}],
            'top':[{'pid':i,'owner':owner,'cmdline':'PRIVATE','cwd':'/private'}
                for i,owner in enumerate(['s','backend:7','backend:8','/private/project','gone',None,{}],1)]}}
        payload=export_snapshot(state)
        self.assertEqual([r['owner'] for r in payload['system']['top']],
                         ['s','backend:7',None,None,None,None,None])
        self.assertNotIn('PRIVATE',json.dumps(payload));self.assertNotIn('/private',json.dumps(payload))
        self.assertEqual(state['system']['top'][3]['owner'],'/private/project')

    def test_history_is_correlated_read_only_and_paths_are_hashed(self):
        with tempfile.TemporaryDirectory() as folder:
            collector=Mock();collector.lock=threading.Lock();collector.snapshot={}
            collector.history.response.return_value={'as_of':1,'series':{'by_project':[{'key':'/private/project','label':'project','tokens':[2]}]},'coverage':[],'heatmap':{}}
            ctl=Mock();link=CloudLink(collector,ctl,Path(folder));link.config={'device_id':'d'};link.ws=Mock()
            query={'device_id':'d','request_id':'a'*36,'period':'custom:604800','step':'3600','expires_at':time.time()*1000+1000}
            link.read_history(query)
            payload=json.loads(link.ws.send.call_args.args[0]);self.assertEqual(payload['request_id'],'a'*36)
            self.assertTrue(payload['data']['series']['by_project'][0]['key'].startswith('project:'))
            self.assertNotIn('/private',json.dumps(payload));ctl.execute.assert_not_called()
            link.read_history({**query,'device_id':'foreign'});link.read_history({**query,'expires_at':0})
            collector.history.response.assert_called_once()

    def test_alias_is_idempotent_and_unknown_account_never_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            collector=Mock();collector.lock=threading.Lock();collector.snapshot={'account_quotas':[{'id':'a'}]}
            ctl=Mock();link=CloudLink(collector,ctl,Path(folder));link.config={'device_id':'d'};link.ws=Mock()
            query={'action':'account_alias','device_id':'d','request_id':'a'*36,'account_id':'a','alias':'Work','expires_at':time.time()*1000+1000}
            link.command(query);link.command(query)
            self.assertEqual(collector.snapshot['account_quotas'][0]['alias'],'Work');ctl.execute.assert_not_called()
            path=Path(folder)/'account-aliases-v1.json';before=path.read_bytes()
            link.command({**query,'account_id':'missing','request_id':'b'*36})
            self.assertEqual(path.read_bytes(),before)
