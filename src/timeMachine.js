import * as THREE from 'three';

/**
 * The Time Machine — the one object that connects all three levels (brief §10).
 *
 * This demonstrates HIERARCHICAL MODELLING on purpose:
 *   timeMachine (Group)
 *     └─ base (Mesh)
 *          └─ ringOuter (Mesh)   -- rotates on Y
 *               └─ ringMiddle (Mesh)  -- rotates on X, relative to ringOuter
 *                    └─ ringInner (Mesh) -- rotates on Z, relative to ringMiddle
 *                         └─ core (Mesh) -- the glowing energy core, emissive
 *                              └─ coreLight (PointLight) -- moves with the core
 *
 * Because each ring is parented to the one "above" it, rotating a parent ring
 * automatically carries every ring nested inside it — that's the payoff of
 * building this as a scene-graph hierarchy instead of three independent meshes.
 *
 * Three empty "sockets" sit around the base. Call timeMachine.lightSocket(i)
 * once a level's core has been recovered, to visually represent progress —
 * this is the hook the rest of the game should call into.
 */
export function createTimeMachine() {
  const group = new THREE.Group();
  group.name = 'TimeMachine';

  // --- Base -------------------------------------------------------------
  const baseGeo = new THREE.CylinderGeometry(1.4, 1.7, 0.6, 24);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4038, metalness: 0.6, roughness: 0.4,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.3;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // --- Three rotating rings (nested hierarchy) ---------------------------
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x8a7a5a, metalness: 0.8, roughness: 0.25, emissive: 0x201500,
  });

  const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 12, 48), ringMat);
  ringOuter.position.y = 1.6;
  ringOuter.rotation.x = Math.PI / 2;
  base.add(ringOuter);

  const ringMiddle = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 12, 48), ringMat.clone());
  ringMiddle.rotation.x = Math.PI / 3;
  ringOuter.add(ringMiddle);

  const ringInner = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 12, 48), ringMat.clone());
  ringInner.rotation.x = -Math.PI / 4;
  ringMiddle.add(ringInner);

  // --- Central energy core (emissive, glowing) ---------------------------
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x66d9ff, emissive: 0x1fb6ff, emissiveIntensity: 1.6,
    metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.92,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), coreMat);
  ringInner.add(core);

  const coreLight = new THREE.PointLight(0x66d9ff, 2.2, 8, 2);
  core.add(coreLight);

  // --- Three sockets on the base rim, one per world (Past/Present/Future) --
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 });
  const sockets = [];
  const socketColors = [0xd98c3f, 0x4fd0e8, 0xff4fd8]; // past / present / future
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), socketMat.clone());
    socket.position.set(Math.cos(angle) * 1.55, 0.4, Math.sin(angle) * 1.55);
    socket.userData.litColor = socketColors[i];
    base.add(socket);
    sockets.push(socket);
  }

  group.userData.recoveredCores = [false, false, false];

  /** Call when the player recovers a core for world index i (0,1,2). */
  group.lightSocket = function (i) {
    if (i < 0 || i > 2) return;
    group.userData.recoveredCores[i] = true;
    const socket = sockets[i];
    socket.material.color.setHex(socket.userData.litColor);
    socket.material.emissive.setHex(socket.userData.litColor);
    socket.material.emissiveIntensity = 1.5;
  };

  /** Advance the animation each frame. delta = seconds since last frame. */
  group.update = function (delta) {
    ringOuter.rotation.z += delta * 0.25;
    ringMiddle.rotation.y += delta * 0.4;
    ringInner.rotation.z -= delta * 0.6;
    core.rotation.y += delta * 0.8;

    // subtle pulse so the core reads as "alive" even before uniforms/shaders
    // are wired in — swap this for a custom vertex/fragment shader later
    // to score under the Shaders category.
    const pulse = 1.4 + Math.sin(performance.now() * 0.003) * 0.4;
    coreMat.emissiveIntensity = pulse;
    coreLight.intensity = pulse * 1.2;
  };

  return group;
}
