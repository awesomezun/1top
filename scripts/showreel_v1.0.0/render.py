"""Draw the showreel frame by frame in Chrome and encode it.

Usage: render.py stills <seconds> ... [--lang ko|en|zh ...]   PNG checks in build/showreel_v1.0.0/check/
       render.py film [--lang ...]                               lossless master build/showreel_v1.0.0/master-<lang>.mkv
       render.py encode [--lang ...]                             MP4 (H.264), WebM (VP9) and the poster JPEG next to the
                                                                 landing media as showreel-v1.0.0-<lang>.*; existing files are kept
The page is reel/index.html, served from the repository root on 127.0.0.1:18871 (18872 and 18873 for the second and
third language, so one process per language can run side by side). Languages are drawn one after another in a
process. Every frame is a pure function of its time (reel/reel.js), so frames come out the same however often they
are drawn. Run take.py and frames.py first.
"""
import asyncio
import base64
import functools
import http.server
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build/showreel_v1.0.0'
MEDIA = ROOT / 'site/public/media/v7.0.0'
FPS, DURATION = 30, 45
POSTER_AT = 2.4  # the logo and the tagline, fully in
langs = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--lang'] or ['ko', 'en', 'zh']
mode = sys.argv[1]
assert mode in ('stills', 'film', 'encode')
PORT = 18871 + ['ko', 'en', 'zh'].index(langs[0])


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    class Server(http.server.ThreadingHTTPServer):
        request_queue_size = 256  # the default backlog of 5 drops requests when the page loads many images at once
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = Server(('127.0.0.1', PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


async def draw(lang, times, sink):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        # Chrome otherwise may paint a large image blank while its decode is deferred (checker imaging), or show a
        # frame before every compositor stage ran; both make busy renders differ from quiet ones.
        browser = await p.chromium.launch(channel='chrome', args=['--disable-checker-imaging', '--run-all-compositor-stages-before-draw'])
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(f'http://127.0.0.1:{PORT}/scripts/showreel_v1.0.0/reel/index.html?lang={lang}')
        await page.wait_for_function('window.reelReady === true', timeout=60000)
        cdp = await page.context.new_cdp_session(page)
        for n, t in enumerate(times):
            await page.evaluate('t => window.seek(t)', t)
            # The clip keeps the full 1920x1080 stage; without it Chrome returns only its window's height.
            shot = await cdp.send('Page.captureScreenshot', {'format': 'png', 'optimizeForSpeed': True, 'captureBeyondViewport': True,
                                                             'clip': {'x': 0, 'y': 0, 'width': 1920, 'height': 1080, 'scale': 1}})
            sink(n, t, base64.b64decode(shot['data']))
            if n % 150 == 0:
                print(f'{lang} {t:5.1f}s', flush=True)
        assert not errors, errors
        await browser.close()


async def main():
    server = serve()
    try:
        if mode == 'stills':
            times = [float(a) for a in sys.argv[2:] if not a.startswith('--') and a not in langs]
            out = BUILD / 'check'
            out.mkdir(parents=True, exist_ok=True)

            def save(lang):
                return lambda n, t, png: (out / f'{lang}-{t:05.2f}.png').write_bytes(png)
            for lang in langs:
                await draw(lang, times, save(lang))
        else:
            async def film(lang):
                enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'png', '-i', '-',
                                        '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', str(BUILD / f'master-{lang}.mkv')],
                                       stdin=subprocess.PIPE)
                await draw(lang, [n / FPS for n in range(DURATION * FPS)], lambda n, t, png: enc.stdin.write(png))
                enc.stdin.close()
                assert enc.wait() == 0
            for lang in langs:
                await film(lang)
    finally:
        server.shutdown()


def encode(lang):
    master = BUILD / f'master-{lang}.mkv'
    outs = {k: MEDIA / f'showreel-v1.0.0-{lang}.{k}' for k in ('mp4', 'webm', 'jpg')}
    assert '--replace' in sys.argv or not any(p.exists() for p in outs.values()), 'Keep the existing showreel files'
    run = lambda *a: subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(master), *a], check=True)
    # Screen footage with flat dark areas: x264 tuned for animation, keyframes every two seconds for quick seeking.
    # CRF 27 and VP9 CRF 41 keep about 5 MB per language; small text looked the same as at CRF 24 and 37.
    run('-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', '27', '-g', '60',
        '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart', '-an', str(outs['mp4']))
    run('-vf', 'format=yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '41', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1',
        '-g', '60', '-an', str(outs['webm']))
    run('-ss', str(POSTER_AT), '-frames:v', '1', '-q:v', '3', str(outs['jpg']))
    for p in outs.values():
        print(p.relative_to(ROOT), f'{p.stat().st_size / 1e6:.2f} MB', flush=True)


if mode == 'encode':
    for lang in langs:
        encode(lang)
else:
    asyncio.run(main())
