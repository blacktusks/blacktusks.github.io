"""The looping themes (one for each clan, and the stranger's theme before signing in) and the UI sounds for the Black Tusk Companion, made from scratch.

War drums, war horns and steel on steel. Everything is synthesised here; the horn is layered with the
General MIDI tuba from the SoundFont that ships with the system (TimGM6mb). Nothing is sampled from any
game or record.

    python3 tools/sound/make.py          -> tools/sound/out/*.wav
    then, for each: ffmpeg -i out/NAME.wav -c:a libmp3lame -b:a 160k public/sounds/NAME.mp3 (128k for the ui_ sounds)

Each theme is one seamless loop: the pattern is rendered three times over with its reverb and the middle
pass is kept, so every tail that rings past the end comes back in at the start.
"""
import math, os
import numpy as np
from scipy import signal
import tinysoundfont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
SR = 44100
SF2 = '/usr/share/sounds/sf2/TimGM6mb.sf2'
rng = np.random.default_rng(1847)

def sec(x): return int(round(x * SR))
def T(n): return np.arange(n) / SR
def db(x): return 10 ** (x / 20)
def noise(n): return rng.standard_normal(n)
def lp(x, f, order=2): b, a = signal.butter(order, min(f, SR / 2 - 100) / (SR / 2), 'low'); return signal.lfilter(b, a, x, axis=0)
def hp(x, f, order=2): b, a = signal.butter(order, f / (SR / 2), 'high'); return signal.lfilter(b, a, x, axis=0)
def bp(x, f1, f2, order=2): b, a = signal.butter(order, [f1 / (SR / 2), min(f2, SR / 2 - 100) / (SR / 2)], 'band'); return signal.lfilter(b, a, x, axis=0)

def stft_filter(x, mask_fn, nper=2048):
    f, t, Z = signal.stft(x, SR, nperseg=nper, noverlap=nper * 3 // 4, boundary='even')
    _, y = signal.istft(Z * mask_fn(f[:, None], t[None, :]), SR, nperseg=nper, noverlap=nper * 3 // 4, boundary=True)
    y = y[: len(x)]
    return np.pad(y, (0, len(x) - len(y)))

def pan(sig, p):
    a = (p + 1) * math.pi / 4
    return np.stack([sig * math.cos(a), sig * math.sin(a)], 1)

# ── drums ────────────────────────────────────────────────────────────────
def war_drum(big=1.0, pitch=1.0, dark=1.0):
    """A huge hide drum struck with a club: a falling boom, the skin's slap, the room's thud."""
    n = sec(2.2); t = T(n)
    f0 = 46 * pitch
    f = f0 * (1 + 1.6 * np.exp(-t * 34))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * (2.6 / big))
    body += 0.42 * np.sin(ph * 2.27 + 0.4) * np.exp(-t * 8)
    body += 0.2 * np.sin(ph * 3.51) * np.exp(-t * 15)
    slap = bp(noise(n), 500, 2600 / dark) * np.exp(-t * 48) * 0.5
    thud = lp(noise(n), 160) * np.exp(-t * 16) * 1.3
    return np.tanh((body + slap + thud) * 1.7) * 0.85

def tom(pitch=1.0, strength=1.0):
    """A smaller skin drum played with the hand or a stick."""
    n = sec(0.9); t = T(n)
    f = 98 * pitch * (1 + 0.7 * np.exp(-t * 40))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 7.5) + 0.38 * np.sin(ph * 1.62) * np.exp(-t * 14)
    x += bp(noise(n), 700, 4200) * np.exp(-t * 58) * 0.7
    return np.tanh(x * 1.4) * 0.65 * strength

def frame_drum(strength=1.0):
    n = sec(0.5); t = T(n)
    f = 150 * (1 + 0.3 * np.exp(-t * 60))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12) * 0.6
    x += bp(noise(n), 1200, 6000) * np.exp(-t * 70) * 0.8
    return x * 0.5 * strength

def clack(strength=1.0):
    """Bone or stick on the drum's rim."""
    n = sec(0.14); t = T(n)
    x = bp(noise(n), 1600, 5500) * np.exp(-t * 85) + np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 110) * 0.45
    return x * 0.55 * strength

