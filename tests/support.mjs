import { registerHooks } from 'node:module';
import * as THREE from '../libs/three/three.module.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return nextResolve(new URL('./three-test.mjs', import.meta.url).href, context);
  if (specifier.startsWith('three/addons/')) {
    return nextResolve(new URL('../libs/three/addons/' + specifier.slice('three/addons/'.length), import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
} });

// Canvas drawing is not under test. The real level still creates its scene,
// textures, glyphs and interactions, while no GPU or browser session is needed.
const nodes = new Map();
const noop = () => {};
function canvas() {
  const context = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (String(key).includes('Gradient')) return () => ({ addColorStop: noop });
    return noop;
  } });
  return { width: 1, height: 1, getContext: () => context, toDataURL: () => 'data:image/png;base64,AA==' };
}
globalThis.document = {
  createElement: tag => tag === 'canvas' ? canvas() : { className: '', textContent: '', innerHTML: '' },
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {
      children: [], content: '',
      set innerHTML(value) { this.content = value; this.children = []; },
      get innerHTML() { return this.content; },
      appendChild(child) { this.children.push(child); },
      classList: { add: noop, remove: noop, toggle: noop },
    });
    return nodes.get(id);
  },
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
globalThis.localStorage = {
  values: new Map(), getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
};

const { createKit } = await import('../src/core/kit.js');
const { build } = await import('../src/levels/ancientRuins.js');
const { UI } = await import('../src/core/ui.js');
const { createLevelManager } = await import('../src/levelManager.js');

export { THREE, UI };
export const permutations = values => values.length === 0 ? [[]] : values.flatMap((value, i) =>
  permutations(values.filter((_, j) => j !== i)).map(rest => [value, ...rest]));

export function makePlayer() {
  const player = new THREE.EventDispatcher();
  Object.assign(player, {
    position: new THREE.Vector3(0, 0, 9), spawn: new THREE.Vector3(0, 0, 9), spawnYaw: 0,
    yaw: 0, pitch: 0, mode: 'third', flashlightOn: false,
    hero: { setCores: noop, setGauntletColor: noop, play: noop },
    clearAttachments: noop, _clearKeys: noop, shake: noop, unlock: noop, prepareFlashlight: noop,
    setLevel(level) { this.spawn.copy(level.spawn); this.spawnYaw = level.spawnYaw; this.position.copy(level.spawn); this.cp = null; },
    setCheckpoint(position, yaw) { this.cp = { position: position.clone(), yaw }; },
    getCheckpoint() { return this.cp; },
    savePose() { return { position: this.position.toArray(), yaw: this.yaw, pitch: this.pitch, mode: this.mode, flashlightOn: false }; },
    restorePose(pose) { this.position.fromArray(pose.position); this.yaw = pose.yaw; this.pitch = pose.pitch; this.mode = pose.mode; },
    reset() { this.position.copy(this.cp?.position || this.spawn); },
  });
  return player;
}

export function makeUI() {
  const ui = Object.create(UI.prototype);
  Object.assign(ui, {
    audio: { play: noop }, journal: [], stack: [], _cache: {},
    dialogue: { active: false, instructed: false, resetJourney: noop,
      snapshot() { return { instructed: false, entries: [] }; }, restore: noop },
    resetTransient: noop, show: noop, hide: noop, setCores: noop, setEra: noop,
    setDistanceMapEnabled: noop, setChecklist: noop, setHint: noop, setStability: noop,
    hideTutorial: noop, tutorial: noop, say: noop, message: noop, savedNotice: noop,
    eraCard: noop, afterDialogue: callback => callback(),
    setObjective(text) { this._cache.objectivetext = text; },
  });
  return ui;
}

export function makeLevel(options = {}) {
  const ui = makeUI();
  const player = makePlayer();
  const scene = new THREE.Scene();
  const api = {
    quality: { grass: 0.1, shadows: false }, scene,
    sky: { sunDir: new THREE.Vector3(0, 1, 0) }, player,
    completed: 0, sound: noop, message: noop, progress: noop, setHint: noop,
    setChecklist: noop, setMarker: noop, setObjective: noop, checkpoint: noop,
    tutorial: noop, say: noop, shake: noop,
    journal: (html, key) => ui.addJournal(html, key),
    completeLevel() { this.completed++; },
    positional: () => ({ dispose: noop }),
  };
  const kit = createKit({ api, quality: api.quality, renderer: {} });
  const level = build(kit, api, options);
  return { level, api, ui, dispose() { level.disposables.forEach(resource => resource.dispose?.()); } };
}

export function makeManager() {
  const ui = makeUI(), player = makePlayer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  let coreCount = 0;
  const timeMachine = { reset() { coreCount = 0; }, lightSocket() { coreCount++; }, getCores: () => coreCount, setWarp: noop, setEra: noop,
    getPhysics: () => ({ colliders: [], cameraColliders: [], walkables: [] }) };
  const audio = { stopEffects: noop, playMusic: noop, setAmbience: noop, play: noop, duck: noop,
    positional: () => ({ dispose: noop }) };
  const postfx = { setEra: noop, u: { uFlash: { value: 0 }, uWarp: { value: 0 }, uGlitch: { value: 0 } } };
  const minimap = { setObjective: noop, setAccent: noop };
  const levels = createLevelManager({ scene, camera, renderer: {}, ui, player, timeMachine, audio, postfx, minimap });
  return { levels, ui, player, scene };
}
