#!/usr/bin/env python3
"""Turn the raw game dump (tools/extract_game_data.py) into the app's item
catalog and map places.  Usage: build_catalog.py <raw_dir> <public/data dir>"""
import json, re, sys, os, collections

RAW, OUT = sys.argv[1], sys.argv[2]
load = lambda n: json.load(open(os.path.join(RAW, n), encoding="utf-8"))
items = load("raw_items.json"); recipes = load("raw_recipes.json"); flora = load("raw_flora.json")
refs = load("raw_refs.json")["refs"]; plugins = load("raw_plugins.json"); mk = load("raw_markers.json")
order = {p["name"]: i for i, p in enumerate(plugins)}
by_gid = {i["gid"]: i for i in items}

SOURCES = [
    (r"^(skyrim|update)\.esm$", "Skyrim"), (r"^dawnguard", "Dawnguard"), (r"^hearthfires", "Hearthfire"),
    (r"^dragonborn", "Dragonborn"), (r"^ccbgssse001", "Creation Club: Fishing"), (r"^ccqdrsse001", "Creation Club: Survival Mode"),
    (r"^ccbgssse037", "Creation Club: Rare Curios"), (r"^ccbgssse025", "Creation Club: Saints & Seducers"),
    (r"^_resourcepack", "Skyrim"), (r"^unofficial skyrim", "Skyrim"),
    (r"^(rp_|daedric landscape|daedricwardrobe|\[kirax\]|lostark)", "Daedric Online"),
    (r"^hothtrooper44|^immersive armors|^ia cbbe", "Immersive Armors"), (r"^immersive weapons", "Immersive Weapons"),
    (r"^sentinel", "Sentinel Equipment Overhaul"), (r"^dis_heavy_legion", "New Legion"), (r"^kad_moonmonk", "Moon Monk's Robes"),
    (r"^evgnnsmp", "Nirn Necessities"), (r"^mysticism", "Mysticism"), (r"^windhelmsse", "Capital Windhelm Expansion"),
    (r"^surwr", "Capital Whiterun Expansion"), (r"^notice board", "The Notice Board"), (r"^ocw_", "Obscure's College of Winterhold"),
    (r"^riften expansion", "Riften Expansion"), (r"^armors of the velothi", "Armors of the Velothi"),
    (r"^dragonpriestarmor", "Armory of the Dragon Cult"), (r"^commonclothes", "Common Clothes and Armors"),
    (r"^cloaks&capes", "Cloaks and Capes"), (r"^morecraftable", "More Craftable Equipment"),
    (r"^mage clothing", "Mage Clothing Expansion"), (r"^common clothing", "Common Clothing Expansion"),
    (r"^saltdeposits", "Sea Salt Deposits"), (r"^ghostlight", "Dark Hierophant Magic"), (r"^pipesmoking", "Pipe Smoking"),
    (r"^jk", "JK's Skyrim"), (r"^cotn", "Cities of the North"), (r"^(the great cit|tgc|resources - the great)", "The Great Cities"),
]
def source_label(plugin):
    low = plugin.lower()
    for pat, lab in SOURCES:
        if re.search(pat, low): return lab
    return os.path.splitext(plugin)[0]

def split_edid(s):
    s = re.sub(r"^(RP_|DLC\d|cc[A-Z]+\d+_)", "", s or "")
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s).replace("_", " ").strip()

