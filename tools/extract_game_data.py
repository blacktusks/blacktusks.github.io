#!/usr/bin/env python3
"""Black Tusk Companion - read-only dump of items, recipes and map markers
from the installed Skyrim SE plugins (the Daedric Online load order).

Reads plugin and BSA files; writes only JSON into the output folder given as
argv[1]. Standard library only."""
import os, sys, struct, zlib, json, mmap, time

GAME = r"D:\SteamLibrary\steamapps\common\Skyrim Special Edition"
DATA = os.path.join(GAME, "Data")
OUT = sys.argv[1]
T0 = time.time()


def log(*a):
    print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


def dec(b):
    b = b.split(b"\0", 1)[0]
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", "replace")


# ---------------------------------------------------------------- LZ4 / BSA
def lz4_block(src, pos, end, out):
    while pos < end:
        tok = src[pos]; pos += 1
        ll = tok >> 4
        if ll == 15:
            while True:
                b = src[pos]; pos += 1; ll += b
                if b != 255: break
        out += src[pos:pos + ll]; pos += ll
        if pos >= end: break
        off = src[pos] | (src[pos + 1] << 8); pos += 2
        ml = tok & 15
        if ml == 15:
            while True:
                b = src[pos]; pos += 1; ml += b
                if b != 255: break
        ml += 4
        start = len(out) - off
        if off >= ml:
            out += out[start:start + ml]
        else:
            for i in range(ml):
                out.append(out[start + i])


def lz4_frame(data):
    if data[:4] != b"\x04\x22\x4d\x18":
        raise ValueError("not an lz4 frame")
    flg = data[4]; pos = 6
    if flg & 0x08: pos += 8
    if flg & 0x01: pos += 4
    pos += 1
    out = bytearray()
    while True:
        bs = struct.unpack_from("<I", data, pos)[0]; pos += 4
        if bs == 0: break
        if bs & 0x80000000:
            bs &= 0x7FFFFFFF
            out += data[pos:pos + bs]
        else:
            lz4_block(data, pos, pos + bs, out)
        pos += bs
        if flg & 0x10: pos += 4
    return bytes(out)


def bsa_string_files(path):
    """Yield (filename_lower, bytes) for files in the archive's strings folder."""
    with open(path, "rb") as f:
        hdr = f.read(36)
        if len(hdr) < 36: return
        magic, ver, off, aflags, nfold, nfile, tfold, tfile, fflags = struct.unpack("<4sIIIIIIII", hdr)
        if magic != b"BSA\0" or ver not in (104, 105): return
        f.seek(off)
        if ver == 105:
            folders = [struct.unpack("<QIIQ", f.read(24)) for _ in range(nfold)]
        else:
            folders = [struct.unpack("<QII", f.read(16)) for _ in range(nfold)]
        entries = []
        for rec in folders:
            count = rec[1]; name = ""
            if aflags & 1:
                ln = f.read(1)[0]
                name = f.read(ln)[:-1].decode("cp1252", "replace").lower()
            blob = f.read(16 * count)
            entries.append((name, [struct.unpack_from("<QII", blob, i * 16) for i in range(count)]))
        if not any(n == "strings" for n, _ in entries): return
        names = f.read(tfile).split(b"\0") if aflags & 2 else []
        i = 0
        for folder, recs in entries:
            for (_h, size, offset) in recs:
                fname = names[i].decode("cp1252", "replace").lower() if i < len(names) else ""
                i += 1
                if folder != "strings" or "_english." not in fname: continue
                compressed = bool(aflags & 4) ^ bool(size & 0x40000000)
                size &= 0x3FFFFFFF
                f.seek(offset); raw = f.read(size)
                if aflags & 0x100:
                    raw = raw[1 + raw[0]:]
                if compressed:
                    raw = lz4_frame(raw[4:]) if ver == 105 else zlib.decompress(raw[4:])
                yield fname, raw


class StringTable:
    def __init__(self):
        self.files = {}   # (plugin_base_lower, kind) -> bytes

    def add(self, fname, buf):
        base, ext = fname.rsplit(".", 1)
        base = base[:-len("_english")]
        self.files[(base, ext)] = buf
        self._idx = getattr(self, "_idx", {})

    def lookup(self, plugin_base, sid):
        for kind in ("strings", "dlstrings", "ilstrings"):
            key = (plugin_base, kind)
            buf = self.files.get(key)
            if buf is None: continue
            idx = self._idx.get(key)
            if idx is None:
                count = struct.unpack_from("<I", buf, 0)[0]
                idx = {}
                for i in range(count):
                    s, o = struct.unpack_from("<II", buf, 8 + i * 8)
                    idx[s] = 8 + count * 8 + o
                self._idx[key] = idx
            p = idx.get(sid)
            if p is None: continue
            if kind == "strings":
                e = buf.find(b"\0", p)
                return dec(buf[p:e])
            ln = struct.unpack_from("<I", buf, p)[0]
            return dec(buf[p + 4:p + 4 + ln])
        return ""


