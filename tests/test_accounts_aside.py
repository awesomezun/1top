import json,sqlite3,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from onetop.accounts import claude_windows,codex_windows,AccountQuotaSampler,identity,claude_credentials
from onetop.aside import discover,billing_accounts
from onetop.server import Ledger
from onetop.bridge import export_snapshot
from onetop.controls import Controller,ActionError

class AccountTests(unittest.TestCase):
    def test_current_keychain_login_wins_over_expired_migration_file(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.credentials.json').write_text(json.dumps({'claudeAiOauth':{'accessToken':'expired-file','expiresAt':1}}))
            reply={'claudeAiOauth':{'accessToken':'current-keychain','expiresAt':9999999999999}}
            with patch('onetop.accounts.keychain_document',return_value=reply):
                self.assertEqual(claude_credentials(root)['accessToken'],'current-keychain')
    def test_keychain_unavailable_preserves_file_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.credentials.json').write_text(json.dumps({'claudeAiOauth':{'accessToken':'file-login'}}))
            from onetop.claude_profiles import CredentialError
            with patch('onetop.accounts.keychain_document',side_effect=CredentialError('credential_store_unavailable')):
                self.assertEqual(claude_credentials(root)['accessToken'],'file-login')
    def test_primary_does_not_imply_five_hours(self):
        rows,plan=codex_windows({'rateLimits':{'planType':'pro','primary':{'windowDurationMins':10080,'usedPercent':95,'resetsAt':900}}},100)
        self.assertEqual(rows,[{'label':'주간','pct':95,'reset':900}])
        self.assertEqual(plan,'pro')
    def test_weekly_only_secondary_omits_nonapplicable_five_hours(self):
        rows,_=codex_windows({'rateLimitsByLimitId':{'codex':{'planType':'pro','primary':None,'secondary':{'windowDurationMins':10080,'usedPercent':0,'resetsAt':900}}}},100)
        self.assertEqual(rows,[{'label':'주간','pct':0,'reset':900}])
    def test_reported_five_hours_is_retained_even_on_pro(self):
        rows,_=codex_windows({'rateLimits':{'planType':'pro','primary':{'windowDurationMins':300,'usedPercent':0,'resetsAt':900},'secondary':{'windowDurationMins':10080,'usedPercent':42,'resetsAt':900}}},100)
        self.assertEqual([w['label'] for w in rows],['5H','주간'])
        self.assertEqual([w['pct'] for w in rows],[0,42])
    def test_missing_or_unrecognized_report_is_not_no_limit(self):
        rows,_=codex_windows({},100)
        self.assertEqual([w['label'] for w in rows],['5H','주간'])
        self.assertTrue(all(w['pct'] is None for w in rows))
        rows,_=codex_windows({'rateLimits':{'primary':{'usedPercent':12},'secondary':{'windowDurationMins':10080,'usedPercent':42,'resetsAt':900}}},100)
        self.assertIsNone(rows[0]['pct']);self.assertEqual(rows[1]['pct'],42)
    def test_expired_reported_five_hours_remains_unknown(self):
        rows,_=codex_windows({'rateLimits':{'primary':{'windowDurationMins':300,'usedPercent':99,'resetsAt':99},'secondary':{'windowDurationMins':10080,'usedPercent':42,'resetsAt':900}}},100)
        self.assertEqual(rows[0],{'label':'5H','pct':None,'reset':99})
    def test_query_failure_retains_cached_applicable_windows(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'auth.json').write_text(json.dumps({'tokens':{'account_id':'one'}}))
            sampler=AccountQuotaSampler();key=identity('Codex','one')
            sampler.cached[key]={'id':key,'kind':'Codex','account_label':'Example','plan':'pro','windows':[{'label':'주간','pct':42,'reset':900}],'updated':90,'stale':False,'note':''}
            with patch('onetop.accounts.codex_rpc',side_effect=TimeoutError):row=sampler.codex(root,100)
            self.assertTrue(row['stale']);self.assertEqual(row['windows'],sampler.cached[key]['windows'])
    def test_unknown_duration_and_model_specific_limit_stay_unknown(self):
        rows,_=codex_windows({'rateLimits':{'limitId':'spark','primary':{'windowDurationMins':300,'usedPercent':12}}},100)
        self.assertTrue(all(w['pct'] is None for w in rows))
        rows,_=codex_windows({'rateLimits':{'primary':{'usedPercent':12}}},100)
        self.assertTrue(all(w['pct'] is None for w in rows))
    def test_expired_is_not_zero_and_missing_stays_unknown(self):
        rows=claude_windows({'five_hour':{'utilization':0},'seven_day':{'utilization':95,'resets_at':99}},100)
        self.assertEqual(rows[0]['pct'],0);self.assertIsNone(rows[1]['pct'])
    def test_claude_cache_cannot_cross_accounts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'new'},'cachedUsageUtilization':{'accountUuid':'old','fetchedAtMs':100000,'utilization':{'five_hour':{'utilization':90}}}}))
            row=AccountQuotaSampler().claude(root,100)
            self.assertTrue(all(w['pct'] is None for w in row['windows']))
    def test_codex_response_account_must_match(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'auth.json').write_text(json.dumps({'tokens':{'account_id':'one'}}))
            with patch('onetop.accounts.codex_rpc',return_value=({'type':'chatgpt'},{'accountId':'two'})):
                self.assertIsNone(AccountQuotaSampler().codex(root,100))
    def test_workspace_is_part_of_identity(self):
        self.assertNotEqual(identity('Claude','same','org-a'),identity('Claude','same','org-b'))

