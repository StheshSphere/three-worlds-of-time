import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/**
 * Central asset cache. Everything is preloaded once behind the loading
 * screen (byte-weighted real progress — see loadAll), so era transitions
 * never hitch.
 *
 * Disposal model: levels CLONE what they use. When a level unloads, the
 * level manager disposes the clones' geometries/materials/textures — that
 * frees the GPU copies only. The decoded source data stays in this cache, and
 * three.js transparently re-uploads it the next time a clone is rendered
 * (e.g. after "Restart journey"). Memory therefore stays flat across the
 * three levels instead of climbing (brief §6.1).
 *
 * Paths are relative to index.html — never absolute (brief §6.2).
 */
const BASE = './assets/';

export const MANIFEST = {
  textures: [
    'forrest-ground-01', 'grassy-cobblestone', 'stone-floor', 'mossy-sandstone',
    'sandstone-blocks-08', 'rock-wall-10', 'floor-tiles-08', 'rubber-tiles',
    'plastered-wall-04', 'concrete-panels', 'metal-plate', 'metal-plate-02',
  ],
  models: {
    hero: 'models/hero/scientist.glb',
    // the Past
    'rock-moss-set-01': 'models/ruins/rock-moss-set-01.glb',
    'rock-moss-set-02': 'models/ruins/rock-moss-set-02.glb',
    'fern-02': 'models/ruins/fern-02.glb',
    'shrub-02': 'models/ruins/shrub-02.glb',
    'gothic-statue': 'models/ruins/gothic-statue.glb',
    'lion-head': 'models/ruins/lion-head.glb',
    'antique-ceramic-vase-01': 'models/ruins/antique-ceramic-vase-01.glb',
    'large-iron-gate': 'models/ruins/large-iron-gate.glb',
    'tree-stump-01': 'models/ruins/tree-stump-01.glb',
    'dead-tree-trunk': 'models/ruins/dead-tree-trunk.glb',
    // the Present
    'metal-office-desk': 'models/lab/metal-office-desk.glb',
    'steel-frame-shelves-01': 'models/lab/steel-frame-shelves-01.glb',
    'chemistry-set': 'models/lab/chemistry-set.glb',
    'industrial-microscope': 'models/lab/industrial-microscope.glb',
    'bunsen-burner': 'models/lab/bunsen-burner.glb',
    'circuit-board': 'models/lab/circuit-board.glb',
    'classic-laptop': 'models/lab/classic-laptop.glb',
    'security-camera-01': 'models/lab/security-camera-01.glb',
    'hanging-industrial-lamp': 'models/lab/hanging-industrial-lamp.glb',
    'portable-generator': 'models/lab/portable-generator.glb',
    'power-box-01': 'models/lab/power-box-01.glb',
    'drawer-cabinet': 'models/lab/drawer-cabinet.glb',
    'metal-tool-chest': 'models/lab/metal-tool-chest.glb',
    'standing-chalkboard-01': 'models/lab/standing-chalkboard-01.glb',
    'korean-fire-extinguisher-01': 'models/lab/korean-fire-extinguisher-01.glb',
    clipboard: 'models/lab/clipboard.glb',
    'cardboard-box-01': 'models/lab/cardboard-box-01.glb',
    'wetfloorsign-01': 'models/lab/wetfloorsign-01.glb',
    'vintage-grandfather-clock-01': 'models/lab/vintage-grandfather-clock-01.glb',
    'schoolchair-01': 'models/lab/schoolchair-01.glb',
    'utility-box-01': 'models/lab/utility-box-01.glb',
    'modular-pipes': 'models/lab/modular-pipes.glb',
  },
  music: ['title', 'ruins', 'lab', 'neon'],
  sfx: [
    'step-grass-0', 'step-grass-1', 'step-grass-2', 'step-grass-3',
    'step-stone-0', 'step-stone-1', 'step-stone-2', 'step-stone-3',
    'step-metal-0', 'step-metal-1', 'step-metal-2', 'step-metal-3',
    'land', 'stone-slide', 'stone-thud', 'bell', 'glass', 'metal-clank',
    'ui-hover', 'ui-click', 'ui-open', 'ui-close', 'ui-error', 'ui-confirm',
    'keypad', 'glitch', 'pickup', 'rune', 'door-open', 'door-close', 'force-field',
    'zap', 'dash', 'power-up', 'computer', 'warp', 'crumble', 'hum', 'gate', 'creak',
    'lever', 'page', 'switch', 'core-get', 'fail', 'win', 'checkpoint',
  ],
  /** Member 2 · the Present — optional era-specific cues from audio/modern-lab/.
   *  Registered as 'modern-lab:<name>'; a missing file is skipped silently. */
  'modern-lab': ['keypad-ok', 'keypad-deny', 'breaker-ok', 'breaker-deny', 'power-restored', 'core-pickup', 'generator-hum'],
};

