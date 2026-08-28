"""
Rasterise the Coach Diaz badge from the SAME geometry as Logo.jsx.

The in-app mark fills from CSS variables so it re-themes. A home-screen icon
cannot: it is a fixed file, chosen once. So it is pinned to the dark palette,
which is the :root default and what the app looks like before any preference is
read.

Drawn with PIL rather than by rasterising the JSX, because the JSX is a React
component. The coordinates below are copied from it and a test asserts they
still match.
"""
from PIL import Image, ImageDraw
import math

SURFACE   = (0x1b, 0x18, 0x30, 255)
SECONDARY = (0x22, 0xd3, 0xd3, 255)
ACCENT    = (0xff, 0x4f, 0x9a, 255)
TEXT      = (0xf5, 0xf3, 0xf7, 255)
BG        = (0x0f, 0x0d, 0x1a, 255)

VB = 200.0
SS = 8  # supersample; the hexagon has long diagonals that alias badly at 1x

OUTER = [(52,6),(148,6),(194,100),(148,194),(52,194),(6,100)]
INNER = [(56,20),(144,20),(178,100),(144,180),(56,180),(22,100)]

def draw_badge(size, inset, compact, background):
    """inset: fraction of the canvas the badge occupies (1.0 = full bleed)."""
    n = size * SS
    img = Image.new("RGBA", (n, n), background)
    d = ImageDraw.Draw(img)

    scale = (n / VB) * inset
    off = (n - VB * scale) / 2.0
    def P(pts): return [(x*scale+off, y*scale+off) for x, y in pts]
    def W(w): return max(1, int(round(w * scale)))

    d.polygon(P(OUTER), fill=SURFACE, outline=SECONDARY, width=W(14 if compact else 11))
    if not compact:
        d.line(P(INNER + [INNER[0]]), fill=ACCENT, width=W(4), joint="curve")

    bars = ([((46,100),(154,100),18), ((66,60),(66,140),28), ((134,60),(134,140),28)]
            if compact else
            [((40,100),(160,100),14), ((62,66),(62,134),22), ((138,66),(138,134),22),
             ((88,80),(88,120),13), ((112,80),(112,120),13)])
    for a, b, w in bars:
        (ax, ay), (bx, by) = P([a, b])
        d.line([(ax, ay), (bx, by)], fill=TEXT, width=W(w))
        r = W(w) / 2.0  # strokeLinecap="round"
        for cx, cy in ((ax, ay), (bx, by)):
            d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=TEXT)

    return img.resize((size, size), Image.LANCZOS)

def save(img, path):
    img.save(path, "PNG", optimize=True)
    print(path)

# Standard icons: transparent outside the badge, near full bleed.
save(draw_badge(192, 0.98, compact=False, background=(0,0,0,0)), "web/public/icons/icon-192.png")
save(draw_badge(512, 0.98, compact=False, background=(0,0,0,0)), "web/public/icons/icon-512.png")

# Maskable: Android crops to an arbitrary shape and only the centre 80% is
# guaranteed visible, so the badge is scaled into that safe zone and the rest is
# filled. Full bleed here would have the hexagon's points shaved off.
save(draw_badge(512, 0.62, compact=False, background=BG), "web/public/icons/icon-maskable-512.png")

# iOS does not composite a background behind the touch icon and ignores
# maskable, so this one carries its own and sits inside Apple's own corner
# radius.
save(draw_badge(180, 0.82, compact=False, background=BG), "web/public/icons/apple-touch-icon.png")

# Favicon uses the COMPACT geometry, for the reason Logo.jsx gives: below 32px
# the inner sleeves merge into a blob.
save(draw_badge(32, 0.98, compact=True, background=(0,0,0,0)), "web/public/icons/favicon-32.png")
save(draw_badge(16, 0.98, compact=True, background=(0,0,0,0)), "web/public/icons/favicon-16.png")
