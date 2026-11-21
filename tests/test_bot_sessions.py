"""Session contract T5: AI seats that bot apps host without a terminal (OpenBot, OpenMausBot) and their tokens."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from onetop.sessions import resolve
from onetop.observe import openmausbot
from onetop.observe.processes import describe
from onetop import server
from onetop.history import HistoryStore

APP = ['OpenBot', '/Applications/OpenBot.app']
SDK = ['claude', '--output-format', '<arg>', '--verbose', '--input-format', '<arg>', '--system-prompt-snapshot', '<arg>']


def proc(pid, argv, ppid=100, **extra):
    return {'pid': pid, 'ppid': ppid, 'birth': 10.0 + pid, 'tty': '', 'cwd': '/work', 'config_dir': '/home/.claude',
            'argv': argv, 'env': {}, 'app': ['', ''], **extra}


def record(processes, **extra):
    host = {'pid': 100, 'ppid': 1, 'birth': 1.0, 'tty': '', 'cwd': '/', 'argv': ['OpenBot'], 'name': 'OpenBot', 'env': {}, 'app': APP}
    return {'captured_at': 1000, 'processes': [host, *processes], 'claude_registry': {}, 'claude_transcripts': {},
            'codex_logs': [], 'orca_terminals': [], 'tmux_panes': {}, 'aside_sessions': [], **extra}


class AppSeats(unittest.TestCase):
    def test_sdk_seat_is_the_apps_chat_named_by_its_agent(self):
        agents = [{'workspace': '/bots/agent-1', 'name': 'Atlas'}]
        rows = resolve(record([proc(11, SDK, cwd='/bots/agent-1')], openbot_agents=agents))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['display_name'], row['display_detail'], row['terminal_match']), ('Atlas', 'OpenBot 채팅', 'chat'))
        self.assertEqual((row['location']['app'], row['location']['terminal'], row['project_name']), ('OpenBot', 'OpenBot 채팅', 'Atlas'))
        self.assertNotIn('control_key', row)
        self.assertFalse(row['shape_unknown'])

    def test_the_collectors_own_quota_probe_is_not_a_session(self):
        # 1top runs `agy /usage` every two minutes; under the collector it is a helper, elsewhere a session.
        from onetop.observe.processes import mark_own_probes
        collector = proc(50, ['onetop-agent', 'run'], ppid=1, kind=None)
        probe = proc(51, ['agy'], ppid=50, kind='Antigravity', cwd='/home')
        user = proc(52, ['agy'], ppid=100, kind='Antigravity', tty='/dev/ttys003')
        rows = mark_own_probes([collector, probe, user], 50)
        self.assertEqual((rows[1].get('own_probe'), rows[2].get('own_probe')), (True, None))
        found = resolve(record(rows))
        self.assertEqual([r['pids'] for r in found], [[52]])

    def test_a_terminal_cli_with_stream_input_stays_a_terminal_session(self):
        self.assertEqual(describe(proc(11, SDK, tty='/dev/ttys001'))['role'], 'shape_unknown')
        self.assertEqual(describe(proc(11, SDK))['role'], 'chat')

    def test_probes_without_a_conversation_are_not_rows(self):
        probe = ['claude', '--output-format', '<arg>', '--input-format', '<arg>', '--no-session-persistence']
        self.assertEqual(describe(proc(12, probe))['role'], 'helper')
        self.assertEqual(resolve(record([proc(12, probe)])), [])
        # The same flag in a terminal is the user's own run.
        self.assertNotEqual(describe(proc(12, ['claude', '-p', '--no-session-persistence'], tty='/dev/ttys002'))['role'], 'helper')

    def test_codex_thread_held_by_the_apps_backend_is_its_chat(self):
        log = {'id': 't1', 'session_id': 't1', 'profile': '/home/.codex', 'cwd': '/bots/agent-2', 'title': 'OpenBot · Brain',
               'name': 'OpenBot · Brain', 'holders': [21], 'events': []}
        backend = proc(21, ['codex', 'app-server', '--listen', '<arg>'], kind='Codex', config_dir='/home/.codex')
        rows = resolve(record([backend], codex_logs=[log], openbot_agents=[{'workspace': '/bots/agent-2', 'name': 'Brain'}]))
        row = next(r for r in rows if r['id'] == 't1')
        self.assertEqual((row['display_name'], row['display_detail'], row['location']['app']), ('Brain', 'OpenBot 채팅', 'OpenBot'))
        self.assertEqual(row['pids'], [])
        # A backend inside a terminal belongs to a CLI: its thread stays unconfirmed, not an app chat.
        tui = {**backend, 'tty': '/dev/ttys003'}
        row = next(r for r in resolve(record([tui], codex_logs=[log])) if r['id'] == 't1')
        self.assertNotEqual(row['terminal_match'], 'chat')

    def test_an_aside_turn_that_errored_reads_as_interrupted(self):
        # Aside marks a conversation whose last turn failed as 'errored'; it is over, not of unknown state.
        from onetop.sessions.aside import build
        from onetop.sessions import status
        base = {'profile': '1', 'model': {'modelId': 'gpt', 'provider': 'openai-codex'}, 'trigger': {}, 'title': 't',
                'running': True, 'path': None, 'db': '/x/state.db', 'created': 1, 'updated': 900, 'billing_accounts': {}}
        rows = build([{**base, 'id': 's1', 'status': 'errored'}, {**base, 'id': 's2', 'status': 'idle'}])
        status.apply(rows, {'captured_at': 1000})
        self.assertEqual([r['display_status'] for r in rows], ['interrupted', 'idle'])

    def test_openmausbot_threads_from_its_ledger(self):
        threads = [{'id': 'th-1', 'bot': 'Pebble', 'kind': 'Claude', 'model': 'claude-sonnet-5', 'updated': 990, 'turns': 2}]
        rows = resolve(record([], openmausbot_threads=threads, openmausbot_running=True))
        row = next(r for r in rows if r['id'] == 'openmausbot:th-1')
        self.assertEqual((row['display_name'], row['display_detail'], row['display_status']), ('Pebble', 'OpenMausBot 채팅', 'idle'))
        self.assertEqual((row['location']['app'], row['project_name'], row['connected']), ('OpenMausBot', 'OpenMausBot', True))


LEDGER = [
    {'botId': 'b1', 'botName': 'Pebble', 'threadId': 'th-1', 'driverKind': 'claudeAgent', 'model': 'claude-sonnet-5',
     'input': 1000, 'cachedInput': 400, 'output': 50, 'turnId': 'u1', 'startedAt': '2026-11-20T05:00:00Z', 'endedAt': '2026-11-20T05:00:08Z'},
    {'botId': 'b1', 'botName': 'Pebble', 'threadId': 'th-1', 'driverKind': 'claudeAgent', 'model': 'claude-sonnet-5',
     'input': 2000, 'cachedInput': 1500, 'output': 70, 'turnId': 'u2', 'at': '2026-11-20T06:00:00Z'},
    {'botId': 'b2', 'threadId': '../bad', 'input': 5, 'output': 5, 'at': '2026-11-20T06:00:00Z'},
]


class Tokens(unittest.TestCase):
    def test_codex_first_request_counts_from_zero_and_a_fork_stays_a_baseline(self):
        def report(total, last, t):
            usage = lambda n: {'input_tokens': n, 'cached_input_tokens': 0, 'output_tokens': 0}
            return {'timestamp': t, 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
                'total_token_usage': usage(total), 'last_token_usage': usage(last)}}}
        ledger = server.Ledger('Codex')
        first = ledger.consume(report(100, 100, '2026-11-20T05:00:00Z'))
        second = ledger.consume(report(250, 150, '2026-11-20T05:01:00Z'))
        self.assertEqual((sum(first[1]), sum(second[1])), (100, 150))
        fork = server.Ledger('Codex')
        self.assertIsNone(fork.consume(report(5000, 120, '2026-11-20T05:00:00Z')))
        self.assertEqual(sum(fork.consume(report(5200, 200, '2026-11-20T05:01:00Z'))[1]), 200)

    def test_openmausbot_ledger_becomes_events_once_and_history(self):
        self.assertIsNone(openmausbot.turn(LEDGER[2]))
        self.assertEqual(openmausbot.turn(LEDGER[0])['tokens'], [600, 400, 0, 50])
        with tempfile.TemporaryDirectory() as home:
            folder = Path(home)/'.openmausbot'/'usage'; folder.mkdir(parents=True)
            path = folder/'2026-11.jsonl'
            path.write_text(''.join(json.dumps(r) + '\n' for r in LEDGER[:1]) + json.dumps(LEDGER[1]))  # last line unfinished
            collector = server.Collector.__new__(server.Collector)
            collector.db = sqlite3.connect(':memory:')
            collector.db.execute('CREATE TABLE trackers(path TEXT PRIMARY KEY, data TEXT)')
            collector.db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY, t REAL, sid TEXT, kind TEXT, fresh INT, cached INT,'
                                 ' written INT, output INT, account TEXT, model TEXT, cwd TEXT)')
            collector.started = 0
            now = 1795180000  # 2026-11-20
            with patch.object(server, 'HOME', Path(home)):
                self.assertEqual(collector.read_openmausbot(now)['th-1']['tokens'], [600, 400, 0, 50])
                with path.open('a') as stream:
                    stream.write('\n')
                totals = collector.read_openmausbot(now)
                collector.read_openmausbot(now)
            self.assertEqual(totals['th-1']['tokens'], [1100, 1900, 0, 120])
            self.assertEqual(collector.db.execute('SELECT COUNT(*), SUM(fresh+cached+written+output), MIN(sid) FROM events').fetchone(),
                             (2, 3120, 'openmausbot:th-1'))
            with patch('pathlib.Path.home', return_value=Path(home)):
                store = HistoryStore(Path(home)/'data')
                for kind, ledger_path, _ in store.files():
                    if kind == 'OpenMausBot':
                        store.import_file(kind, ledger_path); store.import_file(kind, ledger_path)
            with sqlite3.connect(Path(home)/'data'/'history.sqlite') as db:
                self.assertEqual(db.execute('SELECT COUNT(*), SUM(fresh+cached+written+output) FROM records').fetchone(), (2, 3120))

    def test_openmausbot_task_transcripts_are_not_counted_twice(self):
        # Its task runs can leave a Claude transcript too; the ledger already counts those turns.
        import re
        self.assertEqual(describe(proc(13, ['claude', '-p'], cwd='/home/u/.openmausbot/task-workspaces/t1'))['role'], 'helper')
        self.assertEqual(resolve(record([proc(13, ['claude', '-p'], cwd='/home/u/.openmausbot/task-workspaces/t1')])), [])
        with tempfile.TemporaryDirectory() as home:
            projects = Path(home)/'.claude'/'projects'
            mausbot = re.sub(r'[^A-Za-z0-9]', '-', str(Path(home)/'.openmausbot'))
            for folder in (mausbot + '-task-workspaces-t1', '-work-app'):
                (projects/folder).mkdir(parents=True); (projects/folder/'s.jsonl').write_text('{}\n')
            with patch('pathlib.Path.home', return_value=Path(home)), \
                    patch('onetop.accounts.profile_roots', return_value=[('Claude', Path(home)/'.claude')]):
                found = [p.parent.name for k, p, _ in HistoryStore(Path(home)/'data').files() if k == 'Claude']
            self.assertEqual(found, ['-work-app'])


if __name__ == '__main__':
    unittest.main()
