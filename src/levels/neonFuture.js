import * as THREE from 'three';

/**
 * LEVEL 3 — THE NEON FUTURE (pitch doc §6)
 * Verb: SURVIVE — movement, timing, hazards.
 * Visual identity: neon emissive structures floating in an unstable void.
 *
 * THE COURSE: the ground is gone. A chain of floating platforms climbs toward
 * the Neon Core; three of them move on sine waves and CARRY the player
 * (player.js reads userData.carryDelta), and two energy barriers gate the
 * route — they are solid only while their shader pulse is bright, so you
 * have to time your dash through the dormant phase.
 *
 * THE CUSTOM SHADER (rubric: Shaders — everyone must be able to explain it):
 *   The barrier material is a THREE.ShaderMaterial, NOT a standard material.
 *   The GPU runs our fragment shader for every pixel of the barrier quad:
 *     - uTime advances every frame (uniform we feed from JS),
 *     - `scan` scrolls horizontal scanlines up the wall (vUv.y + uTime),
 *     - `pulse` is a slow sine 0..1 that both fades the wall's alpha AND,
 *       computed again in JS, decides whether the wall is SOLID. Same formula,
 *       two consumers: what you see is what blocks you.
 *   The vertex shader is pass-through: it just exports vUv so the fragment
 *   shader can address the quad by percentage coordinates.
 */
