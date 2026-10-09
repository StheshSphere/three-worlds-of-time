import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { createGrass } from '../shaders/grass.js';
import { createWater } from '../shaders/water.js';
import { createFlame, createParticles, createBeam } from '../shaders/effects.js';
import { GLYPHS, NUMERALS, drawGlyph, glyphDataURL, stoneBackground } from './glyphs.js';

/**
 * LEVEL 1 — THE PAST: "Temple of the First Hour".  Verb: SOLVE.
 *
 * What this level does that the others don't: the WORLD ITSELF is the
 * puzzle — you physically push stone, rotate mirrors to steer sunlight and
 * decode carvings. Nothing is a key or a switch; everything is a mechanism.
 *
 * Route (north = −Z):
 *   Arrival plaza (Time Machine, reflecting pool, jungle)          z  +20 … −12
 *   Courtyard of Weights — push blocks onto two pressure plates    z  −15 … −34
 *   Sun Court — rotate bronze mirrors to steer the sunbeam         z  −34 … −56
 *   The chasm — the lit crystal raises a floating stone bridge     z  −56 … −68
 *   Sanctum — set the three rune drums to the tablets' symbols     z  −68 … −96
 * Three rune tablets are hidden: by the pool, in the courtyard, in the Sun
 * Court. Each shows a glyph and a numeral (its position in the code). The
 * code is randomised every time the era loads (replay value).
 */
export const meta = {
  name: 'The Past',
  numeral: 'I',
  title: 'The Past',
  subtitle: 'Temple of the First Hour',
  objective: 'Find a way into the temple',
  music: 'ruins',
  ambience: 'ruins',
  sky: 'ruins',
  stability: 480,
  accent: 0xffc861,
  surface: 'grass',
  sun: { color: 0xffd9a8, intensity: 3.4, extent: 26 },
  fallPenalty: 15,
};

const TILE = 2;
const COLS = 8;
const ROWS = 7;
const tileX = (c) => -7 + c * TILE;
const tileZ = (r) => -19 - r * TILE;

