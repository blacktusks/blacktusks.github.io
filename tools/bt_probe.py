#!/usr/bin/env python3
"""Black Tusk Companion - read-only probe of the installed Daedric Online load order.

Answers two questions and writes JSON into the output folder given as argv[1]:

1. Can enchanted weapons and armour be found in the game?  Dumps leveled lists,
   containers, NPC inventories, outfits, crafting stations and where they are
   placed in the world, plus what the server's own plugins (RP_*) override.
2. What does each item look like?  Dumps the world model and any texture swaps
   for every item record, so pictures can be rendered.

Reads plugin files only. Standard library only."""
import os, sys, struct, zlib, json, time, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
sys.path.insert(0, HERE)
import extract_game_data as X            # reuses the plugin reader; it reads argv[1] as its output folder too

T0 = time.time()
def log(*a): print("[%6.1fs]" % (time.time() - T0), *a, flush=True)
u32, u16, f32, dec, subs = X.u32, X.u16, X.f32, X.dec, X.subs


def count_group(mm, pos, end, counts):
    """Count records by type inside a group, nested groups included."""
    while pos + 24 <= end:
        typ, size = struct.unpack_from("<4sI", mm, pos)
        if typ == b"GRUP":
            if size < 24: break
            count_group(mm, pos + 24, pos + size, counts); pos += size
        else:
            k = typ.decode("latin1"); counts[k] = counts.get(k, 0) + 1
            pos += 24 + size


def walk_refs(p, pos, end, visit):
    mm = p.mm
    while pos + 24 <= end:
        typ, size, flags, fid = struct.unpack_from("<4sIII", mm, pos)
        if typ == b"GRUP":
            if size < 24: break
            walk_refs(p, pos + 24, pos + size, visit); pos += size; continue
        if typ == b"REFR" or typ == b"ACHR":
            data = mm[pos + 24:pos + 24 + size]
            if flags & 0x00040000:
                try: data = zlib.decompress(data[4:])
                except zlib.error: data = b""
            base = 0; q = 0; n = len(data)
            while q + 6 <= n:
                t = data[q:q + 4]; sz = data[q + 4] | (data[q + 5] << 8)
                if t == b"NAME":
                    base = struct.unpack_from("<I", data, q + 6)[0]; break
                q += 6 + sz
            visit(typ, flags, fid, base, data)
        pos += 24 + size


