import * as THREE from 'three';
import { createForceFieldMaterial } from './shaders/forceField.js';
import { createWarpRippleMaterial } from './shaders/warpRipple.js';

/**
 * The Time Machine — the one object present in every era (pitch §10).
 *
 * HIERARCHICAL MODELLING (scene graph) — do not flatten:
 *
 *   TimeMachine (Group)
 *    ├─ dais (stepped plinth)
 *    │   └─ clockFace (engraved numerals)
 *    │        ├─ hourHand    ── rotates to point at the current era
 *    │        └─ minuteHand  ── sweeps continuously
 *    ├─ pylon[0..2] (120° apart)
 *    │   └─ socket ── socketCore (lights up when that era's core returns)
 *    ├─ gimbal (Group, spins on Y)
 *    │   └─ ringOuter ── ringMiddle (tilts on X) ── ringInner (tilts on Z)
 *    │                                              └─ heart (glowing core)
 *    │                                                   └─ heartLight
 *    ├─ cables (tubes from the pylons into the dais)
 *    ├─ field (force-field sphere, custom shader)
 *    └─ ripple (ground warp rings, custom shader — era jumps / restoration)
 *
 * Each ring is a CHILD of the one outside it, so ringInner's rotation is
 * composed with ringMiddle's, which is composed with ringOuter's — three
 * simple per-ring spins produce the tumbling gyroscope motion for free.
 * Moving the TimeMachine group moves everything; spinning the gimbal
 * carries all three rings and the heart.
 */
const CORE_COLORS = [0xffb347, 0x58d6ff, 0xff4fd8];

