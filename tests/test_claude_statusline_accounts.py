import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from onetop.accounts import AccountQuotaSampler, identity


class ClaudeStatuslineAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.data=Path(self.temp.name);self.root=self.data/'profile';self.root.mkdir()
        self.reports=self.data/'claude-statusline';self.reports.mkdir()
        self.account={'accountUuid':'a','organizationUuid':'org','seatTier':'max'}
        self.write_account(self.account)
        self.key=identity('Claude','a','org')
        self.report={'schema':1,'source':'claude_statusline','t':980,'verified_activity':True,'profile':str(self.root),
                     'account_id':self.key,'session_id':'session-a',
                     'rl':{'five_hour':{'used_percentage':0,'resets_at':2000},
                           'seven_day':{'used_percentage':42,'resets_at':9000}}}
        p=patch('onetop.accounts.data_directory',return_value=self.data);p.start();self.addCleanup(p.stop)

    def write_account(self,value):
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':value}))

    def write_report(self,value=None,name='report.json'):
        (self.reports/name).write_text(json.dumps(value or self.report))

    def sample(self,now=1000):return AccountQuotaSampler().claude(self.root,now)

    def test_current_report_has_account_windows_without_reading_credentials(self):
        self.write_report()
        with patch('onetop.accounts.claude_credentials',side_effect=AssertionError('credential access')),patch('onetop.accounts.claude_usage',side_effect=AssertionError('network access')),patch('onetop.accounts.refresh_managed',side_effect=AssertionError('refresh')):
            row=self.sample()
        self.assertFalse(row['stale']);self.assertNotIn('status',row)
        self.assertEqual([w['pct'] for w in row['windows']],[0,42])
        self.assertEqual(row['updated'],980);self.assertEqual(row['plan'],'max')
        self.assertEqual(row['note'],'Claude Code 상태줄 보고')

    def test_old_report_remains_last_known_and_never_becomes_zero(self):
        self.write_report();row=self.sample(1400)
        self.assertTrue(row['stale']);self.assertEqual(row['status'],'report_pending')
        self.assertEqual(row['windows'][1]['pct'],42);self.assertIn('마지막 보고값',row['note'])

    def test_initial_report_is_last_known_and_excluded_from_weekly_calibration(self):
        import sqlite3
        from onetop import weekly_usage
        self.write_report({**self.report,'verified_activity':False})
        row=self.sample()
        self.assertTrue(row['stale']);self.assertEqual(row['status'],'last_report')
        self.assertEqual(row['windows'][1]['pct'],42)
        self.assertEqual(row['note'],'Claude Code 마지막 보고값 · 다음 응답에서 갱신')
        with sqlite3.connect(':memory:') as db:
            weekly_usage.initialize(db)
            weekly_usage.record(db,[row],1000)
            self.assertEqual(db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],0)

    def test_missing_report_is_pending_not_missing_login(self):
        row=self.sample()
        self.assertEqual(row['status'],'report_pending')
        self.assertEqual(row['note'],'Claude Code의 다음 사용량 보고를 기다립니다.')
        self.assertTrue(all(w['pct'] is None for w in row['windows']))

    def test_plan_label_uses_nonsecret_account_metadata(self):
        self.write_account({**self.account,'seatTier':None,'organizationRateLimitTier':'default_claude_max_5x'})
        self.assertEqual(self.sample()['plan'],'max')

    def test_oversized_report_is_ignored(self):
        self.write_report({**self.report,'padding':'x'*(16*1024)})
        self.assertEqual(self.sample()['updated'],0)

    def test_profile_account_and_organization_must_all_match(self):
        for change in ({'profile':str(self.data/'different')},{'account_id':identity('Claude','b','org')},
                       {'account_id':identity('Claude','a','different')},{'profile':'relative'}):
            with self.subTest(change=change):
                self.write_report({**self.report,**change});row=self.sample()
                self.assertEqual(row['updated'],0);self.assertTrue(row['stale'])

    def test_second_account_reports_do_not_leak_into_first(self):
        self.write_report()
        second=self.data/'second';second.mkdir()
        (second/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'b','organizationUuid':'org'}}))
        other={**self.report,'profile':str(second),'account_id':identity('Claude','b','org'),
               'rl':{'seven_day':{'used_percentage':12,'resets_at':9000}}}
        self.write_report(other,'second.json')
        self.assertEqual(self.sample()['windows'][1]['pct'],42)
        row=AccountQuotaSampler().claude(second,1000)
        self.assertEqual(row['windows'],[{'label':'주간','pct':12,'reset':9000}])

    def test_expired_window_is_unknown_and_not_carried_across_reset(self):
        self.report['rl']['five_hour']['resets_at']=990;self.write_report()
        row=self.sample()
        self.assertIsNone(row['windows'][0]['pct']);self.assertEqual(row['windows'][1]['pct'],42)
        self.report['rl']['seven_day']['resets_at']=999;self.write_report()
        row=self.sample();self.assertTrue(row['stale'])
        self.assertTrue(all(w['pct'] is None for w in row['windows']))

    def test_invalid_future_and_unattributed_reports_are_ignored(self):
        invalid=[{'t':1100},{'t':True},{'t':float('nan')},{'schema':True},{'source':'legacy'},
                 {'session_id':''},{'rl':{'seven_day':{'used_percentage':False,'resets_at':9000}}},
                 {'rl':{'seven_day':{'used_percentage':101,'resets_at':9000}}},
                 {'rl':{'seven_day':{'used_percentage':42,'resets_at':'9000'}}}]
        for change in invalid:
            with self.subTest(change=change):
                self.write_report({**self.report,**change});self.assertEqual(self.sample()['updated'],0)

    def test_newest_matching_report_wins_and_account_switch_invalidates(self):
        self.write_report()
        self.write_report({**self.report,'t':990,'rl':{'seven_day':{'used_percentage':43,'resets_at':9000}}},'new.json')
        self.assertEqual(self.sample()['windows'][0]['pct'],43)
        self.write_account({'accountUuid':'new','organizationUuid':'org'})
        self.assertEqual(self.sample()['updated'],0)

    def test_cached_rows_expire_even_without_a_new_report(self):
        sampler=AccountQuotaSampler();sampler.cached[self.key]={'updated':980,'source':'claude_statusline',
            'windows':[{'label':'주간','pct':42,'reset':990}]}
        row=sampler.claude(self.root,1000)
        self.assertTrue(row['stale']);self.assertIsNone(row['windows'][0]['pct'])

    def test_account_switch_during_read_rejects_report(self):
        self.write_report()
        from onetop.accounts import claude_statusline_report
        def read_then_switch(*args):
            report=claude_statusline_report(*args)
            self.write_account({'accountUuid':'new','organizationUuid':'org'})
            return report
        with patch('onetop.accounts.claude_statusline_report',side_effect=read_then_switch):
            self.assertIsNone(self.sample())

    def test_snapshot_refreshes_known_local_report_without_cli_or_discovery(self):
        sampler=AccountQuotaSampler();previous=sampler.claude(self.root,1000)
        sampler.rows=[previous];sampler.cached={self.key:previous}
        sampler.profile_accounts={self.root.resolve():(self.key,'Claude',990)}
        self.write_report()
        with patch('onetop.accounts.codex_rpc',side_effect=AssertionError('Codex RPC')),patch('onetop.accounts.profile_roots',side_effect=AssertionError('process scan')),patch('onetop.accounts.claude_credentials',side_effect=AssertionError('credential access')),patch('onetop.accounts.claude_usage',side_effect=AssertionError('HTTP')),patch('onetop.accounts.time.monotonic',return_value=100):
            rows=sampler.snapshot(1000)
        self.assertFalse(rows[0]['stale']);self.assertEqual(rows[0]['windows'][1]['pct'],42)
        self.assertEqual(sampler.next_local_refresh,101)
        self.write_report({**self.report,'t':1001,'rl':{'seven_day':{'used_percentage':43,'resets_at':9000}}})
        with patch('onetop.accounts.time.monotonic',return_value=100.5):
            self.assertEqual(sampler.snapshot(1000.5)[0]['windows'][1]['pct'],42)
        with patch('onetop.accounts.time.monotonic',return_value=101):
            self.assertEqual(sampler.snapshot(1001)[0]['windows'][0]['pct'],43)

    def test_legacy_cache_without_matching_organization_is_not_attributed(self):
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':self.account,
            'cachedUsageUtilization':{'accountUuid':'a','fetchedAtMs':990,
                                     'utilization':{'seven_day':{'utilization':99,'resets_at':9000}}}}))
        self.assertEqual(self.sample()['updated'],0)


if __name__=='__main__':unittest.main()
