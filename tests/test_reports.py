"""Reports (report-contract v1.2.0): prices, the month's value, state spans, the week and the notices."""
import datetime
import sqlite3
import tempfile
import unittest
from pathlib import Path

from onetop import pricing, reports


def at(y, m, d, h=0, mi=0):
    return datetime.datetime(y, m, d, h, mi).timestamp()


class PricingTests(unittest.TestCase):
    def test_known_models(self):
        self.assertEqual(pricing.price('claude-opus-5-5'), (4, .20, 5, 20))
        self.assertEqual(pricing.price('claude-opus-5'), (5, .50, 6.25, 25))
        self.assertEqual(pricing.price('claude-sonnet-4-5-20250929'), (3, .30, 3.75, 15))
        self.assertEqual(pricing.price('glm-5.3[1m]'), (1.40, .26, 0, 4.40))
        self.assertEqual(pricing.price('openai/gpt-6.1-sol'), (2, .10, 2.5, 10))

    def test_unknown_models_have_no_price(self):
        # A new variant of a known name has no price until the table names it.
        for model in ('', 'unknown', None, 'mystery-1', 'claude-opus-5-99', 'glm-5.30', 'gpt-6-astra-unknown'):
            self.assertIsNone(pricing.price(model))
            self.assertIsNone(pricing.value(model, [1, 1, 1, 1]))

    def test_value_per_token_kind(self):
        # One million of each: 4 + 0.20 + 5 + 20.
        self.assertAlmostEqual(pricing.value('claude-opus-5-5', [1e6, 1e6, 1e6, 1e6]), 29.2)

    def test_plans(self):
        self.assertEqual(pricing.plan('Claude', 'max', 'default_claude_max_20x'), ('max20x', 'Claude Max 20x', 200))
        self.assertEqual(pricing.plan('Claude', 'max', 'default_claude_max_5x'), ('max', 'Claude Max', 100))
        self.assertEqual(pricing.plan('Claude', 'pro')[2], 20)
        self.assertEqual(pricing.plan('Codex', 'plus')[2], 20)
        # ChatGPT Pro comes at three prices: the user picks.
        self.assertIsNone(pricing.plan('Codex', 'pro')[2])
        self.assertIsNone(pricing.plan('GLM', 'pro')[2])
        self.assertEqual(pricing.plan('GLM', 'lite')[2], 18)


class SpanTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        reports.initialize(self.db)
        self.spans = reports.Spans()

    def rows(self):
        return self.db.execute('SELECT sid,state,label,start,end FROM state_spans ORDER BY start').fetchall()

    def test_a_span_grows_and_ends_on_a_change(self):
        t = at(2026, 11, 2, 9)
        s = {'id': 's1', 'kind': 'Claude', 'status': 'working', 'project': '/Users/me/code/checkout-web'}
        for i in range(0, 600, 3):
            self.spans.record(self.db, [s], t + i)
        for i in range(600, 900, 3):
            self.spans.record(self.db, [{**s, 'status': 'waiting'}], t + i)
        self.spans.record(self.db, [{**s, 'status': 'idle'}], t + 900)
        rows = self.rows()
        self.assertEqual([(r[1], r[2]) for r in rows], [('working', 'checkout-web'), ('waiting', 'checkout-web')])
        self.assertEqual(rows[0][4] - rows[0][3], 600)
        self.assertEqual(rows[1][4] - rows[1][3], 300)

    def test_a_gap_ends_the_span_where_it_was_last_seen(self):
        t = at(2026, 11, 2, 9)
        s = {'id': 's1', 'kind': 'Codex', 'status': 'working', 'project': 'api'}
        self.spans.record(self.db, [s], t)
        self.spans.record(self.db, [s], t + 60)
        self.spans.record(self.db, [s], t + 3600)  # the computer slept
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][4], t + 60)

    def test_subagents_and_unseen_sessions(self):
        t = at(2026, 11, 2, 9)
        self.spans.record(self.db, [{'id': 'p', 'status': 'working'}, {'id': 'c', 'status': 'working', 'is_subagent': True}], t)
        self.spans.record(self.db, [], t + 30)
        rows = self.rows()
        self.assertEqual([r[0] for r in rows], ['p'])
        self.assertEqual(rows[0][4], t)

    def test_parent_with_working_children_counts_as_working(self):
        t = at(2026, 11, 2, 9)
        self.spans.record(self.db, [{'id': 'p', 'status': 'idle', 'children_working': 2}], t)
        self.assertEqual(self.rows()[0][1], 'working')


