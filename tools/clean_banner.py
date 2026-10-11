#!/usr/bin/env python3
"""Tidy the banner cut-out: remove pieces of the original artwork's background
that were left inside it (grey sky showing between the beam and the cloth, the
smoke and embers down the right side).

Usage: clean_banner.py <banner_cut_1600.png> <out banner.webp>
Coordinates below are on the 1100-pixel banner the app ships. Needs Pillow, NumPy, OpenCV.
"""
import sys
import numpy as np
import cv2
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGBA")).copy()
H, W = im.shape[:2]
k = W / 1100.0
rgb = im[..., :3].astype(np.int32); alpha = im[..., 3].astype(np.float32)
lum = rgb.mean(-1); sat = rgb.max(-1) - rgb.min(-1)

def poly(points):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array([(round(x * k), round(y * k)) for x, y in points], np.int32)], 255)
    return m > 0

remove = np.zeros((H, W), bool)
# 1. Gaps between the top beam and the cloth: the sky behind showed as grey. Clear what is
#    dull (grey or black) and keep the ropes and wire, which are brighter or coloured.
dull = (sat <= 18) & (lum <= 95)
for gap in ([(346, 197), (444, 197), (452, 214), (432, 224), (402, 214), (372, 208), (348, 204)],
            [(670, 196), (758, 196), (754, 205), (736, 212), (714, 224), (702, 234), (686, 228), (670, 216)],
            [(833, 204), (867, 204), (867, 264), (838, 264), (833, 240)]):
    remove |= poly(gap) & dull
# 2. A grey fringe down the right post's edge.
fringe = np.zeros((H, W), bool); fringe[round(225 * k):round(412 * k), round(934 * k):] = True
remove |= fringe & (lum >= 24) & (sat <= 34)
# 3. Smoke and a half-cut spike beside the right post; embers and ground at its foot.
remove |= poly([(947, 404), (929, 412), (927, 512), (930, 545), (931, 670), (936, 695), (950, 718), (1100, 718), (1100, 404)])
remove |= poly([(953, 930), (1100, 930), (1100, 1100), (936, 1100), (936, 965), (950, 950)])

# soften the new edges, then drop any crumbs no longer attached to the banner
soft = cv2.GaussianBlur(remove.astype(np.float32), (0, 0), 1.1 * k)
alpha = alpha * np.clip(1.0 - soft * 1.6, 0.0, 1.0)
n, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 40).astype(np.uint8), connectivity=8)
keep = np.zeros(n, bool); keep[1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))] = True
solid = cv2.dilate(keep[labels].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
alpha[~solid] = 0
im[..., 3] = alpha.round().astype(np.uint8)
res = Image.fromarray(im, "RGBA")
res.save(src.replace(".png", "_clean.png"))
res.resize((1100, 1100), Image.LANCZOS).save(out, quality=90, method=6)
print("removed", int(remove.sum()), "px at", W, "wide ->", out)
