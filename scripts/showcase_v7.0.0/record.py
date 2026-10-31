"""Capture only the synthetic app's own windows; encode versioned web media.

Usage: record.py <dashboard|gauges|conversation|accounts|customize|menu> [--lang ko|en|zh] [--replace] [--now] [--keep] [--demo-now <s>]
The fixture server (fixture_server.mjs) is started and stopped here. Only the window ID printed by
the recording build is recorded (window_film.swift), so no other window or
notification can appear. Each run starts at the same second of a minute (skip
with --now), so the Korean and English films of one scene show the same
synthetic numbers. --keep keeps the ProRes take next to the frames log. The demo holds at one moment
(--demo-now, default 1800000000, the moment scripts/demo-world.mjs checks), the same moment the web demo
(/app?demo&demoNow=…) and the phones' captures take, so every surface shows the same numbers.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BUILD = ROOT / 'build/showcase_v7.0.0'
MEDIA = ROOT / 'site/public/media/v7.0.0'
# The menu film ends at 14.4 s, back where it started, before any theme or language switch.
DURATION = {'dashboard': 16.5, 'gauges': 12.5, 'conversation': 24.5, 'accounts': 15.5, 'customize': 20.0, 'menu': 14.4}
CRF = {'dashboard': 25, 'gauges': 22, 'conversation': 24, 'accounts': 25, 'customize': 25, 'menu': 22}
SURFACE = '0x101216'  # the landing page film surface
PHASE = 8  # second of the minute at which the fixture starts
DEMO_NOW = sys.argv[sys.argv.index('--demo-now') + 1] if '--demo-now' in sys.argv else '1800000000'
# The gauges film keeps the four columns it is about next to each other, as a header drag would.
COLUMNS = ['session', 'model', 'period', 'rate', 'status', 'total', 'cpu', 'memory', 'controls']
WIDTHS = dict(period=190)  # wide enough that the period header stays on one line
scene = sys.argv[1]
assert scene in DURATION
lang = sys.argv[sys.argv.index('--lang') + 1] if '--lang' in sys.argv else 'ko'
assert lang in ('ko', 'en', 'zh')
name = f'{scene}-{lang}'
# The resting panel is also the hero motion's menu-bar panel, one per language.
outputs = [MEDIA / f'{name}.mp4', MEDIA / f'{name}.jpg'] + ([MEDIA / f'menu-panel-{lang}.png'] if scene == 'menu' else [])
# Only this version's own outputs may be replaced, and only on request.
assert '--replace' in sys.argv or not any(p.exists() for p in outputs), 'Preserve existing versioned media'
MEDIA.mkdir(parents=True, exist_ok=True)
TAKES = BUILD / 'takes'
TAKES.mkdir(parents=True, exist_ok=True)
take, mask = TAKES / f'{name}.mov', TAKES / f'{name}-mask.png'
prefs = dict(theme='dark', lang=lang, **(dict(columns=COLUMNS, widths=WIDTHS) if scene == 'gauges' else {}))


def shot(window, path):
    """One still of the window with transparent corners (no shadow)."""
    subprocess.run(['screencapture', '-T', '0', '-x', '-o', '-l', window, str(path)], check=True)


if '--now' not in sys.argv:
    time.sleep((PHASE - time.time()) % 60)
server = subprocess.Popen(['node', str(HERE / 'fixture_server.mjs'), str(BUILD / 'src'), lang, DEMO_NOW])
for _ in range(50):
    try:
        socket.create_connection(('127.0.0.1', 18868), timeout=.2).close(); break
    except OSError:
        time.sleep(.1)
app = subprocess.Popen([str(BUILD / 'capture-app'), '--ui-test'] + (['--quick-view'] if scene == 'menu' else []),
                       env={**os.environ, 'ONETOP_SCENE': scene, 'ONETOP_LANG': lang, 'ONETOP_DEMO_NOW': DEMO_NOW,
                            'ONETOP_PREFS': json.dumps(prefs), 'ONETOP_UI_TEST_PORT': '18868'},
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(BUILD / f'{name}.log', 'w'), text=True)
start = None
values = []


def listen():
    collecting = False
    for line in app.stdout:
        line = line.rstrip('\n')
        if line == 'RECORD_VALUES':
            collecting = True
        elif line == 'RECORD_VALUES_END':
            collecting = False
        elif collecting:
            values.append(line)
        print(f'{time.monotonic() - start:6.2f}s app: {line}', flush=True)


crop = window = None
report = []
try:
    # The gauges scene also reports the table region it keeps, in window points.
    while not window or (scene == 'gauges' and not crop):
        line = app.stdout.readline()
        if line.startswith('RECORD_CROP '):
            crop = [float(v) for v in line.split()[1:]]
        if line.startswith('RECORD_WINDOW '):
            window, width_pt = line.split()[1], float(line.split()[2])
        if not line: raise RuntimeError('Capture app exited before creating its window')
    # The still gives the window's shape; for the menu it is also the resting panel the hero uses.
    shot(window, mask)
    if scene == 'menu':
        shutil.copyfile(mask, MEDIA / f'menu-panel-{lang}.png')
    film = subprocess.Popen([str(BUILD / 'window-film'), window, str(take), str(DURATION[scene])],
                            stdout=subprocess.PIPE, stderr=open(BUILD / f'{name}.film.log', 'w'), text=True)
    for line in film.stdout:
        report.append(line.strip())
        if line.startswith('RECORDING'):
            # The timeline starts with the first recorded frame.
            start = time.monotonic()
            app.stdin.write('go\n'); app.stdin.flush()
            threading.Thread(target=listen, daemon=True).start()
    film.wait()
    print(f'{name}: {" · ".join(report)}', flush=True)
    time.sleep(.5)
finally:
    app.terminate(); app.wait(timeout=10)
    server.terminate(); server.wait(timeout=10)

(BUILD / f'{name}.values.txt').write_text('\n'.join(values) + '\n')
assert film.returncode == 0 and take.exists(), 'the recorder failed; see the .film.log'
assert not any(r.startswith('UNUSABLE') for r in report), 'another application covered the window; record again'
size = Image.open(mask).size
probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(take)],
                       check=True, capture_output=True, text=True).stdout.strip()
assert tuple(map(int, probe.split(','))) == size, f'take {probe} and window still {size} differ'

# The window's own shape (rounded corners, popover arrow) over the film surface colour.
if crop:
    # The table region at full capture resolution, with a small margin and even dimensions.
    scale = size[0] / width_pt
    x, y, w, h = crop[0] - 12, crop[1] - 8, crop[2] + 16, crop[3] + 14
    x, y, w, h = (round(v * scale) for v in (x, y, w, h))
    view = f'crop={w // 2 * 2}:{h // 2 * 2}:{x}:{y},scale=1200:-2:flags=lanczos'
else:
    view = 'scale=trunc(iw/4)*2:trunc(ih/4)*2:flags=lanczos'
graph = (f'[1:v]alphaextract[shape];[0:v]format=rgba[film];[film][shape]alphamerge[window];'
         f'color=c={SURFACE}:s={size[0]}x{size[1]}:r=30:d={DURATION[scene]}[surface];'
         f'[surface][window]overlay=shortest=1:format=auto,{view}')
source = ['-i', str(take), '-loop', '1', '-i', str(mask)]
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *source, '-filter_complex', f'{graph},fps=24,format=yuv420p',
                '-t', str(DURATION[scene]), '-c:v', 'libx264', '-preset', 'veryslow', '-crf', str(CRF[scene]),
                '-movflags', '+faststart', '-an', str(MEDIA / f'{name}.mp4')], check=True)
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *source, '-filter_complex', graph,
                '-frames:v', '1', '-q:v', '2', str(MEDIA / f'{name}.jpg')], check=True)
if '--keep' not in sys.argv:
    take.unlink()
print(MEDIA / f'{name}.mp4', flush=True)
