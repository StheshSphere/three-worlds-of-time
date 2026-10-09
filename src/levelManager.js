import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createKit } from './core/kit.js';
import { createSky } from './shaders/sky.js';
import { settings } from './core/settings.js';
import * as ancientRuins from './levels/ancientRuins.js';
import * as modernLab from './levels/modernLab.js';
import * as neonFuture from './levels/neonFuture.js';

export const LEVELS = [ancientRuins, modernLab, neonFuture];

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Owns the era lifecycle: build → play → (fail | complete) → dispose → next.
 *
 * Level module contract (see AGENTS.md):
 *   export const meta = { name, numeral, title, subtitle, objective, music,
 *                         ambience, sky, stability, accent, surface }
 *   export function build(kit, api) → kit.result({ spawn, spawnYaw, ... })
 *
 * The `api` object is the ONLY way a level talks to the rest of the game —
 * levels never import main.js, the player or the UI.
 *
 * Timeline stability: every era has a time budget (meta.stability seconds).
 * Falling or getting shocked costs time; running out collapses the era (a
 * fail state — Control & Playability asks for "succeed and fail"). As it
 * runs low the post-process starts tearing the image (uGlitch).
 */
export function createLevelManager({ scene, renderer, camera, player, timeMachine, audio, ui, postfx, minimap }) {
  const levelGroup = new THREE.Group();
  levelGroup.name = 'Level';
  scene.add(levelGroup);
  const pmrem = new THREE.PMREMGenerator(renderer);

  let index = -1;
  let level = null;          // kit.result() of the mounted era
  let meta = null;
  let sky = null;
  let envRT = null;
  let sun = null;
  let hintFn = null;
  let marker = null;
  let stability = 0;
  let stabilityMax = 1;
  let state = 'idle';        // idle | playing | transition | failing | finale | won | title
  let stateTime = 0;
  let pending = null;        // transition bookkeeping
  let time = 0;
  let cinematic = null;      // camera override fn(dt, t)
  const levelDisposables = [];
  const stats = { runTime: 0, falls: 0, rewinds: 0, shocks: 0 };
  const callbacks = { onFail: null, onWin: null, onLoaded: null };

  /* ------------------------------ the level API ------------------------------ */
  const flashState = { on: false, pos: new THREE.Vector3(), dir: new THREE.Vector3() };
  const api = {
    get time() { return time; },
    get player() { return player; },
    get camera() { return camera; },
    get scene() { return scene; },
    get quality() { return settings.quality(); },
    get renderer() { return renderer; },
    audio,
    message: (text, ms) => ui.message(text, ms),
    setObjective: (text) => ui.setObjective(text),
    setHint: (fn) => { hintFn = fn; },
    setMarker: (pos, color) => { marker = pos ? pos.clone() : null; minimap.setObjective(marker, color); },
    checkpoint: (pos, yaw, label = 'Checkpoint — the timeline remembers this moment.') => {
      player.setCheckpoint(pos, yaw);
      if (label) ui.message(label, 2200);
      audio.play('checkpoint', { volume: 0.5 });
    },
    penalize: (seconds, reason) => {
      stability = Math.max(0, stability - seconds);
      if (reason) ui.message(`${reason}  (−${seconds}s stability)`, 2600);
    },
    hurt: (opts = {}) => {
      if (state !== 'playing') return;
      if (player.hurt(opts)) {
        stats.shocks++;
        ui.damage();
        audio.play('zap', { volume: 0.9 });
        if (opts.penalty) api.penalize(opts.penalty, opts.reason);
        if (opts.respawn) setTimeout(() => { if (state === 'playing') player.reset(); }, 450);
      }
    },
    sound: (name, opts) => audio.play(name, opts),
    positional: (name, obj, opts) => { const h = audio.positional(name, obj, opts); levelDisposables.push(h); return h; },
    journal: (html, key) => ui.addJournal(html, key),
    reader: (opts) => { player.unlock(); ui.openReader(opts); },
    keypad: (onSubmit) => { player.unlock(); ui.openKeypad(onSubmit); },
    grantFlashlight: () => { player.addFlashlight(); },
    flashlight: () => player.getFlashlightState(flashState),
    enableDash: () => { player.canDash = true; },
    shake: (n) => player.shake(n),
    completeLevel: (corePos) => beginCoreSequence(corePos),
    get sun() { return sun; },
    get sky() { return sky; },
  };

  /* ------------------------------ disposal ----------------------------------- */
  function disposeObject(root) {
    root.traverse((o) => {
      if (o.userData && o.userData.persistent) return;
      if (o.isMesh || o.isPoints || o.isLine) {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m[key]) m[key].dispose();
          m.dispose();
        }
        if (o.isInstancedMesh) o.dispose();
      }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      if (typeof o.dispose === 'function' && !o.isMesh && !o.isLight && !o.isScene) { try { o.dispose(); } catch { /* */ } }
    });
  }

  function unload() {
    if (level) {
      for (const o of level.objects) disposeObject(o);
      for (const l of level.lights) disposeObject(l);
      for (const d of level.disposables) if (d && d.dispose) d.dispose();
    }
    for (const d of levelDisposables.splice(0)) if (d && d.dispose) d.dispose();
    levelGroup.clear();
    if (sky) { scene.remove(sky.mesh); sky.dispose(); sky = null; }
    if (envRT) { envRT.dispose(); envRT = null; }
    if (sun) { scene.remove(sun, sun.target); sun.shadow.map?.dispose(); sun.dispose(); sun = null; }
    scene.environment = null;
    scene.fog = null;
    player.clearAttachments();
    level = null;
    hintFn = null;
    marker = null;
    minimap.setObjective(null);
  }

  /* ------------------------------ loading ------------------------------------ */
  function load(i, { title = false } = {}) {
    unload();
    index = i;
    const mod = LEVELS[i];
    meta = mod.meta;
    const q = settings.quality();

    // Sky dome + image-based lighting rendered from it.
    sky = createSky(meta.sky);
    scene.add(sky.mesh);
    if (meta.env === 'room') {
      const room = new RoomEnvironment(renderer);
      envRT = pmrem.fromScene(room, 0.04);
      room.dispose?.();
    } else {
      const envScene = new THREE.Scene();
      const dome = sky.mesh.clone();
      dome.position.set(0, 0, 0);
      envScene.add(dome);
      envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
    }
    scene.environment = envRT.texture;
    scene.environmentIntensity = meta.envIntensity ?? 1; // r160 ignores this; materials use envMapIntensity

    // Shadow-casting sun that follows the player (tight shadow box = sharp shadows, cheap).
    if (meta.sun) {
      sun = new THREE.DirectionalLight(meta.sun.color, meta.sun.intensity);
      sun.castShadow = q.shadows;
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const s = meta.sun.extent || 24;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 140 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      sun.userData.dir = sky.sunDir.clone();
      scene.add(sun, sun.target);
    }

    const kit = createKit({ renderer, quality: q, api });
    level = mod.build(kit, api);
    for (const o of level.objects) levelGroup.add(o);
    for (const l of level.lights) levelGroup.add(l);

    // The persistent Time Machine joins every era's physics. The kit's arrays
    // are live (levels add/remove colliders at runtime, e.g. barriers), so the
    // player is handed those exact arrays.
    const tm = timeMachine.getPhysics();
    kit.colliders.push(...tm.colliders);
    kit.walkables.push(...tm.walkables);
    player.setLevel({
      colliders: kit.colliders, walkables: kit.walkables, interactables: kit.interactables,
      spawn: level.spawn, spawnYaw: level.spawnYaw ?? 0, bounds: level.bounds ?? 120,
      killY: level.killY ?? -14, surface: meta.surface,
    });
    player.canDash = !!level.dash;      // the Future's new ability

    timeMachine.setEra(i);
    player.hero.setGauntletColor(meta.accent);
    postfx.setEra(i);
    minimap.setAccent(meta.accent);
    ui.setEra(i, meta.name);
    ui.setObjective(meta.objective);
    ui.setHint('');
    stabilityMax = meta.stability;
    stability = stabilityMax;
    audio.playMusic(title ? 'title' : meta.music);
    audio.setAmbience(meta.ambience);
    state = title ? 'title' : 'playing';
    stateTime = 0;
    if (!title) ui.eraCard(meta.numeral, meta.title, meta.subtitle);
    if (callbacks.onLoaded) callbacks.onLoaded(i);
  }

  /* ------------------------------ core → next era ---------------------------- */
  function beginCoreSequence() {
    if (state !== 'playing') return;
    state = 'transition';
    stateTime = 0;
    pending = { phase: 'out', next: index + 1 };
    player.frozen = true;
    audio.play('core-get', { volume: 0.9 });
    audio.duck(0.25, 3);
    ui.message(index < 2 ? 'The core is yours — the Time Machine calls it home…' : 'The final core! Hold on — the machine is pulling you back…', 3000);
  }

  function fail(reason) {
    if (state !== 'playing') return;
    state = 'failing';
    stateTime = 0;
    player.frozen = true;
    player.hero.play('death', { hold: true });
    audio.play('fail', { volume: 0.8 });
    audio.stopMusic(1);
    pending = { reason };
  }

  function retryEra() {
    stats.rewinds++;
    player.frozen = false;
    postfx.u.uFlash.value = 0;
    postfx.u.uWarp.value = 0;
    // Cores earned in this era are lost; earlier eras keep theirs.
    load(index);
  }

  function restartRun() {
    timeMachine.reset();
    stats.runTime = 0; stats.falls = 0; stats.rewinds = 0; stats.shocks = 0;
    ui.setCores(0);
    player.hero.setCores(0);
    ui.resetJournal();
    player.frozen = false;
    postfx.u.uFlash.value = 0;
    postfx.u.uWarp.value = 0;
    load(0);
  }

  function startFinale() {
    state = 'finale';
    ui.hide('hud');
    ui.clearMessage();
    stateTime = 0;
    player.frozen = true;
    player.reset();                            // stand at the machine
    const pos = new THREE.Vector3(0, timeMachine.daisTop, 5.2);
    player.rig.position.copy(pos);
    player.facing = Math.PI;
    timeMachine.lightSocket(2);
    ui.setCores(3);
    player.hero.setCores(3);
    audio.play('power-up', { volume: 1 });
    audio.playMusic('title', 3);
    let a = 0;
    cinematic = (dt) => {
      a += dt * 0.35;
      const r = 9 - Math.min(stateTime, 5) * 0.5;
      camera.position.set(Math.sin(a) * r, 3 + stateTime * 0.25, Math.cos(a) * r);
      camera.lookAt(0, 2.6, 0);
    };
  }

  /* ------------------------------ per frame ---------------------------------- */
  function update(dt) {
    time += dt;
    stateTime += dt;
    if (sky) sky.update(camera, time);
    if (sun) {
      // Follow the player; snap to shadow-map texels so shadows don't shimmer.
      const s = sun.shadow.camera.right * 2 / sun.shadow.mapSize.x;
      _v.copy(player.position);
      _v.x = Math.round(_v.x / s) * s;
      _v.z = Math.round(_v.z / s) * s;
      sun.target.position.copy(_v);
      sun.position.copy(_v).addScaledVector(sun.userData.dir, 60);
      sun.target.updateMatrixWorld();
    }

    if (state === 'playing' || state === 'title') {
      if (level && level.update) level.update(dt, time);
    }

    if (state === 'playing') {
      stats.runTime += dt;
      stability -= dt;
      const frac = stability / stabilityMax;
      ui.setStability(frac, stability);
      postfx.u.uGlitch.value = frac < 0.25 ? (0.25 - frac) * 4 * (0.5 + 0.5 * Math.sin(time * 2.3)) : 0;
      if (hintFn) ui.setHint(typeof hintFn === 'function' ? hintFn() : hintFn);
      if (stability <= 0) fail('Timeline stability ran out — the era folded in on itself.');
      // Short warp pulses (dash) fade back out during normal play.
      postfx.u.uWarp.value = Math.max(0, postfx.u.uWarp.value - dt * 1.6);
    } else {
      postfx.u.uGlitch.value = 0;
    }

    if (state === 'failing' && stateTime > 1.8) {
      state = 'failed';
      player.unlock();
      if (callbacks.onFail) callbacks.onFail(pending.reason);
    }

    if (state === 'transition') {
      const u = postfx.u;
      if (pending.phase === 'out') {
        u.uWarp.value = Math.min(1, stateTime / 1.4);
        u.uFlash.value = THREE.MathUtils.smoothstep(stateTime, 0.9, 1.5);
        if (!pending.sfx) { pending.sfx = true; audio.play('warp', { volume: 0.9 }); }
        if (stateTime > 1.55) {
          const finishing = index === LEVELS.length - 1;
          if (finishing) {
            u.uWarp.value = 0.6;
            startFinale();
          } else {
            const done = index;
            timeMachine.lightSocket(done);
            const cores = timeMachine.getCores();
            ui.setCores(cores);
            player.hero.setCores(cores);
            player.frozen = false;
            load(pending.next);
            player.frozen = true;
            state = 'transition';
            pending = { phase: 'in' };
            stateTime = 0;
          }
        }
      } else if (pending.phase === 'in') {
        u.uWarp.value = Math.max(0, 1 - stateTime / 1.6);
        u.uFlash.value = Math.max(0, 1 - stateTime / 0.9);
        if (stateTime > 1.6) {
          u.uWarp.value = 0;
          u.uFlash.value = 0;
          player.frozen = false;
          state = 'playing';
          ui.message('A socket on the Time Machine burns with recovered time.', 3000);
        }
      }
    }

    if (state === 'finale') {
      const u = postfx.u;
      u.uWarp.value = Math.max(0, 0.6 - stateTime * 0.6) + THREE.MathUtils.smoothstep(stateTime, 5.2, 6.4) * 0.8;
      u.uFlash.value = THREE.MathUtils.smoothstep(stateTime, 5.4, 6.4);
      if (stateTime > 1.5 && !pending.cheered) { pending.cheered = true; player.hero.play('cheer', { hold: true }); }
      if (stateTime > 6.6) {
        state = 'won';
        cinematic = null;
        u.uFlash.value = 0.0;
        u.uWarp.value = 0;
        player.unlock();
        if (callbacks.onWin) callbacks.onWin({ ...stats });
      }
    }
  }

  /** Called after player.update so cinematics can take the camera. */
  function updateCamera(dt) { if (cinematic) cinematic(dt, time); }

  return {
    api,
    load,
    retryEra,
    restartRun,
    update,
    updateCamera,
    fail,
    stats,
    callbacks,
    get index() { return index; },
    get state() { return state; },
    set state(s) { state = s; },
    get meta() { return meta; },
    get marker() { return marker; },
    /** Level-provided QA shortcuts (e.g. solve a puzzle) for automated tests. */
    get debug() { return level && level.debug; },
    registerFall() {
      stats.falls++;
      api.penalize(meta?.fallPenalty ?? 15, 'You slipped out of time');
      audio.play('warp', { volume: 0.5 });
      player.reset();
    },
  };
}
