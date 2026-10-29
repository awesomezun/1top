import concurrent.futures
import json
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

from onetop.bridge import CloudLink
from onetop.controls import ActionBusy, ActionError, Controller
from onetop.mailbox import Mailbox


class MessageSequenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.path = self.root/'session.jsonl'; self.path.write_text('')
        self.spec = {'id':'session','kind':'Claude','path':str(self.path),'status':'idle',
                     'input_verified':True,'control_key':'key','pids':[123],
                     'orca_terminal':{'handle':'test','title':'Test'}}
        self.collector = Mock(); self.collector.lock = threading.Lock()
        self.collector.snapshot = {'updated':time.time(),'sessions':[self.spec]}
        self.source = Mock(); self.source.specs = [self.spec]
        self.state = self.root/'controls.json'
        self.ctl = self.controller()

    def controller(self):
        return Controller(self.collector, lambda:self.source, self.state)

    def request(self, text):
        return {'action':'message','session_id':'session','control_key':'key',
                'request_id':str(uuid.uuid4()),'prompt':text}

    def finish_turn(self):
        self.spec.update(status='idle', status_at=time.time()+1)
        self.ctl.decorate(self.collector.snapshot)

    def test_burst_during_control_is_durable_and_fifo_across_restart(self):
        requests = [self.request(f'Message {i}') for i in range(12)]
        self.ctl.lock.acquire()
        try:
            for request in requests:self.assertTrue(self.ctl.execute(request)['queued'])
        finally:self.ctl.lock.release()
        self.ctl = self.controller()
        for request in requests:self.assertTrue(self.ctl.execute(request)['queued'])
        self.assertEqual(len(self.ctl.mailbox.records),12)
        sent = []
        def send(*args):
            sent.append(args[args.index('--text')+1]); return {}
        with patch.object(self.ctl,'orca',side_effect=send):
            for request in requests:
                self.ctl.flush_mailbox()
                self.ctl.flush_mailbox()  # No second input before the new turn is observed.
                self.assertIn(request['request_id'],sent[-1])
                self.finish_turn()
            self.ctl.flush_mailbox()
        self.assertEqual(len(sent),12)
        self.assertEqual([r['status'] for r in self.ctl.mailbox.records],['awaiting_reply']*12)
        restored = self.controller()
        with patch.object(restored,'orca') as send:
            for request in requests:self.assertFalse(restored.execute(request)['queued'])
            restored.flush_mailbox();send.assert_not_called()
        with self.assertRaises(ActionError):restored.execute({**requests[0],'prompt':'Different content'})

    def test_parallel_admission_does_not_drop_messages_or_corrupt_storage(self):
        requests = [self.request(str(i)) for i in range(30)]
        self.ctl.lock.acquire()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(self.ctl.execute,requests+requests))
        finally:self.ctl.lock.release()
        self.assertTrue(all(r['queued'] for r in results))
        self.assertEqual({r['id'] for r in Mailbox(self.ctl.mailbox.path).records},
                         {r['request_id'] for r in requests})

    def test_busy_session_does_not_starve_another_session(self):
        self.spec['status']='working'
        for i in range(6):self.ctl.execute(self.request(str(i)))
        other = {**self.spec,'id':'other','status':'idle'}
        self.collector.snapshot['sessions'].append(other);self.source.specs.append(other)
        request={**self.request('Other'),'session_id':'other'};self.ctl.execute(request)
        with patch.object(self.ctl,'orca',return_value={}) as send:
            self.ctl.flush_mailbox()
        self.assertEqual(send.call_count,1);self.assertIn(request['request_id'],send.call_args.args[4])
        self.assertEqual(len(self.ctl.mailbox.queued()),6)

    def test_queue_limit_refuses_new_message_without_erasing_accepted_ones(self):
        first = self.request('First');self.ctl.execute(first)
        box=self.ctl.mailbox
        with box.lock:
            for i in range(220):
                box.records.append({'id':str(uuid.uuid4()),'session_id':'old','status':'replied','text':'old'})
            box.save()
        self.assertEqual(box.records[0]['id'],first['request_id'])
        for i in range(99):self.ctl.execute(self.request(str(i)))
        with self.assertRaisesRegex(ActionError,'100 pending'):self.ctl.execute(self.request('Too many'))
        self.assertEqual(len(box.queued()),100)
        self.assertEqual(Mailbox(box.path).queued()[0]['id'],first['request_id'])

    def test_replaced_or_stale_target_is_not_accepted(self):
        with self.assertRaises(ActionError):self.ctl.execute({**self.request('Wrong'),'control_key':'replaced'})
        self.collector.snapshot['updated']=time.time()-100
        with self.assertRaises(ActionError):self.ctl.execute(self.request('Stale'))
        self.assertEqual(self.ctl.mailbox.records,[])

    def test_control_start_race_leaves_message_queued_for_a_later_tick(self):
        request=self.request('Keep it');self.ctl.execute(request)
        with patch.object(self.ctl,'execute',side_effect=ActionBusy('Control just started')):
            self.ctl.flush_mailbox()
        self.assertEqual(self.ctl.mailbox.records[0]['status'],'queued')
        with patch.object(self.ctl,'orca',return_value={}) as send:self.ctl.flush_mailbox()
        self.assertEqual(send.call_count,1)

    def test_reply_to_early_message_survives_a_burst_larger_than_display_window(self):
        requests=[self.request(str(i)) for i in range(15)]
        for request in requests:self.ctl.execute(request)
        with patch.object(self.ctl,'orca',return_value={}):self.ctl.flush_mailbox()
        with self.path.open('a') as f:
            f.write(json.dumps({'type':'assistant','message':{'role':'assistant','content':[
                {'type':'text','text':f'[1top-reply:{requests[0]["request_id"]}]First answer[/1top-reply]'}]}})+'\n')
        updates=self.ctl.read_mailbox('session','key')
        first=next(r for r in updates if r['id']==requests[0]['request_id'])
        self.assertEqual(first['reply'],'First answer');self.assertEqual(first['status'],'replied')
        self.assertLessEqual(len(updates),10)
        self.assertEqual(len(Mailbox(self.ctl.mailbox.path).records),15)

    def test_relay_burst_while_control_runs_is_accepted_once_and_survives_reconnect(self):
        link=CloudLink(self.collector,self.ctl,self.root);link.config={'device_id':'device'};link.ws=Mock()
        requests=[{**self.request(str(i)),'device_id':'device','expires_at':time.time()*1000+15000} for i in range(12)]
        link.action_lock.acquire()
        try:
            for request in requests:link.command(request)
        finally:link.action_lock.release()
        self.assertEqual(len(self.ctl.mailbox.queued()),12)
        self.assertTrue(all(json.loads(c.args[0])['ok'] for c in link.ws.send.call_args_list))
        restored=CloudLink(self.collector,self.ctl,self.root);restored.config=link.config;restored.ws=Mock()
        for request in requests:restored.command(request)
        self.assertEqual(len(self.ctl.mailbox.queued()),12)
        self.assertTrue(all(json.loads(c.args[0])['ok'] for c in restored.ws.send.call_args_list))