def rattle(strength=1.0):
    n = sec(0.22); t = T(n)
    grains = np.zeros(n)
    for _ in range(18):
        i = int(rng.uniform(0, n * 0.6)); k = sec(0.004)
        grains[i:i + k] += rng.uniform(0.3, 1) * np.hanning(k)
    return hp(grains, 3000) * np.exp(-t * 14) * 0.5 * strength

def rumble(length=1.6):
    """A low roll on the big drum, rising."""
    n = sec(length); t = T(n)
    x = np.zeros(n)
    hits = int(length * 15)
    for k in range(hits):
        s = sec(k / 15 + rng.uniform(0, 0.012)); h = war_drum(0.5, 1.05 + rng.uniform(-0.03, 0.03)) * (0.25 + 0.75 * (k / hits) ** 1.6)
        e = min(n, s + len(h)); x[s:e] += h[: e - s] * 0.5
    return x

# ── steel ────────────────────────────────────────────────────────────────
def anvil(f=1180, strength=1.0, length=2.4):
    """Hammer on anvil: hard inharmonic ring."""
    n = sec(length); t = T(n)
    ratios = [1.0, 2.76, 5.40, 8.93, 13.34, 1.51]
    decays = [1.5, 2.4, 3.8, 5.6, 8.0, 1.9]
    amps = [1.0, 0.6, 0.38, 0.22, 0.12, 0.3]
    x = sum(a * np.sin(2 * np.pi * f * r * t + r) * np.exp(-t * d) for r, d, a in zip(ratios, decays, amps))
    x += bp(noise(n), 2500, 9000) * np.exp(-t * 80) * 0.8
    return x * 0.26 * strength

def sword_clash(strength=1.0, f=1650):
    """Blade on blade: a bright clang, a beat between two near partials, and the scrape of edges."""
    n = sec(2.0); t = T(n)
    parts = [(1.0, 1.0, 2.2), (1.013, 0.8, 2.4), (2.43, 0.5, 4.0), (3.91, 0.35, 6.0), (5.62, 0.22, 8.0), (0.61, 0.3, 3.0)]
    x = sum(a * np.sin(2 * np.pi * f * r * t + r * 3) * np.exp(-t * d) for r, a, d in parts)
    scrape_e = np.minimum(1, t / 0.01) * np.exp(-t * 9)
    def mask(fr, tt):
        fc = 5200 - 2600 * np.clip(tt / 0.35, 0, 1)
        return np.exp(-0.5 * (np.log(np.maximum(fr, 1) / fc) / 0.3) ** 2)
    scrape = stft_filter(noise(n), mask, 512) * scrape_e * 0.6
    hit = bp(noise(n), 2000, 9500) * np.exp(-t * 120) * 0.9
    return (x * 0.22 + scrape + hit) * strength

# ── war horn ─────────────────────────────────────────────────────────────
def saw(ph): return 2 * (ph - np.floor(ph + 0.5))

def war_horn(f, length, rise=0.3, fall=0.9, brightness=1.0):
    """A great curved horn: the note is pushed up into pitch, the brass opens as the breath swells,
    a slow shake comes in, and it dies with the breath."""
    n = sec(length); t = T(n)
    bend = 1 - 0.14 * np.exp(-t / 0.09)
    vib = 1 + 0.007 * np.sin(2 * np.pi * 4.6 * t) * np.clip((t - 0.7) / 0.8, 0, 1)
    ph = np.cumsum(f * bend * vib) / SR
    src = saw(ph) + 0.7 * saw(ph * 1.0045 + 0.3) + 0.5 * saw(ph * 0.5)
    env = np.minimum(1, t / rise) ** 1.6 * np.clip((length - t) / fall, 0, 1) ** 1.2
    env *= 1 + 0.08 * np.sin(2 * np.pi * 0.7 * t)
    open_ = np.minimum(1, t / (rise * 1.6)) * np.clip((length - t) / (fall * 1.4), 0, 1)
    def mask(fr, tt):
        o = np.interp(tt, t, open_)
        cut = (260 + 1700 * brightness * o ** 1.3)
        low = 1 / (1 + (fr / cut) ** 6)
        formant = 1 + 1.6 * np.exp(-0.5 * ((fr - 520) / 160) ** 2) + 1.0 * np.exp(-0.5 * ((fr - 1150) / 260) ** 2)
        return low * formant
    body = stft_filter(src, mask, 4096)
    breath = bp(noise(n), 700, 2600) * env * 0.035
    return np.tanh((body * env + breath) * 1.4) * 0.5

