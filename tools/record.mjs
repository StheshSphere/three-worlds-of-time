/**
 * Dev-only scripted play-through RECORDER in headless Chrome.
 *
 *   node record.mjs <script.json> <outDir>
 *
 * Same script format as play.mjs (eval / wait / keys / shot) plus two
 * recording steps:
 *   { "recStart": true }            // begin capturing the WebGL canvas
 *   { "recStop": "clip-name" }      // stop and write <outDir>/<clip-name>.webm
 *
 * Capture is canvas-only (window.__game.renderer.domElement.captureStream
 * through MediaRecorder): the DOM overlays — HUD, hint line, era cards,
 * tutorials — are NOT in the video, which is what you want for trailer /
 * devlog B-roll. The webm has no audio track; lay music and narration over
 * it in the edit (only OGA/Kenney audio may ship, not anything IRL).
 *
 * Prints console output and any page errors; exits non-zero on page errors
 * or if the written file is not a valid WebM.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [scriptPath, outDir] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const [w, h] = (script.size || '1280x720').split('x').map(Number);
// --use-angle=metal only exists on macOS; passing it on Windows silently
// drops Chrome to the software renderer (~7 fps, game time crawls).
const angleArgs = process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=default'];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [...angleArgs, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: w, height: h },
});
const page = await browser.newPage();
const logs = [];
let errors = 0;
page.on('console', (m) => { if (!/favicon/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => { errors++; logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`); });
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(script.url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });

let recT0 = 0;
for (const step of script.steps) {
  if (step.eval) {
    try {
      const r = await page.evaluate(step.eval);
      if (r !== undefined && r !== null) logs.push(`[eval] ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    } catch (e) { errors++; logs.push(`[eval error] ${e.message}`); }
  }
  if (step.keys) {
    for (const k of step.keys) await page.evaluate((code) => window.dispatchEvent(new KeyboardEvent('keydown', { code })), k);
    await new Promise((r) => setTimeout(r, step.hold || 500));
    for (const k of step.keys) await page.evaluate((code) => window.dispatchEvent(new KeyboardEvent('keyup', { code })), k);
  }
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  if (step.shot) await page.screenshot({ path: path.join(outDir, `${step.shot}.png`) });
  if (step.recStart) {
    const mime = await page.evaluate(() => {
      const canvas = window.__game.renderer.domElement;
      const stream = canvas.captureStream(30);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2200000 });
      window.__rec = { rec, chunks: [], base64: null, done: false, mime: mimeType };
      rec.ondataavailable = (e) => { if (e.data.size) window.__rec.chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(window.__rec.chunks, { type: mimeType });
        const fr = new FileReader();
        fr.onload = () => { window.__rec.base64 = String(fr.result).split(',')[1]; window.__rec.done = true; };
        fr.readAsDataURL(blob);
      };
      rec.start(250);
      return mimeType;
    });
    recT0 = Date.now();
    logs.push(`[rec] start (${mime})`);
  }
  if (step.recStop) {
    await page.evaluate('window.__rec.rec.stop()');
    await page.waitForFunction('window.__rec && window.__rec.done === true', { timeout: 180000 });
    const b64 = await page.evaluate('window.__rec.base64');
    const buf = Buffer.from(b64, 'base64');
    const file = path.join(outDir, `${step.recStop}.webm`);
    fs.writeFileSync(file, buf);
    const magic = buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    logs.push(`[rec] stop — wrote ${file} (${(buf.length / 1048576).toFixed(1)} MB, ${((Date.now() - recT0) / 1000).toFixed(1)}s wall, webm magic ${magic ? 'ok' : 'MISSING'})`);
    if (!magic) errors++;
  }
}
console.log(logs.join('\n'));
await browser.close();
process.exit(errors ? 1 : 0);
