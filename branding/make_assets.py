"""Makes every logo file the apps use from the two source images in branding/source/.

    python branding/make_assets.py          (needs Pillow and NumPy: pip install pillow numpy)

Run it again only when the artwork changes. The outputs are committed, so building the apps needs none of this.

  source/jellyflix-icon.png      the jellyfish on a grey glow (square)
  source/jellyflix-wordmark.png  the word "JellyFlix" on black

Writes:
  web/public/            icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, favicon.png
  web/src/assets/        logo.png (the jellyfish, transparent), wordmark.png (the word, transparent)
  tv/app/src/main/res/   drawable-nodpi/{logo,wordmark,banner,ic_launcher_foreground}.png
  branding/              banner.png (README header), social-preview.png (GitHub link preview, 1280x640)
"""
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / 'source'


def save(img: Image.Image, path: Path, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True, **kw)
    print('wrote', path.relative_to(ROOT), img.size)


def key_icon(im: Image.Image) -> Image.Image:
    """The jellyfish with its glow, the neutral grey background made transparent (colour, not grey, is what is kept)."""
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    chroma = a.max(axis=2) - a.min(axis=2)
    alpha = np.clip((chroma - 0.06) / (0.30 - 0.06), 0, 1) ** 0.9
    return Image.fromarray((np.dstack([a, alpha]) * 255).astype(np.uint8), 'RGBA')


def key_wordmark(im: Image.Image) -> Image.Image:
    """The word on black to the word on nothing: how much light a pixel has is how opaque it is."""
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    alpha = a.max(axis=2)
    safe = np.where(alpha > 0.004, alpha, 1.0)
    rgb = np.clip(a / safe[..., None], 0, 1)
    out = Image.fromarray((np.dstack([rgb, alpha]) * 255).astype(np.uint8), 'RGBA')
    box = Image.fromarray((alpha > 0.08).astype(np.uint8) * 255).getbbox()
    pad = 6
    return out.crop((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad))


def on_black(img: Image.Image, size: int) -> Image.Image:
    base = Image.new('RGBA', img.size, (0, 0, 0, 255))
    base.alpha_composite(img)
    return base.convert('RGB').resize((size, size), Image.LANCZOS)


def fit(img: Image.Image, width: int = 0, height: int = 0) -> Image.Image:
    w, h = img.size
    if width:
        return img.resize((width, round(h * width / w)), Image.LANCZOS)
    return img.resize((round(w * height / h), height), Image.LANCZOS)


icon = key_icon(Image.open(SRC / 'jellyflix-icon.png'))
word = key_wordmark(Image.open(SRC / 'jellyflix-wordmark.png'))

def soften(img: Image.Image, start: float = 0.62) -> Image.Image:
    """Fades the picture out towards its edges so the glow does not end in a hard square."""
    h, w = img.size[1], img.size[0]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot(x - (w - 1) / 2, y - (h - 1) / 2) / (min(w, h) / 2)
    fade = np.clip((1.0 - r) / (1.0 - start), 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    a = np.asarray(img).astype(np.float32)
    a[..., 3] *= fade
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


# The jellyfish with a little of its glow (app icons), and tight around the body (small logo and favicon).
glow = soften(icon.crop((112, 112, 912, 912)), 0.7)
body = soften(icon.crop((170, 140, 860, 830)), 0.66)

# Web
pub = ROOT / 'web' / 'public'
save(on_black(glow, 512), pub / 'icon-512.png')
save(on_black(glow, 192), pub / 'icon-192.png')
save(on_black(glow, 512), pub / 'icon-maskable-512.png')  # the body already sits inside the central 80%
save(on_black(glow, 180), pub / 'apple-touch-icon.png')
save(on_black(body, 64), pub / 'favicon.png')
save(body.resize((256, 256), Image.LANCZOS), ROOT / 'web' / 'src' / 'assets' / 'logo.png')
save(fit(word, width=640), ROOT / 'web' / 'src' / 'assets' / 'wordmark.png')

# TV
res = ROOT / 'tv' / 'app' / 'src' / 'main' / 'res' / 'drawable-nodpi'
save(body.resize((256, 256), Image.LANCZOS), res / 'logo.png')
save(fit(word, width=640), res / 'wordmark.png')
# The launcher icon: Android masks it, so the picture stays inside the middle two thirds of its 432 px square.
fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
mark = body.resize((300, 300), Image.LANCZOS)
fg.alpha_composite(mark, (66, 66))
save(fg, res / 'ic_launcher_foreground.png')


def lockup(width: int, height: int, mark_h: int, word_w: int) -> Image.Image:
    """The jellyfish and the word side by side, centred on black."""
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 255))
    m = body.resize((mark_h, mark_h), Image.LANCZOS)
    w = fit(word, width=word_w)
    gap = round(mark_h * 0.04)
    total = m.width + gap + w.width
    x = (width - total) // 2
    canvas.alpha_composite(m, (x, (height - m.height) // 2))
    canvas.alpha_composite(w, (x + m.width + gap, (height - w.height) // 2))
    return canvas.convert('RGB')


save(lockup(640, 360, 200, 330), res / 'banner.png')  # the Android TV home-screen banner (320x180 dp at 2x)
save(lockup(1600, 520, 420, 900), HERE / 'banner.png')
save(lockup(1280, 640, 360, 640), HERE / 'social-preview.png')