class AsideTests(unittest.TestCase):
    def test_billing_identity_uses_provider_account_not_app_login_or_model(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d)
            (directory/'credentials.json').write_text(json.dumps({
                'openai-codex':{'accountId':'pro-account','access':'DO-NOT-EXPORT','refresh':'DO-NOT-EXPORT'},
                'claude-code':{'access':'DO-NOT-EXPORT'}}))
            result=billing_accounts(directory)
            self.assertEqual(result,{'openai-codex':identity('Codex','pro-account')})
            self.assertNotIn('DO-NOT-EXPORT',json.dumps(result))
            (directory/'credentials.json').write_text('{"openai-codex":{"modelId":"gpt-6-astra"}}')
            self.assertEqual(billing_accounts(directory),{})
            (directory/'credentials.json').write_text('{"openai-codex":null}')
            self.assertEqual(billing_accounts(directory),{})
    def test_explicit_ancestry_includes_old_parent_and_collapses_nested_tasks(self):
        from onetop.hierarchy import group_sessions
        with tempfile.TemporaryDirectory() as d:
            home=Path(d);base=home/'.aside/u/0';base.mkdir(parents=True)
            c=sqlite3.connect(base/'state.db')
            c.execute('CREATE TABLE sessions(id,title,status,model,cwd,created_at,updated_at,archived_at,incognito,ephemeral,parent_id,trigger,branched_from)')
            for sid,parent,trigger,updated,private,branch in [
                ('root',None,'user',1,0,None),('routine','root','routine',99995,0,None),
                ('worker','routine','subagent',99995,0,None),('private',None,'user',1,1,None),
                ('orphan','private','subagent',99995,0,None),('branch',None,'user',99995,0,'root')]:
                c.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (sid,'Fixture','running' if sid!='root' else 'idle','{"modelId":"test"}','/tmp/project',1,updated,None,private,0,parent,json.dumps({'type':trigger}),branch))
            c.commit();c.close()
            rows=discover(home,100000,True)
            self.assertNotIn('aside:0:private',{s['id'] for s in rows})
            root=next(s for s in rows if s['aside_session']=='root')
            worker=next(s for s in rows if s['aside_session']=='worker')
            self.assertEqual(worker['root_session_id'],root['id'])
            self.assertNotIn('control_key',worker)
            self.assertFalse(next(s for s in rows if s['aside_session']=='branch')['is_subagent'])
            for s in rows:s['tokens']=[1,0,0,0];s['usage']={'rate':2,'windows':{'1h':[1,0,0,0]}}
            grouped=group_sessions(rows)
            self.assertEqual(len(grouped),3)
            group=next(s for s in grouped if s['id']==root['id'])
            self.assertEqual(group['children_count'],2)
            self.assertEqual(group['tokens'],[3,0,0,0])
            self.assertEqual(group['usage']['rate'],6)

    def test_request_dedup_and_reasoning_not_double_counted(self):
        l=Ledger('Aside')
        x={'role':'assistant','responseId':'r','timestamp':1000000000000,'model':'test','usage':{'input':10,'cacheRead':20,'cacheWrite':3,'output':7,'reasoning':5,'totalTokens':40}}
        self.assertEqual(l.consume(x)[1],[10,20,3,7]);self.assertIsNone(l.consume(x));self.assertEqual(sum(l.s['total']),40)
        x['usage']['output']=9;self.assertEqual(l.consume(x)[1],[0,0,0,2])
    def test_readonly_discovery_excludes_incognito_and_archived(self):
        with tempfile.TemporaryDirectory() as d:
            home=Path(d);base=home/'.aside/u/0';base.mkdir(parents=True)
            c=sqlite3.connect(base/'state.db')
            c.execute('CREATE TABLE sessions(id,title,status,model,cwd,created_at,updated_at,archived_at,incognito,ephemeral)')
            for sid,status,private,archived in [('active','running',0,None),('private','running',1,None),('old','running',0,10),('stored','idle',0,None)]:
                c.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)',(sid,'Fixture',status,'{"modelId":"test"}','/tmp/project',10,95,archived,private,0))
            c.commit();c.close()
            rows=discover(home,100,True)
            self.assertEqual({r['id'] for r in rows},{'aside:0:active','aside:0:stored'})
            self.assertEqual(next(r for r in rows if r['aside_session']=='active')['status'],'working')
            self.assertEqual(next(r for r in discover(home,100,False) if r['aside_session']=='active')['status'],'unknown')
            self.assertTrue(all(r['pids']==[] for r in rows))
            exported=export_snapshot({'sessions':rows})['sessions']
            self.assertIn('pause',next(r for r in exported if r['id']=='aside:0:active')['capabilities'])
            self.assertTrue(all('terminate' not in r['capabilities'] for r in exported))
    def test_aside_termination_never_targets_browser(self):
        ctl=Controller(None,None);ctl.resolve=lambda sid,key:{'kind':'Aside','orca_terminal':None}
        with self.assertRaises(ActionError):ctl.execute({'action':'terminate','session_id':'aside:0:test','control_key':'key','request_id':'once'})

if __name__=='__main__':unittest.main()

class AccountExportTests(unittest.TestCase):
    def test_weekly_only_account_stays_weekly_only_remotely(self):
        windows,_=codex_windows({'rateLimits':{'planType':'pro','primary':None,'secondary':{'windowDurationMins':10080,'usedPercent':42,'resetsAt':900}}},100)
        row={'id':'codex:example','kind':'Codex','plan':'pro','windows':windows}
        self.assertEqual(export_snapshot({'account_quotas':[row]})['account_quotas'][0]['windows'],windows)
    def test_remote_quotas_exclude_email_and_credentials(self):
        row={'id':'claude:abcdef123456','kind':'Claude','account_label':'private@example.com','credentials':'SECRET','plan':'Max','updated':100,'stale':False,'windows':[{'label':'5H','pct':4,'reset':200}]}
        data=export_snapshot({'account_quotas':[row]});raw=json.dumps(data)
        self.assertNotIn('private@example.com',raw);self.assertNotIn('SECRET',raw)
        self.assertEqual(data['account_quotas'][0]['account_label'],'Claude · 123456')
