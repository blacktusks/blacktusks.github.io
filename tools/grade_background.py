#!/usr/bin/env python3
"""Colour the main-menu backgrounds to match the clan banner.

Reads the untouched pictures from tools/art (that folder is kept out of the repository, so put the
originals there first) and writes the files the app uses:
  public/img/largashbur.webp, largashbur-dim.webp   the Black Tusks' home screen, and behind their inner screens
  public/img/narzulbur.webp,  narzulbur-dim.webp    the same for the Scorned, with the same red grade

  python3 tools/grade_background.py [largashbur|narzulbur]

Needs Pillow and NumPy. Change MIX for a weaker or stronger tint (0 = none, 1 = red only).
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "img")
MIX = 0.62                                  # how far toward the red ramp
SHADOW, MID, HIGH = (16, 4, 4), (168, 58, 40), (255, 208, 180)   # dark blood, banner red, warm bone
CONTRAST = 1.1
# name: (original, lift on the brightness before grading, size of the dimmed copy)
PICTURES = {
    "largashbur": ("largashbur-original.webp", 1.0, (1200, 900)),
    # Narzulbur is a darker, snowier screenshot (the longhouse at dusk, the game's HUD painted out and cropped
    # away): lifted a little first, so both strongholds sit at the same depth
    "narzulbur": ("narzulbur-original.png", 1.2, (1200, 556)),
}

def grade(name):
    src_name, lift, dim_size = PICTURES[name]
    src = Image.open(os.path.join(HERE, "art", src_name)).convert("RGB")
    a = np.clip(np.asarray(src).astype(np.float32) / 255.0 * lift, 0, 1)
    lum = (a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722)[..., None]
    lo, mi, hi = (np.array(c, np.float32) / 255 for c in (SHADOW, MID, HIGH))
    ramp = np.where(lum < 0.5, lo + (mi - lo) * (lum / 0.5), mi + (hi - mi) * ((lum - 0.5) / 0.5))
    out = np.clip(((a * (1 - MIX) + ramp * MIX) - 0.5) * CONTRAST + 0.5, 0, 1)
    graded = Image.fromarray((out * 255).astype(np.uint8))
    graded.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
    dim = graded.resize(dim_size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    dim = Image.fromarray((np.asarray(dim).astype(np.float32) * 0.36).astype(np.uint8))
    dim.save(os.path.join(OUT, f"{name}-dim.webp"), quality=60, method=6)
    for f in (f"{name}.webp", f"{name}-dim.webp"):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")

for name in sys.argv[1:] or [n for n, (f, _, _) in PICTURES.items() if os.path.exists(os.path.join(HERE, "art", f))]:
    grade(name)