export function build(kit, api) {
  const q = api.quality;
  const scene = api.scene;
  const sunDir = api.sky.sunDir;
  scene.fog = new THREE.FogExp2(0xd7a77c, 0.0105);
  kit.light(new THREE.HemisphereLight(0xc4d8ff, 0x6a5236, 0.75));

  const M = {
    grass: kit.material('forrest-ground-01', { normalScale: 1.2 }),
    cobble: kit.material('grassy-cobblestone', {}),
    floor: kit.material('stone-floor', {}),
    wall: kit.material('mossy-sandstone', {}),
    dressed: kit.material('sandstone-blocks-08', { tint: 0xf3e2c4 }),
    rock: kit.material('rock-wall-10', { tint: 0xc8b8a0 }),
    bark: kit.material('rock-wall-10', { tint: 0x5b4632, normalScale: 1.5 }),
  };
  const bronze = kit.track(new THREE.MeshStandardMaterial({ color: 0xc08a4a, metalness: 1, roughness: 0.18 }));
  const bronzeDark = kit.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2a, metalness: 1, roughness: 0.45 }));
  const glowGold = kit.track(new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb340, emissiveIntensity: 0, roughness: 0.4 }));

  const state = {
    plates: [false, false], gateOpen: false, crystalLit: false, bridgeBuilt: false,
    tablets: [false, false, false], dialsSolved: false, coreTaken: false,
  };

  /* ===================================================================
     helpers
     =================================================================== */
  function wall(x1, z1, x2, z2, h = 5, t = 1.2, mat = M.wall, y0 = 0) {
    const w = Math.abs(x2 - x1) || t;
    const d = Math.abs(z2 - z1) || t;
    return kit.box({ size: [w, h, d], pos: [(x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2], mat, tile: 2.5, walk: false });
  }

  const columnCache = new Map();
  function columnGeo(h, r) {
    const key = `${h}|${r}`;
    if (columnCache.has(key)) return columnCache.get(key);
    const pts = [];
    pts.push(new THREE.Vector2(r * 1.25, 0), new THREE.Vector2(r * 1.25, 0.22), new THREE.Vector2(r * 1.05, 0.32));
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const y = 0.32 + (i / N) * (h - 0.75);
      const entasis = 1 - 0.12 * (i / N) + 0.04 * Math.sin((i / N) * Math.PI);
      pts.push(new THREE.Vector2(r * entasis, y));
    }
    pts.push(new THREE.Vector2(r * 1.15, h - 0.35), new THREE.Vector2(r * 1.35, h - 0.12), new THREE.Vector2(r * 1.35, h), new THREE.Vector2(0.001, h));
    const g = new THREE.LatheGeometry(pts, 20);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / 2.2, uv.getY(i) * h / 2.2);
    kit.track(g);
    columnCache.set(key, g);
    return g;
  }

  function column(x, z, h = 5.2, r = 0.45, mat = M.dressed, rotY = 0) {
    const m = new THREE.Mesh(columnGeo(h, r), mat);
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    kit.add(m);
    kit.proxy({ size: [r * 2.2, h, r * 2.2], pos: [x, h / 2, z] });
    kit.mapShape(r * 2.2, r * 2.2, x, h, z, 0xd8cfb8);
    return m;
  }

  function brokenColumn(x, z, h, r = 0.45) {
    const c = column(x, z, h, r, M.wall, Math.random() * 6);
    // a fallen drum next to it
    const drum = new THREE.Mesh(columnGeo(1.4, r), M.wall);
    drum.rotation.set(Math.PI / 2, 0, Math.random() * 6);
    drum.position.set(x + (Math.random() - 0.5) * 2.5, r, z + (Math.random() - 0.5) * 2.5);
    drum.castShadow = true;
    kit.add(drum);
    return c;
  }

  const brazierGeo = (() => {
    const pts = [[0.42, 0], [0.42, 0.1], [0.2, 0.18], [0.16, 0.75], [0.22, 0.85], [0.56, 1.02], [0.6, 1.12], [0.5, 1.1], [0.001, 0.98]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 18);
    return kit.track(g);
  })();
  function brazier(x, z) {
    const m = new THREE.Mesh(brazierGeo, bronzeDark);
    m.position.set(x, 0, z);
    m.castShadow = true;
    kit.add(m);
    kit.proxy({ size: [1.1, 1.2, 1.1], pos: [x, 0.6, z] });
    // glowing coals in the bowl
    const coals = new THREE.Mesh(kit.track(new THREE.CircleGeometry(0.48, 18)), kit.track(new THREE.MeshStandardMaterial({ color: 0x220a02, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 1 })));
    coals.rotation.x = -Math.PI / 2;
    coals.position.set(x, 1.06, z);
    kit.add(coals);
  }

  function arch(x, z, width, height, depth, rotY = 0, mat = M.dressed) {
    const g = new THREE.Group();
    const pierW = 1.3;
    const lintelH = 1.1;
    for (const s of [-1, 1]) {
      kit.box({ size: [pierW, height, depth], pos: [s * (width / 2 + pierW / 2), height / 2, 0], mat, tile: 2.5, walk: false, solid: false, parent: g, map: false });
    }
    kit.box({ size: [width + pierW * 2 + 0.4, lintelH, depth + 0.2], pos: [0, height + lintelH / 2, 0], mat, tile: 2.5, walk: false, solid: false, parent: g, map: false });
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    kit.add(g);
    g.updateMatrixWorld(true);
    // Collision boxes only AFTER the group is positioned (solid boxes are world-space).
    g.children.forEach((c, i) => { if (c.isMesh && i < 2) kit.solidFrom(c); });
    return g;
  }

  /* ===================================================================
     terrain: plateau, chasm and sanctum island
     =================================================================== */
  // Main plateau (south of the chasm) and the island (north of it).
  kit.box({ size: [120, 2, 106], pos: [0, -1, -3], mat: M.grass, tile: 4, solid: false, map: false, surface: 'grass' });
  kit.box({ size: [70, 2, 30], pos: [0, -1, -83], mat: M.grass, tile: 4, solid: false, map: false, surface: 'grass' });
  // Cliff faces dropping into the chasm (visual only — you fall past them).
  kit.box({ size: [120, 40, 3], pos: [0, -21.9, -57.5], mat: M.rock, tile: 6, solid: false, walk: false, map: false });
  kit.box({ size: [70, 40, 3], pos: [0, -21.9, -66.5], mat: M.rock, tile: 6, solid: false, walk: false, map: false });
  // Map shapes for the walkable regions.
  kit.mapShape(60, 76, 0, 0, -18, 0x2f3a2a);
  kit.mapShape(34, 28, 0, 0, -82, 0x2f3a2a);

  // Perimeter cliffs enclose the plateau (also the world's edge).
  const cliffs = [
    [-33, -20, 6, 14, 80, 0.06], [33, -18, 6, 16, 80, -0.05], [0, 27, 70, 12, 6, 0],
    [-24, 20, 20, 10, 10, 0.4], [26, 18, 18, 11, 12, -0.3],
    [-24, -84, 6, 13, 30, 0.1], [24, -84, 6, 13, 30, -0.1], [0, -98, 52, 16, 6, 0],
  ];
  for (const [x, z, w, h, d, r] of cliffs) rockMass(kit, M.rock, [w, h, d], [x, h / 2 - 0.5, z], r);

  /* ===================================================================
     A. Arrival plaza
     =================================================================== */
  kit.box({ size: [26, 0.12, 24], pos: [0, 0.06, 1], mat: M.cobble, tile: 3, solid: false, surface: 'stone' });
  kit.box({ size: [5, 0.12, 6], pos: [0, 0.06, -13], mat: M.cobble, tile: 3, solid: false, surface: 'stone' });
  // Ring of broken columns around the plaza.
  const ring = [[-11, 9], [-12, 1], [-11, -7], [11, 9], [12, -7], [-6, 12.5], [6, 12.5]];
  ring.forEach(([x, z], i) => (i % 3 === 1 ? brokenColumn(x, z, 1.6 + (i % 2)) : column(x, z, 5.2 + (i % 2) * 0.6)));
  // Low ruined walls framing the plaza.
  wall(-14, -10, -14, 4, 1.4, 1.0);
  wall(-14, 8, -14, 13, 2.4, 1.0);
  wall(-9, 14, -3, 14, 1.2, 1.0);
  wall(3, 14, 9, 14, 2.0, 1.0);

  // Braziers flanking the machine.
  const flames = [];
  for (const [x, z] of [[-5.2, 6.5], [5.2, 6.5], [-5.2, -5], [5.2, -5]]) {
    brazier(x, z);
    const f = createFlame({ size: 0.95 });
    f.mesh.position.set(x, 1.12, z);
    kit.add(f.mesh);
    kit.track(f);
    flames.push(f);
    const embers = createParticles({ count: 18, center: [x, 1.2, z], box: [0.6, 2.2, 0.6], color: 0xff8a3a, size: 0.05, rise: 0.9 });
    kit.add(embers.mesh);
    kit.track(embers);
    flames.push(embers);
    const l = kit.pointLight(0xff9a4a, 16, 12, [x, 1.9, z]);
    l.userData.base = 14;
    flames.push({ light: l });
  }

  // Reflecting pool with lion-head fountains (east of the plaza).
  const poolX = 18;
  const poolZ = 1;
  kit.box({ size: [11, 0.4, 13], pos: [poolX, -0.45, poolZ], mat: M.floor, tile: 2, solid: false, surface: 'stone' });
  for (const [x1, z1, x2, z2] of [[12.5, -5.5, 12.5, 7.5], [23.5, -5.5, 23.5, 7.5], [12.5, -5.5, 23.5, -5.5], [12.5, 7.5, 23.5, 7.5]]) {
    const w = wall(x1, z1, x2, z2, 0.95, 0.6, M.dressed, -0.25);
    kit.walkables.push(w);       // you can walk along the rim
  }
  const water = createWater(10.4, 12.4, { quality: q, sunDir, scene });
  water.mesh.position.set(poolX, 0.25, poolZ);
  kit.add(water.mesh);
  kit.track(water);
  kit.update((dt, t) => water.update(t));
  // Fountain wall behind the pool, with a walkway between.
  wall(26.5, -9, 26.5, 11, 6.5, 1.2, M.wall);
  kit.box({ size: [3, 0.1, 18], pos: [25, 0.05, 1], mat: M.floor, tile: 2, solid: false, surface: 'stone' });
  const streams = [];
  for (const z of [-2.5, 1, 4.5]) {
    kit.prop('lion-head', { pos: [25.75, 2.4, z], rot: -Math.PI / 2, height: 0.75, solid: false });
    const s = createBeam({ radius: 0.07, color: 0xd8f4ff });
    s.material.uniforms.uIntensity.value = 0.55;
    s.set(new THREE.Vector3(25.3, 2.25, z), new THREE.Vector3(22.6, 0.3, z));
    kit.add(s.mesh);
    kit.track(s);
    streams.push(s);
  }
  kit.update((dt, t) => streams.forEach((s) => s.update(t)));

  // Gothic guardian statues at the temple entrance.
  kit.prop('gothic-statue', { pos: [-3.6, 0, -12.6], rot: Math.PI * 0.08, height: 2.6, inset: 0.15 });
  kit.prop('gothic-statue', { pos: [3.6, 0, -12.6], rot: -Math.PI * 0.08, height: 2.6, inset: 0.15 });
  kit.prop('antique-ceramic-vase-01', { pos: [-8.5, 0, -8.5], height: 0.9, solid: false });
  kit.prop('antique-ceramic-vase-01', { pos: [9.2, 0, 10.6], rot: 1, height: 0.75, solid: false });

  /* ===================================================================
     B. Courtyard of Weights — push-block puzzle on a 2 m grid
     =================================================================== */
  kit.box({ size: [18, 0.1, 19], pos: [0, 0.05, -24.5], mat: M.floor, tile: TILE, solid: false, surface: 'stone' });
  // Walls (south wall has the entrance, north wall holds the Sun Gate).
  wall(-16, -15, -2.2, -15, 5.5, 1.4);
  wall(2.2, -15, 16, -15, 5.5, 1.4);
  wall(-9.6, -15, -9.6, -34, 5.5, 1.2);
  wall(9.6, -15, 9.6, -34, 5.5, 1.2);
  wall(-16, -34.6, -2.2, -34.6, 6, 1.4);
  wall(2.2, -34.6, 16, -34.6, 6, 1.4);
  arch(0, -15, 4.4, 4.2, 1.6);
  arch(0, -34.6, 4.4, 4.2, 1.6);
  for (const z of [-19, -25, -31]) { column(-8.4, z, 5.4, 0.4); column(8.4, z, 5.4, 0.4); }

  const blocked = new Set(['2,4', '5,5', '0,5', '7,2']);
  for (const key of blocked) {
    const [c, r] = key.split(',').map(Number);
    brokenColumn(tileX(c), tileZ(r), 0.9 + Math.random() * 0.5, 0.62);
  }

  // Pressure plates — glyph rings glow when weighted.
  const plateCells = [[2, 6], [5, 6]];
  const plateRingMats = [];
  plateCells.forEach(([c, r], i) => {
    const base = new THREE.Mesh(kit.cylGeo(0.95, 0.95, 0.08, 32, 2), M.dressed);
    base.position.set(tileX(c), 0.13, tileZ(r));
    base.receiveShadow = true;
    kit.add(base);
    const mat = kit.track(glowGold.clone());
    const ringMesh = new THREE.Mesh(kit.track(new THREE.TorusGeometry(0.7, 0.05, 6, 40)), mat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(tileX(c), 0.18, tileZ(r));
    kit.add(ringMesh);
    plateRingMats[i] = mat;
  });

  // The pushable blocks.
  const blockGeo = kit.boxGeo(1.8, 1.8, 1.8, 1.8);
  const blockFaceTex = kit.canvasTexture(256, 256, (g, w, h) => {
    stoneBackground(g, w, h, '#a98d64');
    drawGlyph(g, 'Hourglass', w / 2, h / 2, 150, '#3b2a14', 12);
  });
  const blockMat = kit.track(new THREE.MeshStandardMaterial({ map: blockFaceTex, roughness: 0.92, normalMap: M.wall.normalMap, emissiveMap: blockFaceTex, emissive: 0x000000 }));
  const blocks = [];
  const blockStarts = [[2, 2], [5, 3]];
  blockStarts.forEach(([c, r], i) => {
    const mat = kit.track(blockMat.clone());
    const b = new THREE.Mesh(blockGeo, mat);
    b.castShadow = true;
    b.receiveShadow = true;
    b.position.set(tileX(c), 0.9, tileZ(r));
    kit.add(b);
    kit.solidFrom(b);
    kit.walkables.push(b);
    const block = { mesh: b, mat, c, r, moving: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), index: i };
    b.userData.onPush = (ax, az) => pushBlock(block, ax, az);
    blocks.push(block);
  });

  function cellFree(c, r, except) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (blocked.has(`${c},${r}`)) return false;
    return !blocks.some((b) => b !== except && b.c === c && b.r === r);
  }

  function pushBlock(block, ax, az) {
    if (block.moving > 0 || state.gateOpen) return;
    // World −Z is "row +1" (north).
    const nc = block.c + ax;
    const nr = block.r - az;
    if (!cellFree(nc, nr, block)) {
      api.sound('stone-thud', { volume: 0.5, rate: 0.8 });
      return;
    }
    block.from.copy(block.mesh.position);
    block.to.set(tileX(nc), 0.9, tileZ(nr));
    block.c = nc;
    block.r = nr;
    block.moving = 1;
    api.sound('stone-slide', { volume: 0.9, rate: 0.6 });
    api.shake(0.12);
  }

  kit.update((dt) => {
    for (const b of blocks) {
      if (b.moving <= 0) continue;
      b.moving = Math.max(0, b.moving - dt / 0.45);
      const k = 1 - b.moving;
      b.mesh.position.lerpVectors(b.from, b.to, k * k * (3 - 2 * k));
      kit.refreshSolid(b.mesh);
      if (b.moving === 0) { api.sound('stone-thud', { volume: 0.7 }); checkPlates(); }
    }
  });

  function checkPlates() {
    plateCells.forEach(([c, r], i) => {
      const on = blocks.some((b) => b.c === c && b.r === r);
      if (on !== state.plates[i]) {
        state.plates[i] = on;
        api.sound(on ? 'bell' : 'stone-thud', { volume: 0.6, rate: on ? 1.2 : 0.7 });
      }
      plateRingMats[i].emissiveIntensity = on ? 3 : 0;
    });
    blocks.forEach((b) => { b.mat.emissive.setHex(plateCells.some(([c, r]) => b.c === c && b.r === r) ? 0xffa53a : 0x000000); b.mat.emissiveIntensity = 1.2; });
    if (state.plates[0] && state.plates[1] && !state.gateOpen) openGate();
  }

  // Reset stone by the courtyard entrance (deadlocks are part of Sokoban).
  const resetStone = new THREE.Mesh(kit.cylGeo(0.35, 0.45, 1.1, 8, 1.5), M.dressed);
  resetStone.position.set(-3.6, 0.55, -17.2);
  resetStone.castShadow = true;
  kit.add(resetStone);
  kit.solidFrom(resetStone);
  const resetGlyph = new THREE.Mesh(kit.track(new THREE.CircleGeometry(0.22, 24)), kit.track(new THREE.MeshStandardMaterial({ map: kit.canvasTexture(128, 128, (g) => { g.fillStyle = '#2a1d10'; g.fillRect(0, 0, 128, 128); drawGlyph(g, 'Sun', 64, 64, 100, '#ffcf7a', 9); }), emissive: 0xffb340, emissiveIntensity: 0.6 })));
  resetGlyph.rotation.x = -Math.PI / 2;
  resetGlyph.position.set(-3.6, 1.115, -17.2);
  kit.add(resetGlyph);
  kit.interact(resetStone, () => (state.gateOpen ? null : 'Reset the weights'), () => {
    blocks.forEach((b, i) => {
      b.from.copy(b.mesh.position);
      b.c = blockStarts[i][0];
      b.r = blockStarts[i][1];
      b.to.set(tileX(b.c), 0.9, tileZ(b.r));
      b.moving = 1;
    });
    api.sound('crumble', { volume: 0.6 });
    api.message('The weights grind back to where they began.', 2200);
  });

  // The Sun Gate (iron portcullis) in the courtyard's north arch.
  const gate = kit.prop('large-iron-gate', { pos: [0, 0, -34.6], height: 4.15, solid: false });
  const gateProxy = kit.proxy({ size: [4.4, 4.2, 0.6], pos: [0, 2.1, -34.6] });
  let gateLift = 0;
  function openGate() {
    state.gateOpen = true;
    api.sound('gate', { volume: 1, rate: 0.7 });
    api.sound('crumble', { volume: 0.5 });
    api.shake(0.3);
    api.message('Both weights rest on their plates — the Sun Gate grinds open!', 3200);
    api.setObjective('Steer the sunlight onto the crystal');
    api.checkpoint(new THREE.Vector3(0, 0, -32.5), 0, null);
  }
  kit.update((dt) => {
    if (!state.gateOpen || gateLift >= 1) return;
    gateLift = Math.min(1, gateLift + dt / 2.6);
    gate.position.y = -gateLift * 4.3;   // sinks into a slot in the floor
    if (gateLift > 0.5) kit.removeCollider(gateProxy);
  });

  /* ===================================================================
     C. Sun Court — steer the sunbeam with rotating bronze mirrors
     =================================================================== */
  kit.box({ size: [24, 0.1, 22], pos: [0, 0.05, -45.5], mat: M.cobble, tile: 3, solid: false, surface: 'stone' });
  wall(-12.6, -34.6, -12.6, -38.6, 6.5, 1.2);
  wall(-12.6, -41.4, -12.6, -56.4, 6.5, 1.2);
  // Sun Eye: the round window the beam enters through (wall above & below it).
  kit.box({ size: [1.2, 1.1, 2.8], pos: [-12.6, 0.55, -40], mat: M.wall, tile: 2.5, walk: false });
  kit.box({ size: [1.2, 3.2, 2.8], pos: [-12.6, 4.9, -40], mat: M.wall, tile: 2.5, walk: false, map: false });
  const eyeRing = new THREE.Mesh(kit.track(new THREE.TorusGeometry(1.0, 0.16, 10, 40)), bronze);
  eyeRing.rotation.y = Math.PI / 2;
  eyeRing.position.set(-12.0, 1.65, -40);
  kit.add(eyeRing);
  wall(12.6, -34.6, 12.6, -56.4, 6.5, 1.2);
  // Low parapet along the chasm edge, open at the bridge.
  wall(-12.6, -56.2, -2.4, -56.2, 0.9, 0.6, M.dressed);
  wall(2.4, -56.2, 12.6, -56.2, 0.9, 0.6, M.dressed);
  // Roof beams: cast striped shadows into the court.
  for (let i = 0; i < 6; i++) kit.box({ size: [26, 0.6, 0.8], pos: [0, 6.8, -37 - i * 3.6], mat: M.dressed, tile: 2.5, solid: false, walk: false, map: false });
  for (const z of [-38, -44, -50]) { column(-11.2, z, 6.5, 0.45); column(11.2, z, 6.5, 0.45); }
  // Shafts of light through the roof (decorative, additive).
  const godRays = [];
  for (const [x, z] of [[-6, -44], [3, -39], [8, -51]]) {
    const ray = createBeam({ radius: 1.1, color: 0xffd6a0 });
    ray.material.uniforms.uIntensity.value = 0.13;
    ray.set(new THREE.Vector3(x - sunDir.x * 9, 9, z - sunDir.z * 9), new THREE.Vector3(x, 0, z));
    kit.add(ray.mesh);
    kit.track(ray);
    godRays.push(ray);
  }
  const dust = createParticles({ count: 160, center: [0, 3, -45], box: [22, 5, 18], color: 0xffe6b8, size: 0.05 });
  kit.add(dust.mesh);
  kit.track(dust);
  kit.update((dt, t) => { dust.update(t); godRays.forEach((r) => r.update(t)); });

  // Mirrors: o = 0..3 → mirror normal at 45° + 90°·o (always a diagonal).
  const BEAM_Y = 1.65;
  const mirrors = [];
  const mirrorDefs = [
    { x: -4, z: -40, o: 0 }, // needs 2
    { x: -4, z: -50, o: 1 }, // needs 0
    { x: 6, z: -50, o: 3 },  // needs 2
    { x: 6, z: -40, o: 1 },  // decoy
  ];
  const pedestalGeo = kit.cylGeo(0.45, 0.6, 1.0, 10, 1.5);
  const discGeo = kit.track(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 40));
  const frameGeo = kit.track(new THREE.TorusGeometry(0.64, 0.06, 8, 40));
  for (const def of mirrorDefs) {
    const ped = new THREE.Mesh(pedestalGeo, M.dressed);
    ped.position.set(def.x, 0.5, def.z);
    ped.castShadow = true;
    kit.add(ped);
    kit.solidFrom(ped);
    const pivot = new THREE.Group();
    pivot.position.set(def.x, BEAM_Y, def.z);
    const disc = new THREE.Mesh(discGeo, bronze);
    disc.rotation.z = Math.PI / 2;   // disc faces ±X in pivot space
    const frame = new THREE.Mesh(frameGeo, bronzeDark);
    frame.rotation.y = Math.PI / 2;
    const back = new THREE.Mesh(kit.boxGeo(0.12, 1.1, 1.1), M.dressed);
    back.position.x = -0.1;
    const stem = new THREE.Mesh(kit.boxGeo(0.12, 0.7, 0.12), bronzeDark);
    stem.position.y = -0.6;
    pivot.add(disc, frame, back, stem);
    pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    kit.add(pivot);
    const m = { ...def, pivot, angle: mirrorAngle(def.o), target: mirrorAngle(def.o) };
    pivot.rotation.y = m.angle;
    kit.interact(pivot, () => (state.crystalLit ? null : 'Turn the bronze mirror'), () => {
      m.o = (m.o + 1) % 4;
      m.target -= Math.PI / 2;     // mirrorAngle() steps by −90° per orientation
      api.sound('creak', { volume: 0.8, rate: 1.1 });
      traceBeam();
    });
    mirrors.push(m);
  }
  // Pivot space: disc normal is +X. Rotating by θ about Y sends +X to (cos θ, −sin θ).
  // We want the normal at angle 45° + 90°·o measured from +X toward +Z.
  function mirrorAngle(o) { return -(Math.PI / 4 + (Math.PI / 2) * o); }
  function mirrorNormal(o) { const a = Math.PI / 4 + (Math.PI / 2) * o; return [Math.cos(a), Math.sin(a)]; }

  // Sun crystal at the chasm edge.
  const crystalMat = kit.track(new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffa53a, emissiveIntensity: 0.15, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.92 }));
  const crystal = new THREE.Mesh(kit.track(new THREE.OctahedronGeometry(0.55, 0)), crystalMat);
  crystal.scale.set(0.8, 1.4, 0.8);
  crystal.position.set(6, BEAM_Y, -54.6);
  kit.add(crystal);
  const crystalPed = new THREE.Mesh(pedestalGeo, M.dressed);
  crystalPed.position.set(6, 0.5, -54.6);
  kit.add(crystalPed);
  kit.solidFrom(crystalPed);
  const crystalLight = kit.pointLight(0xffb347, 0, 14, [6, 2.2, -54.6]);

  // Beam segments (pooled).
  const beams = [];
  for (let i = 0; i < 7; i++) {
    const b = createBeam({ radius: 0.11, color: 0xfff0c0 });
    b.mesh.visible = false;
    kit.add(b.mesh);
    kit.track(b);
    beams.push(b);
  }
  kit.update((dt, t) => beams.forEach((b) => b.update(t)));
  const COURT = { minX: -12, maxX: 12, minZ: -56.2, maxZ: -35.2 };
  let crystalHitTime = 0;
  let beamHitsCrystal = false;
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  function traceBeam() {
    let x = -12;
    let z = -40;
    let dx = 1;
    let dz = 0;
    let seg = 0;
    beamHitsCrystal = false;
    for (let bounce = 0; bounce < 7; bounce++) {
      // nearest thing ahead on this axis-aligned ray
      let best = null;
      let bestD = Infinity;
      const consider = (px, pz, what) => {
        const ox = px - x;
        const oz = pz - z;
        const along = ox * dx + oz * dz;
        const off = Math.abs(ox * dz - oz * dx);
        if (along > 0.3 && off < 0.35 && along < bestD) { bestD = along; best = what; }
      };
      mirrors.forEach((m) => consider(m.x, m.z, m));
      consider(crystal.position.x, crystal.position.z, 'crystal');
      // walls of the court
      let wallD = Infinity;
      if (dx > 0) wallD = COURT.maxX - x; else if (dx < 0) wallD = x - COURT.minX;
      else if (dz < 0) wallD = (z - COURT.minZ) + 30; else wallD = COURT.maxZ - z;
      if (wallD < bestD) { bestD = wallD; best = 'wall'; }
      const ex = x + dx * bestD;
      const ez = z + dz * bestD;
      _a.set(x, BEAM_Y, z);
      _b.set(ex, BEAM_Y, ez);
      beams[seg].set(_a, _b);
      beams[seg].mesh.visible = true;
      seg++;
      if (best === 'crystal') { beamHitsCrystal = true; break; }
      if (best === 'wall' || !best) break;
      const [nx, nz] = mirrorNormal(best.o);
      const dot = dx * nx + dz * nz;
      if (dot >= 0) break;                    // hit the stone back of the mirror
      dx = Math.round(dx - 2 * dot * nx);
      dz = Math.round(dz - 2 * dot * nz);
      x = ex;
      z = ez;
    }
    for (let i = seg; i < beams.length; i++) beams[i].mesh.visible = false;
  }

  kit.update((dt, t) => {
    for (const m of mirrors) {
      m.angle += (m.target - m.angle) * Math.min(1, dt * 8);
      m.pivot.rotation.y = m.angle;
    }
    if (!state.crystalLit) {
      crystalHitTime = beamHitsCrystal ? crystalHitTime + dt : 0;
      crystalMat.emissiveIntensity = 0.15 + (beamHitsCrystal ? 1 + Math.sin(t * 20) * 0.3 : 0);
      if (crystalHitTime > 0.6) lightCrystal();
    } else {
      crystalMat.emissiveIntensity = 3 + Math.sin(t * 3) * 0.6;
      crystal.rotation.y += dt * 0.8;
    }
  });

  function lightCrystal() {
    state.crystalLit = true;
    crystalLight.intensity = 30;
    api.sound('glass', { volume: 1 });
    api.sound('power-up', { volume: 0.8 });
    api.message('Sunlight floods the crystal — stones rise from the chasm!', 3200);
    api.setObjective('Cross the risen bridge to the sanctum');
    bridge.forEach((s) => { s.t = -s.delay; });
    state.bridgeBuilding = true;
  }

  /* ===================================================================
     D. The floating bridge over the chasm
     =================================================================== */
  const slabGeo = kit.boxGeo(3.6, 0.6, 2, 2);
  const bridge = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(slabGeo, M.dressed);
    m.castShadow = true;
    m.receiveShadow = true;
    const target = new THREE.Vector3(0, -0.3, -57.2 - i * 2.05);
    const start = new THREE.Vector3((Math.random() - 0.5) * 14, -10 - Math.random() * 6, target.z + (Math.random() - 0.5) * 4);
    m.position.copy(start);
    m.rotation.set(Math.random() * 2, Math.random() * 3, Math.random() * 2);
    const rot0 = m.rotation.clone();
    m.userData.surface = 'stone';
    kit.add(m);
    bridge.push({ mesh: m, start, target, rot0, t: -99, delay: i * 0.28, done: false });
  }
  kit.mapShape(3.6, 12.4, 0, -0.1, -62.3, 0x6b5a40);
  kit.update((dt, t) => {
    if (!state.bridgeBuilding) {
      // Dormant slabs drift lazily in the chasm.
      bridge.forEach((s, i) => { s.mesh.position.y = s.start.y + Math.sin(t * 0.6 + i) * 0.4; });
      return;
    }
    let all = true;
    for (const s of bridge) {
      if (s.done) continue;
      s.t += dt / 1.3;
      if (s.t <= 0) { all = false; continue; }
      const k = Math.min(1, s.t);
      const e = 1 - Math.pow(1 - k, 3);
      s.mesh.position.lerpVectors(s.start, s.target, e);
      s.mesh.position.y += Math.sin(k * Math.PI) * 1.5;
      s.mesh.rotation.set(s.rot0.x * (1 - e), s.rot0.y * (1 - e), s.rot0.z * (1 - e));
      if (k >= 1) {
        s.done = true;
        s.mesh.rotation.set(0, 0, 0);
        s.mesh.position.copy(s.target);
        kit.walkables.push(s.mesh);
        api.sound('stone-thud', { volume: 0.6, rate: 0.8 + Math.random() * 0.3 });
      } else all = false;
    }
    if (all && !state.bridgeBuilt) {
      state.bridgeBuilt = true;
      api.shake(0.2);
    }
  });
  // Mist rising from the chasm.
  const mist = createParticles({ count: 90, center: [0, -6, -62], box: [60, 8, 10], color: 0xfff1dc, size: 1.6, rise: 0.4 });
  mist.material.uniforms.uColor.value.multiplyScalar(0.12);
  kit.add(mist.mesh);
  kit.track(mist);
  kit.update((dt, t) => mist.update(t));

  /* ===================================================================
     E. Sanctum — rune drums
     =================================================================== */
  // Stepped platform.
  [[15, 0.45, 0], [11.5, 0.45, 0.45], [8, 0.45, 0.9]].forEach(([s, h, y]) => {
    kit.box({ size: [s, h, s], pos: [0, y + h / 2, -82], mat: M.dressed, tile: 2.2, solid: false, surface: 'stone' });
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.abs(Math.sin(a)) > 0.92 && Math.cos(a) > -0.1) continue;
    column(Math.cos(a) * 9.2, -82 + Math.sin(a) * 9.2, 6.2, 0.5);
  }
  // Mural wall behind the altar.
  const muralTex = kit.canvasTexture(1024, 512, (g, w, h) => {
    stoneBackground(g, w, h, '#a38457');
    g.fillStyle = 'rgba(40,25,10,0.55)';
    g.font = 'bold 54px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('THE THREE HOURS', w / 2, 90);
    for (let i = 0; i < 3; i++) {
      const x = w * (0.25 + i * 0.25);
      g.strokeStyle = 'rgba(40,25,10,0.6)';
      g.lineWidth = 8;
      g.beginPath(); g.arc(x, 260, 90, 0, Math.PI * 2); g.stroke();
      g.fillText(NUMERALS[i], x, 420);
      g.font = 'bold 120px Georgia, serif';
      g.fillText('?', x, 300);
      g.font = 'bold 54px Georgia, serif';
    }
    g.font = 'italic 30px Georgia, serif';
    g.fillText('Carve the hours as the tablets were carved — first, second, third.', w / 2, 490);
  });
  kit.box({ size: [14, 7, 1.4], pos: [0, 3.5, -90.5], mat: M.wall, tile: 2.5, walk: false });
  const mural = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(10, 5)), kit.track(new THREE.MeshStandardMaterial({ map: muralTex, roughness: 0.95, normalMap: M.wall.normalMap })));
  mural.position.set(0, 3.6, -89.75);
  kit.add(mural);

  // The code — random each load.
  const pool = [...GLYPHS].sort(() => Math.random() - 0.5);
  const code = pool.slice(0, 3);              // code[i] = glyph for hour i
  const tabletOrder = [0, 1, 2].sort(() => Math.random() - 0.5); // which tablet holds which hour

  // Altar + drums.
  kit.box({ size: [4.2, 1.2, 2], pos: [0, 1.95, -82.6], mat: M.dressed, tile: 1.5, surface: 'stone' });
  const drumTex = kit.canvasTexture(1536, 256, (g, w, h) => {
    for (let i = 0; i < 6; i++) {
      g.save();
      g.translate(i * 256, 0);
      stoneBackground(g, 256, 256, '#b79b70');
      // Cylinder UVs run around the drum; rotate so glyphs stand upright.
      g.translate(128, 128);
      g.rotate(Math.PI / 2);
      drawGlyph(g, GLYPHS[i], 0, 0, 170, '#2a1a0a', 14);
      g.restore();
    }
  });
  const drumMat = kit.track(new THREE.MeshStandardMaterial({ map: drumTex, roughness: 0.9, emissiveMap: drumTex, emissive: 0x000000 }));
  const drumGeo = kit.track(new THREE.CylinderGeometry(0.55, 0.55, 0.95, 6, 1));
  drumGeo.rotateZ(Math.PI / 2);
  const drums = [];
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(drumGeo, drumMat);
    d.position.set(-1.25 + i * 1.25, 3.15, -82.0);
    d.castShadow = true;
    const idx = Math.floor(Math.random() * 6);
    const drum = { mesh: d, idx, angle: drumAngle(idx) };
    d.rotation.x = drum.angle;
    kit.add(d);
    kit.interact(d, () => (state.dialsSolved ? null : `Turn the ${NUMERALS[i]} drum`), () => {
      drum.idx = (drum.idx + 1) % 6;
      api.sound('stone-slide', { volume: 0.7, rate: 1.3 });
      checkDrums();
    });
    drums.push(drum);
  }
  // Face i of a 6-sided cylinder is centred 30° + 60°·i around its axis.
  function drumAngle(i) { return THREE.MathUtils.degToRad(30 + 60 * i); }
  kit.update((dt) => drums.forEach((d) => {
    const target = drumAngle(d.idx);
    let diff = target - d.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    d.angle += diff * Math.min(1, dt * 10);
    d.mesh.rotation.x = d.angle;
  }));

  function checkDrums() {
    if (state.dialsSolved) return;
    const ok = drums.every((d, i) => GLYPHS[d.idx] === code[i]);
    if (!ok) return;
    if (!state.tablets.every(Boolean)) {
      // Solved by luck/brute force still counts — but nudge the story.
      api.message('The drums lock with a deep click… as if the temple simply knew.', 2600);
    }
    state.dialsSolved = true;
    drumMat.emissive.setHex(0xffa53a);
    drumMat.emissiveIntensity = 0.8;
    api.sound('bell', { volume: 1, rate: 0.8 });
    api.sound('gate', { volume: 0.7, rate: 1.2 });
    api.message('The three hours align. The altar splits — the Ancient Core rises!', 3500);
    api.setObjective('Take the Ancient Core');
    coreRise = 0.0001;
  }

  // The Ancient Core.
  const coreMat = kit.track(new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xff9d2a, emissiveIntensity: 4, roughness: 0.2 }));
  const core = new THREE.Mesh(kit.track(new THREE.OctahedronGeometry(0.42, 1)), coreMat);
  core.position.set(0, 1.5, -83.3);
  core.visible = false;
  kit.add(core);
  const coreBeam = createBeam({ radius: 0.6, color: 0xffcf7a });
  coreBeam.set(new THREE.Vector3(0, 2.5, -83.3), new THREE.Vector3(0, 30, -83.3));
  coreBeam.mesh.visible = false;
  kit.add(coreBeam.mesh);
  kit.track(coreBeam);
  const coreLight = kit.pointLight(0xffb347, 0, 12, [0, 4, -83.3]);
  let coreRise = 0;
  kit.interact(core, () => (core.visible && coreRise >= 1 && !state.coreTaken ? 'Take the Ancient Core' : null), () => {
    state.coreTaken = true;
    core.visible = false;
    coreBeam.mesh.visible = false;
    coreLight.intensity = 0;
    api.completeLevel(core.position);
    return 'pickup';
  });
  kit.update((dt, t) => {
    if (coreRise <= 0 || state.coreTaken) return;
    coreRise = Math.min(1, coreRise + dt / 2.5);
    core.visible = true;
    coreBeam.mesh.visible = true;
    core.position.y = 2.6 + coreRise * 1.4 + Math.sin(t * 2) * 0.12;
    core.rotation.y += dt * 1.5;
    coreLight.intensity = 25 * coreRise;
    coreBeam.update(t);
    coreBeam.material.uniforms.uIntensity.value = 0.6 * coreRise;
  });

  /* ===================================================================
     Rune tablets (clues) — three hidden carvings
     =================================================================== */
  const tabletSpots = [
    { pos: [25.85, 1.3, 7.6], rot: -Math.PI / 2, where: 'behind the reflecting pool' },
    { pos: [-8.95, 1.35, -32.4], rot: Math.PI / 2, where: 'in the courtyard’s north-west corner' },
    { pos: [11.95, 1.35, -47], rot: -Math.PI / 2, where: 'in the Sun Court’s east alcove' },
  ];
  const tabletMeshes = [];
  tabletSpots.forEach((spot, i) => {
    const hour = tabletOrder[i];
    const glyph = code[hour];
    const tex = kit.canvasTexture(256, 320, (g, w, h) => {
      stoneBackground(g, w, h, '#9c8058');
      drawGlyph(g, glyph, w / 2, 130, 170, '#2a1a0a', 14);
      g.fillStyle = '#2a1a0a';
      g.font = 'bold 56px Georgia, serif';
      g.textAlign = 'center';
      g.fillText(NUMERALS[hour], w / 2, 285);
    });
    const mat = kit.track(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffb340, emissiveIntensity: 0.05, roughness: 0.9 }));
    const slab = new THREE.Group();
    const back = new THREE.Mesh(kit.boxGeo(1.05, 1.35, 0.22), M.wall);
    const face = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(0.9, 1.15)), mat);
    face.position.z = 0.115;
    slab.add(back, face);
    slab.position.set(...spot.pos);
    slab.rotation.y = spot.rot;
    slab.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    kit.add(slab);
    kit.interact(slab, () => (state.tablets[i] ? 'Read the tablet again' : 'Examine the carved tablet'), () => {
      const first = !state.tablets[i];
      state.tablets[i] = true;
      mat.emissiveIntensity = 0.9;
      api.sound('rune', { volume: 0.9 });
      api.journal(`<img src="${glyphDataURL(glyph)}" width="32" height="32" style="vertical-align:middle;margin-right:10px">Tablet of the <b>${NUMERALS[hour]}</b> hour — the <b>${glyph}</b>. <span style="opacity:.7">(found ${spot.where})</span>`, `tablet-${i}`);
      if (first) {
        const n = state.tablets.filter(Boolean).length;
        api.message(`A carving of the ${glyph}, marked ${NUMERALS[hour]} — noted in your journal (J). ${n}/3 tablets.`, 3400);
      } else {
        api.message(`The ${glyph}, hour ${NUMERALS[hour]}.`, 2000);
      }
    });
    tabletMeshes.push(slab);
    // A few ferns half-hide each tablet.
  });

  /* ===================================================================
     Vegetation, rocks, trees, grass, fireflies
     =================================================================== */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ferns = [];
  const fernZones = [[22, 9, 6, 4], [-18, 4, 6, 18], [-16, -24, 8, 10], [16, -24, 8, 10], [-14, -80, 6, 16], [14, -80, 6, 16], [24, -2, 3, 14], [-12, 16, 10, 4], [14, 16, 10, 4]];
  for (const [cx, cz, w, d] of fernZones) {
    for (let i = 0; i < 8; i++) ferns.push({ pos: [cx + rnd(-w / 2, w / 2), 0, cz + rnd(-d / 2, d / 2)], rot: rnd(0, 6.3), scale: rnd(0.7, 1.3) });
  }
  // Ferns tucked around each tablet.
  tabletSpots.forEach((s) => ferns.push({ pos: [s.pos[0] + (s.rot > 0 ? 0.6 : -0.6), 0, s.pos[2] + 0.9], rot: rnd(0, 6), scale: 0.9 }));
  kit.scatter('fern-02', ferns);
  kit.scatter('shrub-02', Array.from({ length: 14 }, (_, i) => ({ pos: [(i % 2 ? 1 : -1) * rnd(15, 28), 0, rnd(10, 22)], rot: rnd(0, 6), scale: rnd(0.6, 1) }))
    .concat(Array.from({ length: 10 }, () => ({ pos: [rnd(-26, -16), 0, rnd(-50, -10)], rot: rnd(0, 6), scale: rnd(0.6, 1) }))));
  kit.scatter('rock-moss-set-01', [
    { pos: [-24, 0, -6], rot: 0.3, scale: 0.9 }, { pos: [24, 0, -26], rot: 2, scale: 0.8 }, { pos: [-22, 0, -46], rot: 1, scale: 1.1 },
    { pos: [-16, 0, -74], rot: 4, scale: 0.8 }, { pos: [18, 0, 20], rot: 5, scale: 0.9 },
  ]);
  kit.scatter('rock-moss-set-02', [
    { pos: [20, 0, -12], rot: 1.2, scale: 0.8 }, { pos: [-20, 0, 18], rot: 3, scale: 1 }, { pos: [16, 0, -78], rot: 0.5, scale: 0.9 },
  ]);
  kit.prop('dead-tree-trunk', { pos: [-19, 0.35, -2], rot: [0, 0.6, Math.PI / 2], height: 0.8, solid: false });
  kit.prop('tree-stump-01', { pos: [-17, 0, 10], height: 1.2, solid: true });
  kit.prop('tree-stump-01', { pos: [15.5, 0, 12.5], rot: 2, height: 1, solid: true });

  buildTrees(kit, M, [
    [-21, 12], [-26, 2], [-24, -14], [-25, -34], [24, -14], [25, -34], [22, 14], [-9, 19], [11, 20], [-18, -70], [18, -72], [-14, -92], [13, -93],
  ]);

  // Grass: avoid paved areas, walls and the pool.
  const avoidRects = [
    [-13, 13, -11, 13], [-3, 3, -16, -11], [-10, 10, -35, -14], [-13, 13, -57, -34],
    [12, 27, -6, 8], [-8, 8, -90, -74], [-2, 2, -69, -56],
  ];
  const grass = createGrass({
    patches: [{ x: 0, z: -2, w: 60, d: 52 }, { x: 0, z: -82, w: 30, d: 24 }],
    count: Math.round(26000 * q.grass),
    sunDir,
    avoid: (x, z) => avoidRects.some(([x1, x2, z1, z2]) => x > x1 && x < x2 && z > z1 && z < z2),
  });
  kit.add(grass.mesh);
  kit.track(grass);
  kit.update((dt, t) => grass.update(t, api.player.position, scene));

  const fireflies = createParticles({ count: 140, center: [0, 1.4, -10], box: [56, 2.4, 60], color: 0xfff09a, size: 0.09 });
  kit.add(fireflies.mesh);
  kit.track(fireflies);
  kit.update((dt, t) => fireflies.update(t));

  // Brazier flicker.
  kit.update((dt, t) => {
    for (const f of flames) {
      if (f.update) f.update(t);
      if (f.light) f.light.intensity = f.light.userData.base * (0.8 + 0.2 * Math.sin(t * 13 + f.light.id) * Math.sin(t * 7.3 + f.light.id * 2));
    }
  });

  /* ===================================================================
     Objectives, hints, minimap marker, checkpoints
     =================================================================== */
  const _marker = new THREE.Vector3();
  let checkpointBridge = false;
  let markerStep = -1;
  let enteredCourt = false;
  api.setHint(() => {
    const p = api.player.position;
    const found = state.tablets.filter(Boolean).length;
    if (state.coreTaken) return '';
    if (!enteredCourt) return 'The temple lies north. Something heavy guards its inner gate.';
    if (!state.gateOpen) return 'Walk INTO a stone block to push it a tile. Weigh down both glowing plates. (Stuck? Use the sun stone.)';
    if (!state.crystalLit) return 'Turn the bronze mirrors (E) to bounce the sunbeam onto the crystal by the chasm.';
    if (p.z > -68) return 'Cross the floating bridge.';
    if (!state.dialsSolved) return found < 3 ? `Turn the drums to the tablets' glyphs, in hour order I → III. Tablets found: ${found}/3 (journal: J).` : 'Set drums I, II, III to the glyphs of hours I, II, III (see journal: J).';
    return 'Take the core.';
  });
  kit.update(() => {
    const p = api.player.position;
    if (!enteredCourt && p.z < -15) { enteredCourt = true; api.setObjective('Weigh down both pressure plates'); }
    if (state.bridgeBuilt && !checkpointBridge && p.z < -69) {
      checkpointBridge = true;
      api.checkpoint(new THREE.Vector3(0, 0, -70), 0);
      api.setObjective('Unlock the altar’s rune drums');
    }
    let step = 5;
    if (!enteredCourt) step = 0; else if (!state.gateOpen) step = 1; else if (!state.crystalLit) step = 2;
    else if (!checkpointBridge) step = 3; else if (!state.coreTaken) step = 4;
    if (step !== markerStep) {
      markerStep = step;
      const spots = [[0, -16], [0, -31], [-4, -45], [0, -62], [0, -82]];
      api.setMarker(step < 5 ? _marker.set(spots[step][0], 0, spots[step][1]) : null);
    }
  });

  traceBeam();
  checkPlates();

  // QA shortcuts (window.__game.levels.debug) for automated play-throughs.
  const debug = {
    state,
    code,
    solveBlocks() { blocks[0].c = 2; blocks[0].r = 6; blocks[1].c = 5; blocks[1].r = 6; blocks.forEach((b) => { b.mesh.position.set(tileX(b.c), 0.9, tileZ(b.r)); kit.refreshSolid(b.mesh); }); checkPlates(); },
    alignMirrors() { [2, 0, 2].forEach((o, i) => { mirrors[i].o = o; mirrors[i].target = mirrorAngle(o); }); traceBeam(); },
    readTablets() { tabletMeshes.forEach((t) => t.userData.onInteract()); },
    solveDrums() { drums.forEach((d, i) => { d.idx = GLYPHS.indexOf(code[i]); }); checkDrums(); },
    takeCore() { coreRise = 1; core.userData.onInteract(); },
  };

  return kit.result({
    spawn: new THREE.Vector3(0, 0, 9),
    spawnYaw: 0,
    bounds: 100,
    killY: -12,
    debug,
  });
}

