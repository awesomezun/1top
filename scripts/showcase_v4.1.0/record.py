"""Capture only the synthetic app window; encode versioned web media."""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build/showcase_v4.1.0'
MEDIA = ROOT / 'site/public/media/v4.1.0'
MEDIA.mkdir(parents=True, exist_ok=True)
scene = sys.argv[1]
assert scene in ('desktop', 'menu', 'accounts')
frames = BUILD / scene
frames.mkdir(exist_ok=True)
assert not (MEDIA / (scene+'.mp4')).exists(), 'Preserve existing versioned media'
process = subprocess.Popen([str(BUILD/'capture-app'), '--ui-test'] + ([] if scene == 'desktop' else ['--quick-view']),
    env={**os.environ, 'ONETOP_SCENE': scene, 'ONETOP_UI_TEST_PORT': '18868'},
    stdout=subprocess.PIPE, stderr=open(BUILD/(scene+'.log'), 'w'), text=True)
try:
    while True:
        line = process.stdout.readline()
        if line.startswith('RECORD_WINDOW '):
            window = line.split()[1]; break
        if not line: raise RuntimeError('Capture app exited before creating its window')
    time.sleep(.7)
    fps = 8
    duration = 18 if scene == 'desktop' else 14
    start = time.monotonic()
    for i in range(duration * fps):
        subprocess.run(['screencapture', '-x', '-o', '-l', window, str(frames/f'{i:04d}.png')], check=True)
        time.sleep(max(0, start + (i + 1)/fps - time.monotonic()))
    print(f'{scene}: captured {duration * fps} frames', flush=True)
finally:
    process.terminate(); process.wait(timeout=10)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-framerate',str(fps),'-i',str(frames/'%04d.png'),
    '-vf','scale=trunc(iw/4)*2:trunc(ih/4)*2,fps=24,format=yuv420p','-c:v','libx264','-preset','slow','-crf','18',
    '-movflags','+faststart','-an',str(MEDIA/(scene+'.mp4'))],check=True)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(frames/'0000.png'),
    '-vf','scale=trunc(iw/4)*2:trunc(ih/4)*2','-frames:v','1','-q:v','2',str(MEDIA/(scene+'.jpg'))],check=True)
print(MEDIA/(scene+'.mp4'), flush=True)
