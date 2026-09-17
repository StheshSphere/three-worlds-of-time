import * as THREE from 'three';

/**
 * LEVEL 1 — THE ANCIENT RUINS (pitch doc §4)
 * Verb: SOLVE — physical puzzles with ancient mechanisms.
 * Visual identity: warm sunlight, stone, moss, a ruined temple split by a chasm.
 *
 * Puzzle chain (each step gates the next):
 *   1. Push both stone blocks onto their pressure plates.
 *   2. The bridge control wakes up — rotate the stone bridge across the chasm.
 *   3. Find the three runes hidden on the pillar ring.
 *   4. The altar on the far island accepts the discovery and reveals the core.
 *   5. Take the Ancient Core → api.completeLevel() (lights socket 0).
 */
export function build(scene, api) {
  const interactables = [];
  const objects = [];
  const lights = [];
  const disposables = [];
  const colliders = [];
  const walkables = [];

  // ---- state -----------------------------------------------------------
  let platesDone = 0;
  let runesFound = 0;
  let bridgeDeployed = false;
  let bridgeRotating = false;
  let coreRevealed = false;
  let coreTaken = false;

  // ---- lighting: warm sunlight (era identity, brief §7) ------------------
  const hemi = new THREE.HemisphereLight(0xfff1c9, 0x3a2b1a, 0.55);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(12, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 70;
  lights.push(hemi, sun);

  scene.background = new THREE.Color(0xcfa670);
  scene.fog = new THREE.FogExp2(0xcfa670, 0.016);

  // ---- shared materials --------------------------------------------------
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa89579, roughness: 0.9 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x5c7a4a, roughness: 1 });
  const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x6b5d49, roughness: 0.95 });
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x8f7f5f, roughness: 0.6, emissive: 0x000000 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffc94d, emissive: 0xe89b2f, emissiveIntensity: 1.6, roughness: 0.3,
  });
  disposables.push(stoneMat, mossMat, darkStoneMat, runeMat, glowMat);

  function solid(mesh, pad = 0) {
    mesh.userData.solidBox = new THREE.Box3().setFromObject(mesh);
    if (pad) mesh.userData.solidBox.expandByScalar(pad);
    colliders.push(mesh);
    return mesh;
  }

  // ---- terrain: arena ground + chasm + far island ------------------------
  // Ground is built from slabs so the chasm between them is real: miss the
  // bridge and the ground raycast finds nothing — you fall and respawn.
  const arenaGeo = new THREE.BoxGeometry(60, 0.2, 30);
  const islandGeo = new THREE.BoxGeometry(22, 0.2, 18);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a7654, roughness: 1 });
  disposables.push(arenaGeo, islandGeo, groundMat);

  const arena = new THREE.Mesh(arenaGeo, groundMat);
  arena.position.set(0, -0.1, 10); // top surface at y = 0, spans z -5..25
  arena.receiveShadow = true;
  objects.push(arena);
  walkables.push(arena);

  const island = new THREE.Mesh(islandGeo, groundMat);
  island.position.set(0, -0.1, -26); // spans z -35..-17
  island.receiveShadow = true;
  objects.push(island);
  walkables.push(island);

  // ---- colonnade ring + hidden runes ------------------------------------
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.65, 5, 12);
  const stubGeo = new THREE.CylinderGeometry(0.55, 0.65, 2.2, 12);
  const runeGeo = new THREE.TorusGeometry(0.3, 0.06, 8, 24);
  disposables.push(pillarGeo, stubGeo, runeGeo);

  // Runes live on three specific pillars (indices into the 10-pillar ring),
  // spread around the arena: south-east, west and north.
  const RUNE_PILLARS = [1, 4, 7];
  const runeGlow = () => {
    runesFound++;
    api.showMessage(`A rune hums beneath your fingers… (${runesFound}/3)`);
    if (runesFound >= 3 && platesDone >= 2) {
      api.showMessage('The runes are complete — the altar across the chasm stirs.');
    }
  };

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * 16;
    const z = 10 + Math.sin(a) * 13;
    const broken = i % 3 === 1;
    const pillar = new THREE.Mesh(broken ? stubGeo : pillarGeo, i % 4 === 2 ? mossMat : stoneMat);
    pillar.position.set(x, broken ? 1.1 : 2.5, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    objects.push(pillar);
    walkables.push(pillar);
    solid(pillar);

    if (RUNE_PILLARS.includes(i)) {
      const rune = new THREE.Mesh(runeGeo, runeMat.clone());
      // Snap onto the pillar's inner face (0.75 in from its centre).
      rune.position.set(x - Math.cos(a) * 0.75, 1.8, z - Math.sin(a) * 0.75);
      rune.lookAt(0, 1.8, 10);
      rune.userData.prompt = 'Trace the ancient rune';
      rune.userData.onInteract = () => {
        if (rune.userData.found) return;
        rune.userData.found = true;
        rune.material.emissive.setHex(0xe89b2f);
        rune.material.emissiveIntensity = 1.8;
        rune.scale.setScalar(1.35);
        runeGlow();
      };
      objects.push(rune);
      interactables.push(rune);
    }
  }

  // ---- pressure plates + pushable blocks (puzzle step 1) ----------------
  const plateGeo = new THREE.CylinderGeometry(1, 1, 0.12, 24);
  const plateMatA = new THREE.MeshStandardMaterial({ color: 0x3d3020, emissive: 0x000000 });
  const plateMatB = plateMatA.clone();
  const blockGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xb2a37f, roughness: 0.8 });
  disposables.push(plateGeo, plateMatA, plateMatB, blockGeo, blockMat);

  const plates = [];
  const blocks = [];
  [[-6, plateMatA], [6, plateMatB]].forEach(([x, mat], idx) => {
    const plate = new THREE.Mesh(plateGeo, mat);
    plate.position.set(x, 0.06, 6);
    plate.receiveShadow = true;
    objects.push(plate);

    const block = new THREE.Mesh(blockGeo, blockMat);
    block.position.set(x, 0.6, 15);
    block.castShadow = true;
    block.receiveShadow = true;
    block.userData.prompt = 'Push the block toward its plate';
    block.userData.onInteract = () => {
      if (block.userData.locked) return;
      // One firm shove: 2.4 units toward the plate, snapping onto it.
      block.position.z -= 2.4;
      if (block.position.z <= plate.position.z + 1.2) {
        block.position.set(x, 0.6, plate.position.z);
        block.userData.locked = true;
        block.userData.prompt = 'The block is seated';
        mat.emissive.setHex(0x4fd0e8);
        mat.color.setHex(0x2f6070);
        platesDone++;
        walkables.push(block);
        if (platesDone >= 2) {
          api.showMessage('Both plates are down — something on the chasm rim has awakened.');
          leverMat.emissive.setHex(0xe89b2f);
          leverMat.emissiveIntensity = 1.2;
        } else {
          api.showMessage('The plate clicks into place. One more block remains.');
        }
      }
      block.userData.solidBox.setFromObject(block);
    };
    solid(block);
    objects.push(block);
    interactables.push(block);
    plates.push(plate);
    blocks.push(block);
  });

  // ---- rotating bridge (puzzle step 2) -----------------------------------
  const deckGeo = new THREE.BoxGeometry(3, 0.4, 12);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x9d8c6d, roughness: 0.85 });
  disposables.push(deckGeo, deckMat);

  const bridge = new THREE.Group();
  bridge.position.set(0, 0, -5); // pivot at the arena's chasm edge
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(0, 0.2, -6); // when closed: spans z -5 .. -17, top at y 0.4
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);
  bridge.rotation.y = Math.PI / 2; // swung aside — not crossing yet
  objects.push(bridge);

  const leverMat = new THREE.MeshStandardMaterial({ color: 0x3d3020, emissive: 0x000000 });
  const leverGeo = new THREE.BoxGeometry(0.5, 1.1, 0.5);
  const leverTipGeo = new THREE.OctahedronGeometry(0.22, 0);
  disposables.push(leverMat, leverGeo, leverTipGeo);
  const lever = new THREE.Mesh(leverGeo, leverMat);
  lever.position.set(3, 0.55, -3.6);
  lever.castShadow = true;
  const leverTip = new THREE.Mesh(leverTipGeo, glowMat);
  leverTip.position.y = 0.75;
  lever.add(leverTip);
  objects.push(lever);
  solid(lever);
  lever.userData.prompt = 'Bridge control — rotate the stone bridge';
  lever.userData.onInteract = () => {
    if (bridgeDeployed || bridgeRotating) return;
    if (platesDone < 2) {
      api.showMessage('The control is dead. The pressure plates must be weighted first.');
      return;
    }
    bridgeRotating = true;
    api.showMessage('Ancient gears groan — the bridge is swinging into place…');
  };
  interactables.push(lever);

  function deployBridge(delta) {
    bridge.rotation.y = Math.max(0, bridge.rotation.y - delta * 1.1);
    if (bridge.rotation.y <= 0) {
      bridgeDeployed = true;
      bridgeRotating = false;
      walkables.push(deck);
      solid(deck);
      api.showMessage('The bridge locks across the chasm.');
    }
  }

  // ---- altar + core (puzzle steps 4-5) ------------------------------------
  const altarBaseGeo = new THREE.CylinderGeometry(2.2, 2.6, 0.9, 8);
  const altarMat = new THREE.MeshStandardMaterial({ color: 0x7d6c52, roughness: 0.9 });
  disposables.push(altarBaseGeo, altarMat);
  const altar = new THREE.Mesh(altarBaseGeo, altarMat);
  altar.position.set(0, 0.45, -26);
  altar.castShadow = true;
  altar.receiveShadow = true;
  objects.push(altar);
  walkables.push(altar);
  solid(altar);

  const coreGeo = new THREE.OctahedronGeometry(0.45, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a, emissive: 0xe89b2f, emissiveIntensity: 2.2, roughness: 0.25,
  });
  const beamGeo = new THREE.CylinderGeometry(0.45, 0.45, 16, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffc35c, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  disposables.push(coreGeo, coreMat, beamGeo, beamMat);

  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 1.7, -26);
  core.visible = false;
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 8.5, -26);
  beam.visible = false;
  objects.push(core, beam);

  core.userData.prompt = 'Take the Ancient Core';
  core.userData.onInteract = () => {
    if (!coreRevealed || coreTaken) return;
    coreTaken = true;
    core.visible = false;
    beam.visible = false;
    api.showMessage('The Ancient Core is yours. One socket on the Time Machine ignites…');
    api.completeLevel(); // → timeMachine.lightSocket(0) → Level 2
  };
  interactables.push(core);

  altar.userData.prompt = 'Examine the ancient altar';
  altar.userData.onInteract = () => {
    if (coreTaken) { api.showMessage('The altar is silent now.'); return; }
    if (!coreRevealed) {
      if (runesFound < 3) { api.showMessage(`The altar is cold. ${3 - runesFound} rune${runesFound === 2 ? '' : 's'} remain hidden in the ruins.`); return; }
      if (platesDone < 2) { api.showMessage('The altar is cold. The pressure plates are not all weighted.'); return; }
      revealCore();
    }
  };
  interactables.push(altar);

  function revealCore() {
    coreRevealed = true;
    core.visible = true;
    beam.visible = true;
    api.showMessage('The altar splits open — the Ancient Core rises into the light!');
  }

  // ---- decorative mossy rubble -------------------------------------------
  const rubbleGeo = new THREE.DodecahedronGeometry(0.7, 0);
  disposables.push(rubbleGeo);
  for (let i = 0; i < 12; i++) {
    const rubble = new THREE.Mesh(rubbleGeo, i % 2 ? mossMat : stoneMat);
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 9;
    rubble.position.set(Math.cos(a) * r, 0.4, 10 + Math.sin(a) * r * 0.8);
    rubble.rotation.set(Math.random(), Math.random(), Math.random());
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    objects.push(rubble);
    walkables.push(rubble);
  }

  // ---- per-frame animation ------------------------------------------------
  function update(delta) {
    if (bridgeRotating) deployBridge(delta);
    if (core.visible) {
      core.rotation.y += delta * 1.4;
      core.position.y = 1.7 + Math.sin(performance.now() * 0.0016) * 0.15;
      beam.material.opacity = 0.13 + Math.sin(performance.now() * 0.002) * 0.05;
    }
  }

  // ---- hints ---------------------------------------------------------------
  api.setHint(() => {
    if (coreTaken) return 'Return through time…';
    if (coreRevealed) return 'Take the Ancient Core';
    if (runesFound >= 3 && platesDone >= 2) return 'Cross the bridge — commune with the altar';
    if (bridgeDeployed) return `Find the 3 hidden runes (${runesFound}/3)`;
    if (platesDone >= 2) return 'Rotate the bridge across the chasm';
    return `Push both blocks onto the pressure plates (${platesDone}/2)`;
  });

  return {
    interactables,
    objects,
    lights,
    disposables,
    colliders,
    walkables,
    update,
    spawn: new THREE.Vector3(0, 1.7, 20),
  };
}