/* ---------------------------------------------------------------------
   Jungle trees: our own procedural model. Curved, tapered trunk
   (cylinder vertices bent by height²) + a canopy of leaf cards. All leaf
   cards of all trees share ONE InstancedMesh with an alpha-tested canvas
   texture — so the sun casts dappled leaf shadows through them.
   --------------------------------------------------------------------- */
function buildTrees(kit, M, spots) {
  const leafTex = kit.canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(a);
      const grd = g.createLinearGradient(0, 0, 110, 0);
      grd.addColorStop(0, '#2c4a17');
      grd.addColorStop(1, i % 2 ? '#6e9a32' : '#557f26');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(8, 0);
      g.quadraticCurveTo(60, -30, 118, 0);
      g.quadraticCurveTo(60, 30, 8, 0);
      g.fill();
      g.strokeStyle = 'rgba(20,35,10,0.6)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(8, 0); g.lineTo(112, 0); g.stroke();
      g.restore();
    }
  });
  const leafMat = kit.track(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }));
  const leafGeo = kit.track(new THREE.PlaneGeometry(2.6, 2.6));
  const cardsPer = 46;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length * cardsPer);
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let n = 0;
  spots.forEach(([x, z], ti) => {
    const h = 8 + Math.random() * 5;
    const r = 0.38 + Math.random() * 0.15;
    const lean = (Math.random() - 0.5) * 1.6;
    const leanZ = (Math.random() - 0.5) * 1.6;
    const geo = kit.track(new THREE.CylinderGeometry(r * 0.55, r, h, 10, 12));
    geo.translate(0, h / 2, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / h;
      pos.setX(i, pos.getX(i) + lean * y * y * 2);
      pos.setZ(i, pos.getZ(i) + leanZ * y * y * 2);
    }
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 2);
    const trunk = new THREE.Mesh(geo, M.bark);
    trunk.position.set(x, 0, z);
    trunk.castShadow = true;
    kit.add(trunk);
    kit.proxy({ size: [r * 2, 4, r * 2], pos: [x, 2, z] });
    // root flare
    const flare = new THREE.Mesh(kit.cylGeo(r * 1.0, r * 1.9, 0.9, 10, 2), M.bark);
    flare.position.set(x, 0.45, z);
    kit.add(flare);
    const top = new THREE.Vector3(x + lean * 2, h, z + leanZ * 2);
    for (let i = 0; i < cardsPer; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(1 - Math.random() * 1.2);
      const rad = 2.4 + Math.random() * 1.6;
      p.set(top.x + Math.sin(v) * Math.cos(u) * rad, top.y + Math.cos(v) * rad * 0.55 - 0.4, top.z + Math.sin(v) * Math.sin(u) * rad);
      e.set(-Math.PI / 2 + (Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.8);
      q.setFromEuler(e);
      s.setScalar(0.8 + Math.random() * 0.6);
      m4.compose(p, q, s);
      leaves.setMatrixAt(n++, m4);
    }
    kit.mapShape(5, 5, top.x, 0, top.z, 0x24361c);
  });
  leaves.count = n;
  leaves.instanceMatrix.needsUpdate = true;
  leaves.computeBoundingSphere();
  kit.add(leaves);
}

