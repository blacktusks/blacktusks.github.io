#!/usr/bin/env python3
"""Black Tusk Companion - copy the models and textures the item pictures need
out of the installed game (loose files and BSA archives) into a staging folder.

    python bt_assets.py <jobs.json> <stage folder> [workers]

Reads the game files; writes only inside the staging folder. Standard library only."""
import os, sys, re, json, struct, zlib, time, pickle
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
JOBS, STAGE = sys.argv[1], sys.argv[2]
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 3
_argv = sys.argv; sys.argv = [_argv[0], STAGE]
import extract_game_data as X
sys.argv = _argv

T0 = time.time()
def log(*a): print("[%7.1fs]" % (time.time() - T0), *a, flush=True)


def bsa_index(path):
    """-> (version, flags, {lower path: (size field, offset)})"""
    out = {}
    with open(path, "rb") as f:
        hdr = f.read(36)
        if len(hdr) < 36: return 0, 0, out
        magic, ver, off, aflags, nfold, nfile, tfold, tfile, fflags = struct.unpack("<4sIIIIIIII", hdr)
        if magic != b"BSA\0" or ver not in (104, 105): return 0, 0, out
        f.seek(off)
        if ver == 105: folders = [struct.unpack("<QIIQ", f.read(24)) for _ in range(nfold)]
        else: folders = [struct.unpack("<QII", f.read(16)) for _ in range(nfold)]
        entries = []
        for rec in folders:
            count = rec[1]; name = ""
            if aflags & 1:
                ln = f.read(1)[0]
                name = f.read(ln)[:-1].decode("cp1252", "replace").lower()
            blob = f.read(16 * count)
            entries.append((name, [struct.unpack_from("<QII", blob, i * 16) for i in range(count)]))
        names = f.read(tfile).split(b"\0") if aflags & 2 else []
        i = 0
        for folder, recs in entries:
            keep = folder.startswith(("meshes", "textures"))
            for (_h, size, offset) in recs:
                if keep and i < len(names):
                    out[folder + "\\" + names[i].decode("cp1252", "replace").lower()] = (size, offset)
                i += 1
    return ver, aflags, out


def bsa_read(path, ver, aflags, size, offset):
    with open(path, "rb") as f:
        compressed = bool(aflags & 4) ^ bool(size & 0x40000000)
        size &= 0x3FFFFFFF
        f.seek(offset); raw = f.read(size)
    if aflags & 0x100: raw = raw[1 + raw[0]:]
    if compressed:
        raw = X.lz4_frame(raw[4:]) if ver == 105 else zlib.decompress(raw[4:])
    return raw


def bsa_order():
    """Archives in the order the game loads them; later ones win."""
    plugs = [p.name for p in X.load_order()]
    rank = {os.path.splitext(n)[0].lower(): i for i, n in enumerate(plugs)}
    def key(fn):
        base = os.path.splitext(fn)[0].lower()
        base = re.sub(r" - textures\d*$", "", base)
        if base.startswith("skyrim - "): return (-1, fn.lower())
        return (rank.get(base, -1 if base.startswith("_resourcepack") else 0), fn.lower())
    return sorted((fn for fn in os.listdir(X.DATA) if fn.lower().endswith(".bsa")), key=key)


def norm(path, root):
    p = path.replace("/", "\\").lower().strip().strip("\0")
    i = p.find(root + "\\")
    if i >= 0: p = p[i:]
    else: p = root + "\\" + p.lstrip("\\")
    return p


def textures_in(b):
    """Texture paths named inside a model file. Each is stored with its length in front of it."""
    found = set(); low = b.lower(); pos = 0
    while True:
        i = low.find(b".dds", pos)
        if i < 0: break
        end = i + 4; pos = end
        for ln in range(5, 261):
            s = end - ln
            if s < 4: break
            if b[s - 4] == (ln & 0xff) and b[s - 3] == (ln >> 8) and b[s - 2] == 0 and b[s - 1] == 0:
                seg = b[s:end]
                if all(32 <= c < 127 for c in seg): found.add(norm(seg.decode("latin1"), "textures"))
                break
    return found


def fetch(job):
    rel, arch = job
    dst = os.path.join(STAGE, rel)
    if os.path.exists(dst): return rel, "have", 0
    loose = os.path.join(X.DATA, rel)
    try:
        if os.path.exists(loose):
            data = open(loose, "rb").read(); how = "loose"
        elif arch:
            data = bsa_read(*arch); how = "bsa"
        else:
            return rel, "missing", 0
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".part"
        with open(tmp, "wb") as f: f.write(data)
        os.replace(tmp, dst)
        return rel, how, len(data)
    except Exception as e:
        return rel, "error " + repr(e)[:120], 0


def main():
    os.makedirs(STAGE, exist_ok=True)
    jobs = json.load(open(JOBS, encoding="utf-8"))["jobs"]
    cache = os.path.join(STAGE, "_bsa_index.pickle")
    if os.path.exists(cache):
        index = pickle.load(open(cache, "rb"))
    else:
        index = {}
        for fn in bsa_order():
            path = os.path.join(X.DATA, fn)
            try: ver, aflags, files = bsa_index(path)
            except Exception as e: log("bsa error", fn, repr(e)); continue
            for rel, (size, offset) in files.items(): index[rel] = (path, ver, aflags, size, offset)
            log("indexed %-52s %7d files" % (fn, len(files)))
        pickle.dump(index, open(cache, "wb"))
    log("archive index:", len(index), "files")

    meshes = sorted({norm(j["model"], "meshes") for j in jobs})
    log("models wanted:", len(meshes))
    report = {"missing_meshes": [], "missing_textures": [], "errors": []}
    with Pool(WORKERS) as pool:
        done = 0; total = 0
        for rel, how, n in pool.imap_unordered(fetch, [(m, index.get(m)) for m in meshes], chunksize=8):
            done += 1; total += n
            if how == "missing": report["missing_meshes"].append(rel)
            elif how.startswith("error"): report["errors"].append([rel, how])
            if done % 300 == 0: log("meshes", done, "/", len(meshes))
        log("meshes done, %.1f MB written" % (total / 1e6))

        tex = set()
        for m in meshes:
            p = os.path.join(STAGE, m)
            if os.path.exists(p): tex |= textures_in(open(p, "rb").read())
        for j in jobs:
            for sw in j.get("swaps") or []:
                for t in sw[1]:
                    if t: tex.add(norm(t, "textures"))
        tex = sorted(tex)
        log("textures wanted:", len(tex))
        done = 0; total = 0; t1 = time.time()
        for rel, how, n in pool.imap_unordered(fetch, [(t, index.get(t)) for t in tex], chunksize=4):
            done += 1; total += n
            if how == "missing": report["missing_textures"].append(rel)
            elif how.startswith("error"): report["errors"].append([rel, how])
            if done % 100 == 0:
                log("textures %d / %d, %.0f MB, %.1f per second" % (done, len(tex), total / 1e6, done / max(0.1, time.time() - t1)))
    report["meshes"] = len(meshes); report["textures"] = len(tex)
    json.dump(report, open(os.path.join(STAGE, "_assets_report.json"), "w"), indent=1)
    log("done. missing meshes %d, missing textures %d, errors %d" % (len(report["missing_meshes"]), len(report["missing_textures"]), len(report["errors"])))


if __name__ == "__main__":
    main()
