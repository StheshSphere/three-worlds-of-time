import * as THREE from 'three';
import { createParticles, createBeam } from '../shaders/effects.js';
import { createRainGlassMaterial, createScreenMaterial, createFloorReflection } from '../shaders/labShaders.js';

/**
 * Cutscene set (not a playable era): the Chronos experiment hall.
 *   variant 'night'   — 03:07, Field Test 7, just BEFORE the accident (prologue)
 *   variant 'morning' — after the timeline is restored (epilogue)
 * Exposes anchors (where actors stand) and fx (alarm, core ejection) for
 * the story script in src/story.js.
 */
export const meta = {
  name: 'The Present', numeral: '', title: 'Field Test 7', subtitle: 'Chronos Research Facility',
  objective: '', music: 'lab', ambience: 'lab', sky: 'lab', stability: 999, accent: 0x6fd3ff, surface: 'stone', eraIndex: 1,
};
export const metaMorning = {
  ...meta, title: 'Morning', music: 'title', ambience: null, sky: 'ruins', eraIndex: 0, accent: 0xffc861,
};

export function build(kit, api, { variant = 'night' } = {}) {
  const night = variant === 'night';
  const scene = api.scene;
  scene.fog = new THREE.FogExp2(night ? 0x070b12 : 0xe0c8a8, night ? 0.014 : 0.008);

  const M = {
    floor: kit.material('floor-tiles-08', { roughness: 0.5, tint: 0xd8dce2 }),
    plaster: kit.material('plastered-wall-04', { tint: night ? 0xd9dee6 : 0xf2e6d6 }),
    panels: kit.material('concrete-panels', { tint: 0xb9c2cc }),
    ceiling: kit.material('concrete-panels', { tint: 0x8a929c }),
  };
  const steel = kit.track(new THREE.MeshStandardMaterial({ color: 0x8e98a6, metalness: 0.9, roughness: 0.35 }));
  const darkSteel = kit.track(new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.7, roughness: 0.45 }));
  const tubeMat = kit.track(new THREE.MeshStandardMaterial({ color: 0xe8f4ff, emissive: 0xd8f2ff, emissiveIntensity: 2.2, roughness: 0.3 }));

  /* ---------------- shell ---------------- */
  kit.box({ size: [25.2, 0.4, 25.2], pos: [0, -0.2, 0], mat: M.floor, tile: 2, solid: false, surface: 'stone' });
  kit.box({ size: [25.2, 0.3, 25.2], pos: [0, 7.15, 0], mat: M.ceiling, tile: 3, solid: false, walk: false, map: false });
  const refl = createFloorReflection(24, 24, { normalMap: M.floor.normalMap, quality: api.quality, tile: 2 });
  if (refl) { refl.mesh.position.y = 0.006; kit.add(refl.mesh); kit.track(refl); }
  for (const [x, z, w, d] of [[-12.3, 0, 0.6, 25.2], [12.3, 0, 0.6, 25.2], [0, -12.3, 25.2, 0.6]]) {
    kit.box({ size: [w, 7, d], pos: [x, 3.5, z], mat: M.plaster, tile: 2.5, walk: false });
  }
  for (const [x, z, w, d] of [[0, -11.95, 24, 0.12], [-11.95, 0, 0.12, 24], [11.95, 0, 0.12, 24]]) {
    kit.box({ size: [w, 1.3, d], pos: [x, 0.65, z], mat: M.panels, tile: 1.5, solid: false, walk: false, map: false });
  }
  // South wall: windows.
  kit.box({ size: [25.2, 1.1, 0.6], pos: [0, 0.55, 12.3], mat: M.plaster, tile: 2.5, walk: false });
  kit.box({ size: [25.2, 1.2, 0.6], pos: [0, 6.4, 12.3], mat: M.plaster, tile: 2.5, walk: false });
  const glassMat = night
    ? kit.track(createRainGlassMaterial())
    : kit.track(new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  for (let i = 0; i < 6; i++) {
    const x = -10 + i * 4;
    kit.box({ size: [0.5, 4.7, 0.7], pos: [x - 2, 3.45, 12.3], mat: steel, tile: 1, walk: false, map: false });
    const g = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(3.5, 4.7)), glassMat);
    g.position.set(x, 3.45, 12.25);
    kit.add(g);
  }

  /* ---------------- dressing ---------------- */
  for (const x of [-7, 0, 7]) for (const z of [-7, 0, 7]) {
    const fx = new THREE.Group();
    fx.add(new THREE.Mesh(kit.boxGeo(1.4, 0.12, 0.5, 1), darkSteel));
    for (const dz of [-0.12, 0.12]) {
      const t = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(0.035, 0.035, 1.25, 8).rotateZ(Math.PI / 2)), tubeMat);
      t.position.set(0, -0.08, dz);
      fx.add(t);
    }
    fx.position.set(x, 6.85, z);
    kit.add(fx);
  }
  if (night) {
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) kit.pointLight(0xdcefff, 22, 18, [x, 6.2, z]);
    kit.light(new THREE.HemisphereLight(0xbcd4ff, 0x10121a, 0.55));
  } else {
    kit.light(new THREE.HemisphereLight(0xffe6c8, 0x403020, 0.9));
    const sun = new THREE.DirectionalLight(0xffc98a, 3.2);
    sun.position.set(-6, 9, 26);
    sun.target.position.set(0, 0, -2);
    sun.castShadow = api.quality.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    kit.light(sun);
    kit.light(sun.target);
    // Dusty god-rays through the windows.
    for (const x of [-8, 0, 8]) {
      const r = createBeam({ radius: 1.4, color: 0xffd9a0 });
      r.material.uniforms.uIntensity.value = 0.12;
      r.set(new THREE.Vector3(x - 3, 6, 13), new THREE.Vector3(x + 1, 0, 2));
      kit.add(r.mesh);
      kit.track(r);
    }
  }

  const logoTex = kit.canvasTexture(1024, 192, (g) => {
    g.fillStyle = '#05080c'; g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = '#6fd3ff'; g.lineWidth = 6; g.beginPath(); g.arc(96, 96, 62, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(96, 54); g.lineTo(96, 96); g.lineTo(126, 112); g.stroke();
    g.fillStyle = '#dff6ff'; g.font = 'bold 92px Georgia'; g.fillText('CHRONOS', 200, 120);
    g.font = '30px sans-serif'; g.fillStyle = '#6fd3ff'; g.fillText('TEMPORAL RESEARCH FACILITY', 206, 168);
  });
  const logo = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(6.4, 1.2)), kit.track(new THREE.MeshStandardMaterial({ map: logoTex, emissiveMap: logoTex, emissive: 0xffffff, emissiveIntensity: 1.1 })));
  logo.position.set(0, 5.6, -11.95);
  kit.add(logo);
  const hazardTex = kit.canvasTexture(1024, 64, (g) => {
    for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? '#111' : '#e8b417'; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, 64); g.lineTo(i * 32 - 16, 64); g.fill(); }
  });
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);
  const hazard = new THREE.Mesh(kit.track(new THREE.RingGeometry(4.0, 4.45, 96, 1)), kit.track(new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6 })));
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.y = 0.008;
  kit.add(hazard);
  kit.prop('metal-office-desk', { pos: [-10.6, 0, -6], rot: Math.PI / 2, height: 0.8 });
  kit.prop('chemistry-set', { pos: [-10.7, 0.8, -6], rot: Math.PI / 2, height: 0.42, solid: false });
  kit.prop('metal-office-desk', { pos: [10.6, 0, -7], rot: -Math.PI / 2, height: 0.8 });
  kit.prop('industrial-microscope', { pos: [10.6, 0.8, -7.3], rot: -Math.PI / 2, height: 0.5, solid: false });
  kit.prop('steel-frame-shelves-01', { pos: [-5, 0, -11.7], height: 2.1 });
  kit.prop('steel-frame-shelves-01', { pos: [5, 0, -11.7], height: 2.1 });
  kit.prop('vintage-grandfather-clock-01', { pos: [-11.5, 0, 6], rot: Math.PI / 2, height: 2.1 });
  const cableMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.55 }));
  for (const pts of [[[0, 0.1, 0], [-3, 0.06, -4], [-6, 0.06, -9], [-9, 0.06, -11.9]], [[0, 0.1, 0], [4, 0.06, -2], [8, 0.06, -1], [12, 0.06, -0.6]]]) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    kit.add(new THREE.Mesh(kit.track(new THREE.TubeGeometry(curve, 40, 0.07, 6)), cableMat));
  }

  // Ari's control console.
  const consolePos = new THREE.Vector3(2.5, 0, 4.4);
  kit.box({ size: [0.9, 1.0, 0.5], pos: [consolePos.x, 0.5, consolePos.z], rot: -0.6, mat: darkSteel, tile: 1, walk: false });
  const screenTex = kit.canvasTexture(512, 320, (g) => {
    g.fillStyle = '#02070c'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#9fe8ff'; g.font = 'bold 30px monospace'; g.fillText('FIELD TEST 7', 20, 44);
    g.font = '22px monospace';
    ['HOURGLASS DRIVE  ▮▮▮▮▮▮▮▮░░', 'CORE A  (amber) .... SEATED', 'CORE B  (blue) ..... SEATED', 'CORE C  (rose) ..... SEATED', '> ENGAGE? [Y]'].forEach((l, i) => g.fillText(l, 20, 96 + i * 34));
  });
  const screenMat = kit.track(createScreenMaterial(screenTex, { color: 0x9fe8ff, power: 1 }));
  const screen = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(0.8, 0.5)), screenMat);
  // Angled screen facing Ari (who stands south-east of the console).
  const faceYaw = Math.atan2(0.75, 0.9);
  screen.position.set(consolePos.x + Math.sin(faceYaw) * 0.18, 1.12, consolePos.z + Math.cos(faceYaw) * 0.18);
  screen.rotation.set(-0.55, faceYaw, 0, 'YXZ');
  kit.add(screen);
  kit.update((dt, t) => { screenMat.uniforms.uTime.value = t; });

  /* ---------------- fx: alarm + lightning (night) ---------------- */
  const alarms = [];
  if (night) {
    const lamp = kit.track(new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 0 }));
    for (const [x, z] of [[-11.7, -11.7], [11.7, -11.7], [-11.7, 11.7]]) {
      const m = new THREE.Mesh(kit.track(new THREE.SphereGeometry(0.16, 12, 8)), lamp);
      m.position.set(x, 5.2, z);
      kit.add(m);
      const spot = new THREE.SpotLight(0xff1a0a, 0, 26, Math.PI / 7, 0.5, 1.6);
      spot.position.copy(m.position);
      kit.light(spot);
      kit.light(spot.target);
      alarms.push({ spot, phase: Math.random() * 6 });
    }
    let alarmOn = false;
    const lightning = kit.light(new THREE.DirectionalLight(0xbfd8ff, 0));
    lightning.position.set(6, 20, 40);
    let bolt = -1;
    let nextBolt = 3;
    kit.update((dt, t) => {
      glassMat.uniforms.uTime.value = t;
      nextBolt -= dt;
      if (nextBolt < 0) { bolt = 0; nextBolt = 6 + Math.random() * 7; }
      let f = 0;
      if (bolt >= 0) { bolt += dt; f = bolt < 0.08 ? 1 : bolt < 0.2 ? 0.2 : bolt < 0.3 ? 0.7 : Math.max(0, 0.7 - (bolt - 0.3) * 3); if (bolt > 0.6) bolt = -1; }
      lightning.intensity = f * 4;
      api.sky.uniforms.uFlash.value = f;
      glassMat.uniforms.uFlash.value = f;
      lamp.emissiveIntensity = alarmOn ? 3 : 0;
      for (const a of alarms) {
        a.spot.intensity = alarmOn ? 70 : 0;
        const ang = t * 3 + a.phase;
        a.spot.target.position.set(a.spot.position.x + Math.cos(ang) * 8, 0, a.spot.position.z + Math.sin(ang) * 8);
        a.spot.target.updateMatrixWorld();
      }
    });
    alarms.set = (on) => { alarmOn = on; };
  }

  /* ---------------- fx: the three cores torn out of time ---------------- */
  const coreColors = [0xffb347, 0x58d6ff, 0xff4fd8];
  const flyers = coreColors.map((c) => {
    const mesh = new THREE.Mesh(kit.track(new THREE.OctahedronGeometry(0.22, 1)), kit.track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 6 })));
    mesh.visible = false;
    kit.add(mesh);
    const trail = createBeam({ radius: 0.08, color: c });
    trail.mesh.visible = false;
    kit.add(trail.mesh);
    kit.track(trail);
    const light = kit.pointLight(c, 0, 10, [0, 0, 0]);
    return { mesh, trail, light, from: new THREE.Vector3(), to: new THREE.Vector3(), t: -1 };
  });
  // Past → west and up; this night → straight up through the roof; future → east and up.
  const targets = [new THREE.Vector3(-14, 9, -4), new THREE.Vector3(0.5, 14, 0), new THREE.Vector3(14, 9, -4)];
  const sparks = createParticles({ count: 120, center: [0, 2.9, 0], box: [5, 4, 5], color: 0xffd28a, size: 0.06 });
  sparks.mesh.visible = false;
  kit.add(sparks.mesh);
  kit.track(sparks);
  kit.update((dt, t) => {
    sparks.update(t * 3);
    for (const f of flyers) {
      if (f.t < 0) continue;
      f.t += dt / 1.3;
      const k = Math.min(1, f.t);
      const e = 1 - Math.pow(1 - k, 3);
      f.mesh.position.lerpVectors(f.from, f.to, e);
      f.mesh.position.y += Math.sin(k * Math.PI) * 2;
      f.mesh.rotation.y += dt * 8;
      f.trail.set(f.from, f.mesh.position);
      f.trail.update(t);
      f.light.position.copy(f.mesh.position);
      f.light.intensity = 30 * (1 - k * 0.5);
      if (k >= 1) { f.mesh.visible = false; f.trail.mesh.visible = false; f.light.intensity = 0; f.t = -1; }
    }
  });

  const fx = {
    alarm(on) { if (alarms.set) alarms.set(on); },
    sparks(on) { sparks.mesh.visible = on; },
    eject(positions) {
      flyers.forEach((f, i) => {
        f.from.copy(positions[i]);
        f.to.copy(targets[i]);
        f.mesh.position.copy(f.from);
        f.mesh.visible = true;
        f.trail.mesh.visible = true;
        f.t = 0;
      });
    },
  };

  return kit.result({
    spawn: new THREE.Vector3(3.6, 0, 5.8),
    spawnYaw: 0,
    anchors: { consolePos, ariPos: new THREE.Vector3(3.25, 0, 5.3), ariFacing: Math.atan2(-3.25, -5.3) + 0.25 },
    fx,
  });
}
