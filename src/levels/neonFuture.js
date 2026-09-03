import * as THREE from 'three';

/**
 * LEVEL 3 — THE NEON FUTURE (pitch doc §6)
 * Theme: movement, timing, instability.
 * Visual identity: futuristic neon structures, glowing energy, floating platforms.
 *
 * Stub — Person 3 will build out the full level here.
 * Contract: build(scene) → { interactables, disposables, lights, objects }
 */
export function build(scene) {
  const interactables = [];
  const disposables = [];
  const lights = [];
  const objects = [];

  // Neon/emissive lighting — visually distinct from the other two eras
  const hemi = new THREE.HemisphereLight(0x0a0a2e, 0x000000, 0.2);
  lights.push(hemi);

  scene.background = new THREE.Color(0x050510);
  scene.fog = new THREE.FogExp2(0x050510, 0.012);

  // Basic ground — Person 3 will replace with floating/unstable surfaces
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x111122, roughness: 0.8, metalness: 0.5,
  });
  disposables.push(groundMat);
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  disposables.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  objects.push(ground);

  // TODO (Person 3): moving platforms, timed energy barriers, floating structures
  // On completion call timeMachine.lightSocket(2) then levelManager.nextLevel()

  return { interactables, disposables, lights, objects };
}
