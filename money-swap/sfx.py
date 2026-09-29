"""
錢在工作 — 點綴效果音（音樂是主體，這裡只放少量石頭聲）
時間點取自 timeline.js；輸出 sfx.wav（31.2 秒、48kHz 立體聲）。

用法：python3 sfx.py [sfx.wav]
"""
import sys
import wave

import numpy as np
from scipy import signal

SR = 48000
DUR = 31.2
N = int(SR * DUR)
rng = np.random.default_rng(20260929)
L = np.zeros(N)
R = np.zeros(N)

# 與 timeline.js 相同的時間點
CRACKS = [1.552, 3.050, 3.535]
SHATTER = 4.017
LIFT, HANG, SLAM = 19.568, 20.964, 21.446
WALL_FALL = 25.335
STAMP = 28.752
END_CRACK = 30.728


def ts(d):
    return np.arange(int(d * SR)) / SR


def expdec(n, d):
    return np.exp(-np.arange(n) / SR / d)


def noise(d):
    return rng.standard_normal(int(d * SR))


def bp(x, lo, hi):
    return signal.sosfilt(signal.butter(2, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lp(x, f):
    return signal.sosfilt(signal.butter(2, f, 'lowpass', fs=SR, output='sos'), x)


def place(x, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N or i + len(x) <= 0:
        return
    if i < 0:
        x, i = x[-i:], 0
    x = x[: N - i]
    a = (pan + 1) * np.pi / 4
    L[i:i + len(x)] += x * gain * np.cos(a)
    R[i:i + len(x)] += x * gain * np.sin(a)


def click(f, d=0.012):
    n = int(d * SR)
    return bp(noise(d), f * 0.6, min(f * 1.8, 20000)) * expdec(n, d / 4)


def crackle(d, density, lo=1500, hi=7000, seed=0):
    """石頭龜裂：一串不規則的細碎喀啦聲，越到後面越密"""
    r = np.random.default_rng(seed)
    out = np.zeros(int(d * SR))
    t = 0.0
    while t < d:
        t += r.exponential(1 / (density * (0.4 + t / d)))
        if t >= d:
            break
        c = click(r.uniform(lo, hi), r.uniform(0.006, 0.02)) * r.uniform(0.3, 1.0)
        i = int(t * SR)
        out[i:i + len(c)] += c[: len(out) - i]
    return out


def thud(f0, f1, d, dec):
    t = ts(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.05)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), dec)
    body = bp(noise(d), 120, 900) * expdec(len(t), dec * 0.5)
    return x * 0.7 + body * 0.8


def rubble(d, count, seed):
    """碎石崩落：很多小石塊先後落地"""
    r = np.random.default_rng(seed)
    out = np.zeros(int(d * SR))
    for _ in range(count):
        t = r.exponential(d / 4)
        if t >= d:
            continue
        f = r.uniform(300, 2500)
        n = int(0.05 * SR)
        c = bp(noise(0.05), f * 0.5, f * 1.6) * expdec(n, r.uniform(0.006, 0.02)) * r.uniform(0.2, 1.0) * np.exp(-t / d * 1.5)
        i = int(t * SR)
        out[i:i + n] += c[: len(out) - i]
    return out


def rise(d):
    """巨石上升：低沉的風聲，頻率慢慢往上"""
    n = int(d * SR)
    x = noise(d)
    out = np.zeros(n)
    segs = 12
    for k in range(segs):
        f = 120 * (6 ** (k / (segs - 1)))
        w = np.clip(1 - np.abs(np.linspace(0, segs - 1, n) - k), 0, 1)
        out += bp(x, f * 0.7, f * 1.5) * w
    env = np.linspace(0, 1, n) ** 1.6
    return out * env


# ---------- 時間軸 ----------
place(crackle(CRACKS[1] - CRACKS[0], 18, seed=1), CRACKS[0], 0.35, -0.2)       # 斷拍：石頭慢慢龜裂
for k, t in enumerate(CRACKS[1:]):
    place(crackle(0.25, 90, seed=10 + k), t, 0.55, 0.2 - 0.4 * k)               # 預備拍：裂痕擴大
place(rubble(1.6, 90, 3), SHATTER, 0.9, 0.0)                                     # 爆發：整片碎裂崩落
place(crackle(0.12, 400, 2000, 9000, seed=4), SHATTER, 0.8, 0.0)
place(rise(HANG - LIFT + 0.3), LIFT, 0.55, 0.0)                                  # 巨石抬起
place(thud(150, 55, 1.2, 0.35), SLAM, 1.0, -0.15)                                # 互換落下：厚重撞擊
place(crackle(0.2, 300, seed=5), SLAM, 0.6, 0.1)
place(rubble(1.0, 40, 6), SLAM + 0.02, 0.6, 0.0)
place(rubble(1.1, 70, 7), WALL_FALL + 0.3, 0.7, 0.0)                            # 牆崩落
place(thud(120, 60, 0.5, 0.12), STAMP, 0.65, 0.3)                                # 印章落下
place(crackle(0.4, 160, seed=8), END_CRACK, 0.6, 0.25)                           # 最後裂開

# 輕微殘響
ir_n = int(1.2 * SR)
ir = lp(rng.standard_normal(ir_n), 5000) * np.exp(-np.arange(ir_n) / SR / 0.3)
ir /= np.sqrt(np.sum(ir ** 2))
mix = np.stack([L + 0.18 * signal.fftconvolve(L, ir)[:N], R + 0.18 * signal.fftconvolve(R, np.roll(ir, 211))[:N]])
mix = signal.sosfilt(signal.butter(2, 40, 'highpass', fs=SR, output='sos'), mix)
mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))

out = sys.argv[1] if len(sys.argv) > 1 else 'sfx.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype('<i2').tobytes())
print('wrote', out, f'{DUR} 秒，峰值 −1 dBFS')
