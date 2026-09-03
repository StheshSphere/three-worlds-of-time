import * as THREE from 'three';

/**
 * LEVEL 1 — THE ANCIENT RUINS (pitch doc §4)
 * Theme: discovery, physical interaction, ancient mechanisms.
 * Visual identity: warm sunlight, stone, vegetation, moss.
 *
 * Alpha vertical slice — Person 1 will expand the puzzle chain from here.
 * Contract: build(scene) → { interactables, disposables, lights, objects }
 */
export function build(scene) {
  const interactables = [];
  const disposables = [];
  const lights = [];
  const objects = [];

  // ---- Lighting: warm sunlight + soft fill (era-specific, per brief §7) ----
  const hemi = new THREE.HemisphereLight(0xfff1c9, 0x3a2b1a, 0.55);
  lights.push(hemi);

  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(12, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  sun.shadow.camera.far = 60;
  lights.push(sun);

  scene.background = new THREE.Color(0xcfa670);
  scene.fog = new THREE.FogExp2(0xcfa670, 0.018);

  // ---- Ground -----------------------------------------------------------
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a7654, roughness: 1 });
  disposables.push(groundMat);
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  disposables.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  objects.push(ground);

  // ---- Ruined temple shell (placeholder blockout geometry) --------------
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa89579, roughness: 0.9 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x5c7a4a, roughness: 1 });
  disposables.push(stoneMat, mossMat);

  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.6, 5, 12);
  disposables.push(pillarGeo);

  function addPillar(x, z) {
    const pillar = new THREE.Mesh(pillarGeo, stoneMat);
    pillar.position.set(x, 2.5, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    objects.push(pillar);
  }
  const ring = 10;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    addPillar(Math.cos(a) * ring, Math.sin(a) * ring);
  }

  // Mossy rubble scattered around, purely decorative
  for (let i = 0; i < 14; i++) {
    const size = 0.4 + Math.random() * 0.8;
    const geo = new THREE.DodecahedronGeometry(size, 0);
    disposables.push(geo);
    const rubble = new THREE.Mesh(geo, mossMat);
    rubble.position.set((Math.random() - 0.5) * 30, size * 0.5, (Math.random() - 0.5) * 30);
    rubble.rotation.set(Math.random(), Math.random(), Math.random());
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    objects.push(rubble);
  }

  // ---- Puzzle placeholder: a pushable-looking block on a pressure plate --
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3d3020, emissive: 0x000000 });
  disposables.push(plateMat);
  const plateGeo = new THREE.CylinderGeometry(1, 1, 0.1, 24);
  disposables.push(plateGeo);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(4, 0.05, -3);
  objects.push(plate);

  const blockMat = new THREE.MeshStandardMaterial({ color: 0xb2a37f, roughness: 0.8 });
  const blockGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  disposables.push(blockMat, blockGeo);
  const block = new THREE.Mesh(blockGeo, blockMat);
  block.position.set(4, 0.6, 2);
  block.castShadow = true;
  block.receiveShadow = true;
  block.userData.interactable = true;
  block.userData.prompt = 'Push block onto the pressure plate';
  block.userData.onInteract = () => {
    block.position.set(4, 0.6, -3);
    plate.material.emissive.setHex(0x4fd0e8);
    plate.material.color.setHex(0x2f6070);
    return 'The plate clicks into place.';
  };
  objects.push(block);
  interactables.push(block);

  return { interactables, disposables, lights, objects };
}
