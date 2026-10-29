import json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import Mock
from onetop.bridge import CloudLink,export_snapshot,save_private
from onetop.discovery import cli_kind,context,applications,app_from

class BoundaryTests(unittest.TestCase):
 def test_cockpit_exports_clock_aligned_flow_and_private_weekly_evidence(self):
  now=3601
  state={'updated':now,'started':0,'events':[
      {'t':60,'kind':'Claude','fresh':10,'cached':20,'written':30,'output':40},
      {'t':3600,'kind':'Codex','fresh':4}, {'t':3659,'kind':'Claude','fresh':999}],
    'sessions':[{'id':'s','kind':'Claude','tokens':[1,2,3,4], 'root_session_id':'root','parent_session_id':'root',
      'usage':{'rate':10,'weekly_account':'a','weekly_estimate':{'1h':{'used_pp':2,'partial':False,
        'account_id':'a','calibration':{'pp_per_token':.01,'confidence':'early','private':'SECRET'}}}}}],
    'account_quotas':[{'id':'a','kind':'Claude','account_label':'PRIVATE EMAIL'}],
    'weekly_usage':{'accounts':[{'id':'a','periods':{'1h':{'used_pp':2,'observed_seconds':300,'partial':True}},
       'usage_points':[[i,2,5000] for i in range(80)]}]}}
  value=export_snapshot(state);flow=value['flow']['1h']
  self.assertEqual((flow['start'],flow['end'],flow['step'],len(flow['bins'])),(60,3660,60,60))
  self.assertEqual(flow['bins'][0],{'Claude':100});self.assertEqual(flow['bins'][-1],{'Codex':4})
  self.assertEqual(value['flow']['24h']['step'],900);self.assertEqual(len(value['flow']['24h']['bins']),96)
  self.assertEqual(value['account_quotas'][0]['weekly']['1h']['used_pp'],2)
  self.assertEqual(len(value['account_quotas'][0]['usage_points']),60)
  self.assertEqual(value['sessions'][0]['weekly_estimate']['1h']['calibration']['pp_per_token'],.01)
  self.assertEqual(value['sessions'][0]['root_session_id'],'root')
  self.assertNotIn('SECRET',json.dumps(value));self.assertNotIn('PRIVATE EMAIL',json.dumps(value))
 def test_missing_event_history_is_not_reported_as_measured_zero(self):
  self.assertFalse(export_snapshot({})['flow']['1h']['reported'])
 def test_operational_export_omits_goal_prompts_skill_paths_and_raw_events(self):
  state={'operations':{'goals':[{'objective':'PRIVATE GOAL','thread_id':'s','runtime':'Codex','status':'active','tokens_used':5}], 'skills':[{'path':'/private/skill','name':'PRIVATE SKILL'}], 'events':[{'text':'PRIVATE EVENT'}]}}
  value=export_snapshot(state);raw=json.dumps(value)
  self.assertNotIn('PRIVATE',raw);self.assertNotIn('/private',raw)
  self.assertEqual(value['operations']['installed_skills'],1)
  self.assertEqual(value['operations']['goals'][0]['tokens_used'],5)
 def test_orca_current_installation_wins_over_stale_system_launcher(self):
  from unittest.mock import patch
  from onetop.discovery import orca_executable
  with tempfile.TemporaryDirectory() as folder:
   local=Path(folder)/'.local/bin/orca';local.parent.mkdir(parents=True);local.write_text('fixture')
   with patch('onetop.discovery.Path.home',return_value=Path(folder)),patch('onetop.discovery.shutil.which',return_value='/usr/local/bin/orca'),patch.dict('os.environ',{},clear=True):
    self.assertEqual(orca_executable(),str(local))
    with patch.dict('os.environ',{'ORCA_CLI_COMMAND':'/explicit/orca'}):self.assertEqual(orca_executable(),'/explicit/orca')
 def test_confirmed_orca_identity_overrides_detached_terminal_ancestry(self):
  s={'id':'test','kind':'Codex','control_key':'key','project':'fixture','status':'working','location':{'app':'Terminal'},'orca_terminal':{'title':'Named tab'},'input_verified':True,'effort':'xhigh','effort_source':'codex_turn_context','effort_updated':123}
  row=export_snapshot({'sessions':[s]})['sessions'][0]
  self.assertEqual(row['app'],'Orca');self.assertEqual(row['terminal'],'Named tab');self.assertIn('pause',row['capabilities'])
  self.assertEqual(row['effort'],'xhigh');self.assertEqual(row['effort_source'],'codex_turn_context');self.assertEqual(row['effort_updated'],123)
 def test_process_classification_ignores_prompt(self):
  self.assertIsNone(cli_kind('node',['node','index.js','run claude with @openai/codex']))
  self.assertEqual(cli_kind('node',['node','/lib/node_modules/@openai/codex/bin/codex.js']),'Codex')
 def test_parent_app_attribution(self):
  rows={2:{'ppid':1,'app':('',''),'tty':'/dev/ttys000'},1:{'ppid':0,'app':('Cursor','/Applications/Cursor.app')}}
  self.assertEqual(context(2,rows)['app'],'Cursor')
 def test_arbitrary_host_application_does_not_need_a_name_allowlist(self):
  app=app_from('/Applications/Future Workspace.app/Contents/MacOS/workspace')
  rows={2:{'pid':2,'ppid':1,'app':('',''),'tty':''},1:{'pid':1,'ppid':0,'app':app}}
  self.assertEqual(context(2,rows)['app'],'Future Workspace')
  self.assertEqual(applications(rows)[0]['name'],'Future Workspace')
 def test_export_omits_prompt_paths_keys_and_unknown_stays_unknown(self):
  state={'ready':True,'updated':time.time(),'sessions':[{'id':'id','kind':'Gemini','control_key':'key','project':'demo','cwd':'/private/secret','title':'PRIVATE PROMPT','env':{'KEY':'SECRET'},'path':'/private/log','location':{'app':'Cursor','app_path':'/Applications/Cursor.app'},'tokens':None}]}
  data=export_snapshot(state);raw=json.dumps(data)
  for value in ('PRIVATE PROMPT','/private','SECRET','/Applications'):self.assertNotIn(value,raw)
  self.assertIsNone(data['sessions'][0]['tokens']);self.assertNotIn('pause',data['sessions'][0]['capabilities'])
 def test_duplicate_and_expired_remote_commands_do_not_execute(self):
  with tempfile.TemporaryDirectory() as folder:
   ctl=Mock();ctl.execute.return_value={'message':'test'}
   link=CloudLink(Mock(),ctl,Path(folder));link.ws=Mock();link.config={'device_id':'test'}
   data={'request_id':'a'*36,'device_id':'test','action':'terminate','expires_at':time.time()*1000+5000}
   link.command(data);link.command(data);self.assertEqual(ctl.execute.call_count,1)
   link.command({**data,'request_id':'b'*36,'expires_at':1});self.assertEqual(ctl.execute.call_count,1)
   other=CloudLink(Mock(),ctl,Path(folder));other.ws=Mock();other.config=link.config;other.command(data);self.assertEqual(ctl.execute.call_count,1)
 def test_private_config_permissions(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'device.json';save_private(path,{'device_token':'fixture'})
   self.assertEqual(path.stat().st_mode&0o777,0o600)

class ConnectionTests(unittest.TestCase):
 def test_request_identifies_companion_and_handles_plain_error(self):
  import io,urllib.error
  from unittest.mock import patch
  from onetop.bridge import request
  error=urllib.error.HTTPError('https://example.invalid',403,'denied',{},io.BytesIO(b'plain gateway error'))
  with patch('urllib.request.OpenerDirector.open',side_effect=error) as send:
   status,result=request('/test',{})
   self.assertEqual(status,403);self.assertIn('HTTP 403',result['error'])
   self.assertTrue(send.call_args.args[0].headers['User-agent'].startswith('1top/'))

 def test_custom_relay_never_reuses_a_managed_credential(self):
  from onetop.bridge import relay_origin,RELAY
  for value in ['http://relay.example','https://u:p@relay.example','https://relay.example/path','https://relay.example?x=1']:
   with self.assertRaises(ValueError):relay_origin(value)
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);save_private(path/'device.json',{'device_token':'PRIVATE','device_id':'test'})
   managed=CloudLink(Mock(),Mock(),path);self.assertEqual(managed.relay,RELAY)
   own=CloudLink(Mock(),Mock(),path,relay='https://own.workers.dev');self.assertIsNone(own.config)
   self.assertEqual(json.loads((path/'device.json').read_text())['device_token'],'PRIVATE')
 def test_redirects_are_rejected(self):
  from onetop.bridge import NoRedirect
  with self.assertRaises(ValueError):NoRedirect().redirect_request(None,None,None,None,None,None)
