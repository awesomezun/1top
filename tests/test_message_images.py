import base64
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from onetop.message_images import decode_images, ImageStore, public_images, MAX_BYTES
from onetop.controls import Controller, ActionError
from onetop.mailbox import Mailbox
from onetop.bridge import CloudLink, export_snapshot

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXZkAAAAASUVORK5CYII='
PHOTO = {'mime':'image/png','data':PNG}
RID = '33333333-3333-4333-8333-333333333333'

class ImageTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.store=ImageStore(self.root/'photos')
 def test_private_files_are_stable_and_not_exposed_in_mailbox(self):
  images=decode_images([PHOTO]); first=self.store.stage(RID,'s',images);again=self.store.stage(RID,'s',images)
  self.assertEqual(first,again);self.assertEqual(len(list(self.store.root.iterdir())),1)
  self.assertEqual(Path(first[0]['_path']).stat().st_mode&0o777,0o600)
  transcript=self.root/'session.jsonl';transcript.write_text('')
  spec={'id':'s','kind':'Claude','path':str(transcript)};box=Mailbox(self.root/'mail.json')
  prompt=box.begin(spec,RID,'Inspect',first)
  self.assertIn(first[0]['_path'],prompt);self.assertIn('1top-reply:',prompt)
  raw=json.dumps(box.read(spec));self.assertNotIn(str(self.root),raw);self.assertNotIn(PNG,raw)
  self.assertEqual(box.read(spec)[0]['attachments'],public_images(images))
 def test_wrong_mime_size_count_or_filename_is_not_used(self):
  for items in [[{'mime':'text/html','data':PNG}],[{'mime':'image/jpeg','data':PNG}], [PHOTO]*4,
                [{'mime':'image/png','data':'?'*20}],[{'mime':'image/png','data':base64.b64encode(b'x'*(MAX_BYTES+1)).decode()}]]:
   with self.subTest(items=len(items)),self.assertRaises(ValueError):decode_images(items)
  images=decode_images([{**PHOTO,'name':'../../bad.sh','path':'/tmp/evil'}]);saved=self.store.stage(RID,'s',images)
  self.assertTrue(Path(saved[0]['_path']).is_relative_to(self.store.root.resolve()));self.assertEqual(saved[0]['name'],'Image 1.png')
 def test_changed_symlink_and_wrong_session_references_fail(self):
  images=self.store.stage(RID,'s',decode_images([PHOTO]));refs=public_images(images);path=Path(images[0]['_path'])
  with self.assertRaises(OSError):self.store.restore(RID,'other',refs)
  path.write_bytes(b'changed')
  with self.assertRaises(ValueError):self.store.restore(RID,'s',refs)
  path.unlink();target=self.root/'private';target.write_bytes(base64.b64decode(PNG));path.symlink_to(target)
  with self.assertRaises(OSError):self.store.restore(RID,'s',refs)
 def test_storage_cap_does_not_reject_idempotent_retry(self):
  images=decode_images([PHOTO]);self.store.stage(RID,'s',images)
  with patch('onetop.message_images.MAX_STORE_BYTES',len(base64.b64decode(PNG))):
   self.store.stage(RID,'s',images)
   with self.assertRaises(ValueError):self.store.stage('44444444-4444-4444-8444-444444444444','s',images)
 def test_queued_photo_survives_restart_and_is_sent_once(self):
  transcript=self.root/'session.jsonl';transcript.write_text('')
  spec={'id':'s','kind':'Claude','path':str(transcript),'status':'working','pids':[10],
        'input_verified':True,'control_key':'key','orca_terminal':{'handle':'test'}}
  collector=Mock();collector.lock=threading.Lock();collector.snapshot={'updated':time.time(),'sessions':[spec]}
  factory=Mock();factory.specs=[spec];state=self.root/'actions.json'
  c=Controller(collector,lambda:factory,state)
  request={'action':'message','session_id':'s','control_key':'key','request_id':RID,'prompt':'Inspect','attachments':[PHOTO]}
  self.assertTrue(c.execute(request)['queued']);self.assertTrue(c.execute(request)['queued'])
  c=Controller(collector,lambda:factory,state);spec['status']='idle'
  with patch.object(c,'orca',return_value={}) as send:
   c.flush_mailbox();c.flush_mailbox()
  self.assertEqual(send.call_count,1)
  prompt=send.call_args.args[send.call_args.args.index('--text')+1]
  self.assertIn('Attached images',prompt);self.assertNotIn(PNG,prompt)
  self.assertEqual(c.mailbox.records[0]['status'],'awaiting_reply')
  self.assertEqual(len(c.mailbox.records[0]['attachments']),1)
 def test_image_capability_requires_identified_supported_session(self):
  p=self.root/'session.jsonl';p.write_text('')
  base={'id':'s','kind':'Claude','path':str(p),'status':'working','input_verified':True,'control_key':'k','orca_terminal':{'handle':'test'}}
  self.assertIn('message_images',export_snapshot({'sessions':[base]})['sessions'][0]['capabilities'])
  self.assertNotIn('message_images',export_snapshot({'sessions':[{**base,'input_verified':False}]})['sessions'][0]['capabilities'])
 def test_bridge_forwards_images_without_putting_them_in_receipts(self):
  ctl=Mock();ctl.execute.return_value={'message':'queued'};link=CloudLink(Mock(),ctl,self.root);link.ws=Mock();link.config={'device_id':'device'}
  data={'request_id':RID,'device_id':'device','action':'message','session_id':'s','control_key':'k','prompt':'Inspect','attachments':[PHOTO],'expires_at':time.time()*1000+5000}
  link.command(data);link.command(data)
  self.assertEqual(ctl.execute.call_count,1);self.assertEqual(ctl.execute.call_args.args[0]['attachments'],[PHOTO])
  self.assertNotIn(PNG,json.dumps(link.receipts))
