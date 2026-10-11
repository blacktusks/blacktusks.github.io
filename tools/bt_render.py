"""Black Tusk Companion - render one still per item model, no background.

Run inside Blender (needs the PyNifly add-on):

    blender -b --python bt_render.py -- <jobs.json> <stage folder> <out folder> [max jobs this run]

Each job's model is read from the staging folder made by bt_assets.py. A picture
that already exists is skipped, so the run can be stopped and started again."""
import bpy, sys, os, json, math, time, traceback
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
JOBS, STAGE, OUT = argv[0], argv[1], argv[2]
LIMIT = int(argv[3]) if len(argv) > 3 else 0
SIZE = int(os.environ.get("BT_SIZE", "640"))
DEBUG = os.environ.get("BT_DEBUG") == "1"
T0 = time.time()


def log(*a):
    print("[bt %7.1fs]" % (time.time() - T0), *a, flush=True)


def norm(path, root):
    p = path.replace("/", "\\").lower().strip()
    i = p.find(root + "\\")
    return p[i:] if i >= 0 else root + "\\" + p.lstrip("\\")


def wipe():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights,
                 bpy.data.armatures, bpy.data.curves, bpy.data.actions, bpy.data.node_groups):
        for b in list(coll):
            try: coll.remove(b)
            except Exception: pass
    for c in list(bpy.data.collections): bpy.data.collections.remove(c)


def setup_scene():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try: sc.render.engine = eng; break
        except TypeError: continue
    sc.render.resolution_x = SIZE; sc.render.resolution_y = SIZE; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"; sc.render.image_settings.compression = 40
    try: sc.eevee.taa_render_samples = 32
    except Exception: pass
    sc.view_settings.view_transform = "Standard"
    try: sc.view_settings.look = "None"
    except Exception: pass
    sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
    world = bpy.data.worlds.get("bt") or bpy.data.worlds.new("bt")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (1.0, 0.97, 0.93, 1.0); bg.inputs[1].default_value = 0.6
    sc.world = world
    return sc


# The game shows an item in the inventory seen from the front (the camera sits on +Y
# looking back along it, Z up), after turning the item by its inventory marker.
NEUTRAL = Euler((-math.pi / 2, math.pi, 0), "XYZ").to_matrix()


def view_rotation(objs):
    """World rotation for the camera: the model's own inventory marker when it has one."""
    for o in bpy.data.objects:
        if o.type == "CAMERA" and o.name.startswith("BSInvMarker"):
            return o.matrix_world.to_3x3().normalized(), "marker"
    return None, "none"


def flat_side_rotation(points):
    """Look square at the model's broadest side (right for a weapon: its blade lies in that plane)."""
    n = len(points)
    c = sum(points, Vector()) / n
    cov = [[0.0] * 3 for _ in range(3)]
    for p in points:
        d = p - c
        for i in range(3):
            for j in range(3): cov[i][j] += d[i] * d[j]
    work = Matrix(cov); axes = []
    for _ in range(3):                                   # power iteration is plenty for three axes
        v = Vector((0.577, 0.577, 0.577))
        for _i in range(60):
            w = work @ v
            if w.length < 1e-12: break
            v = w.normalized()
        lam = v.dot(work @ v)
        axes.append((lam, v.copy()))
        work = work - Matrix([[lam * v[i] * v[j] for j in range(3)] for i in range(3)])
    axes.sort(key=lambda a: -a[0])
    right, up = axes[0][1], axes[1][1]
    if up.z < 0: up = -up
    look = right.cross(up).normalized()
    up = look.cross(right).normalized()
    rot = Matrix((right, up, look)).transposed()
    return rot @ Euler((math.radians(-14), math.radians(18), 0), "XYZ").to_matrix()


def fallback_rotation(points, job):
    """No inventory marker in the model. Weapons are shown flat-on. Anything else is shown the way it
    stands in the world: from the front and a little above, or from above if it is lying flat."""
    if job.get("cat") == "weapons": return flat_side_rotation(points), "flat side"
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    d = hi - lo
    if d.z < 0.55 * min(d.x, d.y):
        top = Matrix(((1, 0, 0), (0, 1, 0), (0, 0, 1)))            # camera above, +Y up the picture
        return top @ Euler((math.radians(32), 0, 0), "XYZ").to_matrix(), "from above"
    front = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0))).transposed()   # camera in front (+Y side), Z up
    yaw = Euler((0, 0, math.radians(-28)), "XYZ").to_matrix()
    return yaw @ front @ Euler((math.radians(-14), 0, 0), "XYZ").to_matrix(), "from the front"