def tuba(notes, length):
    """The General MIDI tuba under the horn, for weight."""
    syn = tinysoundfont.Synth(samplerate=SR, gain=-3)
    sfid = syn.sfload(SF2); syn.program_select(0, sfid, 0, 58)
    ev = sorted([(s, 1, k, v) for s, d, k, v in notes] + [(s + d, 0, k, 0) for s, d, k, v in notes], key=lambda e: (e[0], e[1]))
    out = np.zeros((sec(length), 2), np.float32); pos = 0
    for tm, on, k, v in ev:
        tgt = min(len(out), sec(tm))
        if tgt > pos: out[pos:tgt] = np.frombuffer(syn.generate(tgt - pos), np.float32).reshape(-1, 2); pos = tgt
        (syn.noteon if on else syn.noteoff)(0, int(k), *( [int(v)] if on else []))
    if pos < len(out): out[pos:] = np.frombuffer(syn.generate(len(out) - pos), np.float32).reshape(-1, 2)
    return out

# ── beds ─────────────────────────────────────────────────────────────────
def drone(f, length, bright=520):
    n = sec(length); t = T(n)
    ph = f * t
    x = saw(ph * 0.997) + saw(ph * 1.004) + 0.5 * saw(ph * 2.002) + 0.35 * saw(ph * 1.5)
    def mask(fr, tt):
        fc = bright * (1 + 0.3 * np.sin(2 * np.pi * 0.09 * tt))
        return 1 / (1 + (fr / fc) ** 4)
    return stft_filter(x, mask, 4096) * 0.14

def wind(length, base=360):
    n = sec(length)
    def mask(fr, tt):
        fc = np.maximum(80, base + 200 * np.sin(2 * np.pi * 0.13 * tt) + 110 * np.sin(2 * np.pi * 0.37 * tt + 1))
        return np.exp(-0.5 * (np.log(np.maximum(fr, 1) / fc) / 0.38) ** 2)
    return stft_filter(noise(n), mask) * 0.45

def crackle(length, density=14):
    n = sec(length)
    bed = lp(noise(n), 500) * 0.06
    pops = np.zeros(n)
    for _ in range(int(density * length)):
        i = int(rng.uniform(0, n - 2000)); L = sec(rng.uniform(0.002, 0.01))
        pops[i:i + L] += rng.uniform(0.1, 1) * np.exp(-np.arange(L) / (L / 4 + 1)) * rng.choice([-1, 1])
    return bed + bp(pops, 1200, 9000) * 0.45

# ── reverb, loop rendering ──────────────────────────────────────────────
def make_ir(rt60=2.6, length=4.0, damp=5000):
    n = sec(length); t = T(n)
    ir = np.stack([noise(n), noise(n)], 1) * np.exp(-6.9 * t / rt60)[:, None]
    ir = lp(ir, damp); ir[: sec(0.02)] = 0
    for d, g in [(0.023, 0.5), (0.037, 0.35), (0.051, 0.28), (0.066, 0.2)]:
        ir[sec(d), 0] += g; ir[sec(d * 1.06), 1] += g
    return ir / np.sqrt((ir ** 2).sum() / 2)

def conv(x, ir): return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)

