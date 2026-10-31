"""Draw the photo the conversation scene attaches: an invented checkout form whose discount-code
field shows an error. No real product, account or person appears. Usage: make_photo.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 960, 640
img = Image.new('RGB', (W, H), '#f4f6f8')
d = ImageDraw.Draw(img)
font = lambda size: ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
d.rounded_rectangle((180, 60, 780, 580), 22, fill='#ffffff', outline='#dfe3e8', width=2)
d.text((220, 96), 'Checkout', font=font(34), fill='#111518')
for i, (label, value) in enumerate([('Card number', '4242 4242 4242 4242'), ('Name on card', 'Demo Customer')]):
    y = 170 + i * 104
    d.text((220, y), label, font=font(19), fill='#5b6670')
    d.rounded_rectangle((220, y + 30, 740, y + 82), 10, fill='#ffffff', outline='#cfd5db', width=2)
    d.text((240, y + 44), value, font=font(22), fill='#111518')
y = 378
d.text((220, y), 'Discount code', font=font(19), fill='#5b6670')
d.rounded_rectangle((220, y + 30, 740, y + 82), 10, fill='#fff6f5', outline='#d9534f', width=3)
d.text((240, y + 44), 'SAVE20', font=font(22), fill='#111518')
d.text((220, y + 92), 'Code could not be applied', font=font(18), fill='#c0392b')
d.rounded_rectangle((220, 512, 740, 560), 12, fill='#13805f')
d.text((418, 522), 'Pay now', font=font(22), fill='#ffffff')
img.save(Path(__file__).resolve().parent / 'photo.png', optimize=True)
