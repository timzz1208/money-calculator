// 逐格輸出 video.html → MP4（1080×1920, 60fps, H.264）
// 用法：node render.js [--frames 0,5,12.5 輸出單格 PNG] [--fps 60] [--font 黑體路徑] [--serif 宋體路徑]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('--fps', 60);
const FONT = opt('--font', process.env.FONT_TTF || '');
const SERIF = opt('--serif', process.env.SERIF_TTF || '');
const OUT = opt('--out', path.join(__dirname, 'family-flow-ig.mp4'));
const FFMPEG = opt('--ffmpeg', process.env.FFMPEG || 'ffmpeg');
const stills = opt('--frames', null);
const VBR = opt('--vbitrate', null);   // 例如 5.5M；不給就用 crf 17

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('file://' + path.join(__dirname, 'video.html') + '?render=1');
  if (FONT) {
    await page.addStyleTag({ content: `@font-face{font-family:"Noto Sans TC";src:url("file://${FONT}");font-weight:100 900;}` });
  }
  if (SERIF) {
    await page.addStyleTag({ content: `@font-face{font-family:"Noto Serif TC";src:url("file://${SERIF}");font-weight:100 900;}` });
  }
  await page.evaluate(async () => {
    for (const w of [500, 600, 700, 800, 900]) await document.fonts.load(`${w} 40px "Noto Sans TC"`, '家庭責任');
    await document.fonts.load('900 40px "Noto Serif TC"', '家庭責任');
  });
  const canvas = await page.$('canvas');

  if (stills) {
    for (const s of stills.split(',')) {
      await page.evaluate((t) => window.renderAt(t), +s);
      await canvas.screenshot({ path: path.join(process.env.STILL_DIR || __dirname, `still-${s}.png`) });
    }
    await browser.close();
    return;
  }

  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS);
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', ...(VBR ? ['-b:v', VBR, '-maxrate', VBR, '-bufsize', '12M', '-tune', 'grain'] : ['-crf', '17']),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.renderAt(t), Math.min(f / FPS, dur - 1e-3));
    const buf = await canvas.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 120 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('done →', OUT);
})();
