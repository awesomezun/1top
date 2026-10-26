"""Windows tray + WebView2 shell. The collector is an owned child process."""
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


def startup_dialog(error, logs, retry=True):
    import ctypes
    message = ('1top could not open the local dashboard.\n\n'
               + str(error) + '\n\nYour AI sessions have not been stopped. '
               + ('Retry to start 1top again.' if retry else 'Check the diagnostic logs and reopen 1top.')
               + '\n\nDiagnostic logs:\n' + str(logs))
    # Retry / Cancel. No raw PyInstaller traceback or silent orphan process.
    return ctypes.windll.user32.MessageBoxW(None, message, '1top — Unable to start', 0x15 if retry else 0x10) == 4


def main():
    if '--agent' in sys.argv:
        from onetop.cli import main as agent_main
        extra = sys.argv[sys.argv.index('--agent') + 1:]
        sys.argv = ['1top', *(['connect'] + [x for x in extra if x != '--connect']
                             if '--connect' in extra else ['run', '--headless', *extra])]
        agent_main()
        return
    from onetop.desktop_startup import CollectorLauncher, StartupError
    port = int(os.environ.get('ONETOP_PORT', '18766'))
    launcher = CollectorLauncher(port)
    try:
        while True:
            try:
                launcher.start(agent_command(port))
                break
            except StartupError as error:
                if not startup_dialog(error, launcher.log_dir):
                    return
        desktop(launcher)
    except Exception as error:
        # Keep diagnostics local; do not display exception text that may contain
        # paths, account information, or responses from a provider.
        try:
            launcher.record('desktop_failed', error_type=type(error).__name__)
        except OSError:
            pass
        startup_dialog('The desktop window could not be opened. '
                       'Check that Microsoft Edge WebView2 Runtime is installed.', launcher.log_dir, retry=False)
    finally:
        launcher.stop()


def desktop(launcher):
    import webview
    import pystray
    from PIL import Image
    from onetop.desktop_startup import local_json
    port = launcher.port
    url = f'http://127.0.0.1:{port}'
    window = webview.create_window('1top — This PC', url, width=1400, height=900,
                                   min_size=(900, 620), background_color='#0c0f12')
    quitting = threading.Event()

    def show(*_):
        window.show()
        window.restore()

    connect_lock = threading.Lock()

    def connect_remote(*_):
        from onetop.bridge import relay_origin, RELAY
        if not connect_lock.acquire(blocking=False):
            return
        try:
            if launcher.child is None:
                window.evaluate_js('alert("This collector was started elsewhere. Connect from its original app or CLI.")')
                return
            show()
            value = window.evaluate_js('prompt("Relay HTTPS address. Use the 1top managed server or your own trusted Cloudflare relay:",' + json.dumps(RELAY) + ')')
            if not value:
                return
            origin = relay_origin(value)
            launcher.stop()
            launcher.start(agent_command(port, '--connect', '--relay', origin))
        except Exception:
            window.evaluate_js('alert("Connection did not start. Check the HTTPS address and restart 1top if needed.")')
        finally:
            connect_lock.release()

    def quit_app(*_):
        quitting.set()
        tray.stop()
        window.destroy()

    icon_path = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent)) / '1top.png'
    tray = pystray.Icon('1top', Image.open(icon_path), '1top · AI sessions', menu=pystray.Menu(
        pystray.MenuItem('Open dashboard', show, default=True),
        pystray.MenuItem('Open in browser', lambda *_: webbrowser.open(url)),
        pystray.MenuItem('Check for updates', lambda *_: webbrowser.open('https://github.com/awesomezun/1top/releases')),
        pystray.MenuItem('Connect remote server…', lambda *_: threading.Thread(target=connect_remote, daemon=True).start()),
        pystray.MenuItem('Remote workspace', lambda *_: webbrowser.open('https://1top.si/app')),
        pystray.MenuItem('Quit 1top', quit_app)))

    def closing():
        if quitting.is_set():
            return True
        window.hide()
        return False

    window.events.closing += closing
    threading.Thread(target=tray.run, daemon=True).start()

    def smoke():
        report = os.environ.get('ONETOP_SMOKE_REPORT')
        if not report:
            return
        try:
            for _ in range(240):
                result = window.evaluate_js('({title:document.title,ready:!!document.querySelector("#sessionsBody"),maps:!!document.querySelector("[data-view=maps]")})')
                state = local_json(port, '/api/state') or {}
                sid = os.environ.get('FIXTURE_SESSION')
                match = next((s for s in state.get('sessions', []) if s['id'] == sid), {})
                if result and result.get('maps') and state.get('ready') and (not sid or match.get('tokens')):
                    result.update(collector_version=state['version'],
                                  collector_owned=launcher.child is not None,
                                  collector_pid=launcher.child.pid if launcher.child else None,
                                  fixture_tokens=match.get('tokens'), session_count=len(state.get('sessions', [])),
                                  host_resources=state.get('system', {}).get('host', {}).get('memory', {}).get('total', 0) > 0)
                    Path(report).write_text(json.dumps(result), encoding='utf-8')
                    return
                time.sleep(.25)
        finally:
            quit_app()

    window.events.loaded += lambda: threading.Thread(target=smoke, daemon=True).start()
    try:
        webview.start(gui='edgechromium')
    finally:
        tray.stop()


if __name__ == '__main__':
    main()