class Loop:
    """Events on a looping timeline; render() returns one seamless pass."""
    def __init__(self, length):
        self.L = length; self.stems = {}
    def add(self, stem, sig, t, gain=1.0, p=0.0):
        if sig.ndim == 1: sig = pan(sig, p)
        self.stems.setdefault(stem, []).append((t % self.L, sig * gain))
    def render(self, mix, rt60, wet=0.32):
        n = sec(self.L) * 3
        dry = np.zeros((n, 2)); send = np.zeros((n, 2))
        for name, evs in self.stems.items():
            g, s = mix.get(name, (0, 0.2))
            buf = np.zeros((n, 2))
            for t0, sig in evs:
                for k in range(3):
                    i = sec(t0 + k * self.L)
                    if i >= n: continue
                    e = min(n, i + len(sig)); buf[i:e] += sig[: e - i]
            dry += buf * db(g); send += buf * db(g) * s
        return dry + conv(send, make_ir(rt60)) * wet     # three passes; the caller keeps the middle one

def master(x, target_peak=-1.0):
    x = hp(x, 30)
    env = np.sqrt(lp(np.mean(x ** 2, 1), 6, 1) + 1e-9)
    over = np.maximum(0, 20 * np.log10(env) + 15)
    x = x * db(-over * (1 - 1 / 2.5))[:, None]
    x = np.tanh(x / np.max(np.abs(x)) * 1.15) / np.tanh(1.15)
    return x * db(target_peak)

def write(name, x):
    from scipy.io import wavfile
    wavfile.write(os.path.join(OUT, name), SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))

# ── the two themes ──────────────────────────────────────────────────────
BPM = 88
STEP = 60 / BPM / 4            # a sixteenth
BAR = 16 * STEP
BARS = 16
LEN = BARS * BAR               # ~43.6 s

def grid(loop, stem, pattern, bar, maker, gain=1.0, p=0.0, human=0.006):
    """pattern: 16 characters per bar: X loud, x soft, . rest."""
    for i, ch in enumerate(pattern):
        if ch == '.': continue
        v = 1.0 if ch == 'X' else 0.55 if ch == 'x' else 0.3
        loop.add(stem, maker(v), bar * BAR + i * STEP + rng.uniform(-human, human), gain, p + rng.uniform(-0.08, 0.08))

