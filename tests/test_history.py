import json
import os
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from onetop.history import HistoryStore, edges_for, initialize_capture


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name);self.now = 1730617200.0;self.started = self.now-1800
        self.db = sqlite3.connect(self.directory/'monitor.sqlite')
        self.addCleanup(self.db.close)
        self.db.executescript('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INT,cached INT,written INT,output INT,account TEXT);')
        initialize_capture(self.db);initialize_capture(self.db)
        self.db.execute('INSERT INTO meta VALUES(?,?)',('started',str(self.started)));self.db.commit()
        self.store = HistoryStore(self.directory)
        self.snapshot = {'updated':self.now,'started':self.started}

    def event(self,t,sid='s',kind='Claude',tokens=10,model='m',cwd='/project/p'):
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)',(t,sid,kind,tokens,0,0,0,None,model,cwd));self.db.commit()

    def response(self,period='1h',step='60',kind=None):
        return self.store.response(period,step,kind,self.snapshot)

    def write(self,rows,name='s.jsonl'):
        p=self.directory/name;p.write_text(''.join(json.dumps(r)+'\n' for r in rows));return p

    def claude(self,t,mid='one',tokens=12,model='opus',cwd='/project/old'):
        return {'type':'assistant','sessionId':'s','timestamp':t,'requestId':'req', 'cwd':cwd,
                'private_prompt':'never persist this','message':{'id':mid,'model':model,'usage':{'input_tokens':tokens}}}

    def test_collector_exact_period_totals_and_metadata(self):
        self.event(self.now-1700,tokens=10);self.event(self.now-100,tokens=20);self.event(self.now+1,tokens=900)
        r=self.response();self.assertEqual(sum(x or 0 for x in r['series']['total']),30)
        for key in ['by_model','by_project']:
            self.assertEqual([sum(row['tokens'][i] or 0 for row in r['series'][key]) for i in range(len(r['series']['bins']))], [v or 0 for v in r['series']['total']])
        self.assertIn(None,r['series']['total']);self.assertIn(0,r['series']['total'])
        self.assertEqual(len(r['heatmap']['hours']),720)

    def test_transcript_backfill_dedup_revisions_and_collector_overlap(self):
        before=self.now-4000;inside=self.now-100
        p=self.write([self.claude(before,tokens=10),self.claude(before,tokens=12),self.claude(inside,mid='recent',tokens=500)])
        self.store.import_file('Claude',p)
        self.store.import_file('Claude',self.write([self.claude(before,tokens=12)],'copy.jsonl'))
        self.event(inside,tokens=20,model=None,cwd=None)
        r=self.response('5h','300');self.assertEqual(sum(v or 0 for v in r['series']['total']),32)
        self.assertEqual(r['series']['by_model'][0]['key'],'opus')
        self.assertEqual(r['series']['by_project'][0]['key'],'/project/old')
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0],2)
            self.assertNotIn('never persist this',str(db.execute('SELECT * FROM records').fetchall()))
        self.assertEqual(sum(v or 0 for v in self.response()['series']['total']),20)

    def test_incremental_restart_and_incomplete_tail(self):
        p=self.write([self.claude(self.now-4000)])
        self.assertTrue(self.store.import_file('Claude',p))
        with p.open('a') as f:f.write('{"type":')
        self.assertTrue(self.store.import_file('Claude',p))
        p.write_text(json.dumps(self.claude(self.now-4000))+'\n'+json.dumps(self.claude(self.now-3000,mid='two'))+'\n')
        store=HistoryStore(self.directory);store.import_file('Claude',p)
        with store.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0],2)

    def test_stale_collector_start_does_not_hide_days_of_transcript_history(self):
        self.snapshot['started']=self.now-10*86400
        at=self.now-3*86400
        self.store.import_file('Claude',self.write([self.claude(at,tokens=50)]))
        self.event(self.now-100,tokens=20)
        result=self.response('custom:604800','day')
        self.assertEqual(sum(v or 0 for v in result['series']['total']),70)
        collector=next(c for c in result['coverage'] if c['source']=='collector')
        self.assertEqual(collector['from'],self.now-100)

    def test_aside_event_model_enriches_collector_without_recounting(self):
        folder=self.directory/'u/0/sessions/session_abc';folder.mkdir(parents=True)
        p=folder/'messages.jsonl';at=self.now-100
        p.write_text(json.dumps({'role':'assistant','model':'gpt-test','usage':{'input':50},'timestamp':at*1000})+'\n')
        self.store.import_file('Aside',p)
        self.event(at,sid='aside:0:abc',kind='Aside',tokens=50,model=None,cwd=None)
        value=self.response()['series']
        self.assertEqual(sum(v or 0 for v in value['total']),50)
        self.assertEqual(value['by_model'][0]['key'],'gpt-test')

    def test_codex_fork_metadata_maps_to_physical_thread_without_counting_replay(self):
        sid='11111111-2222-3333-4444-555555555555';at=self.now-100
        rows=[{'type':'session_meta','timestamp':at-20,'payload':{'id':'parent','cwd':'/fork'}},
              {'type':'turn_context','timestamp':at-10,'payload':{'model':'gpt-fork'}},
              {'type':'event_msg','timestamp':at,'payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':500}}}}]
        self.store.import_file('Codex',self.write(rows,'rollout-2024-'+sid+'.jsonl'))
        self.event(at,sid=sid,kind='Codex',tokens=20,model=None,cwd=None)
        result=self.response()['series']
        self.assertEqual(result['by_model'][0]['key'],'gpt-fork')
        self.assertEqual(sum(v or 0 for v in result['total']),20)

    def test_codex_deltas_model_changes_reset_and_replay(self):
        rows=[{'type':'session_meta','timestamp':self.now-7000,'payload':{'id':'cx','cwd':'/codex/a'}},
              {'type':'turn_context','timestamp':self.now-7000,'payload':{'model':'first'}}]
        for i,(value,model) in enumerate([(10,None),(15,None),(20,'second'),(2,None),(7,None)]):
            at=self.now-6000+i*100
            if model:rows.append({'type':'turn_context','timestamp':at,'payload':{'model':model}})
            rows.append({'type':'event_msg','timestamp':at,'payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':value}}}})
        p=self.write(rows,'rollout-test.jsonl');self.store.import_file('Codex',p)
        self.store.import_file('Codex',self.write(rows,'rollout-copy.jsonl'))
        r=self.response('5h','300','Codex');self.assertEqual(sum(v or 0 for v in r['series']['total']),15)
        self.assertEqual({x['key']:sum(v or 0 for v in x['tokens']) for x in r['series']['by_model']},{'second':10,'first':5})

    def test_top12_other_and_kind_filter(self):
        for i in range(16):self.event(self.now-100,kind='Codex',tokens=i+1,model=f'm{i}',cwd=f'/p{i}')
        self.event(self.now-100,kind='Claude',tokens=999)
        r=self.response(kind='Codex')['series']
        self.assertEqual(sum(v or 0 for v in r['total']),136)
        for name in ['by_model','by_project']:
            self.assertEqual(len(r[name]),13);self.assertEqual(r[name][-1]['folded'],4)
            self.assertEqual(sum(sum(v or 0 for v in x['tokens']) for x in r[name]),136)

    def test_heatmap_is_independent_of_selected_period(self):
        self.event(self.now-10,tokens=4)
        self.assertEqual(self.response()['heatmap'],self.response('5h','300')['heatmap'])

    def test_boundaries_and_request_validation(self):
        for period,step in [('bad','60'),('custom:1','60'),('24h','60'),('1h','bad')]:
            with self.subTest(period=period,step=step),self.assertRaises(ValueError):self.response(period,step)
        for step in ['day','week']:
            edges=edges_for(self.now-10*86400,self.now,step)
            self.assertTrue(all(datetime.fromtimestamp(t).hour==0 for t in edges))
            if step=='week':self.assertTrue(all(datetime.fromtimestamp(t).weekday()==0 for t in edges))

    @unittest.skipUnless(hasattr(time,'tzset'),'Timezone change requires POSIX')
    def test_dst_daily_boundaries_follow_local_calendar(self):
        old=os.environ.get('TZ')
        try:
            os.environ['TZ']='America/New_York';time.tzset()
            start=datetime(2024,11,2,8).timestamp();end=datetime(2024,11,5,8).timestamp()
            edges=edges_for(start,end,'day')
            self.assertIn(25*3600,[b-a for a,b in zip(edges,edges[1:])])
            self.assertTrue(all(datetime.fromtimestamp(t).hour==0 for t in edges))
        finally:
            if old is None:os.environ.pop('TZ',None)
            else:os.environ['TZ']=old
            time.tzset()


if __name__=='__main__':unittest.main()