class WeekTests(unittest.TestCase):
    def test_week_from_monday_with_days_and_last_week_at_the_same_time(self):
        db = sqlite3.connect(':memory:')
        reports.initialize(db)
        rows = [('a', 'Claude', 'working', 'web', at(2026, 11, 2, 9), at(2026, 11, 2, 12)),
                ('a', 'Claude', 'waiting', 'web', at(2026, 11, 2, 12), at(2026, 11, 2, 12, 30)),
                ('b', 'Codex', 'working', 'api', at(2026, 11, 3, 23), at(2026, 11, 4, 1)),   # across midnight
                ('c', 'Codex', 'waiting', 'ops', at(2026, 10, 26, 10), at(2026, 10, 26, 11)),  # last week
                ('c', 'Codex', 'working', 'ops', at(2026, 11, 1, 20), at(2026, 11, 2, 2))]     # Sunday into Monday
        db.executemany('INSERT INTO state_spans VALUES(?,?,?,?,?,?)', rows)
        w = reports.weekly(db, at(2026, 11, 4, 12))
        self.assertEqual(w['start'], at(2026, 11, 2))
        self.assertEqual(w['working_s'], 3 * 3600 + 2 * 3600 + 2 * 3600)
        self.assertEqual(w['waiting_s'], 1800)
        self.assertEqual([d['date'] for d in w['days']], ['2026-11-02', '2026-11-03', '2026-11-04'])
        self.assertEqual(w['days'][1]['working_s'], 3600)
        self.assertEqual(w['longest_wait']['label'], 'web')
        self.assertEqual(w['previous']['waiting_s'], 3600)
        self.assertTrue(w['previous']['partial'])  # records began after last Monday 0:00
        self.assertEqual(reports.last_week(db, at(2026, 11, 4, 12))['waiting_s'], 3600)


class ValueTests(unittest.TestCase):
    def test_month_value_plans_and_exclusions(self):
        quotas = [{'id': 'c1', 'kind': 'Claude', 'plan': 'max', 'plan_tier': 'default_claude_max_5x'},
                  {'id': 'x1', 'kind': 'Codex', 'plan': 'pro'}]
        totals = {('Claude', 'claude-opus-5-5'): [1e6, 0, 0, 1e6], ('Claude', 'unknown'): [5e5, 0, 0, 0],
                  ('Codex', 'gpt-6.1-sol'): [1e6, 0, 0, 0], ('Aside', 'gpt-6.1-sol'): [1e6, 0, 0, 0]}
        v = reports.Value().compute(lambda a, b: dict(totals) if b - a < 40 * 86400 else {}, quotas, {}, at(2026, 11, 7, 17))
        self.assertEqual(v['month'], '2026-11')
        self.assertEqual(v['plan_total'], 100)  # ChatGPT Pro's price is unknown
        self.assertEqual(v['api_value'], 26.0)  # 24 Claude + 2 Codex
        # Codex has a plan without a price, so it stays out of the multiple: 24 against Claude's 100.
        self.assertEqual(v['ratio'], .24)
        self.assertEqual({k['kind']: k['ratio'] for k in v['by_kind']}, {'Claude': .24, 'Codex': None})
        self.assertEqual(v['unpriced'], {'tokens': 500000, 'models': ['unknown']})
        self.assertEqual(v['excluded'], {'api_value': 2.0, 'kinds': ['Aside']})
        self.assertEqual([p['source'] for p in v['plans']], ['detected', 'unknown'])
        self.assertEqual(len(v['months']), 5)
        self.assertEqual({(m['api_value'], m['plan_total']) for m in v['months']}, {(24.0, 100)})

    def test_users_own_plan(self):
        with tempfile.TemporaryDirectory() as data:
            reports.set_plan(data, 'x1', 'pro', 200, {'x1'})
            rows = reports.plans([{'id': 'x1', 'kind': 'Codex', 'plan': 'pro'}], reports.read_plans(data))
            self.assertEqual((rows[0]['price'], rows[0]['source']), (200, 'user'))
            with self.assertRaises(ValueError):
                reports.set_plan(data, 'nobody', 'pro', 20, {'x1'})
            with self.assertRaises(ValueError):
                reports.set_plan(data, 'x1', 'pro', -1, {'x1'})
            reports.set_plan(data, 'x1', None, None, {'x1'})
            self.assertEqual(reports.read_plans(data), {})