def theme(clan):
    bt = clan == 'black_tusks'
    loop = Loop(LEN)
    root = 50 if bt else 48            # D for the Black Tusks, C (a step darker) for the Scorned
    f_root = 440 * 2 ** ((root - 69) / 12)
    # the heartbeat of the war drums
    if bt:
        A = dict(big='X.....x.X..x....', tom='x..x....x.x.x...', mid='..x.X.x...x...X.', rim='....x.......x...')
        B = dict(big='X..x..x.X..x..x.', tom='x.xx..x.x.xx..x.', mid='.xx.X.x..xx.x.X.', rim='....x..x....x...')
        F = dict(big='X.....X.X.X.X.XX', tom='x.x.x.x.xxxxXXXX', mid='..x.X.x.xxxxxxxx', rim='....x.......x...')
    else:
        # the same drums, the beat falling three-three-two, heavier and more spare
        A = dict(big='X..X..X.X.......', tom='x.....x...x.....', mid='...x.....x..x...', rim='......x.......x.')
        B = dict(big='X..X..X.X..X..x.', tom='x..x..x.x..x..x.', mid='.x.x.x.x.x.x.xX.', rim='......x.......x.')
        F = dict(big='X..X..X.X.X.X.XX', tom='x..x..x.xxxxXXXX', mid='.x.x.x.xxxxxxxxx', rim='......x.......x.')
    plan = ['A', 'A', 'A', 'F', 'B', 'B', 'B', 'F', 'A', 'A', 'B', 'F', 'B', 'B', 'B', 'F']
    for bar, kind in enumerate(plan):
        P = dict(A=A, B=B, F=F)[kind]
        grid(loop, 'big', P['big'], bar, lambda v: war_drum(1.0, 1.0 if bt else 0.94) * v, 1.0, -0.05)
        grid(loop, 'tom', P['tom'], bar, lambda v: tom(1.0 if bt else 0.9, v), 0.9, 0.25)
        grid(loop, 'mid', P['mid'], bar, lambda v: tom(1.45 if bt else 1.32, v * 0.8), 0.8, -0.3)
        grid(loop, 'rim', P['rim'], bar, lambda v: clack(v), 0.7, 0.35)
        if kind != 'F':
            grid(loop, 'shaker', ('x.x.' * 4) if bt else ('x..x..x.' * 2), bar, lambda v: rattle(v * 0.6), 0.5, 0.5)
        if bar in (7, 15):
            loop.add('big', rumble(1.4), bar * BAR + 9 * STEP, 0.55, 0.0)
    # war horns: a long call at the top of the loop and its answer halfway
    horn_calls = ([(0, 0, 4.2), (8, 0, 2.2), (8 + 8 * STEP / BAR, 7, 3.0)] if bt
                  else [(0, 0, 4.6), (8, -5, 2.4), (8 + 8 * STEP / BAR, 0, 3.4)])
    for bar_at, step_semis, length in horn_calls:
        f = f_root / 2 * 2 ** (step_semis / 12)
        t0 = bar_at * BAR
        loop.add('horn', war_horn(f, length, brightness=1.0 if bt else 0.8), t0, 1.0, -0.1)
        loop.add('horn', war_horn(f * 0.5, length, brightness=0.7), t0 + 0.02, 0.55, 0.1)
        loop.add('tuba', tuba([(0.05, length - 0.4, root - 24 + step_semis, 96)], length + 1.5), t0, 0.9)
    # steel on steel
    if bt:
        for bar in (3, 11):
            loop.add('steel', anvil(1180), bar * BAR + 12 * STEP, 0.9, 0.4)
            loop.add('steel', anvil(1240, 0.7), bar * BAR + 14 * STEP, 0.9, 0.42)
        loop.add('steel', anvil(1100, 1.2, 3.2), 8 * BAR, 0.8, -0.3)
        for bar in (5, 13):
            loop.add('steel', anvil(1320, 0.45), bar * BAR + 6 * STEP, 0.8, 0.5)
    else:
        for bar in (3, 11):
            loop.add('steel', sword_clash(1.0, 1650), bar * BAR + 13 * STEP, 0.9, -0.35)
        loop.add('steel', sword_clash(1.25, 1480), 8 * BAR, 0.85, 0.3)
        loop.add('steel', sword_clash(0.6, 1820), 13 * BAR + 6 * STEP, 0.8, 0.45)
    # the bed: the forge's hum and its fire at Largashbur; wind over the snow at Narzulbur. Each pass of the
    # bed runs a second past the loop and crossfades into the next, so the seam is never heard.
    X = 1.0
    def bed(sig):
        n = len(sig); w = np.ones(n); k = sec(X)
        w[:k] = np.sin(np.linspace(0, np.pi / 2, k)); w[-k:] = np.cos(np.linspace(0, np.pi / 2, k))
        return sig * (w[:, None] if sig.ndim == 2 else w)
    loop.add('drone', bed(np.stack([drone(f_root / 4, LEN + X), drone(f_root / 4 * 1.002, LEN + X)], 1)), 0, 1.0)
    if bt: loop.add('bed', bed(np.stack([crackle(LEN + X), crackle(LEN + X)], 1)), 0, 1.0)
    else: loop.add('bed', bed(np.stack([wind(LEN + X), wind(LEN + X, 420)], 1)), 0, 1.0)
    mix = {'big': (-3.0, 0.22), 'tom': (-5.0, 0.2), 'mid': (-7.5, 0.18), 'rim': (-11, 0.25), 'shaker': (-17, 0.2),
           'horn': (-4.0, 0.5), 'tuba': (-9.0, 0.35), 'steel': (-7.0, 0.45), 'drone': (-11, 0.15), 'bed': (-15 if bt else -13, 0.05)}
    full = master(loop.render(mix, rt60=2.4 if bt else 3.4, wet=0.3 if bt else 0.4), -1.5)
    L = sec(LEN)
    return full[L:2 * L]      # mastered over all three passes, so the compressor carries across the seam too

# ── the stranger's theme: the home screen before anyone signs in ─────────
S_BPM = 60
S_BEAT = 60 / S_BPM
S_BARS = 12
S_LEN = S_BARS * 4 * S_BEAT          # 48 s

