"""
家庭責任流 — 音效與配樂合成
所有聲音都用程式合成，時間點對齊 video.html 的時間軸。
聲音語言配合「紙與墨」：紙張、筆劃、木質敲擊、印章落下＋低調的環境和弦。

用法：python3 sound.py [音效.wav] [--voice 旁白.wav --mix 混音.wav]
"""
import sys
import wave
import numpy as np
from scipy import signal

SR = 48000
# 旁白版：真實時間 → 原本 30 秒的劇情時間（與 video.html 的 TIME_MAP 相同）
TIME_MAP = [(0, 0), (2.05, 0.9), (2.75, 1.6), (5.2, 3.4), (10.7, 7.4), (12.6, 8.2),
            (18.5, 12.2), (22.6, 16.2), (27.0, 20.2), (33.9, 25.6), (39.5, 30)]
DUR = TIME_MAP[-1][0]


def real_t(tau):
    """劇情時間 → 真實時間"""
    return float(np.interp(tau, [b for a, b in TIME_MAP], [a for a, b in TIME_MAP]))


def story_t(t):
    """真實時間 → 劇情時間"""
    return float(np.interp(t, [a for a, b in TIME_MAP], [b for a, b in TIME_MAP]))


N = int(SR * DUR)
rng = np.random.default_rng(314159)
L = np.zeros(N)
R = np.zeros(N)
DRY_L = np.zeros(N)   # 不進殘響的低頻
DRY_R = np.zeros(N)


# ---------- 工具 ----------
def ts(d):
    return np.arange(int(d * SR)) / SR


def place(x, t0, gain=1.0, pan=0.0, dry=False, real=False):
    """t0 預設是劇情時間，real=True 時是真實時間"""
    i = int((t0 if real else real_t(t0)) * SR)
    if i >= N:
        return
    x = x[: N - i]
    a = (pan + 1) * np.pi / 4
    tl, tr = (DRY_L, DRY_R) if dry else (L, R)
    tl[i:i + len(x)] += x * gain * np.cos(a)
    tr[i:i + len(x)] += x * gain * np.sin(a)


def sos(kind, f, order=2):
    return signal.butter(order, f, kind, fs=SR, output='sos')


def bp(x, lo, hi, order=2):
    return signal.sosfilt(sos('bandpass', [lo, hi], order), x)


def lp(x, f, order=2):
    return signal.sosfilt(sos('lowpass', f, order), x)


def hp(x, f, order=2):
    return signal.sosfilt(sos('highpass', f, order), x)


def expdec(n, d):
    return np.exp(-np.arange(n) / SR / d)


def attack(n, a):
    e = np.ones(n)
    k = max(1, int(a * SR))
    e[:k] = np.linspace(0, 1, k)
    return e


def noise(d):
    return rng.standard_normal(int(d * SR))


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------- 音色 ----------
def tick(f=2600, d=0.03):
    n = int(d * SR)
    t = ts(d)
    x = bp(noise(d), f * 0.6, min(f * 1.8, 20000)) * expdec(n, 0.004)
    x += 0.5 * np.sin(2 * np.pi * f * 0.7 * t) * expdec(n, 0.008)
    return x


def wood(f, d=0.25):
    """木質敲擊：基音＋木琴泛音，短促"""
    t = ts(d)
    n = len(t)
    x = np.sin(2 * np.pi * f * t) * expdec(n, 0.06)
    x += 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * expdec(n, 0.025)
    x += 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * expdec(n, 0.012)
    x += 0.3 * bp(noise(d), 1500, 6000) * expdec(n, 0.003)
    return x * attack(n, 0.001)


def marimba(f, d=1.4, soft=1.0):
    t = ts(d)
    n = len(t)
    x = np.sin(2 * np.pi * f * t) * expdec(n, 0.55)
    x += 0.25 * np.sin(2 * np.pi * f * 3.93 * t) * expdec(n, 0.12)
    x += 0.08 * np.sin(2 * np.pi * f * 9.2 * t) * expdec(n, 0.04)
    x += 0.1 * soft * lp(noise(d), 2500) * expdec(n, 0.004)
    return x * attack(n, 0.003)


