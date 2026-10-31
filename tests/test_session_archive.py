import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from onetop import session_archive as archive


class SessionArchiveTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER,model TEXT,cwd TEXT)')
        self.db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)',[
            (900,'ended','Codex',2,3,4,5,'old-model','/private/old-project'),
            (950,'ended','Codex',10,0,0,0,'new-model','/private/project'),
            (990,'live','Claude',1,0,0,0,'claude','/private/live'),
            (1001,'future','Codex',999,0,0,0,'future','/private/future')])
        self.state={'updated':1000,'started':0,'sessions':[{'id':'live'}]}

    def test_identity_survives_restart_disappearance_and_rename(self):
        archive.remember(self.db,[{'id':'ended','kind':'Codex','title':'Thread','project':'project','model':'new-model',
            'orca_terminal':{'title':'Named terminal'},'control_key':'SECRET','prompt':'PRIVATE'}],950)
        archive.remember(self.db,[],1000)
        data=archive.response(self.db,self.state)
        row=data['sessions'][0]
        self.assertEqual((row['id'],row['title'],row['project'],row['app']),('ended','Named terminal','project','Orca'))
        self.assertFalse(row['listed']);self.assertEqual(row['tokens'],[12,3,4,5])
        self.assertEqual({m['model'] for m in row['models']},{'old-model','new-model'})
        self.assertNotIn('control_key',json.dumps(data));self.assertNotIn('PRIVATE',json.dumps(data))
        self.assertNotIn('/private',json.dumps(data))

    def test_recover_closed_codex_aside_and_claude_titles(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp); codex=home/'.codex';codex.mkdir()
            with sqlite3.connect(codex/'state_5.sqlite') as db:
                db.execute('CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,thread_name TEXT)')
                db.execute('INSERT INTO threads VALUES(?,?,?,?)',('ended','First title','/private/project','Renamed thread'))
            p=home/'.claude/projects/p';p.mkdir(parents=True)
            (p/'sessions-index.json').write_text(json.dumps({'entries':[{'sessionId':'live','summary':'Claude task','projectPath':'/private/live','firstPrompt':'PRIVATE'}]}))
            self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)',(990,'aside:0:a','Aside',9,0,0,0,'model','/private/project'))
            aside=home/'.aside/u/0';aside.mkdir(parents=True)
            with sqlite3.connect(aside/'state.db') as db:
                db.execute('CREATE TABLE sessions(id,title,cwd,incognito,ephemeral,archived_at)')
                db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?)',('a','Archived Aside task','/private/project',0,0,900))
            archive.recover(self.db,home)
            rows={s['id']:s for s in archive.response(self.db,self.state)['sessions']}
            self.assertEqual(rows['ended']['title'],'Renamed thread')
            self.assertEqual(rows['live']['title'],'Claude task')
            self.assertEqual(rows['aside:0:a']['title'],'Archived Aside task')
            self.assertNotIn('PRIVATE',json.dumps(rows))

    def test_pages_reconcile_and_custom_ranges_exclude_future(self):
        for period in ('10m','custom:600','all'):
            first=archive.response(self.db,self.state,period,0,1)
            second=archive.response(self.db,self.state,period,first['next_offset'],1)
            self.assertEqual(first['session_count'],2);self.assertIsNone(second['next_offset'])
            self.assertEqual([a+b for a,b in zip(first['sessions'][0]['tokens'],second['sessions'][0]['tokens'])],first['tokens'])
        for offset,limit in [(-1,1),(0,201),(0,0),(True,10)]:
            with self.assertRaises(ValueError):archive.response(self.db,self.state,offset=offset,limit=limit)

    def test_unrecoverable_title_retains_real_id_project_and_models(self):
        with tempfile.TemporaryDirectory() as tmp:archive.recover(self.db,Path(tmp))
        row=archive.response(self.db,self.state)['sessions'][0]
        self.assertEqual(row['id'],'ended');self.assertIsNone(row['title'])
        self.assertEqual(row['project'],'project');self.assertEqual(row['model'],'new-model')


if __name__=='__main__':unittest.main()
