"""Windows tray + WebView2 shell. The collector is an owned child process."""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


def main():
    if '--agent' in sys.argv:
        from onetop.cli import main as agent_main
        sys.argv = ['1top', 'run', '--headless', *sys.argv[sys.argv.index('--agent')+1:]]
        agent_main(); return
    import webview
    import pystray
    from PIL import Image
    from onetop import __version__
    port = int(os.environ.get('ONETOP_PORT', '18766'))
    url = f'http://127.0.0.1:{port}'
    child = None
    def ready():
        try:
            with urllib.request.urlopen(url+'/api/state', timeout=1) as response:
                state=json.load(response)
                return isinstance(state.get('version'),str)
        except Exception:
            return False
    if not ready():
        command = [sys.executable, '--agent', '--port', str(port)] if getattr(sys,'frozen',False) else [sys.executable, __file__, '--agent', '--port', str(port)]
        child = subprocess.Popen(command, creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(100):
            if ready():break
            if child.poll() is not None:raise RuntimeError('The local collector could not start.')
            time.sleep(.15)
        else:raise RuntimeError('The local collector did not respond.')
    window=webview.create_window('1top — This PC',url,width=1400,height=900,min_size=(900,620),background_color='#0c0f12')
    quitting=threading.Event()
    def show(*_):window.show();window.restore()
    def quit_app(*_):
        quitting.set();tray.stop();window.destroy()
    icon_path=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent))/'1top.png'
    tray=pystray.Icon('1top',Image.open(icon_path),'1top · AI sessions',menu=pystray.Menu(
        pystray.MenuItem('Open dashboard',show,default=True),
        pystray.MenuItem('Open in browser',lambda *_:webbrowser.open(url)),
        pystray.MenuItem('Remote workspace',lambda *_:webbrowser.open('https://1top.si/app')),
        pystray.MenuItem('Quit 1top',quit_app)))
    def closing():
        if quitting.is_set():return True
        window.hide();return False
    window.events.closing+=closing
    threading.Thread(target=tray.run,daemon=True).start()
    def smoke():
        report=os.environ.get('ONETOP_SMOKE_REPORT')
        if not report:return
        try:
            for _ in range(80):
                result=window.evaluate_js('({title:document.title,ready:!!document.querySelector("#sessionsBody"),maps:!!document.querySelector("[data-view=maps]")})')
                if result and result.get('maps'):
                    Path(report).write_text(json.dumps(result),encoding='utf-8');return
                time.sleep(.25)
        finally:quit_app()
    window.events.loaded+=lambda:threading.Thread(target=smoke,daemon=True).start()
    try:webview.start(gui='edgechromium')
    finally:
        tray.stop()
        if child and child.poll() is None:
            child.terminate()
            try:child.wait(8)
            except subprocess.TimeoutExpired:child.kill();child.wait()


if __name__=='__main__':
    main()
