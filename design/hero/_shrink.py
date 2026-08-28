"""Downsample the generated masters into canvas-sized copies (<70 KB each).

Sprites keep alpha, so they stay PNG and get palette-quantised; the scene and
the frame sequence have no alpha, so they go to JPEG, which is what actually
buys the headroom.
"""
import os
from PIL import Image

SRC = "web/public/hero"
DST = "web/public/hero/canvas"
LIMIT = 70 * 1024

def save_png(im, path):
    for colors in (256, 192, 128, 96, 64):
        q = im.convert("RGBA")
        # quantise RGB, keep a hard alpha so the wobbly ink edge stays clean
        alpha = q.getchannel("A")
        p = q.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT).convert("RGBA")
        p.putalpha(alpha)
        p.save(path, optimize=True)
        if os.path.getsize(path) <= LIMIT:
            return colors
    return colors

def save_jpg(im, path):
    for q in (80, 72, 64, 56, 48):
        im.convert("RGB").save(path, quality=q, optimize=True, progressive=True)
        if os.path.getsize(path) <= LIMIT:
            return q
    return q

sprites = ["plane", "ipad", "hand", "printer"]
flats = ["scene", "c1", "c2", "c3", "c4", "c5", "c6"]

for n in sprites:
    src = f"{SRC}/{n}.png"
    if not os.path.exists(src):
        print(f"{n}: MISSING"); continue
    im = Image.open(src).convert("RGBA")
    im.thumbnail((440, 440), Image.LANCZOS)
    # crop to the painted content so the sprite has no dead margin to position around
    bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bb: im = im.crop(bb)
    out = f"{DST}/{n}.png"
    c = save_png(im, out)
    print(f"{n:8s} {im.size} {os.path.getsize(out)//1024:3d} KB  ({c} colours)")

for n in flats:
    src = f"{SRC}/{n}.png"
    if not os.path.exists(src):
        print(f"{n}: MISSING"); continue
    im = Image.open(src)
    im.thumbnail((900, 900), Image.LANCZOS)
    out = f"{DST}/{n}.jpg"
    q = save_jpg(im, out)
    print(f"{n:8s} {im.size} {os.path.getsize(out)//1024:3d} KB  (q{q})")