export function createTimeMachine() {
  const root = new THREE.Group();
  root.name = 'TimeMachine';
  root.userData.persistent = true;
  const disposables = [];
  const t = (x) => { disposables.push(x); return x; };

  /* ---------------------------- materials ---------------------------- */
  const brass = t(new THREE.MeshStandardMaterial({ color: 0xd4a85a, metalness: 1, roughness: 0.28 }));
  const darkBrass = t(new THREE.MeshStandardMaterial({ color: 0x8a6a35, metalness: 1, roughness: 0.42 }));
  const obsidian = t(new THREE.MeshStandardMaterial({ color: 0x1a1b22, metalness: 0.4, roughness: 0.35 }));
  const copper = t(new THREE.MeshStandardMaterial({ color: 0xb8673a, metalness: 1, roughness: 0.35 }));
  const heartMat = t(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff6a2a, emissiveIntensity: 3, roughness: 0.2 }));

  /* ---------------------------- dais + clock ------------------------- */
  const dais = new THREE.Group();
  dais.name = 'dais';
  root.add(dais);
  const steps = [[3.4, 0.22, obsidian], [2.95, 0.22, darkBrass], [2.55, 0.18, obsidian]];
  let y = 0;
  for (const [r, h, m] of steps) {
    const mesh = new THREE.Mesh(t(new THREE.CylinderGeometry(r, r + 0.06, h, 48)), m);
    mesh.position.y = y + h / 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    dais.add(mesh);
    y += h;
  }
  const faceTex = t(makeClockFaceTexture());
  const clockFace = new THREE.Mesh(t(new THREE.CircleGeometry(2.45, 64)), t(new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.6, roughness: 0.45, emissiveMap: faceTex, emissive: 0xffb860, emissiveIntensity: 0.25 })));
  clockFace.name = 'clockFace';
  clockFace.rotation.x = -Math.PI / 2;
  clockFace.position.y = y + 0.005;
  clockFace.receiveShadow = true;
  dais.add(clockFace);
  const handGeo = t(new THREE.BoxGeometry(0.09, 1.7, 0.02));
  handGeo.translate(0, 0.85, 0);
  const hourHand = new THREE.Mesh(handGeo, brass);
  hourHand.name = 'hourHand';
  hourHand.scale.set(1.6, 0.75, 1);
  hourHand.position.z = 0.02;
  const minuteHand = new THREE.Mesh(handGeo, brass);
  minuteHand.name = 'minuteHand';
  minuteHand.position.z = 0.03;
  clockFace.add(hourHand, minuteHand);
  const DAIS_TOP = y;

  /* ---------------------------- pylons + sockets -------------------- */
  const pylonGeo = t(new THREE.CylinderGeometry(0.16, 0.26, 2.3, 10));
  const collarGeo = t(new THREE.TorusGeometry(0.24, 0.05, 8, 20));
  const cupGeo = t(new THREE.CylinderGeometry(0.34, 0.18, 0.3, 16, 1, true));
  const socketCoreGeo = t(new THREE.IcosahedronGeometry(0.2, 1));
  const sockets = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const pylon = new THREE.Mesh(pylonGeo, darkBrass);
    pylon.name = `pylon${i}`;
    pylon.position.set(Math.cos(a) * 2.1, DAIS_TOP + 1.15, Math.sin(a) * 2.1);
    pylon.castShadow = true;
    root.add(pylon);
    for (const cy of [-0.7, 0.2, 0.9]) {
      const c = new THREE.Mesh(collarGeo, brass);
      c.rotation.x = Math.PI / 2;
      c.position.y = cy;
      pylon.add(c);
    }
    const socket = new THREE.Mesh(cupGeo, brass);
    socket.name = `socket${i}`;
    socket.position.y = 1.3;
    pylon.add(socket);
    const coreMat = t(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: CORE_COLORS[i], emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 }));
    const socketCore = new THREE.Mesh(socketCoreGeo, coreMat);
    socketCore.name = `socketCore${i}`;
    socketCore.position.y = 0.18;
    socketCore.scale.setScalar(0.001);
    socket.add(socketCore);
    sockets.push({ pylon, socket, core: socketCore, mat: coreMat, lit: false, pulse: 0 });
  }

  /* ---------------------------- gimbal ------------------------------- */
  const gimbal = new THREE.Group();
  gimbal.name = 'gimbal';
  gimbal.position.y = DAIS_TOP + 2.25;
  root.add(gimbal);
  const ringOuter = new THREE.Mesh(t(new THREE.TorusGeometry(1.55, 0.085, 14, 96)), brass);
  ringOuter.name = 'ringOuter';
  const ringMiddle = new THREE.Mesh(t(new THREE.TorusGeometry(1.2, 0.07, 14, 80)), copper);
  ringMiddle.name = 'ringMiddle';
  const ringInner = new THREE.Mesh(t(new THREE.TorusGeometry(0.86, 0.06, 12, 64)), brass);
  ringInner.name = 'ringInner';
  gimbal.add(ringOuter);
  ringOuter.add(ringMiddle);
  ringMiddle.add(ringInner);
  // Engraved studs on the rings (detail that catches the light).
  const studGeo = t(new THREE.BoxGeometry(0.08, 0.2, 0.08));
  for (const [ring, r, n] of [[ringOuter, 1.55, 24], [ringMiddle, 1.2, 18], [ringInner, 0.86, 12]]) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(studGeo, darkBrass);
      const a = (i / n) * Math.PI * 2;
      s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      s.rotation.z = a;
      ring.add(s);
    }
  }
  // Axle pins between rings (they visibly hold each other).
  const pinGeo = t(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8));
  for (const [ring, r] of [[ringOuter, 1.38], [ringMiddle, 1.03]]) {
    for (const sgn of [-1, 1]) {
      const pin = new THREE.Mesh(pinGeo, brass);
      pin.rotation.z = Math.PI / 2;
      pin.position.x = sgn * r;
      ring.add(pin);
    }
  }
  ringOuter.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const heart = new THREE.Mesh(t(new THREE.IcosahedronGeometry(0.34, 2)), heartMat);
  heart.name = 'heart';
  ringInner.add(heart);
  const heartLight = new THREE.PointLight(0xff7a3a, 6, 9, 2);
  heartLight.name = 'heartLight';
  heart.add(heartLight);

  /* ---------------------------- cables ------------------------------- */
  const cableMat = t(new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.6, metalness: 0.2 }));
  for (const s of sockets) {
    const top = s.pylon.position.clone().add(new THREE.Vector3(0, -0.6, 0));
    const curve = new THREE.CatmullRomCurve3([
      top,
      top.clone().multiplyScalar(0.75).setY(DAIS_TOP + 0.35),
      new THREE.Vector3(top.x * 0.3, DAIS_TOP + 0.08, top.z * 0.3),
      new THREE.Vector3(0, DAIS_TOP + 0.6, 0),
    ]);
    const cable = new THREE.Mesh(t(new THREE.TubeGeometry(curve, 24, 0.045, 6, false)), cableMat);
    cable.castShadow = true;
    root.add(cable);
  }
  const column = new THREE.Mesh(t(new THREE.CylinderGeometry(0.12, 0.3, 1.2, 12)), darkBrass);
  column.position.y = DAIS_TOP + 0.6;
  root.add(column);

  /* ---------------------------- force field -------------------------- */
  const fieldMat = t(createForceFieldMaterial());
  const field = new THREE.Mesh(t(new THREE.SphereGeometry(2.0, 64, 32)), fieldMat);
  field.name = 'field';
  field.position.y = DAIS_TOP + 2.2;
  field.scale.set(1, 1.15, 1);
  root.add(field);

  /* ---------------------------- warp ripple -------------------------- */
  // Ground shockwave around the dais (src/shaders/warpRipple.js): rings of
  // energy race outward while the machine charges an era jump (levelManager
  // calls setWarp during transitions / the finale surge) and while it restores
  // itself; a faint idle pulse the rest of the time. One cheap draw call.
  const rippleMat = t(createWarpRippleMaterial());
  const ripple = new THREE.Mesh(t(new THREE.RingGeometry(3.55, 7.2, 96, 2)), rippleMat);
  ripple.name = 'warpRipple';
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.y = 0.14;
  root.add(ripple);

  /* ---------------------------- state + animation -------------------- */
  let time = 0;
  let cores = 0;
  let era = 0;
  let restoring = 0;     // 0 → 1 over the restoration sequence
  let spin = 1;
  let overload = 0;      // prologue: 0 (stable) → 1 (Field Test 7 tearing the timeline)
  let warp = 0;          // eased toward warpTarget — the era-transition charge
  let warpTarget = 0;
  const ROT = [0.35, 0.6, 0.9];

  function update(dt) {
    time += dt;
    if (root.userData.isRestoring) restoring = Math.min(1, restoring + dt / 4.2);
    const fixedness = cores / 3;
    spin += ((1 + restoring * 7 + overload * 12) - spin) * Math.min(1, dt * 2);
    // Broken machine: jittery stutter. Repaired: smooth confident spin.
    const stutter = (1 - fixedness) * (Math.sin(time * 13) > 0.85 ? 0.0 : 1.0) + fixedness;
    gimbal.rotation.y += dt * ROT[0] * spin * stutter;
    ringMiddle.rotation.x += dt * ROT[1] * spin * stutter;
    ringInner.rotation.z += dt * ROT[2] * spin * stutter;
    heart.rotation.y += dt * 1.2;
    heart.scale.setScalar(1 + Math.sin(time * 4) * 0.04 + restoring * 0.6);

    const flicker = fixedness < 1 ? 0.75 + 0.25 * Math.sin(time * 31) * Math.sin(time * 7) : 1;
    heartMat.emissive.setHex(cores >= 3 ? 0xffe2a0 : 0xff6a2a).lerp(_tmpColor.setHex(CORE_COLORS[Math.max(0, cores - 1)]), cores > 0 && cores < 3 ? 0.35 : 0);
    const surge = overload > 0 ? 1 + overload * 4 * (0.6 + 0.4 * Math.sin(time * 47)) : 1;
    if (overload > 0.55) heartMat.emissive.setHex(0xff3a2a);
    heartMat.emissiveIntensity = (2.2 + cores * 1.2 + restoring * 10) * flicker * surge;
    heartLight.color.copy(heartMat.emissive);
    heartLight.intensity = (5 + cores * 4 + restoring * 40) * flicker * surge;

    // Clock: minute hand sweeps, hour hand eases to the era's position.
    minuteHand.rotation.z = -time * (0.4 + restoring * 6);
    const target = -(era / 3) * Math.PI * 2 - 0.2;
    hourHand.rotation.z += (target - hourHand.rotation.z) * Math.min(1, dt * 2);

    for (const s of sockets) {
      if (!s.lit) continue;
      s.pulse = Math.max(0, s.pulse - dt * 0.8);
      const sc = Math.min(1, s.core.scale.x + dt * 2.5);
      s.core.scale.setScalar(sc);
      s.core.rotation.y += dt * 2;
      s.mat.emissiveIntensity = 2.5 + Math.sin(time * 3 + s.pylon.id) * 0.4 + s.pulse * 12;
    }

    fieldMat.uniforms.uTime.value = time;
    fieldMat.uniforms.uCores.value += (cores + restoring * 2 - fieldMat.uniforms.uCores.value) * Math.min(1, dt * 1.5);
    fieldMat.uniforms.uUnstable.value = (1 - fixedness) + restoring * 0.6 + overload * 2.5;
    fieldMat.uniforms.uIntensity.value = 0.7 + restoring * 2.5 + overload * 2;

    // Warp ripple: the charge is whatever the machine is currently doing to
    // time — an era jump (setWarp from the level manager), the restoration
    // sequence, or the prologue's overload.
    warp += (warpTarget - warp) * Math.min(1, dt * 5);
    rippleMat.uniforms.uTime.value = time;
    rippleMat.uniforms.uCharge.value = Math.max(warp, restoring * 0.75, overload * 0.8);
    rippleMat.uniforms.uCores.value += (cores - rippleMat.uniforms.uCores.value) * Math.min(1, dt * 2);
  }

  root.userData.isRestoring = false;
  root.update = update;
  root.lightSocket = (i) => {
    const s = sockets[i];
    if (!s || s.lit) return;
    s.lit = true;
    s.pulse = 1;
    cores = sockets.filter((x) => x.lit).length;
    if (cores === 3) root.userData.isRestoring = true;
  };
  root.setEra = (i) => { era = i; };
  /** Prologue / epilogue: the machine with all three cores seated (no finale). */
  root.showAllCores = () => {
    for (const s of sockets) { s.lit = true; s.pulse = 0.3; s.core.scale.setScalar(1); }
    cores = 3;
    root.userData.isRestoring = false;
  };
  root.setOverload = (v) => { overload = v; };
  /** Level manager: 0 → 1 era-transition charge (see levelManager.update). */
  root.setWarp = (v) => { warpTarget = Math.min(1, Math.max(0, v)); };
  /** Rips the cores out of their sockets; returns their world positions. */
  root.ejectCores = () => {
    const out = sockets.map((s) => s.core.getWorldPosition(new THREE.Vector3()));
    root.reset();
    return out;
  };
  root.getCores = () => cores;
  root.reset = () => {
    for (const s of sockets) { s.lit = false; s.core.scale.setScalar(0.001); s.mat.emissiveIntensity = 0; }
    cores = 0;
    restoring = 0;
    spin = 1;
    overload = 0;
    warp = 0;
    warpTarget = 0;
    root.userData.isRestoring = false;
  };
  root.restoreProgress = () => restoring;
  root.dispose = () => disposables.forEach((d) => d.dispose());

  // Physics: the plinth steps are walkable; pylons and the ring zone are solid.
  const blocker = new THREE.Object3D();
  blocker.name = 'ringBlocker';
  blocker.position.y = DAIS_TOP + 1.6;
  root.add(blocker);
  root.getPhysics = () => {
    root.updateMatrixWorld(true);
    const walkables = dais.children.filter((c) => c.isMesh && c !== clockFace);
    const colliders = sockets.map((s) => {
      s.pylon.userData.solidBox = new THREE.Box3().setFromObject(s.pylon).expandByScalar(0.05);
      return s.pylon;
    });
    const c = blocker.getWorldPosition(new THREE.Vector3());
    blocker.userData.solidBox = new THREE.Box3(
      new THREE.Vector3(c.x - 1.15, c.y - 1.6, c.z - 1.15),
      new THREE.Vector3(c.x + 1.15, c.y + 2.2, c.z + 1.15),
    );
    colliders.push(blocker);
    return { walkables, colliders, interactTarget: field };
  };
  root.footprintRadius = 3.45;
  root.daisTop = DAIS_TOP;
  return root;
}

