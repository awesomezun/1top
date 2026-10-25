import json,tempfile,threading,time,unittest,uuid
from pathlib import Path
from unittest.mock import Mock,patch
from onetop.mailbox import Mailbox,assistant_text
from onetop.controls import Controller

class MailboxTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.path=Path(self.tmp.name)/'conversation.jsonl';self.path.write_text('')
  self.spec={'id':'fixture','kind':'Claude','path':str(self.path),'status':'working','control_key':'key','pids':[12345],'input_verified':True,'orca_terminal':{'handle':'fixture','title':'Fixture'}}
  self.box=Mailbox(Path(self.tmp.name)/'mail.json');self.rid=str(uuid.uuid4())
 def append(self,value):
  with self.path.open('a') as f:f.write(json.dumps(value)+'\n')
 def reply(self,text,role='assistant',typ='text',rid=None):
  return {'type':'assistant','message':{'role':role,'content':[{'type':typ,'text':f'[1top-reply:{rid or self.rid}]{text}[/1top-reply]'}]}}
 def test_only_correlated_new_visible_reply_leaves_computer(self):
  self.append(self.reply('old private answer'))
  envelope=self.box.begin(self.spec,self.rid,'Where are you?');self.assertIn(self.rid,envelope)
  for record in [self.reply('reasoning','assistant','thinking'),self.reply('user quote','user'),self.reply('tool dump','tool'),self.reply('wrong thread',rid=str(uuid.uuid4())),{'type':'assistant','message':{'role':'assistant','content':[{'type':'text','text':'unrelated task log'}]}}]:self.append(record)
  self.assertEqual(self.box.read(self.spec)[0]['reply'],'')
  self.append(self.reply('Tests are finished.'))
  rows=self.box.read(self.spec);self.assertEqual(rows[0]['reply'],'Tests are finished.');self.assertEqual(rows[0]['status'],'replied')
  for private in ['old private','reasoning','tool dump','wrong thread','unrelated','conversation.jsonl','offset','inode']:self.assertNotIn(private,json.dumps(rows))
 def test_restart_retains_mail_and_private_file_permissions(self):
  self.box.begin(self.spec,self.rid,'Status?');self.append(self.reply('Ready'))
  restored=Mailbox(self.box.path);self.assertEqual(restored.read(self.spec)[0]['reply'],'Ready');self.assertEqual(self.box.path.stat().st_mode&0o777,0o600)
 def test_partial_json_line_is_not_lost(self):
  self.box.begin(self.spec,self.rid,'Status?');line=json.dumps(self.reply('Complete'))
  with self.path.open('a') as f:f.write(line[:30])
  self.assertEqual(self.box.read(self.spec)[0]['reply'],'')
  with self.path.open('a') as f:f.write(line[30:]+'\n')
  self.assertEqual(self.box.read(self.spec)[0]['reply'],'Complete')
 def test_codex_and_aside_ignore_reasoning_and_tools(self):
  for channel,want in [('final','ok'),('analysis','')]:
   self.assertEqual(assistant_text({'type':'response_item','payload':{'type':'message','role':'assistant','channel':channel,'content':[{'type':'output_text','text':'ok'}]}},'Codex'),want)
  self.assertEqual(assistant_text({'role':'assistant','content':[{'type':'thinking','thinking':'secret'},{'type':'text','text':'visible'},{'type':'toolCall','arguments':'private'}]},'Aside'),'visible')
 def test_running_terminal_queues_then_sends_once_after_idle(self):
  collector=Mock();collector.lock=threading.Lock();collector.snapshot={'updated':time.time(),'sessions':[self.spec]}
  source=Mock();source.specs=[self.spec];ctl=Controller(collector,lambda:source,Path(self.tmp.name)/'control.json')
  cmd={'action':'message','session_id':'fixture','control_key':'key','request_id':self.rid,'prompt':'Status?'}
  with patch.object(ctl,'orca',return_value={}) as send:
   self.assertTrue(ctl.execute(cmd)['queued']);ctl.execute(cmd);send.assert_not_called()
   ctl.flush_mailbox();send.assert_not_called();self.spec['status']='idle';ctl.flush_mailbox();ctl.flush_mailbox()
   self.assertEqual(send.call_count,1);self.assertIn(self.rid,send.call_args.args[4]);self.assertEqual(ctl.read_mailbox('fixture','key')[0]['status'],'awaiting_reply')
 def test_queue_never_retargets_replaced_session(self):
  collector=Mock();collector.lock=threading.Lock();collector.snapshot={'updated':time.time(),'sessions':[self.spec]}
  source=Mock();source.specs=[self.spec];ctl=Controller(collector,lambda:source)
  ctl.mailbox.enqueue(self.spec,self.rid,'Status?');self.spec['control_key']='changed';self.spec['status']='idle'
  with patch.object(ctl,'orca') as send:ctl.flush_mailbox();send.assert_not_called()
  self.assertEqual(ctl.mailbox.read(self.spec)[0]['status'],'not_delivered')

 def test_undelivered_queue_can_still_be_read(self):
  self.box.enqueue(self.spec,self.rid,'Status?');self.box.delivery(self.rid,'delivery_unconfirmed')
  self.assertEqual(self.box.read(self.spec)[0]['status'],'delivery_unconfirmed')
 def test_fast_reply_releases_resuming_marker(self):
  ctl=Controller(Mock(),Mock());ctl.remember(self.spec,'resuming')
  state={'sessions':[{**self.spec,'status':'idle','status_at':time.time()+1}]}
  result=ctl.decorate(state);self.assertEqual(result['sessions'][0]['display_status'],'idle');self.assertNotIn('fixture',ctl.paused)
