"""Windows tray + WebView2 shell. The collector is an owned child process.

Laid out like the macOS app: a left click on the tray icon opens the quick view next to the
notification area, a right click opens the menu, and the full dashboard has its own window.
Words outside the dashboard follow the language chosen in the dashboard (한·EN·中).
"""
import json
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path


def agent_command(port, *extra):
    command = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, __file__]
    return [*command, '--agent', '--port', str(port), *extra]


def startup_message(error, port, lang):
    from onetop.windows_text import text
    code = getattr(error, 'code', None)
    if code == 'connection_timeout':
        return text(code, lang, port=port)
    return text(code if code == 'collector_exited' else 'launch_failed', lang)


def startup_dialog(message, logs, retry=True, lang='ko'):
    import ctypes
    from onetop.windows_text import text
    body = '\n\n'.join((text('startup_intro', lang), message,
                        text('startup_kept', lang) + ' ' + text('startup_retry' if retry else 'startup_logs_hint', lang),
                        text('startup_logs', lang) + '\n' + str(logs)))
    # Retry / Cancel. No raw PyInstaller traceback or silent orphan process.
    return ctypes.windll.user32.MessageBoxW(None, body, text('startup_title', lang), 0x15 if retry else 0x10) == 4


def main():
    from onetop.windows_runtime import configure_test_activation, ensure_webview_runtime
    configure_test_activation()
    if '--agent' in sys.argv:
        from onetop.cli import main as agent_main
        extra = sys.argv[sys.argv.index('--agent') + 1:]
        sys.argv = ['1top', *(['connect'] + [x for x in extra if x != '--connect']
                             if '--connect' in extra else ['run', '--headless', *extra])]
        agent_main()
        return
    from onetop.desktop_startup import CollectorLauncher, StartupError
    from onetop.windows_text import load_preferences, text
    lang = load_preferences()['lang']
    port = int(os.environ.get('ONETOP_PORT', '18766'))
    launcher = CollectorLauncher(port)
    try:
        if not ensure_webview_runtime(lang):
            startup_dialog(text('webview_needed', lang), launcher.log_dir, retry=False, lang=lang)
            return
        while True:
            try:
                launcher.start(agent_command(port))
                break
            except StartupError as error:
                if not startup_dialog(startup_message(error, port, lang), launcher.log_dir, lang=lang):
                    return
        desktop(launcher, quick_first='--quick-view' in sys.argv)
    except Exception as error:
        # Keep diagnostics local; do not display exception text that may contain
        # paths, account information, or responses from a provider.
        try:
            launcher.record('desktop_failed', error_type=type(error).__name__)
        except OSError:
            pass
        startup_dialog(text('window_failed', lang), launcher.log_dir, retry=False, lang=lang)
    finally:
        launcher.stop()


class QuickApi:
    """What the quick view may ask of the shell. Only these methods reach the page;
    session controls stay on the collector's guarded HTTP API, like the dashboard's."""

    def __init__(self, shell):
        self._shell = shell

    def preferences(self, lang, theme, origin='dashboard'):
        self._shell.set_preferences(lang, theme, origin == 'quick')

    def status(self, summary):
        self._shell.set_status(summary)

    def open_dashboard(self):
        self._shell.show_dashboard()

    def open_browser(self):
        self._shell.open_browser()

    def open_remote(self):
        self._shell.open_remote()

    def check_updates(self):
        self._shell.check_updates()

    def hide(self):
        self._shell.hide_quick()

    def quit(self):
        self._shell.quit()

    def relay_default(self):
        from onetop.bridge import RELAY
        return RELAY

    def connect(self, address):
        return self._shell.connect_remote(address)

    def restart(self):
        return self._shell.restart_collector()

    def login(self):
        return self._shell.login_state()

    def toggle_login(self):
        return self._shell.toggle_login()

    def zoom(self, value):
        return self._shell.set_zoom(value)


