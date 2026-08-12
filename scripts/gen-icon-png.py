#!/usr/bin/env python3
# 生成荣誉徽章 + 卦爻头像 PNG（128px，4x 超采样抗锯齿）
# 与 scripts/gen-assets.js 的 SVG 同款设计（方案A 国潮卦爻）
from PIL import Image, ImageDraw, ImageFont
import os, math

ROOT = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'images')
S = 512  # 4x

C = {'red': (163,45,45,255), 'gold': (186,117,23,255), 'ink': (44,44,42,255),
     'paper': (247,243,236,255), 'silver': (140,140,140,255),
     'redSoft': (252,235,235,255), 'goldSoft': (250,238,218,255), 'graySoft': (241,239,232,255)}

def canvas():
    img = Image.new('RGBA', (S, S), (0,0,0,0))
    return img, ImageDraw.Draw(img)

def save(img, rel):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.resize((128, 128), Image.LANCZOS).save(p)

def stroke(d, fn):
    fn(d, 30)   # 外描边宽
    fn(d, 14)   # 内描边宽

# ---------- 荣誉徽章 ----------
def badge(kind, sym):
    img, d = canvas()
    t = C['gold'] if kind=='gold' else C['silver'] if kind=='silver' else C['red']
    bg = C['goldSoft'] if kind=='gold' else C['graySoft'] if kind=='silver' else C['redSoft']
    d.ellipse((32,32,S-32,S-32), fill=bg, outline=t, width=26)
    sym(d, t)
    if kind != 'milestone':
        d.polygon([(S*0.36,S*0.72),(S*0.5,S*0.78),(S*0.64,S*0.72),(S*0.64,S*0.88),(S*0.5,S*0.81),(S*0.36,S*0.88)], fill=t)
        d.rounded_rectangle((S*0.45,S*0.78,S*0.55,S*0.82), 8, fill=C['paper'])
    return img

def sym_star(d,c): d.polygon([(S*0.5,S*0.2),(S*0.55,S*0.38),(S*0.72,S*0.38),(S*0.58,S*0.48),(S*0.63,S*0.66),(S*0.5,S*0.55),(S*0.37,S*0.66),(S*0.42,S*0.48),(S*0.28,S*0.38),(S*0.45,S*0.38)], fill=c)
def sym_flames(d,c):
    d.polygon([(S*0.33,S*0.52),(S*0.27,S*0.41),(S*0.34,S*0.31),(S*0.35,S*0.39),(S*0.39,S*0.41),(S*0.38,S*0.31),(S*0.42,S*0.25),(S*0.44,S*0.34),(S*0.48,S*0.37),(S*0.61,S*0.30),(S*0.64,S*0.44),(S*0.69,S*0.56),(S*0.56,S*0.64),(S*0.41,S*0.69),(S*0.33,S*0.60)], fill=c)
def sym_sevendots(d,c):
    for x,y,r in [(0.28,0.55,0.055),(0.5,0.55,0.055),(0.72,0.55,0.055),(0.34,0.39,0.055),(0.66,0.39,0.055),(0.41,0.28,0.055),(0.59,0.28,0.055)]:
        d.ellipse((S*x-S*r,S*y-S*r,S*x+S*r,S*y+S*r), fill=c)
def sym_sun(d,c):
    d.ellipse((S*0.36,S*0.33,S*0.64,S*0.61), fill=c)
    for i in range(8):
        a = math.pi*i/4
        x1,y1 = S*0.5+math.cos(a)*S*0.20, S*0.47+math.sin(a)*S*0.20
        x2,y2 = S*0.5+math.cos(a)*S*0.30, S*0.47+math.sin(a)*S*0.30
        d.line((x1,y1,x2,y2), fill=c, width=26)
def sym_eye(d,c):
    d.arc((S*0.19,S*0.34,S*0.81,S*0.78), 0, 360, fill=c, width=24)
    d.ellipse((S*0.45,S*0.42,S*0.55,S*0.52), fill=c)
def sym_crown(d,c):
    d.polygon([(S*0.27,S*0.64),(S*0.23,S*0.38),(S*0.39,S*0.47),(S*0.5,S*0.33),(S*0.61,S*0.47),(S*0.77,S*0.38),(S*0.73,S*0.64)], fill=c)
    d.rounded_rectangle((S*0.27,S*0.67,S*0.73,S*0.75), 12, fill=c)
def sym_shield(d,c):
    d.arc((S*0.34,S*0.24,S*0.66,S*0.78), 0, 360, fill=None)
    d.polygon([(S*0.5,S*0.22),(S*0.73,S*0.30),(S*0.73,S*0.47),(S*0.5,S*0.75),(S*0.27,S*0.47),(S*0.27,S*0.30)], outline=c, width=24)
    d.line((S*0.41,S*0.49,S*0.5,S*0.58,S*0.61,S*0.41), fill=c, width=22)
def sym_swords(d,c):
    d.line((S*0.31,S*0.31,S*0.69,S*0.69), fill=c, width=24)
    d.line((S*0.69,S*0.31,S*0.31,S*0.69), fill=c, width=24)
def sym_horn(d,c):
    d.polygon([(S*0.27,S*0.44),(S*0.31,S*0.27),(S*0.72,S*0.34),(S*0.69,S*0.45)], fill=c)
    d.polygon([(S*0.27,S*0.44),(S*0.20,S*0.47),(S*0.22,S*0.53),(S*0.31,S*0.52)], fill=c)
def sym_crowd(d,c):
    d.ellipse((S*0.41,S*0.26,S*0.59,S*0.44), fill=c)
    d.polygon([(S*0.23,S*0.69),(S*0.23,S*0.55),(S*0.41,S*0.53),(S*0.59,S*0.53),(S*0.77,S*0.55),(S*0.77,S*0.69)], fill=c)
