"""The Windows tray shell matches the macOS app: quick view by the tray, the same menu, the dashboard's language."""
import importlib.util
import re
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from onetop import windows_runtime
from onetop.desktop_startup import StartupError
from onetop.server import BASE, DashboardHTTPServer, Handler
from onetop.windows_text import load_preferences, save_preferences

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('windows_main', ROOT / 'desktop/windows/main.py')
shell_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell_main)


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


class FakeWindow:
    def __init__(self, title, url, **options):
        self.title, self.url, self.options = title, url, options
        self.events = type('Events', (), {})()
        self.events.closing, self.events.loaded = Event(), Event()
        self.visible = not options.get('hidden')
        self.scripts = []
        self.destroyed = False

    def show(self):
        self.visible = True

    def hide(self):
        self.visible = False

    def restore(self):
        pass

    def set_title(self, title):
        self.title = title

    def evaluate_js(self, script):
        self.scripts.append(script)

    def destroy(self):
        self.destroyed = True


class FakeWebview:
    def __init__(self):
        self.windows = []

    def create_window(self, title, url, **options):
        self.windows.append(FakeWindow(title, url, **options))
        return self.windows[-1]

    def start(self, **options):
        self.started = options


class FakeMenuItem:
    def __init__(self, text, action, default=False, checked=None, **_):
        self.text, self.action, self.default, self.checked = text, action, default, checked


class FakeMenu:
    SEPARATOR = object()

    def __init__(self, *items):
        self.items = items


class FakeIcon:
    def __init__(self, name, image, title, menu=None):
        self.name, self.title, self.menu = name, title, menu
        self.menu_updates = 0
        self.stopped = False

    def update_menu(self):
        self.menu_updates += 1

    def run(self):
        pass

    def stop(self):
        self.stopped = True


class FakePystray:
    MenuItem, Menu, Icon = FakeMenuItem, FakeMenu, FakeIcon


class FakeImage:
    @staticmethod
    def open(path):
        return path


class FakeRuntime:
    QUICK_SIZE = windows_runtime.QUICK_SIZE
    STORE_UPDATES = windows_runtime.STORE_UPDATES
    quick_frame = staticmethod(windows_runtime.quick_frame)

    def __init__(self, packaged=False):
        self.packaged, self.login, self.placed, self.login_writes = packaged, False, [], []

    def desktop_size(self):
        return 1400, 900

    def cursor_position(self):
        return 1800, 1060

    def monitor_areas(self, point):
        return (0, 0, 1920, 1040), (0, 0, 1920, 1080)

    def scale_factor(self):
        return 1.0

    def window_handle(self, window):
        return 42

    def place_panel(self, hwnd, frame):
        self.placed.append(frame)

    def bring_forward(self, hwnd):
        pass

    def opens_at_login(self):
        return self.login

    def set_open_at_login(self, enabled):
        self.login = enabled
        self.login_writes.append(enabled)

    def package_identity(self):
        return 'Store.1top' if self.packaged else None

    def webview_storage(self):
        return Path(tempfile.gettempdir())


class FakeLauncher:
    def __init__(self, owned=True):
        self.port = 18766
        self.child = object() if owned else None
        self.started = []

    def stop(self):
        pass

    def start(self, command):
        self.started.append(command)


class ShellTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.prefs = Path(self.tmp.name) / 'desktop-ui.json'
        self.patch = patch('onetop.windows_text._path', return_value=self.prefs)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def shell(self, runtime=None, launcher=None, quick_first=False):
        self.webview, self.runtime = FakeWebview(), runtime or FakeRuntime()
        return shell_main.Shell(self.webview, FakePystray, FakeImage, launcher or FakeLauncher(), self.runtime, quick_first)

    def labels(self, shell):
        return ['—' if item is FakeMenu.SEPARATOR else item.text(item) for item in shell.tray.menu.items]

    def test_tray_menu_is_the_macos_menu_in_the_dashboard_language(self):
        shell = self.shell()
        self.assertEqual(self.labels(shell), ['간략 대시보드', '전체 대시보드', '브라우저에서 열기', '—', '로그인할 때 실행',
                                              '원격 대시보드 (선택)', '원격 기기 연결…', '업데이트 확인…', '—',
                                              '로컬 수집기 다시 시작', '1top 종료'])
        self.assertTrue(shell.tray.menu.items[0].default)
        api = shell.quick.options['js_api']
        api.preferences('en', 'light')
        self.assertEqual(self.labels(shell)[:3], ['Quick view', 'Full dashboard', 'Open in browser'])
        self.assertEqual(shell.window.title, '1top — This PC')
        self.assertEqual(shell.tray.menu_updates, 1)
        self.assertEqual(load_preferences(self.prefs), {'lang': 'en', 'theme': 'light'})
        self.assertEqual(shell.window.scripts, [])
        # Tapping the quick view's language button changes the dashboard's choice; the dashboard
        # window reloads from the shared storage so it does not write its old choice back.
        api.preferences('zh', 'light', 'quick')
        self.assertEqual(shell.window.scripts, ['location.reload()'])
        self.assertEqual(shell.window.title, '1top — 此电脑')
        self.assertEqual(self.labels(shell)[-1], '退出 1top')
        api.preferences('fr', 'dark')
        self.assertEqual(shell.prefs['lang'], 'zh')

    def test_windows_follow_the_saved_language_and_theme_from_the_start(self):
        save_preferences('en', 'light', self.prefs)
        shell = self.shell()
        self.assertEqual(shell.window.title, '1top — This PC')
        self.assertEqual(shell.window.options['background_color'], '#f6f7f8')
        self.assertEqual(shell.tray.title, '1top · AI sessions')

    def test_quick_view_is_a_hidden_frameless_panel_with_a_narrow_bridge(self):
        shell = self.shell()
        self.assertEqual(shell.window.title, '1top — 이 PC')
        self.assertEqual(shell.window.url, 'http://127.0.0.1:18766')
        self.assertTrue(shell.window.visible)
        options = shell.quick.options
        self.assertEqual(shell.quick.url, 'http://127.0.0.1:18766/quick.html')
        self.assertTrue(options['hidden'] and options['frameless'] and options['on_top'])
        self.assertEqual((options['width'], options['height']), (440, 800))
        api = options['js_api']
        exposed = {name for name in dir(api) if not name.startswith('_')}
        self.assertEqual(exposed, {'preferences', 'status', 'open_dashboard', 'open_browser', 'open_remote', 'check_updates',
                                   'hide', 'quit', 'relay_default', 'connect', 'restart', 'login', 'toggle_login', 'zoom'})
        self.assertTrue(all(callable(getattr(api, name)) for name in exposed))

    def test_left_click_toggles_the_quick_view_by_the_tray(self):
        shell = self.shell()
        click = shell.tray.menu.items[0].action
        with patch.object(shell_main.time, 'monotonic', return_value=100.0):
            click()
        self.assertTrue(shell.quick.visible and shell.quick_visible)
        self.assertEqual(self.runtime.placed[-1], (1472, 232, 440, 800))
        self.assertIn('OneTopQuick.opened()', shell.quick.scripts[-1])
        with patch.object(shell_main.time, 'monotonic', return_value=101.0):
            click()
        self.assertFalse(shell.quick.visible)
        # Clicking the icon while the panel is open first takes focus away (the page asks to hide);
        # that same click must not open the panel again.
        with patch.object(shell_main.time, 'monotonic', return_value=200.0):
            click()
            shell.quick.options['js_api'].hide()
            click()
        self.assertFalse(shell.quick_visible)
        with patch.object(shell_main.time, 'monotonic', return_value=201.0):
            click()
        self.assertTrue(shell.quick_visible)

    def test_opening_at_login_shows_the_quick_view_once(self):
        shell = self.shell(quick_first=True)
        self.assertFalse(shell.window.visible)
        shell.run()
        for handler in shell.quick.events.loaded.handlers:
            handler()
            handler()
        self.assertEqual(len(self.runtime.placed), 1)

    def test_zoom_resizes_the_open_panel_in_place(self):
        shell = self.shell()
        shell.show_quick((1800, 1060))
        api = shell.quick.options['js_api']
        self.assertEqual(api.zoom(1.24), 1.2)
        self.assertEqual(self.runtime.placed[-1][2:], (528, 960))
        self.assertEqual(api.zoom(9), 1.6)
        self.assertEqual(api.zoom('x'), 1.6)

    def test_closing_the_dashboard_hides_it_until_quit(self):
        shell = self.shell()
        self.assertFalse(shell.closing())
        self.assertFalse(shell.window.visible)
        shell.quit()
        self.assertTrue(shell.closing())
        self.assertTrue(shell.tray.stopped and shell.window.destroyed and shell.quick.destroyed)

    def test_connect_checks_the_address_and_restarts_only_its_own_collector(self):
        shell = self.shell(launcher=FakeLauncher(owned=False))
        self.assertEqual(shell.connect_remote('https://relay.example.com'),
                         {'ok': False, 'message': '이 수집기는 다른 곳에서 시작되었습니다. 처음 시작한 앱이나 CLI에서 연결하세요.'})
        shell = self.shell()
        self.assertEqual(shell.connect_remote('http://relay.example.com')['message'], 'HTTPS 서버 주소만 입력하세요.')
        self.assertEqual(shell.launcher.started, [])
        result = shell.connect_remote('https://Relay.Example.com/')
        self.assertTrue(result['ok'])
        self.assertEqual(shell.launcher.started[-1][-3:], ['--connect', '--relay', 'https://relay.example.com'])

    def test_restart_and_open_at_login(self):
        shell = self.shell()
        self.assertTrue(shell.restart_collector()['ok'])
        self.assertEqual(shell.launcher.started[-1][-3:], ['--agent', '--port', '18766'])
        self.assertEqual(self.shell(launcher=FakeLauncher(owned=False)).restart_collector()['message'],
                         '다른 곳에서 시작한 수집기는 여기서 다시 시작할 수 없습니다.')
        shell = self.shell()
        self.assertEqual(shell.toggle_login(), {'ok': True, 'message': None, 'enabled': True, 'managed': False})
        self.assertEqual(self.runtime.login_writes, [True])
        self.assertTrue(shell.tray.menu.items[4].checked(shell.tray.menu.items[4]))
        packaged = self.shell(runtime=FakeRuntime(packaged=True))
        with patch.object(shell_main.os, 'startfile', create=True) as startfile:
            result = packaged.toggle_login()
        startfile.assert_called_once_with('ms-settings:startupapps')
        self.assertEqual(result['message'], 'Windows 설정 › 앱 › 시작 프로그램에서 1top을 켜거나 끌 수 있습니다.')
        self.assertEqual(self.runtime.login_writes, [])

    def test_startup_notices_use_the_dashboard_language(self):
        self.assertEqual(shell_main.startup_message(StartupError('connection_timeout', 'x'), 18766, 'en'),
                         'The local collector did not connect on port 18766.')
        self.assertEqual(shell_main.startup_message(StartupError('collector_exited', 'x'), 18766, 'zh'), '本地采集器意外退出。')
        self.assertEqual(shell_main.startup_message(RuntimeError('x'), 18766, 'ko'), '로컬 수집기를 시작하지 못했습니다.')

    def test_saved_preferences_are_only_language_and_theme(self):
        self.assertEqual(load_preferences(self.prefs), {'lang': 'ko', 'theme': 'dark'})
        self.assertFalse(save_preferences('de', 'dark', self.prefs))
        self.prefs.write_text('{"lang":"zh","theme":"neon","token":"x"}', encoding='utf-8')
        self.assertEqual(load_preferences(self.prefs), {'lang': 'zh', 'theme': 'dark'})


