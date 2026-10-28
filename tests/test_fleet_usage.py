import sqlite3
import unittest
from onetop.fleet_usage import speed_windows


class FleetUsageTests(unittest.TestCase):
    def test_closed_sessions_and_child_reports_are_counted_once(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE events(t REAL,sid TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER)')
        now = 2_000_000
        db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?)', [
            (now-60,'root',100,20,0,10), (now-30,'child',40,0,0,10),
            (now-3600,'closed',1000,0,0,0), (now+1,'future',99999,0,0,0),
            (now-604801,'old',500,0,0,0)])
        state = {'updated':now,'history_started':now-900000,'period_usage':{'known_kinds':['Codex']},
                 'root_sessions':[{'tokens':[99999,0,0,0]}]}
        rows = {p['key']:p for p in speed_windows(db,state)}
        self.assertEqual(len(rows),19)
        self.assertEqual(rows['1h']['tokens'],180)
        self.assertEqual(rows['custom:604800']['tokens'],1180)
        self.assertEqual(rows['all']['tokens'],1680)
        self.assertEqual(rows['all']['seconds'],900000)
        self.assertTrue(rows['custom:31536000']['partial'])
        self.assertTrue(rows['1h']['known'])
        db.execute('DELETE FROM events')
        state['period_usage']['known_kinds']=[]
        self.assertFalse(speed_windows(db,state)[0]['known'])
        db.close()
