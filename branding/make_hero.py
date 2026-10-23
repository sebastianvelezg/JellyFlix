"""Composes docs/screenshots/hero.jpg (the README's main picture) from three screenshots:

    python branding/make_hero.py          (needs Pillow and NumPy)

A browser window with the web app, a TV with the TV app and a phone with the web app, on the project's black-and-violet glow.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screenshots'
W, H = 1600, 840


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def shadowed(canvas: Image.Image, layer: Image.Image, xy: tuple[int, int], blur: int = 28, offset: int = 18, alpha: int = 170) -> None:
    pad = blur * 3
    sh = Image.new('RGBA', (layer.width + pad * 2, layer.height + pad * 2), (0, 0, 0, 0))
    black = Image.new('RGBA', layer.size, (0, 0, 0, alpha))
    sh.paste(black, (pad, pad), layer.split()[-1])
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh, (xy[0] - pad, xy[1] - pad + offset))
    canvas.alpha_composite(layer, xy)


def backdrop() -> Image.Image:
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)

    def glow(cx, cy, r, color, strength):
        d = np.hypot(x - cx, y - cy) / r
        a = np.clip(1 - d, 0, 1) ** 2 * strength
        return a[..., None] * np.array(color, dtype=np.float32)

    img = glow(300, 250, 900, (139, 92, 246), 0.55) + glow(1350, 650, 950, (14, 165, 233), 0.5) + glow(800, 880, 700, (79, 70, 229), 0.25)
    img = np.clip(img + 6, 0, 255)
    return Image.fromarray(img.astype(np.uint8)).convert('RGBA')


def browser(shot: Image.Image) -> Image.Image:
    bar = 34
    frame = Image.new('RGBA', (shot.width, shot.height + bar), (24, 24, 27, 255))
    d = ImageDraw.Draw(frame)
    for i, c in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
        d.ellipse((16 + i * 22, 11, 28 + i * 22, 23), fill=c)
    d.rounded_rectangle((frame.width // 2 - 170, 7, frame.width // 2 + 170, 27), 10, fill=(39, 39, 42, 255))
    frame.paste(shot.convert('RGBA'), (0, bar))
    return rounded(frame, 14)


def tv(shot: Image.Image) -> Image.Image:
    bezel = 9
    screen = shot.convert('RGBA')
    frame = Image.new('RGBA', (screen.width + bezel * 2, screen.height + bezel * 2 + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(frame)
    d.rounded_rectangle((0, 0, frame.width - 1, screen.height + bezel * 2 - 1), 14, fill=(12, 12, 14, 255), outline=(58, 58, 64, 255), width=2)
    frame.paste(rounded(screen, 8), (bezel, bezel), rounded(screen, 8))
    # a slim stand
    d.polygon([(frame.width // 2 - 110, screen.height + bezel * 2), (frame.width // 2 + 110, screen.height + bezel * 2),
               (frame.width // 2 + 150, frame.height - 2), (frame.width // 2 - 150, frame.height - 2)], fill=(20, 20, 24, 255))
    return frame


def phone(shot: Image.Image) -> Image.Image:
    bezel = 8
    screen = rounded(shot, 26)
    frame = Image.new('RGBA', (screen.width + bezel * 2, screen.height + bezel * 2), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), 34, fill=(10, 10, 12, 255), outline=(70, 70, 78, 255), width=2)
    frame.paste(screen, (bezel, bezel), screen)
    return frame


canvas = backdrop()
web = Image.open(SHOTS / 'web-home.jpg').convert('RGB')
tvs = Image.open(SHOTS / 'tv-home.jpg').convert('RGB').resize((800, 450), Image.LANCZOS)
mob = Image.open(SHOTS / 'web-mobile.jpg').convert('RGB')
mob = mob.resize((round(mob.width * 440 / mob.height), 440), Image.LANCZOS)

shadowed(canvas, browser(web), (40, 80))
shadowed(canvas, phone(mob), (1335, 120))
shadowed(canvas, tv(tvs), (540, 270))

out = canvas.convert('RGB')
out.save(SHOTS / 'hero.jpg', quality=90, optimize=True)
print('wrote', (SHOTS / 'hero.jpg').relative_to(ROOT), out.size)