class QuickFrameTests(unittest.TestCase):
    def test_opens_above_a_bottom_taskbar_by_the_click(self):
        self.assertEqual(windows_runtime.quick_frame((1800, 1060), (0, 0, 1920, 1040), (0, 0, 1920, 1080)), (1472, 232, 440, 800))
        self.assertEqual(windows_runtime.quick_frame((600, 1060), (0, 0, 1920, 1040), (0, 0, 1920, 1080)), (380, 232, 440, 800))

    def test_scales_with_the_display_and_never_leaves_the_work_area(self):
        self.assertEqual(windows_runtime.quick_frame((2800, 1580), (0, 0, 2880, 1560), (0, 0, 2880, 1620), scale=1.5), (2208, 348, 660, 1200))
        x, y, width, height = windows_runtime.quick_frame((1300, 760), (0, 0, 1366, 728), (0, 0, 1366, 768))
        self.assertEqual((width, height), (440, 712))
        self.assertEqual((x, y), (918, 8))

    def test_other_taskbar_edges(self):
        self.assertEqual(windows_runtime.quick_frame((1800, 20), (0, 40, 1920, 1080), (0, 0, 1920, 1080)), (1472, 48, 440, 800))
        self.assertEqual(windows_runtime.quick_frame((20, 900), (48, 0, 1920, 1080), (0, 0, 1920, 1080)), (56, 272, 440, 800))
        self.assertEqual(windows_runtime.quick_frame((1900, 900), (0, 0, 1872, 1080), (0, 0, 1920, 1080)), (1424, 272, 440, 800))
        # An auto-hidden taskbar leaves no gap; Windows keeps it at the bottom by default.
        self.assertEqual(windows_runtime.quick_frame((1800, 1075), (0, 0, 1920, 1080), (0, 0, 1920, 1080)), (1472, 272, 440, 800))

    def test_second_monitor_to_the_left(self):
        self.assertEqual(windows_runtime.quick_frame((-200, 1060), (-1920, 0, 0, 1040), (-1920, 0, 0, 1080)), (-448, 232, 440, 800))


class QuickAssetTests(unittest.TestCase):
    def test_the_collector_serves_every_file_the_quick_view_loads(self):
        page = (BASE / 'dist' / 'quick.html').read_text(encoding='utf-8')
        paths = ['quick.html'] + re.findall(r'(?:src|href)="/([^"]+)"', page)
        self.assertIn('quick.js', paths)
        self.assertIn('quick.css', paths)
        server = DashboardHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            for path in paths:
                with socket.create_connection(server.server_address, timeout=2) as connection:
                    connection.sendall(('GET /' + path + ' HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n').encode())
                    result = b''
                    while chunk := connection.recv(65536):
                        result += chunk
                headers, body = result.split(b'\r\n\r\n', 1)
                self.assertIn(b' 200 ', headers.split(b'\r\n', 1)[0], path)
                self.assertEqual(body, (BASE / 'dist' / path).read_bytes(), path)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
