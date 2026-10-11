#!/usr/bin/env python3
"""Turn the Blender renders (tools/bt_render.py) into the ledger's item pictures.

    pack_pictures.py <folder of rendered .png> <public/items> [jobs.json]

Each render is trimmed to the item, centred on a square with a little air round
it, shrunk to 384px and saved as WebP with its transparent background kept.
With jobs.json, only the pictures the ledger still needs are packed."""
import sys, os, json, io
from multiprocessing import Pool
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE, QUALITY = 384, 78

def pack(key):
    try:
        im = Image.open(os.path.join(SRC, key + ".png")).convert("RGBA")
        box = im.getchannel("A").point(lambda a: 255 if a > 10 else 0).getbbox()
        if not box: return key, 0, "empty"
        im = im.crop(box); w, h = im.size
        if max(w, h) < 12: return key, 0, "tiny"
        side = int(max(w, h) * 1.07) + 2
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0)); sq.paste(im, ((side - w) // 2, (side - h) // 2))
        if side != SIZE: sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
        # A render that came out as a flat white shape has lost its textures; better no picture than that one.
        a = sq.getchannel("A"); cover = sum(a.histogram()[32:]) / (SIZE * SIZE)
        grey = sq.convert("L"); solid = a.point(lambda v: 255 if v > 200 else 0)
        hist = grey.histogram(mask=solid); n = sum(hist) or 1
        if sum(hist[250:]) / n > 0.97: return key, 0, "blank white"
        buf = io.BytesIO(); sq.save(buf, "WEBP", quality=QUALITY, method=6, alpha_quality=88)
        with open(os.path.join(OUT, key + ".webp"), "wb") as f: f.write(buf.getvalue())
        return key, len(buf.getvalue()), "ok %.3f" % cover
    except Exception as e:
        return key, 0, "error " + repr(e)[:100]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    keys = sorted(f[:-4] for f in os.listdir(SRC) if f.endswith(".png"))
    if len(sys.argv) > 3:
        want = {j["key"] for j in json.load(open(sys.argv[3], encoding="utf-8"))["jobs"]}
        keys = [k for k in keys if k in want]
        for f in os.listdir(OUT):                       # drop pictures nothing uses any more
            if f.endswith(".webp") and f[:-5] not in want: os.remove(os.path.join(OUT, f))
    total = 0; bad = []
    with Pool() as pool:
        for key, n, note in pool.imap_unordered(pack, keys, chunksize=16):
            total += n
            if not note.startswith("ok"): bad.append((key, note))
    print("packed %d pictures, %.1f MB, %d left out" % (len(keys) - len(bad), total / 1e6, len(bad)))
    for b in bad[:40]: print("  ", *b)
