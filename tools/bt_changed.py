#!/usr/bin/env python3
"""Zip the pictures of a new render run that differ from the last run's, in parts small enough to move.
    python bt_changed.py <old out folder> <new out folder> <zip folder> [MB per zip]"""
import os, sys, hashlib, zipfile, json
OLD, NEW, ZIPS = sys.argv[1], sys.argv[2], sys.argv[3]
LIMIT = int(sys.argv[4]) * 1024 * 1024 if len(sys.argv) > 4 else 300 * 1024 * 1024
def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
os.makedirs(ZIPS, exist_ok=True)
for f in os.listdir(ZIPS):
    if f.startswith("changed-") and f.endswith(".zip"): os.remove(os.path.join(ZIPS, f))
same = 0; changed = []
for f in sorted(os.listdir(NEW)):
    if not f.endswith(".png"): continue
    o = os.path.join(OLD, f)
    if os.path.exists(o) and os.path.getsize(o) == os.path.getsize(os.path.join(NEW, f)) and md5(o) == md5(os.path.join(NEW, f)): same += 1
    else: changed.append(f)
part = 0; size = LIMIT + 1; z = None
for f in changed:
    n = os.path.getsize(os.path.join(NEW, f))
    if size + n > LIMIT:
        if z: z.close()
        part += 1; size = 0
        z = zipfile.ZipFile(os.path.join(ZIPS, "changed-%d.zip" % part), "w", zipfile.ZIP_STORED)
        if part == 1: z.write(os.path.join(NEW, "_state.json"), "_state.json")
    z.write(os.path.join(NEW, f), f); size += n
if z: z.close()
json.dump({"same": same, "changed": len(changed), "parts": part}, open(os.path.join(ZIPS, "changed.json"), "w"))
print("same", same, "changed", len(changed), "zips", part)
