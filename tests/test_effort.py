import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from onetop.aside import discover
from onetop.effort import apply_statusline, backfill_codex, level
from onetop.server import Collector, Ledger
from onetop.weekly_usage import initialize


def context(model='model-a', effort='ultra', timestamp=100, field='effort'):
    payload = {'model': model}
    if field:
        payload[field] = effort
    return {'type': 'turn_context', 'timestamp': timestamp, 'payload': payload}


class EffortTests(unittest.TestCase):
    def test_literal_levels_are_not_normalized_or_inferred(self):
        ledger = Ledger('Codex')
        for value in ('high', 'xhigh', 'ultra', 'max', 'provider-specific'):
            ledger.consume(context(effort=value))
            self.assertEqual(ledger.s['effort'], value)
        for value in (None, '', True, 3, {'level': 'high'}, 'prompt\ntext'):
            self.assertIsNone(level(value))

    def test_each_new_turn_replaces_or_clears_the_previous_effort(self):
        ledger = Ledger('Codex')
        ledger.consume(context(effort='ultra'))
        ledger.consume(context(model='model-b', field=None, timestamp=101))
        self.assertIsNone(ledger.s['effort'])
        ledger.consume(context(model='model-b', effort='high', field='reasoning_effort', timestamp=102))
        self.assertEqual(ledger.s['effort'], 'high')
        ledger.consume(context(model='model-b', effort=None, timestamp=103))
        self.assertIsNone(ledger.s['effort'])
        self.assertEqual(ledger.s['model_at'], 103)

    def test_new_context_does_not_import_prompt_or_config_fields(self):
        value = context()
        value['payload'].update(developer_instructions='private', launch_effort='low')
        ledger = Ledger('Codex'); ledger.consume(value)
        self.assertNotIn('private', json.dumps(ledger.s))
        self.assertNotIn('launch_effort', ledger.s)

    def test_cached_ledger_upgrade_persists_effort_without_recounting_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'thread.jsonl'
            path.write_text(json.dumps(context(effort='xhigh')) + '\n')
            state = Ledger('Codex').s
            state.pop('effort_schema')
            state.update(offset=path.stat().st_size, inode=path.stat().st_ino,
                         model='model-a', total=[1, 2, 3, 4], known=True)
            collector = Collector(); collector.started = 0
            collector.db = sqlite3.connect(':memory:'); self.addCleanup(collector.db.close)
            collector.db.executescript('CREATE TABLE trackers(path TEXT PRIMARY KEY,data TEXT); CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER);')
            initialize(collector.db)
            collector.db.execute('INSERT INTO trackers VALUES(?,?)', (str(path), json.dumps(state)))
            spec = {'path': str(path), 'id': 'thread', 'kind': 'Codex', 'configured_model': ''}
            collector.read_tracker(spec)
            self.assertEqual(spec['effort'], 'xhigh')
            self.assertEqual(spec['effort_source'], 'codex_turn_context')
            self.assertEqual(spec['tokens'], [1, 2, 3, 4])
            self.assertEqual(collector.db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)
            saved = json.loads(collector.db.execute('SELECT data FROM trackers').fetchone()[0])
            self.assertEqual(saved['effort'], 'xhigh')
            self.assertEqual(saved['offset'], state['offset'])

    def test_backfill_never_uses_old_model_or_partial_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'thread.jsonl'
            path.write_text(json.dumps(context()) + '\n' + json.dumps(context(model='model-b', effort='high')))
            state = {'model': 'model-b'}
            self.assertTrue(backfill_codex(state, path))
            self.assertNotIn('effort', state)
            self.assertFalse(backfill_codex(state, path))


class ClaudeSessionEffortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = (Path(self.temp.name) / 'profile').resolve(); self.root.mkdir()
        self.reports = Path(self.temp.name) / 'reports'; self.reports.mkdir()
        self.spec = {'id': 'session-a', 'kind': 'GLM', 'config_dir': str(self.root),
                     'model': 'model-a', 'model_updated': 100, 'process_birth': 50}
        self.report = {'schema': 1, 'profile': str(self.root), 'session_id': 'session-a',
                       'model': 'model-a', 'effort': 'high', 'updated': 150}
        key = hashlib.sha256((str(self.root) + '|session-a').encode()).hexdigest()
        self.path = self.reports / (key + '.json')

    def write(self, **changes):
        self.path.write_text(json.dumps({**self.report, **changes}))

    def test_report_works_without_subscription_account_or_quota(self):
        self.write(); apply_statusline(self.spec, 200, self.reports)
        self.assertEqual(self.spec['effort'], 'high')
        self.assertEqual(self.spec['effort_source'], 'claude_statusline')
        self.assertEqual(self.spec['effort_updated'], 150)

    def test_new_model_without_effort_clears_previous_level(self):
        self.write(); apply_statusline(self.spec, 200, self.reports)
        self.write(model='model-b', effort=None, updated=160)
        apply_statusline(self.spec, 200, self.reports)
        self.assertEqual(self.spec['model'], 'model-b')
        self.assertNotIn('effort', self.spec)

    def test_current_effort_without_model_does_not_replace_known_model(self):
        self.write(model=None)
        apply_statusline(self.spec, 200, self.reports)
        self.assertEqual(self.spec['effort'], 'high')
        self.assertEqual(self.spec['model'], 'model-a')
        self.assertEqual(self.spec['model_updated'], 100)

    def test_exact_profile_session_and_current_process_are_required(self):
        for changes in ({'profile': str(self.root / 'other')}, {'session_id': 'session-b'},
                        {'updated': 40}, {'updated': 99}, {'updated': 206},
                        {'updated': True}, {'updated': float('nan')}, {'schema': True}, {'model': True}):
            with self.subTest(changes=changes):
                spec = dict(self.spec, effort='stale')
                self.write(**changes); apply_statusline(spec, 200, self.reports)
                self.assertNotIn('effort', spec)

    def test_missing_report_does_not_fall_back_to_launch_configuration(self):
        self.spec.update(effort='stale', configured_effort='ultra')
        apply_statusline(self.spec, 200, self.reports)
        self.assertNotIn('effort', self.spec)


class AsideSessionEffortTests(unittest.TestCase):
    def test_exact_session_configuration_is_reported_without_global_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); base = home / '.aside/u/0'; base.mkdir(parents=True)
            db = sqlite3.connect(base / 'state.db')
            db.execute('CREATE TABLE sessions(id,title,status,model,cwd,created_at,updated_at,archived_at,incognito,ephemeral)')
            for sid, configuration in [('a', {'modelId': 'm', 'thinkingLevel': 'high'}), ('b', {'modelId': 'm'})]:
                db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)', (sid, 'Fixture', 'running', json.dumps(configuration), '/tmp/p', 10, 95, None, 0, 0))
            db.commit(); db.close()
            rows = {r['aside_session']: r for r in discover(home, 100, True)}
            self.assertEqual(rows['a']['effort'], 'high')
            self.assertEqual(rows['a']['effort_source'], 'aside_session_configuration')
            self.assertNotIn('effort', rows['b'])


if __name__ == '__main__':
    unittest.main()