export function build(scene, api) {
  const interactables = [];
  const objects = [];
  const lights = [];
  const disposables = [];
  const colliders = [];
  const walkables = [];

  let coreTaken = false;
  let elapsed = 0;

  const barrierVertexShader = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const barrierFragmentShader = /* glsl */`
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uColor;
    void main() {
      // Scanlines scrolling upward across the wall.
      float scan = sin((vUv.y + uTime * 0.55) * 38.0) * 0.5 + 0.5;
      // Slow global pulse 0..1 — mirrored in JS as barrierSolid().
      float pulse = 0.5 + 0.5 * sin(uTime * 1.8);
      // Brighter energy band around the vertical middle.
      float band = 1.0 - abs(vUv.y - 0.5) * 1.4;
      float alpha = (0.10 + scan * 0.30) * (0.15 + pulse * 0.85);
      vec3 col = uColor * (0.5 + scan * 0.9 + band * 0.6);
      gl_FragColor = vec4(col, alpha);
    }
  `;

  /** Barrier solidity must match the shader's visual pulse — one source of truth. */
  function barrierSolid(t) { return Math.sin(t * 1.8) > 0; }

  // ---- lighting: neon identity, emissive materials carry most of the look ----
  const hemi = new THREE.HemisphereLight(0x2a2a5e, 0x050510, 0.5);
  lights.push(hemi);

  scene.background = new THREE.Color(0x050510);
  scene.fog = new THREE.FogExp2(0x050510, 0.014);

  // ---- shared materials -----------------------------------------------------
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x14151f, roughness: 0.6, metalness: 0.55 });
  const rimMatCyan = new THREE.MeshStandardMaterial({
    color: 0x0a2a33, emissive: 0x27e0ff, emissiveIntensity: 2.4, roughness: 0.3,
  });
  const rimMatMagenta = new THREE.MeshStandardMaterial({
    color: 0x33102a, emissive: 0xff4fd8, emissiveIntensity: 2.4, roughness: 0.3,
  });
  const cityMat = new THREE.MeshStandardMaterial({
    color: 0x0b0b18, emissive: 0x1a3a5e, emissiveIntensity: 0.7, roughness: 0.8,
  });
  disposables.push(deckMat, rimMatCyan, rimMatMagenta, cityMat);

  function solid(mesh) {
    mesh.userData.solidBox = new THREE.Box3().setFromObject(mesh);
    colliders.push(mesh);
    return mesh;
  }

  /** A floating platform: dark deck + two glowing rims. Returns the deck mesh. */
  function makePlatform(w, d, y, rimMat) {
    const deckGeo = new THREE.BoxGeometry(w, 0.5, d);
    const rimGeo = new THREE.BoxGeometry(w + 0.06, 0.12, 0.22);
    disposables.push(deckGeo, rimGeo);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = y;
    deck.castShadow = true;
    deck.receiveShadow = true;
    const rimA = new THREE.Mesh(rimGeo, rimMat);
    rimA.position.set(0, 0.3, d / 2);
    const rimB = new THREE.Mesh(rimGeo, rimMat);
    rimB.position.set(0, 0.3, -d / 2);
    deck.add(rimA, rimB);
    const pl = new THREE.PointLight(rimMat === rimMatCyan ? 0x27e0ff : 0xff4fd8, 7, 9, 2);
    pl.position.set(0, 1.2, 0);
    deck.add(pl);
    objects.push(deck);
    walkables.push(deck);
    solid(deck);
    return deck;
  }

  // ---- the course --------------------------------------------------------------
  // Start plaza — the Time Machine (persistent, at world origin) stands on it.
  const startDeck = makePlatform(11, 11, -0.25, rimMatCyan);
  startDeck.position.set(0, -0.25, 0);

  // Mover 1: slides side-to-side across the gap.
  const mover1 = makePlatform(3, 3, 0.4, rimMatCyan);
  const mover1Base = new THREE.Vector3(0, 0.4, -7);

  // Mover 2: rises and falls.
  const mover2 = makePlatform(3, 3, 0.9, rimMatMagenta);
  const mover2Base = new THREE.Vector3(0, 0.9, -12.5);

  // Mover 3: drifts on X out of phase with mover 1.
  const mover3 = makePlatform(3, 3, 1.4, rimMatCyan);
  const mover3Base = new THREE.Vector3(0, 1.4, -18);

  // Gate platform + first energy barrier.
  const gateDeck = makePlatform(6, 6, 1.9, rimMatMagenta);
  gateDeck.position.set(0, 1.9, -24);

  // Mover 4: fast lateral shuttle after the first barrier.
  const mover4 = makePlatform(3, 3, 2.3, rimMatCyan);
  const mover4Base = new THREE.Vector3(0, 2.3, -30);

  // Mover 5: vertical, opposite phase to mover 2.
  const mover5 = makePlatform(3, 3, 2.7, rimMatMagenta);
  const mover5Base = new THREE.Vector3(0, 2.7, -35.5);

  // Final platform + second barrier guarding the core.
  const finalDeck = makePlatform(10, 10, 3.1, rimMatCyan);
  finalDeck.position.set(0, 3.1, -43);

  const movers = [
    { mesh: mover1, base: mover1Base, axis: 'x', amp: 4.5, speed: 0.9, phase: 0 },
    { mesh: mover2, base: mover2Base, axis: 'y', amp: 1.3, speed: 1.1, phase: 1.2 },
    { mesh: mover3, base: mover3Base, axis: 'x', amp: 5.5, speed: 0.75, phase: 2.4 },
    { mesh: mover4, base: mover4Base, axis: 'x', amp: 6, speed: 1.4, phase: 0.6 },
    { mesh: mover5, base: mover5Base, axis: 'y', amp: 1.5, speed: 1.3, phase: 3.1 },
  ];
  movers.forEach((m) => m.mesh.position.copy(m.base));

  // ---- energy barriers (custom ShaderMaterial) ------------------------------------
  function makeBarrier(x, y, z, width) {
    const geo = new THREE.PlaneGeometry(width, 2.6);
    const mat = new THREE.ShaderMaterial({
      vertexShader: barrierVertexShader,
      fragmentShader: barrierFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff4fd8) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    disposables.push(geo, mat);
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(x, y, z);
    objects.push(wall);
    return { wall, mat };
  }

  const barrier1 = makeBarrier(0, 3.4, -26.8, 6);   // north edge of gate platform
  const barrier2 = makeBarrier(0, 4.6, -40.2, 10);  // guards the final platform

  // ---- the Neon Core --------------------------------------------------------------
  const coreGeo = new THREE.OctahedronGeometry(0.5, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff9df0, emissive: 0xff4fd8, emissiveIntensity: 2.6, roughness: 0.2,
  });
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 18, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff7ae6, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  disposables.push(coreGeo, coreMat, beamGeo, beamMat);

  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 4.6, -43);
  objects.push(core);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 12, -43);
  objects.push(beam);
  const coreLight = new THREE.PointLight(0xff4fd8, 10, 16, 2);
  coreLight.position.set(0, 4.8, -43);
  lights.push(coreLight);

  core.userData.prompt = 'Take the Neon Core';
  core.userData.onInteract = () => {
    if (coreTaken) return;
    coreTaken = true;
    core.visible = false;
    beam.visible = false;
    coreLight.intensity = 0;
    api.showMessage('The Neon Core is yours. The last socket ignites — the Time Machine roars to life!');
    api.completeLevel(); // → timeMachine.lightSocket(2) → restoration + win
  };
  interactables.push(core);

  // ---- distant neon skyline (decorative depth for the void) -------------------------
  const towerGeo = new THREE.BoxGeometry(3, 30, 3);
  disposables.push(towerGeo);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const tower = new THREE.Mesh(towerGeo, i % 2 ? cityMat : rimMatCyan);
    tower.position.set(Math.cos(a) * 75, 8 + (i % 4) * 6, -22 + Math.sin(a) * 75);
    tower.scale.y = 0.6 + (i % 5) * 0.35;
    objects.push(tower);
  }

  // ---- per-frame animation ------------------------------------------------------------
  // Called BEFORE player.update() each frame, so platform movement lands in
  // userData.carryDelta before the player physics consumes it.
  function update(delta) {
    elapsed += delta;
    const t = elapsed;

    for (const m of movers) {
      const prevX = m.mesh.position.x;
      const prevY = m.mesh.position.y;
      const prevZ = m.mesh.position.z;
      const offset = Math.sin(t * m.speed + m.phase) * m.amp;
      m.mesh.position.copy(m.base);
      m.mesh.position[m.axis] += offset;
      // Tell riders how far we moved this frame (player adds it to its position).
      m.mesh.userData.carryDelta = m.mesh.userData.carryDelta || new THREE.Vector3();
      m.mesh.userData.carryDelta.set(
        m.mesh.position.x - prevX,
        m.mesh.position.y - prevY,
        m.mesh.position.z - prevZ,
      );
      m.mesh.userData.solidBox.setFromObject(m.mesh);
    }

    // Barriers: shader time + solidity follow the same pulse.
    for (const b of [barrier1, barrier2]) {
      b.mat.uniforms.uTime.value = t;
    }
    const solidNow = barrierSolid(t);
    for (const b of [barrier1, barrier2]) {
      if (solidNow !== b.active) {
        b.active = solidNow;
        if (solidNow) {
          b.wall.userData.solidBox = new THREE.Box3().setFromObject(b.wall);
          colliders.push(b.wall);
        } else {
          const idx = colliders.indexOf(b.wall);
          if (idx >= 0) colliders.splice(idx, 1);
        }
      }
    }

    if (core.visible) {
      core.rotation.y += delta * 1.8;
      core.position.y = 4.6 + Math.sin(t * 2.2) * 0.2;
      coreLight.intensity = 9 + Math.sin(t * 5) * 3;
      beam.material.opacity = 0.12 + Math.sin(t * 2.5) * 0.05;
    }
  }

  // ---- hints ------------------------------------------------------------------------------
  api.setHint(() => {
    if (coreTaken) return 'Return through time…';
    return 'Sprint-jump the platforms, ride the movers, dash through barriers when they dim';
  });

  return {
    interactables,
    objects,
    lights,
    disposables,
    colliders,
    walkables,
    update,
    spawn: new THREE.Vector3(0, 1.7, 4),
  };
}
