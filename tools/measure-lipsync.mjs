/**
 * Measures the lip-sync calibration against the BROWSER's mp3 decoder — the
 * same decode path the game uses (fetch + decodeAudioData). For every voice
 * line it finds the first audible frame of the shipped mp3 and compares it
 * with the first viseme event in src/core/visemes.js; the median difference
 * is the correction stored as LIP_CALIB.
 *
 *   node tools/measure-lipsync.mjs http://localhost:8000
 */
import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://localhost:8000';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  headless: 'new',
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.goto(`${base}/?qa=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 45000 });

const out = await page.evaluate(async () => {
  const { LIP_LINES } = await import('/src/core/visemes.js');
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const rows = [];
  for (const [key, line] of Object.entries(LIP_LINES)) {
    const buf = await (await fetch(`/assets/audio/voice/${key}.mp3`)).arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const d = audio.getChannelData(0);
    const win = Math.max(1, Math.round(audio.sampleRate * 0.005));
    const thr = 280 / 32768;
    let onset = null;
    for (let i = 0; i + win <= d.length; i += win) {
      let peak = 0;
      for (let k = 0; k < win; k++) peak = Math.max(peak, Math.abs(d[i + k]));
      if (peak > thr) { onset = i / audio.sampleRate; break; }
    }
    let first = 0;
    for (let i = 0; i < line.t.length; i += 3) {
      if (line.t[i + 1] !== 0) { first = line.t[i] / 1000; break; }
    }
    rows.push({ key, onset, first, dur: audio.duration, rate: audio.sampleRate });
  }
  await ctx.close();
  return rows;
});
await browser.close();

const clean = out.filter((r) => r.onset !== null);
const deltas = clean.map((r) => (r.onset - r.first) * 1000).sort((a, b) => a - b);
const median = deltas[Math.floor(deltas.length / 2)];
console.log(JSON.stringify({ medianDeltaMs: median, deltas }));
for (const r of out) {
  console.log(`${r.key.padEnd(16)} onset ${r.onset === null ? '  n/a' : (r.onset * 1000).toFixed(1).padStart(6)}ms  first ${(r.first * 1000).toFixed(0).padStart(5)}ms  dur ${r.dur.toFixed(3)}s @${r.rate}`);
}
