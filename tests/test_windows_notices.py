import json
import contextlib
import sqlite3
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from onetop.windows_notices import Notices, clipped, set_settings, text


class NoticeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'seen.sqlite'
        self.display = Mock()
        self.dispatch = Notices(self.path, self.display, now=lambda: 100000)

    def state(self, **extra):
        return dict(notices=[dict(id='weekly:week', type='weekly', at=99999, title='주간 리포트', body='작업 3시간')], notification_settings={'limit': True, 'weekly': True}, **extra)

    def test_replay_restart_and_two_dispatchers_show_once(self):
        for dispatcher in (self.dispatch, self.dispatch, Notices(self.path, self.display, now=lambda: 100000)):
            dispatcher.consume(self.state())
        self.display.assert_called_once_with('작업 3시간', '주간 리포트')
        with contextlib.closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT * FROM shown').fetchall(), [('weekly:week', 99999)])

    def test_english_and_chinese_are_made_from_the_numbers_and_korean_stays_as_written(self):
        weekly = dict(id='weekly:w', type='weekly', at=99999, working_s=148320, waiting_s=22800, ratio=5.2, title='지난주 에이전트 작업 41시간 12분', body='대기로 멈춘 시간 6시간 20분')
        limit = dict(id='limit:a:1', type='limit', at=99999, account_label='Claude Code 1', end=99999 + 7200, reset=99999 + 7200 + 19 * 3600, title='한도', body='본문')
        self.assertEqual(text(weekly, 'ko'), ('지난주 에이전트 작업 41시간 12분', '대기로 멈춘 시간 6시간 20분'))
        self.assertEqual(text(weekly, 'en')[0], 'Agents worked 41h 12m last week')
        self.assertTrue(text(weekly, 'en')[1].startswith('Waiting for you 6h 20m · ') and text(weekly, 'en')[1].endswith(' value 5.2×'))
        self.assertEqual(text(weekly, 'zh')[0], '上周智能体工作 41小时12分钟')
        self.assertEqual(text(limit, 'en')[0], 'Claude Code 1 runs out before its reset')
        self.assertTrue(text(limit, 'en')[1].startswith('At this pace it runs out ') and text(limit, 'en')[1].endswith(' · 19h before the reset'))
        self.assertTrue(text(limit, 'zh')[1].endswith('用尽 · 比重置早 19小时'))
        # A notice without its numbers keeps the collector's Korean rather than show a broken sentence.
        self.assertEqual(text({**limit, 'end': None}, 'en'), ('한도', '본문'))
        shown = Notices(self.path, self.display, now=lambda: 100000, lang=lambda: 'en')
        shown.consume(dict(notices=[weekly], notification_settings={'limit': True, 'weekly': True}))
        self.assertEqual(self.display.call_args[0][1], 'Agents worked 41h 12m last week')

    def test_off_and_stale_or_malformed_notices_never_display(self):
        state = self.state(); state['notification_settings']['weekly'] = False
        self.dispatch.consume(state); self.dispatch.consume(self.state())
        self.display.assert_not_called()
        for key, value in [('at', 1), ('at', float('nan')), ('at', True), ('type', 'push'), ('title', None)]:
            state = self.state(); state['notices'][0][key] = value
            self.assertEqual(self.dispatch.consume(state), [])

    def test_failed_os_delivery_is_not_repeated_or_written_as_conversation_text(self):
        self.display.side_effect = RuntimeError('OS unavailable')
        with self.assertRaises(RuntimeError): self.dispatch.consume(self.state())
        self.display.reset_mock(); self.dispatch.consume(self.state()); self.display.assert_not_called()
        self.assertNotIn('작업'.encode(), self.path.read_bytes())

    def test_native_utf16_limits_do_not_cut_a_surrogate(self):
        self.assertEqual(clipped('😀' * 70, 63), '😀' * 31)
        state=self.state(); state['notices'][0].update(title='가'*80,body='나'*300)
        self.dispatch.consume(state); self.display.assert_called_once_with('나'*255,'가'*63)

    @patch('onetop.windows_notices.http.client.HTTPConnection')
    def test_setting_uses_guarded_loopback_and_never_accepts_failed_response(self, connect):
        response=connect.return_value.getresponse.return_value
        response.status=200;response.read.return_value=b'{"ok":true,"settings":{"limit":false,"weekly":true}}'
        self.assertEqual(set_settings(18766,'token',{'limit':False}), {'limit':False,'weekly':True})
        connect.assert_called_once_with('127.0.0.1',18766,timeout=3)
        self.assertEqual(connect.return_value.request.call_args.kwargs['headers']['X-Monitor-Token'],'token')
        self.assertEqual(connect.return_value.request.call_args.kwargs['headers']['Origin'], 'http://127.0.0.1:18766')
        response.status=403;self.assertIsNone(set_settings(18766,'token',{}))

    def test_actual_collector_route_requires_origin_and_returns_wrapped_settings(self):
        from onetop.server import DashboardHTTPServer, Handler
        from onetop.reports import read_settings
        server=DashboardHTTPServer(('127.0.0.1',0),Handler)
        server.action_token='fixture-token'
        worker=threading.Thread(target=server.serve_forever,daemon=True)
        with patch('onetop.server.DATA',Path(self.tmp.name)):
            worker.start()
            try:
                result=set_settings(server.server_port,'fixture-token',{'weekly':False})
                self.assertEqual(result, {'limit':True,'weekly':False})
                self.assertFalse(read_settings(Path(self.tmp.name))['weekly'])
                self.assertIsNone(set_settings(server.server_port,'wrong-token',{'weekly':True}))
                self.assertFalse(read_settings(Path(self.tmp.name))['weekly'])
            finally:
                server.shutdown();server.server_close();worker.join(2)
