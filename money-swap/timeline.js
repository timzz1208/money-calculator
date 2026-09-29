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

  // 重大衝擊（第 3 級）
  const BIG_HITS = [HOOK_SHATTER, SWAP.slam];

  g.TL = { S, GAP, COLS, ROW1, ROW2, FLOOR_Y, HOOK, HOOK_SHATTER, HOOK_CRACK, WALL, NUMBERS, SWAP, WALL_FALL, FINAL, STAMP, END_CRACK, DURATION, BIG_HITS };
})(typeof window !== 'undefined' ? window : globalThis);
