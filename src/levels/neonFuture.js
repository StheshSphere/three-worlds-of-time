import * as THREE from 'three';
import { createParticles, createBeam } from '../shaders/effects.js';
import { createBarrierMaterial, createScreenMaterial } from '../shaders/labShaders.js';
import { createBeaconMaterial } from '../shaders/beacon.js';
import { createCity, createGridFloor, createTraffic, createStars, createDistantLights, phaseMaterial } from '../shaders/neonShaders.js';

/**
 * LEVEL 3 — THE FUTURE: "The Fractured Skyline".  Verb: SURVIVE.
 *
 * What this level does that the others don't: the ENVIRONMENT is the enemy
 * and timing is everything. You gain a new ability — the Chrono-Dash
 * (Q / right-click): a burst of speed that also PHASES you through energy
 * barriers. The course is a gauntlet over a bottomless neon city:
 *
 *   1. Dash gap — too wide to jump, the dash is required.            z  −7 … −15
 *   2. Moving platforms riding sine paths (they carry you).           z −25 … −40
 *   3. Phase platforms dissolving in and out of time in a wave.        z −52 … −76
 *   4. Gauntlet: pulsing barriers (dash through!) + sweeping lasers.   z −86 … −104
 *   5. Collapse run: the bridge crumbles under you while a time-rift
 *      chases you up to the Neon Core.                                z −110 … −142
 *   6. Sequence lock: the core sits in a containment field — three
 *      colour-cycling nodes, touched in the colour order the holo panel
 *      shows. Deliberately small; the level stays a timing gauntlet.
 *
 * New ways to fail: falling into the city, barrier shocks, laser sweeps,
 * and being caught by the rift. Checkpoints after every section.
 */
export const meta = {
  name: 'The Future',
  numeral: 'III',
  title: 'The Future',
  subtitle: 'The Fractured Skyline · 2187',
  objective: 'Cross the collapsing skyline to the Neon Core',
  music: 'neon',
  ambience: 'neon',
  sky: 'neon',
  stability: 360,
  accent: 0xff5be0,
  surface: 'metal',
  sun: { color: 0xa9d8ff, intensity: 1.4, extent: 20 },
  fallPenalty: 12,
  introCard: {
    kicker: 'The Future · Your goal', title: 'Survive the collapsing skyline',
    html: '<ul><li>New ability — <b>Chrono-Dash</b>: press <kbd>Q</kbd> or <b>right-click</b> (works in mid-air).</li>'
      + '<li>The first gap is too wide to jump: <b>sprint</b> (<kbd>Shift</kbd>), <b>jump</b> (<kbd>Space</kbd>), then <b>dash</b> in the air.</li>'
      + '<li>Falling costs stability, but you restart from the last <b>checkpoint</b>. Follow the <b>◆ marker</b> to the Neon Core.</li>'
      + '<li>The core is sealed — break the small <b>sequence lock</b> at the end to take it.</li></ul>',
  },
};

