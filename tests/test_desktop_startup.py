import json
import os
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from onetop import __version__
from onetop.desktop_startup import CollectorLauncher, StartupError, collector_available, local_json
from onetop.server import Collector, Handler


@contextmanager
def server(handler=Handler):
    http = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    http.collector = Collector()
    http.controller = Mock()
    http.controller.decorate.side_effect = lambda state: state
    http.action_token = 'fixture-action-token'
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        yield http
    finally:
        http.shutdown()
        http.server_close()
        thread.join(3)


class DesktopStartupTests(unittest.TestCase):
    def test_health_connects_before_first_collection_finishes(self):
        with server() as http:
            self.assertFalse(http.collector.snapshot['ready'])
            health = local_json(http.server_port, '/health')
            self.assertEqual(health, {'app': '1top', 'ok': True, 'version': __version__, 'ready': False})
            self.assertTrue(collector_available(http.server_port))
            # A scan may still be pending, or report an error. It must not prevent
            # the desktop from opening the connected local dashboard.
            http.collector.snapshot = {'ready': False, 'error': 'PermissionError', 'sessions': []}
            self.assertTrue(collector_available(http.server_port))
            self.assertFalse(local_json(http.server_port, '/api/state')['ready'])

    def test_loopback_ignores_user_proxy_settings(self):
        with server() as http, patch.dict(os.environ, {
                'http_proxy': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1',
                'HTTPS_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '', 'no_proxy': ''}):
            self.assertTrue(collector_available(http.server_port))
            self.assertEqual(local_json(http.server_port, '/api/state')['version'], __version__)

    def test_does_not_trust_unrelated_service(self):
        class OtherService(BaseHTTPRequestHandler):
            def do_GET(self):
                raw = b'{"ok":true,"version":"3.7.1"}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            def log_message(self, *args):
                pass
        with server(OtherService) as http:
            self.assertFalse(collector_available(http.server_port))

    def test_old_running_collector_is_reused(self):
        state = {'version': '3.7.0', 'sessions': [], 'action_token': 'fixture'}
        with patch('onetop.desktop_startup.local_json', side_effect=[{'ok': True}, state]):
            self.assertTrue(collector_available(18766))

    def test_existing_collector_is_never_owned_or_stopped(self):
        with tempfile.TemporaryDirectory() as root, patch('onetop.desktop_startup.collector_available', return_value=True), \
                patch('onetop.desktop_startup.subprocess.Popen') as popen:
            launcher = CollectorLauncher(18766, Path(root) / '한글 사용자')
            launcher.start(['unused'])
            launcher.stop()
            popen.assert_not_called()
            self.assertIsNone(launcher.child)

    def test_startup_timeout_cleans_up_owned_child_and_can_retry(self):
        process = Mock(pid=101)
        process.poll.return_value = None
        with tempfile.TemporaryDirectory() as root, \
                patch('onetop.desktop_startup.subprocess.Popen', return_value=process), \
                patch('onetop.desktop_startup.collector_available', return_value=False), \
                patch('onetop.desktop_startup.time.monotonic', side_effect=[0, 0, 2]), \
                patch('onetop.desktop_startup.time.sleep'):
            launcher = CollectorLauncher(18766, root)
            with self.assertRaises(StartupError) as raised:
                launcher.start(['fixture'], timeout=1)
            self.assertEqual(raised.exception.code, 'connection_timeout')
            process.terminate.assert_called_once()
            process.wait.assert_called_once()
            self.assertIsNone(launcher.child)
            self.assertIsNone(launcher.output)
            records = [json.loads(line) for line in (Path(root) / 'startup.jsonl').read_text().splitlines()]
            self.assertEqual(records[-1]['event'], 'connection_timeout')
        with tempfile.TemporaryDirectory() as root, \
                patch('onetop.desktop_startup.subprocess.Popen', return_value=process), \
                patch('onetop.desktop_startup.collector_available', side_effect=[False, True]):
            launcher = CollectorLauncher(18766, root)
            launcher.start(['fixture'])
            self.assertIs(launcher.child, process)
            launcher.stop()

    def test_child_exit_is_diagnostic_not_an_unhandled_exception(self):
        process = Mock(pid=101)
        process.poll.return_value = 7
        with tempfile.TemporaryDirectory() as root, \
                patch('onetop.desktop_startup.subprocess.Popen', return_value=process), \
                patch('onetop.desktop_startup.collector_available', return_value=False):
            launcher = CollectorLauncher(18766, root)
            with self.assertRaises(StartupError) as raised:
                launcher.start(['fixture'])
            self.assertEqual(raised.exception.code, 'collector_exited')
            self.assertIn('7', str(raised.exception))
            process.terminate.assert_not_called()
            self.assertIsNone(launcher.child)
            self.assertIsNone(launcher.output)
