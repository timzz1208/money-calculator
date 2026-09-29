/*
 * 家庭責任流 — 共用繪圖引擎
 * 畫面只由「時間 t」與「場景狀態」決定：同一個 t 永遠畫出同一格，
 * 因此影片可以逐格輸出，互動版也能用同一套畫面。
 * 設計座標固定為 1080×1920（9:16）。
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920;

  const COL = {
    bg: '#0A1122',
    bgHi: '#15244A',
    ink: '#F4EFE6',
    mute: '#8A97B0',
    line: 'rgba(138,151,176,0.22)',
    income: '#F3E3C3',
    savings: '#CDB88F',
    amber: '#F5A742',
    blue: '#5B93FF',
    red: '#F0605D'
  };

  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';

  // ---------- 數學工具 ----------
  function hash(n, seed) {
    let x = Math.imul(n | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));

  // 關鍵影格：[[t, v], ...]，區段之間用 easeInOutCubic 內插
  function keys(t, arr) {
    if (t <= arr[0][0]) return arr[0][1];
    for (let i = 1; i < arr.length; i++) {
      if (t <= arr[i][0]) {
        const [t0, v0] = arr[i - 1], [t1, v1] = arr[i];
        return lerp(v0, v1, ease((t - t0) / (t1 - t0 || 1)));
      }
    }
    return arr[arr.length - 1][1];
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- 版面 ----------
  const L = {
    MAIN: { x: 360, y: 560 },
    PART: { x: 760, y: 560 },
    HUB: { x: 540, y: 790, r: 58 },
    TANK: { x: 142, top: 700, w: 96, h: 200 },
    BUCKET: { xs: [260, 540, 820], top: 1000, w: 190, h: 230 },
    HEAD: { x: 110, y: 290 },
    INFO: { y: 1385 }
  };

  function P(ax, ay, c1x, c1y, c2x, c2y, bx, by) {
    return { a: { x: ax, y: ay }, c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, b: { x: bx, y: by } };
  }
  const PATHS = {
    main: P(360, 560, 360, 690, 470, 740, 540, 790),
    part: P(760, 560, 760, 690, 610, 740, 540, 790),
    tank: P(190, 800, 300, 800, 420, 790, 540, 790),
    out: L.BUCKET.xs.map((bx) => P(540, 790, 540, 910, bx, 900, bx, 1050))
  };

  function bez(p, u) {
    const v = 1 - u;
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    return {
      x: a * p.a.x + b * p.c1.x + c * p.c2.x + d * p.b.x,
      y: a * p.a.y + b * p.c1.y + c * p.c2.y + d * p.b.y
    };
  }
  function bezTan(p, u) {
    const v = 1 - u;
    const x = 3 * v * v * (p.c1.x - p.a.x) + 6 * v * u * (p.c2.x - p.c1.x) + 3 * u * u * (p.b.x - p.c2.x);
    const y = 3 * v * v * (p.c1.y - p.a.y) + 6 * v * u * (p.c2.y - p.c1.y) + 3 * u * u * (p.b.y - p.c2.y);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  // ---------- 繪圖元件 ----------
  function background(ctx, t) {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(540, 760, 60, 540, 760, 1100);
    g.addColorStop(0, rgba(COL.bgHi, 0.9));
    g.addColorStop(1, rgba(COL.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 淡淡的方格點陣：像記帳本的格線
    ctx.fillStyle = 'rgba(138,151,176,0.07)';
    const off = (t * 6) % 48;
    for (let y = -48 + off; y < H; y += 48) {
      for (let x = 12; x < W; x += 48) ctx.fillRect(x, y, 2, 2);
    }
  }

  function pipe(ctx, p, color, alpha, width, dash) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(p.a.x, p.a.y);
    ctx.bezierCurveTo(p.c1.x, p.c1.y, p.c2.x, p.c2.y, p.b.x, p.b.y);
    ctx.stroke();
    ctx.restore();
  }

  /*
   * 粒子流：每顆粒子由編號 k 決定出生時間、速度與偏移，
   * 位置 = 路徑(進度)。沒有累積狀態，所以任何時間點都能重算。
   * o.dens(ts) 回傳粒子「出生當下」的密度 0..1，已出發的粒子不會憑空消失。
   */
  function stream(ctx, p, t, o) {
    const iv = 1 / o.rate;
    const maxTravel = o.travel * 1.2;
    const k0 = Math.floor((t - maxTravel) / iv) - 1;
    const k1 = Math.floor(t / iv);
    const seed = o.seed || 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = k0; k <= k1; k++) {
      const ts = k * iv + hash(k, seed) * iv * 0.8;
      const tr = o.travel * (0.85 + 0.35 * hash(k, seed + 3));
      const age = t - ts;
      if (age < 0 || age > tr) continue;
      if (hash(k, seed + 7) >= o.dens(ts)) continue;
      const u = age / tr;
      const pt = bez(p, u), tn = bezTan(p, u);
      const off = (hash(k, seed + 11) - 0.5) * (o.spread || 26) * Math.sin(Math.PI * u);
      const x = pt.x - tn.y * off, y = pt.y + tn.x * off;
      const a = Math.min(1, u * 7, (1 - u) * 7) * (o.alpha == null ? 1 : o.alpha);
      const r = (o.size || 4.2) * (0.65 + 0.7 * hash(k, seed + 13));
      // 尾巴
      const pu = Math.max(0, u - 0.035), pp = bez(p, pu);
      ctx.strokeStyle = rgba(o.color, a * 0.35);
      ctx.lineWidth = r * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pp.x - tn.y * off, pp.y + tn.x * off);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(o.color, a * 0.18);
      ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(o.color, a);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function glowDisc(ctx, x, y, r, color, a) {
    if (a <= 0.001) return;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, rgba(color, 0.55 * a));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function node(ctx, x, y, r, o) {
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    const baseA = ctx.globalAlpha;
    glowDisc(ctx, x, y, r * 3.2, o.color, o.glow || 0);
    ctx.fillStyle = COL.bg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = o.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    if (o.ring) {
      ctx.globalAlpha = baseA * (1 - o.ring);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r + o.ring * 60, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = baseA;
    }
    if (o.inner) {
      text(ctx, o.inner, x, y + 2, { size: o.innerSize || 30, weight: 800, color: o.color, align: 'center', baseline: 'middle' });
    } else {
      ctx.fillStyle = o.color;
      ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function bucketShape(ctx, x, top, w, h) {
    const l = x - w / 2, r = x + w / 2, b = top + h, rad = 30;
    ctx.beginPath();
    ctx.moveTo(l, top);
    ctx.lineTo(l, b - rad);
    ctx.quadraticCurveTo(l, b, l + rad, b);
    ctx.lineTo(r - rad, b);
    ctx.quadraticCurveTo(r, b, r, b - rad);
    ctx.lineTo(r, top);
  }

  function bucket(ctx, i, t, o) {
    const B = L.BUCKET, x = B.xs[i], top = B.top, w = B.w, h = B.h;
    const glow = o.glow || 0;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    glowDisc(ctx, x, top + h * 0.6, 230, COL.amber, glow * 0.8);
    // 液體
    ctx.save();
    bucketShape(ctx, x, top, w, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(10,17,34,0.85)';
    ctx.fillRect(x - w / 2, top, w, h);
    const level = clamp(o.level);
    const sy = top + h * (1 - level);
    const amp = 5 + 4 * glow;
    const grad = ctx.createLinearGradient(0, sy, 0, top + h);
    grad.addColorStop(0, rgba(COL.amber, 0.92));
    grad.addColorStop(1, rgba(COL.amber, 0.38));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 2, top + h + 2);
    for (let xx = -w / 2 - 2; xx <= w / 2 + 2; xx += 6) {
      const yy = sy + Math.sin(xx * 0.045 + t * 2.4 + i * 1.7) * amp + Math.sin(xx * 0.09 - t * 3.1) * amp * 0.4;
      ctx.lineTo(x + xx, yy);
    }
    ctx.lineTo(x + w / 2 + 2, top + h + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 外框
    bucketShape(ctx, x, top, w, h);
    ctx.lineWidth = 4;
    ctx.strokeStyle = glow > 0.02 ? rgba(COL.amber, 0.45 + 0.55 * glow) : 'rgba(244,239,230,0.55)';
    ctx.lineCap = 'round';
    ctx.stroke();
    // 標籤
    text(ctx, o.label, x, top + h + 44, { size: 38, weight: 800, color: COL.ink, align: 'center' });
    if (o.amount) text(ctx, o.amount, x, top + h + 88, { size: 30, weight: 500, color: COL.mute, align: 'center' });
    ctx.restore();
  }

  function tank(ctx, t, o) {
    const T = L.TANK, x = T.x, top = T.top, w = T.w, h = T.h;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    const rr = 26;
    const shape = () => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, h, rr);
      else ctx.rect(x - w / 2, top, w, h);
    };
    ctx.save();
    shape(); ctx.clip();
    ctx.fillStyle = 'rgba(10,17,34,0.85)';
    ctx.fillRect(x - w / 2, top, w, h);
    const level = clamp(o.level);
    const sy = top + h * (1 - level);
    ctx.fillStyle = rgba(COL.savings, 0.75);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top + h);
    for (let xx = -w / 2; xx <= w / 2; xx += 6) ctx.lineTo(x + xx, sy + Math.sin(xx * 0.08 + t * 2) * 3);
    ctx.lineTo(x + w / 2, top + h);
    ctx.closePath(); ctx.fill();
    // 刻度：一格代表 1/5
    ctx.strokeStyle = 'rgba(10,17,34,0.6)';
    ctx.lineWidth = 2;
    for (let k = 1; k < 5; k++) {
      const yy = top + (h * k) / 5;
      ctx.beginPath(); ctx.moveTo(x + w / 2 - 22, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke();
    }
    ctx.restore();
    shape();
    ctx.lineWidth = 4;
    ctx.strokeStyle = o.low ? rgba(COL.red, 0.9) : 'rgba(244,239,230,0.55)';
    ctx.stroke();
    text(ctx, o.label || '存款', x, top - 26, { size: 34, weight: 800, color: COL.ink, align: 'center' });
    if (o.sub) text(ctx, o.sub, x, top + h + 44, { size: 30, weight: 500, color: COL.mute, align: 'center' });
    ctx.restore();
  }

  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = o.color || COL.ink;
    ctx.font = `${o.weight || 500} ${o.size || 32}px ${FONT}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    const lines = String(s).split('\n');
    const lh = (o.size || 32) * (o.lh || 1.28);
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
    ctx.restore();
  }

  function pill(ctx, x, y, w, h, label, active, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2); else ctx.rect(x, y, w, h);
    ctx.fillStyle = active > 0 ? rgba(COL.amber, 0.18 + 0.72 * active) : 'rgba(21,36,74,0.7)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = active > 0 ? rgba(COL.amber, 0.5 + 0.5 * active) : 'rgba(244,239,230,0.35)';
    ctx.stroke();
    text(ctx, label, x + w / 2, y + h / 2 + 2, {
      size: 32, weight: 800, align: 'center', baseline: 'middle',
      color: active > 0.5 ? COL.bg : COL.ink
    });
    ctx.restore();
  }

  // 模擬手指點擊：p 0..1
  function tap(ctx, x, y, p) {
    if (p <= 0 || p >= 1) return;
    ctx.save();
    const press = p < 0.35 ? p / 0.35 : 1;
    const a = p < 0.8 ? 1 : (1 - p) / 0.2;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(244,239,230,0.85)';
    ctx.beginPath(); ctx.arc(x, y, 26 - 8 * press, 0, Math.PI * 2); ctx.fill();
    if (p > 0.3) {
      const q = (p - 0.3) / 0.7;
      ctx.strokeStyle = `rgba(244,239,230,${0.8 * (1 - q)})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 26 + q * 70, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /*
   * 整個家庭網絡。S 是場景狀態：
   *  S.main  {color, label, sub, subColor, glow, alpha, dy, dash, ring}
   *  S.part  {label, sub, glow}
   *  S.tank  {level, sub, low}
   *  S.buckets [{level, glow, label, amount}] ×3
   *  S.dens  {main, part, tank, out} → fn(ts) 0..1
   *  S.mainStreamColor
   */
  function network(ctx, S, t) {
    ctx.save();
    ctx.globalAlpha = S.alpha == null ? 1 : S.alpha;
    const mainCol = S.main.color;
    pipe(ctx, PATHS.main, S.main.pipeColor || COL.ink, S.main.pipeAlpha == null ? 0.22 : S.main.pipeAlpha, 3, S.main.dash);
    pipe(ctx, PATHS.part, COL.ink, 0.22, 3);
    pipe(ctx, PATHS.tank, COL.ink, 0.16, 3, [6, 10]);
    PATHS.out.forEach((p) => pipe(ctx, p, COL.amber, 0.2, 3));

    stream(ctx, PATHS.main, t, { rate: 30, travel: 1.0, dens: S.dens.main, color: S.mainStreamColor || COL.income, seed: 11 });
    stream(ctx, PATHS.part, t, { rate: 30, travel: 1.0, dens: S.dens.part, color: COL.income, seed: 23 });
    stream(ctx, PATHS.tank, t, { rate: 26, travel: 0.9, dens: S.dens.tank, color: COL.savings, seed: 37, spread: 18 });
    PATHS.out.forEach((p, i) => stream(ctx, p, t, { rate: 20, travel: 0.9, dens: S.dens.out, color: COL.amber, seed: 51 + i * 13, spread: 20 }));

    tank(ctx, t, S.tank);
    S.buckets.forEach((b, i) => bucket(ctx, i, t, b));

    // 主要收入（或保障緩衝）節點
    const m = S.main, my = L.MAIN.y + (m.dy || 0);
    node(ctx, L.MAIN.x, my, 44, { color: mainCol, glow: m.glow, alpha: m.alpha, ring: m.ring });
    text(ctx, m.label, L.MAIN.x - 70, my - 8, { size: 36, weight: 800, color: COL.ink, align: 'right', alpha: m.labelAlpha == null ? m.alpha : m.labelAlpha });
    text(ctx, m.sub, L.MAIN.x - 70, my + 36, { size: 30, weight: 600, color: m.subColor || COL.mute, align: 'right', alpha: m.labelAlpha == null ? m.alpha : m.labelAlpha });

    const pt = S.part;
    node(ctx, L.PART.x, L.PART.y, 44, { color: COL.income, glow: pt.glow || 0, ring: pt.ring });
    text(ctx, pt.label || '另一半', L.PART.x + 70, L.PART.y - 8, { size: 36, weight: 800, color: COL.ink });
    text(ctx, pt.sub, L.PART.x + 70, L.PART.y + 36, { size: 30, weight: 600, color: pt.subColor || COL.mute });

    node(ctx, L.HUB.x, L.HUB.y, L.HUB.r, { color: COL.ink, inner: '家', innerSize: 44, glow: S.hubGlow || 0 });
    ctx.restore();
  }

  // 下方數字列：左右兩欄 + 一句說明
  function info(ctx, I, alpha) {
    if (!I || alpha <= 0) return;
    const y = L.INFO.y;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(244,239,230,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(110, y - 50); ctx.lineTo(970, y - 50); ctx.stroke();
    const col = (c, x) => {
      if (!c) return;
      text(ctx, c[0], x, y, { size: 30, weight: 600, color: COL.mute });
      text(ctx, c[1], x, y + 76, { size: 66, weight: 900, color: c[2] || COL.ink });
    };
    col(I.l, 110);
    col(I.r, 560);
    if (I.cap) text(ctx, I.cap, 110, y + 142, { size: 32, weight: 600, color: I.capColor || COL.income, alpha: I.capAlpha == null ? 1 : I.capAlpha });
    ctx.restore();
  }

  global.FF = {
    W, H, COL, FONT, L, PATHS,
    hash, clamp, lerp, ease, seg, keys, rgba,
    background, pipe, stream, node, bucket, tank, text, pill, tap, network, info, glowDisc
  };
})(typeof window !== 'undefined' ? window : globalThis);