def mesh_points(objs, limit=6000):
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        try: me = ev.to_mesh()
        except Exception: continue
        mw = o.matrix_world
        vs = me.vertices
        step = max(1, len(vs) // limit)
        for i in range(0, len(vs), step): pts.append(mw @ vs[i].co)
        ev.to_mesh_clear()
    return pts


def add_light(name, kind, energy, cam_dir, rot, center, dist, color=(1, 1, 1), size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy; data.color = color
    if kind == "SUN": data.angle = math.radians(12)
    else: data.shadow_soft_size = size
    ob = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(ob)
    d = (rot @ Vector(cam_dir)).normalized()                 # where the light sits, seen from the item
    ob.location = center + d * dist
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return ob


# Parts of a model that are not the item itself: blood that shows after a hit, the
# scabbard, glow cards, heat haze. In the game they are drawn only at certain moments.
EFFECT_NAMES = ("glowaddmesh", "heatrefraction", "g_glow", "g_wisps", "wisps", "editormarker", "bhk", "collision")
def shader_names(o):
    out = []
    for slot in o.material_slots:
        m = slot.material
        if m and m.node_tree:
            out += [n.node_tree.name for n in m.node_tree.nodes if n.type == "GROUP" and n.node_tree]
    return out


def colour_maps(o):
    """Files of the colour textures on a part, lower case."""
    out = []
    for slot in o.material_slots:
        m = slot.material
        if not m or not m.node_tree: continue
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and "diffuse" in (n.label or n.name).lower():
                out.append((n.image.filepath or "").replace("/", "\\").lower())
    return out


def part_kind(o):
    """'item' for a part of the item itself; otherwise what kind of extra it is."""
    n = o.name.lower().split(".")[0]
    shaders = shader_names(o)
    # Attachment markers and stand-in boxes carry no game material at all; drawn, they are plain white slabs.
    if not any(s.startswith("SkyrimShader") for s in shaders): return "marker"
    if n.split(":")[0] in ("scb", "scbleft"): return "scabbard"
    maps = colour_maps(o)
    # The blood that shows on a blade after a hit is a second copy of the blade wearing a blood texture.
    # It is told by that texture, not by its name: some swords are themselves called "blood...".
    if any("\\textures\\blood\\" in t for t in maps): return "blood"
    # Glow cards and energy sheets use the game's effect shader; drawn plainly they come out as white slabs.
    # A ghost weapon is made of nothing else, and render_one() draws those whole.
    if any(s.startswith("SkyrimShader:Effect") for s in shaders): return "ghost"
    # (Not told by a texture kept under textures\\effects: bees, dartwings and honeycomb keep their real skins there.)
    if n.endswith("glow") or any(k in n for k in EFFECT_NAMES): return "effect"
    return "item"


def untextured(objs):
    """Parts that should carry a colour texture and do not: the sign of an import that went wrong."""
    return sorted(o.name for o in objs if not any(t and os.path.exists(bpy.path.abspath(t)) for t in colour_maps(o)))


def make_spectral(objs):
    """Ghost weapons are drawn by the game as a glowing sheet. For a still, give them a solid pale body with the same relief."""
    for o in objs:
        for slot in o.material_slots:
            relief = None
            old = slot.material
            if old and old.node_tree:
                for n in old.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image and (n.image.filepath or "").lower().endswith("_n.dds"): relief = n.image
            m = bpy.data.materials.new("bt_spectral"); m.use_nodes = True
            nt = m.node_tree; shader = nt.nodes.get("Principled BSDF")
            if shader is None: continue
            def put(name, value):
                if name in shader.inputs: shader.inputs[name].default_value = value
            put("Base Color", (0.13, 0.36, 0.40, 1.0)); put("Roughness", 0.36); put("Metallic", 0.35)
            put("Emission Color", (0.08, 0.42, 0.48, 1.0)); put("Emission", (0.08, 0.42, 0.48, 1.0)); put("Emission Strength", 0.16)
            if relief is not None:
                try:
                    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = relief; tex.image.colorspace_settings.name = "Non-Color"
                    bump = nt.nodes.new("ShaderNodeNormalMap"); bump.inputs["Strength"].default_value = 1.4
                    nt.links.new(tex.outputs["Color"], bump.inputs["Color"]); nt.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
                except Exception: pass
            slot.material = m


def to_diagonal(rot, pts):
    """A long thin item standing straight up (or lying flat) is a sliver in a square picture.
    Turn the camera so it runs corner to corner, tip to the upper left, as the game shows its own swords."""
    inv = rot.transposed()
    xy = [(q.x, q.y) for q in (inv @ p for p in pts)]
    box_w = max(x for x, _ in xy) - min(x for x, _ in xy); box_h = max(y for _, y in xy) - min(y for _, y in xy)
    if min(box_w, box_h) >= 0.40 * max(box_w, box_h): return rot, False     # already fills its square well enough
    n = len(xy); mx = sum(x for x, _ in xy) / n; my = sum(y for _, y in xy) / n
    sxx = sum((x - mx) ** 2 for x, _ in xy); syy = sum((y - my) ** 2 for _, y in xy); sxy = sum((x - mx) * (y - my) for x, y in xy)
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)                  # the long axis, measured from the picture's x axis
    c, s_ = math.cos(theta), math.sin(theta)
    along = [(x - mx) * c + (y - my) * s_ for x, y in xy]; across = [-(x - mx) * s_ + (y - my) * c for x, y in xy]
    length = max(along) - min(along); width = max(across) - min(across)
    if length <= 1e-6 or width / length >= 0.34: return rot, False
    roll = (theta % math.pi) - 3 * math.pi / 4                      # bring the long axis to 135 degrees
    if roll <= -math.pi / 2: roll += math.pi                       # by the shorter turn, so the top end stays on top
    if abs(roll) < math.radians(4): return rot, False
    return rot @ Euler((0, 0, roll), "XYZ").to_matrix(), True


def tame_glow():
    """Enchanted and daedric pieces glow many times brighter than a still picture can show; cap it so the metal still reads."""
    n = 0
    for mat in bpy.data.materials:
        if not mat.node_tree: continue
        for node in mat.node_tree.nodes:
            if node.type != "GROUP": continue
            s = node.inputs.get("Emission Strength")
            if s is not None and not s.is_linked and s.default_value > 0.8: s.default_value = 0.8; n += 1
    return n


def apply_swaps(job, objs):
    """Texture sets the item record swaps onto the model (colour variants)."""
    done = 0
    for shape_name, tex, index in job.get("swaps") or []:
        target = None
        base = shape_name.split(":")[0].lower()
        for o in objs:
            if o.name.lower() == shape_name.lower() or o.name.lower().split(".")[0] == shape_name.lower(): target = o; break
        if target is None:
            cands = [o for o in objs if o.name.lower().startswith(base)]
            if cands: target = cands[min(index, len(cands) - 1)] if 0 <= index < len(cands) else cands[0]
        if target is None and len(objs) == 1: target = objs[0]
        if target is None: continue
        for slot in target.material_slots:
            mat = slot.material
            if not mat or not mat.node_tree: continue
            for node in mat.node_tree.nodes:
                if node.type != "TEX_IMAGE" or not node.image: continue
                label = (node.label or node.name or "").lower()
                which = 0 if "diffuse" in label else 1 if "normal" in label else 2 if ("glow" in label or "emissive" in label or "softlight" in label or "subsurface" in label) \
                    else 3 if "height" in label else 4 if ("envmap" in label or "environment" in label and "mask" not in label) else 5 if "mask" in label else 7 if "spec" in label else -1
                if which < 0 or which >= len(tex) or not tex[which]: continue
                path = os.path.join(STAGE, norm(tex[which], "textures"))
                if not os.path.exists(path): continue
                try:
                    img = bpy.data.images.load(path, check_existing=True)
                    img.colorspace_settings.name = node.image.colorspace_settings.name
                    node.image = img; done += 1
                except Exception: pass
            # A model that names no textures of its own (they all come from the item record): wire the colour map in.
            nodes = mat.node_tree.nodes
            if tex and tex[0] and not any(n.type == "TEX_IMAGE" and "diffuse" in (n.label or n.name).lower() for n in nodes):
                path = os.path.join(STAGE, norm(tex[0], "textures"))
                grp = next((n for n in nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.startswith("SkyrimShader") and "Diffuse" in n.inputs), None)
                uv = next((n for n in nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.startswith("UV_Converter")), None)
                if grp and os.path.exists(path):
                    try:
                        tn = nodes.new("ShaderNodeTexImage"); tn.name = tn.label = "Diffuse_Texture"
                        tn.image = bpy.data.images.load(path, check_existing=True); tn.image.colorspace_settings.name = "sRGB"
                        mat.node_tree.links.new(tn.outputs["Color"], grp.inputs["Diffuse"])
                        if uv and "Vector" in uv.outputs: mat.node_tree.links.new(uv.outputs["Vector"], tn.inputs["Vector"])
                        done += 1
                    except Exception: pass
    return done


def render_one(job, sc):
    path = os.path.join(STAGE, norm(job["model"], "meshes"))
    info = {"key": job["key"], "name": job.get("name")}
    if not os.path.exists(path):
        info["skip"] = "no model file"; return info
    # Now and then an import comes in without some of its textures (always the first one after
    # Blender starts, which main() gets out of the way, and rarely a later one). So the import is
    # checked, and done once more if a part of the item has no colour texture.
    for attempt in (1, 2):
        wipe()
        setup_scene()
        try:
            bpy.ops.import_scene.pynifly(filepath=path, import_collisions=False, import_animations=False, import_tris=False, import_shapekeys=False)
        except Exception as e:
            info["skip"] = "import failed: " + repr(e)[:160]; return info
        sc.render.resolution_x = SIZE; sc.render.resolution_y = SIZE      # the importer changes these for inventory markers
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 0]
        kinds = {o.name: part_kind(o) for o in meshes}
        objs = [o for o in meshes if kinds[o.name] == "item"]
        spectral = False
        if not objs:                                                      # nothing solid: a ghost weapon, drawn whole
            objs = [o for o in meshes if kinds[o.name] == "ghost"]; spectral = bool(objs) and job.get("cat") == "weapons"
        if not objs: objs = meshes
        if not objs:
            info["skip"] = "no geometry"; return info
        info["swapped"] = apply_swaps(job, objs)
        bare = [] if spectral else untextured(objs)
        loose = sorted(n for n, k in kinds.items() if k == "marker")
        if attempt == 1 and (bare or loose):
            info["first try"] = {"bare": bare, "markers": loose}
            continue
        break
    if bare: info["bare"] = bare
    for o in bpy.data.objects:
        if o.type != "CAMERA" and o not in objs: o.hide_render = True
    if spectral: make_spectral(objs); info["spectral"] = True
    info["meshes"] = len(objs)
    info["left out"] = sorted(set(k for n, k in kinds.items() if k != "item" and not (spectral and k == "ghost")))
    info["dimmed"] = tame_glow()
    info["images"] = sum(1 for i in bpy.data.images if i.filepath)
    pts = mesh_points(objs)
    if len(pts) < 3:
        info["skip"] = "no points"; return info
    rot, how = view_rotation(objs)
    if rot is not None:
        # A few models carry a marker that looks down the length of the item, so all it shows is the
        # item's end. Told by the item being far deeper than it is wide or tall; our own view is used instead.
        seen = [rot.transposed() @ p for p in pts]
        wide, tall, deep = (max(getattr(p, a) for p in seen) - min(getattr(p, a) for p in seen) for a in "xyz")
        if deep > 2.2 * max(wide, tall):
            rot = None; info["marker"] = "looks down the item, not used"
    if rot is None: rot, how = fallback_rotation(pts, job)
    rot, turned = to_diagonal(rot, pts)
    if turned: how += ", corner to corner"
    info["view"] = how
    inv = rot.transposed()
    cs = [inv @ p for p in pts]
    lo = Vector((min(p.x for p in cs), min(p.y for p in cs), min(p.z for p in cs)))
    hi = Vector((max(p.x for p in cs), max(p.y for p in cs), max(p.z for p in cs)))
    mid = (lo + hi) / 2; span = hi - lo
    radius = max(span.x, span.y, span.z, 1e-4)
    for o in list(bpy.data.objects):
        if o.type == "CAMERA": bpy.data.objects.remove(o, do_unlink=True)
    cam_data = bpy.data.cameras.new("bt_cam"); cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(span.x, span.y) * 1.10 + radius * 0.02
    cam_data.clip_start = radius * 0.01; cam_data.clip_end = radius * 8 + span.z
    cam = bpy.data.objects.new("bt_cam", cam_data)
    sc.collection.objects.link(cam)
    center = rot @ mid
    cam.matrix_world = Matrix.Translation(center + rot @ Vector((0, 0, span.z / 2 + radius * 2))) @ rot.to_4x4()
    sc.camera = cam
    d = radius * 4
    add_light("key", "SUN", 3.4, (-0.55, 0.75, 0.9), rot, center, d, (1.0, 0.96, 0.9))
    add_light("fill", "SUN", 1.5, (0.9, 0.05, 0.7), rot, center, d, (0.86, 0.92, 1.0))
    add_light("rim", "SUN", 1.6, (0.25, 0.8, -0.9), rot, center, d, (1.0, 0.92, 0.82))
    out = os.path.join(OUT, job["key"] + ".png")
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    info["ok"] = os.path.exists(out)
    info["span"] = [round(span.x, 2), round(span.y, 2), round(span.z, 2)]
    if DEBUG:
        info["objects"] = [[o.name, len(o.data.vertices), shader_names(o), kinds.get(o.name), o in objs] for o in meshes]
        nodes = []
        for mat in bpy.data.materials:
            if mat.node_tree:
                nodes.append([mat.name, [[n.type, n.name, n.label, (n.image.filepath if getattr(n, "image", None) else None)] for n in mat.node_tree.nodes if n.type in ("TEX_IMAGE", "GROUP")]])
        info["materials"] = nodes
        info["inputs"] = [[mat.name, n.node_tree.name, {i.name: (list(i.default_value) if hasattr(i.default_value, "__len__") else i.default_value) for i in n.inputs if hasattr(i, "default_value") and not i.is_linked}]
                          for mat in bpy.data.materials if mat.node_tree for n in mat.node_tree.nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.startswith("SkyrimShader")]
    return info


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = json.load(open(JOBS, encoding="utf-8"))["jobs"]
    state_path = os.path.join(OUT, "_state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    todo = [j for j in jobs if not os.path.exists(os.path.join(OUT, j["key"] + ".png")) and j["key"] not in state.get("skipped", {})]
    log("jobs", len(jobs), "to do", len(todo))
    if DEBUG:
        op = bpy.ops.import_scene.pynifly.get_rna_type()
        log("import options:", [(p.identifier, getattr(p, "default", None)) for p in op.properties if p.identifier != "rna_type"])
    sc = setup_scene()
    # The first import after Blender starts can come in without its textures. Spend it on a model whose picture is not kept.
    for j in todo[:1]:
        path = os.path.join(STAGE, norm(j["model"], "meshes"))
        if os.path.exists(path):
            try: bpy.ops.import_scene.pynifly(filepath=path, import_collisions=False, import_animations=False, import_tris=False, import_shapekeys=False)
            except Exception as e: log("warm-up import failed", repr(e)[:120])
            wipe(); sc = setup_scene()
    done = 0
    for j in todo:
        if LIMIT and done >= LIMIT: break
        t = time.time()
        try: info = render_one(j, sc)
        except Exception as e:
            info = {"key": j["key"], "name": j.get("name"), "skip": "crash: " + repr(e)[:200]}
            traceback.print_exc()
        info["sec"] = round(time.time() - t, 2)
        if info.get("skip"): state.setdefault("skipped", {})[j["key"]] = info
        else: state.setdefault("done", {})[j["key"]] = info
        done += 1
        log("JOB", json.dumps(info, ensure_ascii=True))
        if done % 10 == 0 or DEBUG: json.dump(state, open(state_path, "w"))
    json.dump(state, open(state_path, "w"))
    left = sum(1 for j in jobs if not os.path.exists(os.path.join(OUT, j["key"] + ".png")) and j["key"] not in state.get("skipped", {}))
    log("RUN DONE", done, "left", left)


main()