def bell(f, d=3.0):
    t = ts(d)
    n = len(t)
    parts = [(1.0, 1.0, 1.8), (2.0, 0.5, 1.1), (2.76, 0.35, 0.8), (5.4, 0.15, 0.35), (8.9, 0.06, 0.2)]
    x = sum(a * np.sin(2 * np.pi * f * r * t) * expdec(n, dec) for r, a, dec in parts)
    return x * attack(n, 0.004)


def sub(f0, f1, d, dec):
    """音高下墜的低頻重擊"""
    t = ts(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.08)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * expdec(len(t), dec) * attack(len(t), 0.002)


def swish(d=0.4, lo=500, hi=4500, up=True):
    """紙張翻動：濾波噪音＋漸強漸弱"""
    n = int(d * SR)
    x = noise(d)
    segs = 10
    out = np.zeros(n)
    win = np.hanning(n)
    for k in range(segs):
        c = k / (segs - 1)
        c = c if up else 1 - c
        f = lo * (hi / lo) ** c
        band = bp(x, f * 0.7, min(f * 1.4, 20000))
        w = np.clip(1 - abs(np.linspace(0, segs - 1, n) - k), 0, 1)
        out += band * w
    return out * win


def slash(d=0.16):
    """筆用力劃過紙：高頻刮擦，頻率由高往低"""
    n = int(d * SR)
    x = swish(d, 1200, 9000, up=False)
    e = attack(n, 0.004) * expdec(n, 0.06)
    return x * e * 2.2


def slam():
    """−40,000 砸下：深沉低頻＋紙面拍擊"""
    d = 1.8
    n = int(d * SR)
    body = sub(95, 38, d, 0.5)
    slap = bp(noise(0.12), 700, 3200) * expdec(int(0.12 * SR), 0.02)
    thud = lp(noise(0.4), 350) * expdec(int(0.4 * SR), 0.08)
    out = np.zeros(n)
    out += body * 1.0
    out[:len(thud)] += thud * 0.9
    out[:len(slap)] += slap * 0.8
    return out


def stamp_hit():
    """印章落在紙上：悶、短、帶一點木頭聲"""
    d = 0.5
    n = int(d * SR)
    out = sub(170, 90, d, 0.07) * 0.8
    s = bp(noise(0.08), 300, 1800) * expdec(int(0.08 * SR), 0.015)
    out[:len(s)] += s * 0.9
    w = wood(420, 0.2) * 0.25
    out[:len(w)] += w
    return out


def heartbeat():
    d = 0.4
    n = int(d * SR)
    out = np.zeros(n)
    a = sub(62, 45, 0.3, 0.05)
    out[:len(a)] += a
    j = int(0.13 * SR)
    b = sub(58, 42, 0.27, 0.045) * 0.7
    out[j:j + len(b)] += b[: n - j]
    # 中頻敲擊，讓手機喇叭也聽得到心跳
    for k, g in ((0, 0.5), (j, 0.35)):
        kn = bp(noise(0.06), 140, 700) * expdec(int(0.06 * SR), 0.012)
        out[k:k + len(kn)] += kn * g
    return out


def glide(f0, f1, d, dec=None):
    t = ts(d)
    f = f0 * (f1 / f0) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.25 * np.sin(2 * ph)
    e = np.hanning(len(t)) if dec is None else expdec(len(t), dec) * attack(len(t), 0.01)
    return x * e