def sym_cup(d,c):
    d.arc((S*0.36,S*0.25,S*0.64,S*0.56), 0, 360, fill=None)
    d.arc((S*0.27,S*0.30,S*0.42,S*0.52), 90, 270, fill=c, width=22)
    d.arc((S*0.58,S*0.30,S*0.73,S*0.52), -90, 90, fill=c, width=22)
    d.rounded_rectangle((S*0.41,S*0.59,S*0.59,S*0.65), 10, fill=c)
    d.line((S*0.5,S*0.65,S*0.5,S*0.73), fill=c, width=22)
def sym_medal(d,c):
    d.ellipse((S*0.35,S*0.28,S*0.65,S*0.58), outline=c, width=24)
    d.polygon([(S*0.43,S*0.58),(S*0.5,S*0.75),(S*0.57,S*0.58)], fill=c)
def sym_ring(d,c):
    d.ellipse((S*0.31,S*0.31,S*0.69,S*0.69), outline=c, width=28)
def sym_moon(d,c):
    d.arc((S*0.40,S*0.27,S*0.70,S*0.60), 0, 360, fill=None)
    d.pieslice((S*0.30,S*0.27,S*0.70,S*0.60), 0, 360, fill=c)
    d.pieslice((S*0.44,S*0.27,S*0.80,S*0.60), 0, 360, fill=C['redSoft'] if False else (255,0,0,0))
    d.polygon([(S*0.44,S*0.27),(S*0.70,S*0.27),(S*0.70,S*0.60),(S*0.44,S*0.60)], fill=(0,0,0,0))
def sym_gem(d,c):
    d.polygon([(S*0.5,S*0.2),(S*0.72,S*0.44),(S*0.5,S*0.75),(S*0.28,S*0.44)], outline=c, width=24)
    d.line((S*0.28,S*0.44,S*0.72,S*0.44), fill=c, width=18)
def sym_sword(d,c):
    d.line((S*0.47,S*0.24,S*0.72,S*0.24), fill=c, width=22)
    d.line((S*0.72,S*0.24,S*0.81,S*0.14), fill=c, width=22)
    d.rounded_rectangle((S*0.45,S*0.45,S*0.56,S*0.62), 10, fill=c)
    d.rounded_rectangle((S*0.45,S*0.64,S*0.56,S*0.70), 8, fill=c)

HON = [
    ('honor_first_bet','milestone',sym_star),('honor_streak_3','milestone',sym_flames),
    ('honor_streak_7','milestone',sym_sevendots),('honor_streak_10','milestone',sym_sun),
    ('honor_bet_50','milestone',sym_eye),('honor_bet_200','milestone',sym_crown),
    ('honor_pk_first','milestone',sym_shield),('honor_pk_10','milestone',sym_swords),
    ('honor_invite_first','milestone',sym_horn),('honor_invite_10','milestone',sym_crowd),
    ('rank_streak_top3','gold',sym_cup),('rank_streak_top10','silver',sym_medal),
    ('rank_week_top3','gold',sym_sun),('rank_week_top10','silver',sym_ring),
    ('rank_month_top3','gold',sym_moon),('rank_month_top10','silver',sym_moon),
    ('rank_total_top3','gold',sym_gem),('rank_total_top10','silver',sym_shield),
    ('rank_pk_top3','gold',sym_sword),('rank_pk_top10','silver',sym_sword),
]
for hid, kind, sym in HON:
    save(badge(kind, sym), 'honor/%s.png' % hid)

# ---------- 卦爻头像 ----------
HEX = [
    ('乾','SSS',(163,45,45),(252,235,235)),('兑','SSB',(186,117,23),(250,238,218)),
    ('离','SBS',(15,110,86),(225,245,238)),('震','BSS',(24,95,165),(230,241,251)),
    ('巽','SBB',(83,74,183),(238,237,254)),('坎','BSB',(153,53,86),(251,234,240)),
    ('艮','BBS',(95,94,90),(241,239,232)),('坤','BBB',(59,109,17),(234,243,222)),
    ('乾','SSS',(153,60,29),(250,236,231)),('离','SBS',(24,95,165),(181,212,244)),
    ('坎','BSB',(15,110,86),(159,225,203)),('坤','BBB',(83,74,183),(206,203,246)),
]
def avatar(name, pat, c, bg):
    img, d = canvas()
    d.ellipse((16,16,S-16,S-16), fill=bg, outline=c, width=22)
    ys = [S*0.34, S*0.47, S*0.60]
    for i, mode in enumerate(pat):
        y = ys[i]; w = S*0.36; h = S*0.0625; x0 = S*0.32; gap = S*0.094
        if mode == 'S':
            d.rounded_rectangle((x0,y,x0+w,y+h), 14, fill=c)
        else:
            d.rounded_rectangle((x0,y,x0+(w-gap)/2,y+h), 14, fill=c)
            d.rounded_rectangle((x0+(w+gap)/2,y,x0+w,y+h), 14, fill=c)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', 46)
    except Exception:
        f = ImageFont.load_default()
    d.text((S*0.5, S*0.86), name, font=f, fill=c, anchor='mm')
    return img

for i, (nm, pat, c, bg) in enumerate(HEX):
    save(avatar('avatar-%d' % (i+1), pat, c, bg), 'avatar/avatar-%d.png' % (i+1))

print('PNG 生成完成：honor', len(os.listdir(os.path.join(ROOT,'honor'))), '| avatar', len(os.listdir(os.path.join(ROOT,'avatar'))))
