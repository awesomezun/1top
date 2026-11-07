import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from onetop.accounts import claude_credentials
from onetop.claude_profiles import (CredentialError, _keychain_query_names,
                                   keychain_document, save_keychain, refresh_managed, _keychain_operation)


class BackgroundKeychainTests(unittest.TestCase):
    def test_legacy_process_ui_is_disabled_before_both_read_and_update(self):
        for document in (None, {'claudeAiOauth': {'accessToken': 'test-only'}}):
            with self.subTest(write=document is not None):
                sec=Mock();sec.SecKeychainSetUserInteractionAllowed.return_value=0
                def perform(lib,root,doc):
                    sec.SecKeychainSetUserInteractionAllowed.assert_called_once_with(False)
                    self.assertIs(lib,sec);self.assertEqual(root,Path('/tmp/profile'))
                    self.assertIs(doc,document)
                    return b'result'
                with patch('onetop.claude_profiles.ctypes.CDLL',return_value=sec),patch('onetop.claude_profiles._keychain_noninteractive_operation',side_effect=perform):
                    self.assertEqual(_keychain_operation(Path('/tmp/profile'),document),b'result')
                # No TRUE restoration that could race a concurrent profile job.
                sec.SecKeychainSetUserInteractionAllowed.assert_called_once_with(False)

    def test_cannot_disable_process_ui_fails_before_any_keychain_operation(self):
        sec=Mock();sec.SecKeychainSetUserInteractionAllowed.return_value=-1
        with patch('onetop.claude_profiles.ctypes.CDLL',return_value=sec),patch('onetop.claude_profiles._keychain_noninteractive_operation') as operation:
            with self.assertRaises(CredentialError):_keychain_operation(Path('/tmp/profile'))
            operation.assert_not_called()

    def test_reads_and_writes_fail_instead_of_requesting_interaction(self):
        for read in (True,False):
            query=dict(_keychain_query_names(read))
            self.assertEqual(query['kSecUseAuthenticationUI'],'kSecUseAuthenticationUIFail')
            self.assertEqual(query['kSecClass'],'kSecClassGenericPassword')
            self.assertNotIn('kSecAttrAccess',query)
        self.assertEqual(dict(_keychain_query_names())['kSecMatchLimit'],'kSecMatchLimitOne')
        self.assertNotIn('kSecReturnData',dict(_keychain_query_names(False)))

    def test_native_denial_is_preserved_without_subprocess_retry(self):
        root=Path('/tmp/profile')
        with patch('onetop.claude_profiles.os.name','posix'), patch('onetop.claude_profiles.os.uname') as uname, patch('onetop.claude_profiles._keychain_operation',side_effect=CredentialError('credential_store_unavailable')), patch('subprocess.run') as run:
            uname.return_value.sysname='Darwin'
            with self.assertRaisesRegex(CredentialError,'credential_store_unavailable'):keychain_document(root)
            with self.assertRaisesRegex(CredentialError,'credential_store_unavailable'):save_keychain(root,{'claudeAiOauth':{}})
            run.assert_not_called()

    def test_expired_file_can_refresh_only_inside_existing_managed_profile(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);creds={'accessToken':'old','refreshToken':'refresh','expiresAt':1}
            (root/'.credentials.json').write_text(json.dumps({'claudeAiOauth':creds}))
            with patch('onetop.accounts.keychain_document',side_effect=CredentialError('credential_store_unavailable')):
                with patch('onetop.accounts.managed',return_value=True):self.assertEqual(claude_credentials(root),creds)
                with patch('onetop.accounts.managed',return_value=False):
                    with self.assertRaises(CredentialError):claude_credentials(root)

    def test_existing_file_refresh_survives_locked_keychain_without_new_plaintext_copy(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d)/'accounts';root=parent/'claude/profile';root.mkdir(parents=True)
            creds={'accessToken':'old','refreshToken':'refresh','expiresAt':1}
            path=root/'.credentials.json';path.write_text(json.dumps({'claudeAiOauth':creds,'other':'keep'}))
            (root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'a'}}))
            denied=CredentialError('credential_store_unavailable')
            with patch('onetop.claude_profiles.managed_profiles_dir',return_value=parent), patch('onetop.accounts.keychain_document',side_effect=denied), patch('onetop.claude_profiles.keychain_document',side_effect=denied), patch('onetop.claude_profiles.refresh_request',return_value={'access_token':'new','refresh_token':'rotated','expires_in':3600}), patch('onetop.claude_profiles.save_keychain') as save:
                renewed=refresh_managed(root)
                self.assertEqual(renewed['refreshToken'],'rotated')
                self.assertEqual(claude_credentials(root),renewed)
                save.assert_not_called()
            saved=json.loads(path.read_text());self.assertEqual(saved['other'],'keep')
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
