import * as THREE from 'three';
import { settings, records } from './core/settings.js';
import { assets } from './core/assets.js';
import { AudioManager } from './core/audio.js';
import { PostFX } from './core/postfx.js';
import { UI } from './core/ui.js';
import { Minimap } from './core/minimap.js';
import { Player } from './player.js';
import { createTimeMachine } from './timeMachine.js';
import { createLevelManager } from './levelManager.js';
import { Cutscene } from './core/cutscene.js';
import * as prologueSet from './levels/prologue.js';
import * as story from './story.js';

/* =====================================================================
   Boot: renderer, camera, audio, assets → title screen.
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
assets.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.get('fov'), window.innerWidth / window.innerHeight, 0.05, 600);
scene.add(camera);

const audio = new AudioManager(camera);
const ui = new UI(audio);
// Browsers keep audio suspended until the first user gesture — resume on the
// first click/keypress so the title music and menu sounds start right away.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { once: true });

let quality = settings.quality();
const postfx = new PostFX(renderer, scene, camera, { samples: settings.get('quality') === 'low' ? 0 : 4 });
function applyQuality() {
  quality = settings.quality();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.shadowMap.enabled = quality.shadows;
  postfx.setPixelRatio(renderer.getPixelRatio());
  postfx.setBloomEnabled(quality.bloom);
  postfx.setSamples(settings.get('quality') === 'low' ? 0 : 4);
  postfx.setSize(window.innerWidth, window.innerHeight);
}
applyQuality();

const minimap = new Minimap(renderer, scene);

let mode = 'loading';         // loading | title | playing | paused | overlay | failed | won
let userPickedQuality = false;

ui.show('loading-screen');
await assets.loadAll(audio.ctx, (f, label) => ui.setProgress(f, label));

const player = new Player(camera, renderer.domElement);
scene.add(player.object, player.worldFx);
const timeMachine = createTimeMachine();
scene.add(timeMachine);

const levels = createLevelManager({ scene, renderer, camera, player, timeMachine, audio, ui, postfx, minimap });
const cutscene = new Cutscene({ camera, ui });
const storyCtx = (set) => ({ levels, player, timeMachine, audio, postfx, ui, cs: cutscene, set });
let creditsTimer = null;
let pendingStats = null;

/* =====================================================================
   Player events → audio / UI
   ===================================================================== */
player.addEventListener('step', (e) => {
  const map = { grass: 'step-grass', stone: 'step-stone', metal: 'step-metal' };
  audio.playVariant(map[e.surface] || 'step-stone', 4, { volume: e.sprint ? 0.55 : 0.4 });
});
player.addEventListener('land', (e) => { audio.play('land', { volume: Math.min(1, e.speed / 14) }); if (e.speed > 13) player.shake(0.25); });
player.addEventListener('dash', () => { audio.play('dash', { volume: 0.7 }); postfx.u.uWarp.value = Math.max(postfx.u.uWarp.value, 0.22); });
player.addEventListener('fall', () => { if (levels.state === 'playing') levels.registerFall(); });
player.addEventListener('view', (e) => ui.message(e.mode === 'first' ? 'First-person view' : 'Third-person view', 1200));
player.addEventListener('flashlight', (e) => audio.play('switch', { volume: 0.6, rate: e.on ? 1.1 : 0.9 }));

player.addEventListener('lock', () => {
  if (mode === 'paused' || mode === 'overlay') {
    mode = 'playing';
    ui.hide('pause-screen');
    ui.show('hud');
  }
});
player.addEventListener('unlock', () => {
  if (mode !== 'playing') return;      // cutscenes, credits and menus ignore pointer unlocks
  if (ui.panelOpen) { mode = 'overlay'; return; }
  if (levels.state === 'failed' || levels.state === 'won') return;
  pause();
});

/* =====================================================================
   Game flow
   ===================================================================== */
function pause() {
  mode = 'paused';
  ui.setPauseLevel(`You are in ${levels.meta ? levels.meta.title.toLowerCase() : 'the timeline'} — ${levels.meta ? levels.meta.subtitle : ''}.`);
  ui.show('pause-screen');
}

function resume() {
  ui.closeAllPanels();
  ui.hide('pause-screen');
  player.lock();
}

function showTitle() {
  mode = 'title';
  for (const id of ['hud', 'pause-screen', 'fail-screen', 'win-screen']) ui.hide(id);
  ui.closeAllPanels();
  timeMachine.reset();
  ui.setCores(0);
  player.hero.setCores(0);
  levels.load(0, { title: true });
  player.frozen = true;
  player.mode = 'third';
  player.rig.position.set(1.6, timeMachine.daisTop, 4.4);
  player.facing = -0.5;
  const best = records.bestTime();
  ui.setBestTime(best ? `Best journey: ${formatTime(best)}` : '');
  ui.show('title-screen');
}

/* Story flow: prologue (lab, 03:07) → wake-up in the Past → play. */
function startGame() {
  audio.unlock();
  ui.hide('title-screen');
  ui.hide('hud');
  ui.resetJournal();
  mode = 'cutscene';
  player.lock();
  const set = levels.loadSet(prologueSet, 'night');
  cutscene.play(story.prologue(storyCtx(set)), { onDone: beginPast });
}

