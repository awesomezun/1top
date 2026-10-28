import sqlite3
import unittest

from onetop import weekly_usage as w


class ClaudeHistoricalCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.now=1000000;self.reset=self.now+100000
        self.db=sqlite3.connect(':memory:');self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INT,cached INT,written INT,output INT,account TEXT)')
        w.initialize(self.db)
        self.event(self.now-86650,1)

    def point(self,t,pct,reset=None):
        self.db.execute('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',('a','Claude',t,pct,self.reset if reset is None else reset))

    def event(self,t,tokens=100,account='a',sid='s'):
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(t,sid,'Claude',tokens,0,0,0,account))

    def result(self,**changes):
        row={'id':'a','kind':'Claude','source':'claude_statusline','stale':True,
             'windows':[{'label':'주간','pct':5,'reset':self.reset}]}
        row.update(changes)
        result,shares=w.snapshot(self.db,[row],self.now,bindings={'s':'a'},recording_started=self.now-86400)
        return result['accounts'][0],shares,row

    def test_event_driven_411_second_gap_can_calibrate_without_making_quota_fresh(self):
        self.point(self.now-811,4);self.point(self.now-400,5)
        self.event(self.now-700,100);self.event(self.now-500,300)
        result,shares,row=self.result()
        calibration=result['calibration']
        self.assertEqual(calibration['tokens'],400);self.assertEqual(calibration['used_pp'],1)
        self.assertEqual(calibration['seconds'],411)
        self.assertEqual(calibration['source'],'historical_provider_calibration')
        self.assertEqual(calibration['kind'],'Claude');self.assertEqual(calibration['reset'],self.reset)
        self.assertEqual(calibration['valid_until'],self.now-400+86400)
        self.assertEqual(calibration['age_seconds'],400)
        self.assertAlmostEqual(shares['s']['1h']['used_pp'],1)
        self.assertTrue(row['stale'])
        self.assertEqual(result['periods']['1h']['unattributed_pp'],1)

    def test_gap_longer_than_one_hour_is_not_calibrated(self):
        self.point(self.now-4001,4);self.point(self.now-400,5);self.event(self.now-1000)
        self.assertIsNone(self.result()[0]['calibration'])

    def test_unbound_tokens_in_interval_block_conversion(self):
        self.point(self.now-811,4);self.point(self.now-400,5)
        self.event(self.now-700);self.event(self.now-600,account=None)
        self.assertIsNone(self.result()[0]['calibration'])

    def test_interval_before_account_attribution_started_is_not_complete_coverage(self):
        self.db.execute('DELETE FROM events')
        self.point(self.now-811,4);self.point(self.now-400,5);self.event(self.now-700)
        self.assertIsNone(self.result()[0]['calibration'])

    def test_other_account_tokens_cannot_supply_conversion(self):
        self.point(self.now-811,4);self.point(self.now-400,5);self.event(self.now-700,account='b')
        self.assertIsNone(self.result()[0]['calibration'])

    def test_reset_interval_and_expired_current_cycle_do_not_calibrate(self):
        self.point(self.now-811,99,reset=self.now-600);self.point(self.now-400,1)
        self.event(self.now-700)
        self.assertIsNone(self.result()[0]['calibration'])
        self.db.execute('DELETE FROM weekly_samples')
        self.point(self.now-811,4,reset=self.now-1);self.point(self.now-400,5,reset=self.now-1)
        self.assertIsNone(self.result(windows=[{'label':'주간','pct':None,'reset':self.now-1}])[0]['calibration'])

    def test_conflicting_current_cycle_does_not_borrow_old_ratio(self):
        self.point(self.now-811,4);self.point(self.now-400,5);self.event(self.now-700)
        self.assertIsNone(self.result(windows=[{'label':'주간','pct':5,'reset':self.reset+5000}])[0]['calibration'])

    def test_correction_still_invalidates_preceding_positive_interval(self):
        self.point(self.now-1000,4);self.point(self.now-600,5);self.point(self.now-400,4)
        self.event(self.now-800);self.event(self.now-500)
        self.assertIsNone(self.result()[0]['calibration'])

    def test_old_ratio_expires_after_24_hours_even_before_weekly_reset(self):
        self.point(self.now-86600,4);self.point(self.now-86401,5);self.event(self.now-86500)
        self.assertIsNone(self.result()[0]['calibration'])

    def test_constant_weekly_percentage_never_fabricates_zero_conversion(self):
        self.point(self.now-811,12);self.point(self.now-400,12);self.event(self.now-700)
        self.assertIsNone(self.result(source='historical_provider_report')[0]['calibration'])

    def test_unrecognized_report_source_does_not_get_historical_exception(self):
        self.point(self.now-811,4);self.point(self.now-400,5);self.event(self.now-700)
        self.assertIsNone(self.result(source='unknown')[0]['calibration'])


if __name__=='__main__':unittest.main()
