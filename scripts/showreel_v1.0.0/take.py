"""Record one full-resolution take of a v7.0.0 scene for the showreel.

Usage: take.py <dashboard|conversation|accounts|customize|menu> [--lang ko|en|zh] [--replace] [--demo-now <s>]
Uses the recording build of scripts/showcase_v7.0.0 (run its prepare_capture.py first): the same synthetic
fixture, the same app copy and the same scene timelines as the landing films. Unlike that record.py it
writes nothing to site/public/media; it keeps the ProRes take at the window's full pixel size (2x on a
Retina screen) and the window still with its transparent corners, in build/showreel_v1.0.0/takes/. The demo holds at
the same moment as the landing films (--demo-now, default 1800000000).
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'build/showcase_v7.0.0'
SHOWCASE = ROOT / 'scripts/showcase_v7.0.0'
TAKES = ROOT / 'build/showreel_v1.0.0/takes'
DURATION = {'dashboard': 16.5, 'conversation': 24.5, 'accounts': 15.5, 'customize': 20.0, 'menu': 21.0}
scene = sys.argv[1]
assert scene in DURATION
lang = sys.argv[sys.argv.index('--lang') + 1] if '--lang' in sys.argv else 'ko'
assert lang in ('ko', 'en', 'zh')
name = f'{scene}-{lang}'
DEMO_NOW = sys.argv[sys.argv.index('--demo-now') + 1] if '--demo-now' in sys.argv else '1800000000'
TAKES.mkdir(parents=True, exist_ok=True)
take, mask = TAKES / f'{name}.mov', TAKES / f'{name}-mask.png'
assert '--replace' in sys.argv or not take.exists(), 'Keep the existing take; pass --replace to record it again'
assert (CAPTURE / 'capture-app').exists(), 'Run scripts/showcase_v7.0.0/prepare_capture.py first'

server = subprocess.Popen(['node', str(SHOWCASE / 'fixture_server.mjs'), str(CAPTURE / 'src'), lang, DEMO_NOW])
for _ in range(50):
    try:
        socket.create_connection(('127.0.0.1', 18868), timeout=.2).close(); break
    except OSError:
        time.sleep(.1)
app = subprocess.Popen([str(CAPTURE / 'capture-app'), '--ui-test'] + (['--quick-view'] if scene == 'menu' else []),
                       env={**os.environ, 'ONETOP_SCENE': scene, 'ONETOP_LANG': lang, 'ONETOP_DEMO_NOW': DEMO_NOW,
                            'ONETOP_PREFS': json.dumps(dict(theme='dark', lang=lang)), 'ONETOP_UI_TEST_PORT': '18868'},
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(TAKES / f'{name}.log', 'w'), text=True)
report = []
try:
    window = None
    while not window:
        line = app.stdout.readline()
        if line.startswith('RECORD_WINDOW '):
            window = line.split()[1]
        if not line: raise RuntimeError('Capture app exited before creating its window')
    subprocess.run(['screencapture', '-T', '0', '-x', '-o', '-l', window, str(mask)], check=True)
    film = subprocess.Popen([str(CAPTURE / 'window-film'), window, str(take), str(DURATION[scene])],
                            stdout=subprocess.PIPE, stderr=open(TAKES / f'{name}.film.log', 'w'), text=True)
    for line in film.stdout:
        report.append(line.strip())
        if line.startswith('RECORDING'):
            # The scene's timeline starts with the first recorded frame, as in record.py.
            app.stdin.write('go\n'); app.stdin.flush()
            # Keep reading the app's output so its pipe never fills during the take.
            threading.Thread(target=lambda: [None for _ in app.stdout], daemon=True).start()
    film.wait()
    time.sleep(.5)
finally:
    app.terminate(); app.wait(timeout=10)
    server.terminate(); server.wait(timeout=10)

assert film.returncode == 0 and take.exists(), 'the recorder failed; see the .film.log'
assert not any(r.startswith('UNUSABLE') for r in report), 'another application covered the window; record again'
probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(take)],
                       check=True, capture_output=True, text=True).stdout.strip()
assert tuple(map(int, probe.split(','))) == Image.open(mask).size, f'take {probe} and window still differ'
print(f'{take} {probe} · {" · ".join(report)}', flush=True)
