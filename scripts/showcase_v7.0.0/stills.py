"""Stills for the landing: the Windows tray quick view and 1top.si/app, in Korean, English and Chinese.

Usage: stills.py tray [--replace]   quick.html from the capture source, served by fixture_server.mjs,
                                    rendered in Chromium (WebView2's engine) at the tray panel size
       stills.py web [--replace]    /app?demo=1 from a running site dev server (default http://127.0.0.1:5197)
       --out=<folder>               write somewhere else than site/public/media/v7.0.0 (the showreel uses this)
       --demo-now=<s>               the demo moment (default 1800000000), held by the fixture, the page and its clock
       --lang=ko[,en,zh]            only these languages (default all three)
Both use only invented demo data. Existing v7.0.0 files are kept unless --replace is given.
"""
import asyncio
import io
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BUILD = ROOT / 'build/showcase_v7.0.0'
MEDIA = Path(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--out=')), ROOT / 'site/public/media/v7.0.0'))
SITE = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--site=')), 'http://127.0.0.1:5197')
LANGS = tuple(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--lang=')), 'ko,en,zh').split(','))
assert set(LANGS) <= {'ko', 'en', 'zh'}
DEMO_NOW = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--demo-now=')), 1800000000))
kind = sys.argv[1]
assert kind in ('tray', 'web')
outputs = [MEDIA / (f'tray-{l}.png' if kind == 'tray' else f'web-{l}.jpg') for l in LANGS]
assert '--replace' in sys.argv or not any(p.exists() for p in outputs), 'Preserve existing versioned media'
MEDIA.mkdir(parents=True, exist_ok=True)
PREFS = "localStorage.setItem('onetop.dashboard.v1',JSON.stringify({theme:'dark',lang:'%s'}))"


def serve(lang):
    server = subprocess.Popen(['node', str(HERE / 'fixture_server.mjs'), str(BUILD / 'src'), lang, str(DEMO_NOW)])
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', 18868), timeout=.2).close(); return server
        except OSError:
            time.sleep(.1)
    raise RuntimeError('fixture server did not start')


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        for lang, out in zip(LANGS, outputs):
            server = serve(lang) if kind == 'tray' else None
            try:
                size = {'width': 440, 'height': 800} if kind == 'tray' else {'width': 1640, 'height': 1028}
                ctx = await browser.new_context(viewport=size, device_scale_factor=2, locale={'ko': 'ko-KR', 'en': 'en-US', 'zh': 'zh-CN'}[lang])
                await ctx.add_init_script(PREFS % lang)
                page = await ctx.new_page()
                # The page's clock holds at the demo moment too, as /app?demo&demoNow=… holds its own.
                await page.clock.set_fixed_time(datetime.fromtimestamp(DEMO_NOW, tz=timezone.utc))
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                await page.goto('http://127.0.0.1:18868/quick.html' if kind == 'tray' else f'{SITE}/app?demo=1&demoNow={DEMO_NOW}')
                await page.wait_for_timeout(5000)
                assert not errors, errors
                png = await page.screenshot()
                image = Image.open(io.BytesIO(png))
                if kind == 'tray':
                    image.save(out, optimize=True)
                else:
                    image.convert('RGB').save(out, quality=84, optimize=True, progressive=True)
                print(out, image.size, flush=True)
                await ctx.close()
            finally:
                if server:
                    server.terminate(); server.wait(timeout=10)
        await browser.close()

asyncio.run(main())
