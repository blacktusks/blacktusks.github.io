#!/usr/bin/env python3
"""Cut the shaded world map (tools/build_map.py) into a web tile pyramid.
Usage: build_tiles.py <map_shaded.png> <map_geo.json> <public/map dir>"""
import sys, os, json, math
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, geo_path, out = sys.argv[1:4]
geo = json.load(open(geo_path))
img = Image.open(src).convert("RGB")
W, H = img.size
T = 256
maxz = math.ceil(math.log2(max(W, H) / T))
n = 0; total = 0
for z in range(maxz, -1, -1):
    s = 2 ** (z - maxz)
    w, h = max(1, round(W * s)), max(1, round(H * s))
    lvl = img if z == maxz else img.resize((w, h), Image.LANCZOS)
    for ty in range(math.ceil(h / T)):
        for tx in range(math.ceil(w / T)):
            tile = Image.new("RGB", (T, T), (13, 30, 46))
            tile.paste(lvl.crop((tx * T, ty * T, min(w, tx * T + T), min(h, ty * T + T))), (0, 0))
            d = os.path.join(out, str(z)); os.makedirs(d, exist_ok=True)
            p = os.path.join(d, "%d_%d.webp" % (tx, ty))
            tile.save(p, quality=80, method=5)
            n += 1; total += os.path.getsize(p)
geo.update({"tile": T, "max_zoom": maxz, "w": W, "h": H})
json.dump(geo, open(os.path.join(out, "map.json"), "w"))
print("tiles", n, "size %.1f MB" % (total / 1e6), "maxZoom", maxz)
