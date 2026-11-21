"""Replay every checked-in real capture; expectations are separate source facts."""
import copy
import json
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from onetop.sessions import resolve, public
from onetop.sessions.status import decide, control_display
from onetop.observe.transcripts import Reader
from onetop.observe.processes import describe
from onetop.relay_data import session_identity

FIXTURES = Path(__file__).parent/'fixtures/real'


def check_record(test, record, expected):
    rows = resolve(record)
    def conversation(prefix):
        return [s for s in rows if s['conversation_id'].startswith(prefix)]
    def process(pid):
        return [s for s in rows if any(r['pid'] == pid for r in s['runs'])]
    if expected.get('unique_row_ids'):
        test.assertEqual(len(rows), len({s['id'] for s in rows}))
    for prefix in expected.get('one_row_per_conversation', []):
        test.assertEqual(len(conversation(prefix)), 1, prefix)
    for prefix, pids in expected.get('runs_in_one_row', {}).items():
        test.assertEqual({r['pid'] for r in conversation(prefix)[0]['runs']}, set(pids))
    for pair in expected.get('merged_owner_and_job', []):
        test.assertEqual(process(pair['owner']), process(pair['job']))
        test.assertEqual(process(pair['owner'])[0]['orca_terminal']['title'], pair['terminal_title'])
    for pid in expected.get('owners_whose_job_has_gone_are_not_unknown', []):
        test.assertEqual(len(process(pid)), 1)
        test.assertNotEqual(process(pid)[0]['display_status'], 'unknown')
    for pid, title in expected.get('terminal_never', {}).items():
        test.assertNotEqual((process(int(pid))[0].get('orca_terminal') or {}).get('title'), title)
    for pid, title in expected.get('terminal_kept', {}).items():
        test.assertEqual(process(int(pid))[0]['orca_terminal']['title'], title)
    for prefix, state in expected.get('status', {}).items():
        test.assertEqual(conversation(prefix)[0]['display_status'], state, prefix)
    for row in rows:
        for pattern in expected.get('display_name_never_matches', []):
            test.assertFalse(re.search(pattern, row['display_name']), (row['id'], row['display_name']))
    return rows


class RealCaptures(unittest.TestCase):
    def test_all_real_records(self):
        paths = sorted(FIXTURES.glob('*.json'))
        records = [p for p in paths if not p.name.endswith('.expected.json')]
        self.assertTrue(records)
        for path in records:
            with self.subTest(record=path.name):
                expected = path.with_suffix('.expected.json')
                self.assertTrue(expected.is_file(), 'New real captures must include reviewed expected results')
                check_record(self, json.loads(path.read_text()), json.loads(expected.read_text()))


