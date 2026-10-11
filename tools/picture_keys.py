"""Which picture belongs to which item: one per distinct model and texture set.
Shared by build_catalog.py and build_render_jobs.py."""
import json, hashlib


def pick(it):
    """-> (model path, texture swaps) for an item record from tools/bt_probe.py."""
    m = it["models"]; a = it.get("alts") or {}
    if it["rec"] == "ARMO":           # the model that lies on the ground, male first
        for k, ak in (("MOD2", "MO2S"), ("MOD4", "MO4S")):
            if m.get(k): return m[k], a.get(ak)
        return None, None
    return (m["MODL"], a.get("MODS")) if m.get("MODL") else (None, None)


def picture(it):
    """-> (key, model, swaps), or None when the record has no model to draw."""
    model, swaps = pick(it)
    if not model or not model.lower().endswith(".nif"): return None
    swaps = sorted((s for s in (swaps or []) if isinstance(s[1], list)), key=lambda s: (s[2], s[0]))
    ident = model.lower().replace("/", "\\") + "|" + json.dumps(swaps, sort_keys=True)
    return hashlib.sha1(ident.encode("utf-8")).hexdigest()[:12], model, swaps
