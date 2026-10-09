# Draws the app icon at the sizes phones need, and the wide logo (logo-wide.png): the company's "B" mark on white, cut from private/brand/logo.png
# (that file is the owner's and stays out of the public repo; only the finished icons are published).
# Without it, a plain ledger icon is drawn instead.
# Usage: python3 tools/make-icons.py   (needs Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src'
LOGO = ROOT / 'private' / 'brand' / 'logo.png'
MARK_RIGHT = 0.293  # the B mark is the left part of the logo, before the words start (fraction of the width)
INK, PAPER, GREEN = '#1B2232', '#F3EFE7', '#0E7C57'

def mark():
    logo = Image.open(LOGO).convert('RGBA')
    part = logo.crop((0, 0, int(logo.width * MARK_RIGHT), logo.height))
    return part.crop(part.getbbox())  # just the ink

def logo_icon(size, m):
    big = size * 4
    im = Image.new('RGB', (big, big), 'white')
    k = big * 0.72 / max(m.width, m.height)  # leave room: phones round off the corners
    m2 = m.resize((round(m.width * k), round(m.height * k)), Image.LANCZOS)
    im.paste(m2, ((big - m2.width) // 2, (big - m2.height) // 2), m2)
    return im.resize((size, size), Image.LANCZOS)

def ledger_icon(size):
    big = size * 4  # draw large, then shrink for smooth edges
    s = big / 512
    im = Image.new('RGB', (big, big), INK)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([150 * s, 110 * s, 362 * s, 402 * s], radius=30 * s, fill=PAPER)
    for y, x2 in [(175, 322), (225, 322), (275, 280)]:
        d.rounded_rectangle([190 * s, y * s, x2 * s, (y + 20) * s], radius=10 * s, fill=INK)
    cx, cy, r = 345 * s, 355 * s, 66 * s
    d.ellipse([cx - r - 12 * s, cy - r - 12 * s, cx + r + 12 * s, cy + r + 12 * s], fill=INK)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    d.rounded_rectangle([cx - 32 * s, cy - 9 * s, cx + 32 * s, cy + 9 * s], radius=9 * s, fill='white')
    d.rounded_rectangle([cx - 9 * s, cy - 32 * s, cx + 9 * s, cy + 32 * s], radius=9 * s, fill='white')
    return im.resize((size, size), Image.LANCZOS)

m = mark() if LOGO.exists() else None
if LOGO.exists():  # the whole logo (mark and words) for the app's headings and slips without a letterhead
    full = Image.open(LOGO).convert('RGBA')
    full = full.crop(full.getbbox())
    full.resize((round(full.width * 180 / full.height), 180), Image.LANCZOS).save(OUT / 'logo-wide.png', optimize=True)
    print('wrote logo-wide.png')
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    (logo_icon(size, m) if m else ledger_icon(size)).save(OUT / name)
    print('wrote', name, '(company mark)' if m else '(ledger)')
