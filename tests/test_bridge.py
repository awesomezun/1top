import json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import Mock
from onetop.bridge import CloudLink,export_snapshot,save_private
from onetop.discovery import cli_kind,context,applications,app_from

class BoundaryTests(unittest.TestCase):
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
  s={'id':'test','kind':'Codex','control_key':'key','project':'fixture','status':'working','location':{'app':'Terminal'},'orca_terminal':{'title':'Named tab'},'input_verified':True}
  row=export_snapshot({'sessions':[s]})['sessions'][0]
  self.assertEqual(row['app'],'Orca');self.assertEqual(row['terminal'],'Named tab');self.assertIn('pause',row['capabilities'])
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
  with patch('urllib.request.urlopen',side_effect=error) as send:
   status,result=request('/test',{})
   self.assertEqual(status,403);self.assertIn('HTTP 403',result['error'])
   self.assertTrue(send.call_args.args[0].headers['User-agent'].startswith('1top/'))
