import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from onetop.controls import Controller,ActionError,RESUME_PROMPT,target_key
from test_controls import FakeCollector


class PauseTests(unittest.TestCase):
    def setUp(self):
        self.spec={'id':'s','kind':'Claude','pids':[12345],'process_started':'start','status':'idle',
                   'orca_terminal':{'handle':'terminal-a','incarnationId':'i','title':'Work'}}
        self.spec['control_key']=target_key(self.spec)
        self.fresh=FakeCollector();self.fresh.specs=[self.spec]
        self.c=Controller(FakeCollector(),lambda:self.fresh)
    def request(self,action,rid):return {'action':action,'session_id':'s','control_key':self.spec['control_key'],'request_id':rid}
    def test_pause_is_persisted_only_after_confirmed_stop(self):
        self.spec['status']='working'
        with patch.object(self.c,'interrupt'),patch.object(self.c,'wait_stopped',side_effect=ActionError('pending')):
            with self.assertRaises(ActionError):self.c.execute(self.request('pause','p'))
        self.assertFalse(self.c.paused)
        self.spec['status']='idle';self.c.execute(self.request('pause','p2'))
        self.assertEqual(self.c.decorate({'sessions':[self.spec]})['sessions'][0]['display_status'],'paused')
    def test_resume_sends_exactly_one_new_request_and_blocks_duplicate(self):
        self.c.execute(self.request('pause','p'))
        with patch.object(self.c,'orca',return_value={'send':{'accepted':True,'prompt':{'stages':['input_accepted']}}}) as send:
            result=self.c.execute(self.request('resume','r'))
            self.assertFalse(result['started']);send.assert_called_once_with('send','--terminal','terminal-a','--text',RESUME_PROMPT,'--enter','--wait-submit','2')
            self.assertEqual(self.c.execute(self.request('resume','r')),result)
            with self.assertRaises(ActionError):self.c.execute(self.request('resume','different'))
            self.assertEqual(send.call_count,1)
    def test_ambiguous_resume_transport_never_automatically_resends(self):
        self.c.execute(self.request('pause','p'))
        with patch.object(self.c,'orca',side_effect=ActionError('timeout')) as send:
            with self.assertRaises(ActionError):self.c.execute(self.request('resume','r'))
            with self.assertRaises(ActionError):self.c.execute(self.request('resume','r2'))
            self.assertEqual(send.call_count,1)
    def test_external_new_turn_clears_pause_marker(self):
        self.c.execute(self.request('pause','p'))
        s={**self.spec,'status':'working','status_at':time.time()+1}
        self.assertEqual(self.c.decorate({'sessions':[s]})['sessions'][0]['display_status'],'working')
        self.assertFalse(self.c.paused)
    def test_pause_survives_restart_but_not_process_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'state.json';c=Controller(FakeCollector(),lambda:self.fresh,p)
            c.execute(self.request('pause','p'))
            c2=Controller(FakeCollector(),lambda:self.fresh,p)
            self.assertEqual(c2.decorate({'sessions':[self.spec]})['sessions'][0]['display_status'],'paused')
            changed={**self.spec,'control_key':'new-process'}
            self.assertEqual(c2.decorate({'sessions':[changed]})['sessions'][0]['display_status'],'idle')


if __name__=='__main__':unittest.main()
