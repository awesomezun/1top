import json,tempfile,time,unittest
from pathlib import Path
from onetop.mailbox import Mailbox

RID='33333333-3333-4333-8333-333333333333'
class ActivityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.path=self.root/'session.jsonl';self.path.write_text('');self.box=Mailbox(self.root/'mail.json')
  self.spec={'id':'s','kind':'Claude','path':str(self.path),'status':'working'}
  self.box.begin(self.spec,RID,'Question');self.box.delivery(RID,'awaiting_reply')
 def add(self,**record):
  with self.path.open('a') as stream:stream.write(json.dumps({'timestamp':time.time(),**record})+'\n')
 def row(self):return self.box.read(self.spec)[0]
 def start(self):self.add(type='user',message={'role':'user','content':f'Question\n[1top-reply:{RID}]...[/1top-reply]'})
 def test_received_or_unrelated_work_never_looks_like_typing(self):
  self.add(type='api-request');self.assertIsNone(self.row()['activity'])
  self.start();self.assertIsNone(self.row()['activity'])
  self.add(type='api-request');self.assertEqual(self.row()['activity']['phase'],'responding')
 def test_actual_phases_are_separate_from_message_text_and_reasoning(self):
  self.start();self.add(type='api-request');self.row()
  self.add(type='assistant',message={'role':'assistant','content':[{'type':'tool_use','name':'SECRET TOOL','input':{'secret':'PRIVATE'}}]})
  row=self.row();self.assertEqual(row['activity']['phase'],'working');self.assertNotIn('PRIVATE',json.dumps(row));self.assertNotIn('SECRET TOOL',json.dumps(row))
  self.add(type='assistant',message={'role':'assistant','content':[{'type':'thinking','thinking':'HIDDEN'}]})
  self.assertNotIn('HIDDEN',json.dumps(self.row()))
  self.add(type='assistant',message={'role':'assistant','content':[{'type':'text','text':'Visible partial answer'}]})
  self.assertEqual(self.row()['activity']['phase'],'writing');self.assertEqual(self.row()['reply'],'')
  self.add(type='assistant',message={'role':'assistant','content':[{'type':'text','text':f'[1top-reply:{RID}]Done[/1top-reply]'}]})
  self.assertEqual(self.row()['reply'],'Done');self.assertIsNone(self.row()['activity'])
 def test_turn_end_stops_indicator_even_with_background_shell(self):
  self.start();self.add(type='api-request');self.assertIsNotNone(self.row()['activity'])
  self.add(type='system',subtype='turn_duration');self.assertIsNone(self.row()['activity'])
  self.add(type='api-request');self.assertIsNone(self.row()['activity'])
 def test_idle_and_unrelated_new_input_stop_indicator(self):
  self.start();self.add(type='api-request');self.assertIsNotNone(self.row()['activity'])
  self.spec['status']='idle';self.assertIsNone(self.row()['activity']);self.spec['status']='working'
  self.add(type='user',message={'role':'user','content':'Another request'});self.assertIsNone(self.row()['activity'])
 def test_copied_history_before_delivery_is_ignored(self):
  self.add(type='user',timestamp=time.time()-100,message={'role':'user','content':f'[1top-reply:{RID}]'})
  self.add(type='api-request');self.assertIsNone(self.row()['activity'])
 def test_codex_events_follow_the_same_request_scope(self):
  self.spec['kind']='Codex';self.box.records[0]['kind']='Codex'
  self.add(type='event_msg',payload={'type':'user_message','message':f'[1top-reply:{RID}]'})
  self.add(type='event_msg',payload={'type':'task_started'});self.assertEqual(self.row()['activity']['phase'],'responding')
  self.add(type='response_item',payload={'type':'function_call','arguments':'PRIVATE'})
  self.assertEqual(self.row()['activity']['phase'],'working');self.assertNotIn('PRIVATE',json.dumps(self.row()))
  self.add(type='event_msg',payload={'type':'turn_aborted'});self.assertIsNone(self.row()['activity'])
 def test_aside_milliseconds_and_actual_turn_lifecycle(self):
  self.spec['kind']='Aside';self.box.records[0]['kind']='Aside'
  def event(**record):self.add(timestamp=time.time()*1000,**record)
  event(role='turn-lifecycle',event='started');self.assertIsNone(self.row()['activity'])
  event(role='user',content=f'[1top-reply:{RID}]');self.assertIsNone(self.row()['activity'])
  event(role='turn-lifecycle',event='started');self.assertEqual(self.row()['activity']['phase'],'responding')
  event(role='assistant',content=[{'type':'thinking','thinking':'PRIVATE'},{'type':'toolCall','arguments':{'secret':'PRIVATE'}}])
  row=self.row();self.assertEqual(row['activity']['phase'],'working');self.assertNotIn('PRIVATE',json.dumps(row))
  self.assertLess(abs(row['activity']['observed_at']-time.time()),2)
  event(role='turn-lifecycle',event='final-started');self.assertEqual(self.row()['activity']['phase'],'writing')
  event(role='turn-lifecycle',event='finished');self.assertIsNone(self.row()['activity'])
  event(role='assistant',content=[{'type':'text','text':'Late text'}]);self.assertIsNone(self.row()['activity'])
 def test_aside_copied_history_is_not_current_activity(self):
  self.spec['kind']='Aside';self.box.records[0]['kind']='Aside'
  self.add(timestamp=(time.time()-100)*1000,role='user',content=f'[1top-reply:{RID}]')
  self.add(timestamp=time.time()*1000,role='assistant',content=[{'type':'toolCall'}])
  self.assertIsNone(self.row()['activity'])