def clean(s):
    s = re.sub(r"<[^>]*>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()

WEAP_KW = [("WeapTypeGreatsword", "Greatsword"), ("WeapTypeBattleaxe", "Battleaxe"), ("WeapTypeWarhammer", "Warhammer"),
           ("WeapTypeSword", "Sword"), ("WeapTypeWarAxe", "War Axe"), ("WeapTypeMace", "Mace"), ("WeapTypeDagger", "Dagger"),
           ("WeapTypeBow", "Bow"), ("WeapTypeStaff", "Staff")]
ANIM = {0: "Unarmed", 1: "Sword", 2: "Dagger", 3: "War Axe", 4: "Mace", 5: "Greatsword", 6: "Battleaxe", 7: "Bow", 8: "Staff", 9: "Crossbow"}
MATERIAL_FIX = {"IronBanded": "Banded Iron", "SteelPlate": "Steel Plate", "DraugrHoned": "Honed Draugr", "FalmerHoned": "Honed Falmer",
                "ElvenGilded": "Gilded Elven", "ImperialHeavy": "Imperial", "ImperialLight": "Imperial", "ImperialStudded": "Imperial",
                "StormcloakStudded": "Stormcloak"}
def material(kw):
    for k in kw:
        m = re.match(r"^(?:DLC\d)?(?:Weap|Armor)Material(.+)$", k)
        if m:
            raw = m.group(1)
            return MATERIAL_FIX.get(raw, split_edid(raw))
    return ""

def playable(i):
    r = i["rec"]
    if not i.get("name"): return False
    if r in ("ARMO", "WEAP", "MISC", "AMMO") and i["rflags"] & 0x4: return False
    if r == "WEAP" and i.get("wflags", 0) & 0x80: return False
    if r == "AMMO" and i.get("aflags", 0) & 0x2: return False
    if r == "LIGH" and not i.get("lflags", 0) & 0x2: return False
    i["name"] = i["name"].strip()
    e = (i.get("edid") or "").lower(); n = i["name"].lower()
    if not i["name"] or n.startswith("123 abc") or re.match(r"^[\u00e0-\u00ff] ", n): return False   # font test books
    if e.startswith(("test", "e3demo", "dummy", "zz")) or "dummy" in n or "do not use" in n or n.startswith(("test ", "<")): return False
    return True

def classify(i):
    """-> (category, type, klass, stat)"""
    r = i["rec"]; kw = i.get("kw", []); name = i["name"]; edid = i.get("edid") or ""
    if r == "WEAP":
        t = next((lab for k, lab in WEAP_KW if k in kw), None) or ANIM.get(i.get("anim", 0), "Weapon")
        if i.get("anim") == 9: t = "Crossbow"
        if t == "Unarmed": t = "Other"
        return "weapons", t, material(kw), i.get("damage", 0)
    if r == "AMMO":
        return "weapons", ("Arrow" if i.get("aflags", 0) & 0x4 else "Bolt"), material(kw), round(i.get("damage", 0))
    if r == "ARMO":
        s = i.get("slots", 0); at = i.get("atype", 2)
        jew = any(k in kw for k in ("ArmorJewelry", "ClothingRing", "ClothingNecklace", "ClothingCirclet", "JewelryExpensive"))
        klass = "Jewelry" if jew else ("Heavy" if at == 1 else "Light" if at == 0 else "Clothing")
        part = None
        for ks, lab in ((("ArmorShield",), "Shield"), (("ClothingRing",), "Ring"), (("ClothingNecklace",), "Amulet"),
                        (("ClothingCirclet",), "Circlet"), (("ArmorCuirass", "ClothingBody"), "Body"),
                        (("ArmorHelmet", "ClothingHead"), "Head"), (("ArmorGauntlets", "ClothingHands"), "Hands"),
                        (("ArmorBoots", "ClothingFeet"), "Feet")):
            if any(k in kw for k in ks): part = lab; break
        if not part:
            if s & (1 << 9): part = "Shield"
            elif s & (1 << 2): part = "Body"
            elif s & (1 << 3): part = "Hands"
            elif s & (1 << 7): part = "Feet"
            elif s & (1 << 12): part = "Circlet"
            elif s & ((1 << 0) | (1 << 1)): part = "Head"
            elif s & (1 << 5): part = "Amulet"
            elif s & (1 << 6): part = "Ring"
            elif s & ((1 << 16) | (1 << 10) | (1 << 15)): part = "Cloak" if re.search(r"cloak|cape|mantle", name, re.I) else "Accessory"
            else: part = "Accessory"
        if re.search(r"\b(cloak|cape)\b", name, re.I) and part in ("Accessory", "Body"): part = "Cloak"
        return "apparel", part, klass, round(i.get("armor", 0))
    if r == "ALCH":
        f = i.get("eflags", 0)
        if f & 0x20000: return "potions", "Poison", "", None
        if f & 0x2:
            drink = re.search(r"\b(ale|mead|wine|brandy|milk|water|tea|juice|sujamma|flin|shein|matze|skooma|brew|beer|cider|rum|whiskey|spirits)\b", name, re.I)
            return "food", ("Drink" if drink else "Food"), "", None
        return "potions", "Potion", "", None
    if r == "INGR": return "ingredients", "Ingredient", "", None
    if r == "SCRL": return "scrolls", "Scroll", "", None
    if r == "KEYM": return "keys", "Key", "", None
    if r == "BOOK":
        f = i.get("bflags", 0); model = (i.get("model") or "").lower()
        if f & 0x4: return "books", "Spell Tome", "", None
        if f & 0x1: return "books", "Skill Book", "", None
        if "note" in model or "letter" in model or i.get("btype") == 255: return "books", "Note", "", None
        if "journal" in model: return "books", "Journal", "", None
        if "recipe" in edid.lower() or re.search(r"recipe", name, re.I): return "books", "Recipe", "", None
        return "books", "Book", "", None
    if r == "SLGM": return "misc", "Soul Gem", "", None
    if r == "LIGH": return "misc", "Torch", "", None
    # MISC
    low = name.lower(); el = edid.lower()
    if el.startswith("rp_charcoal") or "charcoal" in low: return "misc", "Fuel", "", None
    if "VendorItemOreIngot" in kw:
        if re.search(r"\bore\b", low) or el.startswith("ore") or low in ("stalhrim", "sea salt rock"): return "misc", "Ore", "", None
        if "ingot" in low or low.startswith("refined"): return "misc", "Ingot", "", None
        if "dwemer" in low or "dwarven" in el: return "misc", "Dwemer Scrap", "", None
        return "misc", "Material", "", None
    if "VendorItemGem" in kw: return "misc", "Gem", "", None
    if "VendorItemAnimalHide" in kw: return "misc", "Hide", "", None
    if "VendorItemAnimalPart" in kw: return "misc", "Animal Part", "", None
    if "VendorItemTool" in kw: return "misc", "Tool", "", None
    if "VendorItemFireword" in kw or low == "firewood": return "misc", "Firewood", "", None
    if el.startswith("byohmaterial") or "BYOHHouseCraftingCategoryBuilding" in kw: return "misc", "Building Material", "", None
    if "claw" in low and "dragon" in el: return "misc", "Dragon Claw", "", None
    if low in ("leather", "leather strips") or re.search(r"\b(linen|thread|cloth|wool|fabric)\b", low): return "misc", "Material", "", None
    if "VendorItemClutter" in kw: return "misc", "Clutter", "", None
    return "misc", "Misc", "", None

BENCH = {
    "CraftingSmithingForge": "Forge", "CraftingSmithingSkyforge": "Skyforge", "CraftingSmelter": "Smelter",
    "CraftingTanningRack": "Tanning rack", "CraftingCookpot": "Cooking pot", "BYOHCraftingOven": "Oven",
    "RP_NexusLoom": "Loom", "RP_CraftingLoom": "Loom", "MCE_CraftingLoom": "Loom", "DLC2StaffEnchanter": "Staff enchanter",
    "isGrainMill": "Grain mill", "DLC1CraftingDawnguard": "Forge", "DLC1LD_CraftingForgeAetherium": "Aetherium Forge",
    "Camping_CampfireCookingShared": "Campfire", "BYOHBuildingCarpenter": "Carpenter's workbench",
    "rp_nexus.esp:000902": "Alchemy and brewing station", "_BL_CraftingKeyword": "Crafting station",
}
TEMPER = {"CraftingSmithingSharpeningWheel": "Grindstone", "CraftingSmithingArmorTable": "Workbench"}

# Daedric Online reuses hidden vanilla perks as profession ranks. The rank
# order below follows the value of what each perk unlocks in the server files.
RANKS = {}
for prof, chain in (("Cook", ["Haggling00", "Allure", "Merchant", "Investor", "fence", "MasterTrader"]),
                    ("Alchemist", ["Enchanter20", "Enchanter40", "Enchanter60", "Enchanter80", "SoulSqueezer"]),
                    ("Tailor", ["Enchanter00", "FireEnchanter", "FrostEnchanter", "StormEnchanter", "InsightfulEnchanter", "CorpusEnchanter"])):
    for n, e in enumerate(chain, 1): RANKS[e.lower()] = "%s rank %d" % (prof, n)
PERK_FIX = {"extraeffect": "Master Blacksmith", "teachmoonmonkperk": "Moon Monk teachings"}

def perk_label(gid):
    r = refs.get(gid) or {}
    e = (r.get("edid") or "").lower()
    if e in RANKS: return RANKS[e]
    if e in PERK_FIX: return PERK_FIX[e]
    return (r.get("name") or "").strip() or split_edid(r.get("edid") or gid)

def requirement(rcp):
    groups = []; cur = []; blocked = False
    for func, op, val, p1, _p2 in rcp.get("ctda", []):
        if func != 448 or isinstance(val, str) or val != 1.0 or (op >> 5) != 0:
            if cur and not (op & 1): groups.append(cur); cur = []
            continue
        if (refs.get(p1) or {}).get("edid") == "RP_Blocked": blocked = True
        else: cur.append(perk_label(p1))
        if not (op & 1):
            if cur: groups.append(cur)
            cur = []
    if cur: groups.append(cur)
    seen = []; out = []
    for g in groups:
        g = list(dict.fromkeys(g)); key = tuple(g)
        if key in seen: continue
        seen.append(key); out.append(" or ".join(g))
    return blocked, "; ".join(out)

# ---------------------------------------------------------------- items
kept = {}
cat_rank = {"Skyrim": 0, "Dawnguard": 1, "Hearthfire": 2, "Dragonborn": 3}
pool = [i for i in items if playable(i)]
pool.sort(key=lambda i: (order.get(i["src"], 999), i["gid"]))
out_items = []; dedupe = {}; alias = {}
src_list = []; src_idx = {}
for i in pool:
    cat, typ, klass, stat = classify(i)
    val = int(i.get("value") or 0); wt = round(float(i.get("weight") or 0), 2)
    ench = bool(i.get("ench")); generic = ench and bool(i.get("tpl"))
    key = (cat, i["name"], typ, klass, val, wt, stat, i.get("ench_name", ""))
    if key in dedupe:
        alias[i["gid"]] = dedupe[key]; continue
    dedupe[key] = i["gid"]; alias[i["gid"]] = i["gid"]
    lab = source_label(i["src"])
    if lab not in src_idx: src_idx[lab] = len(src_list); src_list.append(lab)
    flags = (1 if generic else 0) | (2 if ench else 0)
    out_items.append([i["gid"], i["name"], cat, typ, klass, val, wt, stat, src_idx[lab], flags])
    kept[i["gid"]] = i

name_of = lambda g: (by_gid.get(g) or {}).get("name") or ""

# ---------------------------------------------------------------- recipes
make = collections.defaultdict(list); temper = {}; uses = collections.defaultdict(list); breaks = collections.defaultdict(list)
for r in recipes:
    out = r.get("out"); bench = r.get("bench") or ""
    if not out or out not in by_gid or not r["ing"] or not bench: continue   # no bench = switched off on the server
    if bench.startswith("testPhil") or (bench.startswith("BYOHBuilding") and bench != "BYOHBuildingCarpenter"): continue
    ing = [(g, q) for g, q in r["ing"] if name_of(g)]
    if len(ing) != len(r["ing"]): continue
    blocked, req = requirement(r)
    okey = alias.get(out, out)
    if bench in TEMPER:
        if okey not in temper or r["win"].startswith("RP_"):
            temper[okey] = {"b": TEMPER[bench], "i": [[name_of(g), q] for g, q in ing]}
        continue
    out_rec = by_gid[out]["rec"]
    breakdown = out_rec in ("MISC", "INGR") and len(ing) == 1 and by_gid[ing[0][0]]["rec"] in ("ARMO", "WEAP")
    if breakdown:
        breaks[alias.get(ing[0][0], ing[0][0])].append([name_of(out), r.get("n", 1)])
        continue
    entry = {"b": BENCH.get(bench, split_edid(bench) or "Crafting station"), "n": r.get("n", 1),
             "i": [[name_of(g), q] for g, q in ing]}
    if req: entry["r"] = req
    if blocked: entry["x"] = 1
    entry["_rank"] = (0 if r["win"].startswith("RP_") else 1, 1 if blocked else 0, order.get(r["win"], 999))
    make[okey].append(entry)
    if not blocked:
        for g, _q in ing:
            uses[alias.get(g, g)].append(name_of(out))

harvest = collections.defaultdict(list)
for f in flora:
    if f.get("name") and f.get("gives") in by_gid:
        harvest[alias.get(f["gives"], f["gives"])].append(f["name"])

def fx_text(e):
    d = e.get("desc") or ""
    if not d: return e.get("name", "")
    mag = e.get("mag", 0); mag = int(mag) if float(mag).is_integer() else round(mag, 1)
    d = d.replace("<mag>", str(mag)).replace("<dur>", str(e.get("dur", 0))).replace("<area>", str(e.get("area", 0)))
    return clean(d)

details = {}
for gid, i in kept.items():
    d = {}
    r = i["rec"]
    if r != "BOOK" and i.get("desc"):
        t = clean(i["desc"])
        if t: d["d"] = t[:400]
    fx = i.get("fx") or []
    if r == "INGR":
        names = [e.get("name") for e in fx if e.get("name")]
        if names: d["fx"] = names
    elif fx:
        texts = list(dict.fromkeys(t for t in (fx_text(e) for e in fx) if t))
        if texts: d["fx"] = texts[:4]
    if i.get("ench"):
        en = i.get("ench_name") or ", ".join(dict.fromkeys(x for x in i.get("ench_fx", []) if x))
        if en: d["en"] = en
    m = make.get(gid)
    if m:
        m.sort(key=lambda e: e["_rank"])
        uniq = []; seen = set()
        for e in m:
            k = (e["b"], tuple(map(tuple, e["i"])))
            if k in seen: continue
            seen.add(k); uniq.append({k2: v for k2, v in e.items() if k2 != "_rank"})
        d["mk"] = uniq[:4]
        if len(uniq) > 4: d["mkn"] = len(uniq)
    if gid in temper: d["tp"] = temper[gid]
    if gid in breaks: d["bd"] = breaks[gid][:3]
    u = list(dict.fromkeys(uses.get(gid, [])))
    if u:
        d["us"] = sorted(u)[:14]; d["usn"] = len(u)
    if gid in harvest: d["hv"] = sorted(set(harvest[gid]))[:6]
    if d: details[gid] = d

os.makedirs(OUT, exist_ok=True)
def dump(name, obj):
    p = os.path.join(OUT, name)
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("wrote %-14s %7.1f KB" % (name, os.path.getsize(p) / 1024))

out_items.sort(key=lambda r: (r[2], r[1].lower()))
dump("items.json", {"v": 1, "sources": src_list, "cols": ["key", "name", "cat", "type", "cls", "value", "weight", "stat", "src", "flags"], "items": out_items})
dump("details.json", details)

# ---------------------------------------------------------------- places
TYPE = {1: "City", 2: "Town", 3: "Settlement", 4: "Cave", 5: "Camp", 6: "Fort", 7: "Nordic Ruin", 8: "Dwemer Ruin", 9: "Shipwreck",
        10: "Grove", 11: "Landmark", 12: "Dragon Lair", 13: "Farm", 14: "Wood Mill", 15: "Mine", 16: "Imperial Camp",
        17: "Stormcloak Camp", 18: "Standing Stone", 19: "Wheat Mill", 20: "Smelter", 21: "Stable", 22: "Tower", 23: "Clearing",
        24: "Pass", 25: "Altar", 26: "Rock", 27: "Lighthouse", 28: "Orc Stronghold", 29: "Giant Camp", 30: "Shack",
        31: "Nordic Tower", 32: "Nordic Dwelling", 33: "Docks", 34: "Shrine"}
places = []; seen = set()
for m in mk["markers"]:
    if "x" not in m or not m.get("name") or m["rflags"] & 0x20: continue
    n = clean(m["name"]); t = m.get("type", 0)
    if n in ("Bounty", "Ferry Drop off Marker") or "DUPLICATE" in (m.get("edid") or ""): continue
    label = "City" if 35 <= t <= 52 else TYPE.get(t, "Landmark")
    k = (n, round(m["x"] / 2000), round(m["y"] / 2000))
    if k in seen: continue
    seen.add(k)
    places.append([n, label, round(m["x"]), round(m["y"]), 1 if source_label(m["src"]) == "Daedric Online" else 0])
places.sort(key=lambda p: p[0])
dump("places.json", {"cols": ["name", "type", "x", "y", "server"], "places": places})
print("items", len(out_items), "of", len(pool), "playable;", "details", len(details), "; places", len(places))
print(collections.Counter(r[2] for r in out_items))
print("generic enchanted variants:", sum(1 for r in out_items if r[9] & 1))
