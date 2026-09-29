/*
 * 家庭責任流 — 共用繪圖引擎（紙與墨版）
 * 畫面只由「時間 t」與「場景狀態」決定：同一個 t 永遠畫出同一格，
 * 因此影片可以逐格輸出，互動版也能用同一套畫面。
 * 設計座標固定為 1080×1920（9:16）。
 *
 * 視覺語言：有纖維的紙＋墨黑主色＋朱紅（責任）＋群青（緩衝，最後才出現）。
 * 不用發光，改用網點、斜線、印章與套色來做層次。
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920;

  const COL = {
    paper: '#ECE8DF',
    ink: '#1D1F25',
    inkSoft: '#55565C',
    mute: '#7B766C',
    rule: 'rgba(29,31,37,0.28)',
    verm: '#D8432A',     // 朱紅：家庭責任、中斷
    blue: '#2C4C9E',     // 群青：緩衝
    savings: '#1D1F25'
  };

  const SANS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';
  const SERIF = '"Noto Serif TC","Songti TC","PMingLiU",serif';

  // ---------- 數學工具 ----------
  function hash(n, seed) {
    let x = Math.imul(n | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeBack = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));

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
  function mix(h1, h2, k) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const c = (s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, k));
    return `rgb(${c(16)},${c(8)},${c(0)})`;
  }

  // ---------- 版面 ----------
  const L = {
    MAIN: { x: 360, y: 580 },
    PART: { x: 760, y: 580 },
    HUB: { x: 540, y: 800, s: 112 },
    TANK: { x: 142, top: 720, w: 92, h: 190 },
    BUCKET: { xs: [260, 540, 820], top: 1010, w: 190, h: 220 },
    HEAD: { x: 110, y: 300 },
    INFO: { y: 1390 }
  };

  function P(ax, ay, c1x, c1y, c2x, c2y, bx, by) {
    return { a: { x: ax, y: ay }, c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, b: { x: bx, y: by } };
  }
  const PATHS = {
    main: P(360, 580, 360, 700, 470, 750, 540, 800),
    part: P(760, 580, 760, 700, 610, 750, 540, 800),
    tank: P(188, 815, 300, 815, 420, 800, 540, 800),
    out: L.BUCKET.xs.map((bx) => P(540, 800, 540, 910, bx, 910, bx, 1060))
  };

  function bez(p, u) {
    const v = 1 - u;
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    return { x: a * p.a.x + b * p.c1.x + c * p.c2.x + d * p.b.x, y: a * p.a.y + b * p.c1.y + c * p.c2.y + d * p.b.y };
  }
  function bezTan(p, u) {
    const v = 1 - u;
    const x = 3 * v * v * (p.c1.x - p.a.x) + 6 * v * u * (p.c2.x - p.c1.x) + 3 * u * u * (p.b.x - p.c2.x);
    const y = 3 * v * v * (p.c1.y - p.a.y) + 6 * v * u * (p.c2.y - p.c1.y) + 3 * u * u * (p.b.y - p.c2.y);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  // ---------- 紙張與顆粒（只算一次） ----------
  let paperCv = null, grainCvs = null;
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function buildPaper() {
    const cv = makeCanvas(W, H), c = cv.getContext('2d'), r = rng(20260929);
    c.fillStyle = COL.paper; c.fillRect(0, 0, W, H);
    // 紙面不均勻的明暗
    for (let i = 0; i < 30; i++) {
      const x = r() * W, y = r() * H, rad = 180 + r() * 520, dark = r() < 0.55;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, dark ? 'rgba(120,105,80,0.035)' : 'rgba(255,255,250,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 纖維
    c.lineCap = 'round';
    for (let i = 0; i < 3200; i++) {
      const x = r() * W, y = r() * H, len = 6 + r() * 30, ang = r() * Math.PI * 2, bend = (r() - 0.5) * 10;
      c.strokeStyle = r() < 0.7 ? `rgba(95,82,60,${0.04 + r() * 0.09})` : `rgba(255,255,255,${0.12 + r() * 0.2})`;
      c.lineWidth = 0.5 + r() * 1.1;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(ang) * len / 2 - Math.sin(ang) * bend, y + Math.sin(ang) * len / 2 + Math.cos(ang) * bend, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      c.stroke();
    }
    // 雜點
    for (let i = 0; i < 700; i++) {
      c.fillStyle = `rgba(60,50,40,${0.08 + r() * 0.2})`;
      c.beginPath(); c.arc(r() * W, r() * H, 0.4 + r() * 1.3, 0, Math.PI * 2); c.fill();
    }
    // 細微的像素雜訊
    const img = c.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    // 四周略暗，像紙被光照
    const v = c.createRadialGradient(W / 2, H * 0.45, W * 0.35, W / 2, H * 0.5, H * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(70,55,35,0.10)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    return cv;
  }
  function buildGrain(seed) {
    const cv = makeCanvas(W / 2, H / 2), c = cv.getContext('2d'), r = rng(seed);
    const img = c.createImageData(W / 2, H / 2), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const dark = r() < 0.5;
      const v = dark ? 20 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = r() * (dark ? 26 : 20);
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  function background(ctx) {
    if (!paperCv) paperCv = buildPaper();
    ctx.drawImage(paperCv, 0, 0);
  }
  // 最後一層：顆粒一秒跳 12 次，像定格印刷
  function finish(ctx, t) {
    if (!grainCvs) grainCvs = [buildGrain(1), buildGrain(2), buildGrain(3)];
    const g = grainCvs[Math.floor(t * 12) % 3];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(g, 0, 0, W, H);
    ctx.restore();
  }

  // ---------- 繪圖元件 ----------
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
   * 粒子流：每顆墨點由編號 k 決定出生時間、速度與偏移。
   * 位置 = 路徑(進度)，沒有累積狀態，任何時間點都能重算。
   * o.dens(ts) 是粒子出生當下的密度 0..1，已出發的粒子不會憑空消失。
   */
  function stream(ctx, p, t, o) {
    const iv = 1 / o.rate;
    const maxTravel = o.travel * 1.2;
    const k0 = Math.floor((t - maxTravel) / iv) - 1;
    const k1 = Math.floor(t / iv);
    const seed = o.seed || 1;
    ctx.save();
    const baseA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = o.color;
    for (let k = k0; k <= k1; k++) {
      const ts = k * iv + hash(k, seed) * iv * 0.8;
      const tr = o.travel * (0.85 + 0.35 * hash(k, seed + 3));
      const age = t - ts;
      if (age < 0 || age > tr) continue;
      if (hash(k, seed + 7) >= o.dens(ts)) continue;
      const u = age / tr;
      const pt = bez(p, u), tn = bezTan(p, u);
      const off = (hash(k, seed + 11) - 0.5) * (o.spread || 24) * Math.sin(Math.PI * u);
      const x = pt.x - tn.y * off, y = pt.y + tn.x * off;
      const a = Math.min(1, u * 8, (1 - u) * 8) * (o.alpha == null ? 1 : o.alpha);
      const r = (o.size || 4.4) * (0.55 + 0.8 * hash(k, seed + 13));
      ctx.globalAlpha = baseA * a * (0.75 + 0.25 * hash(k, seed + 17));
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.5, r, Math.atan2(tn.y, tn.x), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 線被劃斷時噴出的墨點
  function spray(ctx, x, y, t0, t, color, n, seed) {
    const age = t - t0;
    if (age < 0 || age > 1.3) return;
    ctx.save();
    const baseA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const ang = hash(i, seed) * Math.PI * 2;
      const sp = 140 + hash(i, seed + 1) * 520;
      const d = sp * (1 - Math.exp(-age * 3.2)) / 3.2 * 3.2;
      const px = x + Math.cos(ang) * d * 0.9, py = y + Math.sin(ang) * d * 0.9 + 120 * age * age;
      const r = 2 + hash(i, seed + 2) * 5;
      ctx.globalAlpha = baseA * clamp(1 - age / 1.3) * 0.9;
      ctx.beginPath(); ctx.arc(px, py, r * (1 - age * 0.4), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 朱紅斜線：像用筆把線劃掉（p 0..1）
  function slash(ctx, x, y, p, color) {
    if (p <= 0) return;
    ctx.save();
    ctx.strokeStyle = color || COL.verm;
    ctx.lineCap = 'round';
    const L1 = 60;
    for (let s = 0; s < 2; s++) {
      const q = clamp(p * 2 - s * 0.6);
      if (q <= 0) continue;
      const ox = s * 22 - 11;
      ctx.lineWidth = 11 - s * 3;
      ctx.beginPath();
      ctx.moveTo(x + ox - L1 * 0.5, y + L1 * 0.62);
      ctx.lineTo(x + ox - L1 * 0.5 + L1 * q, y + L1 * 0.62 - L1 * 1.24 * q);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 節點：mode = 'solid' | 'cut' | 'hollow' */
  function node(ctx, x, y, r, o) {
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    const col = o.color || COL.ink;
    if (o.mode === 'cut') {
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = COL.inkSoft;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r + 12 + (o.pulse || 0) * 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = COL.paper;
      ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    if (o.ring) {
      ctx.globalAlpha *= (1 - o.ring);
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r + 14 + o.ring * 70, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // 「家」的朱紅印章，邊緣有磨損
  function stamp(ctx, x, y, s, ch, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.rotate(-0.06);
    const cv = stampCv(s, ch);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(cv, -s / 2 - 6, -s / 2 - 6);
    ctx.restore();
  }
  const stampCache = {};
  function stampCv(s, ch) {
    const key = s + ch;
    if (stampCache[key]) return stampCache[key];
    const cv = makeCanvas(s + 12, s + 12), c = cv.getContext('2d'), r = rng(77);
    c.translate(6, 6);
    c.fillStyle = COL.verm;
    c.beginPath();
    if (c.roundRect) c.roundRect(0, 0, s, s, 14); else c.rect(0, 0, s, s);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.font = `900 ${Math.round(s * 0.62)}px ${SERIF}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#000';
    c.fillText(ch, s / 2, s / 2 + s * 0.04);
    // 磨損：隨機咬掉一些點
    for (let i = 0; i < 90; i++) {
      c.globalAlpha = 0.2 + r() * 0.5;
      c.beginPath(); c.arc(r() * s, r() * s, 0.5 + r() * 1.6, 0, Math.PI * 2); c.fill();
    }
    for (let i = 0; i < 40; i++) {
      const edge = r() * 4 | 0, p = r() * s;
      const ex = edge === 0 ? p : edge === 1 ? s : edge === 2 ? p : 0;
      const ey = edge === 0 ? 0 : edge === 1 ? p : edge === 2 ? s : p;
      c.globalAlpha = 0.6 + r() * 0.4;
      c.beginPath(); c.arc(ex, ey, 1 + r() * 3.5, 0, Math.PI * 2); c.fill();
    }
    stampCache[key] = cv;
    return cv;
  }

  function bucketShape(ctx, x, top, w, h) {
    const l = x - w / 2, r = x + w / 2, b = top + h, rad = 26;
    ctx.beginPath();
    ctx.moveTo(l, top);
    ctx.lineTo(l, b - rad);
    ctx.quadraticCurveTo(l, b, l + rad, b);
    ctx.lineTo(r - rad, b);
    ctx.quadraticCurveTo(r, b, r, b - rad);
    ctx.lineTo(r, top);
  }

  // 水桶：網點液體＋墨線外框；pressure 時外框轉朱紅並出現斜線陰影
  function bucket(ctx, i, t, o) {
    const B = L.BUCKET, x = B.xs[i], top = B.top, w = B.w, h = B.h;
    const pr = clamp(o.glow || 0);
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;

    // 壓力陰影：朱紅斜線，偏移像套色
    if (pr > 0.01) {
      ctx.save();
      bucketShape(ctx, x + 12, top + 12, w, h); ctx.closePath(); ctx.clip();
      ctx.strokeStyle = rgba(COL.verm, 0.55 * pr);
      ctx.lineWidth = 2.2;
      for (let k = -h; k < w + h; k += 11) {
        ctx.beginPath(); ctx.moveTo(x - w / 2 + 12 + k, top + 12); ctx.lineTo(x - w / 2 + 12 + k - h, top + 12 + h); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    bucketShape(ctx, x, top, w, h); ctx.closePath(); ctx.clip();
    ctx.fillStyle = COL.paper;
    ctx.fillRect(x - w / 2, top, w, h);
    const level = clamp(o.level);
    const sy = top + h * (1 - level);
    const amp = 4 + 4 * pr;
    const surf = (xx) => sy + Math.sin(xx * 0.045 + t * 2.4 + i * 1.7) * amp + Math.sin(xx * 0.09 - t * 3.1) * amp * 0.4;
    // 網點：越深越大
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = COL.verm;
    const step = 10;
    for (let yy = top + 4; yy < top + h; yy += step) {
      const row = Math.round((yy - top) / step);
      for (let xx = -w / 2 + 5 + (row % 2) * step / 2; xx < w / 2; xx += step) {
        const s = surf(xx);
        if (yy < s + 3) continue;
        const depth = clamp((yy - s) / (h * 0.8));
        ctx.beginPath(); ctx.arc(x + xx, yy, 1.8 + 3.4 * depth, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 液面
    ctx.strokeStyle = COL.verm; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let xx = -w / 2; xx <= w / 2; xx += 5) {
      const yy = surf(xx);
      if (xx === -w / 2) ctx.moveTo(x + xx, yy); else ctx.lineTo(x + xx, yy);
    }
    ctx.stroke();
    ctx.restore();

    // 刻度：像量杯
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2;
    for (let k = 1; k <= 4; k++) {
      const yy = top + (h * k) / 5;
      ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x - w / 2 + (k % 2 ? 14 : 24), yy); ctx.stroke();
    }
    bucketShape(ctx, x, top, w, h);
    ctx.lineWidth = 4 + 2.5 * pr;
    ctx.strokeStyle = mix(COL.ink, COL.verm, pr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();

    text(ctx, o.label, x, top + h + 50, { size: 38, weight: 800, color: COL.ink, align: 'center' });
    if (o.amount) text(ctx, o.amount, x, top + h + 92, { size: 28, weight: 500, color: COL.mute, align: 'center' });
    ctx.restore();
  }

  // 存款：木刻般的斜線
  function tank(ctx, t, o) {
    const T = L.TANK, x = T.x, top = T.top, w = T.w, h = T.h;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    const shape = () => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, h, 14); else ctx.rect(x - w / 2, top, w, h); };
    ctx.save();
    shape(); ctx.clip();
    const level = clamp(o.level);
    const sy = top + h * (1 - level) + Math.sin(t * 2) * 1.5;
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2.6;
    for (let k = -h; k < w + h; k += 9) {
      ctx.beginPath(); ctx.moveTo(x - w / 2 + k, sy); ctx.lineTo(x - w / 2 + k - (top + h - sy), top + h); ctx.stroke();
    }
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(x - w / 2, sy); ctx.lineTo(x + w / 2, sy); ctx.stroke();
    ctx.restore();
    shape();
    ctx.lineWidth = 4;
    ctx.strokeStyle = o.low ? COL.verm : COL.ink;
    ctx.stroke();
    text(ctx, o.label || '存款', x, top - 24, { size: 34, weight: 800, color: COL.ink, align: 'center' });
    if (o.sub) text(ctx, o.sub, x, top + h + 44, { size: 28, weight: 600, color: o.low ? COL.verm : COL.mute, align: 'center' });
    ctx.restore();
  }

  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = o.color || COL.ink;
    ctx.font = `${o.weight || 500} ${o.size || 32}px ${o.serif ? SERIF : SANS}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.ls != null && 'letterSpacing' in ctx) ctx.letterSpacing = o.ls + 'px';
    const lines = String(s).split('\n');
    const lh = (o.size || 32) * (o.lh || 1.28);
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
    ctx.restore();
  }
  function measure(ctx, s, o) {
    ctx.save();
    ctx.font = `${o.weight || 500} ${o.size || 32}px ${o.serif ? SERIF : SANS}`;
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }

  // 選項頁籤：墨線方框，選中時整塊填墨
  function pill(ctx, x, y, w, h, label, active, alpha, idx) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fillStyle = rgba(COL.ink, active);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COL.ink;
    ctx.stroke();
    const c = active > 0.5 ? COL.paper : COL.ink;
    if (idx != null) text(ctx, String(idx), x + 22, y + h / 2 + 2, { size: 22, weight: 700, color: active > 0.5 ? COL.verm : COL.mute, baseline: 'middle' });
    text(ctx, label, x + w / 2 + 10, y + h / 2 + 2, { size: 32, weight: 800, align: 'center', baseline: 'middle', color: c });
    ctx.restore();
  }

  function tap(ctx, x, y, p) {
    if (p <= 0 || p >= 1) return;
    ctx.save();
    const press = p < 0.35 ? p / 0.35 : 1;
    ctx.globalAlpha = p < 0.8 ? 1 : (1 - p) / 0.2;
    ctx.fillStyle = rgba(COL.verm, 0.9);
    ctx.beginPath(); ctx.arc(x, y, 22 - 7 * press, 0, Math.PI * 2); ctx.fill();
    if (p > 0.3) {
      const q = (p - 0.3) / 0.7;
      ctx.strokeStyle = rgba(COL.verm, 0.8 * (1 - q));
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 22 + q * 64, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // 版頭：像雜誌的欄頭
  function furniture(ctx, left, right, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    text(ctx, left, 110, 196, { size: 24, weight: 700, color: COL.ink, ls: 3 });
    text(ctx, right, 970, 196, { size: 24, weight: 600, color: COL.inkSoft, align: 'right', ls: 1 });
    ctx.fillStyle = COL.ink;
    ctx.fillRect(110, 214, 860, 3);
    ctx.fillRect(110, 221, 860, 1);
    ctx.restore();
  }

  /*
   * 整個家庭網絡。S 是場景狀態：
   *  S.main  {mode:'on'|'cut'|'buffer', label, sub, subColor, alpha, dy, slash, ring, labelAlpha}
   *  S.part  {sub, subColor, pulse}
   *  S.tank  {level, sub, low}
   *  S.buckets [{level, glow(=壓力), label, amount, alpha}] ×3
   *  S.dens  {main, part, tank, out} → fn(ts) 0..1
   */
  function network(ctx, S, t) {
    ctx.save();
    ctx.globalAlpha *= S.alpha == null ? 1 : S.alpha;
    const m = S.main;
    const mainCol = m.mode === 'buffer' ? COL.blue : COL.ink;

    pipe(ctx, PATHS.main, m.mode === 'cut' ? COL.inkSoft : mainCol, m.mode === 'cut' ? 0.45 : 0.5, 2, m.mode === 'cut' ? [4, 10] : null);
    pipe(ctx, PATHS.part, COL.ink, 0.5, 2);
    pipe(ctx, PATHS.tank, COL.ink, 0.35, 2, [4, 10]);
    PATHS.out.forEach((p) => pipe(ctx, p, COL.verm, 0.45, 2));

    stream(ctx, PATHS.main, t, { rate: 30, travel: 1.0, dens: S.dens.main, color: mainCol, seed: 11 });
    stream(ctx, PATHS.part, t, { rate: 30, travel: 1.0, dens: S.dens.part, color: COL.ink, seed: 23 });
    stream(ctx, PATHS.tank, t, { rate: 26, travel: 0.9, dens: S.dens.tank, color: COL.ink, seed: 37, spread: 16, size: 3.6 });
    PATHS.out.forEach((p, i) => stream(ctx, p, t, { rate: 20, travel: 0.9, dens: S.dens.out, color: COL.verm, seed: 51 + i * 13, spread: 18 }));

    tank(ctx, t, S.tank);
    S.buckets.forEach((b, i) => bucket(ctx, i, t, b));

    const my = L.MAIN.y + (m.dy || 0);
    node(ctx, L.MAIN.x, my, 30, { mode: m.mode === 'cut' ? 'cut' : 'solid', color: mainCol, alpha: m.alpha, ring: m.ring });
    if (m.slash) slash(ctx, L.MAIN.x, my, m.slash);
    const la = m.labelAlpha == null ? (m.alpha == null ? 1 : m.alpha) : m.labelAlpha;
    text(ctx, m.label, L.MAIN.x - 66, my - 6, { size: 36, weight: 800, color: COL.ink, align: 'right', alpha: la });
    text(ctx, m.sub, L.MAIN.x - 66, my + 36, { size: 28, weight: 600, color: m.subColor || COL.mute, align: 'right', alpha: la });

    const pt = S.part;
    node(ctx, L.PART.x, L.PART.y, 30, { mode: 'solid', color: COL.ink, pulse: pt.pulse || 0 });
    text(ctx, pt.label || '另一半', L.PART.x + 66, L.PART.y - 6, { size: 36, weight: 800, color: COL.ink });
    text(ctx, pt.sub, L.PART.x + 66, L.PART.y + 36, { size: 28, weight: 600, color: pt.subColor || COL.mute });

    stamp(ctx, L.HUB.x, L.HUB.y, L.HUB.s, '家');
    ctx.restore();
  }

  // 下方數字列：左右兩欄 + 一句說明
  function info(ctx, I, alpha) {
    if (!I || alpha <= 0) return;
    const y = L.INFO.y;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = COL.ink;
    ctx.fillRect(110, y - 54, 860, 2);
    const col = (c, x) => {
      if (!c) return;
      text(ctx, c[0], x, y, { size: 26, weight: 700, color: COL.inkSoft, ls: 2 });
      text(ctx, c[1], x, y + 82, { size: 76, weight: 900, color: c[2] || COL.ink, serif: true });
    };
    col(I.l, 110);
    col(I.r, 560);
    if (I.cap) text(ctx, I.cap, 110, y + 142, { size: 30, weight: 600, color: I.capColor || COL.ink, alpha: I.capAlpha == null ? 1 : I.capAlpha });
    ctx.restore();
  }

  global.FF = {
    W, H, COL, SANS, SERIF, FONT: SANS, L, PATHS,
    hash, clamp, lerp, ease, easeOut, easeBack, seg, keys, rgba, mix, bez,
    background, finish, pipe, stream, spray, slash, node, stamp, bucket, tank, text, measure, pill, tap, furniture, network, info
  };
})(typeof window !== 'undefined' ? window : globalThis);
