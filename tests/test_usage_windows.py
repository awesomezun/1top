import sqlite3
import unittest
from unittest.mock import Mock,patch
from onetop.usage import window_usage,WINDOWS
from onetop.server import Collector


class RollingUsageTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER)')
        self.now=200000

    def event(self,age,value,sid='live',kind='Codex'):
        self.db.execute('INSERT INTO events(t,sid,kind,fresh,cached,written,output) VALUES(?,?,?,?,?,?,?)',
                        (self.now-age,sid,kind,value,2*value,3*value,4*value))

    def test_all_six_exact_rolling_boundaries_and_future_exclusion(self):
        for key,_,seconds in WINDOWS:
            with self.subTest(key=key):
                self.db.execute('DELETE FROM events')
                self.event(seconds,1000) # left edge excluded
                self.event(seconds-.001,1)
                self.event(0,2) # current instant included
                self.event(-.001,10000) # future excluded
                p,s=window_usage(self.db,self.now,self.now-100000)
                w=next(w for w in p['windows'] if w['key']==key)
                self.assertEqual(w['tokens'],[3,6,9,12])
                self.assertEqual(s['live'][key],w['tokens'])
                self.assertFalse(w['partial'])
                self.assertEqual(w['by_model'],[dict(kind='Codex',model=None,tokens=[3,6,9,12],session_count=1)])

    def test_event_models_survive_closed_sessions_and_model_changes(self):
        self.db.execute('ALTER TABLE events ADD COLUMN model TEXT')
        self.db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',[
            (self.now-90,'closed','Claude',79,0,0,0,'claude-opus-5-5'),
            (self.now-80,'live','Claude',11,0,0,0,'claude-opus-5-5'),
            (self.now-70,'switching','Codex',5,2,3,4,'gpt-6-astra'),
            (self.now-60,'switching','Codex',5,2,3,4,'gpt-6.1-sol'),
            (self.now-50,'other-app','Aside',2,0,0,0,'gpt-6.1-sol'),
            (self.now-40,'switching','Codex',1,0,0,0,'gpt-6.1-sol'),
            (self.now-600,'boundary','Claude',999,0,0,0,'excluded-model'),
            (self.now+1,'future','Claude',999,0,0,0,'excluded-model')])
        periods,sessions=window_usage(self.db,self.now,0)
        window=periods['windows'][-1]
        rows=window['by_model']
        self.assertEqual(rows[0],dict(kind='Claude',model='claude-opus-5-5',tokens=[90,0,0,0],session_count=2))
        by_identity={(r['kind'],r['model']):r for r in rows}
        self.assertEqual(by_identity[('Codex','gpt-6.1-sol')]['tokens'],[6,2,3,4])
        self.assertEqual(by_identity[('Codex','gpt-6.1-sol')]['session_count'],1)
        self.assertEqual(by_identity[('Aside','gpt-6.1-sol')]['tokens'],[2,0,0,0])
        self.assertEqual(len(rows),4)
        self.assertEqual(window['session_count'],4)
        self.assertEqual(sessions['switching']['10m'],[11,4,6,8])
        self.assertEqual([sum(r['tokens'][i] for r in rows) for i in range(4)],window['tokens'])

    def test_missing_model_is_separate_from_known_closed_session(self):
        self.db.execute('ALTER TABLE events ADD COLUMN model TEXT')
        self.db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',[
            (self.now-10,'unknown','Claude',1,0,0,0,model)
            for model in (None,'','unknown','  ','<synthetic>')])
        self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',
                        (self.now-20,'closed','Claude',8,0,0,0,'claude-opus-5-5'))
        periods,_=window_usage(self.db,self.now,0)
        self.assertEqual(periods['windows'][-1]['by_model'],[
            dict(kind='Claude',model='claude-opus-5-5',tokens=[8,0,0,0],session_count=1),
            dict(kind='Claude',model=None,tokens=[5,0,0,0],session_count=1)])

    def test_nested_windows_are_not_added_together(self):
        for age,value in [(100,1),(1000,2),(2000,4),(7200,8),(21600,16),(60000,32)]:
            self.event(age,value)
        p,_=window_usage(self.db,self.now,0)
        self.assertEqual([w['tokens'][0] for w in p['windows']],[63,31,15,7,3,1])

    def test_closed_sessions_and_provider_totals_are_retained(self):
        self.event(30,2,'still-open','Codex')
        self.event(80,3,'now-closed','Claude')
        self.event(90,5,'glm','GLM')
        p,s=window_usage(self.db,self.now,0)
        w=p['windows'][-1]
        self.assertEqual(w['session_count'],3)
        self.assertEqual(w['tokens'],[10,20,30,40])
        self.assertEqual(w['by_kind']['Claude'],[3,6,9,12])
        self.assertIn('now-closed',s)
        self.assertNotIn('Antigravity',p['known_kinds'])

    def test_partial_horizon_does_not_extrapolate_or_include_pre_recording(self):
        self.event(3000,100)
        self.event(2000,2)
        self.event(500,3)
        p,_=window_usage(self.db,self.now,self.now-2000)
        first=p['windows'][0]
        self.assertTrue(first['partial'])
        self.assertEqual(first['observed_seconds'],2000)
        self.assertEqual(first['tokens'],[5,10,15,20])
        self.assertFalse(p['windows'][-1]['partial'])
        self.assertEqual(p['windows'][-1]['tokens'],[3,6,9,12])
        before=self.db.execute('SELECT count(*) FROM events').fetchone()
        again,_=window_usage(self.db,self.now,self.now-2000)
        self.assertEqual(p,again)
        self.assertEqual(before,self.db.execute('SELECT count(*) FROM events').fetchone())

    def test_collector_preserves_unknown_and_known_zero_without_lifetime_injection(self):
        self.event(90000,1,'retained-history')
        c=Collector();c.db=self.db;c.started=self.now-2000;c.discovery_at=self.now
        c.terminal_count=0;c.quotas=Mock(return_value=[])
        c.resources=Mock();c.resources.sample.return_value={}
        c.specs=[dict(id=sid,kind='Codex',path=sid,cwd='/tmp/test',status='idle',pids=[]) for sid in ['known','unknown']]
        def tracker(s):
            s['tokens']=[999999,888888,0,1234] if s['id']=='known' else None
        c.read_tracker=tracker
        from onetop.weekly_usage import initialize
        initialize(self.db)
        with patch('onetop.server.time.time',return_value=self.now), patch('onetop.aside.discover',return_value=[]):c.collect()
        known,unknown=c.snapshot['sessions']
        self.assertEqual(known['usage']['windows']['24h'],[0,0,0,0])
        self.assertIsNone(unknown['usage']['windows']['24h'])
        self.assertEqual(c.snapshot['period_usage']['windows'][0]['tokens'],[0,0,0,0])
        self.assertEqual(c.snapshot['period_usage']['known_kinds'],['Codex'])
        self.assertEqual(self.db.execute("SELECT count(*) FROM events WHERE sid='retained-history'").fetchone()[0],1)


if __name__=='__main__':unittest.main()