def impact(scale=1.0):
    """A war drum the size of a wagon: a falling sub boom, the hide's crack, a long rumble of the room."""
    n = sec(4.0); t = T(n)
    f = 34 * (1 + 2.2 * np.exp(-t * 22))
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.3)
    body = war_drum(1.8, 0.78)
    x = np.zeros(n); x[:len(body)] += body * 0.9
    x += sub * 1.1
    x += lp(noise(n), 220) * np.exp(-t * 3.5) * 0.9              # the rumble
    x += bp(noise(n), 900, 5000) * np.exp(-t * 60) * 0.6         # the crack of the hide
    return np.tanh(x * 1.5 * scale) * 0.9

def swell_into(hit, length=1.6, ir=None):
    """The sound sucked backwards into the next blow: the hit's own echo, reversed."""
    wet = signal.fftconvolve(hit, ir[:, 0])[: sec(length)] if ir is not None else hit[: sec(length)]
    r = wet[::-1] * np.linspace(0, 1, len(wet)) ** 2
    return r / (np.max(np.abs(r)) + 1e-9) * 0.5

def heartbeat():
    """Lub-dub, felt more than heard."""
    def thud(gain):
        n = sec(0.5); t = T(n); f = 52 * (1 + 0.5 * np.exp(-t * 30))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * gain
    out = np.zeros(sec(0.9)); a = thud(1.0); b = thud(0.7)
    out[:len(a)] += a; out[sec(0.28):sec(0.28) + len(b)] += b
    return lp(out, 200)

def dread(length, f=65.4):
    """A low cluster a half step wide that beats slowly against itself, with a thin whistle drifting above."""
    n = sec(length); t = T(n)
    x = saw(f * t * 0.998) + saw(f * t * 1.003) + 0.8 * saw(f * 2 ** (1 / 12) * t) + 0.6 * saw(f / 2 * t)
    def mask(fr, tt):
        fc = 240 * (1 + 0.45 * np.sin(2 * np.pi * 0.05 * tt) ** 2)
        return 1 / (1 + (fr / fc) ** 4)
    low = stft_filter(x, mask, 4096) * 0.16
    breath = 0.65 + 0.35 * np.sin(2 * np.pi * t / 12) ** 2
    ph = np.cumsum(f * 12 * (1 + 0.012 * np.sin(2 * np.pi * 0.07 * t))) / SR
    whistle = np.sin(2 * np.pi * ph) * 0.012 * (0.5 + 0.5 * np.sin(2 * np.pi * t / 9 + 1) ** 4)
    return low * breath + whistle

def bowed_steel(length=4.0, f=410):
    """A blade drawn slowly across another: inharmonic singing that swells and dies, with grit."""
    n = sec(length); t = T(n)
    env = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 2
    parts = [(1.0, 1.0), (1.007, 0.7), (2.31, 0.45), (3.73, 0.3), (5.12, 0.18)]
    tone = sum(a * np.sin(2 * np.pi * f * r * t * (1 + 0.003 * np.sin(2 * np.pi * 0.3 * t)) + r) for r, a in parts)
    grit = bp(noise(n), 2500, 7000) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 7.3 * t)))
    return (tone * 0.12 + grit * 0.05) * env

def chains(length=1.2):
    n = sec(length); t = T(n); x = np.zeros(n)
    for k in range(14):
        i = int(rng.uniform(0, n * 0.7)); h = anvil(rng.uniform(2400, 4200), rng.uniform(0.1, 0.3), 0.4)
        e = min(n, i + len(h)); x[i:e] += h[: e - i]
    return x * np.exp(-t * 1.2)

