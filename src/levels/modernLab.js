import * as THREE from 'three';
import { createParticles } from '../shaders/effects.js';
import {
  createRevealInkMaterial, createFloorReflection, createRainGlassMaterial,
  createScreenMaterial, createBarrierMaterial,
} from '../shaders/labShaders.js';

/**
 * LEVEL 2 — THE PRESENT: "Chronos Research Facility".  Verb: INVESTIGATE.
 *
 * What this level does that the others don't: you win with INFORMATION.
 * The lab is dark after the accident; you read logs, find a flashlight, and
 * the flashlight itself becomes a tool — its beam reveals phosphor ink that
 * is otherwise invisible (custom shader). The digits you uncover open the
 * archive door, and a logic puzzle reroutes power. Restoring power visibly
 * transforms the whole level from red emergency light to clean daylight-blue.
 *
 * Same place, later in time: the Time Machine stands in the experiment hall,
 * and a glass floor panel shows the temple stones the lab was built on.
 *
 * Layout (north = −Z):
 *   Experiment hall (machine, windows, glass pit)   x ±12,       z ±12
 *   Prof. Adeyemi's office (flashlight, logs)       x −24…−12.6, z ±6
 *   Archive corridor (dark, phosphor ink)           x ±3,        z −12.6…−30
 *   Power room (conduit routing console)            x ±8,        z −30.6…−46
 *   Vault (containment field, Lab Core)             x 12.6…22,   z ±5
 */
export const meta = {
  name: 'The Present',
  numeral: 'II',
  title: 'The Present',
  subtitle: 'Chronos Research Facility',
  objective: 'Find out what happened here',
  music: 'lab',
  ambience: 'lab',
  sky: 'lab',
  stability: 480,
  accent: 0x6fd3ff,
  surface: 'stone',
  fallPenalty: 10,
  introCard: {
    kicker: 'The Present · Your goal', title: 'Investigate the lab and recover the Lab Core',
    html: '<ul><li>This era is about <b>finding information</b>: read laptops, notes and boards (<kbd>E</kbd>).</li>'
      + '<li>Every clue goes into your <b>journal</b> (<kbd>J</kbd>). The <b>◆ marker</b> and checklist show the next step.</li>'
      + '<li>Start with the <b>laptop on the east workbench</b>, near the windows.</li></ul>',
  },
};

