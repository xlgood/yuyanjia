#!/usr/bin/env python3
# 生成 tabBar PNG（81×81，4x 超采样抗锯齿）
# 与 scripts/gen-assets.js 的 tabbar SVG 同款设计
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'images', 'tabbar')
S = 324          # 4x 超采样
GRAY = (163, 154, 139, 255)   # 常态 #a39a8b
RED = (163, 45, 45, 255)      # 选中 #a32d2d

def render(draw_fn, color):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_fn(d, color)
    return img.resize((81, 81), Image.LANCZOS)

def guawen(d, c):
    d.ellipse((S*0.22, S*0.28, S*0.78, S*0.84), outline=c, width=24)
    x0, w, h = S*0.36, S*0.28, 18
    y = [S*0.37, S*0.47, S*0.57]
    for i, yy in enumerate(y):
        if i == 1:
            d.rounded_rectangle((x0, yy, x0 + (w-48)//2, yy+h), 9, fill=c)
            d.rounded_rectangle((x0 + (w+48)//2, yy, x0+w, yy+h), 9, fill=c)
        else:
            d.rounded_rectangle((x0, yy, x0+w, yy+h), 9, fill=c)

def tianbang(d, c):
    d.rounded_rectangle((S*0.22, S*0.17, S*0.78, S*0.75), 20, outline=c, width=22)
    x0, w, h = S*0.32, S*0.36, 20
    for yy in (S*0.30, S*0.42, S*0.54):
        d.rounded_rectangle((x0, yy, x0+w, yy+h), 10, fill=c)
    d.polygon([(S*0.5, S*0.76), (S*0.445, S*0.84), (S*0.555, S*0.84)], fill=c)

def mine(d, c):
    d.ellipse((S*0.36, S*0.22, S*0.64, S*0.50), outline=c, width=22)
    d.arc((S*0.22, S*0.62, S*0.78, S*1.10), 180, 360, fill=c, width=22)

icons = {
    'guawen': guawen, 'tianbang': tianbang, 'mine': mine,
}
for name, fn in icons.items():
    render(fn, GRAY).save(os.path.join(OUT, name + '.png'))
    render(fn, RED).save(os.path.join(OUT, name + '-active.png'))
print('tabBar PNG 生成完成:', sorted(os.listdir(OUT)))
