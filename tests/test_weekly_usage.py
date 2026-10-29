import sqlite3
import unittest
import threading
from pathlib import Path
from unittest.mock import patch
from onetop import weekly_usage as w
from onetop.accounts import AccountQuotaSampler


class WeeklyUsageTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.now=1000000
        self.db.execute('CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INT,cached INT,written INT,output INT)')
        w.initialize(self.db)
    def tearDown(self):self.db.close()
    def point(self,t,pct,account='a',reset=None):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',(account,'Codex',t,pct,reset or self.now+86400))
    def event(self,t,sid,tokens,account='a'):
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(t,sid,'Codex',tokens,0,0,0,account))
    def result(self,accounts=('a',)):
        return w.snapshot(self.db,[{'id':a,'kind':'Codex'} for a in accounts],self.now)
    def period(self,key='1h'):return self.result()[0]['accounts'][0]['periods'][key]
    def test_migration_is_idempotent_and_does_not_assign_old_events(self):
        self.event(self.now-50,'old',99,None);w.initialize(self.db)
        self.assertIsNone(self.db.execute('SELECT account FROM events').fetchone()[0])
    def test_adapter_matches_exact_account_and_preserves_binding_until_switch(self):
        roots={Path('/pro'):('a','Codex',0),Path('/team'):('b','Codex',0)}
        spec={'id':'aside:0:s','billing_account':'a','billing_kind':'Codex'}
        self.assertEqual(w.bind_adapter(self.db,spec,roots,100),('a',100))
        self.assertEqual(w.bind_adapter(self.db,spec,roots,200),('a',100))
        spec['billing_account']='b'
        self.assertEqual(w.bind_adapter(self.db,spec,roots,300),('b',300))
        spec['account_binding']=('b',300)
        self.assertIsNone(w.event_account(spec,250))
        self.assertEqual(w.event_account(spec,310),'b')
        spec['billing_account']='not-observed'
        self.assertIsNone(w.bind_adapter(self.db,spec,roots,400))
        spec.update(billing_account='a',billing_kind='Claude')
        self.assertIsNone(w.bind_adapter(self.db,spec,roots,500))
    def test_aside_tokens_calibrate_same_account_without_changing_runtime_kind(self):
        self.point(self.now-240,20);self.point(self.now-120,22)
        self.event(self.now-180,'cli',100)
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(self.now-160,'aside:0:s','Aside',300,0,0,0,'a'))
        self.db.execute('INSERT INTO adapter_accounts VALUES(?,?,?,?)',('aside:0:s','a','Codex',self.now-300))
        result,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex'}],self.now,bindings={'cli':'a','aside:0:s':'a'})
        self.assertEqual(result['accounts'][0]['calibration']['tokens'],400)
        self.assertEqual(shares['aside:0:s']['1h']['used_pp'],1.5)
        self.assertEqual(shares['cli']['1h']['used_pp'],.5)
        self.assertEqual(self.db.execute("SELECT kind FROM events WHERE sid='aside:0:s'").fetchone()[0],'Aside')
    def test_old_aside_tokens_use_existing_calibration_without_rewriting_identity(self):
        self.point(self.now-240,20);self.point(self.now-120,22)
        self.event(self.now-180,'cli',100)
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(self.now-500,'aside:0:s','Aside',50,0,0,0,None))
        self.db.execute('INSERT INTO adapter_accounts VALUES(?,?,?,?)',('aside:0:s','a','Codex',self.now))
        _,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex'}],self.now,bindings={'aside:0:s':'a'})
        self.assertEqual(shares['aside:0:s']['1h']['used_pp'],1)
        self.assertEqual(shares['aside:0:s']['1h']['inferred_account_tokens'],50)
        self.assertIsNone(self.db.execute("SELECT account FROM events WHERE sid='aside:0:s'").fetchone()[0])
    def test_unbound_aside_activity_cannot_inflate_codex_calibration(self):
        self.point(self.now-240,20);self.point(self.now-120,22)
        self.event(self.now-180,'cli',100)
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(self.now-160,'aside:0:s','Aside',300,0,0,0,None))
        self.db.execute('INSERT INTO adapter_accounts VALUES(?,?,?,?)',('aside:0:s','a','Codex',self.now))
        result,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex'}],self.now,bindings={'aside:0:s':'a'})
        self.assertIsNone(result['accounts'][0]['calibration']);self.assertEqual(shares,{})
    def test_single_sample_is_unknown_not_zero(self):
        self.point(self.now-30,24)
        self.assertIsNone(self.period()['used_pp']);self.assertTrue(self.period()['partial'])
    def test_actual_change_and_token_share_stay_separate(self):
        self.point(self.now-240,24);self.point(self.now-120,27)
        self.event(self.now-200,'s1',100);self.event(self.now-180,'s2',300)
        result,shares=self.result()
        self.assertEqual(result['accounts'][0]['periods']['1h']['used_pp'],3)
        self.assertEqual(shares['s1']['1h']['used_pp'],.75)
        self.assertEqual(shares['s2']['1h']['used_pp'],2.25)
        self.assertTrue(shares['s1']['1h']['partial'])
    def test_missing_token_reports_keep_delta_unallocated(self):
        self.point(self.now-240,20);self.point(self.now-120,22)
        self.event(self.now-150,'unbound',100,None)
        self.assertEqual(self.period()['unattributed_pp'],2)
        self.assertEqual(self.result()[1],{})
    def test_long_sampling_gap_does_not_allocate_partial_tokens(self):
        self.point(self.now-1200,20);self.point(self.now-120,24);self.event(self.now-150,'s',100)
        self.assertEqual(self.period()['used_pp'],4)
        self.assertTrue(self.period()['partial']);self.assertEqual(self.result()[1],{})
    def test_boundary_does_not_import_earlier_change(self):
        self.point(self.now-700,10);self.point(self.now-500,15);self.point(self.now-300,17)
        self.assertEqual(self.period('10m')['used_pp'],2)
    def test_reset_is_partial_and_never_allocated_as_exact_session_spend(self):
        self.point(self.now-240,98,reset=self.now-200);self.point(self.now-120,2)
        self.event(self.now-150,'s',100)
        self.assertEqual(self.period()['used_pp'],2);self.assertTrue(self.period()['partial'])
        self.assertEqual(self.result()[1],{})
    def test_downward_correction_is_not_negative_spend(self):
        self.point(self.now-240,24);self.point(self.now-120,20)
        self.assertIsNone(self.period()['used_pp'])
    def test_same_cycle_overshoot_is_reconciled_without_raising_latest_or_rewriting_raw(self):
        self.point(self.now-360,4);self.point(self.now-240,5);self.point(self.now-120,4)
        self.event(self.now-300,'s',100);self.event(self.now-180,'s',100)
        result,shares=self.result();account=result['accounts'][0]
        self.assertEqual([point[1] for point in account['usage_points']],[4,4])
        self.assertEqual(account['periods']['1h']['used_pp'],0)
        self.assertTrue(account['periods']['1h']['partial']);self.assertEqual(account['flow'],[])
        self.assertIsNone(account['calibration']);self.assertEqual(shares,{})
        self.assertEqual(account['history_quality']['excluded_samples'],1)
        self.assertEqual([row[0] for row in self.db.execute('SELECT pct FROM weekly_samples ORDER BY t')],[4,5,4])
    def test_reconciliation_restarts_calibration_after_correction_only(self):
        for offset,pct in [(-600,3),(-480,4),(-360,5),(-240,4),(-120,5)]:self.point(self.now+offset,pct)
        for offset in (-540,-420,-300,-180):self.event(self.now+offset,'s',100)
        account=self.result()[0]['accounts'][0]
        self.assertEqual([point[1] for point in account['usage_points']],[3,4,4,5])
        self.assertEqual(account['periods']['1h']['used_pp'],2)
        self.assertEqual(account['calibration']['from'],self.now-240)
        self.assertEqual(account['calibration']['used_pp'],1)
        self.assertEqual(account['calibration']['tokens'],100)
    def test_claude_reuses_unaffected_same_cycle_interval_after_correction(self):
        for age,pct in [(800,3),(680,3),(560,4),(440,5),(320,4),(200,4)]:
            self.point(self.now-age,pct)
        for age,tokens in [(740,100),(620,1000000),(500,9000000),(260,3000000)]:
            self.event(self.now-age,'s',tokens)
        self.db.execute("UPDATE events SET kind='Claude'")
        self.db.execute("UPDATE weekly_samples SET kind='Claude'")
        quota={'id':'a','kind':'Claude','source':'claude_statusline','stale':True,
               'windows':[{'label':'주간','pct':4,'reset':self.now+86400}]}
        result,_=w.snapshot(self.db,[quota],self.now)
        c=result['accounts'][0]['calibration']
        self.assertTrue(c['reused_before_correction'])
        self.assertEqual(c['tokens'],1000000)
        self.assertEqual(c['used_pp'],1)
        self.assertEqual(c['to'],self.now-560)
        self.assertEqual(c['source'],'historical_provider_calibration')
        # A different reset cannot inherit that earlier cycle's conversion.
        quota['windows'][0]['reset']+=1000
        self.assertIsNone(w.snapshot(self.db,[quota],self.now)[0]['accounts'][0]['calibration'])

    def test_reconciliation_partial_reduction_is_net_change_not_sum_of_positive_spikes(self):
        self.point(self.now-360,4);self.point(self.now-240,6);self.point(self.now-120,5)
        account=self.result()[0]['accounts'][0]
        self.assertEqual([point[1] for point in account['usage_points']],[4,5])
        self.assertEqual(account['periods']['1h']['used_pp'],1)
        self.assertIsNone(account['calibration'])
    def test_reconciliation_does_not_import_a_baseline_outside_the_selected_window(self):
        self.point(self.now-720,4);self.point(self.now-500,5);self.point(self.now-120,4)
        self.assertIsNone(self.period('10m')['used_pp'])
    def test_reconciliation_preserves_real_reset_and_isolates_accounts(self):
        self.point(self.now-360,98,reset=self.now-300);self.point(self.now-240,2)
        self.point(self.now-360,4,'b');self.point(self.now-240,5,'b');self.point(self.now-120,4,'b')
        result,_=self.result(('a','b'));a,b=result['accounts']
        self.assertEqual([point[1] for point in a['usage_points']],[98,2])
        self.assertEqual(a['periods']['1h']['used_pp'],2)
        self.assertFalse(a['history_quality']['reconciled'])
        self.assertEqual([point[1] for point in b['usage_points']],[4,4])
    def test_accounts_are_not_summed_and_switched_sessions_are_omitted(self):
        for account,delta in [('a',2),('b',4)]:
            self.point(self.now-240,10,account);self.point(self.now-120,10+delta,account)
            self.event(self.now-150,'switched',100,account)
        result,shares=self.result(('a','b'))
        self.assertEqual([a['periods']['1h']['used_pp'] for a in result['accounts']],[2,4])
        self.assertEqual(shares,{})
    def test_recent_tail_waits_for_log_collection(self):
        self.point(self.now-120,20);self.point(self.now-1,23);self.event(self.now-20,'s',100)
        self.assertEqual(self.result()[1],{})
    def test_record_rejects_stale_future_nonfinite_and_missing_reset(self):
        base={'id':'a','kind':'Codex','updated':self.now-10,'stale':False,'windows':[{'label':'주간','pct':20,'reset':self.now+1000}]}
        for row in [dict(base,stale=True),dict(base,updated=self.now+1),dict(base,windows=[{'label':'주간','pct':float('nan'),'reset':self.now+1000}]),dict(base,windows=[{'label':'주간','pct':0,'reset':0}])]:w.record(self.db,[row],self.now)
        self.assertEqual(self.db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],0)
        w.record(self.db,[base,base],self.now)
        self.assertEqual(self.db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],1)
    def test_claude_history_restores_missing_weekly_without_fresh_calibration(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,12,self.now+1000))
        row={'id':'claude:a','kind':'Claude','updated':0,'stale':True,
             'windows':[{'label':'5H','pct':None,'reset':0},{'label':'주간','pct':None,'reset':0}]}
        w.restore_claude_last_report(self.db,[row],self.now)
        self.assertEqual(row['windows'][1]['pct'],12);self.assertIsNone(row['windows'][0]['pct'])
        self.assertTrue(row['stale']);self.assertEqual(row['status'],'last_report')
        self.assertEqual(row['source'],'historical_provider_report');self.assertEqual(row['updated'],self.now-120)
        with patch.object(w,'valid_number',wraps=w.valid_number) as valid:
            w.record(self.db,[row],self.now)
            valid.assert_not_called()
        self.assertEqual(self.db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],1)
    def test_claude_history_does_not_cross_accounts_or_replace_known_reports(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,12,self.now+1000))
        rows=[{'id':'claude:b','kind':'Claude','updated':0,'windows':[]},
              {'id':'claude:a','kind':'Codex','updated':0,'windows':[]},
              {'id':'claude:a','kind':'Claude','updated':0,'windows':[{'label':'주간','pct':0,'reset':self.now+1000}]},
              {'id':'claude:a','kind':'Claude','updated':self.now-60,'windows':[]}]
        import copy
        before=copy.deepcopy(rows);w.restore_claude_last_report(self.db,rows,self.now)
        self.assertEqual(rows,before)
    def test_claude_history_never_resurrects_expired_or_different_cycles(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,12,self.now+1000))
        for reset in (self.now-1,self.now+5000):
            row={'id':'claude:a','kind':'Claude','updated':0,'windows':[{'label':'주간','pct':None,'reset':reset}]}
            w.restore_claude_last_report(self.db,[row],self.now)
            self.assertIsNone(row['windows'][0]['pct']);self.assertEqual(row['updated'],0)
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-60,15,self.now-1))
        row={'id':'claude:a','kind':'Claude','updated':0,'windows':[]}
        w.restore_claude_last_report(self.db,[row],self.now)
        self.assertEqual(row['windows'],[])
    def test_initial_claude_report_with_other_account_cycle_discards_all_windows(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
             'verified_activity':False,'stale':True,'windows':[
                 {'label':'5H','pct':5,'reset':self.now+200},
                 {'label':'주간','pct':6,'reset':self.now+5000}]}
        w.restore_claude_last_report(self.db,[row],self.now)
        self.assertIsNone(row['windows'][0]['pct']);self.assertEqual(row['windows'][0]['reset'],0)
        self.assertEqual(row['windows'][1],{'label':'주간','pct':4,'reset':self.now+1000})
        self.assertEqual(row['updated'],self.now-120);self.assertTrue(row['stale'])
        self.assertEqual(row['source'],'historical_provider_report')
    def test_initial_claude_report_cannot_reduce_verified_usage_in_same_cycle(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        for used in (0,3):
            row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
                 'verified_activity':False,'stale':True,'windows':[
                     {'label':'5H','pct':5,'reset':self.now+200},
                     {'label':'주간','pct':used,'reset':self.now+1000}]}
            w.restore_claude_last_report(self.db,[row],self.now)
            self.assertEqual([value['pct'] for value in row['windows']],[5,4])
            self.assertEqual(row['updated'],self.now-120)
    def test_initial_claude_report_without_weekly_cycle_does_not_preserve_five_hour(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
             'verified_activity':False,'stale':True,'windows':[{'label':'5H','pct':5,'reset':self.now+200}]}
        w.restore_claude_last_report(self.db,[row],self.now)
        self.assertEqual([value['pct'] for value in row['windows']],[None,4])
    def test_initial_claude_increase_with_matching_cycle_stays_stale(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
             'verified_activity':False,'stale':True,'windows':[{'label':'주간','pct':5,'reset':self.now+1000}]}
        w.restore_claude_last_report(self.db,[row],self.now);w.record(self.db,[row],self.now)
        self.assertEqual(row['windows'][0]['pct'],5);self.assertTrue(row['stale'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],1)
    def test_claude_api_activity_does_not_validate_a_conflicting_account_cycle(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
             'verified_activity':True,'stale':False,'windows':[
                 {'label':'5H','pct':6,'reset':self.now+200},
                 {'label':'주간','pct':13,'reset':self.now+5000}]}
        w.restore_claude_last_report(self.db,[row],self.now);w.record(self.db,[row],self.now)
        self.assertEqual([value['pct'] for value in row['windows']],[None,4])
        self.assertTrue(row['stale']);self.assertNotIn('verified_activity',row)
        self.assertEqual(self.db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],1)
    def test_verified_claude_same_cycle_updates_and_expired_cycle_rollover_are_allowed(self):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,4,self.now+1000))
        import copy
        for used in (3,5):
            row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
                 'verified_activity':True,'stale':False,'windows':[{'label':'주간','pct':used,'reset':self.now+1000}]}
            before=copy.deepcopy(row);w.restore_claude_last_report(self.db,[row],self.now)
            self.assertEqual(row,before)
        self.db.execute('DELETE FROM weekly_samples')
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('claude:a','Claude',self.now-120,99,self.now-1))
        row={'id':'claude:a','kind':'Claude','updated':self.now,'source':'claude_statusline',
             'verified_activity':True,'stale':False,'windows':[{'label':'주간','pct':1,'reset':self.now+5000}]}
        before=copy.deepcopy(row);w.restore_claude_last_report(self.db,[row],self.now)
        self.assertEqual(row,before)
    def test_binding_requires_kind_path_and_observation_time(self):
        roots={Path('/profiles/a'):('a','Codex',100),Path('/profiles/a/nested'):('b','Codex',200)}
        binding=w.account_for({'kind':'Codex','path':'/profiles/a/nested/sessions/a.jsonl'},roots)
        self.assertEqual(binding,('b',200))
        self.assertIsNone(w.event_account({'account_binding':binding},199))
        self.assertEqual(w.event_account({'account_binding':binding},200),'b')
        self.assertIsNone(w.account_for({'kind':'Claude','path':'/profiles/a/s.jsonl'},roots))
        self.assertIsNone(w.account_for({'kind':'Codex','path':'/profiles/ab/s.jsonl'},roots))
    def test_profile_switch_restarts_attribution_horizon(self):
        sampler=AccountQuotaSampler();root=Path('/profiles/a');row={'id':'a','kind':'Codex','stale':False,'updated':100}
        with patch('onetop.accounts.profile_roots',return_value=[('Codex',root)]),patch.object(sampler,'codex',return_value=row),patch('onetop.accounts.time.time',return_value=100):sampler.sample()
        with patch('onetop.accounts.profile_roots',return_value=[('Codex',root)]),patch.object(sampler,'codex',return_value=row),patch('onetop.accounts.time.time',return_value=200):sampler.sample()
        self.assertEqual(sampler.roots()[root][2],100)
        with patch('onetop.accounts.profile_roots',return_value=[('Codex',root)]),patch.object(sampler,'codex',return_value=dict(row,id='b')),patch('onetop.accounts.time.time',return_value=300):sampler.sample()
        self.assertEqual(sampler.roots()[root],('b','Codex',300))

    def test_blocked_profile_does_not_block_other_accounts_or_duplicate_requests(self):
        sampler=AccountQuotaSampler();sampler.profile_timeout=.01
        release=threading.Event();calls=[]
        row={'id':'codex','kind':'Codex','stale':False,'updated':100,'windows':[]}
        def blocked(root,now):
            calls.append(root);release.wait(5);return None
        try:
            with patch('onetop.accounts.profile_roots',return_value=[('Claude',Path('/profiles/claude')),('Codex',Path('/profiles/codex'))]),patch('onetop.accounts.read_json',return_value={'oauthAccount':{'accountUuid':'a','emailAddress':'test@example.test'}}),patch.object(sampler,'claude',side_effect=blocked),patch.object(sampler,'codex',return_value=row):
                sampler.sample();sampler.sample()
                rows=sampler.snapshot(100)
                self.assertEqual(len(calls),1)
                self.assertEqual(len(rows),2)
                self.assertFalse(next(q for q in rows if q['kind']=='Codex')['stale'])
                self.assertEqual(next(q for q in rows if q['kind']=='Claude')['status'],'refresh_pending')
        finally:release.set()

    def test_idle_zero_with_moving_reset_is_reported_partial_zero(self):
        self.point(self.now-240,0,reset=self.now+1000)
        self.point(self.now-120,0,reset=self.now+1300)
        self.assertEqual(self.period()['used_pp'],0)
        self.assertTrue(self.period()['partial'])

    def test_selected_period_tokens_drive_equivalent_not_old_observed_share(self):
        self.point(self.now-240,26);self.point(self.now-120,27)
        self.event(self.now-180,'calibration',3000000)
        self.event(self.now-500,'target',10000000,None)
        self.event(self.now-4000,'target',47000000,None)
        self.event(self.now-90000,'target',230000000,None)  # lifetime-only history
        _,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex'}],self.now,
                            bindings={'target':'a'},recording_started=self.now-172800)
        short,long=shares['target']['30m'],shares['target']['24h']
        self.assertEqual(short['tokens'],10000000)
        self.assertEqual(long['tokens'],57000000)
        self.assertAlmostEqual(short['used_pp'],10/3,places=4)
        self.assertEqual(long['used_pp'],19)
        self.assertAlmostEqual(long['used_pp']/short['used_pp'],5.7,places=3)
        self.assertEqual(short['basis'],'calibrated_token_equivalent')
        self.assertEqual(long['inferred_account_tokens'],57000000)
        self.assertFalse(long['partial'])
        self.assertEqual(self.db.execute("SELECT count(*) FROM events WHERE sid='target' AND account IS NULL").fetchone()[0],3)

    def test_zero_quota_movement_is_not_zero_conversion_rate(self):
        self.point(self.now-240,26);self.point(self.now-120,26)
        self.event(self.now-180,'s',3000000)
        self.assertEqual(self.period()['used_pp'],0)
        self.assertIsNone(self.result()[0]['accounts'][0]['calibration'])
        self.assertEqual(self.result()[1],{})

    def test_calibration_includes_zero_movement_intervals(self):
        self.point(self.now-360,20);self.point(self.now-240,22);self.point(self.now-120,22)
        self.event(self.now-300,'s',2000000);self.event(self.now-180,'s',2000000)
        c=self.result()[0]['accounts'][0]['calibration']
        self.assertEqual(c['tokens'],4000000)
        self.assertEqual(c['used_pp'],2)
        self.assertAlmostEqual(c['pp_per_token'],.0000005)

    def test_delayed_quota_callback_keeps_preceding_token_denominator(self):
        # The token log arrives while the integer quota is unchanged. A later
        # provider callback increments the quota without another token report.
        self.point(self.now-480,20);self.point(self.now-360,20)
        self.point(self.now-240,21);self.point(self.now-120,21)
        self.event(self.now-420,'s',3000000)
        c=self.result()[0]['accounts'][0]['calibration']
        self.assertEqual(c['tokens'],3000000)
        self.assertEqual(c['used_pp'],1)
        self.assertEqual(c['seconds'],360)
        self.assertAlmostEqual(c['pp_per_token'],1/3000000)

    def test_delayed_callback_does_not_cross_unattributed_work(self):
        for age,pct in [(600,20),(480,20),(360,20),(240,21)]:self.point(self.now-age,pct)
        self.event(self.now-540,'known',100)
        self.event(self.now-420,'unknown',100,None)
        self.assertIsNone(self.result()[0]['accounts'][0]['calibration'])

    def test_calibration_rejects_partial_account_token_coverage(self):
        self.point(self.now-240,20);self.point(self.now-120,22)
        self.event(self.now-180,'s',100)
        self.event(self.now-190,'unknown',100,None)
        self.assertIsNone(self.result()[0]['accounts'][0]['calibration'])

    def test_stale_account_does_not_produce_new_equivalent(self):
        self.point(self.now-240,20);self.point(self.now-120,22);self.event(self.now-180,'s',100)
        result,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex','stale':True}],self.now)
        self.assertIsNone(result['accounts'][0]['calibration']);self.assertEqual(shares,{})

    def test_calibration_does_not_borrow_another_accounts_rate(self):
        self.point(self.now-240,20);self.point(self.now-120,22);self.event(self.now-180,'s',100)
        _,shares=w.snapshot(self.db,[{'id':'a','kind':'Codex'},{'id':'b','kind':'Codex'}],self.now,bindings={'s':'b'})
        self.assertEqual(shares,{})

    def test_flow_keeps_original_intervals_when_history_is_thinned(self):
        for i in range(241):
            self.point(self.now-28800+i*120,10+i/10)
        account=self.result()[0]['accounts'][0]
        self.assertLessEqual(len(account['history']),96)
        self.assertEqual(len(account['flow']),240)
        self.assertTrue(all(t1-t0==120 for t0,t1,_ in account['flow']))
        self.assertAlmostEqual(sum(delta for _,_,delta in account['flow']),24)
        self.assertEqual(account['flow'][0][0],self.now-28800)
        self.assertEqual(account['flow'][-1][1],self.now)

    def test_flow_excludes_reset_gap_and_correction_but_preserves_zero(self):
        self.point(self.now-1000,98,reset=self.now-800)
        self.point(self.now-880,99,reset=self.now-800)
        self.point(self.now-760,1)
        self.point(self.now-640,1)
        self.point(self.now-100,2)
        self.point(self.now-40,1)
        self.assertEqual(self.result()[0]['accounts'][0]['flow'],[
            [self.now-1000,self.now-880,1],
            [self.now-760,self.now-640,0]])

    def test_increase_chart_keeps_reset_but_reconciles_correction_before_period_total(self):
        self.point(self.now-1200,98,reset=self.now-1000)
        self.point(self.now-900,2)
        self.point(self.now-120,6)
        self.point(self.now-60,5)
        account=self.result()[0]['accounts'][0]
        intervals=account['increase_intervals']
        self.assertEqual(intervals[0],[self.now-1200,self.now-900,2,True])
        self.assertEqual(intervals[1],[self.now-900,self.now-60,3,True])
        self.assertEqual(len(intervals),2)
        self.assertEqual(account['periods']['1h']['used_pp'],5)
        self.assertEqual(sum(x[2] for x in intervals if x[2] is not None),account['periods']['1h']['used_pp'])
        self.assertEqual(account['flow'],[])
