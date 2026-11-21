#!/usr/bin/env python3
"""Writes agent/onetop/dist/themes/pairs.js (OneTop.PAIRS): where each theme draws its two headline instruments, the token speed
(data-cl-gauge="rate") and the limit burn (data-cl-gauge="burn"), in its 1280x480 drawing. A phone held upright (and a
narrow dashboard) shows those two cut out of the theme side by side, as large as the 1top dials, or the band from one
to the other (themes/compact.js); '크게 보기' shows the whole theme. Measured in Chromium from the themes' own sample figures; each box is padded a little and kept inside the
drawing.
  python3 scripts/theme_pairs.py           write it
  python3 scripts/theme_pairs.py --check   fail when it is behind the themes
"""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
THEMES = ROOT / 'agent/onetop/dist/themes'
OUT = THEMES / 'pairs.js'
PAD = 0.04

def measure():
    files = ['core.js'] + sorted(p.name for p in THEMES.glob('t[0-9][0-9]-[0-9][0-9].js'))
    page_html = '<!doctype html><html><body style="margin:0"><div id="art" style="width:1280px"></div>' + ''.join(
        f'<script>{(THEMES / f).read_text()}</script>' for f in files) + '</body></html>'
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 480})
            page.set_content(page_html)
            boxes = page.evaluate('''(pad)=>{
              const O=window.OneTop,d=O.snapshot(),art=document.getElementById('art'),out={};
              for(const t of O.THEMES.slice().sort((a,b)=>a.id.localeCompare(b.id))){
                art.innerHTML=O.render(t,d);const svg=art.querySelector('svg'),s=svg.getBoundingClientRect(),k=1280/s.width;
                const box=name=>{const el=svg.querySelector(`[data-cl-gauge="${name}"]`);if(!el)return null;const r=el.getBoundingClientRect();
                  let x=(r.left-s.left)*k,y=(r.top-s.top)*k,w=r.width*k,h=r.height*k;const p=Math.max(w,h)*pad;
                  x=Math.max(0,x-p);y=Math.max(0,y-p);w=Math.min(1280-x,w+2*p);h=Math.min(480-y,h+2*p);
                  return [x,y,w,h].map(v=>Math.round(v*10)/10);};
                out[t.id]={rate:box('rate'),burn:box('burn')};
              }
              return out;}''', PAD)
        finally:
            browser.close()
    return boxes

def text():
    return ('// Written by scripts/theme_pairs.py from the themes; do not edit. [x, y, width, height] in the 1280x480 drawing.\n'
            'window.OneTop.PAIRS=' + json.dumps(measure(), separators=(',', ':')) + ';\n')

if __name__ == '__main__':
    now = text()
    if '--check' in sys.argv:
        if not OUT.exists() or OUT.read_text() != now:
            sys.exit('pairs.js is behind the themes: python3 scripts/theme_pairs.py')
        print('pairs.js current')
    else:
        OUT.write_text(now)
        print(OUT, len(now))
