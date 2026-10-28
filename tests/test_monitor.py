import json
import tempfile
import sqlite3
import unittest
from pathlib import Path
from onetop.server import Ledger, Collector, vector, claude_windows, glm_windows

def cc(mid,output,**extra):
    return {'type':'assistant','timestamp':'2026-10-23T18:00:00Z','message':{'id':mid,'model':'claude-test','usage':{'input_tokens':10,'cache_read_input_tokens':100,'cache_creation_input_tokens':20,'output_tokens':output,**extra}}}

def cx(inp,cached,out,**extra):
    return {'type':'event_msg','timestamp':'2026-10-23T18:00:00Z','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':inp,'cached_input_tokens':cached,'output_tokens':out,**extra}}}}

class AccountingTests(unittest.TestCase):
    def test_partial_jsonl_append_and_repeated_poll(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'session.jsonl';raw=(json.dumps(cc('m',12))+'\n').encode()
            path.write_bytes(raw[:len(raw)//2])
            c=Collector();c.started=0;c.db=sqlite3.connect(':memory:')
            self.addCleanup(c.db.close)
            c.db.executescript('CREATE TABLE trackers(path TEXT PRIMARY KEY,data TEXT); CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER);')
            spec={'path':str(path),'id':'test-session','kind':'Claude','configured_model':''}
            from onetop.weekly_usage import initialize
            initialize(c.db)
            c.read_tracker(spec);self.assertIsNone(spec['tokens']);self.assertEqual(c.trackers[str(path)].s['offset'],0)
            with path.open('ab') as f:f.write(raw[len(raw)//2:])
            c.read_tracker(spec);self.assertEqual(spec['tokens'],[10,100,20,12])
            c.read_tracker(spec);self.assertEqual(c.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)
            c.trackers={};c.read_tracker(spec);self.assertEqual(c.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)
    def test_quota_windows_are_not_merged_across_possible_accounts(self):
        old={'t':10,'rl':{'five_hour':{'used_percentage':100,'resets_at':999},'seven_day':{'used_percentage':80,'resets_at':9999}}}
        new={'t':20,'rl':{'seven_day':{'used_percentage':23,'resets_at':888}}}
        windows,latest=claude_windows([old,new],100)
        self.assertEqual(len(windows),1);self.assertEqual(windows[0]['pct'],23)
    def test_glm_credit_quota_uses_exact_numerator(self):
        p={'success':True,'data':{'limits':[{'type':'CREDIT_LIMIT','unit':3,'number':5,'usage':100,'currentValue':42.5,'percentage':42,'nextResetTime':9990000000000}]}}
        self.assertEqual(glm_windows(p,100)[0]['pct'],42.5)
    def test_claude_replayed_and_revised_messages(self):
        l=Ledger('Claude');l.consume(cc('a',2));l.consume(cc('a',9));l.consume(cc('a',4));l.consume(cc('b',3));l.consume(cc('a',9))
        self.assertEqual(l.s['total'],[20,200,40,12])
    def test_claude_late_input_revision(self):
        l=Ledger('GLM');l.consume(cc('a',2,input_tokens=0));l.consume(cc('a',2));self.assertEqual(l.s['total'],[10,100,20,2])
    def test_codex_cumulative_is_not_summed_and_cache_is_not_double_counted(self):
        l=Ledger('Codex');self.assertIsNone(l.consume(cx(1000,800,100)))
        e=l.consume(cx(1300,1000,140,reasoning_output_tokens=30));self.assertEqual(e[1],[100,200,0,40]);self.assertEqual(l.s['total'],[300,1000,0,140]);self.assertIsNone(l.consume(cx(1300,1000,140)))
    def test_counter_reset_emits_no_spurious_spend(self):
        l=Ledger('Codex');l.consume(cx(1000,800,100));self.assertIsNone(l.consume(cx(100,0,10)));self.assertTrue(l.s['counter_reset'])
    def test_synthetic_is_not_a_zero_usage_report(self):
        l=Ledger('Claude');d=cc('a',0);d['message']['model']='<synthetic>';l.consume(d);self.assertFalse(l.s['known'])
    def test_state_survives_restart_without_recounting(self):
        l=Ledger('Claude');l.consume(cc('a',9));r=Ledger('Claude',json.loads(json.dumps(l.s)));self.assertIsNone(r.consume(cc('a',9)));self.assertEqual(r.s['total'],l.s['total'])
    def test_task_state_does_not_come_from_token_activity(self):
        l=Ledger('Codex');l.consume({'type':'event_msg','timestamp':'2026-10-23T18:00:00Z','payload':{'type':'task_started'}});self.assertEqual(l.s['status'],'working')
        l.consume({'type':'event_msg','timestamp':'2026-10-23T18:01:00Z','payload':{'type':'task_complete'}});self.assertEqual(l.s['status'],'idle')

if __name__=='__main__':unittest.main()
