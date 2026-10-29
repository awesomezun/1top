import copy
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch

from onetop.server import Collector, DashboardHTTPServer, Handler
from onetop.time_ranges import extend_snapshot, parse_period
from onetop.usage import window_usage


class CustomTimeRanges(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.db = sqlite3.connect(self.path/'monitor.sqlite')
        self.addCleanup(self.db.close)
        self.db.executescript('''CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,
            cached INTEGER,written INTEGER,output INTEGER,account TEXT);
            CREATE INDEX event_time ON events(t);
            CREATE TABLE weekly_samples(account TEXT,kind TEXT,t REAL,pct REAL,reset REAL);''')
        self.now = 2_000_000
        self.started = self.now - 10 * 86400
        self.event(9*86400, 100, 'root')
        self.event(26*3600, 20, 'root')
        self.event(3600, 3, 'child')
        self.event(-60, 999, 'root')  # future reports never enter the result
        p, _ = window_usage(self.db, self.now, self.started, ['Codex'])
        self.snapshot = {'ready': True, 'updated': self.now, 'started': self.started,
                         'history_started': self.started, 'period_usage': p, 'events': [],
                         'sessions': [dict(id=sid, kind='Codex', tokens=([0]*4 if sid!='unknown' else None),
                                           root_session_id='root' if sid=='child' else sid,
                                           usage={'windows': {}, 'weekly_account': 'a'})
                                      for sid in ('root', 'child', 'zero', 'unknown')],
                         'weekly_usage': {'accounts': [{'id': 'a', 'periods': {}, 'calibration':
                             {'tokens': 100, 'used_pp': 1, 'seconds': 300, 'pp_per_token': .01}}]}}

    def event(self, age, n, sid, account='a'):
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',
                        (self.now-age, sid, 'Codex', n, 0, 0, 0, account))
        self.db.commit()

    def test_long_period_boundaries_totals_groups_and_client_isolation(self):
        original = copy.deepcopy(self.snapshot)
        self.event(36*3600, 1000, 'root')  # exact left boundary excluded
        self.event(0, 7, 'root')
        result = extend_snapshot(self.db, self.snapshot, 'custom:129600')
        period = result['period_usage']['windows'][-1]
        self.assertEqual(period['label'], '36시간')
        self.assertEqual(period['tokens'][0], 30)
        self.assertEqual(sum(e['fresh'] for e in result['events']), 30)
        self.assertEqual(result['root_sessions'][0]['usage']['windows']['custom:129600'][0], 30)
        self.assertEqual(result['sessions'][2]['usage']['windows']['custom:129600'], [0]*4)
        self.assertIsNone(result['sessions'][3]['usage']['windows']['custom:129600'])
        self.assertEqual(result['sessions'][0]['usage']['weekly_estimate']['custom:129600']['used_pp'], .27)
        self.assertEqual(self.snapshot, original)
        short = extend_snapshot(self.db, self.snapshot, 'custom:600')
        self.assertEqual(short['period_usage']['windows'][-1]['tokens'][0], 7)
        self.assertNotIn('custom:129600', short['sessions'][0]['usage']['windows'])

    def test_all_history_and_huge_duration_remain_bounded(self):
        self.event(100, 2, 'closed')
        all_data = extend_snapshot(self.db, self.snapshot, 'all')
        self.assertEqual(all_data['period_usage']['windows'][-1]['tokens'][0], 125)
        self.assertEqual(all_data['period_usage']['windows'][-1]['label'], '전체 기록')
        long = extend_snapshot(self.db, self.snapshot, 'custom:315360000000')
        self.assertTrue(long['period_usage']['windows'][-1]['partial'])
        self.assertEqual(long['period_usage']['windows'][-1]['tokens'][0], 125)
        self.assertLessEqual(len(long['events']), 241)
        self.assertLessEqual((long['chart_range']['end']-long['chart_range']['start'])/long['chart_range']['step'], 240)

    def test_earlier_account_is_never_assigned_to_current_account(self):
        self.event(27*3600, 5, 'root', 'different-account')
        result = extend_snapshot(self.db, self.snapshot, 'custom:129600')
        estimate = result['sessions'][0]['usage']['weekly_estimate']['custom:129600']
        self.assertEqual(estimate['used_pp'], .2)
        self.assertTrue(estimate['partial'])
        self.assertEqual(estimate['excluded_account_tokens'], 5)
        self.assertEqual(result['sessions'][0]['usage']['windows']['custom:129600'][0], 25)

    def test_aside_equivalent_and_grouping_survive_week_and_all_ranges(self):
        self.db.execute("UPDATE events SET kind='Aside'")
        self.db.execute("UPDATE events SET account=NULL WHERE sid='child'")
        for session in self.snapshot['sessions']:
            session.update(kind='Aside',billing_kind='Codex')
        for key,expected in [('custom:604800',.23),('all',1.23)]:
            result=extend_snapshot(self.db,self.snapshot,key)
            group=result['root_sessions'][0]
            self.assertAlmostEqual(group['usage']['weekly_estimate'][key]['used_pp'],expected)
            self.assertEqual(group['children_count'],1)
            child=next(s for s in result['sessions'] if s['id']=='child')
            self.assertEqual(child['usage']['weekly_estimate'][key]['inferred_account_tokens'],3)

    def test_provider_history_is_partial_not_extrapolated(self):
        self.db.executemany('INSERT INTO weekly_samples VALUES(?,?,?,?,?)',
                           [('a','Codex',self.now-600,10,self.now+86400),
                            ('a','Codex',self.now-300,12,self.now+86400)])
        result = extend_snapshot(self.db, self.snapshot, 'custom:129600')
        period = result['weekly_usage']['accounts'][0]['periods']['custom:129600']
        self.assertEqual(period['used_pp'], 2)
        self.assertTrue(period['partial'])
        self.assertEqual(period['observed_seconds'], 300)

    def test_invalid_durations_and_http_isolated_query(self):
        for value in ('custom:0','custom:599','custom:601','custom:nan','custom:1e30','custom:-600','bad','custom:9000000000000'):
            with self.assertRaises(ValueError): parse_period(value)
        collector = Collector(); collector.snapshot = self.snapshot
        server = DashboardHTTPServer(('127.0.0.1',0),Handler)
        server.collector = collector; server.action_token = 'test'
        server.controller = Mock(); server.controller.decorate.side_effect = lambda s:s
        worker = threading.Thread(target=server.serve_forever,daemon=True); worker.start()
        try:
            with patch('onetop.server.DATA',self.path):
                url = f'http://127.0.0.1:{server.server_port}/api/state'
                with urllib.request.urlopen(url+'?period=custom:129600') as r: body=json.load(r)
                self.assertEqual(body['period_usage']['windows'][-1]['seconds'],129600)
                with urllib.request.urlopen(url) as r: baseline=json.load(r)
                self.assertEqual(len(baseline['period_usage']['windows']),6)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(url+'?period=custom:1')
                self.assertEqual(error.exception.code,400)
                error.exception.close()
        finally:
            server.shutdown(); server.server_close(); worker.join(2)


if __name__ == '__main__': unittest.main()
