#!/usr/bin/env python3
"""List the pictures the ledger needs: one per distinct model and texture set.

    build_render_jobs.py <public/data/items.json> <probe_items.json> <out folder>

Writes jobs.json, for tools/bt_assets.py and tools/bt_render.py on the game PC."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from picture_keys import picture

ITEMS, PROBE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
rows = json.load(open(ITEMS, encoding="utf-8"))["items"]
probe = json.load(open(PROBE, encoding="utf-8"))
jobs = {}; n = 0
for r in rows:
    it = probe.get(r[0]); p = picture(it) if it else None
    if not p: continue
    key, model, swaps = p; n += 1
    j = jobs.setdefault(key, {"key": key, "model": model, "swaps": swaps, "name": r[1], "cat": r[2], "type": r[3], "n": 0})
    j["n"] += 1
os.makedirs(OUT, exist_ok=True)
json.dump({"jobs": list(jobs.values())}, open(os.path.join(OUT, "jobs.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("items with a model:", n, "of", len(rows), "| pictures to make:", len(jobs))
