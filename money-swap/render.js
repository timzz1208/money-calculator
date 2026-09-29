// 逐格輸出 video.html → MP4（可選：把歌混進預覽版）
// 用法：node render.js [--fps 30] [--scale 1] [--mb 4] [--out 檔名] [--frames 0,4.1,21.5] [--audio 音檔 --audio-start 21]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('--fps', 30), SCALE = +opt('--scale', 1), MBS = +opt('--mb', 1);
const OUT = opt('--out', path.join(__dirname, 'money-swap-ig.mp4'));
const FFMPEG = opt('--ffmpeg', process.env.FFMPEG || 'ffmpeg');
const VBR = opt('--vbitrate', null);
const AUDIO = opt('--audio', null), AUDIO_START = opt('--audio-start', '0'), SFX = opt('--sfx', null);
const stills = opt('--frames', null);
const SERIF = process.env.SERIF_TTF || '', SANS = process.env.FONT_TTF || '';

(async () => {
  const browser = await chromium.launch();
  const W = Math.round(1080 * SCALE), H = Math.round(1920 * SCALE);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('file://' + path.join(__dirname, 'video.html') + `?render=1&scale=${SCALE}&mb=${MBS}`);
  const faces = [];
  if (SERIF) faces.push(`@font-face{font-family:"Noto Serif TC";src:url("file://${SERIF}");font-weight:100 900;}`);
  if (SANS) faces.push(`@font-face{font-family:"Noto Sans TC";src:url("file://${SANS}");font-weight:100 900;}`);
  if (faces.length) await page.addStyleTag({ content: faces.join('') });
  await page.evaluate(async () => {
    await document.fonts.load('900 60px "Noto Serif TC"', '錢在工作');
    await document.fonts.load('800 40px "Noto Sans TC"', '@timzz1208 財商');
    await window.ready;
  });
  const canvas = await page.$('canvas#stage');
  if (stills) {
    for (const s of stills.split(',')) {
      await page.evaluate((t) => window.renderAt(t), +s);
      await canvas.screenshot({ path: path.join(process.env.STILL_DIR || __dirname, `still-${s}.png`) });
    }
    await browser.close(); return;
  }
  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS);
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (AUDIO) ffArgs.push('-ss', AUDIO_START, '-t', String(dur), '-i', AUDIO);
  if (SFX) ffArgs.push('-i', SFX);
  if (AUDIO && SFX) ffArgs.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]', '-map', '0:v', '-map', '[a]');
  else if (AUDIO || SFX) ffArgs.push('-map', '0:v', '-map', '1:a');
  ffArgs.push('-c:v', 'libx264', '-preset', 'medium', ...(VBR ? ['-b:v', VBR, '-maxrate', VBR, '-bufsize', '12M'] : ['-crf', '18']),
    '-pix_fmt', 'yuv420p');
  if (AUDIO || SFX) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  ffArgs.push('-movflags', '+faststart', OUT);
  const ff = spawn(FFMPEG, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.renderAt(t), f / FPS);
    const buf = await canvas.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 90 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('done →', OUT);
})();