def pad(notes, t0, t1, fade_in, fade_out, gain, hard_stop=False):
    """溫和的和弦墊底：每個音 3 個略微失諧的聲部（t0、t1 為劇情時間）"""
    t0, t1 = real_t(t0), real_t(t1)
    d = t1 - t0
    t = ts(d)
    n = len(t)
    x = np.zeros(n)
    for m in notes:
        f = midi(m)
        for det in (-0.12, 0.0, 0.13):
            ff = f * 2 ** (det / 12)
            ph = rng.uniform(0, 2 * np.pi)
            x += np.sin(2 * np.pi * ff * t + ph) + 0.18 * np.sin(4 * np.pi * ff * t + ph)
    x = hp(lp(x, 1600), 75)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 0.23 * t)
    e = np.ones(n)
    fi = int(fade_in * SR)
    fo = int((0.02 if hard_stop else fade_out) * SR)
    if fi:
        e[:fi] = np.linspace(0, 1, fi) ** 2
    if fo:
        e[-fo:] = np.linspace(1, 0, fo) ** (1 if hard_stop else 2)
    x = x * e * trem / (len(notes) * 3)
    place(x, t0, gain, 0.0, real=True)


def flow_texture(rate_fn, t0, t1, gain=0.05, seed=1):
    """墨點流動：大量細小的點擊聲，密度跟著畫面的粒子流（真實時間）"""
    r = np.random.default_rng(seed)
    t = t0
    while t < t1:
        rate = rate_fn(story_t(t))
        if rate <= 0:
            t += 0.02
            continue
        t += r.exponential(1 / rate)
        if t >= t1:
            break
        f = r.uniform(2200, 6500)
        place(tick(f, 0.02), t, gain * r.uniform(0.3, 1.0), r.uniform(-0.6, 0.6), real=True)


# ---------- 時間軸（對齊 video.html） ----------
CUT, SLAM = 0.9, 1.1

# 0–0.9 鉤子：小調和弦＋時鐘滴答，0.9 被劃斷時整個抽掉
pad([45, 52, 57, 60], 0.0, CUT, 0.0, 0.0, 0.55, hard_stop=True)
for k, tt in enumerate([0.0, 0.45]):
    place(wood(1850, 0.12), tt, 0.35, 0.3)
    place(tick(3200, 0.03), tt, 0.25, 0.3)


def rate_fn(t):
    main = 1.0 if t < CUT else 0.0
    buf = 1.0 if t > 21.7 else 0.0
    part = 0.6 if not (17.8 < t < 20.4) else 0.9
    tank = 0.8 if 8.7 < t < 11.4 else 0.0
    closing = 1 - min(1, max(0, (t - 25.6) / 0.8)) * 0.85
    return 55 * (main + buf + part + tank) * closing


flow_texture(rate_fn, 0.0, real_t(29.5), 0.045)

# 0.9 劃斷：兩道筆劃＋低頻一沉，接著一瞬間安靜
place(slash(), CUT, 0.9, -0.2)
place(slash(0.13), CUT + 0.07, 0.7, 0.15)
place(sub(80, 45, 0.5, 0.12), CUT, 0.6, dry=True)
for i in range(14):   # 墨點噴散的碎聲
    place(tick(rng.uniform(1800, 5000), 0.025), CUT + 0.02 + rng.uniform(0, 0.35), 0.35 * rng.uniform(0.3, 1), rng.uniform(-0.8, 0.8))

# 1.1 −40,000 砸下（視覺在 1.1 開始放大，1.36 落定）
place(slam(), SLAM + 0.22, 1.0, dry=True)
place(bp(noise(0.25), 200, 900) * np.hanning(int(0.25 * SR)), SLAM, 0.25)   # 砸下前的一點吸氣

# 1.4–20.2 低調的緊張持續音（兩個略微失諧的 A，會產生慢速的拍頻）
pad([45, 45.07, 52, 57], 1.4, 20.4, 1.2, 0.8, 0.3)

# 水桶依序轉紅：三個往下走的木琴音
for k, (tt, m) in enumerate([(1.9, 60), (2.15, 59), (2.4, 57)]):
    place(marimba(midi(m), 1.2), tt, 0.28, -0.4 + 0.4 * k)

# 標題出場的紙張聲
for tt in (3.4, 7.4, 20.2):
    place(swish(0.35), tt - 0.05, 0.22, 0.1)

