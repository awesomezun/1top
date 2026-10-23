import sqlite3
import unittest
from onetop.resources import attribute,counter_rate,owner_of
from onetop.usage import session_usage


class ResourceTests(unittest.TestCase):
    def test_nested_session_and_shared_backend_are_never_double_assigned(self):
        rows={1:dict(ppid=0,rss=10,cpu=1),2:dict(ppid=1,rss=20,cpu=2),
              3:dict(ppid=2,rss=30,cpu=3),4:dict(ppid=1,rss=40,cpu=4),
              5:dict(ppid=4,rss=50,cpu=5),6:dict(ppid=1,rss=60,cpu=6)}
        groups=attribute(rows,{'session-a':[1],'session-b':[2]},[4])
        self.assertEqual(groups['session-a']['pids'],[1,6])
        self.assertEqual(groups['session-b']['pids'],[2,3])
        self.assertEqual(groups['backend:4']['pids'],[4,5])
        self.assertEqual(sum(g['rss'] for g in groups.values()),210)
        self.assertEqual(sum(g['cpu'] for g in groups.values()),21)

    def test_first_sample_unknown_and_counter_reset_is_not_negative(self):
        self.assertIsNone(counter_rate(10,None,3));self.assertIsNone(counter_rate(5,10,3))
        self.assertIsNone(counter_rate(10,5,0));self.assertEqual(counter_rate(20,10,2),5)

    def test_missing_parent_or_cycle_does_not_attribute_to_arbitrary_session(self):
        self.assertIsNone(owner_of(3,{3:4,4:3},{1:'a'}))
        self.assertIsNone(owner_of(3,{3:4},{1:'a'}))

    def test_usage_rate_separates_sessions_and_excludes_future_reports(self):
        db=sqlite3.connect(':memory:');self.addCleanup(db.close)
        with db:
            db.execute('CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER)')
            db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?)',[(90,'a','Codex',10,80,0,10),(50,'a','Codex',20,70,0,10),(80,'b','Claude',3,0,0,7),(101,'a','Codex',999,0,0,0)])
            one,five,history,window=session_usage(db,100,0)
            self.assertEqual(window,60);self.assertEqual(sum(one['a']),200);self.assertEqual(sum(one['b']),10)
            self.assertEqual(sum(p[1] for p in history['a']),200)
            one,_,_,window=session_usage(db,100,80)
            self.assertEqual(window,20);self.assertEqual(sum(one['a']),100)


if __name__=='__main__':unittest.main()
