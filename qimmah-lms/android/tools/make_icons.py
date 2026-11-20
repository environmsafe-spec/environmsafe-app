#!/usr/bin/env python3
"""Render legacy PNG launcher icons (API 21-25) matching the adaptive vector icon.

Usage: python3 tools/make_icons.py   (run from the android/ directory)
Writes app/src/main/res/mipmap-*/ic_launcher.png and ic_launcher_round.png.
Shapes are in the 108x108 adaptive-icon coordinate space, the same numbers as
app/src/main/res/drawable/ic_launcher_foreground.xml.
"""
import os
from PIL import Image, ImageDraw

NAVY = (0x1E, 0x3A, 0x8A, 255)
AMBER = (0xF5, 0x9E, 0x0B, 255)
WHITE = (255, 255, 255, 255)

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SS = 8  # supersampling factor

# Legacy icons show the region 18..90 of the 108 canvas (72 units), slightly
# zoomed in so the artwork fills the icon like the adaptive one does.
VIEW_MIN, VIEW_SIZE = 19.0, 70.0

SHAPES = [
    (AMBER, [(29, 64), (44, 43), (59, 64)]),
    (WHITE, [(39, 64), (58, 33), (79, 64)]),
    (WHITE, [(35, 68.5), (53, 71.5), (53, 79.5), (35, 76.5)]),
    (WHITE, [(55, 71.5), (73, 68.5), (73, 76.5), (55, 79.5)]),
    (AMBER, [(53, 71.5), (55, 71.5), (55, 79.5), (54, 80.5), (53, 79.5)]),
]
SNOW_LINE = [(52.2, 42.5), (55.3, 46), (58.3, 43), (61.4, 46), (64.4, 42.5)]


def render(px, round_shape):
    big = px * SS
    scale = big / VIEW_SIZE

    def tx(pt):
        return ((pt[0] - VIEW_MIN) * scale, (pt[1] - VIEW_MIN) * scale)

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    margin = big * 0.04
    box = [margin, margin, big - margin, big - margin]
    if round_shape:
        d.ellipse(box, fill=NAVY)
    else:
        d.rounded_rectangle(box, radius=big * 0.18, fill=NAVY)
    for colour, pts in SHAPES:
        d.polygon([tx(p) for p in pts], fill=colour)
    d.line([tx(p) for p in SNOW_LINE], fill=NAVY, width=max(1, round(1.6 * scale)), joint="curve")
    return img.resize((px, px), Image.LANCZOS)


def main():
    res = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "main", "res")
    for density, px in SIZES.items():
        out = os.path.join(res, f"mipmap-{density}")
        os.makedirs(out, exist_ok=True)
        render(px, False).save(os.path.join(out, "ic_launcher.png"), optimize=True)
        render(px, True).save(os.path.join(out, "ic_launcher_round.png"), optimize=True)
        print(f"{density}: {px}px")


if __name__ == "__main__":
    main()
