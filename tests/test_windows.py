import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from onetop.discovery import cli_kind
from onetop.platform_support import data_directory, lock_instance
from onetop.windows_discovery import explicit_session


class WindowsTests(unittest.TestCase):
    def test_windows_package_entrypoint(self):
        self.assertEqual(cli_kind('node.exe',[r'C:\node.exe',r'C:\npm\node_modules\@anthropic-ai\claude-code\cli.js']),'Claude')
        self.assertEqual(cli_kind('codex.exe',[]),'Codex')
        self.assertIsNone(cli_kind('node.exe',['node','app.js','@openai/codex']))

    def test_session_requires_explicit_id_not_directory_or_prompt(self):
        sid='12345678-1234-1234-1234-123456789abc'
        self.assertEqual(explicit_session(['codex','resume',sid]),sid)
        self.assertEqual(explicit_session(['claude','--session-id='+sid]),sid)
        self.assertIsNone(explicit_session(['codex','--prompt',sid]))
        self.assertIsNone(explicit_session(['codex','resume','latest']))

    def test_windows_data_location(self):
        with patch('platform.system',return_value='Windows'),patch.dict(os.environ,{'LOCALAPPDATA':'C:/Users/test/AppData/Local'},clear=True):
            self.assertEqual(str(data_directory()).replace('\\','/'),'C:/Users/test/AppData/Local/1top')

    def test_lock_can_be_acquired_once(self):
        with tempfile.TemporaryDirectory() as root:
            a=(Path(root)/'lock').open('a+');b=(Path(root)/'lock').open('a+')
            try:
                lock_instance(a)
                with self.assertRaises(BlockingIOError):lock_instance(b)
            finally:a.close();b.close()

    def test_unmatched_process_has_no_invented_tokens(self):
        from onetop.windows_discovery import discover
        row={'pid':123,'ppid':1,'kind':'Codex','cwd':'C:/work','birth':100,'app':('Terminal','x'),'tty':'','name':'codex.exe'}
        process=Mock();process.cmdline.return_value=['codex'];process.environ.return_value={};process.open_files.return_value=[]
        collector=Mock()
        with patch('onetop.windows_discovery.inventory',return_value={123:row}),patch('onetop.windows_discovery.psutil.Process',return_value=process):discover(collector)
        self.assertEqual(len(collector.specs),1);self.assertIsNone(collector.specs[0]['path'])
        self.assertFalse(collector.specs[0]['input_verified']);self.assertTrue(collector.specs[0]['control_key'])