function beginPast() {
  levels.restartRun({ cutscene: true });
  player.frozen = true;
  mode = 'cutscene';
  cutscene.play(story.wakeUp(storyCtx(levels.level)), { onDone: () => {
    player.hero.release();
    player.mode = settings.get('thirdPerson') ? 'third' : 'first';
    player.yaw = 0;                 // look toward the temple; stay where Ari stood up
    player.pitch = -0.12;
    player.velocity.set(0, 0, 0);
    levels.startPlay();
    ui.show('hud');
    mode = 'playing';
    if (!player.isLocked) { player.lock(); setTimeout(() => { if (!player.isLocked && mode === 'playing') pause(); }, 400); }
  } });
}

/* Finale → epilogue (lab, next morning) → credits roll → journey stats. */
function startEpilogue(stats) {
  pendingStats = stats;
  mode = 'cutscene';
  ui.hide('hud');
  ui.stopSay();
  const set = levels.loadSet(prologueSet, 'morning');
  cutscene.play(story.epilogue(storyCtx(set)), { onDone: startCredits });
}

function startCredits() {
  mode = 'credits';
  ui.endCard(false);
  ui.cinema(true, true);
  ui.rollCredits(true);
  clearTimeout(creditsTimer);
  creditsTimer = setTimeout(endCredits, 26500);
}

function endCredits() {
  clearTimeout(creditsTimer);
  ui.rollCredits(false);
  ui.endCard(false);
  ui.cinema(false);
  showWinScreen(pendingStats || levels.stats);
}

levels.callbacks.onFail = (reason) => {
  mode = 'failed';
  ui.hide('hud');
  ui.showFail(reason);
};
levels.callbacks.onFinale = (stats) => startEpilogue(stats);
levels.callbacks.onEraArrive = (i) => { if (story.ARRIVALS[i]) ui.say(story.ARRIVALS[i]); };

function showWinScreen(stats) {
  mode = 'won';
  ui.hide('hud');
  const isBest = records.submit(Math.round(stats.runTime));
  ui.showWin([
    ['Journey time', formatTime(stats.runTime) + (isBest ? '  ★ new best' : '')],
    ['Falls through time', String(stats.falls)],
    ['Shocks taken', String(stats.shocks)],
    ['Eras rewound', String(stats.rewinds)],
  ]);
  audio.play('win', { volume: 0.9 });
}

document.getElementById('play-button').addEventListener('click', startGame);
document.getElementById('resume-button').addEventListener('click', resume);
document.getElementById('retry-era-button').addEventListener('click', () => { ui.hide('pause-screen'); levels.retryEra(); mode = 'playing'; player.lock(); });
document.getElementById('restart-button').addEventListener('click', () => { ui.hide('pause-screen'); ui.resetJournal(); levels.restartRun(); mode = 'playing'; player.lock(); });
document.getElementById('quit-button').addEventListener('click', () => { audio.stopMusic(0.5); showTitle(); });
document.getElementById('fail-retry-button').addEventListener('click', () => { ui.hide('fail-screen'); ui.show('hud'); levels.retryEra(); mode = 'playing'; player.lock(); });
document.getElementById('fail-quit-button').addEventListener('click', showTitle);
document.getElementById('win-restart-button').addEventListener('click', () => { ui.hide('win-screen'); ui.show('hud'); ui.resetJournal(); levels.restartRun(); mode = 'playing'; player.lock(); });
document.getElementById('win-quit-button').addEventListener('click', showTitle);

// Closing a level overlay (note, terminal, keypad, journal) returns to play.
ui.onPanelClosed = () => {
  if (mode === 'overlay' && !ui.panelOpen) {
    mode = 'playing';
    player.lock();
    // If the browser refuses the lock (no user gesture), fall back to pause.
    setTimeout(() => { if (!player.isLocked && mode === 'playing') pause(); }, 400);
  }
};