# 7.6 三個選項出現
for k in range(3):
    place(wood(1200 + 150 * k, 0.12), 7.6 + 0.08 * k, 0.3, -0.5 + 0.5 * k)

# 三次點擊
for k, s in enumerate((8.2, 12.2, 16.2)):
    place(wood(900, 0.2), s + 0.28, 0.5, -0.5 + 0.5 * k)
    place(tick(4200, 0.03), s + 0.28, 0.3, -0.5 + 0.5 * k)

# 選擇一：存款一個月一個月地少，月份滴答音往下走；歸零時空洞的一聲
for k in range(1, 16):
    tt = 8.9 + k * 2.5 / 15
    place(wood(1500 * (0.55 ** (k / 15)), 0.1), tt, 0.28, 0.0)
place(marimba(midi(45), 2.0), 11.4, 0.45)
place(marimba(midi(51), 2.0), 11.42, 0.3)
place(sub(70, 40, 1.0, 0.25), 11.4, 0.5, dry=True)

# 選擇二：房貸桶流空（往下滑的音），換成房租時翻紙
place(glide(520, 170, 0.65), 13.0, 0.18)
place(swish(0.25, 800, 5000), 13.65, 0.2, 0.2)
place(marimba(midi(55), 1.2), 14.6, 0.2)

# 選擇三：另一半心跳加快（跟畫面脈動同步，每 0.524 秒一次）
tt = real_t(17.0)
while tt < real_t(20.1):
    place(heartbeat(), tt, 0.55, dry=True, real=True)
    tt += 2 * np.pi / 12
place(marimba(midi(57), 1.2), 18.2, 0.18)

# 20.8 緩衝節點落下，21.4 光環：溫暖的鐘聲大三和弦，和弦墊底轉成大調
place(glide(260, 520, 0.6), 20.8, 0.12)
for k, m in enumerate([65, 69, 72, 77]):
    place(bell(midi(m), 3.2), 21.4 + 0.06 * k, 0.16, -0.3 + 0.2 * k)
pad([41, 48, 57, 60, 64], 21.5, 26.2, 1.4, 0.8, 0.45)
for k, m in enumerate([72, 76, 79]):   # 23.6 水桶回滿
    place(marimba(midi(m), 1.5), 23.5 + 0.12 * k, 0.16, -0.3 + 0.3 * k)

# 結尾：四行字各一道筆劃，印章落下，和弦收在 C
for i in range(4):
    place(swish(0.28, 1500, 7000), 25.8 + 0.16 * i, 0.16, -0.2 + 0.13 * i)
pad([36, 43, 50, 52, 55], 25.6, 30.0, 1.0, 1.6, 0.45)
place(stamp_hit(), 27.15, 0.9, dry=True)
place(bell(midi(72), 2.8), 27.2, 0.1, 0.4)

# ---------- 混音 ----------
ir_n = int(1.9 * SR)
ir = lp(rng.standard_normal(ir_n), 4500) * np.exp(-np.arange(ir_n) / SR / 0.45)
ir /= np.sqrt(np.sum(ir ** 2))
ir_r = np.roll(ir, 331)
wet_l = signal.fftconvolve(L, ir)[:N]
wet_r = signal.fftconvolve(R, ir_r)[:N]
mix_l = L + DRY_L + 0.22 * wet_l
mix_r = R + DRY_R + 0.22 * wet_r
mix = np.stack([mix_l, mix_r])
mix = hp(mix, 28)
target_rms = 10 ** (-17 / 20)
rms = np.sqrt(np.mean(mix ** 2))
mix *= target_rms / (rms + 1e-12)
mix = np.tanh(mix * 1.1) / np.tanh(1.1)                    # 柔和限幅
mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))    # 峰值 −1 dBFS
fade = int(0.05 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade)

args = sys.argv[1:]


def opt(k, d=None):
    return args[args.index(k) + 1] if k in args else d