class Shell:
    """The tray icon, the quick view and the dashboard window of the Windows app."""

    def __init__(self, webview, pystray, image, launcher, runtime, quick_first=False):
        from onetop.windows_text import load_preferences
        self.webview, self.pystray, self.runtime, self.launcher = webview, pystray, runtime, launcher
        self.prefs = load_preferences()
        self.url = f'http://127.0.0.1:{launcher.port}'
        self.quitting = threading.Event()
        self.quick_visible = False
        self.quick_hidden_at = 0.0
        self.quick_point = None
        self.zoom = 1.0
        self.summary = None
        self.connect_lock = threading.Lock()
        width, height = runtime.desktop_size()
        self.window = webview.create_window(self.t('window_title'), self.url, width=width, height=height,
                                            min_size=(min(900, width), min(620, height)),
                                            maximized=width < 1200 or height < 800,
                                            background_color=self.background(), hidden=quick_first)
        qw, qh = runtime.QUICK_SIZE
        self.quick = webview.create_window(self.t('quick_title'), self.url + '/quick.html', width=qw, height=qh,
                                           hidden=True, frameless=True, easy_drag=False, on_top=True,
                                           resizable=False, background_color=self.background(), js_api=QuickApi(self))
        icon_path = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent)) / '1top.png'
        self.tray = pystray.Icon('1top', image.open(icon_path), self.t('tray_tip'), menu=self.menu())
        self.window.events.closing += self.closing
        self.quick_first = quick_first

    def t(self, key, **values):
        from onetop.windows_text import text
        return text(key, self.prefs['lang'], **values)

    def background(self):
        return '#f6f7f8' if self.prefs['theme'] == 'light' else '#0b0d0f'

    def menu(self):
        # The macOS app menu and the quick view's ⋯ menu in one list. A left click on the
        # icon runs the bold first item, like clicking the menu bar icon on macOS.
        item = lambda key, action, **extra: self.pystray.MenuItem(lambda _: self.t(key), action, **extra)
        return self.pystray.Menu(
            item('menu_quick', lambda *_: self.toggle_quick(), default=True),
            item('menu_dashboard', lambda *_: self.show_dashboard()),
            item('menu_browser', lambda *_: self.open_browser()),
            self.pystray.Menu.SEPARATOR,
            item('menu_login', lambda *_: self.toggle_login(), checked=lambda _: self.runtime.opens_at_login()),
            item('menu_remote', lambda *_: self.open_remote()),
            item('menu_connect', lambda *_: self.ask_connect()),
            item('menu_updates', lambda *_: self.check_updates()),
            self.pystray.Menu.SEPARATOR,
            item('menu_restart', lambda *_: threading.Thread(target=self.restart_collector, daemon=True).start()),
            item('menu_quit', lambda *_: self.quit()))

    # Windows and preferences
    def set_preferences(self, lang, theme, from_quick=False):
        from onetop.windows_text import LANGUAGES, save_preferences
        if lang not in LANGUAGES or theme not in ('dark', 'light'):
            return
        if {'lang': lang, 'theme': theme} == self.prefs:
            return
        self.prefs = {'lang': lang, 'theme': theme}
        save_preferences(lang, theme)
        if from_quick:
            # The dashboard keeps its choice in memory and would write the old one back; it reloads
            # from the shared storage instead, so the window and the quick view stay in step.
            self.window.evaluate_js('location.reload()')
        self.window.set_title(self.t('window_title'))
        self.quick.set_title(self.t('quick_title'))
        self.tray.title = self.summary or self.t('tray_tip')
        self.tray.update_menu()

    def set_status(self, summary):
        # The tooltip on the tray icon, like the menu bar item's: connection · working / all.
        if isinstance(summary, str) and summary:
            self.summary = summary[:120]
            self.tray.title = self.summary

    def show_dashboard(self):
        self.hide_quick()
        self.window.show()
        self.window.restore()

    def open_browser(self):
        webbrowser.open(self.url)

    def open_remote(self):
        webbrowser.open('https://1top.si/app')

    def check_updates(self):
        if self.runtime.package_identity():
            os.startfile(self.runtime.STORE_UPDATES)
        else:
            webbrowser.open('https://github.com/awesomezun/1top/releases')

    def toggle_quick(self):
        if self.quick_visible:
            self.hide_quick()
        # The click on the tray icon takes focus from an open quick view and closes it first;
        # that same click must not open it again.
        elif time.monotonic() - self.quick_hidden_at > .35:
            self.show_quick()

    def tray_point(self):
        # The notification area's corner of the monitor under the pointer, for opening without a click.
        work, _ = self.runtime.monitor_areas(self.runtime.cursor_position())
        return work[2] - 80, work[3] - 4

    def show_quick(self, point=None):
        runtime = self.runtime
        point = point or runtime.cursor_position()
        self.quick_point = point
        work, screen = runtime.monitor_areas(point)
        frame = runtime.quick_frame(point, work, screen, runtime.scale_factor(point), self.zoom)
        self.quick.show()
        hwnd = runtime.window_handle(self.quick)
        if hwnd:
            runtime.place_panel(hwnd, frame)
            runtime.bring_forward(hwnd)
        self.quick_visible = True
        self.quick.evaluate_js('window.OneTopQuick&&OneTopQuick.opened()')

    def hide_quick(self):
        if self.quick_visible:
            self.quick_visible = False
            self.quick_hidden_at = time.monotonic()
            self.quick.hide()

    def set_zoom(self, value):
        # The quick view's own size, 80–160% like 보기 › 확대·축소 on macOS.
        try:
            zoom = min(1.6, max(.8, round(float(value) * 10) / 10))
        except (TypeError, ValueError):
            return self.zoom
        self.zoom = zoom
        if self.quick_visible:
            self.show_quick(self.quick_point)
        return zoom

    def ask_connect(self):
        if not self.quick_visible:
            self.show_quick(self.tray_point())
        self.quick.evaluate_js('window.OneTopQuick&&OneTopQuick.askConnect()')

    def connect_remote(self, address):
        from onetop.bridge import relay_origin
        if not self.connect_lock.acquire(blocking=False):
            return {'ok': False, 'message': self.t('connect_failed')}
        try:
            if self.launcher.child is None:
                return {'ok': False, 'message': self.t('collector_elsewhere')}
            try:
                origin = relay_origin(str(address or '').strip())
            except ValueError:
                return {'ok': False, 'message': self.t('https_only')}
            self.launcher.stop()
            self.launcher.start(agent_command(self.launcher.port, '--connect', '--relay', origin))
            return {'ok': True, 'message': self.t('connect_started')}
        except Exception:
            return {'ok': False, 'message': self.t('connect_failed')}
        finally:
            self.connect_lock.release()

    def restart_collector(self):
        if self.launcher.child is None:
            return {'ok': False, 'message': self.t('restart_elsewhere')}
        try:
            self.launcher.stop()
            self.launcher.start(agent_command(self.launcher.port))
            return {'ok': True, 'message': self.t('restart_started')}
        except Exception:
            return {'ok': False, 'message': self.t('restart_failed')}

    def login_state(self):
        return {'enabled': self.runtime.opens_at_login(), 'managed': bool(self.runtime.package_identity())}

    def toggle_login(self):
        # Store builds register startup through Windows; the installer build uses the per-user Run entry.
        if self.runtime.package_identity():
            os.startfile('ms-settings:startupapps')
            return {'ok': True, 'message': self.t('login_store'), **self.login_state()}
        try:
            self.runtime.set_open_at_login(not self.runtime.opens_at_login())
        except OSError:
            return {'ok': False, 'message': self.t('login_failed'), **self.login_state()}
        self.tray.update_menu()
        return {'ok': True, 'message': None, **self.login_state()}

    def closing(self):
        if self.quitting.is_set():
            return True
        self.window.hide()
        return False

    def quit(self):
        self.quitting.set()
        self.tray.stop()
        self.quick.destroy()
        self.window.destroy()

    def opened_at_login(self):
        if self.quick_first:
            self.quick_first = False
            self.show_quick(self.tray_point())

    def run(self, smoke=None):
        threading.Thread(target=self.tray.run, daemon=True).start()
        # Opened at login: the quick view, like the macOS login item's --quick-view.
        self.quick.events.loaded += self.opened_at_login
        if smoke:
            smoke_started = threading.Event()
            def run_smoke_once():
                if not smoke_started.is_set():
                    smoke_started.set()
                    threading.Thread(target=smoke, daemon=True).start()
            self.window.events.loaded += run_smoke_once
        try:
            self.webview.start(gui='edgechromium', private_mode=False, storage_path=str(self.runtime.webview_storage()))
        finally:
            self.tray.stop()


