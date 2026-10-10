/**
 * Dev-only browser checks. Use installed Chrome/Chromium; CHROME overrides discovery.
 * node tools/play.mjs tools/tests/member4-release.json out/member4
 * URL=http://localhost:8000 HEADLESS=0 VIEW=first are optional.
 * Puzzle shortcuts verify integration; a manual spatial playthrough is still required.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [scriptPath, outDir = 'out/browser'] = process.argv.slice(2);
if (!scriptPath) throw new Error('Usage: node tools/play.mjs <script.json> [outDir]');
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const [w, h] = (script.size || '1280x720').split('x').map(Number);
const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(p => path.join(p, 'Google/Chrome/Application/chrome.exe')),
];
const executablePath = candidates.find(p => p && fs.existsSync(p));
if (!executablePath) throw new Error('Chrome not found. Set CHROME to the installed browser executable.');
const url = new URL(process.env.URL || script.url);
url.searchParams.set('qa', '1');
const logs = [];
let errors = 0, assertions = 0, browser;
const fail = text => { errors++; logs.push(text); };
try {
  browser = await puppeteer.launch({
    executablePath, headless: process.env.HEADLESS === '0' ? false : 'new',
    args: ['--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: w, height: h },
  });
  const page = await browser.newPage();
  page.on('console', m => {
    if (/favicon/.test(m.text())) return;
    logs.push('[' + m.type() + '] ' + m.text());
    if (m.type() === 'error' || /^\[assets\]/.test(m.text())) errors++;
  });
  page.on('pageerror', e => fail('[pageerror] ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) fail('[http ' + r.status() + '] ' + r.url()); });
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) fail('[requestfailed] ' + r.url() + ' ' + r.failure()?.errorText); });
  await page.goto(url.href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true && !!window.__game', { timeout: 120000 });
  await page.evaluate(view => {
    window.__testView = view;
    __game.settings.set('thirdPerson', view === 'third');
  }, process.env.VIEW === 'first' ? 'first' : 'third');
  for (const [i, step] of script.steps.entries()) {
    if (step.comment) logs.push('[step ' + (i + 1) + '] ' + step.comment);
    if (step.click) await page.click(step.click);
    if (step.press) await page.keyboard.press(step.press);
    if (step.eval) {
      const r = await page.evaluate(step.eval);
      if (r != null) logs.push('[eval] ' + (typeof r === 'string' ? r : JSON.stringify(r)));
      if (typeof r === 'string' && r.startsWith('TIMEOUT')) throw new Error(r);
    }
    if (step.keys) {
      for (const k of step.keys) await page.keyboard.down(k);
      await new Promise(r => setTimeout(r, step.hold || 500));
      for (const k of step.keys) await page.keyboard.up(k);
    }
    if (step.wait) await new Promise(r => setTimeout(r, step.wait));
    if (step.until) { await page.waitForFunction(step.until, { timeout: step.timeout || 120000 }); assertions++; }
    if (step.assert) {
      if (!await page.evaluate(step.assert)) throw new Error('Assertion failed at step ' + (i + 1) + ': ' + step.assert);
      assertions++;
    }
    if (step.shot) await page.screenshot({ path: path.join(outDir, step.shot + '.png') });
  }
} catch (e) { fail('[failure] ' + e.stack); }
finally {
  await browser?.close();
  fs.writeFileSync(path.join(outDir, 'browser.log'), logs.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ url: url.href, view: process.env.VIEW || 'third', errors, assertions, status: errors ? 'FAIL' : 'PASS' }, null, 2));
}
console.log(logs.join('\n'));
console.log(JSON.stringify({ status: errors ? 'FAIL' : 'PASS', errors, assertions }));
process.exitCode = errors ? 1 : 0;
