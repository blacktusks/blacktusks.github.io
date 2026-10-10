#!/usr/bin/env python3
"""Black Tusk Companion - read-only dump of the Tamriel terrain heights and
per-cell water levels (for shading the mining map). Standard library only."""
import os, sys, struct, zlib, json, array, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_game_data as ex

OUT = sys.argv[1]
X0, X1, Y0, Y1 = -60, 64, -46, 52          # cell range [X0,X1) x [Y0,Y1)
NX, NY = X1 - X0, Y1 - Y0
W, H = NX * 32 + 1, NY * 32 + 1
heights = array.array("h", [-32768]) * (W * H)
water = array.array("f", [float("nan")]) * (NX * NY)
info = {"x0": X0, "x1": X1, "y0": Y0, "y1": Y1, "w": W, "h": H, "scale": 8, "cells": 0, "plugins": {}}


def put_land(cx, cy, vhgt):
    base = struct.unpack_from("<f", vhgt, 0)[0] * 8.0
    g = struct.unpack_from("<1089b", vhgt, 4)
    col0 = 0.0
    ox = (cx - X0) * 32; oy = (cy - Y0) * 32
    acc = base
    for r in range(33):
        row = g[r * 33:(r + 1) * 33]
        acc += row[0] * 8
        vals = list(itertools.accumulate(row[1:], lambda a, b: a + b * 8, initial=acc))
        start = (oy + r) * W + ox
        heights[start:start + 33] = array.array("h", [max(-32767, min(32767, int(round(v / 8.0)))) for v in vals])


def walk(p, pos, end, cell, counts):
    mm = p.mm
    while pos + 24 <= end:
        typ, size, a, b = struct.unpack_from("<4sIII", mm, pos)
        if typ == b"GRUP":
            gtype = b
            if gtype in (4, 5, 6):
                cell = walk(p, pos + 24, pos + size, cell, counts)
            elif gtype == 9 and cell is not None:
                q = pos + 24; qe = pos + size
                while q + 24 <= qe:
                    t2, s2, f2 = struct.unpack_from("<4sII", mm, q)
                    if t2 == b"GRUP":
                        q += s2; continue
                    if t2 == b"LAND":
                        data = mm[q + 24:q + 24 + s2]
                        if f2 & 0x00040000:
                            try: data = zlib.decompress(data[4:])
                            except zlib.error: data = b""
                        for t, d in ex.subs(data):
                            if t == b"VHGT" and len(d) >= 4 + 1089:
                                put_land(cell[0], cell[1], d); counts[0] += 1
                                break
                    q += 24 + s2
            pos += size
        else:
            if typ == b"CELL":
                flags = a
                data = mm[pos + 24:pos + 24 + size]
                if flags & 0x00040000:
                    try: data = zlib.decompress(data[4:])
                    except zlib.error: data = b""
                cell = None; grid = None; wl = None
                for t, d in ex.subs(data):
                    if t == b"XCLC" and len(d) >= 8: grid = struct.unpack_from("<ii", d, 0)
                    elif t == b"XCLW" and len(d) >= 4: wl = struct.unpack_from("<f", d, 0)[0]
                if grid and X0 <= grid[0] < X1 and Y0 <= grid[1] < Y1:
                    cell = grid
                    if wl is not None:
                        water[(grid[1] - Y0) * NX + (grid[0] - X0)] = wl
            pos += 24 + size
    return cell


def main():
    plugs = ex.load_order()
    for p in plugs:
        if b"WRLD" not in p.top: continue
        mm = p.mm; pos, end = p.top[b"WRLD"]; counts = [0]
        while pos + 24 <= end:
            typ, size, label, gtype = struct.unpack_from("<4sIII", mm, pos)
            if typ == b"GRUP":
                if gtype == 1 and p.gid(label) == ex.TAMRIEL:
                    walk(p, pos + 24, pos + size, None, counts)
                pos += size
            else:
                if typ == b"WRLD" and p.gid(gtype) == ex.TAMRIEL:
                    data = mm[pos + 24:pos + 24 + size]
                    if label & 0x00040000: data = zlib.decompress(data[4:])
                    for t, d in ex.subs(data):
                        if t == b"DNAM" and len(d) >= 8:
                            info["default_land"], info["default_water"] = struct.unpack_from("<ff", d, 0)
                pos += 24 + size
        if counts[0]:
            info["plugins"][p.name] = counts[0]
            ex.log("%-55s LAND cells: %d" % (p.name, counts[0]))
    info["cells"] = sum(1 for cy in range(NY) for cx in range(NX) if heights[(cy * 32 + 16) * W + cx * 32 + 16] != -32768)
    with open(os.path.join(OUT, "heights_i16.bin.z"), "wb") as f:
        f.write(zlib.compress(heights.tobytes(), 6))
    with open(os.path.join(OUT, "water_f32.bin"), "wb") as f:
        f.write(water.tobytes())
    json.dump(info, open(os.path.join(OUT, "heights_info.json"), "w"))
    ex.log("done", info["cells"], "cells with terrain;", os.path.getsize(os.path.join(OUT, "heights_i16.bin.z")) // 1024, "KB")


if __name__ == "__main__":
    main()
