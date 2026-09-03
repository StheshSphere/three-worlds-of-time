import * as THREE from 'three';

/**
 * LEVEL 2 — THE MODERN LABORATORY (pitch doc §5)
 * Theme: investigation, logic, restoring power.
 * Visual identity: cool artificial lighting, glass, metal, screens, cables.
 *
 * Stub — Person 2 will build out the full level here.
 * Contract: build(scene) → { interactables, disposables, lights, objects }
 */
export function build(scene) {
  const interactables = [];
  const disposables = [];
  const lights = [];
  const objects = [];

  // Cool artificial lighting — visually distinct from Level 1's warm stone
  const hemi = new THREE.HemisphereLight(0xc8d8e8, 0x1a1a2e, 0.4);
  lights.push(hemi);

  const overhead = new THREE.DirectionalLight(0xe0e8f0, 1.2);
  overhead.position.set(-5, 15, 5);
  overhead.castShadow = true;
  overhead.shadow.mapSize.set(2048, 2048);
  overhead.shadow.camera.left = -25;
  overhead.shadow.camera.right = 25;
  overhead.shadow.camera.top = 25;
  overhead.shadow.camera.bottom = -25;
  overhead.shadow.camera.far = 60;
  lights.push(overhead);

  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.015);

  // Basic ground — Person 2 will replace with lab flooring
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a, roughness: 0.3, metalness: 0.2,
  });
  disposables.push(groundMat);
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  disposables.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  objects.push(ground);

  // TODO (Person 2): keycard pickups, flashlight mechanic, switch-sequence puzzle
  // On completion call timeMachine.lightSocket(1) then levelManager.nextLevel()

  return { interactables, disposables, lights, objects };
}
