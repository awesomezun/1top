"""Session contract T5: Devin sessions and Antigravity conversations, from their own databases, and their tokens.
Synthetic databases in each tool's layout; no conversation text."""
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from onetop import server
from onetop.observe import antigravity, devin, locations, openbot, readonly
from onetop.sessions import resolve

NOW = 1795330000.0
AGENT = '/home/u/OpenBot/Agents/agent-1'


def varint(n):
    out = bytearray()
    while True:
        byte, n = n & 0x7f, n >> 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def pb(*items):
    """A protobuf message from (field, value): int as a varint, bytes or str length-delimited."""
    out = b''
    for number, value in items:
        if isinstance(value, int):
            out += varint(number << 3) + varint(value)
        else:
            value = value.encode() if isinstance(value, str) else value
            out += varint(number << 3 | 2) + varint(len(value)) + value
    return out


def step_metadata(rid, fresh, output, cached=0, written=0, at=NOW - 60, model=1535):
    usage = pb((1, model), (2, fresh), (3, output), *([(4, written)] if written else []), *([(5, cached)] if cached else []),
               (6, 24), (7, rid), (9, output // 3), (10, output - output // 3))
    return pb((1, pb((1, int(at) - 5))), (3, 2), (8, pb((1, int(at)), (2, 500000000))), (9, usage), (11, model))


def devin_db(path):
    db = sqlite3.connect(path)
    db.executescript('''CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT NOT NULL, backend_type TEXT NOT NULL,
            model TEXT NOT NULL, agent_mode TEXT NOT NULL, created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL,
            title TEXT, main_chain_id INTEGER, hidden INTEGER NOT NULL DEFAULT 0, metadata TEXT);
        CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, node_id INTEGER NOT NULL,
            parent_node_id INTEGER, chat_message TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT);''')
    return db


def message(role, mid=None, tokens=None, finish=None, model='claude-opus-5-5-xhigh'):
    meta = {}
    if tokens:
        meta = {'request_id': 'r-' + mid, 'generation_model': model, 'finish_reason': finish,
                'metrics': dict(zip(('input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens'), tokens))}
    return json.dumps({'message_id': mid, 'role': role, 'content': 'not read', 'metadata': meta})


def collector():
    c = server.Collector.__new__(server.Collector)
    c.db = sqlite3.connect(':memory:')
    c.db.execute('CREATE TABLE trackers(path TEXT PRIMARY KEY, data TEXT)')
    c.db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY, t REAL, sid TEXT, kind TEXT, fresh INT, cached INT,'
                 ' written INT, output INT, account TEXT, model TEXT, cwd TEXT)')
    c.started, c.specs = 0, []
    c.observation = {'openbot_agents': [{'workspace': AGENT, 'name': 'Atlas'}]}
    return c


class Devin(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.path = devin.database(self.home.name)
        self.path.parent.mkdir(parents=True)
        self.db = devin_db(self.path)
        self.db.execute("INSERT INTO sessions VALUES('surf-verse',?,'windsurf','','default',?,?,'Usage map check',3,0,'{}')",
                        (AGENT, NOW - 600, NOW - 30))
        self.db.execute("INSERT INTO sessions VALUES('old-one','/work/app','windsurf','','default',?,?,'Old',1,0,'{}')",
                        (NOW - 9 * 86400, NOW - 8 * 86400))
        rows = [('surf-verse', 1, message('user'), NOW - 120),
                ('surf-verse', 2, message('assistant', 'm1', (2, 1000, 50, 10), 'tool_calls'), NOW - 100),
                # A branch keeps a copy of the same response: counted once.
                ('surf-verse', 3, message('assistant', 'm1', (2, 1000, 50, 10), 'tool_calls'), NOW - 100),
                ('surf-verse', 4, message('tool'), NOW - 90),
                ('surf-verse', 5, message('assistant', 'm2', (3, 1100, 0, 40), 'stop'), NOW - 30),
                ('surf-verse', 6, message('system'), NOW - 20)]
        self.db.executemany('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)', rows)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.home.cleanup()

    def test_sessions_of_the_last_day_and_whether_a_turn_is_open(self):
        found = devin.read(self.home.name, NOW)
        self.assertEqual([(s['id'], s['status'], s['title']) for s in found], [('surf-verse', 'idle', 'Usage map check')])
        # A response that asked for tools leaves the turn open; a final answer (the system note after it aside) closes it.
        self.db.execute('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)',
                        ('surf-verse', 7, message('assistant', 'm3', (1, 5, 0, 5), 'tool_calls'), NOW - 10))
        self.db.commit()
        self.assertEqual(devin.read(self.home.name, NOW)[0]['status'], 'busy')
        self.assertEqual(devin.read(self.home.name, NOW + 3600)[0]['status'], 'idle')

    def test_an_openbot_agents_session_is_its_chat_named_by_the_agent(self):
        rows = resolve({'captured_at': NOW, 'processes': [], 'claude_registry': {}, 'claude_transcripts': {}, 'codex_logs': [],
                        'orca_terminals': [], 'tmux_panes': {}, 'aside_sessions': [], 'devin_sessions': devin.read(self.home.name, NOW),
                        'openbot_agents': [{'workspace': AGENT, 'name': 'Atlas'}], 'openbot_running': True, 'devin_running': False})
        row = next(r for r in rows if r['id'] == 'devin:surf-verse')
        self.assertEqual((row['kind'], row['display_name'], row['display_detail'], row['display_status']),
                         ('Devin', 'Atlas', 'Usage map check · OpenBot 채팅', 'idle'))
        self.assertEqual((row['location']['app'], row['project_name'], row['connected']), ('OpenBot', 'Atlas', True))
        self.assertNotIn('control_key', row)

    def test_each_response_is_counted_once_into_events_and_totals(self):
        c = collector()
        c.specs = [{'id': 'devin:surf-verse', 'conversation_id': 'surf-verse', 'usage_adapter': 'devin', 'kind': 'Devin'}]
        with patch.object(server, 'HOME', Path(self.home.name)):
            totals = c.read_devin(NOW)
            self.assertEqual(totals['surf-verse']['tokens'], [5, 2100, 50, 50])
            self.assertEqual(totals['surf-verse']['model'], 'claude-opus-5-5-xhigh')
            # A copy stored later, and a restart that forgets the cache, add nothing.
            self.db.execute('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)',
                            ('surf-verse', 8, message('assistant', 'm2', (3, 1100, 0, 40), 'stop'), NOW - 30))
            self.db.commit()
            c.read_devin(NOW)
            del c.adapter_cache, c.devin_row
            again = c.read_devin(NOW)
        self.assertEqual(again['surf-verse']['tokens'], [5, 2100, 50, 50])
        self.assertEqual(c.db.execute('SELECT COUNT(*), SUM(fresh+cached+written+output), MIN(sid), MIN(kind), MIN(cwd) FROM events').fetchone(),
                         (2, 2205, 'devin:surf-verse', 'Devin', AGENT))
        # Named in the catalog at once, as its agent, for period views after it leaves the list.
        self.assertEqual(c.db.execute("SELECT project, app, title FROM session_catalog WHERE sid='devin:surf-verse'").fetchone(),
                         ('Atlas', 'OpenBot', 'Usage map check'))

    def test_a_database_a_running_devin_holds_elsewhere_is_read_too(self):
        with tempfile.TemporaryDirectory() as other:
            other = Path(other).resolve()/'sessions.db'
            with closing(devin_db(other)) as db:
                db.execute("INSERT INTO sessions(id,working_directory,backend_type,model,agent_mode,created_at,last_activity_at,title) VALUES('far','/w','b','m','a',?,?,'Far')", (int(NOW), int(NOW)))
                db.execute('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)', ('far', 1, message('assistant', 'f1', (7, 0, 0, 3), 'stop'), NOW - 400))
                db.commit()
            places = locations.Locations(self.home.name)
            with patch.object(locations, 'look', lambda pid: (['devin', 'acp'], [str(other)])):
                places.update([{'pid': 9, 'birth': 1.0, 'name': 'devin'}], 1000)
            self.assertEqual(len(places.devin_databases()), 2)
            self.assertIn('far', [r['id'] for r in devin.read(self.home.name, NOW + 10, databases=places.devin_databases())])
            c = collector()
            c.observer = type('O', (), {'locations': places})()
            c.specs = [{'id': f'devin:{s}', 'conversation_id': s, 'usage_adapter': 'devin', 'kind': 'Devin'} for s in ('far', 'surf-verse')]
            with patch.object(server, 'HOME', Path(self.home.name)):
                totals = c.read_devin(NOW)
            self.assertEqual((totals['far']['tokens'], totals['surf-verse']['tokens']), ([7, 0, 0, 3], [5, 2100, 50, 50]))

    def test_a_summarising_call_counts_but_keeps_the_sessions_model(self):
        self.db.execute('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)',
                        ('surf-verse', 9, message('assistant', 'm5', (100, 0, 0, 7000), 'stop', model='compactor'), NOW - 10))
        self.db.commit()
        c = collector()
        c.specs = [{'id': 'devin:surf-verse', 'conversation_id': 'surf-verse', 'usage_adapter': 'devin', 'kind': 'Devin'}]
        with patch.object(server, 'HOME', Path(self.home.name)):
            totals = c.read_devin(NOW)
        self.assertEqual((totals['surf-verse']['tokens'][3], totals['surf-verse']['model']), (7050, 'claude-opus-5-5-xhigh'))
        self.assertEqual(c.db.execute("SELECT model FROM events ORDER BY t DESC LIMIT 1").fetchone(), ('compactor',))

    def test_a_response_stored_without_its_numbers_yet_is_read_again(self):
        self.db.execute('INSERT INTO message_nodes(session_id,node_id,chat_message,created_at) VALUES(?,?,?,?)',
                        ('surf-verse', 9, message('assistant', 'm4'), NOW - 5))
        self.db.commit()
        last, found = devin.usage(self.path, 0, NOW)
        self.assertEqual(([f['id'] for f in found], last), (['m1', 'm1', 'm2'], 5))
        self.assertEqual(devin.usage(self.path, 0, NOW + 600)[0], 7)


class Antigravity(unittest.TestCase):
    def conversation(self, root, cid, steps, names=((1535, 'gemini-4-neon'),)):
        folder = Path(root)/'conversations'
        folder.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(folder/f'{cid}.db')) as db:
            db.execute('CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer, status integer, metadata blob)')
            db.execute('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob, size integer)')
            db.executemany('INSERT INTO steps VALUES(?,15,3,?)', steps)
            db.executemany('INSERT INTO gen_metadata VALUES(?,?,0)', [(i, pb((2, ':;<'), (1, pb((3, n), (19, name), (21, name.title()))))) for i, (n, name) in enumerate(names)])
            db.commit()
        return folder/f'{cid}.db'

    def summaries(self, root, rows):
        with closing(sqlite3.connect(Path(root)/'conversation_summaries.db')) as db:
            db.execute('''CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text, workspace_uris text,
                status text, last_modified_time datetime, parent_conversation_id text)''')
            db.executemany('INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?)', rows)
            db.commit()

    def test_a_steps_usage_is_its_model_response(self):
        item = antigravity.response(step_metadata('resp-1', 6439, 444, cached=153072))
        self.assertEqual((item['id'], item['tokens'], item['model'], int(item['t'])), ('resp-1', [6439, 153072, 0, 444], 1535, int(NOW - 60)))
        self.assertIsNone(antigravity.response(pb((1, pb((1, 5))), (3, 2))))
        with self.assertRaises(ValueError):
            antigravity.fields(b'\x0a\x05ab')

    def test_conversations_of_the_app_runtime_and_their_seats(self):
        cid, temp = '2aca8adf-226c-42b0-b241-270ee0410b54', '0d187aa9-4ef3-475a-8300-a4c9458c482b'
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)/'.gemini'/'antigravity-acp'
            root.mkdir(parents=True)
            self.summaries(root, [
                (cid, 'Write posts', json.dumps([f'file://{AGENT}', 'file:///home/u/OpenBot/Shared']), 'CASCADE_RUN_STATUS_RUNNING',
                 '2026-11-22 06:06:20.508962+00:00', ''),
                (temp, '{"verdict":"done"}', json.dumps(['file:///var/folders/x/T/openbot-profile-WZ3emz']), 'CASCADE_RUN_STATUS_IDLE',
                 '2026-11-22 06:06:28.030331+00:00', '')])
            found = antigravity.conversations(home, 1795327600)
            self.assertEqual([(r['id'], r['cwd']) for r in found], [(temp, 'OpenBot'), (cid, AGENT)])
            # A run the runtime lost stays RUNNING in its summary; long after its last change it is over.
            self.assertEqual(antigravity.conversations(home, 1795327600 + 3600)[1]['status'], 'CASCADE_RUN_STATUS_IDLE')
            rows = resolve({'captured_at': 1795327600, 'processes': [], 'claude_registry': {}, 'claude_transcripts': {}, 'codex_logs': [],
                            'orca_terminals': [], 'tmux_panes': {}, 'aside_sessions': [], 'antigravity_conversations': found,
                            'openbot_agents': [{'workspace': AGENT, 'name': 'Scribe'}], 'openbot_running': True})
            self.assertEqual([(r['id'], r['kind'], r['display_name'], r['display_status'], r['location']['app']) for r in rows],
                             [(cid, 'Antigravity', 'Scribe', 'working', 'OpenBot')])

    def test_each_response_is_counted_once_across_reads_and_restarts(self):
        cid = 'fa7e536a-2ffb-42c6-8dad-73d116b82664'
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)/'.gemini'/'antigravity-cli'
            root.mkdir(parents=True)
            self.summaries(root, [(cid, 'Mail', json.dumps(['file:///work/mail']), 'CASCADE_RUN_STATUS_IDLE', '2026-11-22 06:00:00+00:00', '')])
            path = self.conversation(root, cid, [(0, step_metadata('a', 33722, 1902)), (1, pb((1, pb((1, 9))))),
                                                 (2, step_metadata('b', 3833, 1079, cached=33723))])
            c = collector()
            c.specs = [{'id': cid, 'conversation_id': cid, 'kind': 'Antigravity', 'path': None}]
            with patch.object(server, 'HOME', Path(home)):
                totals = c.read_antigravity(NOW)
                self.assertEqual((totals[cid]['tokens'], totals[cid]['model']), ([37555, 33723, 0, 2981], 'gemini-4-neon'))
                with closing(sqlite3.connect(path)) as db:
                    db.execute('INSERT INTO steps VALUES(3,15,3,?)', (step_metadata('c', 100, 10, cached=37000),))
                    db.commit()
                c.read_antigravity(NOW + 5)
                del c.adapter_cache
                totals = c.read_antigravity(NOW + 5)
            self.assertEqual(totals[cid]['tokens'], [37655, 70723, 0, 2991])
            self.assertEqual(c.db.execute('SELECT COUNT(*), SUM(fresh+cached+written+output), MIN(kind), MIN(cwd) FROM events').fetchone(),
                             (3, 111369, 'Antigravity', '/work/mail'))

    def test_every_folder_is_found_whoever_keeps_it(self):
        """Antigravity's own, an OpenBot account's, and any folder a running process names or holds open."""
        own, account, named, held = (f'{n}fa7e536-2ffb-42c6-8dad-73d116b82664' for n in 'abcd')
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as elsewhere:
            home, elsewhere = Path(home).resolve(), Path(elsewhere).resolve()
            places = {own: home/'.gemini'/'antigravity-acp', named: elsewhere/'given'/'data', held: elsewhere/'open'/'antigravity-acp',
                      account: openbot.database(home).parent/'provider-accounts'/'a1'/'antigravity-acp'}
            for n, (cid, root) in enumerate(places.items()):
                self.conversation(root, cid, [(0, step_metadata('r-' + cid, 100 + n, 10))])
                self.summaries(root, [(cid, 'Task', json.dumps([f'file://{AGENT}']), 'CASCADE_RUN_STATUS_IDLE', '2026-11-22 06:06:20+00:00', '')])
            live = {71: (['antigravity', 'acp', f'--gemini-dir={elsewhere}/given', '--app-data-dir', 'data'], []),
                    72: (['antigravity', 'acp'], [str(places[held]/'conversation_summaries.db'), '/etc/hosts'])}
            procs = [{'pid': p, 'birth': 1.0, 'name': 'antigravity'} for p in live] + [{'pid': 73, 'birth': 1.0, 'name': 'bash'}]
            with patch.object(locations, 'look', lambda pid: live[pid]) as look:
                found = locations.Locations(home)
                self.assertEqual({r for r in found.antigravity_roots()}, {places[own], places[account]})
                found.update(procs, 1000)
            self.assertEqual(set(found.antigravity_roots()), set(places.values()))
            self.assertEqual(set(found.app_roots()), set(places.values()))
            self.assertEqual({r['id'] for r in antigravity.conversations(home, 1795327600, folders=found.app_roots())}, set(places))
            # The process ends and 1top starts again: its folder is still known, and read once.
            later = locations.Locations(home, json.loads(json.dumps(found.known())))
            later.update([], 2000)
            self.assertEqual(set(later.antigravity_roots()), set(places.values()))
            c = collector()
            c.observer = type('O', (), {'locations': later})()
            c.specs = [{'id': cid, 'conversation_id': cid, 'kind': 'Antigravity', 'path': None} for cid in places]
            with patch.object(server, 'HOME', home):
                totals = c.read_antigravity(NOW)
                c.read_antigravity(NOW + 5)
            self.assertEqual({cid: totals[cid]['tokens'][0] for cid in places}, {cid: 100 + n for n, cid in enumerate(places)})
            self.assertEqual(c.db.execute('SELECT COUNT(*) FROM events').fetchone(), (4,))

    def test_a_conversation_copied_to_another_accounts_folder_is_counted_once(self):
        cid = 'fa7e536a-2ffb-42c6-8dad-73d116b82664'
        with tempfile.TemporaryDirectory() as home:
            steps = [(0, step_metadata('a', 100, 10)), (1, step_metadata('b', 200, 20))]
            accounts = openbot.database(home).parent/'provider-accounts'
            older = self.conversation(accounts/'a1'/'antigravity-acp', cid, steps)
            newer = self.conversation(accounts/'a2'/'antigravity-acp', cid, steps + [(2, step_metadata('c', 300, 30))])
            os.utime(older, (NOW, NOW))
            os.utime(newer, (NOW + 100, NOW + 100))
            c = collector()
            c.specs = [{'id': cid, 'conversation_id': cid, 'kind': 'Antigravity', 'path': None}]
            with patch.object(server, 'HOME', Path(home)):
                for n in range(3):
                    totals = c.read_antigravity(NOW + n)
            self.assertEqual(totals[cid]['tokens'], [600, 0, 0, 60])
            self.assertEqual(c.db.execute('SELECT COUNT(*) FROM events').fetchone(), (3,))

    def test_each_response_names_its_own_model(self):
        """Antigravity gives several models one number; a response's own generation record tells them apart."""
        cid = 'fa7e536a-2ffb-42c6-8dad-73d116b82664'
        with tempfile.TemporaryDirectory() as home:
            path = self.conversation(Path(home)/'.gemini'/'antigravity-acp', cid,
                                     [(i, step_metadata(rid, 100, 10, model=1417)) for i, rid in enumerate(('a', 'b', 'c'))], names=())
            with closing(sqlite3.connect(path)) as db:
                for i, (rid, name) in enumerate((('a', 'gemini-4-argon-trial'), ('b', 'gemini-4-argon-c'))):
                    db.execute('INSERT INTO gen_metadata VALUES(?,?,0)', (i, pb((1, pb((3, 1417), (4, pb((1, 1417), (7, rid))), (19, name))))))
                db.commit()
            antigravity.MODELS.clear()
            _, found = antigravity.usage(path)
            # The one without a record yet has the number's newest name.
            self.assertEqual([f['model'] for f in found], ['gemini-4-argon-trial', 'gemini-4-argon-c', 'gemini-4-argon-c'])

    def test_a_long_run_that_stores_only_in_its_database_is_still_working(self):
        cid = 'fa7e536a-2ffb-42c6-8dad-73d116b82664'
        with tempfile.TemporaryDirectory() as home:
            root, at = Path(home)/'.gemini'/'antigravity-acp', 1795327580
            path = self.conversation(root, cid, [(0, step_metadata('a', 1, 1))])
            self.summaries(root, [(cid, 'Long', json.dumps([f'file://{AGENT}']), 'CASCADE_RUN_STATUS_RUNNING', '2026-11-22 06:06:20+00:00', '')])
            os.utime(path, (at + 1500, at + 1500))
            self.assertEqual(antigravity.conversations(home, at + 1600)[0]['status'], 'CASCADE_RUN_STATUS_RUNNING')
            self.assertEqual(antigravity.conversations(home, at + 2200)[0]['status'], 'CASCADE_RUN_STATUS_IDLE')

    def test_a_parent_stays_listed_with_the_work_it_started(self):
        """A parent whose last word was days ago keeps its children in its seat, whichever folder each is in."""
        top, parent, child, old = (f'{n}fa7e536-2ffb-42c6-8dad-73d116b82664' for n in 'abcd')
        seat = json.dumps([f'file://{AGENT}'])
        with tempfile.TemporaryDirectory() as home:
            own, account = Path(home)/'.gemini'/'antigravity-acp', openbot.database(home).parent/'provider-accounts'/'a1'/'antigravity-acp'
            for root in (own, account):
                root.mkdir(parents=True)
            self.summaries(own, [(top, 'Top', seat, 'CASCADE_RUN_STATUS_IDLE', '2026-11-18 06:00:00+00:00', ''),
                                 (parent, 'Lead', seat, 'CASCADE_RUN_STATUS_IDLE', '2026-11-19 06:00:00+00:00', top),
                                 (old, 'Over', seat, 'CASCADE_RUN_STATUS_IDLE', '2026-11-19 06:00:00+00:00', '')])
            self.summaries(account, [(child, '', seat, 'CASCADE_RUN_STATUS_IDLE', '2026-11-22 06:06:20+00:00', parent)])
            found = antigravity.conversations(home, 1795327600)
            self.assertEqual([r['id'] for r in found], [child, parent, top])
            rows = resolve({'captured_at': 1795327600, 'processes': [], 'claude_registry': {}, 'claude_transcripts': {}, 'codex_logs': [],
                            'orca_terminals': [], 'tmux_panes': {}, 'aside_sessions': [], 'antigravity_conversations': found,
                            'openbot_agents': [{'workspace': AGENT, 'name': 'Scribe'}], 'openbot_running': True})
            self.assertEqual({r['id']: (r['location']['app'], r['root_session_id']) for r in rows}, {i: ('OpenBot', top) for i in (top, parent, child)})

    def test_what_a_process_names_and_holds(self):
        home = Path('/h')
        self.assertEqual(locations.started(['antigravity', 'acp', '--gemini-dir=/a b/x', '--app-data-dir=antigravity-acp'], home), (Path('/a b/x/antigravity-acp'), True))
        self.assertEqual(locations.started(['antigravity', 'acp', '--app-data-dir', 'other'], home), (Path('/h/.gemini/other'), True))
        self.assertEqual(locations.started(['agy', '--dangerously-skip-permissions'], home), (None, False))
        self.assertEqual(locations.holder('/x/presence/1.lock'), Path('/x'))
        self.assertEqual(locations.holder('/x/conversations/1.db'), Path('/x'))
        self.assertIsNone(locations.holder('/x/conversations/1.db-wal'))
        self.assertEqual([locations.tool(n) for n in ('antigravity', 'agy', 'agy.exe', 'agy_acp_server.par', 'devin', 'node')],
                         ['antigravity', 'antigravity', 'antigravity', 'antigravity', 'devin', None])
        self.assertEqual(locations.look(2**31 - 7), ([], []))

    def test_a_wal_database_without_its_log_is_read_as_it_stands(self):
        with tempfile.TemporaryDirectory() as home:
            path = Path(home)/'c.db'
            with closing(sqlite3.connect(path)) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE t(x)')
                db.execute('INSERT INTO t VALUES(1)')
                db.commit()
            self.assertFalse(Path(str(path) + '-wal').exists())
            with closing(readonly.connect(path)) as db:
                self.assertEqual(db.execute('SELECT x FROM t').fetchone(), (1,))


if __name__ == '__main__':
    unittest.main()