def stranger():
    loop = Loop(S_LEN)
    ir = make_ir(4.6, 6.0, 3800)
    B = lambda bar, beat: (bar * 4 + beat) * S_BEAT
    # the blows: few, uneven, and close to silence in between
    hits = [(0, 0, 1.0), (1, 2.5, 0.8), (2, 0, 1.0), (3, 0, 0.9), (3, 0.5, 0.75), (4, 3, 0.85),
            (6, 0, 1.0), (6, 2, 0.8), (7, 0, 1.0), (7, 0.75, 0.8), (7, 1.5, 0.9), (7, 3, 1.15),
            (9, 1, 0.85), (10, 0, 1.0), (10, 2.5, 0.8), (11, 0, 0.95)]
    for bar, beat, g in hits:
        h = impact(g)
        loop.add('impact', h, B(bar, beat), g, rng.uniform(-0.15, 0.15))
        loop.add('swell', swell_into(h, 1.4, ir), B(bar, beat) - 1.4, g * 0.9, 0.0)
    # a heartbeat where the drums fall quiet
    for bar in (4, 5, 8, 9):
        for beat in (0, 1, 2, 3):
            if (bar, beat) in ((4, 3), (9, 1)): continue
            loop.add('heart', heartbeat(), B(bar, beat), 0.8, 0)
    # a distant horn a tritone from home, and steel drawn in the dark
    C2 = 65.4
    loop.add('horn', war_horn(C2 * 2 ** (6 / 12), 6.5, rise=1.6, fall=3.2, brightness=0.35), B(4, 1), 0.8, -0.3)
    loop.add('horn', war_horn(C2 * 2 ** (6 / 12) / 2, 6.5, rise=1.8, fall=3.0, brightness=0.3), B(4, 1.1), 0.5, 0.2)
    loop.add('horn', war_horn(C2 * 2 ** (1 / 12), 5.5, rise=1.4, fall=3.0, brightness=0.35), B(9, 3), 0.7, 0.3)
    loop.add('steel', bowed_steel(5.0, 410), B(2, 1.5), 0.9, 0.5)
    loop.add('steel', bowed_steel(4.0, 387), B(8, 0.5), 0.8, -0.5)
    loop.add('steel', chains(1.4), B(5, 2), 0.7, 0.4)
    loop.add('steel', chains(1.2), B(11, 2.5), 0.6, -0.4)
    X = 1.5
    def bed(sig):
        n = len(sig); w = np.ones(n); k = sec(X)
        w[:k] = np.sin(np.linspace(0, np.pi / 2, k)); w[-k:] = np.cos(np.linspace(0, np.pi / 2, k))
        return sig * (w[:, None] if sig.ndim == 2 else w)
    loop.add('drone', bed(np.stack([dread(S_LEN + X, C2), dread(S_LEN + X, C2 * 1.0015)], 1)), 0, 1.0)
    loop.add('bed', bed(np.stack([wind(S_LEN + X, 300), wind(S_LEN + X, 340)], 1)), 0, 1.0)
    mix = {'impact': (-1.5, 0.5), 'swell': (-9, 0.6), 'heart': (-8, 0.25), 'horn': (-7, 0.75), 'steel': (-9, 0.7), 'drone': (-6, 0.3), 'bed': (-14, 0.1)}
    n = sec(S_LEN) * 3
    full = master(loop.render(mix, rt60=4.6, wet=0.55), -1.5)
    L = sec(S_LEN)
    return full[L:2 * L]

# ── UI sounds ───────────────────────────────────────────────────────────
def one_shot(parts, length, rt60=1.4, wet=0.22):
    n = sec(length); buf = np.zeros((n, 2))
    for t0, sig, g, p in parts:
        if sig.ndim == 1: sig = pan(sig, p)
        i = sec(t0); e = min(n, i + len(sig)); buf[i:e] += sig[: e - i] * g
    out = buf + conv(np.vstack([buf, np.zeros((sec(rt60), 2))]), make_ir(rt60, rt60 * 1.5))[:n] * wet
    fade = np.ones(n); fade[-sec(0.08):] = np.linspace(1, 0, sec(0.08))
    out *= fade[:, None]
    return out / (np.max(np.abs(out)) + 1e-9) * db(-3)

def whoosh(length=0.6, lo=300, hi=2600, up=True):
    n = sec(length); t = T(n); u = t / length
    def mask(fr, tt):
        k = np.clip(tt / length, 0, 1); k = k if up else 1 - k
        fc = lo + (hi - lo) * np.sin(np.pi * k) ** 1.5
        return np.exp(-0.5 * (np.log(np.maximum(fr, 1) / fc) / 0.5) ** 2)
    return stft_filter(noise(n), mask, 1024) * np.sin(np.pi * u) ** 2