const textures = new Map();   // name -> { color, normal, arm }
const gltfs = new Map();      // name -> gltf
const audio = new Map();      // name -> AudioBuffer

let anisotropy = 4;

export const assets = {
  setAnisotropy(a) { anisotropy = a; },

  /**
   * Load everything in MANIFEST. onProgress(fraction, label) drives the
   * loading bar. Individual failures are logged, not fatal — a missing prop
   * must never stop the game from starting.
   *
   * Progress is real, never simulated: every in-flight download reports the
   * bytes it has actually received (the loaders' onProgress `{loaded, total}`),
   * and a job only counts as done when its promise settles. If a response
   * has no byte total (no Content-Length), that job simply waits at its last
   * known value instead of guessing.
   */
  async loadAll(audioContext, onProgress) {
    const manager = new THREE.LoadingManager();
    const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const texLoader = new THREE.TextureLoader(manager);
    const fileLoader = new THREE.FileLoader(manager).setResponseType('arraybuffer');

    const jobs = [];
    let done = 0;
    const total = MANIFEST.textures.length * 3 + Object.keys(MANIFEST.models).length + MANIFEST.music.length + MANIFEST.sfx.length + MANIFEST['modern-lab'].length;

    // Bar = finished jobs + the real byte share of every in-flight download,
    // over the job count. Jobs without progress events (images decode in one
    // step) stay put until they complete — the bar never invents movement.
    const received = new Map();            // url → 0..1 share of that file's bytes
    const report = (label) => {
      let live = 0;
      for (const f of received.values()) live += f;
      if (onProgress) onProgress(Math.min((done + live) / total, 1), label);
    };
    const track = (url, ev) => {
      // Cap at 0.99: only tick() may finish a job, never byte count alone.
      if (received.has(url) && ev.total > 0) received.set(url, Math.min(ev.loaded / ev.total, 0.99));
    };
    const tick = (url, label) => { received.delete(url); done++; report(label); };

    for (const name of MANIFEST.textures) {
      const set = {};
      for (const map of ['color', 'normal', 'arm']) {
        const url = `${BASE}textures/${name}/${map}.webp`;
        received.set(url, 0);
        jobs.push(texLoader.loadAsync(url, (ev) => track(url, ev)).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = anisotropy;
          set[map] = t;
        }).catch((e) => console.warn('[assets] texture', name, map, e)).finally(() => tick(url, `texture ${name}`)));
      }
      textures.set(name, set);
    }

    for (const [name, url] of Object.entries(MANIFEST.models)) {
      const file = BASE + url;
      received.set(file, 0);
      jobs.push(gltfLoader.loadAsync(file, (ev) => track(file, ev)).then((g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { if (m && m.map) m.map.anisotropy = anisotropy; });
          }
        });
        gltfs.set(name, g);
      }).catch((e) => console.warn('[assets] model', name, e)).finally(() => tick(file, `model ${name}`)));
    }

    const decode = (name, url) => {
      received.set(url, 0);
      return fileLoader.loadAsync(url, (ev) => track(url, ev))
        .then((buf) => audioContext.decodeAudioData(buf))
        .then((ab) => audio.set(name, ab))
        .catch((e) => console.warn('[assets] audio', name, e))
        .finally(() => tick(url, `audio ${name}`));
    };
    for (const m of MANIFEST.music) jobs.push(decode(`music:${m}`, `${BASE}audio/music/${m}.ogg`));
    for (const s of MANIFEST.sfx) jobs.push(decode(s, `${BASE}audio/sfx/${s}.ogg`));
    // Member 2 · optional Lab cues — a missing file is skipped silently (no
    // console warning): the Lab is fully audible on the shared sounds alone.
    const decodeOptional = (name, url) => {
      received.set(url, 0);
      return fileLoader.loadAsync(url, (ev) => track(url, ev))
        .then((buf) => audioContext.decodeAudioData(buf))
        .then((ab) => audio.set(name, ab))
        .catch(() => { /* file not supplied yet — play without it */ })
        .finally(() => tick(url, `audio ${name}`));
    };
    for (const s of MANIFEST['modern-lab']) jobs.push(decodeOptional(`modern-lab:${s}`, `${BASE}audio/modern-lab/${s}.ogg`));

    await Promise.all(jobs);
  },

  /** PBR set { color, normal, arm } — arm = AO (R), roughness (G), metalness (B). */
  texSet(name) { return textures.get(name); },

  gltf(name) { return gltfs.get(name); },

  /**
   * Deep clone of a prop's scene graph. SkeletonUtils.clone keeps skinned
   * meshes bound to their own cloned skeleton (plain .clone() would not).
   */
  prop(name) {
    const g = gltfs.get(name);
    if (!g) {
      // Visible placeholder rather than a crash if a prop failed to load.
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
      m.name = `missing:${name}`;
      return m;
    }
    return SkeletonUtils.clone(g.scene);
  },

  audio(name) { return audio.get(name); },
  hasAudio(name) { return audio.has(name); },
};