export function build(kit, api) {
  const scene = api.scene;
  scene.fog = new THREE.FogExp2(0x1a0726, 0.0085);
  kit.light(new THREE.HemisphereLight(0x8a5aff, 0x12041e, 0.6));

  const deck = kit.material('metal-plate-02', { metal: true, tint: 0x5a6070, roughness: 0.45 });
  const deckDark = kit.material('metal-plate', { metal: true, tint: 0x3a3f4c, roughness: 0.5 });
  const cyan = kit.track(new THREE.MeshStandardMaterial({ color: 0x041418, emissive: 0x27e0ff, emissiveIntensity: 2.6 }));
  const magenta = kit.track(new THREE.MeshStandardMaterial({ color: 0x1a0414, emissive: 0xff3fd0, emissiveIntensity: 2.6 }));
  const underGlow = kit.track(new THREE.MeshBasicMaterial({ color: 0x5a1a8a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));

  const state = { section: 0, riftActive: false, coreTaken: false, puzzleSolved: false, puzzleStep: 0, puzzleCd: 0, reached: [false, false, false, false, false] };
  const checkpoints = [
    new THREE.Vector3(0, 0, 4),
    new THREE.Vector3(0, 0.5, -18),
    new THREE.Vector3(0, 1.0, -46),
    new THREE.Vector3(0, 1.5, -81),
    new THREE.Vector3(0, 1.5, -107),
  ];

  /* ===================================================================
     helpers
     =================================================================== */
  /** A floating platform: textured deck + neon edge trims + underglow. */
  function platform(x, z, w, d, top, trim = cyan, { mat = deck, parent = null } = {}) {
    const thick = 0.7;
    const g = new THREE.Group();
    const body = kit.box({ size: [w, thick, d], pos: [0, -thick / 2, 0], mat, tile: 2, solid: false, walk: false, parent: g, map: false, surface: 'metal' });
    for (const [px, pz, sw, sd] of [[0, d / 2, w, 0.1], [0, -d / 2, w, 0.1], [w / 2, 0, 0.1, d], [-w / 2, 0, 0.1, d]]) {
      const strip = new THREE.Mesh(kit.boxGeo(sw + 0.02, 0.08, sd + 0.02, 1), trim);
      strip.position.set(px, 0.0, pz);
      g.add(strip);
    }
    const glow = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(w * 1.2, d * 1.2)), underGlow);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -thick - 0.05;
    g.add(glow);
    g.position.set(x, top, z);
    if (parent) parent.add(g); else kit.add(g);
    g.updateMatrixWorld(true);
    kit.walkables.push(body);
    kit.mapShape(w, d, x, top, z, trim === cyan ? 0x1d5a66 : 0x6a1d5c);
    body.userData.surface = 'metal';
    return { group: g, body };
  }

  /* ===================================================================
     The city, the void and the sky traffic
     =================================================================== */
  const city = createCity({ count: Math.round(260 * (api.quality.grass > 0.5 ? 1 : 0.6)), inner: 24, outer: 170, avoid: (x, z) => Math.abs(x) < 20 && z < 25 && z > -160 });
  kit.add(city.mesh);
  kit.track(city);
  const grid = createGridFloor();
  grid.mesh.position.y = -118;
  kit.add(grid.mesh);
  kit.track(grid);
  const traffic = createTraffic({ count: 160, length: 420, zCenter: -70 });
  kit.add(traffic.mesh);
  kit.track(traffic);
  const data = createParticles({ count: 260, center: [0, 2, -70], box: [40, 30, 170], color: 0x6ff0ff, size: 0.07, rise: 0.6 });
  kit.add(data.mesh);
  kit.track(data);
  // Sky depth for pennies: a twinkling star dome and hovering city lights
  // (each ONE GPU-animated Points draw — see docs/SHADERS.md), plus a
  // second, magenta mote layer drifting up past the decks.
  const stars = createStars({ count: Math.round(650 * (api.quality.grass > 0.5 ? 1 : 0.5)) });
  kit.add(stars.mesh);
  kit.track(stars);
  const cityLights = createDistantLights({ count: Math.round(110 * (api.quality.grass > 0.5 ? 1 : 0.6)), avoid: (x, z) => Math.abs(x) < 24 && z < 25 && z > -160 });
  kit.add(cityLights.mesh);
  kit.track(cityLights);
  const motes = createParticles({ count: 150, center: [0, -2, -70], box: [64, 22, 170], color: 0xff9ae8, size: 0.05, rise: 0.25 });
  kit.add(motes.mesh);
  kit.track(motes);
  kit.update((dt, t) => { city.update(t, scene); grid.update(t); traffic.update(t); data.update(t); stars.update(t); cityLights.update(t); motes.update(t); });

  // Holographic billboards hovering beside the course.
  const holoTexts = [
    ['CHRONO-NET', '2187 · LIVE FOREVER', '#ff5be0'],
    ['WARNING', 'TEMPORAL FRACTURE', '#ffcc33'],
    ['ADEYEMI DYNAMICS', 'we build tomorrow', '#6ff0ff'],
    ['THE HOURGLASS', 'IS BREAKING', '#ff5be0'],
  ];
  const holos = [];
  holoTexts.forEach(([a, b, col], i) => {
    const tex = kit.canvasTexture(512, 256, (g) => {
      g.clearRect(0, 0, 512, 256);
      g.strokeStyle = col; g.lineWidth = 6; g.strokeRect(10, 10, 492, 236);
      g.fillStyle = col; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText(a, 256, 112);
      g.font = '36px sans-serif'; g.fillText(b, 256, 178);
      // tiny hourglass icon
      g.lineWidth = 4; g.beginPath(); g.moveTo(40, 40); g.lineTo(80, 40); g.lineTo(40, 100); g.lineTo(80, 100); g.closePath(); g.stroke();
    });
    const mat = kit.track(createScreenMaterial(tex, { color: 0xffffff, power: 1, holo: true }));
    const m = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(9, 4.5)), mat);
    const side = i % 2 ? 1 : -1;
    m.position.set(side * (15 + i), 7 + i * 1.5, -20 - i * 30);
    m.rotation.y = -side * 0.5;
    kit.add(m);
    holos.push(mat);
  });
  kit.update((dt, t) => holos.forEach((h) => { h.uniforms.uTime.value = t; }));

  /* ===================================================================
     0. Start plaza (Time Machine) + 1. dash gap
     =================================================================== */
  platform(0, 0, 14, 14, 0, cyan, { mat: deckDark });
  platform(0, -19, 8, 8, 0.5, magenta);
  // Gap guide arrows (emissive chevrons on the plaza edge).
  const chevronTex = kit.canvasTexture(256, 128, (g) => { g.clearRect(0, 0, 256, 128); g.strokeStyle = '#6ff0ff'; g.lineWidth = 14; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(40 + i * 70, 20); g.lineTo(80 + i * 70, 64); g.lineTo(40 + i * 70, 108); g.stroke(); } });
  const chev = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3, 1.5)), kit.track(new THREE.MeshBasicMaterial({ map: chevronTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  chev.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  chev.position.set(0, 0.02, -5.6);
  kit.add(chev);
  // Repeat the arrows at the two later decision points (same texture/material).
  for (const [cx, cy, cz] of [[0, 0.52, -15.6], [0, 1.52, -105.6]]) {
    const c = new THREE.Mesh(chev.geometry, chev.material);
    c.rotation.copy(chev.rotation);
    c.position.set(cx, cy, cz);
    kit.add(c);
  }
  // Holographic guide arrows: the same chevron hung over each section
  // entry, tilted toward the approach, bobbing and pulsing — the route
  // reads from mid-gap even when the ◆ marker hides behind a tower.
  const arrowGeo = kit.track(new THREE.PlaneGeometry(4.5, 2.25));
  const arrowMat = kit.track(new THREE.MeshBasicMaterial({ map: chevronTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const arrows = [];
  for (const [ax, ay, az, ph] of [[0, 2.4, -12.5, 0], [0, 2.9, -23.5, 1.7], [0, 3.3, -50.5, 3.1], [0, 3.8, -84.5, 4.4], [0, 4.2, -110.5, 5.6]]) {
    const a = new THREE.Mesh(arrowGeo, arrowMat);
    a.rotation.set(-Math.PI / 2 + 0.4, 0, Math.PI / 2);   // flat chevron, tipped up ~23°
    a.position.set(ax, ay, az);
    a.userData.baseY = ay;
    a.userData.phase = ph;
    kit.add(a);
    arrows.push(a);
  }
  kit.update((dt, t) => {
    arrowMat.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.1));
    for (const a of arrows) a.position.y = a.userData.baseY + Math.sin(t * 1.4 + a.userData.phase) * 0.18;
  });

  /* ===================================================================
     2. Moving platforms
     =================================================================== */
  // Tuned against the player's envelope (sprint 8.2 m/s; a flat jump is
  // ≈ 0.73 s of air ≈ 3.3 m walking / 6.0 m sprinting; dash adds 3.8 m):
  // 3.6 m pads leave real landing room and the amplitudes put the
  // worst-case lateral offset just past a walking hop — so "jump when it
  // lines up" stays true instead of "pray the sine is kind".
  const movers = [];
  for (const [z, axis, amp, speed, phase, trim] of [[-27, 'x', 3.8, 0.8, 0, cyan], [-33, 'y', 1.2, 0.95, 1.3, magenta], [-39, 'x', 4.2, 0.72, 2.6, cyan]]) {
    const p = platform(0, z, 3.6, 3.6, 0.6, trim);
    p.body.userData.carryDelta = new THREE.Vector3();
    // Each pad is a levitating machine: a low engine note, detuned per
    // pad so the three read as separate motors rather than one hum.
    p.sfx = api.positional('hum', p.group, { volume: 0.16, refDistance: 3.5, rolloff: 1.8, rate: 0.85 + movers.length * 0.09 });
    movers.push({ ...p, base: p.group.position.clone(), axis, amp, speed, phase });
  }
  platform(0, -47, 8, 7, 1.0, magenta);   // deeper catch pad: the hop off the last mover is 2.7 m
  const _prevPos = new THREE.Vector3();   // scratch — no per-frame allocations
  kit.update((dt, t) => {
    for (const m of movers) {
      _prevPos.copy(m.group.position);
      m.group.position.copy(m.base);
      m.group.position[m.axis] += Math.sin(t * m.speed + m.phase) * m.amp;
      m.group.updateMatrixWorld(true);
      m.body.userData.carryDelta.subVectors(m.group.position, _prevPos);
    }
  });

  /* ===================================================================
     3. Phase platforms (dissolve wave)
     =================================================================== */
  const phases = [];
  const PERIOD = 4.6;
  for (let i = 0; i < 5; i++) {
    const mat = phaseMaterial(deck, i % 2 ? 0xff5be0 : 0x6ff0ff);
    kit.track(mat);
    const p = platform(0, -53 - i * 5, 3.4, 3.4, 1.0, i % 2 ? magenta : cyan, { mat });
    const sfx = api.positional('hum', p.group, { volume: 0.22, refDistance: 3, rolloff: 2, rate: 1.25 + i * 0.06 });
    phases.push({ ...p, mat, sfx, offset: i * 0.85, solid: true, c: 0 });
  }
  platform(0, -81, 8, 7, 1.5, cyan);   // phase-wave catch pad (2.8 m gap off the last dissolving tile)
  kit.update((dt, t) => {
    for (const ph of phases) {
      // 0 → 2.6 s solid, then dissolve, 1.1 s gone, rematerialise.
      const c = (t + ph.offset) % PERIOD;
      ph.c = c;                  // read by debug() for automated tests
      let v = 1;
      if (c > 2.6 && c < 3.1) v = 1 - (c - 2.6) / 0.5;
      else if (c >= 3.1 && c < 4.1) v = 0;
      else if (c >= 4.1) v = (c - 4.1) / 0.5;
      ph.mat.userData.phase.uPhase.value = v;
      ph.group.children.forEach((ch) => { if (ch !== ph.body && ch.material !== underGlow) ch.visible = v > 0.05; });
      // The hum dissolves with the platform, so the wave is audible too.
      ph.sfx.sound.setVolume(0.22 * v);
      const solid = v > 0.35;
      if (solid !== ph.solid) {
        ph.solid = solid;
        const idx = kit.walkables.indexOf(ph.body);
        if (solid && idx < 0) kit.walkables.push(ph.body);
        if (!solid && idx >= 0) kit.walkables.splice(idx, 1);
        // Re-materialise shimmer, gated to the tile just ahead so the
        // wave doesn't tick like a clock from across the level.
        if (solid && api.player.position.distanceToSquared(ph.group.position) < 49) api.sound('glitch', { volume: 0.16, rate: 1.5, jitter: 0 });
      }
    }
  });

  /* ===================================================================
     Falling into the city gets its own beat: a time-slip glitch as the
     deck drops away (the era manager's respawn 'warp' only fires at
     killY — the two must stay distinct sounds).
     =================================================================== */
  let fallCued = false;
  kit.update(() => {
    const player = api.player;
    if (player.onGround || player.velocity.y > -9) { fallCued = false; return; }
    if (!fallCued && player.position.y < -2.5) {
      fallCued = true;                           // committed to the void
      api.sound('glitch', { volume: 0.5, rate: 0.5, jitter: 0 });
    }
  });

  /* ===================================================================
     4. Gauntlet: barriers + laser sweepers
     =================================================================== */
  platform(0, -95, 5, 18, 1.5, magenta);
  platform(0, -108, 8, 6, 1.5, cyan);
  const barriers = [];
  for (const [z, offset] of [[-89, 0], [-98.5, 1.45]]) {
    const mat = kit.track(createBarrierMaterial(0xff4fd8));
    const wall = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(5.2, 2.9, 40, 10)), mat);
    wall.position.set(0, 1.5 + 1.45, z);
    kit.add(wall);
    const proxy = kit.proxy({ size: [5.2, 2.9, 0.5], pos: [0, 1.5 + 1.45, z] });
    proxy.userData.onTouch = () => {
      // A dash must never shock: levels.update drops the collider the same
      // frame a dash starts, but this guard keeps the rule true even if the
      // touch and the state toggle meet mid-frame.
      if (api.player.isDashing) return;
      api.hurt({ from: new THREE.Vector3(0, 1.5, z), power: 10, respawn: true, penalty: 8, reason: 'Barrier shock' });
    };
    for (const sx of [-2.75, 2.75]) {
      const post = kit.box({ size: [0.35, 3.2, 0.35], pos: [sx, 1.5 + 1.6, z], mat: deckDark, tile: 1, walk: false, map: false });
      post.material = deckDark;
    }
    const sfx = api.positional('force-field', wall, { volume: 0.4, refDistance: 3 });
    barriers.push({ wall, mat, proxy, sfx, vol: 0.4, wasOn: true, offset, active: true, warn: false, on: true, c: 0, z });
  }
  const lasers = [];
  for (const [z, dir] of [[-93.5, 1], [-102.5, -1]]) {
    const post = new THREE.Mesh(kit.cylGeo(0.22, 0.3, 0.9, 12, 1), deckDark);
    post.position.set(0, 1.5 + 0.45, z);
    kit.add(post);
    // The emitter bollard is solid, like the barriers' side posts. The beam
    // hit test treats the segment's origin as lethal, so a permeable post
    // would zap the exact spot it visually covers; collision now matches
    // the visible emitter (and it is still low enough to jump over).
    kit.proxy({ size: [0.62, 0.9, 0.62], pos: [0, 1.5 + 0.45, z] });
    const beam = createBeam({ radius: 0.07, color: 0xff2a6a });
    kit.add(beam.mesh);
    kit.track(beam);
    lasers.push({ z, dir, beam, y: 1.5 + 0.5, angle: dir > 0 ? 0 : Math.PI });
  }
  // Each laser hums where it sweeps, so the danger is audible before it is seen.
  lasers.forEach((l, i) => api.positional('hum', l.beam.mesh, { volume: 0.15, refDistance: 2.5, rolloff: 2, rate: 1.1 - i * 0.2 }));
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _hitFrom = new THREE.Vector3();
  kit.update((dt, t) => {
    const player = api.player;
    const p = player.position;
    for (const b of barriers) {
      // 1.55 s on / 1.35 s off (2.9 s cycle) — the longer off window fits a
      // sprint-through plus a laser jump. The barriers sit half a cycle
      // apart (offset 1.45), so leaving barrier 1 the moment it dims puts
      // you at barrier 2 just as it dims; the dash covers any misjudged leave.
      const c = (t + b.offset) % 2.9;
      const on = c < 1.55;
      b.on = on;
      b.c = c;                     // read by debug() for automated tests
      b.mat.uniforms.uTime.value = t;
      b.mat.uniforms.uActive.value += ((on ? 1 : 0) - b.mat.uniforms.uActive.value) * Math.min(1, dt * 10);
      b.mat.uniforms.uDissolve.value = on ? 0 : 0.55;
      // The buzz breathes with the field — full charge while on, a faint
      // idle leak while off — so the cycle is audible before it is visible.
      b.vol += ((on ? 0.4 : 0.07) - b.vol) * Math.min(1, dt * 9);
      b.sfx.sound.setVolume(b.vol);
      // Snap-on crackle at the energise edge, close range only.
      if (on && !b.wasOn && player.position.distanceToSquared(b.wall.position) < 196) api.sound('zap', { volume: 0.1, rate: 1.8, jitter: 0 });
      b.wasOn = on;
      // Warning flash rising edge: a short cue when the player is close enough
      // for it to matter (the flash itself is the shader's uWarn).
      const warn = !on && c > 2.55;
      b.mat.uniforms.uWarn.value = warn ? 1 : 0;
      if (warn && !b.warn && player.position.distanceToSquared(b.wall.position) < 196) api.sound('switch', { volume: 0.22, rate: 1.45, jitter: 0 });
      b.warn = warn;
      // Dashing phases you through even an active barrier.
      const solid = on && !player.isDashing;
      if (solid !== b.active) { b.active = solid; if (solid) kit.addCollider(b.proxy); else kit.removeCollider(b.proxy); }
    }
    for (const l of lasers) {
      l.angle += dt * 1.6 * l.dir;   // a touch slower than v1 — readable sweep, still demands a jump
      const len = 2.45;
      _a.set(0, l.y, l.z);
      _b.set(Math.cos(l.angle) * len, l.y, l.z + Math.sin(l.angle) * len);
      l.beam.set(_a, _b);
      l.beam.update(t);
      // Hit test: distance from the player's feet circle to the beam segment, unless jumping over it.
      const dx = p.x - _a.x;
      const dz = p.z - _a.z;
      const ux = Math.cos(l.angle);
      const uz = Math.sin(l.angle);
      const along = THREE.MathUtils.clamp(dx * ux + dz * uz, 0, len);
      const perp = Math.hypot(dx - ux * along, dz - uz * along);
      if (perp < 0.4 && p.y < l.y + 0.15 && p.y > l.y - 1.5 && !player.isDashing) {
        _hitFrom.set(_a.x + ux * along, p.y, _a.z + uz * along);
        api.hurt({ from: _hitFrom, power: 7, penalty: 6, reason: 'Laser burn' });
      }
    }
  });

  /* ===================================================================
     5. Collapse run + the rift
     =================================================================== */
  const tiles = [];
  const tileZ = [-112, -114.4, -116.8, -119.2, -122.6, -125.0, -127.4, -129.8, -133.4, -135.8];
  tileZ.forEach((z, i) => {
    const top = 1.5 + i * 0.15;
    const p = platform(0, z, 2.8, 2.2, top, i % 2 ? magenta : cyan);
    p.body.userData.tileIndex = i;
    tiles.push({ ...p, home: p.group.position.clone(), timer: -1, vy: 0, fallen: false });
  });
  platform(0, -142, 10, 10, 3.0, magenta);
  const riftMat = kit.track(createBarrierMaterial(0xff7af0));
  const rift = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(36, 26, 60, 20)), riftMat);
  rift.position.set(0, 4, -104);
  rift.visible = false;
  kit.add(rift);
  const riftSparks = createParticles({ count: 120, center: [0, 4, 0], box: [30, 18, 2], color: 0xffb8f6, size: 0.12 });
  rift.add(riftSparks.mesh);
  riftSparks.mesh.position.set(0, -4, 0);
  kit.track(riftSparks);
  let riftZ = -104;
  let riftRumble = null;   // positional handle, created lazily on the first run

  function resetCollapse() {
    tiles.forEach((tile) => {
      tile.group.position.copy(tile.home);
      tile.group.rotation.set(0, 0, 0);
      tile.group.updateMatrixWorld(true);
      tile.timer = -1;
      tile.vy = 0;
      tile.fallen = false;
      tile.group.visible = true;
      if (!kit.walkables.includes(tile.body)) kit.walkables.push(tile.body);
      tile.group.children.forEach((c) => { if (c.material === warnMat && tile.trim) c.material = tile.trim; });
    });
    state.riftActive = false;
    riftZ = -104;
    rift.visible = false;
    if (riftRumble && riftRumble.sound.isPlaying) riftRumble.sound.pause();
  }

  const warnMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 3 }));
  kit.update((dt, t) => {
    const player = api.player;
    const ground = player.groundObject;
    riftMat.uniforms.uTime.value = t;
    riftSparks.update(t);
    // Back on the pre-bridge platform (respawn after a fall or a rift catch): rebuild the bridge.
    if (player.position.z > -110.8 && player.position.z < -104 && (state.riftActive || tiles.some((x) => x.fallen || x.timer >= 0))) resetCollapse();
    // Start the run when the player first steps on the bridge.
    if (!state.riftActive && ground && ground.userData.tileIndex === 0 && !state.coreTaken) {
      state.riftActive = true;
      rift.visible = true;
      if (!riftRumble) riftRumble = api.positional('hum', rift, { volume: 0.55, refDistance: 7, rolloff: 1.3, rate: 0.55 });
      else if (riftRumble.sound.buffer && !riftRumble.sound.isPlaying) riftRumble.sound.play();
      api.sound('crumble', { volume: 0.9 });
      api.shake(0.35);
      api.message('The skyline is collapsing behind you — RUN!', 2400);
    }
    for (const tile of tiles) {
      if (tile.fallen) {
        tile.vy -= 22 * dt;
        tile.group.position.y += tile.vy * dt;
        tile.group.rotation.x += dt * 0.6;
        if (tile.group.position.y < -60) tile.group.visible = false;
        continue;
      }
      if (tile.timer < 0 && ground === tile.body) {
        tile.timer = 0.42;
        tile.group.children.forEach((c) => { if (c.material === magenta || c.material === cyan) { tile.trim = c.material; c.material = warnMat; } });
      }
      if (tile.timer >= 0) {
        tile.timer -= dt;
        tile.group.position.x = tile.home.x + (Math.random() - 0.5) * 0.06;
        if (tile.timer <= 0) {
          tile.fallen = true;
          const idx = kit.walkables.indexOf(tile.body);
          if (idx >= 0) kit.walkables.splice(idx, 1);
          api.sound('crumble', { volume: 0.35, rate: 1.3 });
        }
      }
    }
    if (state.riftActive) {
      riftZ -= dt * 6.4;
      rift.position.z = riftZ;
      riftMat.uniforms.uActive.value = 1;
      if (riftZ < player.position.z + 0.6 && player.position.z > -138) {
        api.hurt({ from: new THREE.Vector3(0, player.position.y, riftZ + 3), power: 4, respawn: true, penalty: 10, reason: 'The rift caught you' });
        kit.after(resetCollapse, 500);
        state.riftActive = false;
      }
      if (player.position.z < -138) {
        state.riftActive = false;
        if (riftRumble && riftRumble.sound.isPlaying) riftRumble.sound.pause();
        riftMat.uniforms.uDissolve.value = 0;
        api.message('You outran the collapse. The Neon Core is on the spire — sealed behind an energy lock.', 2600);
      }
    } else if (rift.visible && player.position.z < -138) {
      riftMat.uniforms.uDissolve.value = Math.min(1, riftMat.uniforms.uDissolve.value + dt * 0.8);
      if (riftMat.uniforms.uDissolve.value >= 1) rift.visible = false;
    }
  });

  /* ===================================================================
     The Neon Core
     =================================================================== */
  const pedestal = new THREE.Mesh(kit.cylGeo(0.8, 1.1, 1.0, 6, 1.5), deckDark);
  pedestal.position.set(0, 3.5, -143);
  kit.add(pedestal);
  kit.solidFrom(pedestal);
  const coreMat = kit.track(new THREE.MeshStandardMaterial({ color: 0xffd0f6, emissive: 0xff3fd0, emissiveIntensity: 4.5, roughness: 0.15 }));
  const core = new THREE.Mesh(kit.track(new THREE.OctahedronGeometry(0.45, 1)), coreMat);
  core.position.set(0, 4.7, -143);
  kit.add(core);
  const coreBeam = createBeam({ radius: 0.5, color: 0xff7ae6 });
  coreBeam.set(new THREE.Vector3(0, 5, -143), new THREE.Vector3(0, 60, -143));
  coreBeam.material.uniforms.uIntensity.value = 0.55;
  kit.add(coreBeam.mesh);
  kit.track(coreBeam);
  const coreLight = kit.pointLight(0xff4fd8, 18, 14, [0, 5.2, -143]);
  // The core is never silent: a bright hum marks it from across the
  // spire — a "hear the goal" cue, like the lab's generator room.
  const coreSfx = api.positional('hum', core, { volume: 0.3, refDistance: 4.5, rolloff: 1.4, rate: 1.5 });
  kit.interact(core, () => (state.coreTaken || !state.puzzleSolved ? null : 'Take the Neon Core'), () => {
    if (state.coreTaken || !state.puzzleSolved) return null;   // the sequence lock gates the core
    state.coreTaken = true;
    core.visible = false;
    coreBeam.mesh.visible = false;
    coreLight.intensity = 0;
    if (coreSfx.sound.isPlaying) coreSfx.sound.pause();
    api.sound('bell', { volume: 0.45, rate: 1.3 });            // chime layered under the shared core-get fanfare
    api.completeLevel(core.position);
    return 'pickup';
  });
  kit.update((dt, t) => {
    core.rotation.y += dt * 1.6;
    core.position.y = 4.7 + Math.sin(t * 2.2) * 0.15;
    coreBeam.update(t);
  });

  /* ===================================================================
     6. Sequence lock — the small finale puzzle. The Neon Core sits in a
     containment field; three colour-cycling energy nodes must be touched
     in the colour order the holo panel shows. All three nodes rotate
     their glow on the same 3.5 s beat, so at any moment each glows a
     DIFFERENT colour — the panel's highlighted chip therefore always
     names exactly one node. Wrong touch resets the lock (−3 s).
     =================================================================== */
  const PUZZLE_COLORS = [0x6ff0ff, 0xff5be0, 0xffcc33];          // cyan / magenta / gold
  const PUZZLE_NAMES = ['cyan', 'magenta', 'gold'];
  const COLOR_HOLD = 3.5;                                        // seconds per colour
  const seq = [0, 1, 2];                                         // shown order, reshuffled per load
  for (let i = seq.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seq[i], seq[j]] = [seq[j], seq[i]]; }
  const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  const containmentMat = kit.track(createBarrierMaterial(0xff5be0));
  const containment = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(1.7, 1.7, 2.8, 40, 1, true)), containmentMat);
  containment.position.set(0, 3.0 + 1.4, -143);
  kit.add(containment);
  const containmentProxy = kit.proxy({ size: [3.4, 2.8, 3.4], pos: [0, 3.0 + 1.4, -143] });
  const fieldSfx = api.positional('force-field', containment, { volume: 0.5, refDistance: 3.5 });

  const nodeGlowTex = kit.canvasTexture(128, 128, (g) => {
    const rad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    rad.addColorStop(0, 'rgba(255,255,255,0.9)');
    rad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
  });
  const nodeBaseGeo = kit.cylGeo(0.26, 0.4, 1.1, 6, 1.5);
  const nodes = [];
  [[-2.9, -140.2], [0, -139.4], [2.9, -140.2]].forEach(([nx, nz], i) => {
    const g = new THREE.Group();
    const pylon = new THREE.Mesh(nodeBaseGeo, deckDark);
    pylon.castShadow = true; pylon.receiveShadow = true;
    pylon.position.y = 0.55;
    g.add(pylon);
    const orbMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x10161c, emissive: PUZZLE_COLORS[0], emissiveIntensity: 3, roughness: 0.3 }));
    const orb = new THREE.Mesh(kit.track(new THREE.IcosahedronGeometry(0.3, 1)), orbMat);
    orb.position.y = 1.5;
    g.add(orb);
    const glowMat = kit.track(new THREE.MeshBasicMaterial({ map: nodeGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: PUZZLE_COLORS[0] }));
    const glow = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(1.6, 1.6)), glowMat);
    glow.position.y = 1.5;
    g.add(glow);
    g.position.set(nx, 3.0, nz);
    kit.add(g);
    g.updateMatrixWorld(true);
    kit.solidFrom(pylon);                    // pylons block; the orbs stay pass-through
    const node = { orb, orbMat, glow, glowMat, i, ci: 0, prevCi: 0, switchAt: -9 };
    nodes.push(node);
    const press = () => activateNode(node);
    const prompt = () => (state.puzzleSolved ? null : `Touch the node (${PUZZLE_NAMES[node.ci]})`);
    kit.interact(orb, prompt, press);
    kit.interact(pylon, prompt, press);
  });

  const panelTex = kit.canvasTexture(512, 256, (g) => drawPanelTo(g));
  const panelMat = kit.track(createScreenMaterial(panelTex, { color: 0xffffff, power: 1, holo: true }));
  const panel = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3.8, 1.9)), panelMat);
  panel.position.set(0, 6.3, -143.8);
  panel.rotation.x = -0.25;
  kit.add(panel);

  function drawPanelTo(g) {
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(8, 2, 18, 0.85)'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#ff5be0'; g.lineWidth = 4; g.strokeRect(8, 8, 496, 240);
    g.textAlign = 'center';
    g.fillStyle = '#ff9ae8'; g.font = 'bold 34px sans-serif';
    g.fillText(state.puzzleSolved ? 'LOCK RELEASED' : 'ENERGY LOCK', 256, 56);
    g.fillStyle = '#9fd8ff'; g.font = '22px sans-serif';
    g.fillText(state.puzzleSolved ? 'the containment field is down' : 'touch the nodes in this colour order', 256, 90);
    for (let i = 0; i < 3; i++) {
      const x = 74 + i * 146, y = 124, w = 96, h = 74;
      const done = state.puzzleSolved || i < state.puzzleStep;
      const active = !state.puzzleSolved && i === state.puzzleStep;
      g.globalAlpha = done ? 0.35 : active ? 1 : 0.7;
      g.fillStyle = cssHex(PUZZLE_COLORS[seq[i]]);
      g.fillRect(x, y, w, h);
      g.globalAlpha = 1;
      g.lineWidth = active ? 6 : 3;
      g.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.35)';
      g.strokeRect(x, y, w, h);
      if (done) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(x + 30, y + 42); g.lineTo(x + 44, y + 56); g.lineTo(x + 72, y + 22); g.stroke();
      }
      if (i < 2) {
        g.strokeStyle = '#ff9ae8'; g.lineWidth = 5;
        g.beginPath();
        g.moveTo(x + w + 10, y + 37); g.lineTo(x + w + 40, y + 37);
        g.moveTo(x + w + 30, y + 27); g.lineTo(x + w + 40, y + 37); g.lineTo(x + w + 30, y + 47);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '18px sans-serif';
    g.fillText(state.puzzleSolved ? 'take the Neon Core' : 'the highlighted colour is the one to touch now — nodes rotate every few seconds', 256, 234);
  }
  function drawPanel() { drawPanelTo(panelTex.image.getContext('2d')); panelTex.needsUpdate = true; }

  function solvePuzzle() {
    if (state.puzzleSolved) return;
    state.puzzleSolved = true;
    state.puzzleStep = 3;
    drawPanel();
    kit.removeCollider(containmentProxy);
    for (const n of nodes) { n.orbMat.emissive.setHex(0xffcc33); n.orbMat.emissiveIntensity = 1.1; n.glowMat.color.setHex(0xffcc33); }
    api.sound('power-up', { volume: 0.85 });
    api.shake(0.2);
    api.message('SIGNAL ACCEPTED — the containment field collapses. Take the Neon Core.', 3200);
  }

  function activateNode(node) {
    if (state.puzzleSolved || state.coreTaken || state.puzzleCd > 0) return null;
    state.puzzleCd = 0.45;                                     // one press per beat
    const want = seq[state.puzzleStep];
    // A node that changed colour less than 0.35 s ago still counts with its
    // previous colour, so a rotation mid-approach can't eat a fair press.
    const ok = node.ci === want || (node.prevCi === want && api.time - node.switchAt < 0.35);
    if (!ok) {
      state.puzzleStep = 0;
      drawPanel();
      api.penalize(3, 'The sequence lock resets');
      api.sound('ui-error', { volume: 0.8 });
      api.shake(0.12);
      return null;
    }
    state.puzzleStep++;
    drawPanel();
    if (state.puzzleStep >= 3) solvePuzzle();
    else api.sound('switch', { volume: 0.6, rate: 1.25 });
    return null;
  }

  kit.update((dt, t) => {
    if (state.puzzleCd > 0) state.puzzleCd -= dt;
    panelMat.uniforms.uTime.value = t;
    containmentMat.uniforms.uTime.value = t;
    if (state.puzzleSolved) {
      // The field burns away; nodes settle into a calm gold "accepted" glow.
      containmentMat.uniforms.uDissolve.value = Math.min(1, containmentMat.uniforms.uDissolve.value + dt * 1.1);
      containmentMat.uniforms.uActive.value = Math.max(0, containmentMat.uniforms.uActive.value - dt * 2);
      if (containmentMat.uniforms.uDissolve.value >= 1 && containment.visible) {
        containment.visible = false;
        if (fieldSfx && fieldSfx.sound.isPlaying) fieldSfx.sound.pause();
      }
      const g = 0.85 + 0.15 * Math.sin(t * 1.6);
      for (const n of nodes) { n.orb.rotation.y += dt * 0.4; n.glowMat.opacity = g; }
      return;
    }
    const base = Math.floor(t / COLOR_HOLD) % 3;
    for (const n of nodes) {
      const ci = (base + n.i) % 3;          // every node a different colour, always
      if (ci !== n.ci) {
        n.prevCi = n.ci; n.ci = ci; n.switchAt = t;
        n.orbMat.emissive.setHex(PUZZLE_COLORS[ci]);
        n.glowMat.color.setHex(PUZZLE_COLORS[ci]);
      }
      n.orb.rotation.y += dt * 1.2;
      n.glow.lookAt(api.camera.position);   // billboard — reads from across the spire
    }
  });

  /* ===================================================================
     Checkpoint beacons — Member 3's second custom shader (see
     src/shaders/beacon.js). One holographic pillar per checkpoint; the
     pulse fires when the checkpoint is earned in the loop below.
     =================================================================== */
  const beaconGeo = kit.track(new THREE.PlaneGeometry(1.3, 2.8));
  const beacons = checkpoints.map((cp) => {
    const mat = kit.track(createBeaconMaterial(0xff5be0));
    const g = new THREE.Group();
    for (const ry of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(beaconGeo, mat);
      q.rotation.y = ry;
      q.position.y = 1.4;
      g.add(q);
    }
    g.position.set(2.4, cp.y, cp.z);
    kit.add(g);
    return { mat, pulse: 0 };
  });
  kit.update((dt, t) => {
    for (const b of beacons) {
      b.pulse = Math.max(0, b.pulse - dt * 0.7);
      b.mat.uniforms.uTime.value = t;
      b.mat.uniforms.uPulse.value = b.pulse;
    }
  });

  // Ground rings mark the gauntlet / collapse checkpoints (same shared
  // api.checkpoint flow as every other era). They breathe gently so the
  // "restart here" point reads from across the walkway.
  const padMat = kit.track(new THREE.MeshBasicMaterial({ color: 0xff5be0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  for (const cp of [checkpoints[3], checkpoints[4]]) {
    const ring = new THREE.Mesh(kit.track(new THREE.RingGeometry(0.55, 0.95, 28)), padMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cp.x, cp.y + 0.03, cp.z);
    kit.add(ring);
  }
  kit.update((dt, t) => { padMat.opacity = 0.34 + 0.18 * (0.5 + 0.5 * Math.sin(t * 2.4)); });

  /* ===================================================================
     Checkpoints, hints, marker
     =================================================================== */
  const sectionZ = [-15, -45, -79, -105];
  // Member 2's shared checkpoint API (api.checkpoint → Player.setCheckpoint)
  // arms on SOLID GROUND at each section line, and the two harsh sections
  // get a task-specific label. The pre-collapse pad at z −107 is the one
  // that matters most: failed runs restart there, not at the level spawn.
  const CP_LABELS = [undefined, undefined, undefined,
    'Checkpoint — barriers ahead: catch them dim, or dash straight through.',
    'Checkpoint — the bridge ahead collapses. Don’t stop.'];
  let markerStep = -1;
  const _m = new THREE.Vector3();
  kit.update(() => {
    const p = api.player.position;
    for (let i = 0; i < sectionZ.length; i++) {
      if (!state.reached[i + 1] && p.z < sectionZ[i] && p.y > 0 && api.player.onGround) {
        state.reached[i + 1] = true;
        state.section = i + 1;
        api.checkpoint(checkpoints[i + 1], 0, CP_LABELS[i + 1]);
        beacons[i + 1].pulse = 1;
        if (i + 1 === 4) resetCollapse();
      }
    }
    const step = state.coreTaken ? 6 : state.section;
    if (step !== markerStep) {
      markerStep = step;
      const spots = [[0, -19], [0, -47], [0, -81], [0, -108], [0, -142]];
      api.setMarker(step < 5 ? _m.set(spots[step][0], 0, spots[step][1]) : null, 0xff5be0);
    }
  });
  const CARD = {
    movers: { kicker: 'Section 2', title: 'Ride the moving platforms', html: '<ul><li>Platforms slide and rise — <b>stand on one and it carries you</b>.</li><li>Jump when the next one lines up with you.</li></ul>' },
    phase: { kicker: 'Section 3', title: 'Platforms phase out of time', html: '<ul><li>These platforms <b>dissolve and re-form</b> in a wave.</li><li>Wait at the edge, then move <b>as soon as the next one is solid</b>. Don’t stand still on a flickering one.</li></ul>' },
    gauntlet: { kicker: 'Section 4', title: 'Barriers and lasers', html: '<ul><li>Pink <b>energy barriers</b> pulse on and off — run through when they dim, or <b>DASH through</b> them even when they’re on.</li><li><b>Jump</b> over the red laser sweepers.</li></ul>' },
    collapse: { kicker: 'Final section', title: 'Outrun the collapse', html: '<ul><li>The bridge <b>falls away</b> just after you step on it, and a time rift is chasing you.</li><li><b>Don’t stop</b> — sprint, jump the gaps and dash if you need to. The Neon Core is on the spire.</li></ul>' },
    puzzle: { kicker: 'Final lock', title: 'Break the sequence lock', html: '<ul><li>The Neon Core sits in a <b>containment field</b>; the panel shows a <b>colour order</b>.</li><li>Every few seconds all three nodes rotate their colour — <b>touch the node currently glowing the highlighted colour</b>, three times in a row.</li><li>A wrong touch resets the lock (−3 s).</li></ul>' },
  };
  api.setChecklist(() => {
    const steps = [
      ['Dash across the wide gap (sprint, jump, Q)', state.reached[1]],
      ['Ride the moving platforms', state.reached[2]],
      ['Cross the phasing platforms', state.reached[3]],
      ['Get through the barrier gauntlet', state.reached[4]],
      ['Outrun the collapse to the spire', api.player.position.z < -138 || state.coreTaken],
      ['Break the sequence lock', state.puzzleSolved],
      ['Take the Neon Core', state.coreTaken],
    ];
    const active = steps.findIndex((s) => !s[1]);
    return steps.map(([text, done], i) => ({ text, state: done ? 'done' : i === active ? 'active' : 'todo' }));
  });
  kit.update(() => {
    if (state.reached[1]) api.tutorial('movers', CARD.movers, 10);
    if (state.reached[2]) api.tutorial('phase', CARD.phase, 11);
    if (state.reached[3]) api.tutorial('gauntlet', CARD.gauntlet, 12);
    if (state.reached[4]) api.tutorial('collapse', CARD.collapse, 10);
    if (state.reached[4] && !state.puzzleSolved && api.player.position.z < -138) api.tutorial('puzzle', CARD.puzzle, 12);
  });
  let introShown = false;
  kit.update((dt, t) => {
    if (!introShown && t > 0.5) {
      introShown = true;
      beacons[0].pulse = 1;
      kit.after(() => { if (!state.coreTaken && !state.disposed) api.message('Your gauntlet hums with stolen time — CHRONO-DASH unlocked: Q or right-click. Dashing phases you through energy barriers.', 5200); }, 4800);
    }
  });
  api.setHint(() => {
    if (state.coreTaken) return '';
    if (state.section >= 4 && api.player.position.z < -138) {
      return state.puzzleSolved
        ? 'The field is down — take the Neon Core on the pedestal.'
        : 'The core is sealed: touch the nodes in the colour order on the panel — the highlighted colour is next.';
    }
    switch (state.section) {
      case 0: return 'The gap is too wide to jump. Sprint, jump, then DASH (Q / right-click) in mid-air.';
      case 1: return 'Ride the moving platforms — time your jumps as they line up.';
      case 2: return 'Platforms phase out of time in a wave. Move when the one ahead is solid.';
      case 3: return 'Barriers pulse on and off — DASH straight through them. Jump the sweeping lasers.';
      default: return 'Don’t stop. The bridge collapses beneath you and the rift is coming.';
    }
  });

  const debug = {
    state,
    goto(i) { api.player.setCheckpoint(checkpoints[i], 0); api.player.reset(); },
    takeCore() { core.userData.onInteract(); },
    collapse() { return { riftActive: state.riftActive, riftZ, fallen: tiles.filter((x) => x.fallen).length }; },
    // Read-only views of the timing hazards for the automated route test.
    gauntlet() {
      return {
        barriers: barriers.map((b) => ({ on: b.on, c: b.c, active: b.active })),
        lasers: lasers.map((l) => ({ angle: l.angle })),
      };
    },
    movers: () => movers.map((m) => ({ x: m.group.position.x, y: m.group.position.y, z: m.group.position.z })),
    phases: () => phases.map((ph) => ({ solid: ph.solid, c: ph.c })),
    puzzle() {
      return {
        solved: state.puzzleSolved, step: state.puzzleStep, seq: [...seq],
        nodes: nodes.map((n) => ({ ci: n.ci, prevCi: n.prevCi })),
      };
    },
    pressNode(i) { return activateNode(nodes[i]); },
    solvePuzzle() {
      for (let s = 0; s < 3 && !state.puzzleSolved; s++) {
        const idx = nodes.findIndex((n) => n.ci === seq[state.puzzleStep]);
        if (idx < 0) break;
        state.puzzleCd = 0;
        activateNode(nodes[idx]);
      }
      return state.puzzleSolved;
    },
  };

  kit.track({ dispose() { state.disposed = true; } });

  return kit.result({
    spawn: checkpoints[0].clone(),
    spawnYaw: 0,
    bounds: 200,
    killY: -22,
    dash: true,
    debug,
  });
}
