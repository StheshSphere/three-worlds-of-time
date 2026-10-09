/**
 * Dev-only: open a page in headless Chrome, wait for window.__ready (or a
 * timeout), optionally run a JS snippet, save a screenshot, and print the
 * browser console. Used to check visuals and catch console errors without a
 * human at the keyboard.
 *
 *   node shot.mjs <url> <out.png> [--wait=ms] [--eval="js"] [--size=1280x720]
 */
import puppeteer from 'puppeteer-core';

const [url, out, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const [w, h] = (opt.size || '1280x720').split('x').map(Number);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`],
  defaultViewport: { width: w, height: h },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
try {
  await page.waitForFunction('window.__ready === true', { timeout: Number(opt.wait || 30000) });
} catch { logs.push('[shot] timed out waiting for window.__ready'); }
if (opt.eval) {
  try {
    const r = await page.evaluate(opt.eval);
    if (r !== undefined) logs.push(`[eval] ${typeof r === 'string' ? r : JSON.stringify(r)}`);
  } catch (e) { logs.push(`[eval error] ${e.message}`); }
}
if (opt.delay) await new Promise((r) => setTimeout(r, Number(opt.delay)));
if (out && out !== '-') await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