def desktop(launcher, quick_first=False):
    import webview
    import pystray
    from PIL import Image
    from onetop import windows_runtime
    shell = Shell(webview, pystray, Image, launcher, windows_runtime, quick_first)
    shell.run(smoke=lambda: smoke(shell))


def quick_native_checks(shell):
    """CI fixture only: actual Win32 panel style, focus dismissal, and preference clicks."""
    import ctypes
    from ctypes import wintypes
    runtime, quick, window = shell.runtime, shell.quick, shell.window
    def wait_for(check):
        for _ in range(80):
            if check():return True
            time.sleep(.1)
        return False
    shell.show_quick(shell.tray_point())
    hwnd = runtime.window_handle(quick)
    user32 = ctypes.windll.user32
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    style = user32.GetWindowLongPtrW(ctypes.c_void_p(hwnd), -20)
    rect = wintypes.RECT()
    user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rect))
    work, _ = runtime.monitor_areas(shell.quick_point)
    result = {'tool_window': bool(style & 0x80), 'not_app_window': not bool(style & 0x40000),
              'within_work_area': rect.left >= work[0] and rect.top >= work[1] and rect.right <= work[2] and rect.bottom <= work[3],
              'monitor_scale': runtime.scale_factor(shell.quick_point)}
    quick.evaluate_js("window.__qaCircles=0;window.__qaAnimate=Element.prototype.animate;Element.prototype.animate=function(f,o){if(o?.pseudoElement==='::view-transition-new(root)')window.__qaCircles++;return window.__qaAnimate.call(this,f,o)}")
    def prefs(view):
        return view.evaluate_js('({lang:document.documentElement.lang,theme:document.documentElement.dataset.theme})') or {}
    initial = prefs(quick)
    languages = []
    for lang in ('en', 'zh', 'ko'):
        quick.evaluate_js('document.querySelector("[data-act=language]").click()')
        ok = wait_for(lambda: prefs(quick).get('lang') == ('zh-CN' if lang == 'zh' else lang) and prefs(window).get('lang') == ('zh-CN' if lang == 'zh' else lang))
        wait_for(lambda: not quick.evaluate_js('OneTopEffects.running'))
        languages.append({'lang':lang,'synced':ok})
    result['languages'] = languages
    themes = []
    for theme in ('light', 'dark'):
        quick.evaluate_js('document.querySelector("[data-act=theme]").click()')
        ok = wait_for(lambda: prefs(quick).get('theme') == theme and prefs(window).get('theme') == theme)
        wait_for(lambda: not quick.evaluate_js('OneTopEffects.running'))
        themes.append({'theme':theme,'synced':ok})
    result['themes'] = themes
    result['circle_animations'] = quick.evaluate_js('window.__qaCircles')
    result['preferences_restored'] = prefs(quick) == initial
    window.show()
    runtime.bring_forward(runtime.window_handle(window))
    result['blur_dismissed'] = wait_for(lambda: not shell.quick_visible)
    if not runtime.package_identity():
        was_enabled = runtime.opens_at_login()
        try:
            runtime.set_open_at_login(True)
            result['login_enabled'] = runtime.opens_at_login()
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,runtime.RUN_KEY) as key:
                command = winreg.QueryValueEx(key,runtime.RUN_VALUE)[0]
            result['login_quick_view'] = command == runtime.login_command() and '--quick-view' in command
            runtime.set_open_at_login(False)
            result['login_disabled'] = not runtime.opens_at_login()
        finally:
            runtime.set_open_at_login(was_enabled)
    return result


