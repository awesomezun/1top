import hashlib
import json
import os
import shlex
import subprocess
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from onetop.account_login import AccountLogin, login_script
from onetop.accounts import claude_credentials, profile_roots
from onetop.controls import ActionError


class EnrollmentTests(unittest.TestCase):
    def test_login_endpoint_requires_origin_and_token_before_launching(self):
        from onetop.server import Handler
        from unittest.mock import Mock
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        server.action_token='test-token';server.account_login=Mock()
        server.account_login.start.return_value={'message':'opened'}
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        def post(origin,token):
            request=urllib.request.Request(url+'/api/accounts/login',data=b'{"kind":"Codex"}',headers={
                'Origin':origin,'X-Monitor-Token':token,'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(request) as response:return response.status
            except urllib.error.HTTPError as error:
                status=error.code;error.close();return status
        try:
            self.assertEqual(post('https://example.com','test-token'),403)
            self.assertEqual(post(url,'wrong'),403)
            server.account_login.start.assert_not_called()
            self.assertEqual(post(url,'test-token'),200)
            server.account_login.start.assert_called_once_with('Codex')
        finally:server.shutdown();server.server_close();thread.join()

    def test_script_keeps_special_characters_literal_and_drops_inherited_keys(self):
        root = Path("/tmp/account $(touch BAD) 'quoted'")
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY':'PRIVATE', 'OPENAI_API_KEY':'PRIVATE'}):
            text = login_script('Claude', '/tmp/cli space/claude', root)
        self.assertNotIn('PRIVATE', text)
        args = shlex.split(text.splitlines()[-1])
        self.assertEqual(args[:2], ['/usr/bin/env','-i'])
        self.assertIn('CLAUDE_CONFIG_DIR='+str(root), args)
        self.assertEqual(args[-4:], ['/tmp/cli space/claude','auth','login','--claudeai'])
        self.assertEqual(shlex.split(text.splitlines()[2]), ['cd',str(root)])

    def test_new_login_gets_private_profile_without_changing_default_account(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d); old = data/'auth.json'; old.write_text('original')
            manager = AccountLogin(data/'accounts')
            with patch('onetop.account_login.executable',return_value='/tmp/codex'), patch('onetop.account_login.subprocess.run') as run:
                manager.start('Codex')
            scripts = list((data/'accounts/codex').glob('*/*.command'))
            self.assertEqual(len(scripts),1)
            self.assertEqual(old.read_text(),'original')
            self.assertEqual(scripts[0].stat().st_mode & 0o777,0o700)
            self.assertEqual(scripts[0].parent.stat().st_mode & 0o777,0o700)
            self.assertIn('CODEX_HOME='+str(scripts[0].parent),shlex.split(scripts[0].read_text().splitlines()[-1]))
            run.assert_called_once_with(['/usr/bin/open','-a','Terminal',str(scripts[0])],check=True,timeout=8,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            with patch('onetop.account_login.executable',return_value='/tmp/codex'), self.assertRaises(ActionError):
                manager.start('Codex')

    def test_invalid_kind_and_missing_cli_do_not_launch(self):
        with patch('onetop.account_login.subprocess.run') as run:
            with self.assertRaises(ActionError):AccountLogin().start('arbitrary-command')
            with patch('onetop.account_login.executable',return_value=None), self.assertRaises(ActionError):AccountLogin().start('Codex')
            run.assert_not_called()

    def test_older_claude_is_blocked_before_profile_creation(self):
        with tempfile.TemporaryDirectory() as d, patch('onetop.account_login.executable',return_value='/tmp/claude'), patch('onetop.account_login.subprocess.run',return_value=subprocess.CompletedProcess([],0,'2.0.0','')):
            target=Path(d)/'accounts'
            with self.assertRaises(ActionError):AccountLogin(target).start('Claude')
            self.assertFalse(target.exists())

    def test_managed_profiles_are_discovered_after_login_process_exits(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'ONETOP_DATA':d}), patch('onetop.accounts.psutil.process_iter',return_value=[]):
            profile=Path(d)/'accounts/codex/profile';profile.mkdir(parents=True)
            self.assertIn(('Codex',profile),profile_roots(Path(d)/'home'))

    def test_keychain_lookup_is_scoped_and_never_enumerates(self):
        from onetop.claude_profiles import keychain_document, service_name
        with tempfile.TemporaryDirectory() as d, patch('onetop.claude_profiles._keychain_operation') as query, patch('subprocess.run') as run:
            root=Path(d)
            query.return_value=json.dumps({'claudeAiOauth':{'accessToken':'private'}}).encode()
            with patch('onetop.claude_profiles.os.name','posix'), patch('onetop.claude_profiles.os.uname') as uname:
                uname.return_value.sysname='Darwin'
                self.assertEqual(keychain_document(root)['claudeAiOauth']['accessToken'],'private')
            self.assertEqual(service_name(root),'Claude Code-credentials-'+hashlib.sha256(str(root).encode()).hexdigest()[:8])
            query.assert_called_once_with(root)
            run.assert_not_called()

    def test_missing_keychain_stays_unknown(self):
        with tempfile.TemporaryDirectory() as d, patch('onetop.accounts.keychain_document',return_value=None):
            self.assertEqual(claude_credentials(Path(d)),{})
