import * as THREE from 'three';
import { createLevelTextures } from '../textures.js';

/**
 * LEVEL 2 — THE MODERN LABORATORY (pitch doc §5)
 * Verb: INVESTIGATE — information hunting and electrical logic.
 * Visual identity: cool artificial light, glass, steel, humming screens.
 *
 * Puzzle chain:
 *   1. Pick up the flashlight on the workbench (F toggles it from now on).
 *   2. Find the security keycard in the office corner.
 *   3. The keycard opens the server room — a dark wing of the lab.
 *   4. In the dark, the flashlight reveals a maintenance note: the breaker
 *      sequence (blue → red → green).
 *   5. Throw the three breakers in that order; wrong order resets them.
 *   6. Power restored — the containment case opens: take the Lab Core.
 */
export function build(scene, api) {
  const interactables = [];
  const objects = [];
  const lights = [];
  const disposables = [];
  const colliders = [];
  const walkables = [];

  let hasFlashlight = false;
  let hasKeycard = false;
  let doorOpen = false;
  let noteRead = false;
  let powerOn = false;
  let coreTaken = false;
  let doorPos = 0; // 0 closed → 1 open (animation progress)

  // ---- lighting: cool artificial, main hall only — the server room stays dark
  const hemi = new THREE.HemisphereLight(0xc8d8e8, 0x11131c, 0.35);
  const overhead = new THREE.DirectionalLight(0xe0e8f0, 1.0);
  overhead.position.set(-6, 16, 6);
  overhead.castShadow = true;
  overhead.shadow.mapSize.set(2048, 2048);
  overhead.shadow.camera.left = -30;
  overhead.shadow.camera.right = 30;
  overhead.shadow.camera.top = 30;
  overhead.shadow.camera.bottom = -30;
  overhead.shadow.camera.far = 70;
  lights.push(hemi, overhead);

  const ceilGeo = new THREE.BoxGeometry(1.6, 0.12, 0.5);
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xdfe8f0, emissive: 0xbfd4e8, emissiveIntensity: 1.2,
  });
  disposables.push(ceilGeo, ceilMat);
  const flickers = [];
  [[-10, 8], [0, 8], [10, 8], [-10, -2], [10, -2]].forEach(([x, z], i) => {
    // Clone per panel so each light flickers independently.
    const panelMat = ceilMat.clone();
    disposables.push(panelMat);
    const panel = new THREE.Mesh(ceilGeo, panelMat);
    panel.position.set(x, 3.9, z);
    objects.push(panel);
    flickers.push({ mesh: panel, phase: i * 1.7 });
    const pl = new THREE.PointLight(0xcfe0f0, 26, 16, 2);
    pl.position.set(x, 3.6, z);
    lights.push(pl);
  });

  scene.background = new THREE.Color(0x0d0f16);
  scene.fog = new THREE.FogExp2(0x0d0f16, 0.02);

  // ---- shared materials (stylised PBR sets from textures.js) ------------
  // Tile/panel/steel maps are baked in the lab palette; colour multipliers
  // recover the old darker tones (map base is one step brighter).
  const tex = createLevelTextures('modern-lab', { anisotropy: api.getMaxAnisotropy() });
  const wallMat = tex.material('wall', { repeat: [12, 2], params: { color: 0xa6adb8, roughness: 0.7, metalness: 0.3 } });
  const floorMat = tex.material('floor', { repeat: [12, 12], params: { roughness: 0.4, metalness: 0.35 } });
  const steelMat = tex.material('metal', { repeat: [2, 2], params: { roughness: 0.35, metalness: 0.85 } });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fd8e8, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.1,
  });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0d1420, emissive: 0x2f9e5f, emissiveIntensity: 1.1, roughness: 0.4,
  });
  disposables.push(tex, glassMat, screenMat);

  function solid(mesh) {
    mesh.userData.solidBox = new THREE.Box3().setFromObject(mesh);
    colliders.push(mesh);
    return mesh;
  }

  // ---- floor -----------------------------------------------------------------
  const floorGeo = new THREE.PlaneGeometry(46, 44);
  disposables.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  objects.push(floor);
  walkables.push(floor);

  // ---- perimeter walls (with wall-mounted screens) ----------------------------
  const wallGeoH = new THREE.BoxGeometry(46, 4, 0.5);
  const wallGeoV = new THREE.BoxGeometry(0.5, 4, 44);
  const screenGeo = new THREE.PlaneGeometry(2.6, 1.5);
  disposables.push(wallGeoH, wallGeoV, screenGeo);

  const north = new THREE.Mesh(wallGeoH, wallMat);
  north.position.set(0, 2, -22);
  const south = new THREE.Mesh(wallGeoH, wallMat);
  south.position.set(0, 2, 22);
  const west = new THREE.Mesh(wallGeoV, wallMat);
  west.position.set(-23, 2, 0);
  const east = new THREE.Mesh(wallGeoV, wallMat);
  east.position.set(23, 2, 0);
  [north, south, west, east].forEach((w) => { objects.push(w); solid(w); });

  for (let i = 0; i < 3; i++) {
    const sMat = screenMat.clone();
    disposables.push(sMat);
    const screen = new THREE.Mesh(screenGeo, sMat);
    screen.position.set(-14 + i * 9, 2.1, -21.7);
    objects.push(screen);
    flickers.push({ mesh: screen, phase: i * 2.3, screen: true });
  }

  // ---- server room (east wing, dark, keycard-gated) ---------------------------
  // Walls: x 8..22, z -22..-10. Door gap in the west wall at z -15..-11.
  const srWallGeoA = new THREE.BoxGeometry(0.4, 4, 8);   // west wall pieces
  const srWallGeoB = new THREE.BoxGeometry(14, 4, 0.4);  // north/south walls
  disposables.push(srWallGeoA, srWallGeoB);

  const srW1 = new THREE.Mesh(srWallGeoA, wallMat); // west wall, north part
  srW1.position.set(8, 2, -19);
  const srW2 = new THREE.Mesh(srWallGeoA, wallMat); // west wall, south part (below door)
  srW2.position.set(8, 2, -8);
  const srN = new THREE.Mesh(srWallGeoB, wallMat);
  srN.position.set(15, 2, -22);
  const srS = new THREE.Mesh(srWallGeoB, wallMat);
  srS.position.set(15, 2, -10);
  [srW1, srW2, srN, srS].forEach((w) => { objects.push(w); solid(w); });

  // Sliding door — retracts upward when the keycard reader accepts you.
  const doorGeo = new THREE.BoxGeometry(0.3, 3.2, 3.6);
  const doorMatS = tex.material('wall', {
    repeat: 1,
    params: { color: 0x99a3b2, roughness: 0.4, metalness: 0.7, emissive: 0x101820 },
  });
  disposables.push(doorGeo);
  const door = new THREE.Mesh(doorGeo, doorMatS);
  door.position.set(8, 1.6, -13);
  objects.push(door);
  let doorBox = new THREE.Box3().setFromObject(door);
  door.userData.solidBox = doorBox;
  colliders.push(door);

  // Keycard reader beside the door
  const readerGeo = new THREE.BoxGeometry(0.25, 0.4, 0.3);
  const readerMat = new THREE.MeshStandardMaterial({ color: 0x22262e, emissive: 0x8a1f1f, emissiveIntensity: 1.4 });
  disposables.push(readerGeo, readerMat);
  const reader = new THREE.Mesh(readerGeo, readerMat);
  reader.position.set(7.7, 1.4, -10.9);
  objects.push(reader);
  reader.userData.prompt = 'Keycard reader';
  reader.userData.onInteract = () => {
    if (doorOpen) { api.showMessage('The server room is already unlocked.'); return; }
    if (!hasKeycard) { api.showMessage('A red light blinks: SECURITY KEYCARD REQUIRED.'); return; }
    doorOpen = true;
    readerMat.emissive.setHex(0x2f9e5f);
    api.showMessage('Accepted. The blast door slides open — the room beyond is pitch dark.');
  };
  interactables.push(reader);

  // Dark-wing ambience: NO lights inside on purpose. The maintenance note is
  // only readable with the flashlight (checked via api.isFlashlightOn).
  const noteGeo = new THREE.PlaneGeometry(1.1, 0.8);
  const noteMat = new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.9 });
  disposables.push(noteGeo, noteMat);
  const note = new THREE.Mesh(noteGeo, noteMat);
  note.position.set(14.9, 1.6, -21.7);
  note.rotation.y = Math.PI;
  objects.push(note);
  note.userData.prompt = 'A maintenance note — too dark to read';
  note.userData.onInteract = () => {
    if (noteRead) { api.showMessage('The note reads: breaker order BLUE, RED, GREEN.'); return; }
    if (!hasFlashlight || !api.isFlashlightOn()) {
      api.showMessage('You can barely see it. A light source would help — press F.');
      return;
    }
    noteRead = true;
    noteMat.emissive.setHex(0x4fd0e8);
    noteMat.emissiveIntensity = 0.8;
    note.userData.prompt = 'Maintenance note (read)';
    api.showMessage('Under the flashlight, faded ink appears: "Breaker order — BLUE, RED, GREEN."');
  };
  interactables.push(note);

  // ---- three breakers (sequence puzzle) --------------------------------------
  const BREAKER_ORDER = ['blue', 'red', 'green']; // the solution
  const breakerColors = { red: 0xd94f4f, green: 0x4fd06a, blue: 0x4f8fd9 };
  const breakerGeo = new THREE.BoxGeometry(0.7, 1.0, 0.22);
  const leverGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  disposables.push(breakerGeo, leverGeo);
  const breakers = [];
  let seqIndex = 0;

  // Placed out of order around the server room: red, green, blue positions.
  const breakerDefs = [
    { key: 'red', x: 10.5, z: -21.7 },
    { key: 'green', x: 14, z: -21.7 },
    { key: 'blue', x: 17.5, z: -21.7 },
  ];
  breakerDefs.forEach(({ key, x, z }) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2f3a, emissive: 0x000000, roughness: 0.5, metalness: 0.5,
    });
    disposables.push(mat);
    const box = new THREE.Mesh(breakerGeo, mat);
    box.position.set(x, 1.5, z);
    box.rotation.y = Math.PI;
    objects.push(box);
    const lever = new THREE.Mesh(leverGeo, steelMat);
    lever.position.set(x, 1.35, z - 0.2);
    objects.push(lever);

    const state = { key, lit: false, mat, lever };
    box.userData.prompt = `Breaker (${key.toUpperCase()})`;
    box.userData.onInteract = () => {
      if (powerOn) { api.showMessage('All breakers are locked in — power flows.'); return; }
      if (!noteRead) {
        api.showMessage('A breaker bank. Without the sequence, throwing them at random does nothing but reset.');
        return;
      }
      if (state.lit) { api.showMessage('That breaker is already on.'); return; }
      if (key === BREAKER_ORDER[seqIndex]) {
        state.lit = true;
        state.mat.emissive.setHex(breakerColors[key]);
        state.mat.emissiveIntensity = 1.6;
        state.lever.position.y += 0.3;
        seqIndex++;
        if (seqIndex === BREAKER_ORDER.length) {
          powerOn = true;
          caseGlass.visible = false;
          coreLight.intensity = 8;
          api.showMessage('The lab hums back to life. The containment case ahead unlocks…');
        } else {
          api.showMessage(`Breaker ${key.toUpperCase()} engaged. ${BREAKER_ORDER.length - seqIndex} to go.`);
        }
      } else {
        // Wrong order: everything drops back to zero.
        seqIndex = 0;
        breakers.forEach((b) => {
          b.lit = false;
          b.mat.emissive.setHex(0x000000);
          b.lever.position.y = 1.35;
        });
        api.showMessage('CLUNK — a safety relay trips. All breakers reset. The note said: BLUE, RED, GREEN.');
      }
    };
    interactables.push(box);
    breakers.push(state);
  });

  // ---- workbench + flashlight pickup (step 1) ----------------------------------
  const benchGeo = new THREE.BoxGeometry(4, 0.9, 1.4);
  const benchMat = tex.material('metal', { repeat: [2, 1], params: { color: 0x99a2b0, roughness: 0.5, metalness: 0.6 } });
  disposables.push(benchGeo);
  const bench = new THREE.Mesh(benchGeo, benchMat);
  bench.position.set(-12, 0.45, 12);
  bench.castShadow = true;
  bench.receiveShadow = true;
  objects.push(bench);
  solid(bench);

  const torchGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 12);
  const torchMat = new THREE.MeshStandardMaterial({
    color: 0x22262e, emissive: 0x4fd0e8, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.35,
  });
  disposables.push(torchGeo, torchMat);
  const torch = new THREE.Mesh(torchGeo, torchMat);
  torch.position.set(-12, 1.05, 12);
  torch.rotation.z = Math.PI / 2;
  objects.push(torch);
  torch.userData.prompt = 'Take the flashlight';
  torch.userData.onInteract = () => {
    if (hasFlashlight) return;
    hasFlashlight = true;
    torch.visible = false;
    api.grantFlashlight();
    api.showMessage('Flashlight acquired — press F to toggle it. Somewhere dark needs it.');
  };
  interactables.push(torch);

  // ---- office desk + keycard (step 2) ------------------------------------------
  const deskGeo = new THREE.BoxGeometry(2.4, 0.8, 1.2);
  const deskMatW = tex.material('metal', { repeat: 1, params: { color: 0xa8adb6, roughness: 0.6, metalness: 0.4 } });
  disposables.push(deskGeo);
  const desk = new THREE.Mesh(deskGeo, deskMatW);
  desk.position.set(-17, 0.4, -16);
  desk.castShadow = true;
  objects.push(desk);
  solid(desk);

  const cardGeo = new THREE.BoxGeometry(0.3, 0.02, 0.2);
  const cardMat = new THREE.MeshStandardMaterial({
    color: 0xd8b84f, emissive: 0x6b5a20, emissiveIntensity: 0.7, roughness: 0.4,
  });
  disposables.push(cardGeo, cardMat);
  const keycard = new THREE.Mesh(cardGeo, cardMat);
  keycard.position.set(-17, 0.85, -16);
  keycard.rotation.y = 0.6;
  objects.push(keycard);
  keycard.userData.prompt = 'Security keycard';
  keycard.userData.onInteract = () => {
    if (hasKeycard) return;
    hasKeycard = true;
    keycard.visible = false;
    api.showMessage('Keycard acquired. Level 3 clearance — the east wing reader will accept it.');
  };
  interactables.push(keycard);

  // ---- containment case + Lab Core (final) -------------------------------------
  const caseGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.4, 24, 1, true);
  const caseGlass = new THREE.Mesh(caseGeo, glassMat);
  caseGlass.position.set(0, 1.2, -8);
  objects.push(caseGlass);

  const pedestalGeo = new THREE.CylinderGeometry(0.9, 1.1, 0.5, 24);
  const pedestalMat = tex.material('metal', { repeat: 1, params: { color: 0x6b7078, metalness: 0.7, roughness: 0.35 } });
  disposables.push(pedestalGeo, caseGeo);
  const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
  pedestal.position.set(0, 0.25, -8);
  pedestal.castShadow = true;
  objects.push(pedestal);
  walkables.push(pedestal);
  solid(pedestal);

  const coreGeo = new THREE.OctahedronGeometry(0.42, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x7fe8ff, emissive: 0x1fb6ff, emissiveIntensity: 2.4, roughness: 0.2,
  });
  disposables.push(coreGeo, coreMat);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 1.55, -8);
  objects.push(core);
  const coreLight = new THREE.PointLight(0x4fd0e8, 2.5, 10, 2);
  coreLight.position.set(0, 1.6, -8);
  lights.push(coreLight);

  core.userData.prompt = 'Take the Lab Core';
  core.userData.onInteract = () => {
    if (coreTaken) return;
    if (!powerOn) {
      api.showMessage('The case is sealed — dead without power. Restore the breakers in the server room.');
      return;
    }
    coreTaken = true;
    core.visible = false;
    coreLight.intensity = 0;
    api.showMessage('The Lab Core is yours. A second socket on the Time Machine ignites…');
    api.completeLevel(); // → timeMachine.lightSocket(1) → Level 3
  };
  interactables.push(core);

  // A couple of flavour terminals so the hall feels like a working lab.
  const termGeo = new THREE.BoxGeometry(1.3, 0.9, 0.7);
  const termMat = tex.material('wall', { repeat: 1, params: { color: 0x8f98a6, roughness: 0.5, metalness: 0.5 } });
  disposables.push(termGeo);
  [[8, 6], [8, 10]].forEach(([x, z]) => {
    const term = new THREE.Mesh(termGeo, termMat);
    term.position.set(x, 0.45, z);
    term.castShadow = true;
    objects.push(term);
    solid(term);
    const tMat = screenMat.clone();
    disposables.push(tMat);
    const tScreen = new THREE.Mesh(screenGeo, tMat);
    tScreen.scale.setScalar(0.42);
    tScreen.position.set(x, 1.05, z - 0.4);
    tScreen.rotation.x = -0.35;
    objects.push(tScreen);
    flickers.push({ mesh: tScreen, phase: x * 1.3, screen: true });
  });

  // ---- per-frame animation --------------------------------------------------------
  function update(delta) {
    // Door retract animation (slides up into the ceiling).
    if (doorOpen && doorPos < 1) {
      doorPos = Math.min(1, doorPos + delta * 0.8);
      door.position.y = 1.6 + doorPos * 2.6;
      doorBox.setFromObject(door);
      if (doorPos >= 1) colliders.splice(colliders.indexOf(door), 1);
    }
    // Screen + ceiling panel flicker.
    const t = performance.now() * 0.001;
    for (const f of flickers) {
      const base = f.screen ? 1.1 : 1.2;
      f.mesh.material.emissiveIntensity = base + Math.sin(t * 7 + f.phase) * 0.18 + (Math.sin(t * 31 + f.phase) > 0.96 ? -0.5 : 0);
    }
    if (core.visible) {
      core.rotation.y += delta * 1.6;
      core.position.y = 1.55 + Math.sin(t * 2) * 0.08;
      coreLight.intensity = powerOn ? 6 + Math.sin(t * 3) * 2 : 2.5;
    }
  }

  // ---- hints -------------------------------------------------------------------------
  api.setHint(() => {
    if (coreTaken) return 'Return through time…';
    if (powerOn) return 'Take the Lab Core from the containment case';
    if (noteRead) return `Throw the breakers in order: BLUE, RED, GREEN (${seqIndex}/3)`;
    if (doorOpen) return 'Search the dark server room — flashlight on (F)';
    if (hasKeycard) return 'Use the keycard on the east wing reader';
    if (hasFlashlight) return 'Find the security keycard in the office';
    return 'Pick up the flashlight from the workbench';
  });

  return {
    interactables,
    objects,
    lights,
    disposables,
    colliders,
    walkables,
    update,
    spawn: new THREE.Vector3(0, 1.7, 18),
  };
}
