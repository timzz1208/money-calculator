/*
 * 錢在工作 — 時間軸（影片時間，秒）
 * 所有時間點都取自 beats.json 的實際拍點；改劇情只要改這個檔案。
 */
(function (g) {
  'use strict';

  // 版面（設計座標 1080×1920）
  const S = 224, GAP = 14;
  const COLS = [183, 421, 659, 897];
  const ROW1 = 800, ROW2 = 1038;
  const FLOOR_Y = ROW2 + S / 2 + 6;

  // 鉤子：你以為你／在賺錢？（三記重擊分三組砸出，爆發點碎裂）
  const HOOK = [
    { ch: '你', x: COLS[0], y: ROW1, t: 0.130 },
    { ch: '以', x: COLS[1], y: ROW1, t: 0.130 },
    { ch: '為', x: COLS[2], y: ROW1, t: 0.130 },
    { ch: '你', x: COLS[3], y: ROW1, t: 0.655 },
    { ch: '在', x: COLS[0], y: ROW2, t: 0.655 },
    { ch: '賺', x: COLS[1], y: ROW2, t: 1.134 },
    { ch: '錢', x: COLS[2], y: ROW2, t: 1.134, verm: true },
    { ch: '？', x: COLS[3], y: ROW2, t: 1.134 },
  ];
  const HOOK_SHATTER = 4.017;          // 爆發點
  const HOOK_CRACK = [1.552, 3.050, 3.535];   // 斷拍中裂痕擴大的時間

  // 石牆：你在工作／錢在睡覺（每小節第 1、3 拍一塊）
  const WALL = [
    { id: 'you', ch: '你', x: COLS[0], y: ROW1, t: 4.998 },
    { ch: '在', x: COLS[1], y: ROW1, t: 5.923 },
    { ch: '工', x: COLS[2], y: ROW1, t: 6.884 },
    { ch: '作', x: COLS[3], y: ROW1, t: 7.883 },
    { id: 'money', ch: '錢', x: COLS[0], y: ROW2, t: 8.896, verm: true },
    { ch: '在', x: COLS[1], y: ROW2, t: 9.868 },
    { ch: '睡', x: COLS[2], y: ROW2, t: 10.820 },
    { ch: '覺', x: COLS[3], y: ROW2, t: 11.807 },
  ];

  // 牆前的數字
  const NUMBERS = [
    { text: '月薪 45,000', x: 540, y: 540, t: 12.742, until: 19.4, size: 92 },
    { text: '月底剩 3,200', x: 540, y: 1330, t: 15.676, until: 19.4, size: 92, verm: true },
  ];

  // 互換：第 8 小節抬起，懸空，第 9 小節第 1 拍重重落下
  const SWAP = { lift: 19.568, hang: 20.964, slam: 21.446 };

  // 牆崩落、最後一句
  const WALL_FALL = 25.335;
  const FINAL = [
    { ch: '讓', x: 408, y: 790, t: 25.814, size: 250 },
    { ch: '錢', x: 672, y: 790, t: 26.366, size: 250, verm: true },
    { ch: '去', x: 272, y: 1054, t: 26.848, size: 250 },
    { ch: '上', x: 540, y: 1054, t: 27.321, size: 250 },
    { ch: '班', x: 808, y: 1054, t: 27.782, size: 250 },
  ];
  const STAMP = 28.752;                // 朱紅印章＋帳號
  const END_CRACK = 30.728;            // 最後一擊，「班」裂開
  const DURATION = 31.2;

  // 分鏡：每一記重擊換一個構圖
  // type：cut 硬切／whip 甩鏡（在 t 前 dur 秒內完成）／crash 猛推猛拉（t 前 dur 秒）／smooth 緩動（從 t 開始 dur 秒）
  // z 放大倍率、r 傾斜角度（度）、drift 每秒自動推近比例
  const c = (i) => COLS[i];
  const MID = (ROW1 + ROW2) / 2;
  const SHOTS = [
    // 鉤子：特寫第一組 → 甩到第二組 → 甩到第三組 → 拉回全景
    { t: 0, type: 'cut', cx: c(1), cy: ROW1, z: 1.55, r: -2, drift: 0.05 },
    { t: 0.655, type: 'whip', dur: 0.1, cx: 540, cy: MID, z: 1.25, r: 2 },
    { t: 1.134, type: 'whip', dur: 0.1, cx: c(2), cy: ROW2, z: 1.45, r: -1.5 },
    { t: 1.36, type: 'smooth', dur: 0.2, cx: 540, cy: MID, z: 1.0, r: 0 },
    // 斷拍：緩慢逼近＋傾斜；預備拍各猛推一步
    { t: 1.56, type: 'smooth', dur: 1.45, cx: 540, cy: MID, z: 1.18, r: -2 },
    { t: 3.050, type: 'crash', dur: 0.06, cx: 540, cy: MID, z: 1.28, r: 1 },
    { t: 3.535, type: 'crash', dur: 0.06, cx: 540, cy: MID, z: 1.4, r: -1.5 },
    // 爆發：猛然拉遠加旋轉，再回穩
    { t: 4.017, type: 'cut', cx: 540, cy: MID, z: 0.9, r: 6 },
    { t: 4.05, type: 'smooth', dur: 0.8, cx: 540, cy: MID, z: 1.0, r: 0 },
    // 疊第一排：每塊一個特寫
    { t: 4.838, type: 'cut', cx: c(0) + 40, cy: ROW1 + 30, z: 1.9, r: -3, drift: 0.04 },
    { t: 5.763, type: 'cut', cx: c(1), cy: ROW1 + 20, z: 1.75, r: 2.5, drift: 0.04 },
    { t: 6.884, type: 'whip', dur: 0.12, cx: c(2) - 40, cy: ROW1, z: 1.45, r: -1 },
    { t: 7.723, type: 'cut', cx: c(3), cy: ROW1 + 10, z: 1.9, r: 2 },
    { t: 8.0, type: 'smooth', dur: 0.6, cx: 540, cy: MID, z: 1.02, r: 0 },
    // 疊第二排：「錢」用最大特寫
    { t: 8.736, type: 'cut', cx: c(0), cy: ROW2, z: 2.2, r: 4, drift: 0.05 },
    { t: 9.868, type: 'whip', dur: 0.12, cx: c(1), cy: ROW2, z: 1.6, r: -2 },
    { t: 10.820, type: 'whip', dur: 0.12, cx: c(2), cy: ROW2 + 20, z: 1.6, r: 2 },
    { t: 11.647, type: 'cut', cx: c(3), cy: ROW2, z: 1.9, r: -2 },
    { t: 12.0, type: 'smooth', dur: 0.55, cx: 540, cy: MID, z: 0.98, r: 0 },
    // 數字牌：往上看月薪、往下甩到月底剩，再慢慢拉遠
    { t: 12.742, type: 'whip', dur: 0.2, cx: 540, cy: 760, z: 1.08, r: -1 },
    { t: 13.2, type: 'smooth', dur: 2.3, cx: 600, cy: 780, z: 1.14, r: 1.2 },
    { t: 15.676, type: 'whip', dur: 0.14, cx: 540, cy: 1090, z: 1.1, r: 0 },
    { t: 16.0, type: 'smooth', dur: 3.4, cx: 520, cy: MID, z: 0.96, r: -1 },
    // 互換：推向兩塊巨石，懸空時猛推到極近，落下時猛然拉遠
    { t: 19.568, type: 'smooth', dur: 1.35, cx: 330, cy: MID, z: 1.32, r: 3 },
    { t: 20.964, type: 'crash', dur: 0.06, cx: 330, cy: MID - 20, z: 1.8, r: -2 },
    { t: 21.446, type: 'cut', cx: 460, cy: MID, z: 0.9, r: -5 },
    { t: 21.5, type: 'smooth', dur: 0.8, cx: 470, cy: MID, z: 1.02, r: 0 },
    { t: 22.3, type: 'smooth', dur: 1.1, cx: 540, cy: ROW1 + 20, z: 1.25, r: 0.8 },
    { t: 23.440, type: 'whip', dur: 0.12, cx: 540, cy: ROW2, z: 1.25, r: 2 },
    { t: 24.401, type: 'whip', dur: 0.15, cx: 540, cy: MID, z: 1.0, r: 0 },
    // 牆崩落：鏡頭跟著往下
    { t: 25.34, type: 'smooth', dur: 0.35, cx: 540, cy: 1120, z: 1.08, r: -1 },
    // 最後一句：每字一個構圖
    { t: 25.654, type: 'cut', cx: 408, cy: 790, z: 1.8, r: -3, drift: 0.05 },
    { t: 26.206, type: 'cut', cx: 672, cy: 790, z: 1.9, r: 3, drift: 0.05 },
    { t: 26.848, type: 'whip', dur: 0.12, cx: 272, cy: 1054, z: 1.7, r: -2 },
    { t: 27.321, type: 'whip', dur: 0.12, cx: 540, cy: 1054, z: 1.6, r: 1 },
    { t: 27.622, type: 'cut', cx: 808, cy: 1054, z: 1.8, r: 2 },
    { t: 28.05, type: 'smooth', dur: 0.5, cx: 540, cy: 960, z: 1.0, r: 0 },
    { t: 28.8, type: 'smooth', dur: 1.85, cx: 600, cy: 1110, z: 1.18, r: -1 },
    { t: 30.728, type: 'crash', dur: 0.08, cx: 808, cy: 1054, z: 1.7, r: 3 },
  ];

  // 重大衝擊（第 3 級）
  const BIG_HITS = [HOOK_SHATTER, SWAP.slam];

  g.TL = { SHOTS, S, GAP, COLS, ROW1, ROW2, FLOOR_Y, HOOK, HOOK_SHATTER, HOOK_CRACK, WALL, NUMBERS, SWAP, WALL_FALL, FINAL, STAMP, END_CRACK, DURATION, BIG_HITS };
})(typeof window !== 'undefined' ? window : globalThis);