export function build(kit, api) {
  const q = api.quality;
  const scene = api.scene;
  scene.fog = new THREE.FogExp2(0x070b12, 0.018);

  const M = {
    floor: kit.material('floor-tiles-08', { roughness: 0.55, tint: 0xd8dce2 }),
    rubber: kit.material('rubber-tiles', { roughness: 0.8 }),
    plaster: kit.material('plastered-wall-04', { tint: 0xd9dee6 }),
    panels: kit.material('concrete-panels', { tint: 0xb9c2cc }),
    ceiling: kit.material('concrete-panels', { tint: 0x8a929c }),
    plate: kit.material('metal-plate', { metal: true, roughness: 0.6 }),
    plate2: kit.material('metal-plate-02', { metal: true, roughness: 0.5 }),
    ruin: kit.material('mossy-sandstone', {}),
  };
  const steel = kit.track(new THREE.MeshStandardMaterial({ color: 0x8e98a6, metalness: 0.9, roughness: 0.35 }));
  const darkSteel = kit.track(new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.7, roughness: 0.45 }));
  const tubeOff = kit.track(new THREE.MeshStandardMaterial({ color: 0x9aa4ad, emissive: 0xd8f2ff, emissiveIntensity: 0, roughness: 0.3 }));
  const redLamp = kit.track(new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 3, roughness: 0.4 }));

  const state = {
    readIncident: false, inOffice: false, flashlight: false, marks: [false, false, false, false],
    doorOpen: false, inPower: false, power: false, vaultOpen: false, fieldDown: false, coreTaken: false, wrongCodes: 0,
  };

  /* ===================================================================
     helpers
     =================================================================== */
  function wall(x1, z1, x2, z2, h, mat = M.plaster, y0 = 0, t = 0.6) {
    const w = Math.abs(x2 - x1) || t;
    const d = Math.abs(z2 - z1) || t;
    return kit.box({ size: [w, h, d], pos: [(x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2], mat, tile: 2.5, walk: false });
  }
  function floor(x1, z1, x2, z2, mat, surface = 'stone', tile = 2) {
    return kit.box({ size: [x2 - x1, 0.4, z2 - z1], pos: [(x1 + x2) / 2, -0.2, (z1 + z2) / 2], mat, tile, solid: false, surface });
  }
  function ceiling(x1, z1, x2, z2, y) {
    return kit.box({ size: [x2 - x1, 0.3, z2 - z1], pos: [(x1 + x2) / 2, y + 0.15, (z1 + z2) / 2], mat: M.ceiling, tile: 3, solid: false, walk: false, map: false, cast: false });
  }
  /** Sliding door: returns { open() } — the panel slides into the wall. */
  function slidingDoor(x, z, width, height, axis = 'x', locked = true) {
    const panel = kit.box({ size: axis === 'x' ? [width, height, 0.18] : [0.18, height, width], pos: [x, height / 2, z], mat: M.plate2, tile: 1.5, walk: false, map: false });
    const stripe = new THREE.Mesh(kit.boxGeo(axis === 'x' ? width * 0.9 : 0.2, 0.08, axis === 'x' ? 0.2 : width * 0.9), kit.track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: locked ? 0xff3020 : 0x30ff90, emissiveIntensity: 2 })));
    stripe.position.set(0, 0.4, 0);
    panel.add(stripe);
    let t = 0;
    let opening = false;
    const start = panel.position.clone();
    kit.update((dt) => {
      if (!opening || t >= 1) return;
      t = Math.min(1, t + dt / 1.4);
      const e = t * t * (3 - 2 * t);
      if (axis === 'x') panel.position.x = start.x + e * (width + 0.1); else panel.position.z = start.z + e * (width + 0.1);
      if (t > 0.5) kit.removeCollider(panel);
    });
    return {
      panel,
      open() {
        if (opening) return;
        opening = true;
        stripe.material.emissive.setHex(0x30ff90);
        api.sound('door-open', { volume: 0.9 });
      },
    };
  }
  /** Fluorescent ceiling fixture: housing + two tubes that light with the power. */
  const fixtures = [];
  const fixtureGeo = kit.boxGeo(1.4, 0.12, 0.5, 1);
  const tubeGeo = kit.track(new THREE.CylinderGeometry(0.035, 0.035, 1.25, 8).rotateZ(Math.PI / 2));
  function fixture(x, y, z) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(fixtureGeo, darkSteel));
    for (const dz of [-0.12, 0.12]) {
      const t = new THREE.Mesh(tubeGeo, tubeOff);
      t.position.set(0, -0.08, dz);
      g.add(t);
    }
    g.position.set(x, y, z);
    kit.add(g);
    fixtures.push(g);
  }
  /** Monitor: bezel + screen with the CRT shader. */
  const screens = [];
  function monitor(x, y, z, rotY, contentTex, color, scale = 1) {
    const g = new THREE.Group();
    const bezel = new THREE.Mesh(kit.boxGeo(0.78 * scale, 0.52 * scale, 0.08, 1), darkSteel);
    const mat = kit.track(createScreenMaterial(contentTex, { color, power: 0 }));
    const scr = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(0.7 * scale, 0.44 * scale)), mat);
    scr.position.z = 0.045;
    g.add(bezel, scr);
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    kit.add(g);
    screens.push(mat);
    return g;
  }
  function textTexture(lines, { w = 512, h = 320, bg = '#02070c', fg = '#9fe8ff', title = '' } = {}) {
    return kit.canvasTexture(w, h, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = 'bold 30px monospace';
      if (title) g.fillText(title, 20, 42);
      g.font = '22px monospace';
      lines.forEach((l, i) => g.fillText(l, 20, (title ? 84 : 40) + i * 30));
    });
  }

  /**
   * Member 2 · one-shot Lab SFX hook. Names map to optional files in
   * assets/audio/modern-lab/ (registered as 'modern-lab:<name>' in the asset
   * manifest, so they preload behind the loading screen). Until a file
   * exists, the shared audio manager finds no buffer and stays silent — no
   * console errors, no 404 spam — so the calls are safe to wire early.
   */
  function labSound(name, opts) { api.sound(`modern-lab:${name}`, opts); }

  /* ===================================================================
     Experiment hall
     =================================================================== */
  // Floor with a hole for the glass panel over the ruins (x −8…−4, z 5.5…8.5).
  floor(-12, 8.5, 12, 12.3, M.floor);
  floor(-12, -12.3, 12, 5.5, M.floor);
  floor(-12, 5.5, -8, 8.5, M.floor);
  floor(-4, 5.5, 12, 8.5, M.floor);
  ceiling(-12.6, -12.6, 12.6, 12.6, 7);
  const refl = createFloorReflection(24, 24.6, { normalMap: M.floor.normalMap, quality: q, tile: 2 });
  if (refl) { refl.mesh.position.set(0, 0.006, 0); kit.add(refl.mesh); kit.track(refl); }

  // Walls with door openings: west (office), north (archive), east (vault).
  wall(-12.3, -12.6, -12.3, -1.6, 7);
  wall(-12.3, 1.6, -12.3, 12.6, 7);
  wall(-12.3, -1.6, -12.3, 1.6, 3.6, M.plaster, 3.4);
  wall(-12.6, -12.3, -1.6, -12.3, 7);
  wall(1.6, -12.3, 12.6, -12.3, 7);
  wall(-1.6, -12.3, 1.6, -12.3, 3.6, M.plaster, 3.4);
  wall(12.3, -12.6, 12.3, -1.6, 7);
  wall(12.3, 1.6, 12.3, 12.6, 7);
  wall(12.3, -1.6, 12.3, 1.6, 3.6, M.plaster, 3.4);
  // South wall: low sill, tall rain-streaked windows between mullions, header.
  wall(-12.6, 12.3, 12.6, 12.3, 1.1);
  wall(-12.6, 12.3, 12.6, 12.3, 1.2, M.plaster, 5.8);
  const rainMat = kit.track(createRainGlassMaterial());
  for (let i = 0; i < 6; i++) {
    const x = -10 + i * 4;
    kit.box({ size: [0.5, 4.7, 0.7], pos: [x - 2, 3.45, 12.3], mat: steel, tile: 1, walk: false, map: false });
    const glass = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3.5, 4.7)), rainMat);
    glass.position.set(x, 3.45, 12.25);
    glass.rotation.y = Math.PI;
    kit.add(glass);
  }
  kit.box({ size: [0.5, 4.7, 0.7], pos: [12, 3.45, 12.3], mat: steel, tile: 1, walk: false, map: false });
  kit.proxy({ size: [25, 4.7, 0.6], pos: [0, 3.45, 12.3] });

  // Glass panel over the temple stones the lab was built on.
  const pit = new THREE.Group();
  kit.box({ size: [4, 0.3, 3], pos: [-6, -1.75, 7], mat: M.ruin, tile: 1.5, solid: false, walk: false, map: false });
  kit.box({ size: [0.3, 1.6, 3], pos: [-8.15, -0.8, 7], mat: M.ruin, tile: 1.5, solid: false, walk: false, map: false });
  kit.box({ size: [0.3, 1.6, 3], pos: [-3.85, -0.8, 7], mat: M.ruin, tile: 1.5, solid: false, walk: false, map: false });
  kit.box({ size: [4, 1.6, 0.3], pos: [-6, -0.8, 5.35], mat: M.ruin, tile: 1.5, solid: false, walk: false, map: false });
  kit.box({ size: [4, 1.6, 0.3], pos: [-6, -0.8, 8.65], mat: M.ruin, tile: 1.5, solid: false, walk: false, map: false });
  const glyphTex = kit.canvasTexture(256, 256, (g) => {
    g.fillStyle = '#6e5636'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#2a1a0a'; g.lineWidth = 12;
    g.beginPath(); g.arc(128, 128, 52, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 75, 128 + Math.sin(a) * 75); g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); g.stroke(); }
  });
  const sunStone = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(1.6, 1.6)), kit.track(new THREE.MeshStandardMaterial({ map: glyphTex, roughness: 0.9 })));
  sunStone.rotation.x = -Math.PI / 2;
  sunStone.position.set(-6, -1.58, 7);
  kit.add(sunStone);
  kit.pointLight(0xffb36a, 6, 4, [-6, -0.7, 7]);
  const glassMat = q.transmission
    ? kit.track(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.2, ior: 1.45 }))
    : kit.track(new THREE.MeshStandardMaterial({ color: 0x9fc4d6, roughness: 0.05, transparent: true, opacity: 0.25 }));
  const glassFloor = kit.box({ size: [4, 0.06, 3], pos: [-6, -0.03, 7], mat: glassMat, solid: false, cast: false, surface: 'stone' });
  glassFloor.receiveShadow = false;
  const plaque = textTexture(['Foundation stones of the', 'Temple of the First Hour.', 'Excavated 2019 — the', 'Chronos Lab was built', 'directly above them.'], { w: 512, h: 220, bg: '#1a1408', fg: '#e9c98a' });
  const plaqueMesh = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(1.2, 0.52)), kit.track(new THREE.MeshStandardMaterial({ map: plaque, roughness: 0.4, metalness: 0.6 })));
  plaqueMesh.rotation.x = -Math.PI / 2;
  plaqueMesh.position.set(-6, 0.012, 9.2);
  kit.add(plaqueMesh);
  void pit;

  // Workbenches and equipment.
  kit.prop('metal-office-desk', { pos: [-10.6, 0, -6], rot: Math.PI / 2, height: 0.8 });
  kit.prop('metal-office-desk', { pos: [-10.6, 0, -1 + -8], rot: Math.PI / 2, height: 0.8 });
  kit.prop('metal-office-desk', { pos: [10.6, 0, 6.5], rot: -Math.PI / 2, height: 0.8 });
  kit.prop('metal-office-desk', { pos: [10.6, 0, -7], rot: -Math.PI / 2, height: 0.8 });
  kit.prop('chemistry-set', { pos: [-10.7, 0.8, -6], rot: Math.PI / 2, height: 0.42, solid: false });
  kit.prop('industrial-microscope', { pos: [-10.7, 0.8, -8.6], rot: Math.PI / 2, height: 0.5, solid: false });
  kit.prop('bunsen-burner', { pos: [-10.5, 0.8, -9.6], height: 0.22, solid: false });
  kit.prop('circuit-board', { pos: [10.6, 0.8, -6.6], rot: 0.4, height: 0.05, solid: false });
  kit.prop('clipboard', { pos: [10.5, 0.8, -7.6], rot: 1.2, height: 0.03, solid: false });
  const incidentLaptop = kit.prop('classic-laptop', { pos: [10.55, 0.8, 6.6], rot: -Math.PI / 2, height: 0.32, solid: false });
  kit.prop('steel-frame-shelves-01', { pos: [-5, 0, -11.7], height: 2.1 });
  kit.prop('steel-frame-shelves-01', { pos: [5, 0, -11.7], height: 2.1 });
  kit.prop('cardboard-box-01', { pos: [-5.2, 1.05, -11.6], height: 0.4, solid: false });
  kit.prop('cardboard-box-01', { pos: [4.7, 0, -10.8], rot: 0.5, height: 0.45 });
  kit.prop('cardboard-box-01', { pos: [5.3, 0.45, -10.9], rot: 0.2, height: 0.4, solid: false });
  kit.prop('korean-fire-extinguisher-01', { pos: [-11.6, 0, 2.6], rot: Math.PI / 2, height: 0.6 });
  kit.prop('korean-fire-extinguisher-01', { pos: [2.4, 0, -11.8], height: 0.6 });
  kit.prop('wetfloorsign-01', { pos: [3.6, 0, 10.2], rot: 0.4, height: 0.62 });
  kit.prop('security-camera-01', { pos: [-11.6, 6.2, 11.6], rot: Math.PI * 0.75, height: 0.5, solid: false });
  kit.prop('security-camera-01', { pos: [11.6, 6.2, -11.6], rot: -Math.PI * 0.25, height: 0.5, solid: false });
  kit.prop('schoolchair-01', { pos: [9.4, 0, 6.6], rot: Math.PI / 2, height: 0.9 });
  kit.prop('utility-box-01', { pos: [11.7, 0, 10.5], rot: -Math.PI / 2, height: 1.1 });
  // Puddle under the leaking window (glossy decal).
  const puddle = new THREE.Mesh(kit.track(new THREE.CircleGeometry(1.1, 32)), kit.track(new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.55 })));
  puddle.rotation.x = -Math.PI / 2;
  puddle.scale.set(1.4, 1, 1);
  puddle.position.set(3, 0.01, 10.6);
  kit.add(puddle);

  // Thick power cables snaking from the machine to the walls.
  const cableMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.55 }));
  for (const pts of [
    [[0, 0.1, 0], [-3, 0.06, -4], [-6, 0.06, -9], [-9, 0.06, -11.9]],
    [[0, 0.1, 0], [4, 0.06, -2], [8, 0.06, -1], [12, 0.06, -0.6]],
    [[0, 0.1, 0], [3, 0.06, 4], [7, 0.06, 4.5], [12, 0.06, 4]],
  ]) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const tube = new THREE.Mesh(kit.track(new THREE.TubeGeometry(curve, 40, 0.07, 6)), cableMat);
    tube.receiveShadow = true;
    kit.add(tube);
  }

  // Ceiling fixtures (lit when power returns).
  for (const x of [-7, 0, 7]) for (const z of [-7, 0, 7]) fixture(x, 6.85, z);

  // Emergency beacons: rotating red spotlights (the dark phase).
  const beacons = [];
  for (const [x, z] of [[-11.7, -11.7], [11.7, 11.7], [11.7, -11.7]]) {
    const lamp = new THREE.Mesh(kit.track(new THREE.SphereGeometry(0.16, 12, 8)), redLamp);
    lamp.position.set(x * 0.98, 5.2, z * 0.98);
    kit.add(lamp);
    const spot = new THREE.SpotLight(0xff1a0a, 60, 26, Math.PI / 7, 0.5, 1.6);
    spot.position.copy(lamp.position);
    spot.target.position.set(0, 0, 0);
    kit.light(spot);
    kit.light(spot.target);
    beacons.push({ spot, lamp, phase: Math.random() * 6 });
  }
  const hemi = kit.light(new THREE.HemisphereLight(0x4a6a9a, 0x0a0a10, 0.42));
  // Cold moonlight through the south windows gives the dark hall its shape.
  const moon = kit.light(new THREE.DirectionalLight(0x7f9cc8, 0.55));
  moon.position.set(5, 14, 30);
  // Emergency floor strips along the walls + exit signs (emissive → bloom).
  const stripMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a14, emissiveIntensity: 1.6 }));
  const strips = [];
  for (const [x, z, w, d] of [[0, -11.95, 22, 0.08], [0, 11.95, 22, 0.08], [-11.95, 0, 0.08, 22], [11.95, 0, 0.08, 22]]) {
    const s = new THREE.Mesh(kit.boxGeo(w, 0.05, d, 1), stripMat);
    s.position.set(x, 0.03, z);
    kit.add(s);
    strips.push(s);
  }
  const exitTex = kit.canvasTexture(256, 96, (g) => {
    g.fillStyle = '#063'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#d9ffe6'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.fillText('EXIT ⟶', 128, 68);
  });
  const exitMat = kit.track(new THREE.MeshStandardMaterial({ map: exitTex, emissiveMap: exitTex, emissive: 0xffffff, emissiveIntensity: 1.4 }));
  for (const [x, y, z, r] of [[-12.0, 3.0, 0, Math.PI / 2], [0, 3.0, -12.0, 0], [12.0, 3.0, 0, -Math.PI / 2]]) {
    const sgn = new THREE.Mesh(kit.boxGeo(0.7, 0.26, 0.06, 1), exitMat);
    sgn.position.set(x, y, z);
    sgn.rotation.y = r;
    kit.add(sgn);
  }
  // Two-tone walls: dark lower panelling (wainscot) around the hall.
  for (const [x, z, w, d] of [[0, -11.95, 24, 0.12], [-11.95, -7, 0.12, 10], [-11.95, 7, 0.12, 10], [11.95, -7, 0.12, 10], [11.95, 7, 0.12, 10]]) {
    kit.box({ size: [w, 1.3, d], pos: [x, 0.65, z], mat: M.panels, tile: 1.5, solid: false, walk: false, map: false });
  }
  // Hazard ring around the machine.
  const hazardTex = kit.canvasTexture(1024, 64, (g) => {
    for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? '#111' : '#e8b417'; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, 64); g.lineTo(i * 32 - 16, 64); g.fill(); }
  });
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);
  const hazard = new THREE.Mesh(kit.track(new THREE.RingGeometry(4.0, 4.45, 96, 1)), kit.track(new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6 })));
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.y = 0.008;
  kit.add(hazard);
  // CHRONOS logo above the archive door (lights with the power).
  const logoTex = kit.canvasTexture(1024, 192, (g) => {
    g.fillStyle = '#05080c'; g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = '#6fd3ff'; g.lineWidth = 6; g.beginPath(); g.arc(96, 96, 62, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(96, 54); g.lineTo(96, 96); g.lineTo(126, 112); g.stroke();
    g.fillStyle = '#dff6ff'; g.font = 'bold 92px Georgia'; g.fillText('CHRONOS', 200, 120);
    g.font = '30px sans-serif'; g.fillStyle = '#6fd3ff'; g.fillText('TEMPORAL RESEARCH FACILITY', 206, 168);
  });
  const logoMat = kit.track(new THREE.MeshStandardMaterial({ map: logoTex, emissiveMap: logoTex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5 }));
  const logo = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(6.4, 1.2)), logoMat);
  logo.position.set(0, 5.6, -11.95);
  kit.add(logo);
  // Server racks with blinking LEDs (east wall, north end).
  const ledTex = kit.canvasTexture(128, 512, (g) => {
    g.fillStyle = '#07090c'; g.fillRect(0, 0, 128, 512);
    for (let y = 8; y < 512; y += 22) {
      g.fillStyle = '#1a1e24'; g.fillRect(6, y, 116, 16);
      for (let x = 12; x < 110; x += 12) { g.fillStyle = Math.random() > 0.55 ? (Math.random() > 0.8 ? '#ffb020' : '#39ff8a') : '#0a120c'; g.fillRect(x, y + 5, 5, 5); }
    }
  });
  const rackMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.6, roughness: 0.4, emissiveMap: ledTex, emissive: 0xffffff, emissiveIntensity: 0.0, map: ledTex }));
  const racks = [];
  for (const z of [-10.6, -9.4, -8.2]) {
    const r = kit.box({ size: [0.9, 2.4, 1.1], pos: [11.45, 1.2, z], mat: rackMat, tile: 2.4, walk: false });
    racks.push(r);
  }
  // Overhead pipes along the north and west walls.
  const pipeMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x5d6670, metalness: 0.8, roughness: 0.4 }));
  for (const [x, y, z, len, rot] of [[0, 6.3, -11.6, 24, 0], [0, 6.0, -11.3, 24, 0], [-11.6, 6.3, 0, 24, Math.PI / 2]]) {
    const pipe = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.12, 0.12, len, 10).rotateZ(Math.PI / 2)), pipeMat);
    pipe.position.set(x, y, z);
    pipe.rotation.y = rot;
    kit.add(pipe);
  }
  kit.update((dt, t) => {
    // LEDs blink (scroll the emissive texture), logo lights with the power.
    ledTex.offset.y = Math.floor(t * 3) * 0.043;
    rackMat.emissiveIntensity = state.power ? 1.2 : 0.35;
    logoMat.emissiveIntensity = state.power ? 1.1 : 0.05;
  });

  // Lightning through the windows.
  const lightning = kit.light(new THREE.DirectionalLight(0xbfd8ff, 0));
  lightning.position.set(6, 20, 40);
  let nextBolt = 4;
  let boltT = -1;
  kit.update((dt, t) => {
    nextBolt -= dt;
    if (nextBolt <= 0) { boltT = 0; nextBolt = 7 + Math.random() * 9; kit.after(() => api.sound('warp', { volume: 0.45, rate: 0.45 }), 700 + Math.random() * 900); }
    let flash = 0;
    if (boltT >= 0) {
      boltT += dt;
      flash = (boltT < 0.08 ? 1 : boltT < 0.16 ? 0.15 : boltT < 0.24 ? 0.8 : Math.max(0, 0.8 - (boltT - 0.24) * 3));
      if (boltT > 0.6) boltT = -1;
    }
    lightning.intensity = flash * 5;
    api.sky.uniforms.uFlash.value = flash;
    rainMat.uniforms.uFlash.value = flash;
    rainMat.uniforms.uTime.value = t;
    for (const b of beacons) {
      if (state.power) continue;
      const a = t * 2.4 + b.phase;
      b.spot.target.position.set(b.lamp.position.x + Math.cos(a) * 8, 0, b.lamp.position.z + Math.sin(a) * 8);
      b.spot.target.updateMatrixWorld();
    }
  });

  // Security desk with monitors by the vault door.
  kit.prop('metal-office-desk', { pos: [8.6, 0, 1.2], rot: -Math.PI / 2, height: 0.8 });
  const camTex = kit.canvasTexture(320, 200, (g) => {
    g.fillStyle = '#04121a'; g.fillRect(0, 0, 320, 200);
    g.strokeStyle = '#3fbfff'; g.lineWidth = 3; g.strokeRect(70, 40, 180, 130);
    g.beginPath(); g.arc(160, 105, 26, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#9fe8ff'; g.font = 'bold 18px monospace'; g.fillText('CAM 04 · VAULT', 10, 22);
    g.fillText('CORE: CONTAINED', 10, 192);
  });
  const statusTex = textTexture(['GRID ......... OFFLINE', 'VAULT ........ SEALED', 'CONTAINMENT .. ON', 'FIELD DRIVE .. 0%'], { title: 'CHRONOS // STATUS' });
  monitor(8.75, 1.3, 0.5, -Math.PI / 2, camTex, 0x9fe8ff);
  monitor(8.75, 1.3, 1.9, -Math.PI / 2, statusTex, 0x9fe8ff);

  /* ===================================================================
     Logs & story
     =================================================================== */
  const codeDigits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10));
  const code = codeDigits.join('');
  kit.interact(incidentLaptop, 'Read the incident log', () => {
    state.readIncident = true;
    api.sound('computer', { volume: 0.6 });
    api.reader({
      kicker: 'Chronos Research Facility · Terminal 07 (battery)',
      title: 'Incident log — 03:12',
      body: 'Field Test 7. The hourglass drive exceeded 140% and the field\n'
        + 'tore. Three energy cores were flung out of phase — one of them\n'
        + 'into this very night. Containment held; the grid did not.\n\n'
        + '• Main power is DOWN. The vault is sealed with the Lab Core inside.\n'
        + '• Power can be rerouted from the console in the POWER ROOM,\n'
        + '  past the Archive (north).\n'
        + '• The Archive security door code is not stored digitally.\n'
        + '  Ask Prof. Adeyemi. Her office is through the west door.',
    });
    api.journal('Incident log: power is out, the Lab Core is sealed in the vault. Reroute power in the <b>Power Room</b> (north, past the Archive). The Archive code is known only to <b>Prof. Adeyemi</b> (office, west).', 'incident');
    api.setObjective('Find Prof. Adeyemi’s office');
    return 'read';
  });

  /* ===================================================================
     Prof. Adeyemi's office (west)
     =================================================================== */
  floor(-24, -6.3, -12, 6.3, M.floor);
  ceiling(-24.3, -6.6, -12, 6.6, 3.8);
  wall(-24.3, -6.6, -24.3, 6.6, 3.8);
  wall(-24.3, -6.3, -12.6, -6.3, 3.8);
  wall(-24.3, 6.3, -12.6, 6.3, 3.8);
  const officeLamp = kit.pointLight(0xffc98a, 5, 7, [-18.8, 1.6, -3.6]);
  officeLamp.userData.base = 5;
  kit.prop('metal-office-desk', { pos: [-19, 0, -3.8], height: 0.8 });
  const profLaptop = kit.prop('classic-laptop', { pos: [-18.6, 0.8, -3.9], rot: Math.PI, height: 0.32, solid: false });
  kit.prop('schoolchair-01', { pos: [-19.2, 0, -2.6], rot: Math.PI, height: 0.9 });
  const chalk = kit.prop('standing-chalkboard-01', { pos: [-22.6, 0, 2.6], rot: Math.PI / 2 + 0.3, height: 1.6 });
  kit.prop('vintage-grandfather-clock-01', { pos: [-23.6, 0, -5.4], rot: Math.PI / 2, height: 2.1 });
  kit.prop('drawer-cabinet', { pos: [-14, 0, -5.6], height: 1.8 });
  kit.prop('steel-frame-shelves-01', { pos: [-16.8, 0, 5.7], rot: Math.PI, height: 2.1 });
  kit.prop('cardboard-box-01', { pos: [-16.9, 1.05, 5.65], height: 0.35, solid: false });
  kit.prop('hanging-industrial-lamp', { pos: [-18.8, 2.4, -3.8], height: 1.4, solid: false });
  // Office window (rain).
  const ow = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3, 1.8)), rainMat);
  ow.position.set(-23.98, 2.0, 1);
  ow.rotation.y = Math.PI / 2;
  kit.add(ow);
  // The flashlight on the desk.
  const flashGroup = new THREE.Group();
  const body = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.045, 0.04, 0.26, 12)), darkSteel);
  body.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.07, 0.05, 0.08, 14)), steel);
  head.rotation.z = Math.PI / 2;
  head.position.x = 0.16;
  const lens = new THREE.Mesh(kit.track(new THREE.CircleGeometry(0.06, 14)), kit.track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.5 })));
  lens.rotation.y = Math.PI / 2;
  lens.position.x = 0.201;
  flashGroup.add(body, head, lens);
  flashGroup.position.set(-19.5, 0.86, -3.7);
  flashGroup.rotation.y = 0.5;
  kit.add(flashGroup);
  const flashHalo = createParticles({ count: 10, center: [-19.5, 0.95, -3.7], box: [0.5, 0.3, 0.5], color: 0xfff2c0, size: 0.05 });
  kit.add(flashHalo.mesh);
  kit.track(flashHalo);
  kit.interact(flashGroup, () => (state.flashlight ? null : 'Take the flashlight'), () => {
    state.flashlight = true;
    flashGroup.visible = false;
    flashHalo.mesh.visible = false;
    api.grantFlashlight();
    api.sound('pickup', { volume: 0.8 });
    api.message('Flashlight — press F to switch it on or off. Some notes here are only visible in its beam…', 3800);
    api.setObjective('Search the dark Archive (north)');
    return 'pickup';
  });
  kit.interact(profLaptop, 'Read Prof. Adeyemi’s notes', () => {
    api.sound('computer', { volume: 0.6 });
    api.reader({
      kicker: 'Personal log · K. Adeyemi',
      title: 'If you are reading this…',
      body: 'I never trusted the grid to keep the Archive locked, and I trust\n'
        + 'computers even less. So the door code lives where only my lamp\n'
        + 'can find it: phosphor ink, painted along the Archive walls.\n\n'
        + 'Each mark is one digit. The DOTS beside it say where it goes —\n'
        + 'one dot first, four dots last.\n\n'
        + 'Take my flashlight from the desk. It is the only light that\n'
        + 'still works down there.\n\n'
        + 'And if the machine is still humming… the temple remembers.',
    });
    api.journal('Prof. Adeyemi: the Archive code is written in <b>phosphor ink</b> along the Archive walls — visible only in the <b>flashlight</b> beam. Each mark is a digit; its <b>dots</b> give its position (1 dot = first).', 'prof');
    return 'read';
  });
  kit.interact(chalk, 'Read the chalkboard', () => {
    api.reader({
      kicker: 'Chalkboard',
      title: 'Field Test 7 — notes',
      body: 't′ = t / √(1 − v²/c²)\n\nΔφ (drive) ≤ 100% !!!  — we hit 140.\n\n'
        + '3 cores → 3 anchors → 3 eras?\n  PAST · PRESENT · FUTURE\n\n'
        + 'Phosphor ink only glows under a focused beam.\n'
        + 'DON’T sweep fast — let the light linger.',
    });
    return 'read';
  });
  kit.update((dt, t) => {
    officeLamp.intensity = state.power ? 0 : officeLamp.userData.base * (0.9 + 0.1 * Math.sin(t * 9));
    flashHalo.update(t);
  });

  /* ===================================================================
     Archive corridor (north) — dark; phosphor ink holds the code
     =================================================================== */
  floor(-3, -30, 3, -12.3, M.rubber, 'stone', 1.5);
  ceiling(-3.3, -30.3, 3.3, -12.6, 3.6);
  wall(-3.3, -12.6, -3.3, -30, 3.6, M.panels);
  wall(3.3, -12.6, 3.3, -30, 3.6, M.panels);
  // Shelves leave the four ink spots clear (west −15.6/−23.6, east −19.6/−27.6).
  for (const z of [-13.6, -18.0, -21.4, -26.0]) kit.prop('steel-frame-shelves-01', { pos: [-2.7, 0, z], rot: Math.PI / 2, height: 2.1 });
  for (const z of [-14.5, -17.2, -22.2, -25.0]) kit.prop('steel-frame-shelves-01', { pos: [2.7, 0, z], rot: -Math.PI / 2, height: 2.1 });
  kit.prop('cardboard-box-01', { pos: [-2.6, 1.05, -13.6], rot: 0.4, height: 0.35, solid: false });
  kit.prop('cardboard-box-01', { pos: [2.6, 0.32, -23.2], rot: 1.1, height: 0.35, solid: false });
  kit.prop('metal-tool-chest', { pos: [-2.5, 0, -28.5], rot: Math.PI / 2, height: 0.8 });

  const inkMats = [];
  const marks = [];
  const markSpots = [
    [-3.0, 1.55, -15.6, Math.PI / 2], [3.0, 1.45, -19.6, -Math.PI / 2],
    [-3.0, 1.6, -23.6, Math.PI / 2], [3.0, 1.5, -27.6, -Math.PI / 2],
  ];
  const positions = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  markSpots.forEach(([x, y, z, r], i) => {
    const pos = positions[i];
    const digit = codeDigits[pos];
    const tex = kit.canvasTexture(256, 256, (g) => {
      g.clearRect(0, 0, 256, 256);
      g.strokeStyle = g.fillStyle = '#fff';
      g.lineWidth = 7;
      g.beginPath(); g.arc(128, 116, 82, 0, Math.PI * 2); g.stroke();
      g.font = 'bold 120px monospace';
      g.textAlign = 'center';
      g.fillText(String(digit), 128, 158);
      for (let k = 0; k <= pos; k++) { g.beginPath(); g.arc(128 - pos * 16 + k * 32, 228, 10, 0, Math.PI * 2); g.fill(); }
    });
    const mat = kit.track(createRevealInkMaterial(tex));
    const m = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(1.0, 1.0)), mat);
    m.position.set(x + (r > 0 ? 0.02 : -0.02), y, z);
    m.rotation.y = r;
    kit.add(m);
    inkMats.push(mat);
    marks.push({ mesh: m, pos, digit, seen: 0 });
  });
  // Decoy scribbles (also invisible ink — the archive is full of notes).
  for (const [x, y, z, r, text] of [[3.0, 2.6, -15.8, -Math.PI / 2, 'THE CLOCK LIES'], [-3.0, 2.6, -19.7, Math.PI / 2, 'Δt ≠ 0  →'], [0, 2.75, -29.85, 0, 'AGAIN. AGAIN. AGAIN.']]) {
    const tex = kit.canvasTexture(512, 128, (g) => { g.clearRect(0, 0, 512, 128); g.fillStyle = '#fff'; g.font = 'italic bold 52px Georgia'; g.textAlign = 'center'; g.fillText(text, 256, 82); });
    const mat = kit.track(createRevealInkMaterial(tex, 0x9dffb0));
    const m = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(1.8, 0.45)), mat);
    m.position.set(x + (r > 0 ? 0.02 : r < 0 ? -0.02 : 0), y, z);
    m.rotation.y = r;
    kit.add(m);
    inkMats.push(mat);
  }
  const fl = { on: false, pos: new THREE.Vector3(), dir: new THREE.Vector3() };
  const _toMark = new THREE.Vector3();
  kit.update((dt, t) => {
    api.flashlight();
    Object.assign(fl, api.flashlight());
    for (const mat of inkMats) {
      mat.uniforms.uOn.value = fl.on ? 1 : 0;
      mat.uniforms.uLightPos.value.copy(fl.pos);
      mat.uniforms.uLightDir.value.copy(fl.dir);
      mat.uniforms.uTime.value = t;
    }
    if (!fl.on) return;
    // The same cone test the shader does, in JS: a mark lit for 0.4 s is "read".
    for (const mk of marks) {
      _toMark.subVectors(mk.mesh.position, fl.pos);
      const d = _toMark.length();
      const lit = d < 9 && _toMark.normalize().dot(fl.dir) > 0.94;
      mk.seen = lit ? mk.seen + dt : 0;
      if (mk.seen > 0.4 && !state.marks[mk.pos]) {
        state.marks[mk.pos] = true;
        api.sound('rune', { volume: 0.7, rate: 1.4 });
        const n = state.marks.filter(Boolean).length;
        api.journal(`Archive ink: digit <b>${mk.digit}</b> with <b>${mk.pos + 1}</b> dot${mk.pos ? 's' : ''} → position ${mk.pos + 1} of the code.`, `mark-${mk.pos}`);
        api.message(`Phosphor ink: a ${mk.digit} with ${mk.pos + 1} dot${mk.pos ? 's' : ''}. (${n}/4 — saved to journal, J)`, 3000);
      }
    }
  });

  // Security door + keypad at the end of the corridor.
  const secDoor = slidingDoor(0, -30, 3.2, 3.4, 'x', true);
  wall(-3.3, -30, -1.6, -30, 3.6, M.panels);
  wall(1.6, -30, 3.3, -30, 3.6, M.panels);
  const keypadTex = kit.canvasTexture(128, 192, (g) => {
    g.fillStyle = '#05141c'; g.fillRect(0, 0, 128, 192);
    g.fillStyle = '#6fd3ff';
    g.fillRect(14, 14, 100, 30);
    g.font = 'bold 24px monospace'; g.textAlign = 'center';
    for (let i = 0; i < 12; i++) g.fillText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'][i], 32 + (i % 3) * 32, 78 + Math.floor(i / 3) * 30);
  });
  const keypad = new THREE.Mesh(kit.boxGeo(0.34, 0.5, 0.08, 1), kit.track(new THREE.MeshStandardMaterial({ color: 0x111111, map: keypadTex, emissiveMap: keypadTex, emissive: 0x6fd3ff, emissiveIntensity: 1.2 })));
  keypad.position.set(2.25, 1.45, -29.66);
  kit.add(keypad);
  const keypadLight = kit.pointLight(0x6fd3ff, 1.5, 3, [2.25, 1.5, -29.2]);
  kit.interact(keypad, () => (state.doorOpen ? null : 'Enter the 4-digit security code'), () => {
    api.keypad((entry) => {
      if (entry === code) {
        state.doorOpen = true;
        keypadFlash = { t: 0, ok: true };            // Member 2 · green flash on the pad
        labSound('keypad-ok', { volume: 0.8 });     // silent no-op until Chunk 5
        kit.after(() => secDoor.open(), 300);
        api.message('ACCESS GRANTED — the Archive door slides open.', 2600);
        api.setObjective('Restore the power');
        api.checkpoint(new THREE.Vector3(0, 0, -29), 0, null);
        return true;
      }
      state.wrongCodes++;
      keypadFlash = { t: 0, ok: false };            // Member 2 · red flash on the pad
      labSound('keypad-deny', { volume: 0.8 });     // silent no-op until Chunk 5
      api.penalize(15, 'ACCESS DENIED — security lockout');
      return false;
    });
    return 'read';
  });

  /* ===================================================================
     Power room — rotate conduit tiles to route GRID IN → VAULT OUT
     =================================================================== */
  floor(-8, -46, 8, -30, M.plate, 'metal', 2);
  ceiling(-8.3, -46.3, 8.3, -30.3, 4.6);
  wall(-8.3, -30.3, -8.3, -46.3, 4.6, M.panels);
  wall(8.3, -30.3, 8.3, -46.3, 4.6, M.panels);
  wall(-8.3, -30.3, -1.6, -30.3, 4.6, M.panels);
  wall(1.6, -30.3, 8.3, -30.3, 4.6, M.panels);
  wall(-1.6, -30.3, 1.6, -30.3, 1.2, M.panels, 3.4);
  wall(-8.3, -46.3, 8.3, -46.3, 4.6, M.panels);
  const genA = kit.prop('portable-generator', { pos: [-6, 0, -34], rot: 0.6, height: 0.75 });
  const genB = kit.prop('portable-generator', { pos: [6, 0, -35], rot: -0.4, height: 0.75 });
  // Member 2 · emergency-generator hum — a positional file loop (one per
  // machine) from assets/audio/modern-lab/generator-hum.ogg. Starts only
  // after the audio context is unlocked by a user gesture, stays silent if
  // the file isn't supplied, and is disposed with the era (api.positional
  // registers the handles with the level manager). Room-tone ambience
  // remains Member 1's synthesised era ambience, so nothing stacks.
  const genHums = [
    api.positional('modern-lab:generator-hum', genA, { volume: 0.45, refDistance: 3 }),
    api.positional('modern-lab:generator-hum', genB, { volume: 0.45, refDistance: 3 }),
  ];
  kit.prop('power-box-01', { pos: [-7.75, 1.2, -38], rot: Math.PI / 2, height: 0.6, solid: false });
  kit.prop('power-box-01', { pos: [7.75, 1.2, -40], rot: -Math.PI / 2, height: 0.6, solid: false });
  kit.prop('utility-box-01', { pos: [-7.6, 0, -43], rot: Math.PI / 2, height: 1.2 });
  kit.prop('modular-pipes', { pos: [0, 3.6, -40], rot: Math.PI / 2, height: 1.0, solid: false });
  const roomRed = kit.pointLight(0xff2a14, 10, 16, [0, 3.8, -38]);

  // Member 2 · reusable checkpoint — power room entry. The archive keypad
  // already saves a silent respawn at the door; this second, VISIBLE one
  // fires when the player steps through into the power room (the breaker
  // room), the last stretch before the vault. It goes through the shared
  // api.checkpoint → Player.setCheckpoint, so message + sound + this pad
  // flash confirm it together. Emissive only — no extra light, and the pad
  // is not interactable so it can never block interaction rays.
  const cpPadMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x0c1c26, emissive: 0x6fd3ff, emissiveIntensity: 1.2, roughness: 0.4 }));
  const cpPad = new THREE.Mesh(kit.track(new THREE.RingGeometry(0.55, 0.8, 48)), cpPadMat);
  cpPad.rotation.x = -Math.PI / 2;
  cpPad.position.set(0, 0.02, -31.2);
  kit.add(cpPad);
  const cpPulseMat = kit.track(new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  const cpPulse = new THREE.Mesh(kit.track(new THREE.RingGeometry(0.8, 0.92, 48)), cpPulseMat);
  cpPulse.rotation.x = -Math.PI / 2;
  cpPulse.position.set(0, 0.025, -31.2);
  cpPulse.visible = false;
  kit.add(cpPulse);
  let cpDone = false;
  let cpFlash = 0;
  kit.update((dt, t) => {
    if (!cpDone) {
      // z < −30.8 is reachable only through the archive security door.
      if (api.player.position.z < -30.8) {
        cpDone = true;
        cpFlash = 1.4;
        cpPulse.visible = true;
        api.checkpoint(new THREE.Vector3(0, 0, -31.2), 0);
        return;
      }
      cpPadMat.emissiveIntensity = 1.2 + 0.6 * Math.sin(t * 2.8);   // inviting pulse
      return;
    }
    if (cpFlash > 0) {
      cpFlash = Math.max(0, cpFlash - dt);
      cpPadMat.emissiveIntensity = 1.6 + cpFlash * 4;
      cpPulse.scale.setScalar(1 + (1 - cpFlash / 1.4) * 1.8);
      cpPulseMat.opacity = (0.75 * cpFlash) / 1.4;
      if (cpFlash === 0) cpPulse.visible = false;
      return;
    }
    cpPadMat.emissiveIntensity = 1.6;                              // steady: checkpoint active
  });

  // Console.
  kit.box({ size: [5.2, 3.4, 0.4], pos: [0, 1.9, -45.85], mat: darkSteel, tile: 1, walk: false });
  const labelTex = textTexture(['', ' GRID IN                  VAULT OUT'], { w: 1024, h: 120, bg: '#000', fg: '#6fd3ff', title: '        POWER ROUTING — rotate each conduit tile' });
  const label = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(5, 0.6)), kit.track(createScreenMaterial(labelTex, { color: 0x9fe8ff, power: 1 })));
  label.position.set(0, 3.3, -45.62);
  kit.add(label);
  screens.push(label.material);
  const N = 1, E = 2, S = 4, W = 8;
  const rotMask = (m) => ((m << 1) | (m >> 3)) & 15;   // rotate 90° clockwise
  const TYPES = { straight: N | S, corner: N | E, tee: N | E | S };
  const tileTex = {};
  for (const [name, mask] of Object.entries(TYPES)) {
    tileTex[name] = kit.canvasTexture(256, 256, (g) => {
      g.fillStyle = '#0b1218'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#26323d'; g.lineWidth = 8; g.strokeRect(8, 8, 240, 240);
      g.strokeStyle = '#ffffff'; g.lineWidth = 40; g.lineCap = 'butt';
      const c = 128;
      const ends = { [N]: [c, 0], [E]: [256, c], [S]: [c, 256], [W]: [0, c] };
      for (const bit of [N, E, S, W]) if (mask & bit) { g.beginPath(); g.moveTo(c, c); g.lineTo(...ends[bit]); g.stroke(); }
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 26, 0, Math.PI * 2); g.fill();
    });
  }
  // Layout [row][col]: type, solution rotation. Path: IN→(1,0)→(0,0)→(0,1)→(0,2)→(1,2)→OUT.
  const layout = [
    [['corner', 1], ['straight', 1], ['corner', 2]],
    [['corner', 3], ['tee', 0], ['corner', 0]],
    [['straight', 0], ['corner', 2], ['tee', 1]],
  ];
  const tiles = [];
  const TS = 0.9;
  layout.forEach((row, r) => row.forEach(([type, solRot], c) => {
    const mat = kit.track(new THREE.MeshStandardMaterial({ color: 0x3a4652, map: tileTex[type], emissiveMap: tileTex[type], emissive: 0x6fd3ff, emissiveIntensity: 0 }));
    const m = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(TS * 0.94, TS * 0.94)), mat);
    m.position.set((c - 1) * TS, 1.95 - (r - 1) * TS, -45.62);
    let rot = Math.floor(Math.random() * 4);
    const tile = { mesh: m, mat, type, rot, angle: -rot * Math.PI / 2, r, c, solRot, flash: 0, litBase: 0.05 };
    m.rotation.z = tile.angle;
    kit.add(m);
    kit.interact(m, () => (state.power ? null : 'Rotate the conduit tile'), () => {
      tile.rot = (tile.rot + 1) % 4;
      api.sound('switch', { volume: 0.6, rate: 1.2 });
      const before = litCount;
      evaluateGrid();
      // Member 2 · input feedback: a rotation that connects more conduit
      // bursts white-blue, one that cuts the flow flashes red (sounds land
      // with the Lab audio pass).
      if (litCount > before) { tile.flash = 1.4; tile.mat.emissive.setHex(0xdffaff); labSound('breaker-ok', { volume: 0.7 }); }
      else if (litCount < before) { tile.flash = 1.2; tile.mat.emissive.setHex(0xff4530); labSound('breaker-deny', { volume: 0.7 }); }
      else tile.flash = 0.7;
    });
    tiles.push(tile);
  }));
  const tileAt = (r, c) => tiles.find((t) => t.r === r && t.c === c);
  const maskOf = (t) => { let m = TYPES[t.type]; for (let i = 0; i < t.rot; i++) m = rotMask(m); return m; };
  let litCount = 0;   // Member 2 · tiles carrying power, for rotate feedback
  // Make sure the grid doesn't start solved.
  function evaluateGrid() {
    const lit = new Set();
    const start = tileAt(1, 0);
    if (maskOf(start) & W) {
      const stack = [start];
      lit.add(start);
      while (stack.length) {
        const t = stack.pop();
        const m = maskOf(t);
        for (const [bit, dr, dc, opp] of [[N, -1, 0, S], [E, 0, 1, W], [S, 1, 0, N], [W, 0, -1, E]]) {
          if (!(m & bit)) continue;
          const nb = tileAt(t.r + dr, t.c + dc);
          if (nb && !lit.has(nb) && (maskOf(nb) & opp)) { lit.add(nb); stack.push(nb); }
        }
      }
    }
    litCount = lit.size;
    tiles.forEach((t) => { t.mat.emissiveIntensity = lit.has(t) ? 1.6 : 0.05; t.litBase = t.mat.emissiveIntensity; });
    const out = tileAt(1, 2);
    const solved = lit.has(out) && (maskOf(out) & E);
    if (solved && !state.power) restorePower();
    return solved;
  }
  while (evaluateGridDry()) tiles.forEach((t) => { t.rot = Math.floor(Math.random() * 4); t.angle = -t.rot * Math.PI / 2; t.mesh.rotation.z = t.angle; });
  function evaluateGridDry() {
    const s = state.power; state.power = true; const r = evaluateGrid(); state.power = s; return r;
  }
  kit.update((dt) => tiles.forEach((t) => {
    const target = -t.rot * Math.PI / 2;
    let d = target - t.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    t.angle += d * Math.min(1, dt * 12);
    t.mesh.rotation.z = t.angle;
  }));

  /* ===================================================================
     Power restored — the level transforms
     =================================================================== */
  const workLights = [];
  for (const [x, y, z, i, dist] of [
    [-6, 6.2, -6, 26, 18], [6, 6.2, -6, 26, 18], [-6, 6.2, 6, 26, 18], [6, 6.2, 6, 26, 18],
    [-18, 3.4, 0, 14, 12], [0, 3.2, -18, 10, 10], [0, 3.2, -26, 10, 10], [0, 4.2, -38, 16, 14], [17, 3.6, 0, 14, 12],
  ]) {
    const l = kit.pointLight(0xdcefff, 0, dist, [x, y, z]);
    l.userData.target = i;
    l.visible = false;          // invisible lights cost nothing in the shaders
    workLights.push(l);
  }
  let powerT = -1;
  function restorePower() {
    state.power = true;
    powerT = 0;
    api.sound('power-up', { volume: 1 });
    labSound('power-restored', { volume: 1 });   // Member 2 · Lab cue lands with the audio pass
    api.shake(0.2);
    api.message('POWER RESTORED. Lights stutter on across the facility — the vault unseals.', 3600);
    api.setObjective('Recover the Lab Core from the vault (east of the hall)');
    roomRed.intensity = 0;
    for (const h of genHums) h.dispose();   // generators wind down — mains is back
    for (const b of beacons) { b.spot.visible = false; b.lamp.material.emissiveIntensity = 0; }
    moon.intensity = 0.15;
    for (const s of strips) s.material.emissiveIntensity = 0.3;
    kit.after(() => vaultDoor.open(), 2200);
  }
  kit.update((dt) => {
    if (powerT < 0 || powerT > 4) return;
    powerT += dt;
    workLights.forEach((l, i) => {
      const on = powerT > i * 0.25;
      const flick = powerT < i * 0.25 + 0.4 && Math.random() > 0.5 ? 0.2 : 1;
      l.visible = on;
      l.intensity = on ? l.userData.target * flick : 0;
    });
    const k = Math.min(1, powerT / 1.5);
    tubeOff.emissiveIntensity = k * (Math.random() > 0.15 || powerT > 2 ? 2.4 : 0.3);
    hemi.intensity = 0.18 + k * 0.5;
    hemi.color.setHex(0xbcd4ff);
    screens.forEach((s) => { s.uniforms.uPower.value = k; });
    if (powerT > 1) statusUpdate();
  });
  let statusDone = false;
  function statusUpdate() {
    if (statusDone) return;
    statusDone = true;
    const g = statusTex.image.getContext('2d');
    g.fillStyle = '#02070c'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#9fffc8'; g.font = 'bold 30px monospace'; g.fillText('CHRONOS // STATUS', 20, 42);
    g.font = '22px monospace';
    ['GRID ......... ONLINE', 'VAULT ........ OPEN', 'CONTAINMENT .. STANDBY', 'FIELD DRIVE .. 33%'].forEach((l, i) => g.fillText(l, 20, 84 + i * 30));
    statusTex.needsUpdate = true;
  }
  kit.update((dt, t) => screens.forEach((s) => { s.uniforms.uTime.value = t; }));

  /* ===================================================================
     Vault (east) — containment field around the Lab Core
     =================================================================== */
  floor(12, -5.3, 22.6, 5.3, M.plate2, 'metal', 2);
  ceiling(12, -5.6, 23, 5.6, 4.2);
  wall(23, -5.6, 23, 5.6, 4.2, M.panels);
  wall(12.6, -5.6, 23, -5.6, 4.2, M.panels);
  wall(12.6, 5.6, 23, 5.6, 4.2, M.panels);
  const vaultDoor = slidingDoor(12.3, 0, 3.2, 3.4, 'z', true);
  const pedestal = new THREE.Mesh(kit.cylGeo(0.9, 1.1, 0.8, 32, 1.5), M.plate);
  pedestal.position.set(18, 0.4, 0);
  kit.add(pedestal);
  kit.solidFrom(pedestal);
  const coreMat = kit.track(new THREE.MeshStandardMaterial({ color: 0xd8f6ff, emissive: 0x39b7ff, emissiveIntensity: 4, roughness: 0.15 }));
  const core = new THREE.Mesh(kit.track(new THREE.IcosahedronGeometry(0.36, 1)), coreMat);
  core.position.set(18, 1.6, 0);
  kit.add(core);
  const coreLight = kit.pointLight(0x58d6ff, 12, 8, [18, 1.8, 0]);
  const containMat = q.transmission
    ? kit.track(new THREE.MeshPhysicalMaterial({ color: 0xe8f8ff, roughness: 0.03, transmission: 1, thickness: 0.4, ior: 1.5, transparent: true }))
    : kit.track(new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.05, transparent: true, opacity: 0.22 }));
  const glassTube = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.75, 0.75, 1.9, 40, 1, true)), containMat);
  glassTube.position.set(18, 1.75, 0);
  kit.add(glassTube);
  const fieldMat = kit.track(createBarrierMaterial(0x58d6ff));
  const field = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.95, 0.95, 2.2, 48, 8, true)), fieldMat);
  field.position.set(18, 1.85, 0);
  kit.add(field);
  const fieldProxy = kit.proxy({ size: [2, 2.6, 2], pos: [18, 1.3, 0] });
  const hum = api.positional('force-field', field, { volume: 0.5, refDistance: 2.5 });
  void hum;
  // Console.
  kit.box({ size: [1, 1.1, 0.6], pos: [15.2, 0.55, -3.6], rot: 0.5, mat: darkSteel, tile: 1, walk: false });
  const consoleTex = textTexture(['CONTAINMENT FIELD', '', '> STATUS: ENGAGED', '> PRESS [E] TO', '  DISENGAGE'], { w: 512, h: 320, title: '' });
  const consoleScreen = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(0.8, 0.5)), kit.track(createScreenMaterial(consoleTex, { color: 0x9fe8ff, power: 0 })));
  consoleScreen.position.set(15.35, 1.25, -3.35);
  consoleScreen.rotation.set(-0.6, 0.5, 0, 'YXZ');
  kit.add(consoleScreen);
  screens.push(consoleScreen.material);
  let fieldT = -1;
  kit.interact(consoleScreen, () => (!state.power || state.fieldDown ? null : 'Disengage the containment field'), () => {
    state.fieldDown = true;
    fieldT = 0;
    api.sound('force-field', { volume: 0.9, rate: 0.6 });
    api.message('Containment disengaged. The glass sinks away from the Lab Core.', 2800);
    api.setObjective('Take the Lab Core');
    return 'read';
  });
  kit.update((dt, t) => {
    fieldMat.uniforms.uTime.value = t;
    core.rotation.y += dt;
    core.position.y = (state.fieldDown ? 1.6 : 1.6) + Math.sin(t * 2) * 0.08;
    coreLight.intensity = 10 + Math.sin(t * 3) * 2;
    if (fieldT >= 0 && fieldT < 2) {
      fieldT += dt;
      fieldMat.uniforms.uDissolve.value = Math.min(1, fieldT / 1.2);
      glassTube.position.y = 1.75 - Math.min(1, fieldT / 1.6) * 2.2;
      if (fieldT > 1.2) { field.visible = false; kit.removeCollider(fieldProxy); }
    }
  });
  kit.interact(core, () => (state.fieldDown && !state.coreTaken ? 'Take the Lab Core' : null), () => {
    state.coreTaken = true;
    labSound('core-pickup', { volume: 0.7 });   // Member 2 · Lab take cue, layered under the shared core-get fanfare
    core.visible = false;
    coreLight.intensity = 0;
    api.completeLevel(core.position);
    return 'pickup';
  });

  /* ===================================================================
     Member 2 — power-restoration payoff (completion-guide task 3)
     The base game already flickers the work lights, tubes, hemisphere and
     screens on over ~1.5–2 s (the powerT updater above). This section
     completes the transformation with cheap tricks — no new lights, no
     shadow casters, nothing allocated per frame:
       · the emergency reds — power-room lamp, beacon lamps and rotating
         spots, floor strips, moonlight — FADE out over ~1.4 s instead of
         cutting to black the moment the grid accepts the route,
       · the fog lifts from near-black to a cool powered blue-grey and
         thins a little, so the far ends of the hall read brighter,
       · the glass (temple pit panel, vault containment tube) is set to
         catch more of the environment once the hall is lit.
     Moon and strip end values (0.15 / 0.3) are restorePower()'s own
     targets, so this only softens the journey between the two states.
     =================================================================== */
  const emergency = {
    roomRed: roomRed.intensity,
    lamp: redLamp.emissiveIntensity,
    moon: moon.intensity,
    strips: stripMat.emissiveIntensity,
    spots: beacons.map((b) => b.spot.intensity),
  };
  const fogFrom = scene.fog.color.clone();
  const fogTo = new THREE.Color(0x101a2a);       // powered cool blue-grey
  const fogDensity0 = scene.fog.density;
  const glassMats = [glassMat, containMat];
  kit.update(() => {
    if (powerT < 0 || powerT > 4 || !state.power) return;
    const k = THREE.MathUtils.clamp(1 - powerT / 1.4, 0, 1);   // 1 → 0
    roomRed.intensity = emergency.roomRed * k;
    redLamp.emissiveIntensity = emergency.lamp * k;
    moon.intensity = 0.15 + (emergency.moon - 0.15) * k;
    stripMat.emissiveIntensity = 0.3 + (emergency.strips - 0.3) * k;
    beacons.forEach((b, i) => { b.spot.visible = k > 0.001; b.spot.intensity = emergency.spots[i] * k; });
    scene.fog.color.lerpColors(fogFrom, fogTo, 1 - k);
    scene.fog.density = 0.013 + (fogDensity0 - 0.013) * k;
    for (const m of glassMats) m.envMapIntensity = 1.6 - 0.6 * k;
  });

  /* ===================================================================
     Member 2 — puzzle readability polish (completion-guide task 2)
     · Near-glints: a soft halo pulses over the current clue/interactable
       while the player is close, then hides once that step is done. One
       shared texture; per-glint sprite materials are all tracked for
       disposal, and the update loop allocates nothing per frame.
     · Correct vs wrong input: the security keypad and the conduit tiles
       flash green/white-blue or red. Sound calls are silent no-op hooks
       until the Lab audio pass (Chunk 5) supplies the files.
     =================================================================== */
  const glintTex = kit.canvasTexture(128, 128, (g) => {
    const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
  });
  const glints = [];
  function glint(x, y, z, { radius = 6, size = 0.5, max = 0.55, color = 0x9fe8ff, until, when } = {}) {
    const mat = kit.track(new THREE.SpriteMaterial({ map: glintTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.set(size, size, 1);
    s.visible = false;
    kit.add(s);
    glints.push({ sprite: s, mat, x, z, radius, size, max, phase: glints.length * 1.7, o: 0, until, when });
  }
  glint(10.55, 1.45, 6.6, { radius: 6.5, until: () => state.readIncident });            // incident laptop, east workbench
  glint(-18.6, 1.4, -3.9, { radius: 5, until: () => state.flashlight });                // Prof. Adeyemi's laptop
  glint(2.25, 2.15, -29.66, { until: () => state.doorOpen });                           // security keypad
  glint(0, 3.35, -45.6, { radius: 7.5, size: 0.7, until: () => state.power });          // power-routing console
  glint(15.35, 1.95, -3.35, { when: () => state.power, until: () => state.fieldDown }); // vault containment console
  // The hidden phosphor digits: while the flashlight is on, a faint halo marks
  // walls worth sweeping — the digit itself still only appears in the beam.
  for (const mk of marks) {
    const p = mk.mesh.position;
    glint(p.x - Math.sign(p.x || 1) * 0.55, p.y + 0.12, p.z,
      { radius: 4.5, size: 0.3, max: 0.26, when: () => fl.on, until: () => state.marks[mk.pos] });
  }
  kit.update((dt, t) => {
    const px = api.player.position.x;
    const pz = api.player.position.z;
    for (const g of glints) {
      if (g.until && g.until()) { g.sprite.visible = false; g.o = 0; continue; }
      const near = Math.hypot(px - g.x, pz - g.z) < g.radius && (!g.when || g.when());
      const target = near ? g.max * (0.62 + 0.38 * Math.sin(t * 3 + g.phase)) : 0;
      g.o += (target - g.o) * Math.min(1, dt * 9);
      if (g.o < 0.012 && !near) { g.sprite.visible = false; continue; }
      g.sprite.visible = true;
      g.mat.opacity = g.o;
      const s = g.size * (0.88 + 0.16 * Math.sin(t * 3 + g.phase));
      g.sprite.scale.set(s, s, 1);
    }
  });

  // Keypad entry feedback: the physical keypad (and its little light) pulse
  // green on the right code, red on a wrong one. The red flash outlasts the
  // keypad panel so it is still pulsing when the player steps back from it.
  let keypadFlash = null;
  kit.update((dt) => {
    if (!keypadFlash) return;
    const f = keypadFlash;
    f.t += dt;
    if (f.t > (f.ok ? 1.8 : 2.8)) {
      keypadFlash = null;
      keypad.material.emissive.setHex(0x6fd3ff);
      keypad.material.emissiveIntensity = 1.2;
      keypadLight.color.setHex(0x6fd3ff);
      keypadLight.intensity = 1.5;
      return;
    }
    const on = Math.sin(f.t * (f.ok ? 8 : 12)) > -0.2 ? 1 : 0;
    const hex = f.ok ? 0x35ff96 : 0xff3524;
    keypad.material.emissive.setHex(hex);
    keypad.material.emissiveIntensity = 1.2 + 2.4 * on;
    keypadLight.color.setHex(hex);
    keypadLight.intensity = 1.5 + 2.2 * on;
  });

  // Conduit tiles: each flash decays back onto the "carrying power" glow
  // that evaluateGrid() maintains (litBase), so the two never fight.
  kit.update((dt) => {
    for (const t of tiles) {
      if (t.flash <= 0) continue;
      t.flash = Math.max(0, t.flash - dt * 2.4);
      t.mat.emissiveIntensity = t.litBase + t.flash * 1.5;
      if (t.flash === 0) t.mat.emissive.setHex(0x6fd3ff);
    }
  });

  /* ===================================================================
     Dust motes, hints, objectives, minimap marker
     =================================================================== */
  const dust = createParticles({ count: 120, center: [0, 3, 0], box: [22, 6, 22], color: 0xbfd8ff, size: 0.035 });
  kit.add(dust.mesh);
  kit.track(dust);
  kit.update((dt, t) => dust.update(t));

  let markerStep = -1;
  const _m = new THREE.Vector3();
  const CARD = {
    flashlight: { kicker: 'New tool · Flashlight', title: 'The flashlight reveals hidden ink',
      html: '<ul><li>Press <kbd>F</kbd> to switch it on or off.</li><li>Prof. Adeyemi wrote the Archive code in <b>phosphor ink</b> that only glows inside the beam.</li><li>Go to the dark <b>Archive (north)</b> and sweep the walls <b>slowly</b>.</li></ul>' },
    archive: { kicker: 'Puzzle · The Archive', title: 'Find the four ink digits',
      html: '<ul><li>Point the flashlight at the walls between the shelves and hold it there.</li><li>Each mark is a <b>digit</b> with <b>dots</b> under it: 1 dot = first digit … 4 dots = last.</li><li>Found digits are saved in your journal (<kbd>J</kbd>). Then use the <b>keypad</b> by the door at the end.</li></ul>' },
    power: { kicker: 'Puzzle · Power room', title: 'Route the power',
      html: '<ul><li>Look at a tile on the wall console and press <kbd>E</kbd> to rotate it.</li><li>Connect <b>GRID IN</b> (left, middle row) to <b>VAULT OUT</b> (right, middle row).</li><li>Tiles carrying power <b>light up</b> — follow the glow.</li></ul>' },
  };
  api.setChecklist(() => {
    const n = state.marks.filter(Boolean).length;
    const steps = [
      ['Read the incident log (east workbench)', state.readIncident],
      ['Take the flashlight from Prof. Adeyemi’s office (west)', state.flashlight],
      [`Reveal the ink digits in the dark Archive (${n}/4)`, n === 4 || state.doorOpen],
      ['Open the Archive door with the keypad code', state.doorOpen],
      ['Route power in the power room', state.power],
      ['Drop the vault’s containment field (east)', state.fieldDown],
      ['Take the Lab Core', state.coreTaken],
    ];
    const active = steps.findIndex((s) => !s[1]);
    return steps.map(([text, done], i) => ({ text, state: done ? 'done' : i === active ? 'active' : 'todo' }));
  });
  kit.update(() => {
    const p = api.player.position;
    if (state.flashlight) api.tutorial('flashlight', CARD.flashlight, 14);
    if (state.flashlight && p.z < -12.8) {
      api.tutorial('archive', CARD.archive, 15);
      api.say('archive', [['Ari', 'Pitch black… If the professor really wrote the code in phosphor ink, my flashlight should pick it up.', 5]]);
    }
    if (state.doorOpen && p.z < -30.8) {
      api.tutorial('power', CARD.power, 15);
      api.say('power', [['Ari', 'The main power console. If I can get the current flowing to the vault, everything should come back on.', 5]]);
    }
    if (state.power) api.say('powered', [['Ari', 'Power’s back! The vault should be open now — east side of the hall.', 4]]);
  });
  api.setHint(() => {
    const p = api.player.position;
    const n = state.marks.filter(Boolean).length;
    if (state.coreTaken) return '';
    if (!state.readIncident) return 'Read the laptop on the east workbench, near the windows.';
    if (!state.flashlight) return 'Prof. Adeyemi’s office is through the west door. Her desk lamp is still on.';
    if (!state.doorOpen) {
      if (p.z > -12.6) return 'The Archive is north of the hall. Switch the flashlight on (F).';
      if (n < 4) return `Sweep the Archive walls slowly with your flashlight. Ink marks found: ${n}/4.`;
      return 'Enter the four digits at the keypad — in dot order (1 dot first).';
    }
    if (!state.power) return 'Rotate the conduit tiles until power flows from GRID IN to VAULT OUT.';
    if (!state.fieldDown) return 'The vault is east of the experiment hall. Use the console to drop the field.';
    return 'Take the Lab Core.';
  });
  kit.update(() => {
    const p = api.player.position;
    if (!state.inOffice && p.x < -12.6) { state.inOffice = true; if (!state.readIncident) api.setObjective('Find Prof. Adeyemi’s notes'); }
    if (!state.inPower && p.z < -30.6) { state.inPower = true; }
    let step = 6;
    if (!state.readIncident) step = 0;
    else if (!state.flashlight) step = 1;
    else if (state.marks.filter(Boolean).length < 4 && !state.doorOpen) step = 2;
    else if (!state.doorOpen) step = 3;
    else if (!state.power) step = 4;
    else if (!state.coreTaken) step = 5;
    if (step !== markerStep) {
      markerStep = step;
      const spots = [[10.5, 6.6], [-19.5, -3.7], [0, -21], [2.2, -29.6], [0, -45], [18, 0]];
      api.setMarker(step < 6 ? _m.set(spots[step][0], 0, spots[step][1]) : null, 0x6fd3ff);
    }
  });

  const debug = {
    state, code,
    readLogs() { incidentLaptop.userData.onInteract(); },
    takeFlashlight() { flashGroup.userData.onInteract(); },
    revealAll() { marks.forEach((mk) => { state.marks[mk.pos] = true; }); },
    openDoor() { state.doorOpen = true; secDoor.open(); },
    solveGrid() { tiles.forEach((t) => { t.rot = t.solRot; }); evaluateGrid(); },
    dropField() { consoleScreen.userData.onInteract(); },
    takeCore() { core.userData.onInteract(); },
  };

  return kit.result({
    spawn: new THREE.Vector3(0, 0, 9.5),
    spawnYaw: 0,
    bounds: 60,
    killY: -10,
    debug,
  });
}