def parchment(length=0.42):
    n = sec(length); t = T(n)
    x = np.zeros(n)
    for _ in range(40):
        i = int(rng.uniform(0, n * 0.8)); k = sec(rng.uniform(0.004, 0.02))
        x[i:i + k] += rng.uniform(0.2, 1) * np.hanning(min(k, n - i))
    rustle = bp(noise(n) * np.convolve(x, np.ones(80) / 80, 'same'), 1500, 9000)
    return rustle * np.exp(-t * 3) * 3

def fire(length=1.4):
    n = sec(length); t = T(n)
    e = np.minimum(1, t / 0.06) * np.exp(-t * 2.6)
    roar = lp(noise(n), 900) * e + bp(noise(n), 900, 4000) * e * 0.35
    return roar + crackle(length, 30) * e * 1.5

def ui_sounds():
    S = {}
    # hovering a menu line: a soft tick of bone on wood
    t = T(sec(0.08)); S['hover'] = one_shot([(0, (np.sin(2 * np.pi * 1350 * t) * np.exp(-t * 90) * 0.4 + bp(noise(len(t)), 2500, 7000) * np.exp(-t * 160) * 0.5) * 0.6, 1, 0)], 0.22, 0.6, 0.15) * db(-10)
    # choosing: the drum answers, with a faint ring of steel
    S['select'] = one_shot([(0, war_drum(0.35, 1.25), 0.9, 0), (0.0, tom(1.6, 0.7), 0.6, 0.1), (0.01, anvil(1500, 0.35, 1.2), 0.5, 0.2)], 1.3, 1.6, 0.25)
    # going back: a breath of air falling away and a soft knock
    S['back'] = one_shot([(0, whoosh(0.35, 250, 1400, up=False), 0.7, -0.2), (0.16, tom(1.1, 0.5), 0.6, 0)], 0.9)
    # a screen opening: parchment unrolled
    S['open'] = one_shot([(0, parchment(0.45), 0.9, 0.1), (0.02, frame_drum(0.4), 0.5, 0)], 0.8, 1.0, 0.15)
    # saving: a hammer's ting on the anvil
    S['save'] = one_shot([(0, anvil(1250, 0.8, 1.6), 0.9, 0.15), (0, tom(1.3, 0.6), 0.5, 0)], 1.7, 1.4, 0.2)
    # refused: two dull knocks
    S['denied'] = one_shot([(0, tom(0.75, 0.9), 0.9, 0), (0.13, tom(0.7, 0.7), 0.8, 0)], 0.8, 0.8, 0.12)
    # Praise Malacath: fire bursts up over a deep drum and a low horn swell
    S['praise'] = one_shot([(0, war_drum(1.0, 0.9), 0.9, 0), (0.02, fire(1.6), 0.8, 0.1), (0.05, war_horn(73.4, 1.8, rise=0.25, fall=1.0, brightness=0.6), 0.8, -0.1)], 2.6, 2.4, 0.3)
    # Pay Respect: a slow fire and a single drum, quieter
    S['respect'] = one_shot([(0, war_drum(1.2, 0.8), 0.8, 0), (0.05, fire(1.8), 0.6, 0), (0.9, war_drum(0.9, 0.8), 0.5, 0)], 2.8, 2.6, 0.32)
    # visiting the other clan: wind through fog and a distant horn
    S['switch'] = one_shot([(0, whoosh(1.4, 200, 1800), 0.9, -0.2), (0.25, war_horn(61.7, 1.9, rise=0.5, fall=1.1, brightness=0.55), 0.55, 0.2), (1.25, war_drum(0.8, 0.95), 0.5, 0)], 3.0, 3.0, 0.4)
    return S

if __name__ == '__main__':
    import sys
    which = sys.argv[1:] or ['themes', 'ui']
    if 'themes' in which:
        for clan in ('black_tusks', 'scorned'):
            x = theme(clan); write(f'theme_{clan}.wav', x); print(clan, round(len(x) / SR, 2), 's')
    if 'stranger' in which or 'themes' in which:
        x = stranger(); write('theme_stranger.wav', x); print('stranger', round(len(x) / SR, 2), 's')
    if 'ui' in which:
        for k, v in ui_sounds().items(): write(f'ui_{k}.wav', v)
        print('ui done')
