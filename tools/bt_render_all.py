#!/usr/bin/env python3
"""Black Tusk Companion - run tools/bt_render.py in Blender until every picture is made.

    python bt_render_all.py <jobs.json> <stage folder> <out folder> [pictures per Blender run]

Blender is restarted every few hundred pictures so its memory stays small. Safe to
stop and start again: pictures already made are skipped."""
import subprocess, sys, os, re, time, json

BLENDER = os.environ.get("BLENDER", r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe")
HERE = os.path.dirname(os.path.abspath(__file__))
JOBS, STAGE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BATCH = sys.argv[4] if len(sys.argv) > 4 else "300"
t0 = time.time(); last_left = None; stuck = 0
os.makedirs(OUT, exist_ok=True)
while True:
    p = subprocess.run([BLENDER, "-b", "--python", os.path.join(HERE, "bt_render.py"), "--", JOBS, STAGE, OUT, BATCH],
                       capture_output=True, text=True, errors="replace")
    m = re.search(r"RUN DONE (\d+) left (\d+)", p.stdout or "")
    with open(os.path.join(OUT, "_blender_last.txt"), "w", encoding="utf-8") as f: f.write((p.stdout or "")[-200000:] + "\n=== stderr\n" + (p.stderr or "")[-20000:])
    if not m:
        print("[%6.0fs] Blender stopped early (exit %s); starting it again" % (time.time() - t0, p.returncode), flush=True)
        stuck += 1
        # whatever it was working on when it died is skipped next time round
        state_path = os.path.join(OUT, "_state.json")
        last = re.findall(r'JOB (\{.*\})', p.stdout or "")
        jobs = json.load(open(JOBS, encoding="utf-8"))["jobs"]
        state = json.load(open(state_path)) if os.path.exists(state_path) else {}
        for j in last:
            try: info = json.loads(j)
            except ValueError: continue
            (state.setdefault("skipped", {}) if info.get("skip") else state.setdefault("done", {}))[info["key"]] = info
        known = set(state.get("done", {})) | set(state.get("skipped", {}))
        nxt = next((j for j in jobs if j["key"] not in known and not os.path.exists(os.path.join(OUT, j["key"] + ".png"))), None)
        if nxt: state.setdefault("skipped", {})[nxt["key"]] = {"key": nxt["key"], "name": nxt.get("name"), "skip": "Blender stopped on this model"}
        json.dump(state, open(state_path, "w"))
        if stuck > 60: print("giving up", flush=True); break
        continue
    done, left = int(m.group(1)), int(m.group(2))
    print("[%6.0fs] made %d this run, %d left" % (time.time() - t0, done, left), flush=True)
    if left == 0: break
    if left == last_left and done == 0: print("no progress, stopping", flush=True); break
    last_left = left
print("ALL DONE in %.0f s" % (time.time() - t0), flush=True)
