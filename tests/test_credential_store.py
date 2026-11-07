import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch,Mock

from onetop import credential_store as store
from onetop.claude_profiles import CredentialError


class CredentialStoreTests(unittest.TestCase):
    def setUp(self):
        self.root=Path('/tmp/test-profile');self.key='claude:verified'
        for name,value in [('helper',Path('/private/stable-helper')),('account_key',self.key)]:
            p=patch.object(store,name,return_value=value);p.start();self.addCleanup(p.stop)

    def test_read_never_authorizes_and_binds_saved_account(self):
        data={'account_id':self.key,'document':{'claudeAiOauth':{'accessToken':'test-secret-token'}}}
        with patch.object(store.subprocess,'run',return_value=Mock(returncode=0,stdout=json.dumps(data).encode())) as run:
            self.assertEqual(store.enrolled_document(self.root),data['document'])
        self.assertEqual(run.call_args.args[0][1],'get')
        self.assertNotIn('test-secret-token',str(run.call_args.args));self.assertEqual(run.call_args.kwargs['timeout'],8)
        data['account_id']='claude:other'
        with patch.object(store.subprocess,'run',return_value=Mock(returncode=0,stdout=json.dumps(data).encode())):
            self.assertIsNone(store.enrolled_document(self.root))

    def test_authorization_is_one_explicit_call_without_retry(self):
        import contextlib
        with patch('onetop.claude_profiles.managed',return_value=True),patch('onetop.claude_profiles.refresh_lock',return_value=contextlib.nullcontext()),patch.object(store,'install_helper',return_value=Path('/stable')),patch.object(store.subprocess,'run',return_value=Mock(returncode=1,stdout=b'{"error":"denied"}')) as run:
            with self.assertRaises(CredentialError):store.authorize(self.root)
        run.assert_called_once();self.assertEqual(run.call_args.args[0][1],'authorize')

    def test_background_failure_is_not_retried_interactively(self):
        with patch.object(store.subprocess,'run',side_effect=subprocess.TimeoutExpired('get',8)) as run:
            with self.assertRaises(CredentialError):store.enrolled_document(self.root)
        run.assert_called_once();self.assertEqual(run.call_args.args[0][1],'get')
        with self.assertRaises(CredentialError):store.invoke(self.root,'get',interactive=True)
        with self.assertRaises(CredentialError):store.invoke(self.root,'authorize')

    def test_refresh_write_stays_on_stdin_without_ui(self):
        with patch.object(store.subprocess,'run',return_value=Mock(returncode=0,stdout=b'{"ok":true}')) as run:
            store.save_enrolled(self.root,{'claudeAiOauth':{'accessToken':'test-secret-token'}})
        self.assertEqual(run.call_args.args[0][1],'set');self.assertNotIn('test-secret-token',str(run.call_args.args))
        self.assertIn(b'test-secret-token',run.call_args.kwargs['input'])

    def test_existing_helper_is_preserved(self):
        with patch.object(store.shutil,'copyfileobj') as copy:
            self.assertEqual(store.install_helper(),Path('/private/stable-helper'))
        copy.assert_not_called()

    def test_local_account_action_selects_only_matching_managed_profile(self):
        from onetop.account_login import AccountLogin
        from onetop.accounts import identity
        from onetop.controls import ActionError
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'claude/profile';root.mkdir(parents=True)
            (root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'a','organizationUuid':'org'}}))
            login=AccountLogin(Path(directory));key=identity('Claude','a','org')
            with patch.object(store,'authorize',return_value={'ok':True}) as authorize:
                login.authorize_claude(key);authorize.assert_called_once_with(root)
                with login.authorization_lock,self.assertRaises(ActionError):login.authorize_claude(key)
                with self.assertRaises(ActionError):login.authorize_claude(identity('Claude','other','org'))
                self.assertEqual(authorize.call_count,1)
