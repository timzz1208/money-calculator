// 逐格輸出 video.html → MP4（1080×1920, 30fps, H.264, 無聲）
// 用法：FONT_DIR=/tmp/fonts node render.js [--frames 0,12.5 只輸出定格] [--clean 無字版] [--fps 30] [--vbitrate 4M] [--out 檔名]
// FONT_DIR 裡要有 sans500/700/900.ttf（Noto Sans TC）與 roboto500/700.ttf
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('--fps', 30);
const CLEAN = args.includes('--clean');
const FONT_DIR = opt('--fonts', process.env.FONT_DIR || '');
const OUT = opt('--out', path.join(__dirname, CLEAN ? 'reverse-plan-clean.mp4' : 'reverse-plan-preview.mp4'));
const FFMPEG = opt('--ffmpeg', process.env.FFMPEG || 'ffmpeg');
const stills = opt('--frames', null);
const VBR = opt('--vbitrate', '4M');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('file://' + path.join(__dirname, 'video.html') + '?render=1' + (CLEAN ? '&clean=1' : ''));
  if (FONT_DIR) {
    const face = (fam, file, w) => `@font-face{font-family:"${fam}";src:url("file://${path.join(FONT_DIR, file)}");font-weight:${w};}`;
    await page.addStyleTag({ content: [face('Noto Sans TC', 'sans500.ttf', 500), face('Noto Sans TC', 'sans700.ttf', 700), face('Noto Sans TC', 'sans900.ttf', 900),
      face('Roboto', 'roboto500.ttf', 500), face('Roboto', 'roboto700.ttf', 700)].join('') });
  }
  await page.evaluate(async () => {
    for (const w of [500, 700, 900]) await document.fonts.load(`${w} 40px "Noto Sans TC"`, '逆向財務工程');
    for (const w of [500, 700]) await document.fonts.load(`${w} 40px "Roboto"`, '0123456789');
  });
  const canvas = await page.$('canvas');

  if (stills) {
    for (const s of stills.split(',')) {
      await page.evaluate((t) => window.renderAt(t), +s);
      await canvas.screenshot({ path: path.join(process.env.STILL_DIR || __dirname, `still-${s}${CLEAN ? '-clean' : ''}.png`) });
    }
    await browser.close();
    return;
  }

  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS);
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', VBR, '-maxrate', VBR, '-bufsize', '8M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.renderAt(t), f / FPS);
    const buf = await canvas.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('done →', OUT);
})();
