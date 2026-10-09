/**
 * Dev-only scripted play-through in headless Chrome.
 *
 *   node play.mjs <script.json> <outDir>
 *
 * script.json: { "url": "...", "size": "1280x720", "steps": [
 *   { "eval": "js expression" } | { "wait": ms } | { "shot": "name" } |
 *   { "keys": ["KeyW"], "hold": ms }        // hold keys down for ms
 * ]}
 * Prints console output and any page errors; exits non-zero on page errors.
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
}
console.log(logs.join('\n'));
await browser.close();
process.exit(errors ? 1 : 0);
