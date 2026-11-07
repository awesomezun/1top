import copy
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from onetop.claude_continuation import chains, role, completed_shell_turn, process_name
from onetop.server import Collector
from onetop.controls import Controller, ActionError, target_key
from onetop.mailbox import Mailbox
from onetop.weekly_usage import initialize
from onetop.history import initialize_capture

OLD = '11111111-1111-4111-8111-111111111111'
NEW = '22222222-2222-4222-8222-222222222222'


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.meta = {p: {'config_dir': str(self.root), 'provider': '', 'configured_model': '',
                         'orca_handle': 'term-one'} for p in (100, 101, 102, 103)}
        self.processes = {}
        for pid, parent, typ in [(100, 1, 'interactive'), (101, 100, 'helper'),
                                 (102, 101, 'helper'), (103, 102, 'background')]:
            self.processes[pid] = {'pid': pid, 'ppid': parent, 'birth': float(pid), 'exe': 'claude',
                'started': str(pid), 'tty': 'ttys1' if typ != 'helper' else '??', 'cpu': 0, 'rss': 1,
                'claude_role': typ}
        self.records = {}
        for pid, sid, kind in [(100, OLD, 'interactive'), (103, NEW, 'bg')]:
            self.records[pid] = {'pid': pid, 'sessionId': sid, 'kind': kind, 'status': 'idle',
                'procStart': datetime.fromtimestamp(pid, timezone.utc).strftime('%a %b %d %H:%M:%S %Y')}
        self.records[100]['parkedJobId'] = 'job'
        self.records[103]['jobId'] = 'job'

    def test_process_roles_do_not_count_transport_as_an_agent(self):
        self.assertEqual(role('claude', ['claude', 'daemon', 'run']), 'helper')
        self.assertEqual(role('claude bg-pty-host'), 'helper')
        self.assertEqual(role('claude bg-spare'), 'background')
        self.assertEqual(role('claude', ['claude', '--resume', OLD]), 'interactive')
        self.assertIsNone(role('not-claude'))

    def test_newer_claude_code_processes_are_named_and_cast(self):
        # Claude Code 2.1.31x: sessions and spares run from a versioned binary under an adopted PTY host.
        self.assertEqual(process_name('/Users/k/.local/share/claude/versions/2.1.316'), 'claude')
        self.assertEqual(process_name('/Users/k/.local/share/claude/ClaudeCode.app/Contents/MacOS/claude'), 'claude')
        self.assertEqual(process_name('/usr/local/bin/2.1.316'), '2.1.316')
        self.assertEqual(process_name('/opt/homebrew/bin/codex'), 'codex')
        self.assertEqual(role('claude', ['claude', '--bg-pty-host', '/tmp/cc-daemon-501/x/pty/a.sock', '66', '78']), 'helper')
        self.assertEqual(role('claude', ['2.1.312', '--bg-spare']), 'background')
        self.assertEqual(role('claude', ['2.1.316', '--session-id', NEW, '--fork-session', '--resume', OLD]), 'interactive')

    def adopted(self):
        # The job runs under a PTY host launchd adopted, not under the terminal's Claude.
        p = copy.deepcopy(self.processes)
        p[101].update(ppid=1); del p[102]; p[103]['ppid'] = 101
        r = copy.deepcopy(self.records)
        for pid in r: r[pid]['cwd'] = '/work/ART-LSH'
        return p, r

    def test_a_job_under_an_adopted_pty_host_links_by_job_and_directory(self):
        p, r = self.adopted()
        self.assertEqual(chains(p, r, self.meta), {100: [100, 103]})
        other = copy.deepcopy(r); other[103]['cwd'] = '/work/other'
        self.assertEqual(chains(p, other, self.meta), {})
        missing = copy.deepcopy(r); del missing[103]['cwd']; del missing[100]['cwd']
        self.assertEqual(chains(p, missing, self.meta), {})
        # Only Claude helpers may stand between the job and launchd.
        q = copy.deepcopy(p); q[101]['claude_role'] = 'interactive'
        self.assertEqual(chains(q, r, self.meta), {})

    def test_adopted_jobs_still_require_matching_profile_and_process_birth(self):
        p, r = self.adopted()
        other = copy.deepcopy(self.meta); other[103]['config_dir'] = '/different'
        self.assertEqual(chains(p, r, other), {})
        p[103]['birth'] += 2
        self.assertEqual(chains(p, r, self.meta), {})

    def test_two_live_owners_cannot_claim_one_adopted_job(self):
        p, r = self.adopted()
        p[105] = {**p[100], 'pid': 105, 'birth': 105.0, 'started': '105'}
        r[105] = {**r[100], 'pid': 105,
                  'sessionId': '33333333-3333-4333-8333-333333333333',
                  'procStart': datetime.fromtimestamp(105, timezone.utc).strftime('%a %b %d %H:%M:%S %Y')}
        self.meta[105] = self.meta[100].copy()
        self.assertEqual(chains(p, r, self.meta), {})
        r[103]['status'] = 'busy'
        c = self.discover(p, r)
        jobs = [s for s in c.specs if s['pid'] == 103]
        self.assertEqual(len(jobs), 1)
        self.assertEqual((jobs[0]['id'], jobs[0]['status']), (NEW, 'working'))
        self.assertNotIn('terminal_owner_pid', jobs[0])
        self.assertTrue(all(s.get('continuation_pending') for s in c.specs if s['pid'] != 103))

    def test_live_job_and_ancestry_link_the_continuation(self):
        self.assertEqual(chains(self.processes, self.records, self.meta), {100: [100, 103]})

    def test_wrong_parent_profile_birth_or_job_cannot_be_linked(self):
        for field, value in [('ppid', 1), ('birth', 104.5)]:
            p = copy.deepcopy(self.processes); p[103][field] = value
            self.assertEqual(chains(p, self.records, self.meta), {})
        m = copy.deepcopy(self.meta); m[103]['config_dir'] = '/different'
        self.assertEqual(chains(self.processes, self.records, m), {})
        r = copy.deepcopy(self.records); r[103]['jobId'] = 'other'
        self.assertEqual(chains(self.processes, r, self.meta), {})

    def test_ambiguous_job_does_not_choose_a_process(self):
        p = copy.deepcopy(self.processes); p[104] = {**p[103], 'pid': 104}
        r = copy.deepcopy(self.records); r[104] = {**r[103], 'pid': 104}
        m = {**self.meta, 104: self.meta[103]}
        self.assertEqual(chains(p, r, m), {})

    def test_discovery_keeps_one_stable_row_and_live_execution_pid(self):
        (self.root/'sessions').mkdir(); (self.root/'projects/p').mkdir(parents=True)
        for pid, record in self.records.items():
            (self.root/'sessions'/f'{pid}.json').write_text(json.dumps(record))
            (self.root/'projects/p'/f"{record['sessionId']}.jsonl").write_text('')
        terminal = {'handle': 'term-one', 'incarnationId': 'incarnation', 'title': 'Test'}
        def run(args, **kwargs):
            if args[0] == 'lsof': return ''
            if 'terminal' in args: return json.dumps({'result': {'terminals': [terminal]}})
            return ''
        c = Collector(); c.process_cache = self.meta.copy()
        with patch.object(c, 'processes', return_value=self.processes), \
                patch.object(c, 'metadata', side_effect=lambda p: c.process_cache[p['pid']]), \
                patch('onetop.server.run', side_effect=run), patch('onetop.server.inventory', return_value={}), \
                patch('onetop.server.HOME', self.root):
            c.discover()
        self.assertEqual(len(c.specs), 1)
        s = c.specs[0]
        self.assertEqual((s['id'], s['active_session_id'], s['pids']), (OLD, NEW, [103]))
        self.assertTrue(s['input_verified']); self.assertEqual(c.process_counts, {'Claude': 1})
        old_key = target_key({**s, 'pids': [100], 'process_started': '100', 'process_birth': 100.0})
        self.assertIn(old_key, s['continuation_keys'])

    def discover(self, processes, records):
        (self.root/'sessions').mkdir(exist_ok=True); (self.root/'projects/p').mkdir(parents=True, exist_ok=True)
        for pid, record in records.items():
            (self.root/'sessions'/f'{pid}.json').write_text(json.dumps(record))
            (self.root/'projects/p'/f"{record['sessionId']}.jsonl").write_text('')
        def run(args, **kwargs):
            if args[0] == 'lsof': return ''
            if 'terminal' in args: return json.dumps({'result': {'terminals': []}})
            return ''
        c = Collector(); c.process_cache = {pid: self.meta.get(pid, self.meta[100]) for pid in processes}
        with patch.object(c, 'processes', return_value=processes), \
                patch.object(c, 'metadata', side_effect=lambda p: c.process_cache[p['pid']]), \
                patch('onetop.server.run', side_effect=run), patch('onetop.server.inventory', return_value={}), \
                patch('onetop.server.HOME', self.root):
            c.discover()
        return c

    def test_a_session_started_in_the_background_is_counted_alone(self):
        # No terminal owner: the PTY host and a spare are transport; the background session is one row of its own.
        p = {pid: row for pid, row in copy.deepcopy(self.processes).items() if pid in (101, 103)}
        p[101].update(ppid=1); p[103].update(ppid=101, claude_role='interactive', tty='??')
        p[104] = {**p[103], 'pid': 104, 'birth': 104.0, 'started': '104', 'claude_role': 'background'}
        r = {103: {**self.records[103], 'status': 'busy', 'cwd': '/work/ART-LSH'}}
        c = self.discover(p, r)
        self.assertEqual([(s['id'], s['pids'], s['status']) for s in c.specs], [(NEW, [103], 'working')])
        self.assertEqual(c.process_counts, {'Claude': 1})

    def test_a_parked_job_under_an_adopted_host_keeps_one_row(self):
        p, r = self.adopted()
        r[103]['status'] = 'busy'; r[100]['status'] = 'shell'
        c = self.discover(p, r)
        self.assertEqual([(s['id'], s['active_session_id'], s['pids'], s['status']) for s in c.specs], [(OLD, NEW, [103], 'working')])

    def test_finished_turn_with_background_shell_is_idle(self):
        path = self.root/'turn.jsonl'
        path.write_text(json.dumps({'type':'system', 'subtype':'turn_duration',
                                   'timestamp':'2026-01-01T00:00:00Z'})+'\n')
        stamp = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
        reg = {'status':'shell', 'statusUpdatedAt':(stamp + .02)*1000}
        self.assertEqual(completed_shell_turn(reg, path), stamp)
        for status in ('busy', 'waiting', 'idle'):
            self.assertIsNone(completed_shell_turn({**reg,'status':status}, path))
        self.assertIsNone(completed_shell_turn({**reg,'statusUpdatedAt':(stamp+3)*1000}, path))
        with path.open('a') as stream:stream.write('{"type":"api-')
        self.assertIsNone(completed_shell_turn(reg, path))
        with path.open('a') as stream:stream.write('request"}\n')
        self.assertIsNone(completed_shell_turn(reg, path))
        with path.open('a') as stream:stream.write(json.dumps({'type':'api-request'})+'\n')
        self.assertIsNone(completed_shell_turn(reg, path))

    def test_new_input_and_unreadable_source_never_report_completed(self):
        path = self.root/'turn.jsonl'
        reg = {'status':'shell','statusUpdatedAt':0}
        self.assertIsNone(completed_shell_turn(reg, path))
        path.write_text('{"type":"system","subtype":"turn_duration","timestamp":"invalid"}\n')
        self.assertIsNone(completed_shell_turn(reg, path))
        path.write_text('{"type":"system","subtype":"turn_duration","timestamp":"2026-01-01T00:00:00Z"}\n{"type":"user"}\n')
        self.assertIsNone(completed_shell_turn(reg, path))

    def test_copied_context_is_deduplicated_across_restart_and_account_switch(self):
        def event(mid, output, stamp):
            return {'type': 'assistant', 'timestamp': stamp, 'message': {'id': mid, 'model': 'opus',
                'usage': {'input_tokens': 10, 'cache_read_input_tokens': 100, 'output_tokens': output}}}
        old, new = self.root/'old.jsonl', self.root/'new.jsonl'
        a, b = event('copied', 2, 1000), event('new', 3, 2000)
        old.write_text(json.dumps(a)+'\n'); new.write_text(json.dumps(a)+'\n'+json.dumps(b)+'\n')
        c = Collector(); c.started = 0; c.db = sqlite3.connect(':memory:'); self.addCleanup(c.db.close)
        c.db.executescript('CREATE TABLE trackers(path TEXT PRIMARY KEY,data TEXT); CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER);')
        initialize(c.db); initialize_capture(c.db)
        s = {'id': OLD, 'active_session_id': NEW, 'kind': 'Claude', 'path': str(new), 'config_dir': str(self.root),
             'continuation_sources': [{'session_id': OLD, 'path': str(old)}, {'session_id': NEW, 'path': str(new)}]}
        def binding(part, **kwargs): return ('old-account' if part['active_session_id'] == OLD else 'new-account', 0)
        with patch('onetop.claude_statusline.session_binding', side_effect=binding):
            c.read_continuation(s, {}, {}, time.time())
            self.assertEqual(s['tokens'], [20, 200, 0, 5])
            c.trackers = {}; c.read_continuation(s, {}, {}, time.time())
        self.assertEqual(c.db.execute('SELECT sid,account,output FROM events ORDER BY t').fetchall(),
                         [(OLD, 'old-account', 2), (OLD, 'new-account', 3)])
        self.assertEqual(s['account_binding'][0], 'new-account')
        self.assertEqual(s['tokens'], [20, 200, 0, 5])

    def test_queued_message_follows_verified_transition_once(self):
        old, new = self.root/'old.jsonl', self.root/'new.jsonl'; old.write_text(''); new.write_text('')
        spec = {'id': OLD, 'kind': 'Claude', 'path': str(old), 'status': 'working', 'pids': [100],
                'input_verified': True, 'control_key': 'old-key', 'orca_terminal': {'handle': 'term-one'}}
        collector = Mock(); collector.lock = threading.Lock(); collector.snapshot = {'updated': time.time(), 'sessions': [spec]}
        source = Mock(); source.specs = [spec]
        ctl = Controller(collector, lambda: source)
        rid = '33333333-3333-4333-8333-333333333333'
        request = {'action': 'message', 'session_id': OLD, 'control_key': 'old-key', 'request_id': rid, 'prompt': 'Status?'}
        self.assertTrue(ctl.execute(request)['queued'])
        spec.update(path=str(new), pids=[103], control_key='new-key', continuation_keys=['old-key'], status='idle')
        with patch.object(ctl, 'orca', return_value={}) as send:
            ctl.flush_mailbox(); ctl.flush_mailbox()
        self.assertEqual(send.call_count, 1)
        self.assertEqual(ctl.read_mailbox(OLD, 'old-key')[0]['status'], 'awaiting_reply')
        with self.assertRaises(ActionError): ctl.resolve(OLD, 'old-key')

    def test_reply_after_transition_is_read_without_resending(self):
        old, new = self.root/'old.jsonl', self.root/'new.jsonl'; old.write_text(''); new.write_text('')
        spec = {'id': OLD, 'kind': 'Claude', 'path': str(old)}
        box = Mailbox(self.root/'mail.json'); rid = '33333333-3333-4333-8333-333333333333'
        box.begin(spec, rid, 'Status?')
        new.write_text(json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content':
            [{'type': 'text', 'text': f'[1top-reply:{rid}]Continued reply[/1top-reply]'}]}})+'\n')
        spec.update(path=str(new), continuation_sources=[{'path': str(old)}, {'path': str(new)}])
        rows = box.read(spec)
        self.assertEqual(rows[0]['reply'], 'Continued reply')
        self.assertNotIn('continuation_readers', rows[0])
        self.assertEqual(Mailbox(box.path).read(spec)[0]['status'], 'replied')
