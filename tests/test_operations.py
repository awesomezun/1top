import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from onetop.operations import OperationalMonitor


class OperationsTests(unittest.TestCase):
    def test_goals_are_read_only_and_keep_offline_state_separate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'.codex').mkdir(); p = root/'.codex/goals_1.sqlite'
            db = sqlite3.connect(p)
            db.execute('CREATE TABLE thread_goals(thread_id,goal_id,objective,status,token_budget,tokens_used,time_used_seconds,updated_at_ms)')
            db.execute("INSERT INTO thread_goals VALUES('s','g','Fixture','active',NULL,400,20,1000)")
            db.commit(); db.close(); before=p.read_bytes()
            rows, state = OperationalMonitor(root).goals([])
            self.assertEqual(state,'reported'); self.assertFalse(rows[0]['session_connected'])
            self.assertEqual(rows[0]['status'],'active'); self.assertIsNone(rows[0]['token_budget'])
            self.assertEqual(p.read_bytes(),before)

    def test_missing_database_is_not_zero_goals(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(OperationalMonitor(tmp).goals([]),([], 'unavailable'))

    def test_prompt_mentions_do_not_become_activity(self):
        monitor=OperationalMonitor(); session={'id':'s','kind':'Claude'}
        monitor.event({'message':{'content':[{'type':'text','text':'/loop 5m /skill test /goal go'}]}},session)
        self.assertEqual(monitor.events,{})
        monitor.event({'message':{'content':[{'type':'tool_use','id':'1','name':'Skill','input':{'skill':'test'}}]}},session)
        monitor.event({'message':{'content':[{'type':'tool_result','tool_use_id':'1','content':'success'}]}},session)
        self.assertEqual(monitor.events['s:1']['state'],'tool_returned')
        self.assertEqual(monitor.events['s:1']['result'],'not_verified')

    def test_schedule_observation_is_not_active_job_or_next_run(self):
        monitor=OperationalMonitor()
        monitor.event({'scheduledTaskId':'a','scheduledFireId':'b','cron':'*/5 * * * *'}, {'id':'s','kind':'Claude'})
        event=monitor.events['fire:b']
        self.assertEqual(event['state'],'fire_observed'); self.assertIsNone(event['next_run'])

    def test_claude_goal_attachments_distinguish_clear_and_complete(self):
        monitor=OperationalMonitor();session={'id':'s','kind':'Claude'}
        def emit(**extra):monitor.event({'type':'attachment','attachment':{'type':'goal_status','condition':'Fixture',**extra}},session)
        emit(met=False,sentinel=True)
        self.assertEqual(monitor.claude_goals['s']['status'],'active')
        self.assertIsNone(monitor.claude_goals['s']['tokens_used'])
        emit(met=True,sentinel=True)
        self.assertEqual(monitor.claude_goals['s']['status'],'cleared')
        emit(met=True,tokens=200,durationMs=2000,iterations=3)
        self.assertEqual(monitor.claude_goals['s']['status'],'complete')
        self.assertEqual(monitor.claude_goals['s']['time_used_seconds'],2)
        emit(met=False,failed=True)
        self.assertEqual(monitor.claude_goals['s']['status'],'failed')

    def test_native_loop_fire_excludes_prompt_and_does_not_predict_next_run(self):
        monitor=OperationalMonitor()
        monitor.event({'type':'system','subtype':'scheduled_task_fire','taskId':'job','uuid':'fire','taskKind':'loop','cron':'*/5 * * * *','prompt':'PRIVATE'}, {'id':'s','kind':'Claude'})
        event=monitor.events['fire:fire']
        self.assertEqual(event['name'],'Claude Code /loop');self.assertIsNone(event['next_run'])
        self.assertNotIn('PRIVATE',json.dumps(event))

    def test_skill_aliases_deduplicate_and_do_not_imply_enabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); p=root/'.agents/skills/test';p.mkdir(parents=True)
            (p/'SKILL.md').write_text('---\nname: example\n---\nInstructions')
            alias=root/'.codex/skills/test';alias.parent.mkdir(parents=True);alias.symlink_to(p)
            skills=OperationalMonitor(root).skills([])
            self.assertEqual(len(skills),1);self.assertEqual(skills[0]['name'],'example')
            self.assertEqual(skills[0]['availability'],'not_verified')
            self.assertEqual(skills[0]['providers'],['Shared','Codex'])

    def test_partial_log_line_waits_and_repeated_scan_does_not_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'log.jsonl';event={'message':{'content':[{'type':'tool_use','id':'1','name':'Skill','input':{'skill':'test'}}]}}
            p.write_text(json.dumps(event))
            monitor=OperationalMonitor(tmp);session={'id':'s','kind':'Claude','path':str(p)}
            monitor.scan(session);self.assertEqual(monitor.events,{})
            with p.open('a') as f:f.write('\n')
            monitor.scan(session);monitor.scan(session);self.assertEqual(len(monitor.events),1)

    def test_codex_skill_read_and_return_do_not_claim_workflow_success(self):
        m=OperationalMonitor();session={'id':'c','kind':'Codex'}
        m.event({'type':'response_item','payload':{'type':'function_call','call_id':'one','name':'exec_command','arguments':json.dumps({'cmd':'cat /skills/research/SKILL.md'})}},session)
        self.assertEqual(m.events['c:one']['state'],'read_requested')
        m.event({'type':'response_item','payload':{'type':'function_call_output','call_id':'one','output':'private instructions'}},session)
        self.assertEqual(m.events['c:one']['state'],'tool_returned')
        self.assertEqual(m.events['c:one']['result'],'not_verified')
        self.assertNotIn('private',json.dumps(m.events))
        m.event({'type':'response_item','payload':{'type':'function_call','call_id':'echo','name':'exec_command','arguments':json.dumps({'cmd':'echo /skills/research/SKILL.md'})}},session)
        self.assertNotIn('c:echo',m.events)

    def test_persistent_jobs_are_read_only_and_never_predict_next_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'.claude/scheduled_tasks.json';path.parent.mkdir()
            path.write_text(json.dumps({'tasks':[{'id':'job','cron':'*/5 * * * *','prompt':'PRIVATE','createdBySessionId':'s','recurring':True,'lastFiredAt':1200}]}))
            before=path.read_bytes();m=OperationalMonitor(tmp)
            rows=m.schedules([{'id':'s','kind':'Claude','project':'fixture'}])
            self.assertEqual(len(rows),1);self.assertTrue(rows[0]['session_connected']);self.assertIsNone(rows[0]['next_run'])
            self.assertNotIn('PRIVATE',json.dumps(rows));self.assertEqual(path.read_bytes(),before)
            path.write_text('{broken');self.assertEqual(m.schedules([]),[])