STR = StringTable()


# ---------------------------------------------------------------- plugins
def subs(data):
    pos = 0; n = len(data); big = None
    while pos + 6 <= n:
        t = data[pos:pos + 4]
        sz = data[pos + 4] | (data[pos + 5] << 8)
        pos += 6
        if t == b"XXXX":
            big = struct.unpack_from("<I", data, pos)[0]; pos += sz; continue
        if big is not None:
            sz = big; big = None
        yield t, data[pos:pos + sz]
        pos += sz


class Plugin:
    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(path)
        self.base = os.path.splitext(self.name)[0].lower()
        self.f = open(path, "rb")
        self.mm = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        mm = self.mm
        typ, size, flags = struct.unpack_from("<4sII", mm, 0)
        if typ != b"TES4": raise ValueError("not a plugin: " + path)
        self.flags = flags
        self.localized = bool(flags & 0x80)
        self.masters = [dec(d) for t, d in subs(mm[24:24 + size]) if t == b"MAST"]
        self.top = {}
        pos = 24 + size; n = len(mm)
        while pos + 24 <= n:
            typ, gsize, label = struct.unpack_from("<4sI4s", mm, pos)
            if typ != b"GRUP" or gsize < 24: break
            self.top[label] = (pos + 24, pos + gsize)
            pos += gsize

    def gid(self, fid):
        idx = fid >> 24
        owner = self.masters[idx] if idx < len(self.masters) else self.name
        return owner.lower() + ":" + "%06X" % (fid & 0xFFFFFF)

    def records(self, label):
        if label not in self.top: return
        pos, end = self.top[label]
        mm = self.mm
        while pos + 24 <= end:
            typ, size, flags, fid = struct.unpack_from("<4sIII", mm, pos)
            if typ == b"GRUP":
                pos += size; continue
            data = mm[pos + 24:pos + 24 + size]
            if flags & 0x00040000:
                try: data = zlib.decompress(data[4:])
                except zlib.error: data = b""
            yield flags, fid, data
            pos += 24 + size

    def text(self, d):
        if self.localized:
            if len(d) < 4: return ""
            return STR.lookup(self.base, struct.unpack_from("<I", d, 0)[0])
        return dec(d)


