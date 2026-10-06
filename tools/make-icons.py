# Draws the app icon (a ledger page with a green +) at the sizes phones need.
# Usage: python3 tools/make-icons.py   (needs Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

INK, PAPER, GREEN = '#1B2232', '#F3EFE7', '#0E7C57'
OUT = Path(__file__).resolve().parent.parent / 'src'

def icon(size):
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

for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    icon(size).save(OUT / name)
    print('wrote', name)