def smoke(shell):
    from onetop.desktop_startup import local_json
    from onetop.windows_runtime import package_identity
    window, quick, launcher, port = shell.window, shell.quick, shell.launcher, shell.launcher.port
    storage = shell.runtime.webview_storage()
    report = os.environ.get('ONETOP_SMOKE_REPORT')
    if not report:
        return
    try:
        result, state, match = {}, {}, {}
        for _ in range(240):
            result = window.evaluate_js('({title:document.title,ready:!!document.querySelector("#sessionsBody"),maps:!!document.querySelector("[data-view=maps]"),dataReady:typeof data!=="undefined"&&data?.ready===true,renderedVersion:typeof data!=="undefined"?data?.version:null})')
            state = local_json(port, '/api/state') or {}
            sid = os.environ.get('FIXTURE_SESSION')
            match = next((s for s in state.get('sessions', []) if s['id'] == sid), {})
            fixture_ready = not sid or (match.get('tokens') == [100, 200, 10, 20]
                and match.get('usage', {}).get('windows', {}).get('1h') == [100, 200, 10, 20])
            quick_view = quick.evaluate_js('({ready:!!(window.OneTopQuick&&OneTopQuick.ready),rows:document.querySelectorAll("[data-session-row]").length,connection:document.querySelector("#quickConnection")?.textContent||null,lang:document.documentElement.lang})') or {}
            if result and result.get('maps') and result.get('dataReady') and state.get('ready') and fixture_ready and quick_view.get('ready'):
                result.update(window.evaluate_js('({connection:document.querySelector("#connectionText").textContent,rendered_sessions:document.querySelectorAll("#sessionsBody tr[data-session]").length,render_error:(()=>{try{render();return null}catch(e){return String(e.stack)}})()})'))
                quick_view = quick.evaluate_js('(OneTopQuick.refresh().then(()=>({ready:OneTopQuick.ready,rows:document.querySelectorAll("[data-session-row]").length,connection:document.querySelector("#quickConnection").textContent,render_error:OneTopQuick.error})))') or quick_view
                result.update(quick_ready=quick_view.get('ready'), quick_rows=quick_view.get('rows'),
                              quick_connection=quick_view.get('connection'), quick_render_error=quick_view.get('render_error'),
                              window_title=shell.t('window_title'))
                previous = window.evaluate_js('localStorage.getItem("onetop-msix-smoke")')
                expected = os.environ.get('ONETOP_SMOKE_STORAGE_EXPECT')
                written = os.environ.get('ONETOP_SMOKE_STORAGE_WRITE')
                if written:
                    window.evaluate_js('localStorage.setItem("onetop-msix-smoke",' + json.dumps(written) + ')')
                migration_expected = os.environ.get('ONETOP_SMOKE_MIGRATION_EXPECT')
                migration_ok = None
                if migration_expected:
                    marker = storage.parent / 'msix-migration-probe.txt'
                    migration_ok = marker.read_text(encoding='utf-8') == migration_expected
                    marker.write_text('packaged-preserved', encoding='utf-8')
                result.update(collector_version=state['version'],
                              collector_owned=launcher.child is not None,
                              collector_pid=launcher.child.pid if launcher.child else None,
                              fixture_tokens=match.get('tokens'), session_count=len(state.get('sessions', [])),
                              root_session_count=len(state.get('root_sessions') or state.get('sessions', [])),
                              fixture_period_tokens=match.get('usage', {}).get('windows', {}).get('1h'),
                              host_resources=state.get('system', {}).get('host', {}).get('memory', {}).get('total', 0) > 0,
                              package_identity=package_identity(), webview_storage=str(storage),
                              persisted_storage=previous, storage_expectation_met=expected is None or previous == expected,
                              existing_data_preserved=migration_ok,
                              update_channel=(local_json(port, '/api/updates') or {}).get('channel'))
                result['quick_native'] = quick_native_checks(shell)
                if package_identity():
                    from PIL import ImageGrab
                    ImageGrab.grab(all_screens=True).save(Path(report).with_suffix('.png'))
                    window.evaluate_js('selectView("maps");renderMaps()')
                    time.sleep(.2)
                    result['map_total'] = window.evaluate_js('document.querySelector("#mapTotal").textContent')
                    ImageGrab.grab(all_screens=True).save(Path(report).with_name(Path(report).stem + '-maps.png'))
                    window.evaluate_js('selectView("system");renderSystem()')
                    time.sleep(.2)
                    ImageGrab.grab(all_screens=True).save(Path(report).with_name(Path(report).stem + '-resources.png'))
                    # The quick view next to the notification area, as a left click on the tray icon opens it.
                    shell.show_quick(shell.tray_point())
                    time.sleep(.6)
                    result['quick_visible'] = shell.quick_visible
                    ImageGrab.grab(all_screens=True).save(Path(report).with_name(Path(report).stem + '-quick.png'))
                    shell.hide_quick()
                Path(report).write_text(json.dumps(result), encoding='utf-8')
                return
            time.sleep(.25)
        # Preserve the last observed state when a CI fixture never becomes
        # ready, instead of silently exiting without the promised report.
        Path(report).write_text(json.dumps({
            'smoke_failure': 'Dashboard or fixture did not become ready',
            'ui': result, 'collector_ready': state.get('ready'),
            'quick': quick.evaluate_js('({quick:typeof OneTopQuick,i18n:typeof OneTopI18n,speed:typeof OneTopSpeed,error:window.OneTopQuick?.error||null})'),
            'script_globals': window.evaluate_js('({dashboard:typeof OneTopDashboard,i18n:typeof OneTopI18n,effects:typeof OneTopEffects,maps:typeof OneTopMaps,weekly:typeof OneTopWeekly,data:typeof data,refresh:typeof refresh,connection:document.querySelector("#connectionText")?.textContent,resources:performance.getEntriesByType("resource").filter(r=>r.name.endsWith(".js")).map(r=>({name:r.name.split("/").pop(),size:r.decodedBodySize}))})'),
            'collector_version': state.get('version'),
            'session_count': len(state.get('sessions', [])),
            'fixture_tokens': match.get('tokens'),
            'fixture_period_tokens': match.get('usage', {}).get('windows', {}).get('1h'),
        }), encoding='utf-8')
    finally:
        shell.quit()


if __name__ == '__main__':
    main()
