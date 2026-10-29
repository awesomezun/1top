import contextlib
import io
import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from onetop.claude_statusline import capture, sanitize_limits, run, session_binding, MAX_INPUT
from onetop.accounts import identity


class ClaudeStatuslineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.root = self.home/'profile'; self.root.mkdir()
        self.directory = self.home/'reports'
        self.account = {'accountUuid':'account-a','organizationUuid':'org-a','seatTier':'max'}
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':self.account}))
        self.env = patch.dict(os.environ, {'CLAUDE_CONFIG_DIR':''})
        self.env.start();self.addCleanup(self.env.stop)
        self.payload = {'session_id':'session-a','cost':{'total_api_duration_ms':10},
                        'rate_limits':{'five_hour':{'used_percentage':0,'resets_at':2000},
                                       'seven_day':{'used_percentage':12.5,'resets_at':3000}},
                        'private_prompt':'do not persist','accessToken':'do not persist',
                        'transcript_path':'/private/transcript'}

    def save(self,payload=None,now=1000):
        return capture(self.payload if payload is None else payload,self.root,self.directory,now)

    def test_allowlisted_account_report_and_private_file(self):
        path=self.save();value=json.loads(path.read_text())
        self.assertEqual(value['account_id'],identity('Claude','account-a','org-a'))
        self.assertEqual(value['rl']['five_hour']['used_percentage'],0)
        self.assertEqual(value['profile'],str(self.root.resolve()))
        self.assertEqual(value['t'],1000);self.assertEqual(value['observed_at'],1000)
        self.assertEqual(value['source'],'claude_statusline')
        self.assertFalse(value['verified_activity'])
        self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertNotIn('do not persist',path.read_text());self.assertNotIn('transcript',path.read_text())
        self.assertNotIn('account-a',path.read_text());self.assertNotIn('org-a',path.read_text())

    def test_duplicate_callback_does_not_refresh_report_freshness(self):
        path=self.save()
        self.payload['cwd']='/another/cwd';self.payload['prompt_id']='new-prompt-before-response'
        self.save(now=1100);value=json.loads(path.read_text())
        self.assertEqual(value['t'],1000);self.assertEqual(value['observed_at'],1100)
        self.assertFalse(value['verified_activity'])
        self.payload['cost']['total_api_duration_ms']=11
        self.save(now=1200);self.assertEqual(json.loads(path.read_text())['t'],1200)
        self.assertTrue(json.loads(path.read_text())['verified_activity'])
        self.payload['cost']['total_api_duration_ms']=5
        self.save(now=1300);self.assertEqual(json.loads(path.read_text())['t'],1200)
        self.assertTrue(json.loads(path.read_text())['verified_activity'])
        self.payload['rate_limits']['seven_day']['used_percentage']=13
        self.save(now=1400);self.assertEqual(json.loads(path.read_text())['t'],1400)

    def test_absent_invalid_and_expired_limits_are_not_fabricated(self):
        self.assertEqual(sanitize_limits({}),{})
        for invalid in (True,float('nan'),float('inf'),-1,101,'12'):
            with self.subTest(invalid=invalid):
                self.assertEqual(sanitize_limits({'rate_limits':{'five_hour':{'used_percentage':invalid}}}),{})
        self.assertEqual(sanitize_limits({'rate_limits':{'seven_day':{'used_percentage':12,'resets_at':True}}}),{})
        self.assertEqual(sanitize_limits({'rate_limits':{'seven_day':{'used_percentage':12,'resets_at':900}}}),{'seven_day':{'used_percentage':12,'resets_at':900}})
        self.assertIsNone(self.save({'session_id':'s','rate_limits':{}}))
        self.assertFalse(self.directory.exists())

    def test_account_and_session_isolation(self):
        first=self.save();self.payload['session_id']='session-b';second=self.save()
        self.assertNotEqual(first,second)
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'account-b'}}))
        self.assertIsNone(self.save())
        self.assertEqual(json.loads(second.read_text())['account_id'],identity('Claude','account-a','org-a'))
        self.payload['session_id']='new-login-session'
        third=self.save();self.assertNotEqual(third,second)
        self.assertEqual(len(list(self.directory.glob('*.json'))),3)

    def test_account_switch_during_capture_is_discarded(self):
        with patch('onetop.claude_statusline._account',side_effect=[('a','max'),('b','max')]):
            self.assertIsNone(self.save())
        self.assertFalse(list(self.directory.glob('*.json')))

    def test_verified_session_identity_survives_another_profile_login(self):
        self.save();self.payload['cost']['total_api_duration_ms']=20;self.save(now=1100)
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'account-b'}}))
        self.assertIsNone(self.save(now=1200))
        spec={'id':'session-a','kind':'Claude','config_dir':str(self.root)}
        self.assertEqual(session_binding(spec,self.directory,1300),(identity('Claude','account-a','org-a'),1000))
        self.assertIsNone(session_binding({**spec,'id':'unrelated'},self.directory,1300))
        self.payload['cost']['total_api_duration_ms']=30
        self.payload['rate_limits']['seven_day']['used_percentage']=14
        report=json.loads(self.save(now=1400).read_text())
        self.assertEqual(report['account_id'],identity('Claude','account-a','org-a'))
        self.assertEqual(report['t'],1400);self.assertEqual(report['account_since'],1000)

    def test_actual_session_login_switch_requires_new_work_and_known_new_cycle(self):
        import copy
        self.save();self.payload['cost']['total_api_duration_ms']=20;self.save(now=1100)
        (self.root/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'account-b'}}))
        witness=copy.deepcopy(self.payload);witness['session_id']='account-b-session'
        witness['rate_limits']['seven_day']['resets_at']=5000
        self.save(witness,1200);witness['cost']['total_api_duration_ms']=30;self.save(witness,1250)
        self.payload['rate_limits']['seven_day']['resets_at']=5000
        self.assertIsNone(self.save(now=1300))  # no API work after login
        self.payload['cost']['total_api_duration_ms']=40
        path=self.save(now=1400);self.assertIsNotNone(path)
        self.assertFalse(json.loads(path.read_text())['verified_activity'])
        self.payload['cost']['total_api_duration_ms']=50;self.save(now=1500)
        spec={'id':'session-a','kind':'Claude','config_dir':str(self.root)}
        self.assertEqual(session_binding(spec,self.directory,1500),(identity('Claude','account-b',''),1400))

    def test_explicit_cli_profile_environment_wins(self):
        other=self.home/'other';other.mkdir()
        (other/'.claude.json').write_text(json.dumps({'oauthAccount':{'accountUuid':'other'}}))
        with patch.dict(os.environ,{'CLAUDE_CONFIG_DIR':str(other)}):
            value=json.loads(self.save().read_text())
        self.assertEqual(value['profile'],str(other.resolve()))
        self.assertEqual(value['account_id'],identity('Claude','other',''))

    def test_default_profile_metadata_can_exceed_wrapper_config_limit(self):
        default=self.home/'.claude';default.mkdir()
        (self.home/'.claude.json').write_text(json.dumps({'oauthAccount':self.account,'project_data':'x'*70000}))
        with patch('onetop.claude_statusline.Path.home',return_value=self.home):
            result=capture(self.payload,default,self.directory,1000)
        self.assertIsNotNone(result)

    def test_original_renderer_gets_every_byte_including_oversize_input(self):
        if os.name=='nt':self.skipTest('POSIX exact shell roundtrip')
        received=self.home/'original-input';output=self.home/'original-output'
        command=shlex.join([sys.executable,'-c','import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read()); print("original only")',str(received)])+' > '+shlex.quote(str(output))
        config=self.home/'wrapper.json';config.write_text(json.dumps({'profile':str(self.root),'original_command':command}))
        raw=json.dumps(self.payload).encode()+b'\n'
        with patch('onetop.claude_statusline.data_directory',return_value=self.home):
            self.assertEqual(run(config,io.BytesIO(raw)),0)
        self.assertEqual(received.read_bytes(),raw)
        self.assertEqual(output.read_bytes(),b'original only\n')
        large=b'x'*(MAX_INPUT+123)
        with patch('onetop.claude_statusline.capture') as writer:
            self.assertEqual(run(config,io.BytesIO(large)),0);writer.assert_not_called()
        self.assertEqual(received.read_bytes(),large)

    def test_malformed_input_still_reaches_original(self):
        if os.name=='nt':self.skipTest('POSIX exact shell roundtrip')
        received=self.home/'input';config=self.home/'wrapper.json'
        config.write_text(json.dumps({'original_command':'cat > '+shlex.quote(str(received))}))
        self.assertEqual(run(config,io.BytesIO(b'not json\n')),0)
        self.assertEqual(received.read_bytes(),b'not json\n')

    def test_keychain_and_network_are_not_used(self):
        with patch('onetop.accounts.keychain_document',side_effect=AssertionError('must not read credentials')),patch('urllib.request.urlopen',side_effect=AssertionError('must not use network')):
            self.assertIsNotNone(self.save())

    def test_cli_routes_capture_before_loading_collector(self):
        from onetop.cli import main
        with patch.object(sys,'argv',['1top','statusline','--config','/tmp/wrapper.json']),patch('onetop.claude_statusline.run',return_value=0) as writer,patch.dict(sys.modules,{'onetop.server':None}):
            with self.assertRaises(SystemExit) as result:main()
            self.assertEqual(result.exception.code,0)
            writer.assert_called_once_with('/tmp/wrapper.json')

    def test_cli_requires_explicit_wrapper_config(self):
        from onetop.cli import main
        with patch.object(sys,'argv',['1top','statusline']),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as result:main()
            self.assertEqual(result.exception.code,2)

    def test_spec_pins_report_directory_and_rejects_relative_override(self):
        config=self.home/'wrapper.json'
        config.write_text(json.dumps({'profile':str(self.root),'report_directory':str(self.directory),'original_command':''}))
        with patch.dict(os.environ,{'ONETOP_DATA':str(self.home/'wrong')}):
            self.assertEqual(run(config,io.BytesIO(json.dumps(self.payload).encode())),0)
        self.assertEqual(len(list(self.directory.glob('*.json'))),1)
        self.assertFalse((self.home/'wrong').exists())
        config.write_text(json.dumps({'profile':str(self.root),'report_directory':'relative','original_command':''}))
        with patch('onetop.claude_statusline.capture') as writer:
            self.assertEqual(run(config,io.BytesIO(json.dumps(self.payload).encode())),0)
            writer.assert_not_called()

    def test_changed_limits_verify_activity_without_api_counter(self):
        self.payload.pop('cost')
        path=self.save()
        self.assertFalse(json.loads(path.read_text())['verified_activity'])
        self.payload['rate_limits']['seven_day']['used_percentage']=13
        self.save(now=1100)
        self.assertTrue(json.loads(path.read_text())['verified_activity'])
        self.assertEqual(json.loads(path.read_text())['t'],1100)

    def test_effort_is_recorded_without_quota_or_oauth_identity(self):
        (self.root/'.claude.json').unlink()
        payload={'session_id':'api-session','model':{'id':'glm-future'},'effort':{'level':'ultra'},'private_prompt':'never store','accessToken':'never store'}
        self.assertIsNone(self.save(payload))
        files=list((self.directory.parent/'claude-statusline-sessions').glob('*.json'))
        self.assertEqual(len(files),1)
        self.assertEqual(json.loads(files[0].read_text()),{'schema':1,'profile':str(self.root.resolve()),'session_id':'api-session','effort':'ultra','updated':1000,'model':'glm-future'})
        self.assertEqual(files[0].stat().st_mode & 0o777,0o600)
        self.assertNotIn('never store',files[0].read_text())
        self.assertFalse(self.directory.exists())

    def test_effort_absence_or_null_clears_previous_model_setting(self):
        payload={'session_id':'s','model':{'id':'first-model'},'effort':{'level':'high'}}
        self.save(payload)
        path=next((self.directory.parent/'claude-statusline-sessions').glob('*.json'))
        self.assertEqual(json.loads(path.read_text())['effort'],'high')
        payload={'session_id':'s','model':{'id':'second-model'}}
        self.save(payload,now=1100)
        value=json.loads(path.read_text());self.assertIsNone(value['effort']);self.assertEqual(value['model'],'second-model');self.assertEqual(value['updated'],1100)
        payload['effort']={'level':None}
        self.save(payload,now=1200);self.assertIsNone(json.loads(path.read_text())['effort'])

    def test_effort_and_model_literals_are_bounded(self):
        for effort in (True,123,'','x'*65,'high\n',{'level':'max'}):
            self.save({'session_id':'s','effort':{'level':effort},'model':{'id':'x'*257}})
            path=next((self.directory.parent/'claude-statusline-sessions').glob('*.json'))
            value=json.loads(path.read_text());self.assertIsNone(value['effort']);self.assertIsNone(value['model'])

    def test_session_report_uses_pinned_directory_and_preserves_renderer(self):
        if os.name=='nt':self.skipTest('POSIX exact shell roundtrip')
        received=self.home/'raw-input';config=self.home/'wrapper.json'
        pinned=self.home/'custom-state/claude-statusline'
        config.write_text(json.dumps({'profile':str(self.root),'report_directory':str(pinned),'original_command':'cat > '+shlex.quote(str(received))}))
        raw=b'{"session_id":"pinned","effort":{"level":"xhigh"},"model":{"id":"current"}}\n'
        with patch.dict(os.environ,{'ONETOP_DATA':str(self.home/'wrong')}):
            self.assertEqual(run(config,io.BytesIO(raw)),0)
        self.assertEqual(received.read_bytes(),raw)
        path=next((pinned.parent/'claude-statusline-sessions').glob('*.json'))
        self.assertEqual(json.loads(path.read_text())['effort'],'xhigh')
        self.assertFalse((self.home/'wrong').exists())
