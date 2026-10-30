"""Local conversations use the guarded API and collector even without a relay."""
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

from onetop.controls import ActionError, Controller
from onetop.server import Collector, DashboardHTTPServer, Handler


class LocalConversationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        path = Path(self.tmp.name) / 'session.jsonl'
        path.write_text('')
        self.spec = dict(id='fixture', kind='Claude', path=str(path), status='idle',
                         input_verified=True, control_key='key', pids=[123],
                         orca_terminal={'handle': 'test-only', 'title': 'Fixture'})
        self.collector = Collector.__new__(Collector)
        self.collector.lock = threading.Lock()
        self.collector.snapshot = {'updated': time.time(), 'sessions': [self.spec]}
        fresh = Mock(specs=[self.spec])
        self.controller = Controller(self.collector, lambda: fresh, Path(self.tmp.name) / 'controls.json')
        self.collector.controller = self.controller
        self.server = DashboardHTTPServer(('127.0.0.1', 0), Handler)
        self.server.collector = self.collector
        self.server.controller = self.controller
        self.server.action_token = 'test-token'
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(5)

    def post(self, route, payload, headers=None):
        request = urllib.request.Request(self.origin + route, data=json.dumps(payload).encode(), headers={
            'Content-Type': 'application/json', 'Origin': self.origin,
            'X-Monitor-Token': 'test-token', **(headers or {})})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_mailbox_requires_same_origin_and_token(self):
        for headers in [{'Origin': 'https://untrusted.test'}, {'X-Monitor-Token': 'wrong'}, {'Origin': ''}]:
            with patch.object(self.controller, 'read_mailbox') as read:
                self.assertEqual(self.post('/api/mailbox', {'session_id': 'fixture', 'control_key': 'key'}, headers)[0], 403)
                read.assert_not_called()
        rows = [{'id': str(uuid.uuid4()), 'status': 'replied', 'reply': 'Fixture answer'}]
        with patch.object(self.controller, 'read_mailbox', return_value=rows) as read:
            self.assertEqual(self.post('/api/mailbox', {'session_id': 'fixture', 'control_key': 'key'}),
                             (200, {'ok': True, 'messages': rows}))
            read.assert_called_once_with('fixture', 'key')
        with patch.object(self.controller, 'read_mailbox', side_effect=ActionError('Fixture changed', 409)):
            status, body = self.post('/api/mailbox', {'session_id': 'fixture', 'control_key': 'old-key'})
            self.assertEqual(status, 409)
            self.assertEqual(json.loads(body), {'ok': False, 'message': 'Fixture changed'})

    def test_local_queue_dispatches_on_collector_tick_without_cloudlink(self):
        request_id = str(uuid.uuid4())
        status, result = self.post('/api/action', dict(action='message', session_id='fixture',
            control_key='key', request_id=request_id, prompt='Local fixture only'))
        self.assertEqual(status, 200)
        self.assertTrue(result['queued'])
        self.collector.accounts = Mock()
        self.collector.initialize = Mock()
        self.collector.history = Mock()
        self.collector.collect = Mock()
        class StopLoop(BaseException):
            pass
        with patch.object(self.controller, 'orca', return_value={}) as send, \
             patch('onetop.server.time.sleep', side_effect=StopLoop):
            with self.assertRaises(StopLoop):
                self.collector.loop()
        self.assertEqual(send.call_count, 1)
        self.assertIn(request_id, send.call_args.args[4])
        status, result = self.post('/api/mailbox', {'session_id': 'fixture', 'control_key': 'key'})
        self.assertEqual(status, 200)
        self.assertEqual([(m['id'], m['status']) for m in result['messages']], [(request_id, 'awaiting_reply')])

    def test_all_shared_dashboard_assets_are_served(self):
        for path, mime in [('conversation.js', 'application/javascript'), ('quick.html', 'text/html'),
                           ('quick.js', 'application/javascript'), ('quick.css', 'text/css'),
                           ('history.js', 'application/javascript')]:
            with urllib.request.urlopen(self.origin + '/' + path) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.headers['Content-Type'].startswith(mime))
                self.assertGreater(len(response.read()), 100)


if __name__ == '__main__':
    unittest.main()