class NoticeTests(unittest.TestCase):
    def quota(self, pct):
        return [{'id': 'c1', 'kind': 'Claude', 'stale': False, 'windows': [{'label': '주간', 'pct': pct, 'reset': at(2026, 11, 10, 19)}]}]

    def weekly(self, used):
        return {'accounts': [{'id': 'c1', 'periods': {'5h': {'used_pp': used, 'observed_seconds': 18000}}}]}

    def test_once_on_turning_early_then_quiet_for_six_hours(self):
        with tempfile.TemporaryDirectory() as data:
            now = at(2026, 11, 7, 17)
            items, _ = reports.notices(data, self.quota(51), self.weekly(1), {'c1': 'Claude Code Max'}, None, None, now)
            self.assertEqual(items, [])  # 0.2%/h: lasts past the reset
            items, _ = reports.notices(data, self.quota(51), self.weekly(5), {'c1': 'Claude Code Max'}, None, None, now + 60)
            self.assertEqual([n['type'] for n in items], ['limit'])
            self.assertIn('Claude Code Max', items[0]['title'])
            items, _ = reports.notices(data, self.quota(52), self.weekly(5), {}, None, None, now + 120)
            self.assertEqual(len(items), 1)  # still early: no second notice
            reports.notices(data, self.quota(52), self.weekly(1), {}, None, None, now + 180)  # recovered
            items, _ = reports.notices(data, self.quota(52), self.weekly(5), {}, None, None, now + 240)
            self.assertEqual(len(items), 1)  # early again within six hours: still quiet
            items, _ = reports.notices(data, self.quota(52), self.weekly(1), {}, None, None, now + 7 * 3600)
            items, _ = reports.notices(data, self.quota(52), self.weekly(5), {}, None, None, now + 7 * 3600 + 60)
            self.assertEqual(len(items), 2)

    def test_switched_off_and_weekly_once(self):
        with tempfile.TemporaryDirectory() as data:
            reports.set_settings(data, {'limit': False})
            now = at(2026, 11, 9, 9)  # a Monday
            items, settings = reports.notices(data, self.quota(51), self.weekly(5), {}, {'start': at(2026, 11, 2), 'working_s': 148320, 'waiting_s': 22800}, {'ratio': 5.2}, now)
            self.assertEqual(settings, {'limit': False, 'weekly': True})
            self.assertEqual([n['type'] for n in items], ['weekly'])
            self.assertEqual(items[0]['title'], '지난주 에이전트 작업 41시간 12분')
            items, _ = reports.notices(data, [], {}, {}, {'start': at(2026, 11, 2), 'working_s': 1, 'waiting_s': 1}, None, now + 3600)
            self.assertEqual(len(items), 1)
            # Switched off afterwards, the notices already made go too.
            reports.set_settings(data, {'weekly': False})
            items, _ = reports.notices(data, [], {}, {}, None, None, now + 7200)
            self.assertEqual(items, [])
            with self.assertRaises(ValueError):
                reports.set_settings(data, {'limit': 'no'})


if __name__ == '__main__':
    unittest.main()


class RouteTests(unittest.TestCase):
    """The plan and notice routes need this computer's origin and token, like the account names."""

    def test_plan_and_notification_routes(self):
        import json
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        from types import SimpleNamespace
        from unittest.mock import patch
        from onetop.server import Handler
        with tempfile.TemporaryDirectory() as folder, patch('onetop.server.DATA', Path(folder)):
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.action_token = 'token'
            server.collector = SimpleNamespace(lock=threading.Lock(), snapshot={'account_quotas': [{'id': 'x1', 'kind': 'Codex'}]},
                                               reports_value={'end': 0}, value_report=SimpleNamespace(current=('x',)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}'

            def call(path, body=None, token='token', origin=None):
                req = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(),
                                             headers={'Content-Type': 'application/json', 'Origin': origin or url, 'X-Monitor-Token': token})
                try:
                    with urllib.request.urlopen(req) as response:
                        return response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    code = error.code
                    error.close()
                    return code, {}
            try:
                self.assertEqual(call('/api/reports/plan', {'account_id': 'x1', 'plan': 'pro', 'price': 200}, token='wrong')[0], 403)
                self.assertEqual(call('/api/reports/plan', {'account_id': 'x1', 'plan': 'pro', 'price': 200}),
                                 (200, {'ok': True, 'plan': {'plan': 'pro', 'price': 200.0}}))
                self.assertIsNone(server.collector.reports_value)
                self.assertEqual(call('/api/reports/plan', {'account_id': 'nobody', 'plan': 'pro', 'price': 1})[0], 400)
                self.assertEqual(call('/api/notifications', {'weekly': False}), (200, {'ok': True, 'settings': {'limit': True, 'weekly': False}}))
                self.assertEqual(call('/api/notifications'), (200, {'ok': True, 'settings': {'limit': True, 'weekly': False}}))
                self.assertEqual(call('/api/notifications', {'weekly': 'no'})[0], 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
