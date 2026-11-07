import json,tempfile,time,unittest,threading
from pathlib import Path
from unittest.mock import Mock,patch
from onetop.controls import Controller,ActionError,accepts_instruction
from onetop.bridge import CloudLink,export_snapshot

class InstructionTests(unittest.TestCase):
 def setUp(self):
  self.spec={'id':'fixture','kind':'Claude','status':'idle','control_key':'key','pids':[12345],'input_verified':True,'orca_terminal':{'handle':'test-terminal','title':'Fixture'}}
  source=Mock();source.specs=[self.spec]
  self.controller=Controller(Mock(),lambda:source)
  self.cmd={'action':'prompt','session_id':'fixture','control_key':'key','request_id':'a'*36,'prompt':'이어서 테스트하고 오류 고쳐줘'}
 def test_exact_input_and_repeat_are_delivered_once(self):
  with patch.object(self.controller,'orca',return_value={'send':{'prompt':{'stages':['turn_started']}}}) as send:
   r=self.controller.execute(self.cmd);self.assertTrue(r['started'])
   send.assert_called_once_with('send','--terminal','test-terminal','--text',self.cmd['prompt'],'--enter','--wait-submit','2')
   self.assertEqual(self.controller.execute(self.cmd),r)
   with self.assertRaises(ActionError):self.controller.execute({**self.cmd,'prompt':'다른 지시'})
   self.assertEqual(send.call_count,1)
   self.assertNotIn(self.cmd['prompt'],json.dumps(self.controller.audit))
 def test_ambiguous_delivery_is_not_retried(self):
  with patch.object(self.controller,'orca',side_effect=ActionError('uncertain')) as send:
   with self.assertRaises(ActionError):self.controller.execute(self.cmd)
   self.assertIn('미확인',self.controller.execute(self.cmd)['message']);self.assertEqual(send.call_count,1)
 def test_working_permission_wait_or_unverified_input_cannot_receive_text(self):
  for changes in [{'status':'working'},{'status':'waiting'},{'input_verified':False},{'input_verified':None},{'orca_terminal':None},{'kind':'Unknown'}]:
   with self.subTest(changes=changes),patch.object(self.controller,'orca') as send:
    old=self.spec.copy();self.spec.update(changes)
    with self.assertRaises(ActionError):self.controller.execute(self.cmd)
    send.assert_not_called();self.spec.clear();self.spec.update(old)
 def test_control_sequences_empty_and_oversize_are_rejected(self):
  for prompt in ['', '  ', '\x1b[200~', 'hello\rquit', 'a'*4001]:
   with patch.object(self.controller,'orca') as send:
    with self.assertRaises(ActionError):self.controller.execute({**self.cmd,'prompt':prompt})
    send.assert_not_called()
 def test_aside_running_uses_queue_for_exact_account_and_session(self):
  self.spec.update(kind='Aside',status='working',aside_session='ses_fixture',aside_account='u7')
  with patch('subprocess.run',return_value=Mock(returncode=0)) as run:
   self.controller.execute(self.cmd)
   argv=run.call_args.args[0];self.assertEqual(argv[1:],['session','queue','--account','u7','--','ses_fixture',self.cmd['prompt']])
   self.assertNotIn('shell',run.call_args.kwargs)
 def test_remote_persists_receipt_before_input_and_never_saves_body(self):
  with tempfile.TemporaryDirectory() as folder:
   ctl=Mock();ctl.execute.return_value={'message':'delivered'}
   link=CloudLink(Mock(),ctl,Path(folder));link.config={'device_id':'device'};link.ws=Mock()
   cmd={**self.cmd,'device_id':'device','expires_at':time.time()*1000+5000}
   link.command(cmd);self.assertEqual(ctl.execute.call_args.args[0]['prompt'],self.cmd['prompt'])
   self.assertNotIn(self.cmd['prompt'],link.receipt_file.read_text())
   again=CloudLink(Mock(),ctl,Path(folder));again.config=link.config;again.ws=Mock();again.command(cmd);self.assertEqual(ctl.execute.call_count,1)
 def test_prompt_capability_follows_actual_input_adapter(self):
  self.assertIn('prompt',export_snapshot({'sessions':[self.spec]})['sessions'][0]['capabilities'])
  self.spec['status']='working';self.assertNotIn('prompt',export_snapshot({'sessions':[self.spec]})['sessions'][0]['capabilities'])
