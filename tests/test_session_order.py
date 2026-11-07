import copy
import json
import threading
import unittest
import urllib.request
from types import SimpleNamespace

from onetop.session_order import ordered_snapshot
from onetop.server import DashboardHTTPServer, Handler


def row(id, amount, status='idle', half=None, **extra):
    return {'id': id, 'status': status, 'tokens': [999999, 0, 0, 0],
            'usage': {'windows': {'1h': amount, '30m': half}}, **extra}


def ids(snapshot, name='root_sessions'):
    return [s['id'] for s in snapshot[name]]


class SessionOrderTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row('idle-big', [1000, 0, 0, 0]),
                     row('active-small', [10, 20, 30, 40], 'working'),
                     row('active-big', [200, 0, 0, 0], 'working'),
                     row('waiting', [800, 0, 0, 0], 'waiting'),
                     row('idle-small', [1, 0, 0, 0])]
        self.snapshot = {'ready': True, 'sessions': self.rows, 'root_sessions': self.rows}

    def test_working_then_period_tokens_across_other_states(self):
        result = ordered_snapshot(self.snapshot)
        self.assertEqual(ids(result), ['active-big', 'active-small', 'idle-big', 'waiting', 'idle-small'])
        self.assertEqual(ids(result, 'sessions'), ids(result))

    def test_selected_period_and_no_lifetime_or_percent_fallback(self):
        self.rows[1]['usage']['windows']['30m'] = [500, 0, 0, 0]
        self.rows[2]['usage']['windows']['30m'] = [1, 0, 0, 0]
        self.rows[2]['usage']['weekly_estimate'] = {'30m': {'used_pp': 99}}
        self.assertEqual(ids(ordered_snapshot(self.snapshot, '30m'))[:2], ['active-small', 'active-big'])
        self.assertEqual(ids(ordered_snapshot(self.snapshot))[:2], ['active-big', 'active-small'])

    def test_status_and_usage_changes_apply_without_a_timer(self):
        ordered_snapshot(self.snapshot)
        self.rows[0]['status'] = 'working'
        self.assertEqual(ids(ordered_snapshot(self.snapshot))[0], 'idle-big')
        self.rows[1]['usage']['windows']['1h'] = [2000, 0, 0, 0]
        self.assertEqual(ids(ordered_snapshot(self.snapshot))[0], 'active-small')
        self.rows[1]['display_status'] = 'paused'
        self.assertEqual(ids(ordered_snapshot(self.snapshot))[0], 'idle-big')

    def test_child_work_and_structure_are_preserved(self):
        self.rows[0].update(children_working=1, children_ids=['child'])
        child = row('child', [999999, 0, 0, 0], 'working', is_subagent=True)
        self.snapshot['sessions'] = [*self.rows, child]
        result = ordered_snapshot(self.snapshot)
        self.assertEqual(ids(result)[0], 'idle-big')
        self.assertNotIn('child', ids(result))
        self.assertIn('child', ids(result, 'sessions'))
        self.assertEqual(result['root_sessions'][0]['children_ids'], ['child'])

    def test_zero_precedes_unknown_and_ties_use_id(self):
        rows = [row('unknown', None), row('b', [0, 0, 0, 0]), row('a', [0, 0, 0, 0])]
        self.assertEqual(ids(ordered_snapshot({'root_sessions': rows})), ['a', 'b', 'unknown'])

    def test_invalid_usage_is_unknown(self):
        rows = [row(str(i), value) for i, value in enumerate([[], [-1], [float('nan')],
                                                               [float('inf')], ['5'], [True]])]
        rows += [row('zero', [0, 0, 0, 0])]
        self.assertEqual(ids(ordered_snapshot({'root_sessions': rows}))[0], 'zero')

    def test_sort_does_not_mutate_shared_snapshot(self):
        before = copy.deepcopy(self.snapshot)
        result = ordered_snapshot(self.snapshot)
        self.assertEqual(self.snapshot, before)
        self.assertIsNot(result['root_sessions'], self.rows)
        self.assertEqual(ordered_snapshot({'ready': False}), {'ready': False})

    def test_api_sorts_after_controller_overlay_and_uses_query_period(self):
        self.rows[1]['usage']['windows']['30m'] = [500, 0, 0, 0]
        self.rows[2]['usage']['windows']['30m'] = [1, 0, 0, 0]
        requested = []
        def state_for_period(period):
            requested.append(period)
            return self.snapshot
        def decorate(snapshot):
            # This status override must take precedence over the collector's status.
            return {**snapshot, 'root_sessions': [dict(s, display_status='paused')
                    if s['id'] == 'active-big' else s for s in snapshot['root_sessions']]}
        server = DashboardHTTPServer(('127.0.0.1', 0), Handler)
        server.collector = SimpleNamespace(snapshot=self.snapshot, lock=threading.Lock(),
                                           state_for_period=state_for_period)
        server.controller = SimpleNamespace(decorate=decorate)
        server.action_token = 'test'
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for suffix in ('', '?period=30m'):
                with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/state{suffix}') as response:
                    self.assertEqual(ids(json.load(response))[0], 'active-small')
            self.assertEqual(requested, ['30m'])
        finally:
            server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__':
    unittest.main()