/* ---------------------------------------------------------------------
   Natural rock cliffs: a subdivided box whose vertices are pushed outward
   by 3D simplex noise. The displacement depends ONLY on the vertex
   position, so the duplicated vertices along box edges move identically
   and the mesh stays watertight. Collision stays a simple box.
   --------------------------------------------------------------------- */
const simplex = new SimplexNoise();
function rockMass(kit, mat, [w, h, d], [x, y, z], rotY = 0) {
  const seg = (n) => Math.max(2, Math.min(24, Math.round(n / 1.6)));
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  // World-scale UVs: the face a vertex belongs to is read from its (still
  // axis-aligned) normal, since subdivided faces have different vertex counts.
  const nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(nrm.getX(i)) > 0.5 ? 'x' : Math.abs(nrm.getY(i)) > 0.5 ? 'y' : 'z';
    const [su, sv] = ax === 'x' ? [d, h] : ax === 'y' ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su / 5, uv.getY(i) * sv / 5);
  }
  const v = new THREE.Vector3();
  const off = x * 0.37 + z * 0.11;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = simplex.noise3d(v.x * 0.16 + off, v.y * 0.16, v.z * 0.16) * 1.6
      + simplex.noise3d(v.x * 0.5, v.y * 0.5 + off, v.z * 0.5) * 0.45;
    const dir = v.clone().multiply(new THREE.Vector3(1 / (w * 0.5), 1 / (h * 0.5), 1 / (d * 0.5)));
    const top = v.y > h * 0.49 ? 0.35 : 1;      // keep the cap flatter
    v.addScaledVector(dir.normalize(), n * top);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  kit.track(g);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  kit.add(m);
  kit.proxy({ size: [w * 0.92, h, d * 0.92], pos: [x, y, z], rot: rotY });
  kit.mapShape(w, d, x, y + h / 2, z, 0x6b6253, rotY);
  return m;
}