def main():
    os.makedirs(OUT, exist_ok=True)
    # string tables, so names resolve
    for fn in sorted(os.listdir(X.DATA)):
        if fn.lower().endswith(".bsa"):
            try:
                for fname, buf in X.bsa_string_files(os.path.join(X.DATA, fn)): X.STR.add(fname, buf)
            except Exception as e: log("bsa error", fn, repr(e))
    sdir = os.path.join(X.DATA, "Strings")
    if os.path.isdir(sdir):
        for fn in os.listdir(sdir):
            if "_english." in fn.lower(): X.STR.add(fn.lower(), open(os.path.join(sdir, fn), "rb").read())

    plugs = X.load_order()
    log("plugins", len(plugs))

    txst = {}; items = {}; lvli = {}; lvln = {}; cont = {}; npc = {}; otft = {}; furn = {}; ench = {}; kw = {}
    groups = {}                        # plugin -> {record type: count}
    for pi, p in enumerate(plugs):
        gc = {}
        for label, (a, b) in p.top.items(): count_group(p.mm, a, b, gc)
        groups[p.name] = gc
        for flags, fid, data in p.records(b"KYWD"):
            for t, d in subs(data):
                if t == b"EDID": kw[p.gid(fid)] = dec(d); break
        for flags, fid, data in p.records(b"TXST"):
            tx = [""] * 8
            for t, d in subs(data):
                if len(t) == 4 and t[:3] == b"TX0" and 48 <= t[3] <= 55: tx[t[3] - 48] = dec(d)
            txst[p.gid(fid)] = tx
        for rtype in X.ITEM_TYPES:
            for flags, fid, data in p.records(rtype):
                it = {"rec": rtype.decode(), "win": p.name, "rflags": flags}
                models = {}; alts = {}
                for t, d in subs(data):
                    if t == b"EDID": it["edid"] = dec(d)
                    elif t == b"FULL": it["name"] = p.text(d)
                    elif t == b"EITM": it["ench"] = p.gid(u32(d))
                    elif t in (b"MODL", b"MOD2", b"MOD3", b"MOD4", b"MOD5"):
                        models.setdefault(t.decode(), dec(d))
                    elif t in (b"MODS", b"MO2S", b"MO3S", b"MO4S", b"MO5S") and len(d) >= 4:
                        n = u32(d); q = 4; sw = []
                        for _ in range(n):
                            if q + 4 > len(d): break
                            ln = u32(d, q); q += 4
                            nm = dec(d[q:q + ln]); q += ln
                            if q + 8 > len(d): break
                            sw.append([nm, p.gid(u32(d, q)), struct.unpack_from("<i", d, q + 4)[0]]); q += 8
                        alts[t.decode()] = sw
                    elif t == b"KWDA": it["kw_ids"] = [p.gid(u32(d, i)) for i in range(0, len(d) - 3, 4)]
                    elif t == b"CNAM" and rtype == b"WEAP": it["tpl"] = p.gid(u32(d))
                    elif t == b"TNAM" and rtype == b"ARMO": it["tpl"] = p.gid(u32(d))
                    elif t == b"WNAM" and rtype == b"WEAP": it["first_person"] = p.gid(u32(d))
                it["models"] = models
                if alts: it["alts"] = alts
                items[p.gid(fid)] = it
        for flags, fid, data in p.records(b"ENCH"):
            e = {"win": p.name}
            for t, d in subs(data):
                if t == b"EDID": e["edid"] = dec(d)
                elif t == b"FULL": e["name"] = p.text(d)
            ench[p.gid(fid)] = e
        for label, store in ((b"LVLI", lvli), (b"LVLN", lvln)):
            for flags, fid, data in p.records(label):
                r = {"win": p.name, "e": [], "rflags": flags}
                for t, d in subs(data):
                    if t == b"EDID": r["edid"] = dec(d)
                    elif t == b"LVLD": r["none"] = d[0] if d else 0
                    elif t == b"LVLF": r["flags"] = d[0] if d else 0
                    elif t == b"LVLO" and len(d) >= 12:
                        lvl, _, ref, cnt, _ = struct.unpack_from("<HHIHH", d, 0)
                        r["e"].append([lvl, p.gid(ref), cnt])
                prev = store.get(p.gid(fid)); r["src"] = prev["src"] if prev else p.name
                store[p.gid(fid)] = r
        for flags, fid, data in p.records(b"CONT"):
            r = {"win": p.name, "i": [], "rflags": flags}
            for t, d in subs(data):
                if t == b"EDID": r["edid"] = dec(d)
                elif t == b"FULL": r["name"] = p.text(d)
                elif t == b"CNTO" and len(d) >= 8: r["i"].append([p.gid(u32(d)), struct.unpack_from("<i", d, 4)[0]])
            prev = cont.get(p.gid(fid)); r["src"] = prev["src"] if prev else p.name
            cont[p.gid(fid)] = r
        for flags, fid, data in p.records(b"NPC_"):
            r = {"win": p.name, "i": [], "rflags": flags}
            for t, d in subs(data):
                if t == b"EDID": r["edid"] = dec(d)
                elif t == b"FULL": r["name"] = p.text(d)
                elif t == b"CNTO" and len(d) >= 8: r["i"].append([p.gid(u32(d)), struct.unpack_from("<i", d, 4)[0]])
                elif t == b"DOFT": r["outfit"] = p.gid(u32(d))
                elif t == b"TPLT": r["tpl"] = p.gid(u32(d))
                elif t == b"ACBS" and len(d) >= 20: r["acbs"] = u32(d, 0); r["tplflags"] = u16(d, 18)
            prev = npc.get(p.gid(fid)); r["src"] = prev["src"] if prev else p.name
            npc[p.gid(fid)] = r
        for flags, fid, data in p.records(b"OTFT"):
            r = {"win": p.name, "i": []}
            for t, d in subs(data):
                if t == b"EDID": r["edid"] = dec(d)
                elif t == b"INAM": r["i"] = [p.gid(u32(d, i)) for i in range(0, len(d) - 3, 4)]
            otft[p.gid(fid)] = r
        for flags, fid, data in p.records(b"FURN"):
            r = {"win": p.name, "rflags": flags}
            for t, d in subs(data):
                if t == b"EDID": r["edid"] = dec(d)
                elif t == b"FULL": r["name"] = p.text(d)
                elif t == b"WBDT" and len(d) >= 1: r["bench"] = d[0]
                elif t == b"KWDA": r["kw_ids"] = [p.gid(u32(d, i)) for i in range(0, len(d) - 3, 4)]
            prev = furn.get(p.gid(fid)); r["src"] = prev["src"] if prev else p.name
            furn[p.gid(fid)] = r
        if pi % 20 == 0: log("base records", pi, p.name)

    for it in items.values():
        it["kw"] = [kw.get(k, k) for k in it.pop("kw_ids", [])]
        for key, sw in (it.get("alts") or {}).items():
            for s in sw: s[1] = txst.get(s[1], s[1])
    for f in furn.values(): f["kw"] = [kw.get(k, k) for k in f.pop("kw_ids", [])]
    log("items", len(items), "lvli", len(lvli), "lvln", len(lvln), "cont", len(cont), "npc", len(npc), "furn", len(furn))

    # where things are placed in the world, after every plugin has had its say
    ench_items = {g for g, it in items.items() if it.get("ench")}
    interest = ench_items | set(cont) | set(npc) | set(lvln) | set(lvli) | {g for g, f in furn.items() if "bench" in f}
    refs = {}; totals = {}
    for pi, p in enumerate(plugs):
        seen = [0, 0]
        def visit(typ, flags, fid, base, data, p=p, seen=seen):
            g = p.gid(fid); b = p.gid(base) if base else ""
            seen[0] += 1
            if b in interest or g in refs:
                seen[1] += 1
                prev = refs.get(g)
                refs[g] = [b or (prev[0] if prev else ""), flags, p.name, typ.decode(), prev[4] if prev else p.name]
        for label in (b"CELL", b"WRLD"):
            if label in p.top:
                a, b_ = p.top[label]; walk_refs(p, a, b_, visit)
        if seen[0]: totals[p.name] = seen
        if seen[0] > 20000: log("refs", p.name, seen)
    log("placed references of interest", len(refs))

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        log("wrote", name, "%.2f MB" % (os.path.getsize(path) / 1e6))
    dump("probe_items.json", items)
    dump("probe_ench.json", {"lvli": lvli, "lvln": lvln, "cont": cont, "npc": npc, "otft": otft, "furn": furn, "ench": ench,
                             "refs": refs, "ref_totals": totals, "groups": groups,
                             "order": [p.name for p in plugs]})

    # what the multiplayer client itself says about enchanting
    hits = {}
    plat = os.path.join(X.DATA, "Platform")
    for root, _dirs, files in os.walk(plat):
        for fn in files:
            if not fn.lower().endswith((".js", ".json", ".txt")): continue
            path = os.path.join(root, fn)
            if os.path.getsize(path) > 40e6: continue
            try: text = open(path, encoding="utf-8", errors="replace").read()
            except OSError: continue
            found = []
            for m in re.finditer(r"(?i)enchant", text):
                found.append(text[max(0, m.start() - 160):m.end() + 200].replace("\n", " "))
                if len(found) >= 60: break
            if found: hits[os.path.relpath(path, X.GAME)] = {"count": len(re.findall(r"(?i)enchant", text)), "samples": found}
    extra = {}
    for sub in (r"SKSE\Plugins\DaedricOnline", r"SKSE\Plugins\SkyPatcher", r"SKSE\Plugins\InventoryInjector", r"SKSE\Plugins\CraftingCategories"):
        d = os.path.join(X.DATA, sub); listing = []
        for root, _dirs, files in os.walk(d):
            for fn in files:
                path = os.path.join(root, fn); listing.append([os.path.relpath(path, X.DATA), os.path.getsize(path)])
        extra[sub] = listing[:400]
    dump("probe_client.json", {"enchant_mentions": hits, "folders": extra})
    log("done")


if __name__ == "__main__":
    main()
