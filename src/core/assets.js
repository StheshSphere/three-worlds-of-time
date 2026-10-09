import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/**
 * Central asset cache. Everything is preloaded once behind the loading
 * screen (real progress, not a fake timer), so era transitions never hitch.
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
    hero: 'models/hero/time-traveller.glb',
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
   */
  async loadAll(audioContext, onProgress) {
    const manager = new THREE.LoadingManager();
    const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const texLoader = new THREE.TextureLoader(manager);
    const fileLoader = new THREE.FileLoader(manager).setResponseType('arraybuffer');

    const jobs = [];
    let done = 0;
    const total = MANIFEST.textures.length * 3 + Object.keys(MANIFEST.models).length + MANIFEST.music.length + MANIFEST.sfx.length;
    const tick = (label) => { done++; if (onProgress) onProgress(done / total, label); };

    for (const name of MANIFEST.textures) {
      const set = {};
      for (const map of ['color', 'normal', 'arm']) {
        jobs.push(texLoader.loadAsync(`${BASE}textures/${name}/${map}.webp`).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = anisotropy;
          set[map] = t;
        }).catch((e) => console.warn('[assets] texture', name, map, e)).finally(() => tick(`texture ${name}`)));
      }
      textures.set(name, set);
    }

    for (const [name, url] of Object.entries(MANIFEST.models)) {
      jobs.push(gltfLoader.loadAsync(BASE + url).then((g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { if (m && m.map) m.map.anisotropy = anisotropy; });
          }
        });
        gltfs.set(name, g);
      }).catch((e) => console.warn('[assets] model', name, e)).finally(() => tick(`model ${name}`)));
    }

    const decode = (name, url) => fileLoader.loadAsync(url)
      .then((buf) => audioContext.decodeAudioData(buf))
      .then((ab) => audio.set(name, ab))
      .catch((e) => console.warn('[assets] audio', name, e))
      .finally(() => tick(`audio ${name}`));
    for (const m of MANIFEST.music) jobs.push(decode(`music:${m}`, `${BASE}audio/music/${m}.ogg`));
    for (const s of MANIFEST.sfx) jobs.push(decode(s, `${BASE}audio/sfx/${s}.ogg`));

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
