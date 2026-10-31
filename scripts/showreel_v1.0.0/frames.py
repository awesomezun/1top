"""Cut the parts of each full-resolution take the showreel uses into constant 30 fps frames.

Usage: frames.py [--lang ko|en|zh ...] [--scene <scene> ...]   (default: every language and scene)
Reads build/showreel_v1.0.0/takes/<scene>-<lang>.mov (take.py) and writes
build/showreel_v1.0.0/frames/<scene>-<lang>/0000.jpg ... with frames.json, which records the take
second each folder starts at. Frame i shows the take at start + i / 30 s. The menu-bar panel keeps the
transparent corners and arrow of its window still, so it is written as PNG.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build/showreel_v1.0.0'
FPS = 30
# Take seconds (start, end) each scene of the reel draws from; see reel/reel.js.
RANGES = {'dashboard': (0.0, 15.5), 'conversation': (0.5, 21.5), 'customize': (12.5, 19.4),
          'accounts': (3.5, 11.0), 'menu': (0.5, 11.5)}
langs = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--lang'] or ['ko', 'en', 'zh']
scenes = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--scene'] or list(RANGES)
index = {}
for lang in langs:
    for scene in scenes:
        start, end = RANGES[scene]
        name = f'{scene}-{lang}'
        take, mask = BUILD / 'takes' / f'{name}.mov', BUILD / 'takes' / f'{name}-mask.png'
        out = BUILD / 'frames' / name
        out.mkdir(parents=True, exist_ok=True)
        for old in out.glob('*.*'):
            old.unlink()
        if scene == 'menu':
            graph = f'[0:v]fps={FPS},format=rgba[f];[1:v]alphaextract,format=gray[a];[f][a]alphamerge=shortest=1'
            target, extra = out / '%04d.png', []
        else:
            graph = f'[0:v]fps={FPS},format=yuvj444p'
            target, extra = out / '%04d.jpg', ['-q:v', '2']
        # The fps filter is fed from the take's start so frame times stay on the 30 fps grid of the take.
        inputs = ['-i', str(take)] + (['-loop', '1', '-i', str(mask)] if scene == 'menu' else [])
        subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs,
                        '-filter_complex', f'{graph},trim=start={start}:end={end},setpts=PTS-STARTPTS',
                        *extra, '-start_number', '0', str(target)], check=True)
        count = len(list(out.glob('*.*')))
        index[name] = dict(start=start, fps=FPS, count=count, ext=target.suffix)
        print(name, count, flush=True)
manifest = BUILD / 'frames/frames.json'
merged = json.loads(manifest.read_text()) if manifest.exists() else {}
merged.update(index)
manifest.write_text(json.dumps(merged, indent=1))