class Decisions(unittest.TestCase):
    def test_status_table_and_boundaries(self):
        events = {'events':[{'type':'user','t':100},{'type':'system','subtype':'turn_duration','t':200}]}
        def status(reg=None, transcript=events, now=1000, connected=True):
            return decide([{'status':reg,'statusUpdatedAt':150}] if reg else [], transcript, now, connected)[0]
        self.assertEqual(status('waiting', connected=False),'disconnected')
        self.assertEqual(status('waiting'),'waiting')
        self.assertEqual(status('busy'),'subagents')
        self.assertEqual(status('shell'),'idle')
        self.assertEqual(status('idle', now=799),'done')
        self.assertEqual(status('idle', now=800),'idle')
        self.assertEqual(status(None, {'events':[{'type':'user','t':300}]}),'working')
        self.assertEqual(status('idle', {**events,'subagents':[{'mtime':900}]}),'subagents')
        self.assertEqual(status('idle', {**events,'subagents':[{'mtime':880}]}),'idle')
        self.assertEqual(status('busy', None),'working')
        self.assertEqual(status('idle', None),'idle')
        self.assertEqual(status(None, None),'unknown')
        self.assertEqual(status(None, {'events':[{'type':'event_msg','payload':'turn_aborted','t':200}]}),'interrupted')
        self.assertEqual(status('waiting', {'events':[{'type':'assistant','stop':'end_turn','t':300}]}),'waiting')
        self.assertEqual(status(None, {**events,'partial':True}),'idle')

    def test_turn_shapes_and_idle_after_start(self):
        # v1.2.0 §4: user-shaped rows that start no turn, and the interrupt marker that ends one.
        done = [{'type':'user','t':100},{'type':'system','subtype':'turn_duration','t':200}]
        for row in ({'type':'user','meta':True,'t':300}, {'type':'user','local':True,'t':300}):
            self.assertEqual(decide([], {'events':done+[row]}, 1000)[0], 'idle')
        self.assertEqual(decide([], {'events':done+[{'type':'api-request','t':300},
            {'type':'user','interrupt':True,'t':305}]}, 1000)[0], 'interrupted')
        # §4-1: Claude Code wrote idle after the last start (a replayed notification).
        late = {'events':done+[{'type':'user','t':300}]}
        self.assertEqual(decide([{'status':'idle','statusUpdatedAt':300.02}], late, 1000)[0], 'idle')
        self.assertEqual(decide([{'status':'idle','statusUpdatedAt':300.02}], late, 600)[0], 'done')
        self.assertEqual(decide([{'status':'idle','statusUpdatedAt':150}], late, 1000)[0], 'working')
        self.assertEqual(decide([{'status':'busy','statusUpdatedAt':400}], late, 1000)[0], 'working')

    def test_transcript_facts_recognise_turn_shapes(self):
        from onetop.observe.transcripts import fact
        self.assertTrue(fact({'type':'user','isCompactSummary':True,'message':{'content':'This session is'}})['meta'])
        self.assertTrue(fact({'type':'user','message':{'content':'<command-name>/model</command-name>'}})['local'])
        self.assertTrue(fact({'type':'user','message':{'content':[{'type':'text','text':'[Request interrupted by user]'}]}})['interrupt'])
        plain = fact({'type':'user','message':{'content':[{'type':'text','text':'hello'}]}})
        self.assertFalse({'meta','local','interrupt'} & set(plain))

    def test_orca_chat_seats_and_antigravity_conversations(self):
        # v1.3.0 T4, R7 and §4 rows 8-9.
        seat = {'ORCA_STRUCTURED_SESSION':'1'}
        def proc(pid, argv, **extra):
            return {'pid':pid,'ppid':1,'birth':10.0+pid,'tty':'','cwd':'/work/app','config_dir':'/home','argv':argv,'env':{}, **extra}
        log = {'id':'thread-1','session_id':'thread-1','profile':'/home','cwd':'/work/app','title':'','name':None,'holders':[11],
               'events':[{'type':'event_msg','payload':'task_started','t':900}]}
        record = {'captured_at':1000,'processes':[
            proc(11,['codex','-c','app-server'],env={**seat,'ORCA_AGENT_SESSION_ID':'seat-codex'}),
            proc(12,['codex','app-server']),
            proc(13,['agy_acp_server.par'],name='agy_acp_server.par',env={**seat,'ORCA_AGENT_SESSION_ID':'antigravity_1'}),
            proc(14,['agy'],tty='/dev/ttys001'), proc(15,['agy'],tty='/dev/ttys002'),
            proc(16,['codex','exec-server','--remote'])],
            'claude_registry':{},'claude_transcripts':{},'codex_logs':[log],'orca_terminals':[],'tmux_panes':{},'aside_sessions':[],
            'antigravity_sessions':[{'pid':14,'root':'/home/agy','session_id':'conv-14','title':'Atlas notes','status':'CASCADE_RUN_STATUS_RUNNING','modified':990}],
            'orca_agents':[
                {'paneKey':'structured-agent-session-seat-codex:x','state':'done','interrupted':False,'since':1,'name':'야간 생성 01'},
                {'paneKey':'structured-agent-session-antigravity_1:y','state':'working','interrupted':False,'since':950000,'name':'위키 기획'}]}
        rows = {r['id']:r for r in resolve(record)}
        self.assertEqual(set(rows), {'thread-1','antigravity_1','conv-14','process-15-25.0'})
        codex = rows['thread-1']
        # The seat's own rollout decides before Orca's report does.
        self.assertEqual((codex['display_name'],codex['display_status'],codex['pids']), ('야간 생성 01','working',[11]))
        self.assertIn('Orca 채팅', codex['display_detail']); self.assertNotIn('control_key', codex)
        self.assertEqual((rows['antigravity_1']['display_name'],rows['antigravity_1']['display_status'],rows['antigravity_1']['status_source']),
                         ('위키 기획','working','orca_agent'))
        self.assertEqual((rows['conv-14']['display_status'],rows['conv-14']['title'],rows['conv-14']['status_source']), ('working','Atlas notes','antigravity'))
        self.assertEqual(rows['process-15-25.0']['display_status'], 'idle')
        record['orca_agents'][1]['verifiable'] = False
        self.assertEqual({r['id']:r for r in resolve(record)}['antigravity_1']['display_status'], 'unknown')

    def test_controls_are_overlays_and_disconnection_wins(self):
        spec={'status':'done','status_at':10,'control_key':'k'}
        mark={'key':'k','phase':'paused','at':15}
        self.assertEqual(control_display(spec,mark),('paused',True))
        self.assertEqual(control_display({**spec,'status':'disconnected'},mark),('disconnected',False))
        self.assertEqual(control_display({**spec,'control_key':'other'},mark),('done',False))

    def test_unknown_shape_is_visible_and_host_precedes_spare(self):
        self.assertEqual(describe({'argv':['claude','--new-runner']})['role'],'shape_unknown')
        self.assertEqual(describe({'argv':['claude','--bg-pty-host','--','claude','--bg-spare']})['role'],'helper')
        self.assertEqual(describe({'kind':'Claude','argv':['bfs','-S','bfs','-type','f']})['role'],'helper')
        self.assertEqual(describe({'argv':['claude','--chrome-native-host']})['role'],'helper')

    def test_open_codex_rollout_keeps_its_profile_after_backend_account_switch(self):
        from onetop.observe.codex import read
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);old=root/'old';path=old/'sessions/2026/11/13/rollout-one.jsonl'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'type':'session_meta','payload':{'id':'one','cwd':'/project'}})+'\n')
            logs=read([{'pid':10,'kind':'Codex','config_dir':str(root/'new')}],Reader(),
                      lambda *a,**kw:f'p10\nf1\nn{path}\n','Darwin')
            self.assertEqual(len(logs),1)
            self.assertEqual(logs[0]['profile'],str(old));self.assertEqual(logs[0]['holders'],[10])

    def test_process_reader_skips_system_errors_and_reuses_immutable_metadata(self):
        from onetop.observe.processes import Reader as Processes
        bad=Mock(pid=1);bad.as_dict.side_effect=SystemError('proc_cmdline')
        good=Mock(pid=2);good.as_dict.return_value={'pid':2,'ppid':1,'name':'claude','create_time':20}
        good.exe.return_value='/usr/bin/claude';good.cmdline.return_value=['claude']
        good.environ.return_value={};good.cwd.return_value='/work';good.terminal.return_value='/dev/tty1'
        with patch('onetop.observe.processes.psutil.process_iter',return_value=[bad,good]) as scan, \
             patch('onetop.observe.processes.owned_process',return_value=True):
            reader=Processes();self.assertEqual([r['pid'] for r in reader.read()],[2]);reader.read()
        scan.assert_called_with();good.exe.assert_called_once();good.environ.assert_called_once()

    def test_tail_reader_is_bounded_caches_unchanged_files_and_ignores_partial_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'s.jsonl'
            path.write_text(json.dumps({'type':'user','timestamp':100,'message':{'content':'PRIVATE'}})+'\n')
            reader=Reader();first=reader.read(path)
            with patch('builtins.open',side_effect=AssertionError('unchanged files must not be reopened')):
                self.assertIs(reader.read(path),first)
            with path.open('a') as stream:stream.write('{"type":"system","subtype":"turn_duration","timestamp":200}')
            second=reader.read(path)
            # v1.3.0: an unfinished last line waits for the next read and hides nothing.
            self.assertFalse(second['partial']);self.assertEqual(len(second['events']),1)
            self.assertNotIn('PRIVATE',json.dumps(second))
            self.assertEqual(decide([],second,1000)[0],'working')
            with path.open('a') as stream:stream.write('\n')
            self.assertEqual(decide([],reader.read(path),1000)[0],'idle')

    def test_reader_looks_further_back_for_a_turn_boundary_and_follows_appends(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'rollout.jsonl'
            filler=json.dumps({'type':'response_item','timestamp':150,'payload':{'type':'reasoning','x':'y'*2000}})+'\n'
            path.write_text(json.dumps({'type':'event_msg','timestamp':100,'payload':{'type':'task_started'}})+'\n'+filler*400)
            reader=Reader();self.assertGreater(path.stat().st_size,3*262144)
            self.assertEqual(decide([],reader.read(path),1000)[0],'working')
            with path.open('a') as stream:
                stream.write(filler*300+json.dumps({'type':'event_msg','timestamp':900,'payload':{'type':'task_complete'}})+'\n')
            observed=reader.read(path)
            self.assertEqual(decide([],observed,1000)[0],'done')
            self.assertLess(len(observed['events']),300)
            with path.open('a') as stream:stream.write('\n')
            self.assertFalse(reader.read(path)['partial'])

    def test_profile_and_ambiguous_job_identity(self):
        record=json.loads((FIXTURES/'2026-11-12-cc2.1.322.json').read_text())
        rows=resolve(record)
        source=next(p for p in record['processes'] if p['pid']==38652)
        reg=record['claude_registry']['38652']
        record['processes'].append({**source,'pid':999999})
        record['claude_registry']['999999']={**reg,'pid':999999,'sessionId':'duplicate-job'}
        changed=resolve(record)
        self.assertTrue(all(s['identity_conflict'] for s in changed if any(r['pid'] in (88356,38652,999999) for r in s['runs'])))
        self.assertEqual(len([s for s in changed if any(r['pid']==88356 for r in s['runs'])]),1)
        self.assertNotEqual(next(s['id'] for s in changed if any(r['pid']==88356 for r in s['runs'])),reg['sessionId'])
        # Same SID in another profile must not merge, regardless of equal titles/cwds.
        record['processes'][-1]['config_dir']='/profile2'
        record['claude_registry']['999999']['sessionId']=reg['sessionId']
        changed=resolve(record)
        same=[s for s in changed if s['conversation_id']==reg['sessionId']]
        self.assertEqual(len(same),2);self.assertEqual(len({s['id'] for s in same}),2)

    def test_relay_preserves_canonical_fields_without_local_evidence(self):
        row={'display_name':'이름','display_detail':'설명','display_status':'subagents',
             'runs':[{'pid':1,'birth':2,'role':'interactive','status':'done','display_status':'done',
                      'connected':True,'_registry':{'secret':'PRIVATE'},'location':{'app_path':'PRIVATE'},
                      'terminal':{'handle':'term-1','title':'작업','worktreePath':'PRIVATE','tabId':'PRIVATE'}}]}
        self.assertEqual(session_identity(row)['display_status'],'subagents')
        self.assertNotIn('PRIVATE',json.dumps(session_identity(row)))
        self.assertNotIn('_registry',json.dumps(public(row)))
