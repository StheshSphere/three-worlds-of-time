import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createKit } from './core/kit.js';
import { createSky } from './shaders/sky.js';
import { settings } from './core/settings.js';
import { JourneyStore, SAVE_VERSION, validateSave } from './core/save.js?v=restart-era-journal-fix-20261024-r3';
import { assets } from './core/assets.js';
import { createRunStats, countPuzzles } from './core/stats.js';
import { ERA_CARDS } from './story.js';
import * as ancientRuins from './levels/ancientRuins.js?v=arch-wall-gate-fix-20261030';
import * as modernLab from './levels/modernLab.js?v=restart-era-journal-fix-20261024-r3';
import * as neonFuture from './levels/neonFuture.js?v=restart-era-journal-fix-20261024-r3';
import { journalTablets } from './levels/tabletPuzzle.js';

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

  const store = new JourneyStore();
  let eraProgress = [null, null, null];
  let previousTabletCode = null;
  let runActive = false, restoring = false, dirty = false, warming = false;
  let saveClock = 0, dirtyAt = 0, lastSaved = -10, unsafeFor = 0, mountToken = 0;
  const requestSave = () => { if (runActive && !restoring) { if (!dirty) dirtyAt = saveClock; dirty = true; } };
  let index = -1;
  let level = null;          // kit.result() of the mounted era
  let meta = null;
  let sky = null;
  let envRT = null;
  let sun = null;
  let hintFn = null;
  let checklistFn = null;
  const shownTutorials = new Set();
  const spokenLines = new Set();
  let marker = null;
  let stability = 0;
  let stabilityMax = 1;
  let state = 'idle';        // idle | playing | transition | failing | finale | won | title
  let stateTime = 0;
  let pending = null;        // transition bookkeeping
  let time = 0;
  let cinematic = null;      // camera override fn(dt, t)
  const levelDisposables = [];
  const timers = [];
  const after = (milliseconds, fn) => timers.push({ remaining: milliseconds / 1000, fn });
  const stats = { runTime: 0, falls: 0, rewinds: 0, shocks: 0 };
  // Silent journey statistics (src/core/stats.js) — recorded during play,
  // revealed only after the ending story. Never shown between levels.
  const runStats = createRunStats();
  const _walkFrom = new THREE.Vector3(Infinity, 0, Infinity);
  const callbacks = { onFail: null, onFinale: null, onLoaded: null, onEraArrive: null };

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
    progress: requestSave,
    message: (text, ms) => { if (!restoring) ui.message(text, ms); },
    setObjective: (text) => { ui.setObjective(text); requestSave(); },
    setHint: (fn) => { hintFn = fn; },
    /** fn() → [{ text, state: 'done'|'active'|'todo' }] — the HUD step checklist. */
    setChecklist: (fn) => { checklistFn = fn; },
    /** Instruction card, shown once per key per era load (H shows it again). */
    tutorial: (key, card, seconds = 13) => {
      if (shownTutorials.has(key)) return;
      shownTutorials.add(key);
      ui.tutorial(card, seconds); requestSave();
    },
    /** Ari thinks aloud (in-game captions), once per key. */
    say: (key, lines) => {
      if (spokenLines.has(key)) return;
      spokenLines.add(key);
      ui.say(lines); requestSave();
    },
    setMarker: (pos, color) => { marker = pos ? pos.clone() : null; minimap.setObjective(marker, color); },
    checkpoint: (pos, yaw, label = 'Checkpoint — the timeline remembers this moment.') => {
      player.setCheckpoint(pos, yaw); requestSave();
      runStats.checkpoint();
      if (label) ui.message(label, 2200);
      audio.play('checkpoint', { volume: 0.5 });
    },
    penalize: (seconds, reason) => {
      if (ui.dialogue.active && !ui.panelOpen) return;
      stability = Math.max(0, stability - seconds);
      if (reason) ui.message(`${reason}  (−${seconds}s stability)`, 2600);
    },
    hurt: (opts = {}) => {
      if (state !== 'playing' || ui.dialogue.active) return;
      if (player.hurt(opts)) {
        stats.shocks++;
        runStats.shock();
        ui.damage();
        audio.play('zap', { volume: 0.9 });
        if (opts.penalty) api.penalize(opts.penalty, opts.reason);
        if (opts.respawn) { unsafeFor = .6; after(450, () => player.reset()); }
      }
    },
    sound: (name, opts) => { if (!restoring) audio.play(name, opts); },
    positional: (name, obj, opts) => { const h = audio.positional(name, obj, opts); levelDisposables.push(h); return h; },
    journal: (html, key) => { ui.addJournal(html, key); requestSave(); },
    reader: (opts) => ui.openReader(opts),
    keypad: (onSubmit) => ui.openKeypad(onSubmit),
    powerGrid: (controller) => ui.openPowerGrid(controller),
    grantFlashlight: () => { player.addFlashlight(); },
    flashlight: () => player.getFlashlightState(flashState),
    enableDash: () => { player.canDash = true; },
    shake: (n) => player.shake(n),
    completeLevel: (corePos) => beginCoreSequence(corePos),
    get sun() { return sun; },
    get sky() { return sky; },
  };

  /* ------------------------------ disposal ----------------------------------- */
  // Silent statistics: every clue she interacts with counts once per level mount.
  player.addEventListener('interact', (e) => {
    if (e.object?.userData?.interaction?.kind === 'clue') runStats.clue(e.object);
  });

  function disposeObject(root, dispose) {
    if (root.userData?.persistent) return;
    root.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        dispose(o.geometry);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || assets.isShared(m)) continue;
          for (const value of Object.values(m)) if (value?.isTexture) dispose(value);
          dispose(m);
        }
        if (o.isInstancedMesh) dispose(o);
      }
      if (o.isSkinnedMesh) dispose(o.skeleton);
      if (o.isLight) dispose(o.shadow);
    });
  }

  function unload() {
    ++mountToken; warming = false; unsafeFor = 0;
    audio.stopEffects();
    timers.length = 0;
    cinematic = null;
    pending = null;
    ui.resetTransient();
    const disposed = new Set();
    const dispose = (resource) => {
      if (!resource?.dispose || assets.isShared(resource) || disposed.has(resource)) return;
      disposed.add(resource);
      resource.dispose();
    };
    // Disconnect audio before removing its owning objects.
    for (const d of levelDisposables.splice(0)) dispose(d);
    if (level) {
      for (const o of level.objects) disposeObject(o, dispose);
      for (const l of level.lights) disposeObject(l, dispose);
      for (const d of level.disposables) dispose(d);
    }
    levelGroup.clear();
    if (sky) { scene.remove(sky.mesh); sky.dispose(); sky = null; }
    if (envRT) { envRT.dispose(); envRT = null; }
    if (sun) { scene.remove(sun, sun.target); sun.dispose(); sun = null; }
    scene.environment = null;
    scene.fog = null;
    player.clearAttachments();
    level = null;
    hintFn = null;
    checklistFn = null;
    shownTutorials.clear();
    spokenLines.clear();
    ui.setChecklist(null);
    ui.hideTutorial();
    marker = null;
    minimap.setObjective(null);
  }

  /* ------------------------------ loading ------------------------------------ */
  /**
   * Mount an era. opts.title → title-screen backdrop; opts.cutscene → mounted
   * but frozen (no countdown, no era card) until startPlay().
   */
  function load(i, opts = {}) { if (opts.title) runActive = false; mount(LEVELS[i], LEVELS[i].meta, i, opts); }

  /** Mount a non-playable cutscene set (src/levels/prologue.js). */
  function loadSet(mod, variant = 'night') {
    player.mode = 'third';
    const m = variant === 'morning' ? mod.metaMorning : mod.meta;
    mount(mod, m, m.eraIndex ?? 1, { cutscene: true, variant });
    return level;
  }

  function mount(mod, levelMeta, i, { title = false, cutscene = false, variant, saved = null, previousTabletCode = null, journal = ui.journal } = {}) {
    unload();
    index = i;
    meta = levelMeta;
    time = 0;
    runStats.beginEra(i);
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
    level = mod.build(kit, api, { variant, save: saved?.puzzle, journal, previousTabletCode });
    for (const o of level.objects) levelGroup.add(o);
    for (const l of level.lights) levelGroup.add(l);

    // The persistent Time Machine joins every era's physics. The kit's arrays
    // are live (levels add/remove colliders at runtime, e.g. barriers), so the
    // player is handed those exact arrays.
    const tm = timeMachine.getPhysics();
    kit.colliders.push(...tm.colliders);
    kit.cameraColliders.push(...tm.colliders);
    kit.walkables.push(...tm.walkables);
    player.setLevel({
      colliders: kit.colliders, cameraColliders: kit.cameraColliders, walkables: kit.walkables, interactables: kit.interactables,
      spawn: level.spawn, spawnYaw: level.spawnYaw ?? 0, bounds: level.bounds ?? 120,
      killY: level.killY ?? -14, surface: meta.surface,
    });
    player.canDash = !!level.dash;      // false in Future V7: two jumps replace Q dash
    player.canSprintLeap = i === 2;     // Future-only: W/Up+Space normal, Shift+W/Up+Space BIG
    level.prepare?.();
    level.applyQuality?.(q);

    timeMachine.setEra(i);
    player.hero.setGauntletColor(meta.accent);
    postfx.setEra(i);
    minimap.setAccent(meta.accent);
    ui.setEra(i, meta.name);
    ui.setDistanceMapEnabled(false); // New level: hints are opt-in again.
    ui.setObjective(meta.objective);
    ui.setHint('');
    stabilityMax = meta.stability;
    stability = stabilityMax;
    audio.playMusic(title ? 'title' : meta.music);
    audio.setAmbience(meta.ambience);
    state = title ? 'title' : cutscene ? 'cutscene' : 'playing';
    stateTime = 0;
    if (saved) {
      level.restore(saved.puzzle);
      stability = saved.stability;
      saved.tutorials.forEach(k => shownTutorials.add(k)); saved.spoken.forEach(k => spokenLines.add(k));
      ui.setObjective(saved.objective);
      if (saved.checkpoint.active) player.setCheckpoint(new THREE.Vector3().fromArray(saved.checkpoint.position), saved.checkpoint.yaw);
      scene.updateMatrixWorld(true);
    }
    // Compile hidden reward materials too. Light objects stay mounted at zero
    // intensity, so turning on a torch/power cannot create new light variants.
    if (renderer.compileAsync || renderer.compile) {
      const token = mountToken;
      warming = true; ui.show('timeline-loading');
      scene.updateMatrixWorld(true);
      if (renderer.initTexture) {
        const textures = new Set();
        scene.traverse(o => {
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of materials) {
            if (!m) continue;
            for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
            for (const uniform of Object.values(m.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
          }
        });
        for (const texture of textures) if (!texture.isRenderTargetTexture) renderer.initTexture(texture);
      }
      const compile = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
      Promise.resolve(compile).catch(e => console.error('Shader warm-up failed', e)).finally(() => {
        if (token !== mountToken) return;
        warming = false; ui.hide('timeline-loading');
      });
    }
    if (!title && !cutscene) {
      startPlay();
    }
    if (callbacks.onLoaded) callbacks.onLoaded(i);
  }

  /** Era transition card: level meta + that era's story card (src/story.js). */
  function showEraCard() {
    const c = ERA_CARDS[index] || {};
    ui.eraCard({ numeral: meta.numeral, title: meta.title, sub: meta.subtitle, tag: meta.name, verb: c.verb, line: c.line });
  }

  /** After a cutscene: hand control to the player and start the era's clock. */
  function startPlay({ arrival = false } = {}) {
    state = 'arrival';
    stateTime = 0;
    player.frozen = true;
    player._clearKeys();
    showEraCard();
    if (arrival && callbacks.onEraArrive) callbacks.onEraArrive(index);
    ui.afterDialogue(() => {
      state = 'playing';
      stateTime = 0;
      player.frozen = false;
      requestSave();
      if (meta.introCard) after(600, () => api.tutorial('intro', meta.introCard, 16));
    });
  }

  /* ------------------------------ core → next era ---------------------------- */
  function beginCoreSequence() {
    if (state !== 'playing') return;
    // Commit this level's final, measured statistics before the transition.
    const snap = level.snapshot();
    const cluesTotal = level.interactables.filter((o) => o.userData.interaction?.kind === 'clue').length;
    const reached = snap.state?.reached;
    runStats.complete(index, {
      puzzles: countPuzzles(index, snap.state),
      cluesTotal,
      extras: index === 2 && Array.isArray(reached) ? {
        sections: reached.filter(Boolean).length,
        sectionsTotal: reached.length,
        collapseSurvived: !!snap.state.collapseComplete,
      } : null,
    });
    // Commit the core milestone at a consistent checkpoint before any teleport.
    saveGame({ silent: true, checkpointOnly: true });
    state = 'transition';
    stateTime = 0;
    pending = { phase: 'dialogue', next: index + 1 };
    player.frozen = true;
    player._clearKeys();
    ui.afterDialogue(() => {
      pending.phase = 'out';
      stateTime = 0;
      audio.play('core-get', { volume: 0.9 });
      audio.duck(0.25, 3);
      ui.message(index < 2 ? 'The core is yours — the Time Machine calls it home…' : 'The final core! Hold on — the machine is pulling you back…', 3000);
    });
  }

  function fail(reason) {
    if (state !== 'playing') return;
    state = 'failing';
    ui.stopSay();
    stateTime = 0;
    player.frozen = true;
    player.hero.play('death', { hold: true });
    audio.play('fail', { volume: 0.8 });
    audio.stopMusic(1);
    pending = { reason };
  }

  function retryEra() {
    stats.rewinds++;
    runStats.rewind();
    player.frozen = false;
    postfx.u.uFlash.value = 0;
    postfx.u.uWarp.value = 0;
    timeMachine.setWarp(0);
    // Level 1 has no earlier era's clues to retain. Clear the entire journal,
    // including entries from older saves that may use different clue keys.
    // Its fresh puzzle and empty journal are saved together below.
    const oldCode = index === 0 ? level.snapshot().code : null;
    if (index === 0) ui.resetJournal();
    // Cores earned in this era are lost; earlier eras keep theirs.
    eraProgress[index] = null;
    load(index, { previousTabletCode: oldCode });
    requestSave();
    saveGame({ silent: true });
  }

  /** Commit the confirmed new-journey choice before the opening movie. */
  function beginNewJourney() {
    const saved = store.read().save;
    let savedCode = saved?.eras[0]?.puzzle?.code;
    if (!savedCode && saved) {
      const clues = journalTablets(saved.journal);
      const code = [0, 1, 2].map(hour => clues.find(clue => clue.hour === hour)?.glyph);
      if (code.every(Boolean)) savedCode = code;
    }
    previousTabletCode = state !== 'title' && index === 0 && level?.snapshot
      ? level.snapshot().code : savedCode;
    previousTabletCode = previousTabletCode ? [...previousTabletCode] : null;
    runActive = false; dirty = false; eraProgress = [null, null, null];
    ui.resetJournal();
    const result = store.clear();
    if (!result.ok) ui.savedNotice(result.reason, true);
  }

  function restartRun(opts = {}) {
    if (!previousTabletCode && state !== 'title' && index === 0 && level?.snapshot) {
      previousTabletCode = level.snapshot().code;
    }
    eraProgress = [null, null, null]; runActive = true; dirty = false;
    if (!opts.cutscene) ui.dialogue.resetJourney();
    timeMachine.reset();
    stats.runTime = 0; stats.falls = 0; stats.rewinds = 0; stats.shocks = 0;
    runStats.reset();
    _walkFrom.set(Infinity, 0, Infinity);
    ui.setCores(0);
    player.hero.setCores(0);
    ui.resetJournal();
    player.frozen = false;
    postfx.u.uFlash.value = 0;
    postfx.u.uWarp.value = 0;
    load(0, { ...opts, previousTabletCode });
    previousTabletCode = null;
    requestSave();
    if (!opts.cutscene) player.mode = settings.get('thirdPerson') ? 'third' : 'first';
  }

  function startFinale() {
    state = 'finale';
    ui.hide('hud');
    ui.cinema(true);
    ui.clearMessage();
    stateTime = 0;
    player.frozen = true;
    player.mode = 'third';
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
    if (warming) return;
    saveClock += dt;
    unsafeFor = Math.max(0, unsafeFor - dt);
    if (runActive && state === 'playing' && !restoring) {
      if ((dirty && saveClock - dirtyAt >= .35 && saveClock - lastSaved >= 1) || saveClock - lastSaved > 20)
        saveGame({ silent: !dirty });
    }
    // All required reading pauses hazards, platform motion, countdowns and penalties.
    if (state === 'playing' && ui.dialogue.active) return;
    time += dt;
    stateTime += dt;
    if (state === 'playing') {
      for (let i = timers.length - 1; i >= 0; i--) {
        const timer = timers[i];
        timer.remaining -= dt;
        if (timer.remaining <= 0) { timers.splice(i, 1); timer.fn(); }
      }
    }
    if (state === 'playing' && ui.dialogue.active) return;
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

    if (state === 'playing' || state === 'title' || state === 'cutscene') {
      if (level && level.update) level.update(dt, time);
    }

    if (state === 'playing' && !ui.dialogue.active) {
      stats.runTime += dt;
      runStats.tick(dt);
      const dx = player.position.x - _walkFrom.x;
      const dz = player.position.z - _walkFrom.z;
      const walked = Math.hypot(dx, dz);
      if (walked < 5) runStats.walk(walked);   // large jumps are teleports, not steps
      _walkFrom.copy(player.position);
      stability -= dt;
      const frac = stability / stabilityMax;
      ui.setStability(frac, stability);
      postfx.u.uGlitch.value = frac < 0.25 ? (0.25 - frac) * 4 * (0.5 + 0.5 * Math.sin(time * 2.3)) : 0;
      if (hintFn) ui.setHint(typeof hintFn === 'function' ? hintFn() : hintFn);
      if (checklistFn) ui.setChecklist(checklistFn());
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
        timeMachine.setWarp(u.uWarp.value);       // the ground ripple charges with the jump
        u.uFlash.value = THREE.MathUtils.smoothstep(stateTime, 0.9, 1.5);
        if (!pending.sfx) { pending.sfx = true; audio.play('warp', { volume: 0.9 }); }
        if (stateTime > 1.55) {
          const finishing = index === LEVELS.length - 1;
          if (finishing) {
            u.uWarp.value = 0.6;
            startFinale();
          } else {
            eraProgress[index] = captureEra();
            const done = index;
            timeMachine.lightSocket(done);
            const cores = timeMachine.getCores();
            ui.setCores(cores);
            player.hero.setCores(cores);
            player.frozen = false;
            load(pending.next, { cutscene: true });
            player.frozen = true;
            state = 'transition';
            pending = { phase: 'in' };
            stateTime = 0;
          }
        }
      } else if (pending.phase === 'in') {
        u.uWarp.value = Math.max(0, 1 - stateTime / 1.6);
        timeMachine.setWarp(u.uWarp.value);       // and settles as the new era firms up
        u.uFlash.value = Math.max(0, 1 - stateTime / 0.9);
        if (stateTime > 1.6) {
          u.uWarp.value = 0;
          u.uFlash.value = 0;
          startPlay({ arrival: true });
        }
      }
    }

    if (state === 'finale') {
      const u = postfx.u;
      u.uWarp.value = Math.max(0, 0.6 - stateTime * 0.6) + THREE.MathUtils.smoothstep(stateTime, 5.2, 6.4) * 0.8;
      timeMachine.setWarp(THREE.MathUtils.smoothstep(stateTime, 5.2, 6.4));   // final surge ripples out (restoring drives the rest)
      u.uFlash.value = THREE.MathUtils.smoothstep(stateTime, 5.4, 6.4);
      if (stateTime > 1.5 && !pending.cheered) { pending.cheered = true; player.hero.play('cheer', { hold: true }); }
      if (stateTime > 6.6) finishFinale();
    }
  }

  function finishFinale() {
    if (state !== 'finale') return;
    state = 'won';
    saveGame({ silent: true, completed: true, checkpointOnly: true });
    cinematic = null; ui.cinema(false);
    postfx.u.uFlash.value = postfx.u.uWarp.value = 0;
    timeMachine.setWarp(0); player.unlock();
    if (callbacks.onFinale) callbacks.onFinale({ ...stats });
  }

  function captureEra() {
    const cp = player.getCheckpoint();
    return { puzzle: level.snapshot(), checkpoint: { position: (cp?.position || player.spawn).toArray(),
      yaw: cp?.yaw ?? player.spawnYaw, active: !!cp }, stability,
      tutorials: [...shownTutorials], spoken: [...spokenLines],
      objective: ui._cache.objectivetext || meta.objective,
      label: level.checkpointLabel?.() || meta.title };
  }

  function saveGame({ silent = false, completed = false, checkpointOnly = false } = {}) {
    if (!runActive || restoring || !level?.snapshot || unsafeFor > 0 ||
        (!completed && !['playing', 'arrival'].includes(state)))
      return { ok: false, reason: 'Wait for a safe moment in the era before saving.' };
    eraProgress[index] = captureEra();
    const save = { version: SAVE_VERSION, savedAt: Date.now(), status: completed ? 'complete' : 'active',
      era: index, cores: completed ? 3 : index, eras: eraProgress,
      player: player.savePose(checkpointOnly || index === 2), stats: { ...stats },
      runStats: runStats.snapshot(),
      journal: ui.journal.map(j => ({ ...j })), dialogue: ui.dialogue.snapshot() };
    const result = store.write(save);
    // A failed autosave is retried at the periodic interval, never every frame.
    lastSaved = saveClock; dirty = false;
    if (!silent || !result.ok) ui.savedNotice(result.ok ? 'Timeline Saved' : result.reason, !result.ok);
    return result;
  }

  function continueJourney(save = store.read().save) {
    if (!validateSave(save)) return false;
    restoring = true; runActive = true; dirty = false;
    eraProgress = JSON.parse(JSON.stringify(save.eras));
    Object.assign(stats, save.stats);
    runStats.restore(save.runStats);
    _walkFrom.set(Infinity, 0, Infinity);   // ignore the resume teleport
    timeMachine.reset();
    let target = save.era;
    let completed = save.status === 'complete';
    // Closing during core collection resumes at the next safe era boundary.
    if (eraProgress[target].puzzle.state.coreTaken) {
      if (target < 2) target++; else completed = true;
    }
    const cores = completed ? 3 : target;
    for (let i = 0; i < cores; i++) timeMachine.lightSocket(i);
    ui.setCores(cores); player.hero.setCores(cores);
    postfx.u.uFlash.value = postfx.u.uWarp.value = postfx.u.uGlitch.value = 0;
    timeMachine.setWarp(0);
    const saved = eraProgress[target];
    load(target, { cutscene: true, saved, journal: save.journal });
    ui.journal = save.journal.map(j => ({ ...j })); ui._renderJournal();
    player.frozen = false;
    scene.updateMatrixWorld(true);
    if (saved) player.restorePose(save.player);
    else { player.mode = save.player.mode; player.reset(); }
    state = completed ? 'won' : 'playing'; stateTime = 0;
    ui.dialogue.instructed = save.dialogue.instructed;
    if (!completed && target === save.era) ui.dialogue.restore(save.dialogue);
    if (!completed && !shownTutorials.has('intro') && meta.introCard) api.tutorial('intro', meta.introCard);
    if (!completed && target !== save.era) startPlay({ arrival: true });
    if (checklistFn) ui.setChecklist(checklistFn());
    if (hintFn) ui.setHint(typeof hintFn === 'function' ? hintFn() : hintFn);
    ui.setStability(stability / stabilityMax, stability);
    restoring = false; requestSave();
    if (completed) saveGame({ silent: true, completed: true, checkpointOnly: true });
    return { completed };
  }

  /** Called after player.update so cinematics can take the camera. */
  function updateCamera(dt) { if (cinematic) cinematic(dt, time); }

  return {
    api,
    readSave: () => store.read(), saveGame, continueJourney, skipFinale: finishFinale,
    get warming() { return warming; },
    get stability() { return stability; },
    requestSave,
    applyQuality() {
      const q = settings.quality();
      if (sun) { sun.castShadow = q.shadows; sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize); }
      if (player.flashlight) player.flashlight.castShadow = q.shadows;
      level?.applyQuality?.(q);
    },
    load,
    beginNewJourney,
    loadSet,
    startPlay,
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
    get level() { return level; },
    registerFall() {
      if (ui.dialogue.active) return;
      stats.falls++;
      runStats.fall();
      api.penalize(meta?.fallPenalty ?? 15, 'You slipped out of time');
      audio.play('warp', { volume: 0.5 });
      player.reset();
    },
    runStats,
  };
}
