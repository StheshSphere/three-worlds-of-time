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
  if (mode !== 'playing') return;
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

function startGame() {
  audio.unlock();
  ui.hide('title-screen');
  ui.show('hud');
  ui.resetJournal();
  player.frozen = false;
  player.mode = settings.get('thirdPerson') ? 'third' : 'first';
  levels.restartRun();
  mode = 'playing';
  player.lock();
}

levels.callbacks.onFail = (reason) => {
  mode = 'failed';
  ui.hide('hud');
  ui.showFail(reason);
};
levels.callbacks.onWin = (stats) => {
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
};

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
  if (e.code === 'Escape' && ui.panelOpen) { ui.closeTopPanel(); return; }
  if (e.code === 'KeyE' && ui.isOpen('reader-screen') && !ui.justOpened) { ui.closeTopPanel(); return; }
  if (e.code === 'KeyJ' && (mode === 'playing' || mode === 'overlay')) {
    if (ui.isOpen('journal-screen')) ui.closeTopPanel();
    else if (mode === 'playing') { player.unlock(); ui.openPanel('journal-screen'); }
  }
  if (e.code === 'KeyM' && mode === 'playing') settings.set('minimap', !settings.get('minimap'));
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
let t = 0;
let titleAngle = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);   // clamp: no huge steps after tab-switch
  t += dt;

  const running = mode === 'playing' || mode === 'title';
  if (running) {
    levels.update(dt);
    player.update(dt);
    levels.updateCamera(dt);
  }
  timeMachine.update(dt);

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

  postfx.render(t);
  if (mode === 'playing' && minimap.enabled) minimap.render(player.position, player.facing, t);

  // FPS counter + one-time automatic downgrade on slow lab machines.
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = Math.round(fpsFrames / fpsTime);
    ui.setFps(fps);
    if (mode === 'playing' && !userPickedQuality && settings.get('quality') !== 'low') {
      perfSamples.push(fps);
      if (perfSamples.length >= 12) {
        const avg = perfSamples.reduce((a, b) => a + b, 0) / perfSamples.length;
        if (avg < 32) {
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
  skipTo(i) { player.frozen = false; levels.load(i); mode = 'playing'; ui.hide('title-screen'); ui.show('hud'); },
  mode: () => mode,
};
window.__ready = true;
