"""Faults use isolated temporary stores; never restart or control an installed collector."""
import http.client
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from onetop import accounts, server
from onetop.history import HistoryStore


class StopLoop(BaseException):
    pass


class ResilienceTests(unittest.TestCase):
    @unittest.skipIf(os.name == 'nt', 'POSIX descriptor limit regression')
    def test_discovery_closes_connections_under_low_fd_limit_without_gc(self):
        script = r'''
import gc, json, resource, sqlite3, tempfile
from pathlib import Path
from unittest.mock import patch
import psutil
from onetop import server
with tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp); (home/'.codex').mkdir()
    path=home/'.codex/state_1.sqlite'
    db=sqlite3.connect(path)
    db.execute('CREATE TABLE threads(id,rollout_path,cwd,title,model,name,archived)'); db.close()
    collector=server.Collector(); real=sqlite3.connect; failures=[]
    def connect(*a,**kw):
        try:return real(*a,**kw)
        except sqlite3.Error:
            failures.append(1); raise
    resource.setrlimit(resource.RLIMIT_NOFILE,(64,resource.getrlimit(resource.RLIMIT_NOFILE)[1]))
    gc.collect(); gc.disable(); baseline=psutil.Process().num_fds()
    from onetop.observe.codex import read
    from onetop.observe.transcripts import Reader
    candidates=[{'pid':123,'kind':'Codex','config_dir':str(home/'.codex')}]
    with patch('onetop.observe.codex.sqlite3.connect',side_effect=connect):
        for i in range(500):read(candidates,Reader(),lambda *a,**kw:'','Darwin')
        # Query failure must also close its successfully opened handle.
        db=real(path); db.execute('DROP TABLE threads'); db.close()
        for i in range(500):read(candidates,Reader(),lambda *a,**kw:'','Darwin')
    after=psutil.Process().num_fds()
    assert not failures, 'Descriptor exhaustion was silently swallowed'
    assert after<=baseline+1, (baseline,after)
    print(json.dumps({'cycles':1000,'soft_limit':64,'before':baseline,'after':after,'gc_enabled':gc.isenabled()}))
'''
        result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stderr[-1800:])
        print('FD regression:',result.stdout.strip())
        evidence = json.loads(result.stdout)
        self.assertEqual(evidence['cycles'], 1000)
        self.assertFalse(evidence['gc_enabled'])

    def test_bad_process_attrs_and_environment_do_not_hide_later_profiles(self):
        bad = Mock(); bad.as_dict.side_effect = SystemError('proc_cmdline PRIVATE')
        denied = Mock(); denied.as_dict.side_effect = PermissionError('sysctl PRIVATE')
        env_bad = Mock(); env_bad.as_dict.return_value = {'name':'codex','exe':'','cmdline':[]}
        env_bad.environ.side_effect = SystemError('proc_environ PRIVATE')
        good = Mock(); good.as_dict.return_value = {'name':'codex','exe':'','cmdline':[]}
        good.environ.return_value = {'CODEX_HOME':'/fixture/profile'}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True), \
             patch.object(accounts.psutil, 'process_iter', return_value=[bad,denied,env_bad,good]) as scan:
            result = accounts.profile_roots(Path(tmp))
        self.assertIn(('Codex',Path('/fixture/profile')), result)
        scan.assert_called_once_with()
        bad.environ.assert_not_called()

    def test_history_retries_scan_failure_on_the_next_cycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            history = HistoryStore(tmp)
            history.files = Mock(side_effect=[SystemError('proc_cmdline PRIVATE'), [('Codex',Path(tmp)/'fixture',1)]])
            history.import_file = Mock(return_value=True)
            with patch.object(history.stop_event,'wait',side_effect=[False,StopLoop]):
                with self.assertRaises(StopLoop):history._loop()
            self.assertEqual(history.files.call_count,2)
            history.import_file.assert_called_once()
            self.assertFalse(history.progress['running'])
            self.assertNotIn('error',history.progress)

    def test_collector_retries_initialization_collection_and_mailbox_even_if_logging_fails(self):
        c=server.Collector(); c.accounts=Mock(); c.history=Mock()
        c.initialize=Mock(side_effect=[OSError('PRIVATE'),None])
        def collected():
            c.snapshot={'ready':True,'updated':123,'error':None}
        def collect_tick():
            if c.collect.call_count == 1:raise SystemError('PRIVATE')
            collected()
        c.collect=Mock(side_effect=collect_tick)
        c.tick_mailbox=Mock(side_effect=[OSError('PRIVATE'),None,None])
        with patch('builtins.print',side_effect=OSError('descriptor exhausted')), \
             patch.object(server.time,'sleep',side_effect=[None,None,None,StopLoop]):
            with self.assertRaises(StopLoop):c.loop()
        self.assertEqual(c.initialize.call_count,2)
        self.assertEqual(c.collect.call_count,3)
        self.assertEqual(c.tick_mailbox.call_count,3)
        self.assertEqual(c.snapshot,{'ready':True,'updated':123,'error':None})

    def test_failed_initialization_closes_partial_monitor_connection(self):
        c=server.Collector(); db=sqlite3.connect(':memory:')
        def partial():
            c.db=db
            raise sqlite3.OperationalError('unable to open database file')
        with patch.object(c,'_initialize',side_effect=partial):
            with self.assertRaises(sqlite3.OperationalError):c.initialize()
        with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
        self.assertIsNone(c.db)

    def test_history_connection_is_closed_if_configuration_fails(self):
        history=HistoryStore.__new__(HistoryStore);history.path=Path('/fixture/history.sqlite')
        db=Mock();db.execute.side_effect=sqlite3.OperationalError('disk failure')
        with patch('onetop.history.sqlite3.connect',return_value=db):
            with self.assertRaises(sqlite3.OperationalError):history.connect()
        db.close.assert_called_once()

    def test_period_request_returns_503_then_recovers_without_a_thread_exception(self):
        httpd=server.DashboardHTTPServer(('127.0.0.1',0),server.Handler)
        httpd.collector=Mock()
        httpd.collector.state_for_period.side_effect=[sqlite3.OperationalError('PRIVATE'),{'ready':True,'updated':123,'sessions':[]}]
        httpd.controller=Mock();httpd.controller.decorate.side_effect=lambda s:s
        httpd.action_token='fixture'
        worker=threading.Thread(target=httpd.serve_forever,daemon=True);worker.start()
        try:
            with patch.object(threading,'excepthook') as uncaught:
                for status in [503,200]:
                    connection=http.client.HTTPConnection(*httpd.server_address,timeout=3)
                    try:
                        connection.request('GET','/api/state?period=custom:3600')
                        response=connection.getresponse();body=response.read()
                        self.assertEqual(response.status,status)
                        self.assertNotIn(b'PRIVATE',body)
                        if status==200:self.assertTrue(json.loads(body)['ready'])
                    finally:connection.close()
                uncaught.assert_not_called()
        finally:httpd.shutdown();httpd.server_close();worker.join(3)

    def test_reports_retry_after_error_and_broken_log_sink(self):
        c=server.Collector(); c.db=sqlite3.connect(':memory:'); self.addCleanup(c.db.close)
        c.reports_ready(); c.history=Mock()
        c.value_report.compute=Mock(side_effect=[OSError('PRIVATE'),{'end':100}])
        with patch('builtins.print',side_effect=OSError('descriptor exhausted')), \
             patch.object(server.reports,'weekly',return_value=None), \
             patch.object(server.reports,'last_week',return_value=None), \
             patch.object(server.reports,'notices',return_value=([],{})), \
             patch.object(server.reports,'read_plans',return_value={}), \
             patch.object(threading,'excepthook') as uncaught:
            c.reports_snapshot([],{},100);c.reports_job.join(2)
            self.assertIsNone(c.reports_value)
            c.reports_snapshot([],{},103);c.reports_job.join(2)
        self.assertEqual(c.reports_value,{'end':100})
        self.assertEqual(c.value_report.compute.call_count,2)
        uncaught.assert_not_called()
