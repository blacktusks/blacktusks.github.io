"""The 0.4.0 app icon: the Black Tusk emblem and the Scorned skull, each split down the middle and driven
together along a jagged, burning rift."""
import numpy as np, cv2
from PIL import Image
S = 1024
rng = np.random.default_rng(41)
bt = cv2.imread('tools/art/blacktusk-512.png').astype(np.float32) / 255
bt = cv2.resize(bt, (S, S), interpolation=cv2.INTER_CUBIC)
sk = cv2.imread('tools/art/scorned-skull-close.png', cv2.IMREAD_UNCHANGED)[..., :3].astype(np.float32) / 65535
sk = cv2.resize(sk, (S, S), interpolation=cv2.INTER_AREA)
# the Scorned half a touch warmer and darker at the edges, so the two cloths meet as one piece
# The two sides carry about the same weight: the Black Tusk emblem a little larger and brighter, so its black
# face reads against the red cloth, and the Scorned skull's bone toned down so it does not outshine it.
Z = 1.14
bt = cv2.warpAffine(bt, np.float32([[Z, 0, S / 2 * (1 - Z)], [0, Z, S * 0.42 * (1 - Z)]]), (S, S), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
bt = np.clip((bt - 0.5) * 1.18 + 0.5 + 0.05, 0, 1)
bt[..., 2] = np.clip(bt[..., 2] * 1.08, 0, 1)                         # a richer red
sk = sk * 0.8
sk = sk * 0.85 + sk.mean(-1, keepdims=True) * 0.15
# Both faces stay centred: the rift splits each down its middle (one Black Tusk eye and nostril, half the skull's nose).

# ── the rift: a lightning-like path from top to bottom, built by midpoint displacement
def bolt(p0, p1, rough, depth):
    pts = [p0, p1]
    for d in range(depth):
        new = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            m = ((a[0] + b[0]) / 2 + rng.normal(0, rough * 0.6 ** d), (a[1] + b[1]) / 2)
            new += [m, b]
        pts = new
    return np.array(pts, np.float32)
# a bolt down the middle with real kinks in it, breaking from side to side as it falls
anchors = [(S * 0.53, -12), (S * 0.47, S * 0.18), (S * 0.52, S * 0.35), (S * 0.497, S * 0.52), (S * 0.53, S * 0.70), (S * 0.47, S * 0.86), (S * 0.505, S + 12)]
main = np.concatenate([bolt(a, b, 30, 5)[:-1] for a, b in zip(anchors[:-1], anchors[1:])] + [np.array([anchors[-1]], np.float32)])
xs = np.interp(np.arange(S), main[:, 1], main[:, 0])                 # the split's x for every row
Y, X = np.mgrid[0:S, 0:S].astype(np.float32)
side = X - xs[:, None]                                               # <0: Black Tusk side, >0: Scorned side
soft = np.clip(side / 2.5 * 0.5 + 0.5, 0, 1)[..., None]
img = bt * (1 - soft) + sk * soft

# scorched edges either side of the rift
dist = np.abs(side)
scorch = np.exp(-(dist / 20) ** 1.6)[..., None]
img = img * (1 - 0.6 * scorch) + np.array([0.02, 0.012, 0.01]) * 0.6 * scorch
# a hot rim on the cloth right at the tear
rim = np.exp(-(dist / 9) ** 2)[..., None]
img = img + rim * np.array([0.05, 0.25, 0.85])[None, None, ::-1] * 0.0 + rim * np.array([0.08, 0.32, 1.0]) * 0.55

# ── the burning line itself, with a few forks
line = np.zeros((S, S), np.float32)
cv2.polylines(line, [main.astype(np.int32)], False, 1.0, 6, cv2.LINE_AA)
for k in range(6):
    i = int((0.12 + 0.13 * k + rng.uniform(-0.03, 0.03)) * len(main)); a = main[i]
    out_ = -1 if k % 2 == 0 else 1                                   # forks reach out to each side in turn
    ang = rng.uniform(0.45, 0.95)                                    # from straight down
    length = rng.uniform(55, 120)
    b = (a[0] + out_ * np.sin(ang) * length, a[1] + np.cos(ang) * length)
    f = bolt((float(a[0]), float(a[1])), b, 9, 4)
    cv2.polylines(line, [f.astype(np.int32)], False, 0.6, 2, cv2.LINE_AA)
core = cv2.GaussianBlur(line, (0, 0), 1.2)
glow1 = cv2.GaussianBlur(line, (0, 0), 7)
glow2 = cv2.GaussianBlur(line, (0, 0), 22)
glow3 = cv2.GaussianBlur(line, (0, 0), 60)
# colours in BGR: white-hot core, gold, ember orange, deep red
light = (core[..., None] * np.array([0.85, 0.97, 1.0]) * 2.2 + glow1[..., None] * np.array([0.25, 0.75, 1.0]) * 2.0
         + glow2[..., None] * np.array([0.08, 0.35, 1.0]) * 1.3 + glow3[..., None] * np.array([0.02, 0.10, 0.75]) * 0.7)
img = 1 - (1 - np.clip(img, 0, 1)) * (1 - np.clip(light, 0, 1))      # screen

# embers thrown off the rift
emb = np.zeros((S, S), np.float32)
for _ in range(110):
    t = rng.uniform(0, 1); y = int(t * S); x = xs[min(S - 1, max(0, y))] + rng.normal(0, 70)
    r = rng.uniform(1.0, 3.2)
    cv2.circle(emb, (int(x), int(y + rng.normal(0, 20))), int(round(r)), float(rng.uniform(0.4, 1.0)), -1, cv2.LINE_AA)
emb = cv2.GaussianBlur(emb, (0, 0), 1.0)
embglow = cv2.GaussianBlur(emb, (0, 0), 6)
light2 = emb[..., None] * np.array([0.55, 0.85, 1.0]) * 1.4 + embglow[..., None] * np.array([0.05, 0.4, 1.0]) * 1.3
img = 1 - (1 - np.clip(img, 0, 1)) * (1 - np.clip(light2, 0, 1))

# a soft vignette pulls the eye to the two faces
v = np.hypot((X - S / 2) / (S * 0.72), (Y - S * 0.46) / (S * 0.72))
img *= (1 - 0.4 * np.clip(v - 0.45, 0, 1) ** 1.4)[..., None]
img = np.clip(img, 0, 1)
master = (img[..., ::-1] * 255 + 0.5).astype(np.uint8)
Image.fromarray(master).save('tools/art/icon-1024.png')

out = 'public/icons/'
m = Image.fromarray(master)
m.resize((512, 512), Image.LANCZOS).save(out + 'icon-512.png', optimize=True)
m.resize((192, 192), Image.LANCZOS).save(out + 'icon-192.png', optimize=True)
m.resize((180, 180), Image.LANCZOS).save(out + 'apple-touch-icon.png', optimize=True)
m.resize((64, 64), Image.LANCZOS).save(out + 'favicon-64.png', optimize=True)
# maskable: the art drawn a little smaller inside a bleed of its own edges, so a round mask keeps both faces
pad = int(S * 0.08)
big = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REFLECT)
blurred = cv2.GaussianBlur(big, (0, 0), 18) * 0.55
w = np.zeros(big.shape[:2], np.float32); w[pad:-pad, pad:-pad] = 1
w = cv2.GaussianBlur(w, (0, 0), 14)[..., None]
mk = big * w + blurred * (1 - w)
mk = (np.clip(mk, 0, 1)[..., ::-1] * 255 + 0.5).astype(np.uint8)
Image.fromarray(mk).resize((512, 512), Image.LANCZOS).save(out + 'icon-maskable-512.png', optimize=True)
print('icons written')
