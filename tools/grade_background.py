#!/usr/bin/env python3
"""Colour the main-menu background to match the clan banner.

Reads the untouched screenshot (tools/art/largashbur-original.webp; that folder
is kept out of the repository, so put the original there first) and writes the
two files the app uses:
  public/img/largashbur.webp      the main menu, graded toward the banner's red
  public/img/largashbur-dim.webp  the same, blurred and darkened, behind inner screens

Needs Pillow and NumPy. Change MIX for a weaker or stronger tint (0 = none, 1 = red only).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "art", "largashbur-original.webp")
OUT = os.path.join(HERE, "..", "public", "img")
MIX = 0.62                                  # how far toward the red ramp
SHADOW, MID, HIGH = (16, 4, 4), (168, 58, 40), (255, 208, 180)   # dark blood, banner red, warm bone
CONTRAST = 1.1

src = Image.open(SRC).convert("RGB")
a = np.asarray(src).astype(np.float32) / 255.0
lum = (a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722)[..., None]
lo, mi, hi = (np.array(c, np.float32) / 255 for c in (SHADOW, MID, HIGH))
ramp = np.where(lum < 0.5, lo + (mi - lo) * (lum / 0.5), mi + (hi - mi) * ((lum - 0.5) / 0.5))
out = np.clip(((a * (1 - MIX) + ramp * MIX) - 0.5) * CONTRAST + 0.5, 0, 1)
graded = Image.fromarray((out * 255).astype(np.uint8))
graded.save(os.path.join(OUT, "largashbur.webp"), quality=80, method=6)

dim = graded.resize((1200, 900), Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
dim = Image.fromarray((np.asarray(dim).astype(np.float32) * 0.36).astype(np.uint8))
dim.save(os.path.join(OUT, "largashbur-dim.webp"), quality=60, method=6)
for f in ("largashbur.webp", "largashbur-dim.webp"):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")
