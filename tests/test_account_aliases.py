import json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from onetop.account_aliases import read,apply,set_alias
from onetop.bridge import export_snapshot
from onetop.server import Handler

class AliasTests(unittest.TestCase):
 def test_account_names_persist_without_changing_identity(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'credentials.json').write_text('KEEP')
   self.assertEqual(set_alias(root,'claude:a',' 개인 ',{'claude:a'}),'개인')
   rows=apply([{'id':'claude:a','kind':'Claude'},{'id':'claude:b','kind':'Claude'}],root)
   self.assertEqual([r['alias'] for r in rows],['개인',''])
   self.assertEqual(export_snapshot({'account_quotas':rows})['account_quotas'][0]['alias'],'개인')
   self.assertEqual((root/'credentials.json').read_text(),'KEEP')
   self.assertEqual((root/'account-aliases-v1.json').stat().st_mode&0o777,0o600)
   set_alias(root,'claude:a','',{'claude:a'});self.assertEqual(read(root),{})
 def test_invalid_account_and_labels_do_not_write(self):
  with tempfile.TemporaryDirectory() as folder:
   for aid,alias in [('other','name'),('a','x'*25),('a','x\nname'),('a',None)]:
    with self.assertRaises(ValueError):set_alias(folder,aid,alias,{'a'})
   self.assertFalse((Path(folder)/'account-aliases-v1.json').exists())
 def test_endpoint_requires_local_origin_and_token(self):
  with tempfile.TemporaryDirectory() as folder,patch('onetop.server.DATA',Path(folder)):
   server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.action_token='token'
   server.collector=SimpleNamespace(lock=threading.Lock(),snapshot={'account_quotas':[{'id':'a'}]})
   thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url=f'http://127.0.0.1:{server.server_port}'
   def post(origin,token):
    req=urllib.request.Request(url+'/api/accounts/alias',data=b'{"account_id":"a","alias":"Personal"}',headers={'Content-Type':'application/json','Origin':origin,'X-Monitor-Token':token})
    try:
     with urllib.request.urlopen(req) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:
     code=error.code;error.close();return code,{}
   try:
    self.assertEqual(post('https://wrong.example','token')[0],403);self.assertEqual(post(url,'wrong')[0],403)
    self.assertEqual(read(folder),{})
    self.assertEqual(post(url,'token'),(200,{'ok':True,'alias':'Personal'}))
    self.assertEqual(server.collector.snapshot['account_quotas'][0]['alias'],'Personal')
   finally:server.shutdown();server.server_close();thread.join()
