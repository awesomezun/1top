import sqlite3
import unittest
from collections import namedtuple
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
from onetop.resources import ResourceSampler,attribute,counter_rate,owner_of
from onetop.usage import session_usage


class ResourceTests(unittest.TestCase):
    def test_linux_cpu_excludes_io_wait_and_duplicate_guest_counters(self):
        from onetop.resources import host_cpu_percent
        # 100 CPU-seconds: 40 busy, 40 idle and 20 waiting for I/O.
        # guest/guest_nice are already included in user/nice.
        before=dict(user=100,nice=0,system=50,idle=200,iowait=10,guest=20,guest_nice=0)
        after=dict(user=130,nice=0,system=60,idle=240,iowait=30,guest=40,guest_nice=0)
        self.assertEqual(host_cpu_percent(after,before),40)

    def test_host_cpu_initial_no_elapsed_and_counter_regression(self):
        from onetop.resources import host_cpu_percent
        before=dict(user=100,system=50,idle=200)
        self.assertIsNone(host_cpu_percent(before,None))
        self.assertIsNone(host_cpu_percent(before,before))
        self.assertEqual(host_cpu_percent(dict(user=99,system=50,idle=220),before),0)
        self.assertEqual(host_cpu_percent(dict(user=120,system=50,idle=220),before),50)

    def test_process_session_and_monitor_cpu_use_all_cores_while_host_chart_is_unchanged(self):
        # In two seconds, the parent uses one CPU and its child uses two CPUs.
        # On a 16-core host these are 6.25% and 12.5%, not 100% and 200%.
        def processes(parent,child):
            return [NS(info=dict(pid=pid,ppid=ppid,name='fixture',create_time=0,
                cpu_times=NS(user=seconds,system=0),memory_info=NS(rss=100)))
                for pid,ppid,seconds in [(10,0,parent),(11,10,child)]]
        Times=namedtuple('Times','user system idle')
        session={'id':'s','pids':[10],'process_started':'Thu Jan  1 00:00:00 1970','process_birth':0}
        with patch.multiple('onetop.resources.psutil',
                cpu_count=Mock(return_value=16),process_iter=Mock(side_effect=[processes(0,0),processes(2,4)]),
                cpu_times=Mock(side_effect=[Times(0,0,0),Times(16,0,16)]),
                virtual_memory=Mock(return_value=NS(total=1000,available=500,percent=50)),
                swap_memory=Mock(return_value=NS(used=0,total=0)),
                disk_usage=Mock(return_value=NS(total=1000,free=500,percent=50)),
                disk_io_counters=Mock(return_value=None),net_io_counters=Mock(return_value={}),
                net_if_stats=Mock(return_value={}),sensors_battery=Mock(return_value=None),boot_time=Mock(return_value=0)), \
                patch('onetop.resources.time.monotonic',side_effect=[0,0,2,2]), \
                patch('onetop.resources.os.getpid',return_value=10):
            sampler=ResourceSampler()
            first=sampler.sample([session],[])
            self.assertIsNone(first['monitor']['cpu'])
            second=sampler.sample([session],[])
        self.assertEqual(second['cpu_basis'],'host_total')
        self.assertEqual({r['pid']:r['cpu'] for r in second['top']},{10:6.25,11:12.5})
        self.assertEqual(second['monitor']['cpu'],6.25)
        self.assertEqual(session['resources']['cpu'],18.8)
        self.assertEqual(second['host']['cpu'],50)
        self.assertEqual(second['history'][-1]['cpu'],50)
        shared=attribute({r['pid']:r for r in second['top']},{'s':[10]},[11])
        self.assertEqual(shared['backend:11']['cpu'],12.5)
        self.assertEqual(shared['s']['cpu'],6.2)

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