const _tmpColor = new THREE.Color();

/** Engraved brass clock face with Roman numerals + era glyphs. */
function makeClockFaceTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const grad = g.createRadialGradient(cx, cx, 40, cx, cx, cx);
  grad.addColorStop(0, '#5a4220');
  grad.addColorStop(0.7, '#3b2b14');
  grad.addColorStop(1, '#1e150a');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#e8c27a';
  g.fillStyle = '#e8c27a';
  for (const [r, w] of [[490, 10], [440, 3], [300, 4], [120, 3]]) {
    g.lineWidth = w;
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  }
  const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.font = 'bold 58px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    g.save();
    g.translate(cx + Math.cos(a) * 370, cx + Math.sin(a) * 370);
    g.rotate(a + Math.PI / 2);
    g.fillText(numerals[i], 0, 0);
    g.restore();
    for (let k = 0; k < 5; k++) {
      const b = a + (k / 5) * (Math.PI / 6);
      g.lineWidth = k === 0 ? 6 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(b) * 445, cx + Math.sin(b) * 445);
      g.lineTo(cx + Math.cos(b) * (k === 0 ? 485 : 468), cx + Math.sin(b) * (k === 0 ? 485 : 468));
      g.stroke();
    }
  }
  // Three era glyphs in the inner ring: sun (past), atom (present), star (future).
  g.font = '64px Georgia, serif';
  const glyphs = ['☀', '⚛', '✦'];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    g.fillText(glyphs[i], cx + Math.cos(a) * 210, cx + Math.sin(a) * 210);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
