import copy
import json
import subprocess
import threading
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from onetop.controls import Controller, ActionError, target_key, terminate_pid, process_start
from onetop.server import Handler


class FakeCollector:
    lock=threading.Lock()
    snapshot={'updated':9999999999,'sessions':[]}
    def discover(self):pass


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.spec={'id':'thread-a','kind':'Claude','pids':[12345],'process_started':'original-start',
                   'status':'working','orca_terminal':{'handle':'terminal-a','incarnationId':'inc-a','title':'Test'}}
        self.spec['control_key']=target_key(self.spec)
        self.fresh=FakeCollector();self.fresh.specs=[self.spec]
        self.controller=Controller(FakeCollector(),lambda:self.fresh)
        self.request=dict(action='interrupt',session_id='thread-a',control_key=self.spec['control_key'],request_id='request-a')

    def test_interrupt_is_one_escape_and_never_process_termination(self):
        with patch.object(self.controller,'orca',return_value={}) as send,patch('onetop.controls.terminate_pid') as kill:
            result=self.controller.execute(self.request)
            send.assert_called_once_with('send','--terminal','terminal-a','--text','\x1b')
            kill.assert_not_called()
            self.assertIn('요청',result['message'])
            self.assertEqual(self.controller.execute(self.request),result)
            self.assertEqual(send.call_count,1)

    def test_reused_pid_or_changed_terminal_is_rejected(self):
        self.spec['process_started']='new-process';self.spec['control_key']=target_key(self.spec)
        with patch.object(self.controller,'orca') as send:
            with self.assertRaises(ActionError):self.controller.execute(self.request)
            send.assert_not_called()

    def test_idle_interrupt_does_not_type_into_cli(self):
        self.spec['status']='idle'
        with patch.object(self.controller,'orca') as send:
            self.controller.execute(self.request);send.assert_not_called()

    def test_multiple_clis_in_one_terminal_cannot_receive_interrupt(self):
        self.spec['input_verified']=False
        with patch.object(self.controller,'orca') as send:
            with self.assertRaises(ActionError):self.controller.execute(self.request)
            send.assert_not_called()

    def test_termination_targets_single_verified_pid(self):
        self.spec['status']='idle';self.request['action']='terminate'
        with patch('onetop.controls.terminate_pid',return_value=True) as kill:
            self.assertTrue(self.controller.execute(self.request)['exited'])
            kill.assert_called_once_with(12345,'original-start')

    def test_active_termination_requires_confirmed_stop(self):
        self.request['action']='terminate'
        with patch.object(self.controller,'orca'),patch.object(self.controller,'wait_stopped',side_effect=ActionError('pending')),patch('onetop.controls.terminate_pid') as kill:
            with self.assertRaises(ActionError):self.controller.execute(self.request)
            kill.assert_not_called()

    def test_unknown_state_and_ambiguous_pid_cannot_be_terminated(self):
        self.request['action']='terminate';self.spec['status']='unknown'
        with patch('onetop.controls.terminate_pid') as kill:
            with self.assertRaises(ActionError):self.controller.execute(self.request)
            self.spec['status']='idle';self.spec['pids']=[12345,23456]
            with self.assertRaises(ActionError):self.controller.execute(self.request)
            kill.assert_not_called()

    def test_focus_uses_exact_orca_handle(self):
        self.request['action']='focus'
        with patch.object(self.controller,'orca',return_value={}) as switch:
            self.controller.execute(self.request)
            switch.assert_called_once_with('switch','--terminal','terminal-a')

    def test_real_sigterm_only_to_isolated_child_and_stale_start_rejected(self):
        child=subprocess.Popen(['/bin/sleep','30'])
        try:
            started=process_start(child.pid)
            with self.assertRaises(ActionError):terminate_pid(child.pid,'different-start')
            self.assertIsNone(child.poll())
            # Reap concurrently so ps can confirm it left the process table.
            waiter=threading.Thread(target=child.wait);waiter.start()
            self.assertTrue(terminate_pid(child.pid,started));waiter.join(2)
            self.assertEqual(child.returncode,-15)
        finally:
            if child.poll() is None:child.terminate();child.wait()


class HTTPControlTests(unittest.TestCase):
    def test_origin_token_and_json_are_required(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        server.action_token='test-token';server.collector=FakeCollector()
        class Recorder:
            calls=[]
            def execute(self,p):self.calls.append(p);return {'message':'test accepted'}
        server.controller=Recorder()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        def post(origin,token):
            req=urllib.request.Request(url+'/api/action',data=b'{}',headers={'Origin':origin,'X-Monitor-Token':token,'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req) as r:return r.status
            except urllib.error.HTTPError as e:return e.code
        try:
            self.assertEqual(post('https://unrelated.example','test-token'),403)
            self.assertEqual(post(url,'wrong-token'),403)
            self.assertEqual(server.controller.calls,[])
            self.assertEqual(post(url,'test-token'),200)
            self.assertEqual(server.controller.calls,[{}])
        finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