def write_wav(path, st):
    pcm = (np.clip(st.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def report(name, st):
    sec = [20 * np.log10(np.sqrt(np.mean(st[:, i * SR:(i + 1) * SR] ** 2)) + 1e-9) for i in range(int(DUR))]
    print('wrote', name)
    print('  每秒音量 dBFS:', ' '.join(f'{v:.0f}' for v in sec))
    print('  峰值 dBFS:', round(20 * np.log10(np.max(np.abs(st))), 2))


out = args[0] if args and not args[0].startswith('--') else 'sfx.wav'
write_wav(out, mix)
report(out, mix)

# ---------- 旁白 ----------
# 原始旁白音檔中每句的位置（秒），與放進影片的真實時間
VOICE_LINES = [
    # (來源開始, 來源結束, 放置時間)  句子
    (0.16, 2.05, 0.15),    # 如果明天沒有薪水，
    (2.74, 5.10, 2.65),    # 林家每個月，會少四萬。
    (5.91, 10.97, 5.45),   # 收入停了，房貸、學費、生活費，一樣都不會停。
    (11.78, 13.50, 10.85),  # 這時候，只能選。
    (14.61, 20.15, 12.70),  # 動用存款？六十萬，撐十五個月就見底。
    (20.77, 23.74, 18.70),  # 賣掉房子？缺口變小，但要搬家、孩子轉學。
    (24.66, 28.48, 22.80),  # 讓另一半多扛？缺口還在，人也會累。
    (29.16, 35.72, 27.20),  # 如果事先準備好緩衝，缺口先有人接住，家人就有時間好好決定。
    (36.23, 40.60, 34.20),  # 先說清楚要守住的生活，再確認正式的保障方向。
]

vpath = opt('--voice')
if vpath:
    with wave.open(vpath) as w:
        vsr, ch = w.getframerate(), w.getnchannels()
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    if ch > 1:
        raw = raw.reshape(-1, ch).mean(axis=1)
    from math import gcd
    g = gcd(SR, vsr)
    src = signal.resample_poly(raw, SR // g, vsr // g)
    V = np.zeros(N)
    edge = int(0.015 * SR)
    for a, b, at in VOICE_LINES:
        seg = src[int(a * SR):int(b * SR)].copy()
        seg[:edge] *= np.linspace(0, 1, edge)
        seg[-edge:] *= np.linspace(1, 0, edge)
        i = int(at * SR)
        seg = seg[: N - i]
        V[i:i + len(seg)] += seg
    V = hp(V, 85)
    # 輕度壓縮：讓音量穩定
    env = np.maximum(signal.sosfilt(sos('lowpass', 12), np.abs(V)), 0)
    thr = np.percentile(env[env > 1e-4], 70) if np.any(env > 1e-4) else 1
    V = V / np.maximum(1, (env / thr) ** 0.4)
    active = env > thr * 0.25
    V *= 10 ** (-17 / 20) / (np.sqrt(np.mean(V[active] ** 2)) + 1e-12)

    # 旁白說話時把音效與配樂壓低約 11 dB（ducking）
    speech = (signal.sosfilt(sos('lowpass', 6), active.astype(float)) > 0.15).astype(float)
    att, rel = np.exp(-1 / (0.04 * SR)), np.exp(-1 / (0.35 * SR))
    duck_env = signal.lfilter([1 - rel], [1, -rel], speech)            # 緩放
    duck_env = np.maximum(duck_env, signal.lfilter([1 - att], [1, -att], speech))
    duck_env = np.clip(duck_env * 1.4, 0, 1)
    duck = 1 - duck_env * (1 - 10 ** (-11 / 20))
    final = mix * 0.72 * duck + V[None, :] * np.array([[1.0], [1.0]])
    final *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(final)))
    bg = mix * 0.72 * duck
    on = speech > 0.5
    snr = 20 * np.log10(np.sqrt(np.mean(V[on] ** 2)) / (np.sqrt(np.mean(bg[:, on] ** 2)) + 1e-12))
    print(f'  說話時人聲比背景大 {snr:.1f} dB')
    mpath = opt('--mix', 'mix.wav')
    write_wav(mpath, final)
    report(mpath, final)