def load_order():
    order = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"]
    ccc = os.path.join(GAME, "Skyrim.ccc")
    if os.path.exists(ccc):
        for line in open(ccc, encoding="utf-8", errors="replace"):
            line = line.strip()
            if line and os.path.exists(os.path.join(DATA, line)): order.append(line)
    pt = os.path.expandvars(r"%LOCALAPPDATA%\Skyrim Special Edition\plugins.txt")
    active = []
    for line in open(pt, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("*"): active.append(line[1:])
    seen = {o.lower() for o in order}
    paths = []
    for n in active:
        if n.lower() in seen: continue
        seen.add(n.lower())
        paths.append(n)
    plugs = []
    for n in order + paths:
        p = os.path.join(DATA, n)
        if not os.path.exists(p):
            log("MISSING plugin", n); continue
        try: plugs.append(Plugin(p))
        except Exception as e: log("FAILED to open", n, e)
    head = [p for p in plugs[:len(order)]]
    rest = plugs[len(head):]
    masters_first = [p for p in rest if (p.flags & 1) or p.name.lower().endswith((".esm", ".esl"))]
    others = [p for p in rest if p not in masters_first]
    return head + masters_first + others


# ---------------------------------------------------------------- dump
ITEM_TYPES = [b"WEAP", b"ARMO", b"MISC", b"INGR", b"ALCH", b"AMMO", b"BOOK", b"SCRL", b"SLGM", b"KEYM", b"LIGH"]


def u32(d, o=0): return struct.unpack_from("<I", d, o)[0] if len(d) >= o + 4 else 0
def i32(d, o=0): return struct.unpack_from("<i", d, o)[0] if len(d) >= o + 4 else 0
def f32(d, o=0): return round(struct.unpack_from("<f", d, o)[0], 3) if len(d) >= o + 4 else 0.0
def u16(d, o=0): return struct.unpack_from("<H", d, o)[0] if len(d) >= o + 2 else 0


def main():
    os.makedirs(OUT, exist_ok=True)
    log("scanning BSAs for string tables")
    for fn in sorted(os.listdir(DATA)):
        if not fn.lower().endswith(".bsa"): continue
        try:
            for fname, buf in bsa_string_files(os.path.join(DATA, fn)):
                STR.add(fname, buf)
        except Exception as e:
            log("  bsa error", fn, repr(e))
    sdir = os.path.join(DATA, "Strings")
    if os.path.isdir(sdir):
        for fn in os.listdir(sdir):
            if "_english." in fn.lower():
                STR.add(fn.lower(), open(os.path.join(sdir, fn), "rb").read())
    log("string tables:", sorted({k[0] for k in STR.files}))

    plugs = load_order()
    log("plugins in load order:", len(plugs))

    kw = {}; mgef = {}; ench = {}
    items = {}; recipes = {}; flora = {}; markers = {}; world = {}; refs = {}
    plugin_info = []

    for pi, p in enumerate(plugs):
        counts = {}
        for flags, fid, data in p.records(b"KYWD"):
            for t, d in subs(data):
                if t == b"EDID": kw[p.gid(fid)] = dec(d); break
        for flags, fid, data in p.records(b"MGEF"):
            name = ""; desc = ""
            for t, d in subs(data):
                if t == b"FULL": name = p.text(d)
                elif t == b"DNAM": desc = p.text(d)
            mgef[p.gid(fid)] = {"name": name, "desc": desc}
        for flags, fid, data in p.records(b"ENCH"):
            name = ""; fx = []
            for t, d in subs(data):
                if t == b"FULL": name = p.text(d)
                elif t == b"EFID": fx.append(p.gid(u32(d)))
            ench[p.gid(fid)] = {"name": name, "fx": fx}

        for rtype in ITEM_TYPES:
            for flags, fid, data in p.records(rtype):
                g = p.gid(fid)
                it = {"gid": g, "rec": rtype.decode(), "win": p.name, "rflags": flags}
                kws = []; fx = []; cur = None
                for t, d in subs(data):
                    if t == b"EDID": it["edid"] = dec(d)
                    elif t == b"FULL": it["name"] = p.text(d)
                    elif t == b"DESC":
                        s = p.text(d)
                        if s: it["desc"] = s
                    elif t == b"CNAM" and rtype == b"BOOK":
                        s = p.text(d)
                        if s: it["desc"] = s
                    elif t == b"KWDA":
                        kws = [p.gid(u32(d, i)) for i in range(0, len(d) - 3, 4)]
                    elif t == b"EITM": it["ench"] = p.gid(u32(d))
                    elif t == b"CNAM" and rtype == b"WEAP": it["tpl"] = p.gid(u32(d))
                    elif t == b"TNAM" and rtype == b"ARMO": it["tpl"] = p.gid(u32(d))
                    elif t == b"MODL" and "model" not in it: it["model"] = dec(d)
                    elif t == b"MOD2" and rtype == b"ARMO" and "model" not in it: it["model"] = dec(d)
                    elif t == b"EFID":
                        cur = {"id": p.gid(u32(d))}; fx.append(cur)
                    elif t == b"EFIT" and cur is not None:
                        cur["mag"] = f32(d, 0); cur["area"] = u32(d, 4); cur["dur"] = u32(d, 8)
                    elif t == b"DATA":
                        if rtype == b"WEAP":
                            it["value"] = u32(d, 0); it["weight"] = f32(d, 4); it["damage"] = u16(d, 8)
                        elif rtype == b"ARMO":
                            it["value"] = i32(d, 0); it["weight"] = f32(d, 4)
                        elif rtype in (b"MISC", b"SCRL", b"SLGM", b"KEYM"):
                            it["value"] = u32(d, 0); it["weight"] = f32(d, 4)
                        elif rtype == b"INGR":
                            it["value"] = i32(d, 0); it["weight"] = f32(d, 4)
                        elif rtype == b"ALCH":
                            it["weight"] = f32(d, 0)
                        elif rtype == b"AMMO":
                            it["aflags"] = u32(d, 4); it["damage"] = f32(d, 8); it["value"] = u32(d, 12)
                            it["weight"] = f32(d, 16) if len(d) >= 20 else 0.0
                        elif rtype == b"BOOK":
                            it["bflags"] = d[0] if d else 0; it["btype"] = d[1] if len(d) > 1 else 0
                            it["teaches"] = u32(d, 4); it["value"] = u32(d, 8); it["weight"] = f32(d, 12)
                        elif rtype == b"LIGH":
                            it["lflags"] = u32(d, 12); it["value"] = u32(d, 40); it["weight"] = f32(d, 44)
                    elif t == b"ENIT" and rtype == b"ALCH":
                        it["value"] = i32(d, 0); it["eflags"] = u32(d, 4)
                    elif t == b"DNAM":
                        if rtype == b"WEAP":
                            it["anim"] = d[0] if d else 0
                            it["speed"] = f32(d, 4); it["reach"] = f32(d, 8); it["wflags"] = u16(d, 12)
                        elif rtype == b"ARMO":
                            it["armor"] = i32(d, 0) / 100.0
                    elif t == b"BOD2" and rtype == b"ARMO":
                        it["slots"] = u32(d, 0); it["atype"] = u32(d, 4)
                    elif t == b"BODT" and rtype == b"ARMO":
                        it["slots"] = u32(d, 0)
                        it["atype"] = u32(d, 8) if len(d) >= 12 else 2
                it["kw_ids"] = kws
                if fx: it["fx"] = fx
                prev = items.get(g)
                it["src"] = prev["src"] if prev else p.name
                items[g] = it
                counts[it["rec"]] = counts.get(it["rec"], 0) + 1

        for flags, fid, data in p.records(b"COBJ"):
            r = {"gid": p.gid(fid), "win": p.name, "ing": [], "n": 1, "conds": 0}
            for t, d in subs(data):
                if t == b"EDID": r["edid"] = dec(d)
                elif t == b"CNTO": r["ing"].append([p.gid(u32(d, 0)), u32(d, 4)])
                elif t == b"CNAM": r["out"] = p.gid(u32(d))
                elif t == b"BNAM": r["bench"] = p.gid(u32(d))
                elif t == b"NAM1": r["n"] = u16(d)
                elif t == b"CTDA":
                    r["conds"] += 1
                    if len(d) >= 20:
                        op = d[0]; func = u16(d, 8)
                        val = p.gid(u32(d, 4)) if op & 0x04 else f32(d, 4)
                        r.setdefault("ctda", []).append([func, op, val, p.gid(u32(d, 12)), u32(d, 16)])
            if flags & 0x20: r["deleted"] = True
            recipes[r["gid"]] = r
            counts["COBJ"] = counts.get("COBJ", 0) + 1

        for flags, fid, data in p.records(b"GLOB"):
            g = {"rec": "GLOB"}
            for t, d in subs(data):
                if t == b"EDID": g["edid"] = dec(d)
                elif t == b"FLTV": g["value"] = f32(d)
            refs[p.gid(fid)] = g
        for flags, fid, data in p.records(b"PERK"):
            g = {"rec": "PERK"}
            for t, d in subs(data):
                if t == b"EDID": g["edid"] = dec(d)
                elif t == b"FULL" and "name" not in g: g["name"] = p.text(d)
            refs[p.gid(fid)] = g
        for flags, fid, data in p.records(b"KYWD"):
            pass

        for rtype in (b"FLOR", b"TREE"):
            for flags, fid, data in p.records(rtype):
                fl = {"gid": p.gid(fid), "rec": rtype.decode()}
                for t, d in subs(data):
                    if t == b"FULL": fl["name"] = p.text(d)
                    elif t == b"PFIG": fl["gives"] = p.gid(u32(d))
                    elif t == b"EDID": fl["edid"] = dec(d)
                if fl.get("gives"): flora[fl["gid"]] = fl

        nm = walk_world(p, markers, world)
        if nm: counts["MAPMARKER"] = nm
        plugin_info.append({"name": p.name, "masters": p.masters, "localized": p.localized,
                            "light": bool(p.flags & 0x200), "counts": counts})
        if counts: log("%3d %-58s %s" % (pi, p.name, counts))

    for it in items.values():
        it["kw"] = [kw.get(k, k) for k in it.pop("kw_ids")]
        if "fx" in it:
            for e in it["fx"]:
                m = mgef.get(e["id"], {})
                e["name"] = m.get("name", ""); e["desc"] = m.get("desc", "")
        if "ench" in it:
            e = ench.get(it["ench"], {})
            it["ench_name"] = e.get("name", "")
            it["ench_fx"] = [mgef.get(x, {}).get("name", "") for x in e.get("fx", [])]
    for r in recipes.values():
        if "bench" in r: r["bench"] = kw.get(r["bench"], r["bench"])

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        log("wrote", name, "%.2f MB" % (os.path.getsize(path) / 1e6))

    dump("raw_items.json", list(items.values()))
    dump("raw_recipes.json", list(recipes.values()))
    dump("raw_flora.json", list(flora.values()))
    dump("raw_markers.json", {"world": world, "markers": list(markers.values())})
    dump("raw_plugins.json", plugin_info)
    dump("raw_refs.json", {"refs": refs, "kw": kw})
    log("items", len(items), "recipes", len(recipes), "flora", len(flora), "markers", len(markers))


TAMRIEL = "skyrim.esm:00003C"
# The five walled cities are worldspaces of their own that share Tamriel's
# coordinates. Their map markers (Whiterun, Solitude...) live inside them.
CITY_WORLDS = {"skyrim.esm:01A26F": "Whiterun", "skyrim.esm:037EDF": "Solitude", "skyrim.esm:016BB4": "Riften",
               "skyrim.esm:01691D": "Windhelm", "skyrim.esm:016D71": "Markarth"}


def walk_world(p, markers, world):
    if b"WRLD" not in p.top: return 0
    mm = p.mm
    pos, end = p.top[b"WRLD"]
    found = 0
    while pos + 24 <= end:
        typ, size, label, gtype = struct.unpack_from("<4sIII", mm, pos)
        if typ == b"GRUP":
            if gtype == 1 and (p.gid(label) == TAMRIEL or p.gid(label) in CITY_WORLDS):
                before = set(markers)
                found += walk_children(p, pos + 24, pos + size, markers)
                if p.gid(label) in CITY_WORLDS:
                    for g in set(markers) - before: markers[g]["world"] = CITY_WORLDS[p.gid(label)]
            pos += size
        else:
            flags, fid = label, gtype
            if typ == b"WRLD" and p.gid(fid) == TAMRIEL:
                data = mm[pos + 24:pos + 24 + size]
                if flags & 0x00040000: data = zlib.decompress(data[4:])
                for t, d in subs(data):
                    if t == b"MNAM" and len(d) >= 16:
                        world["mnam"] = {"usable": list(struct.unpack_from("<ii", d, 0)),
                                         "nw_cell": list(struct.unpack_from("<hh", d, 8)),
                                         "se_cell": list(struct.unpack_from("<hh", d, 12)),
                                         "from": p.name}
                    elif t == b"NAM0" and len(d) >= 8: world["min"] = [f32(d, 0), f32(d, 4)]
                    elif t == b"NAM9" and len(d) >= 8: world["max"] = [f32(d, 0), f32(d, 4)]
                    elif t == b"ONAM" and len(d) >= 12: world["onam"] = [f32(d, 0), f32(d, 4), f32(d, 8)]
            pos += 24 + size
    return found


def walk_children(p, pos, end, markers):
    mm = p.mm; found = 0
    while pos + 24 <= end:
        typ, size, label, gtype = struct.unpack_from("<4sIII", mm, pos)
        if typ == b"GRUP":
            if gtype in (4, 5, 6):
                found += walk_children(p, pos + 24, pos + size, markers)
            elif gtype == 8:
                found += read_markers(p, pos + 24, pos + size, markers)
            pos += size
        else:
            pos += 24 + size
    return found


def read_markers(p, pos, end, markers):
    mm = p.mm; found = 0
    while pos + 24 <= end:
        typ, size, flags, fid = struct.unpack_from("<4sIII", mm, pos)
        if typ == b"GRUP":
            pos += size; continue
        if typ == b"REFR":
            data = mm[pos + 24:pos + 24 + size]
            if flags & 0x00040000:
                try: data = zlib.decompress(data[4:])
                except zlib.error: data = b""
            g = p.gid(fid)
            if b"XMRK" in data:
                m = {"gid": g, "win": p.name, "rflags": flags}
                for t, d in subs(data):
                    if t == b"FULL": m["name"] = p.text(d)
                    elif t == b"TNAM": m["type"] = d[0] if d else 0
                    elif t == b"FNAM": m["mflags"] = d[0] if d else 0
                    elif t == b"DATA" and len(d) >= 12:
                        m["x"], m["y"], m["z"] = f32(d, 0), f32(d, 4), f32(d, 8)
                    elif t == b"EDID": m["edid"] = dec(d)
                prev = markers.get(g)
                m["src"] = prev["src"] if prev else p.name
                markers[g] = m; found += 1
            elif g in markers:
                # a later plugin overrides this reference and removed the marker data
                markers[g]["overridden_by"] = p.name
        pos += 24 + size
    return found


if __name__ == "__main__":
    main()