window.addEventListener('keydown', (e) => {
  if (mode === 'cutscene' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { cutscene.skip(); return; }
  if (mode === 'credits' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { endCredits(); return; }
  if (e.code === 'Escape' && ui.panelOpen) { ui.closeTopPanel(); return; }
  if (e.code === 'KeyE' && ui.isOpen('reader-screen') && !ui.justOpened) { ui.closeTopPanel(); return; }
  if (e.code === 'KeyJ' && (mode === 'playing' || mode === 'overlay')) {
    if (ui.isOpen('journal-screen')) ui.closeTopPanel();
    else if (mode === 'playing') { player.unlock(); ui.openPanel('journal-screen'); }
  }
  if (e.code === 'KeyM' && mode === 'playing') settings.set('minimap', !settings.get('minimap'));
  if (e.code === 'KeyH' && mode === 'playing') ui.toggleTutorial();
});

settings.onChange((key) => {
  if (key === 'quality') { userPickedQuality = true; applyQuality(); ui.message('Graphics quality changed — reflections and grass density update when the next era loads.', 3500); }
  if (key === 'fov') { camera.fov = settings.get('fov'); camera.updateProjectionMatrix(); }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

/* On-screen waypoint: project the current objective into screen space. Off
   screen (or behind the camera) it sticks to the edge with an arrow pointing
   the way — the player always knows where to go next. */
const _wp = new THREE.Vector3();
function updateWaypoint() {
  const m = levels.marker;
  if (!m || mode !== 'playing' || levels.state !== 'playing') { ui.setWaypoint(false); return; }
  const dist = Math.hypot(m.x - player.position.x, m.z - player.position.z);
  if (dist < 2.2) { ui.setWaypoint(false); return; }
  _wp.set(m.x, (m.y || player.position.y) + 1.6, m.z).project(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const behind = _wp.z > 1;
  let x = (_wp.x * 0.5 + 0.5) * w;
  let y = (-_wp.y * 0.5 + 0.5) * h;
  if (behind) { x = w - x; y = Math.max(y, h * 0.75); }
  const mx = 56;
  const top = 130;
  const off = behind || x < mx || x > w - mx || y < top || y > h - mx;
  if (!off) { ui.setWaypoint(true, x, y, dist); return; }
  const cx = w / 2;
  const cy = h / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const k = Math.min((w / 2 - mx) / Math.abs(dx || 1e-6), (h / 2 - mx) / Math.abs(dy || 1e-6));
  x = cx + dx * k;
  y = Math.max(top, cy + dy * k);
  ui.setWaypoint(true, x, y, dist, Math.atan2(dy, dx) + Math.PI / 2);
}

function formatTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/* =====================================================================
   Render loop
   ===================================================================== */
const clock = new THREE.Clock();
let fpsFrames = 0;
let fpsTime = 0;
let perfSamples = [];
let playSeconds = 0;
let t = 0;
let titleAngle = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);   // clamp: no huge steps after tab-switch
  t += dt;

  const running = mode === 'playing' || mode === 'title' || mode === 'cutscene' || mode === 'credits';
  if (running) {
    levels.update(dt);
    player.update(dt);
    levels.updateCamera(dt);
    cutscene.update(dt);
  }
  timeMachine.update(dt);
  if (mode === 'credits') {
    titleAngle += dt * 0.06;
    camera.position.set(Math.sin(titleAngle) * 11, 4.6, Math.cos(titleAngle) * 11);
    camera.lookAt(0, 2.2, 0);
  }

  if (mode === 'title') {
    titleAngle += dt * 0.08;
    camera.position.set(Math.sin(titleAngle) * 11 + 2, 3.4, Math.cos(titleAngle) * 11);
    camera.lookAt(0, 2.1, 0);
    player.hero.group.visible = true;
  }

  if (mode === 'playing') {
    const obj = player.nearbyInteractable;
    const prompt = obj ? (typeof obj.userData.prompt === 'function' ? obj.userData.prompt() : obj.userData.prompt) : null;
    ui.setPrompt(levels.state === 'playing' ? prompt : null);
    ui.setDash(player.canDash, player.dashReady);
    ui.setMinimapVisible(settings.get('minimap'));
    minimap.enabled = settings.get('minimap');
  }

  updateWaypoint();
  postfx.render(t);
  if (mode === 'playing' && minimap.enabled) minimap.render(player.position, player.facing, t);

  // FPS counter + one-time automatic downgrade on slow lab machines.
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = Math.round(fpsFrames / fpsTime);
    ui.setFps(fps);
    // Measure only after 8 s of uninterrupted play (shader compilation and
    // asset uploads stutter right after an era loads), then judge on the
    // MEDIAN of 10 s of samples so one hitch can't trigger a downgrade.
    if (mode === 'playing' && levels.state === 'playing') playSeconds += 0.5; else playSeconds = 0;
    if (playSeconds > 8 && !userPickedQuality && settings.get('quality') !== 'low') {
      perfSamples.push(fps);
      if (perfSamples.length >= 20) {
        const sorted = [...perfSamples].sort((x, y) => x - y);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (median < 28) {
          settings.set('quality', 'low');
          ui.message('Running slowly — switched to Low graphics quality (change it in Options).', 4500);
        }
        userPickedQuality = true;
      }
    }
    fpsFrames = 0;
    fpsTime = 0;
  }
}

ui.hide('loading-screen');
showTitle();
frame();

/* =====================================================================
   Debug / QA hook — lets automated tests and the team drive the game from
   the browser console (e.g. __game.skipTo(2)). Harmless in production.
   ===================================================================== */
window.__game = {
  THREE, scene, renderer, camera, player, timeMachine, levels, audio, ui, postfx, settings,
  start: startGame,
  skipTo(i) { cutscene.active = false; ui.cinema(false); player.frozen = false; levels.load(i); mode = 'playing'; ui.hide('title-screen'); ui.show('hud'); },
  cutscene,
  story: { startGame, beginPast, startEpilogue, endCredits },
  mode: () => mode,
};
window.__ready = true;
