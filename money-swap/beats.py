"""
拍點地圖：從歌曲抓出影片範圍內每一拍的精確時間與強度，輸出 beats.json。
時間都換算成「影片時間」（歌曲秒數 − START）。

用法：python3 beats.py 歌曲.mp3
"""
import json
import subprocess
import sys

import imageio_ffmpeg
import numpy as np
from scipy import signal

START, END = 21.0, 52.2          # 使用的歌曲片段
DROP = 25.02                      # 爆發點（歌曲時間，分析得出）
BPM = 123.65
SR = 22050
ENV_RATE = 120                    # 重低音包絡取樣率（每秒幾點），給震動用

src = sys.argv[1]
raw = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', src, '-ac', '1', '-ar', str(SR),
                      '-f', 's16le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype='<i2').astype(float) / 32768
hop = 64
fr = SR / hop


def band(lo, hi):
    sos = signal.butter(4, [lo, hi] if lo else hi, 'bandpass' if lo else 'lowpass', fs=SR, output='sos')
    y = signal.sosfilt(sos, x)
    return np.sqrt(np.convolve(y ** 2, np.ones(hop * 2) / (hop * 2), 'same'))[::hop]


low = band(0, 110)
high = band(2500, 9000)
ons_low = np.maximum(np.diff(np.log(low + 1e-6), prepend=0), 0)
ons_high = np.maximum(np.diff(np.log(high + 1e-6), prepend=0), 0)

period = 60 / BPM
# 從爆發點往前、往後排出拍格
k0 = int(np.floor((START - DROP) / period)) - 1
k1 = int(np.ceil((END - DROP) / period)) + 1
beats = []
for k in range(k0, k1 + 1):
    t = DROP + k * period
    if t < START - 0.05 or t > END + 0.05:
        continue
    # 在 ±45ms 內找低頻起音最強的位置來微調
    i0, i1 = int((t - 0.045) * fr), int((t + 0.045) * fr)
    seg = ons_low[i0:i1] * low[i0:i1]
    tt = (i0 + int(np.argmax(seg))) / fr if seg.max() > 0 else t
    li = int(tt * fr)
    strength = float(low[li:li + int(0.08 * fr)].max())
    hi = float(ons_high[li - 3:li + 4].max())
    beats.append({'k': k, 't': tt, 'grid': t, 'low': strength, 'high': hi})

lows = np.array([b['low'] for b in beats])
ref = np.percentile(lows, 90)
highs = np.array([b['high'] for b in beats])
href = np.percentile(highs, 90)
out_beats = []
for b in beats:
    bar = b['k'] // 4          # 爆發點＝第 0 小節第 0 拍
    out_beats.append({
        't': round(b['t'] - START, 4),
        'bar': int(bar),
        'beat': int(b['k'] % 4),
        'strength': round(float(min(1.0, b['low'] / ref)), 3),
        'accent': round(float(min(1.5, b['high'] / href)), 3),
    })

# 重低音連續包絡（影片時間），0..1
n = int((END - START) * ENV_RATE)
ts = START + np.arange(n) / ENV_RATE
env = np.interp(ts, np.arange(len(low)) / fr, low)
env = np.clip(env / np.percentile(env, 95), 0, 1.2)

data = {
    'song_start': START,
    'song_end': END,
    'duration': round(END - START, 3),
    'bpm': BPM,
    'beat_period': round(period, 5),
    'drop': round(DROP - START, 4),
    'env_rate': ENV_RATE,
    'bass_env': [round(float(v), 3) for v in env],
    'beats': out_beats,
}
json.dump(data, open('beats.json', 'w'), ensure_ascii=False)
with open('beats.js', 'w') as f:   # 給 video.html 直接載入（file:// 不能 fetch）
    f.write('window.BEATS = ' + json.dumps(data, ensure_ascii=False) + ';\n')

print(f'拍數 {len(out_beats)}，爆發點（影片時間）{DROP - START:.3f} 秒')
for b in out_beats:
    mark = '█' * int(b['strength'] * 10)
    acc = ' *' if b['accent'] > 0.9 else ''
    print(f"{b['t']:6.3f}  小節{b['bar']:3d} 拍{b['beat']}  {mark:<11}{acc}")
