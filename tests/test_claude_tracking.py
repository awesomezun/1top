import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from onetop.accounts import AccountQuotaSampler, claude_credentials, identity
from onetop.claude_profiles import CredentialError, refresh_managed, refresh_lock
from onetop.discovery import registry_status, claude_transcript
from onetop.server import Collector


class ClaudeTrackingTests(unittest.TestCase):
    def test_reported_states_do_not_depend_on_token_activity(self):
        self.assertEqual([registry_status({'status':s}) for s in ('busy','shell','idle','waiting')],
                         ['working','working','idle','waiting'])
        self.assertEqual(registry_status({}), 'unknown')

    def test_profile_scoped_transcripts_and_ambiguity(self):
        with tempfile.TemporaryDirectory() as d:
            roots=[Path(d)/'Application Support/a',Path(d)/'b']
            for root in roots:
                (root/'projects/project').mkdir(parents=True)
                (root/'projects/project/sid.jsonl').write_text('{}\n')
            self.assertEqual(claude_transcript(roots[1],'sid'),str(roots[1]/'projects/project/sid.jsonl'))
            (roots[1]/'projects/duplicate').mkdir()
            (roots[1]/'projects/duplicate/sid.jsonl').write_text('{}\n')
            self.assertIsNone(claude_transcript(roots[1],'sid'))
            self.assertIsNone(claude_transcript(roots[0],'../sid'))

    def test_process_metadata_preserves_spaces_without_exporting_secrets(self):
        env={'CLAUDE_CONFIG_DIR':'/Users/test/Application Support/profile',
             'ORCA_TAB_ID':'tab','ANTHROPIC_API_KEY':'secret'}
        with patch('onetop.server.psutil.Process') as process:
            process.return_value.environ.return_value=env
            value=Collector().metadata({'pid':123,'started':'now','birth':1})
        self.assertEqual(value['config_dir'],env['CLAUDE_CONFIG_DIR'])
        self.assertNotIn('secret',json.dumps(value))


class ClaudeRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name)/'accounts'
        self.root=self.parent/'claude/profile';self.root.mkdir(parents=True)
        self.creds={'accessToken':'old-access','refreshToken':'old-refresh','expiresAt':1,'subscriptionType':'max','scopes':['user:profile']}
        (self.root/'.credentials.json').write_text(json.dumps({'claudeAiOauth':self.creds,'other':'preserve'}))
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'a','organizationUuid':'org'}}))
        for name,value in [('onetop.claude_profiles.managed_profiles_dir',self.parent),('onetop.claude_profiles.keychain_document',None),('onetop.accounts.keychain_document',None)]:
            p=patch(name,return_value=value);p.start();self.addCleanup(p.stop)
        self.response={'access_token':'renewed-access','refresh_token':'renewed-refresh','expires_in':3600,'scope':'user:profile'}

    def test_refresh_rotation_persists_and_keeps_other_fields(self):
        with patch('onetop.claude_profiles.refresh_request',return_value=self.response) as request:
            result=refresh_managed(self.root)
            self.assertEqual(result['refreshToken'],'renewed-refresh')
            self.assertEqual(claude_credentials(self.root),result)
            self.assertEqual(json.loads((self.root/'.credentials.json').read_text())['other'],'preserve')
            if os.name!='nt':self.assertEqual((self.root/'.credentials.json').stat().st_mode & 0o777,0o600)
            refresh_managed(self.root);request.assert_called_once()

    def test_default_or_foreign_profile_is_never_refreshed(self):
        with patch('onetop.claude_profiles.refresh_request') as request:
            with self.assertRaises(CredentialError):refresh_managed(Path.home()/'.claude')
            request.assert_not_called()

    def test_account_switch_during_refresh_does_not_write(self):
        def reply(_):
            (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'b'}}))
            return self.response
        with patch('onetop.claude_profiles.refresh_request',side_effect=reply):
            with self.assertRaisesRegex(CredentialError,'account_changed'):refresh_managed(self.root)
        self.assertEqual(claude_credentials(self.root),self.creds)

    def test_concurrent_refresh_does_not_consume_same_refresh_token(self):
        with refresh_lock(self.root),patch('onetop.claude_profiles.refresh_request') as request:
            with self.assertRaises(CredentialError):refresh_managed(self.root)
            request.assert_not_called()

    def test_expired_account_is_refreshed_before_usage_query(self):
        with patch('onetop.claude_profiles.refresh_request',return_value=self.response),patch('onetop.accounts.claude_usage',return_value={'seven_day':{'utilization':18}}) as usage:
            row=AccountQuotaSampler().claude(self.root,time.time())
        usage.assert_called_once_with('renewed-access')
        self.assertFalse(row['stale']);self.assertEqual(row['windows'][1]['pct'],18)

    def test_failure_reason_and_last_success_survive_without_zero_fabrication(self):
        sampler=AccountQuotaSampler();key=identity('Claude','a','org')
        sampler.cached[key]={'updated':10,'windows':[{'label':'주간','pct':18,'reset':time.time()+300}]}
        with patch('onetop.accounts.refresh_managed',side_effect=CredentialError('login_required')) as refresh:
            row=sampler.claude(self.root,100);sampler.claude(self.root,200)
        refresh.assert_called_once()
        self.assertEqual(row['status'],'login_required');self.assertTrue(row['stale'])
        self.assertEqual(row['windows'][0]['pct'],18)
        self.assertNotIn('old-refresh',json.dumps(row))

    def test_locked_keychain_is_not_misreported_as_missing_login(self):
        with patch('onetop.accounts.claude_credentials',side_effect=CredentialError('credential_store_unavailable')):
            row=AccountQuotaSampler().claude(self.root,time.time())
        self.assertEqual(row['status'],'credential_store_unavailable')
        self.assertTrue(all(w['pct'] is None for w in row['windows']))

    def test_keychain_refresh_keeps_secrets_out_of_subprocess_arguments(self):
        doc={'claudeAiOauth':self.creds,'other':'preserve'}
        with patch('onetop.claude_profiles.refresh_request',return_value=self.response),patch('onetop.claude_profiles.keychain_document',return_value=doc),patch('onetop.claude_profiles.save_keychain') as save:
            refresh_managed(self.root)
        self.assertEqual(save.call_args.args[1]['other'],'preserve')
        self.assertEqual(save.call_args.args[1]['claudeAiOauth']['accessToken'],'renewed-access')


if __name__=='__main__':unittest.main()
