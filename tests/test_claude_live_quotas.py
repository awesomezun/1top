import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from onetop.accounts import AccountQuotaSampler, identity
from onetop.claude_profiles import CredentialError


class ClaudeLiveQuotaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.key=identity('Claude','account','organization')
        self.write_account('account');self.sampler=AccountQuotaSampler()
        self.credentials={'accessToken':'private-access','expiresAt':3000*1000}
        self.usage={'five_hour':{'utilization':5,'resets_at':2000},'seven_day':{'utilization':32,'resets_at':9000}}
        for name,value in [('claude_credentials',self.credentials),('claude_identity',self.key),('claude_usage',self.usage),('claude_statusline_report',None)]:
            p=patch('onetop.accounts.'+name,return_value=value);setattr(self,name,p.start());self.addCleanup(p.stop)

    def write_account(self,account):
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':account,'organizationUuid':'organization'}}))

    def test_idle_account_fetches_verified_provider_limits(self):
        row=self.sampler.claude_live(self.root,1000)
        self.assertFalse(row['stale']);self.assertEqual(row['source'],'claude_oauth')
        self.assertEqual([w['pct'] for w in row['windows']],[5,32])
        self.assertNotIn('private-access',json.dumps(row))
        self.sampler.cached[self.key]=row
        self.sampler.claude_live(self.root,1100);self.claude_usage.assert_called_once()
        self.sampler.claude_live(self.root,1120)
        self.assertEqual(self.claude_usage.call_count,2);self.claude_identity.assert_called_once()

    def test_current_statusline_avoids_provider_requests(self):
        self.claude_statusline_report.return_value={'windows':[{'label':'주간','pct':20,'reset':9000}],
            'updated':980,'source':'claude_statusline','verified_activity':True}
        row=self.sampler.claude_live(self.root,1000)
        self.assertFalse(row['stale']);self.claude_credentials.assert_not_called();self.claude_usage.assert_not_called()

    def test_wrong_token_account_is_not_used(self):
        self.claude_identity.return_value=identity('Claude','other','organization')
        row=self.sampler.claude_live(self.root,1000)
        self.assertEqual(row['status'],'account_changed');self.claude_usage.assert_not_called()
        self.assertTrue(all(w['pct'] is None for w in row['windows']))

    def test_switch_during_response_is_discarded(self):
        def reply(token):self.write_account('other');return self.usage
        self.claude_usage.side_effect=reply
        self.assertIsNone(self.sampler.claude_live(self.root,1000))

    def test_keychain_failure_keeps_last_measurement_and_reason(self):
        self.sampler.cached[self.key]={'updated':100,'windows':[{'label':'주간','pct':22,'reset':9000}]}
        self.claude_credentials.side_effect=CredentialError('credential_store_unavailable')
        row=self.sampler.claude_live(self.root,1000)
        self.assertEqual(row['windows'][0]['pct'],22);self.assertEqual(row['updated'],100)
        self.assertEqual(row['status'],'credential_store_unavailable');self.assertTrue(row['stale'])
        self.sampler.rows=[row];self.sampler.cached[self.key]=row
        self.sampler.profile_accounts[self.root.resolve()]=(self.key,'Claude',900)
        self.assertEqual(self.sampler.snapshot(1001)[0]['status'],'credential_store_unavailable')

    def test_rate_limit_backoff_is_shared_across_profiles(self):
        self.claude_usage.side_effect=urllib.error.HTTPError('https://api.anthropic.com/api/oauth/usage',429,'rate limit',{'Retry-After':'500'},None)
        row=self.sampler.claude_live(self.root,1000);self.assertEqual(row['status'],'rate_limited')
        other=self.root/'other';other.mkdir();(other/'.claude.json').write_text((self.root/'.claude.json').read_text())
        self.sampler.claude_live(other,1300);self.claude_usage.assert_called_once()

    def test_expired_managed_login_uses_refresh_and_verifies_new_identity(self):
        self.claude_credentials.return_value={**self.credentials,'expiresAt':1}
        with patch('onetop.accounts.refresh_managed',return_value=self.credentials) as refresh:
            self.assertFalse(self.sampler.claude_live(self.root,1000)['stale'])
        refresh.assert_called_once_with(self.root,1000)
        self.claude_identity.assert_called_once_with('private-access')

    def test_empty_provider_response_is_unknown_not_zero(self):
        self.claude_usage.return_value={}
        row=self.sampler.claude_live(self.root,1000)
        self.assertEqual(row['status'],'invalid_response');self.assertTrue(row['stale'])
        self.assertTrue(all(w['pct'] is None for w in row['windows']))

    def test_rejected_unexpired_managed_login_refreshes_once_then_verifies_owner(self):
        rejected=urllib.error.HTTPError('https://api.anthropic.com/api/oauth/usage',401,'rejected',{},None)
        self.claude_usage.side_effect=[rejected,self.usage]
        renewed={**self.credentials,'accessToken':'renewed'}
        with patch('onetop.accounts.managed',return_value=True),patch('onetop.accounts.refresh_managed',return_value=renewed) as refresh:
            row=self.sampler.claude_live(self.root,1000)
        self.assertFalse(row['stale']);refresh.assert_called_once_with(self.root,1000,force=True)
        self.assertEqual(self.claude_identity.call_args.args,('renewed',))

    def test_repeated_401_keeps_last_quota_and_backs_off_without_refresh_loop(self):
        self.sampler.cached[self.key]={'updated':100,'windows':[{'label':'주간','pct':22,'reset':9000}]}
        self.claude_usage.side_effect=lambda _: (_ for _ in ()).throw(urllib.error.HTTPError('https://api.anthropic.com/api/oauth/usage',401,'rejected',{},None))
        with patch('onetop.accounts.managed',return_value=True),patch('onetop.accounts.refresh_managed',return_value=self.credentials) as refresh:
            row=self.sampler.claude_live(self.root,1000);self.sampler.claude_live(self.root,1001)
        refresh.assert_called_once();self.assertEqual(self.claude_usage.call_count,2)
        self.assertEqual(row['windows'][0]['pct'],22);self.assertEqual(row['status'],'login_required')

    def test_failed_old_profile_does_not_skip_enrolled_profile_with_recent_cache(self):
        other=self.root/'enrolled';other.mkdir()
        (other/'.claude.json').write_text((self.root/'.claude.json').read_text())
        self.sampler.cached[self.key]={'updated':850,'windows':[{'label':'주간','pct':22,'reset':9000}],
                                      'source':'claude_oauth'}
        def credentials(root):
            if root==self.root:raise CredentialError('credential_store_unavailable')
            return self.credentials
        self.claude_credentials.side_effect=credentials
        with patch('onetop.accounts.profile_roots',return_value=[('Claude',self.root),('Claude',other)]),patch('onetop.accounts.time.time',return_value=1000):
            self.sampler.sample()
        row=self.sampler.rows[0]
        self.assertEqual(len(self.sampler.rows),1)
        self.assertEqual(row['updated'],1000)
        self.assertEqual([w['pct'] for w in row['windows']],[5,32])
        self.assertNotIn('status',row)
        self.assertEqual(self.claude_credentials.call_count,2)
        self.assertEqual(self.sampler.roots()[other.resolve()][0],self.key)
