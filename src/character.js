import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* --------------------------------------------------------------------------
 * Player character: an articulated low-poly explorer built in code, with an
 * automatic drop-in slot for a real rigged model.
 *
 * DROP-IN SLOT — assets/models/player/character.glb
 *   If that file exists it is loaded with GLTFLoader at startup and REPLACES
 *   the procedural body, no code changes needed. Recommended CC0 sources:
 *   Kenney "Mini Characters" / "Blocky Characters" (https://kenney.nl/assets)
 *   or Quaternius (https://quaternius.com) — all ship rigged GLTFs with
 *   idle/walk/run/jump clips, which are then driven by THREE.AnimationMixer.
 *   Expectations for the file: Y-up, roughly human scale, facing +Z; tune
 *   the constants just below if a chosen model needs a nudge.
 * ------------------------------------------------------------------------ */
const CHARACTER_GLTF_URL = 'assets/models/player/character.glb';
const CHARACTER_HEIGHT = 1.75; // metres — the model is uniformly scaled to this
const CHARACTER_GLTF_YAW = 0;  // radians — rotate the model onto +Z if needed

// Proportions of the procedural body (metres, origin at the feet, faces +Z).
const HIP_Y = 0.86;
const CHEST_PIVOT_Y = HIP_Y;

const _bbox = new THREE.Box3();

/**
 * Builds the character and returns a small driver:
 *
 *   group               — add to the player rig (feet at rig origin, +Z fwd)
 *   update(delta, st)   — st: { speed, grounded, sprint }
 *                         speed = actual horizontal speed (units/s)
 *   reset()             — zero the stride phase (respawn)
 *   applyGLTF(gltf)     — swap the procedural body for a loaded GLTF
 *
 * The procedural path animates joints directly; the GLTF path crossfades
 * clip actions via THREE.AnimationMixer. Both read the same state object,
 * so player.js never needs to know which one is active.
 */
export function createPlayerCharacter() {
  const group = new THREE.Group();
  group.name = 'PlayerCharacter';

  // ---- materials (one palette, reused across limbs) ----------------------
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.9 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x14333d, emissive: 0x4fd0e8, emissiveIntensity: 1.4, roughness: 0.4,
  });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x7a4f33, roughness: 0.85 });

  // ---- procedural body ----------------------------------------------------
  const proceduralRoot = new THREE.Group();

  const torsoGeo = new THREE.BoxGeometry(0.44, 0.52, 0.26);
  const hipsGeo = new THREE.BoxGeometry(0.38, 0.18, 0.24);
  const headGeo = new THREE.BoxGeometry(0.30, 0.27, 0.29);
  const visorGeo = new THREE.BoxGeometry(0.26, 0.09, 0.06);
  const armGeo = new THREE.BoxGeometry(0.13, 0.52, 0.15);
  const gloveGeo = new THREE.BoxGeometry(0.145, 0.12, 0.165);
  const legGeo = new THREE.BoxGeometry(0.15, 0.84, 0.17);
  const bootGeo = new THREE.BoxGeometry(0.17, 0.12, 0.24);
  const packGeo = new THREE.BoxGeometry(0.30, 0.34, 0.13);

  const chest = new THREE.Group();          // pivot at the waist — run-lean
  chest.position.y = CHEST_PIVOT_Y;
  proceduralRoot.add(chest);

  const torso = new THREE.Mesh(torsoGeo, suitMat);
  torso.position.y = 0.32;
  torso.castShadow = true;
  chest.add(torso);

  const beltLight = new THREE.Mesh(visorGeo, visorMat); // chest lamp, faces +Z
  beltLight.position.set(0, 0.40, 0.15);
  beltLight.scale.setScalar(0.55);
  chest.add(beltLight);

  const pack = new THREE.Mesh(packGeo, packMat);
  pack.position.set(0, 0.30, -0.19);
  pack.castShadow = true;
  chest.add(pack);

  const head = new THREE.Group();           // pivot at the neck
  head.position.y = 0.64;
  chest.add(head);
  const skull = new THREE.Mesh(headGeo, suitMat);
  skull.castShadow = true;
  head.add(skull);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.03, 0.155);
  head.add(visor);

  function makeArm(side) {                  // pivot at the shoulder
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.295, 0.50, 0);
    const arm = new THREE.Mesh(armGeo, suitMat);
    arm.position.y = -0.26;
    arm.castShadow = true;
    shoulder.add(arm);
    const glove = new THREE.Mesh(gloveGeo, darkMat);
    glove.position.y = -0.51;
    shoulder.add(glove);
    chest.add(shoulder);
    return shoulder;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const hips = new THREE.Mesh(hipsGeo, darkMat);
  hips.position.y = HIP_Y - 0.02;
  hips.castShadow = true;
  proceduralRoot.add(hips);

  function makeLeg(side) {                  // pivot at the hip
    const hip = new THREE.Group();
    hip.position.set(side * 0.125, HIP_Y, 0);
    const leg = new THREE.Mesh(legGeo, suitMat);
    leg.position.y = -0.43;
    leg.castShadow = true;
    hip.add(leg);
    const boot = new THREE.Mesh(bootGeo, darkMat);
    boot.position.set(0, -0.79, 0.035);
    hip.add(boot);
    proceduralRoot.add(hip);
    return hip;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  group.add(proceduralRoot);

  // ---- GLTF path (AnimationMixer + named clips) ---------------------------
  let mixer = null;
  let actions = null;         // { idle, walk, run, jump } — missing ones absent
  let currentAction = null;

  function disposeProcedural() {
    proceduralRoot.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    [suitMat, darkMat, visorMat, packMat].forEach((m) => m.dispose());
    group.remove(proceduralRoot);
  }

  function findClip(clips, patterns) {
    for (const p of patterns) {
      const clip = clips.find((c) => p.test(c.name));
      if (clip) return clip;
    }
    return null;
  }

  function crossfade(name, fade = 0.25) {
    if (!actions || !actions[name] || currentAction === actions[name]) return;
    const next = actions[name];
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (currentAction) currentAction.fadeOut(fade);
    currentAction = next;
  }

  function applyGLTF(gltf) {
    disposeProcedural();
    const model = gltf.scene;

    // Uniformly scale to CHARACTER_HEIGHT and plant the feet at y = 0.
    _bbox.setFromObject(model);
    const height = _bbox.max.y - _bbox.min.y;
    if (height > 0.05 && Math.abs(height - CHARACTER_HEIGHT) > 0.01) {
      const s = CHARACTER_HEIGHT / height;
      model.scale.setScalar(s);
      model.position.y -= _bbox.min.y * s;
    }
    model.rotation.y += CHARACTER_GLTF_YAW;
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    group.add(model);

    const clips = gltf.animations || [];
    if (clips.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const pick = (name, patterns) => {
        const clip = findClip(clips, patterns);
        return clip ? mixer.clipAction(clip) : null;
      };
      actions = {
        idle: pick('idle', [/idle/i, /breath/i]),
        walk: pick('walk', [/walk/i, /jog/i]),
        run: pick('run', [/run/i, /sprint/i]),
        jump: pick('jump', [/jump/i, /air/i, /fall/i]),
      };
      crossfade('idle', 0);
    }
  }

  // Kick off the drop-in load. A missing file is expected until the team
  // adds a model — the procedural body stays active in that case.
  new GLTFLoader().load(
    CHARACTER_GLTF_URL,
    (gltf) => applyGLTF(gltf),
    undefined,
    () => console.info(
      `[character] No GLTF at ${CHARACTER_GLTF_URL} — using the procedural body. `
      + 'Drop a CC0 rigged GLTF there (Kenney / Quaternius) and it loads automatically.',
    ),
  );

  // ---- animation state ----------------------------------------------------
  let phase = 0;   // stride phase (radians) — advances with distance walked
  let time = 0;    // seconds since spawn (idle sway)
  let airTime = 0;

  // Smooth toward a target rotation at a fixed exponential rate.
  function approach(rotation, target, delta, rate = 14) {
    rotation.x += (target - rotation.x) * Math.min(1, delta * rate);
  }

  function reset() {
    phase = 0;
    time = 0;
    airTime = 0;
  }

  function update(delta, state) {
    const { speed, grounded } = state;

    if (mixer) {
      mixer.update(delta);
      if (!grounded) {
        airTime += delta;
        crossfade('jump');
      } else {
        airTime = 0;
        if (speed > 6.8) crossfade('run');
        else if (speed > 0.3) crossfade('walk');
        else crossfade('idle');
      }
      return;
    }

    // Procedural animation: pose targets per state, then smooth toward them.
    time += delta;
    if (!grounded) airTime += delta;
    else airTime = 0;

    const amp = THREE.MathUtils.clamp(speed / 5.5, 0, 1.25); // 1 at walk speed
    if (speed > 0.3) phase += delta * speed * 1.75;
    const swing = Math.sin(phase);

    if (!grounded && airTime > 0.08) {
      // Airborne: a readable action pose — one knee up, arms forward.
      approach(legL.rotation, 0.55, delta, 10);
      approach(legR.rotation, -0.35, delta, 10);
      approach(armL.rotation, -0.85, delta, 10);
      approach(armR.rotation, -0.85, delta, 10);
      approach(chest.rotation, 0.10, delta, 10);
      chest.position.y = CHEST_PIVOT_Y;
    } else if (speed > 0.3) {
      // Walking / running: opposite leg–arm swing, stride scales with speed.
      approach(legL.rotation, swing * 0.62 * amp, delta);
      approach(legR.rotation, -swing * 0.62 * amp, delta);
      approach(armL.rotation, -swing * 0.50 * amp, delta);
      approach(armR.rotation, swing * 0.50 * amp, delta);
      // Forward lean and a step bounce, stronger as speed passes walk speed.
      approach(chest.rotation, 0.07 + amp * 0.10, delta, 8);
      chest.position.y = CHEST_PIVOT_Y + Math.abs(Math.cos(phase)) * 0.035 * amp;
    } else {
      // Idle: breathing bob and a gentle arm sway.
      approach(legL.rotation, 0, delta, 8);
      approach(legR.rotation, 0, delta, 8);
      approach(armL.rotation, Math.sin(time * 1.3) * 0.045, delta, 8);
      approach(armR.rotation, Math.sin(time * 1.3 + Math.PI) * 0.045, delta, 8);
      approach(chest.rotation, 0.02, delta, 8);
      chest.position.y = CHEST_PIVOT_Y + Math.sin(time * 2.1) * 0.008;
    }

    // Arms ride slightly outward from the body so they never clip the torso.
    armL.rotation.z = 0.09 + amp * 0.05;
    armR.rotation.z = -0.09 - amp * 0.05;
  }

  return { group, update, reset, applyGLTF };
}
