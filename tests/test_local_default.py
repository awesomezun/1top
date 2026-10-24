import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from onetop.cli import main


class LocalDefaultTests(unittest.TestCase):
    def run_cli(self, command, config=None, pair_error=None):
        with tempfile.TemporaryDirectory() as tmp:
            bridge=Mock();bridge.config=config
            if pair_error:bridge.pair.side_effect=pair_error
            with patch('sys.argv',['1top',command]), patch('platform.system',return_value='Darwin'), \
                 patch('onetop.server.DATA',Path(tmp)), patch('onetop.server.Collector'), \
                 patch('onetop.controls.Controller'), patch('http.server.ThreadingHTTPServer'), \
                 patch('onetop.bridge.CloudLink',return_value=bridge), patch('onetop.bridge.open_url') as open_url, \
                 patch('threading.Thread') as thread, patch('time.sleep',side_effect=KeyboardInterrupt), patch('signal.signal'):
                main()
                targets=[c.kwargs.get('target') for c in thread.call_args_list]
                return bridge,open_url.call_args.args[0],targets

    def test_fresh_run_never_pairs_or_starts_remote(self):
        bridge,url,targets=self.run_cli('run')
        bridge.pair.assert_not_called();self.assertNotIn(bridge.run,targets)
        self.assertEqual(url,'http://127.0.0.1:18766')

    def test_existing_opt_in_remains_connected(self):
        bridge,url,targets=self.run_cli('run',{'device_id':'fixture'})
        bridge.pair.assert_not_called();self.assertIn(bridge.run,targets)

    def test_local_mode_ignores_saved_remote_connection(self):
        bridge,url,targets=self.run_cli('local',{'device_id':'fixture'})
        self.assertNotIn(bridge.run,targets)

    def test_remote_failure_keeps_local_dashboard_available(self):
        bridge,url,targets=self.run_cli('connect',pair_error=RuntimeError('denied'))
        self.assertEqual(url,'http://127.0.0.1:18766');self.assertEqual(bridge.status,'Local monitoring')
