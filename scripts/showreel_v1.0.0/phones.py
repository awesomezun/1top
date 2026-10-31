"""Phone screens for the landing and the showreel, from the frontend's captures at the demo moment.

Usage: phones.py <folder>   e.g. ../frontend-redesign/output/landing-phones_v7.2.0
The folder holds iphone-<lang>.png (1206x2622, masked like the device) and android-<lang>.png (1080x2400), and
no-mask/iphone-<lang>.png. The landing gets the masked screens at half size as site/public/media/v7.0.0/*.jpg; the
showreel gets the unmasked iPhone screens in build/showreel_v1.0.0/stills/, because its device frame draws the
corners and the Dynamic Island.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1])
SIZE = {'iphone': (603, 1311), 'android': (540, 1200)}
(ROOT / 'build/showreel_v1.0.0/stills').mkdir(parents=True, exist_ok=True)
for lang in ('ko', 'en', 'zh'):
    for device, size in SIZE.items():
        shot = Image.open(SRC / f'{device}-{lang}.png').convert('RGB').resize(size, Image.LANCZOS)
        shot.save(ROOT / f'site/public/media/v7.0.0/{device}-{lang}.jpg', quality=86, optimize=True, progressive=True)
        bare = SRC / 'no-mask' / f'{device}-{lang}.png'
        reel = Image.open(bare if bare.exists() else SRC / f'{device}-{lang}.png').convert('RGB').resize(size, Image.LANCZOS)
        reel.save(ROOT / f'build/showreel_v1.0.0/stills/{device}-{lang}.jpg', quality=90, optimize=True)
        print(device, lang, flush=True)
