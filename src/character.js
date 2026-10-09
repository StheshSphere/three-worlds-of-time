import * as THREE from 'three';
import { assets } from './core/assets.js';

/**
 * The hero — Ari, Prof. Adeyemi's student inventor. Base model: KayKit's
 * "Mage" (CC0, rigged + animated); our asset pipeline removes the hat, cape
 * and props and recolours the robe into a white lab coat. Gear we model
 * ourselves is attached to the skeleton — HIERARCHICAL MODELLING again:
 *
 *   head bone
 *     └─ goggles (strap + two brass rims + tinted lenses), pushed up on the forehead
 *   chest bone
 *     └─ hourglass pack (brass frame)
 *          ├─ glass bulbs (top + bottom)
 *          └─ sand (emissive, fills as cores are recovered)
 *   wrist.r bone
 *     └─ chrono-gauntlet ring (emissive, pulses; flares when dashing)
 *
 * Because the gear is parented to bones, it follows every animation for free.
 *
 * Animation: one AnimationMixer, one action per clip. Locomotion
 * (idle / walk / run) cross-fades by actual ground speed; one-shot clips
 * (interact, hit, dash, cheer, death) play over it and fade back.
 */
const CLIP = {
  idle: 'Idle', walk: 'Walking_A', run: 'Running_A', jumpStart: 'Jump_Start', jumpAir: 'Jump_Idle',
  land: 'Jump_Land', interact: 'Interact', pickup: 'PickUp', hit: 'Hit_A', death: 'Death_A',
  cheer: 'Cheer', dash: 'Dodge_Forward', use: 'Use_Item', lie: 'Lie_Idle', getUp: 'Lie_StandUp', channel: 'Spellcasting',
};
const ONE_SHOTS = new Set(['interact', 'pickup', 'hit', 'death', 'cheer', 'dash', 'use', 'land', 'jumpStart', 'lie', 'getUp', 'channel']);

export function createHero() {
  const group = new THREE.Group();
  group.name = 'Hero';
  const gltf = assets.gltf('hero');
  const disposables = [];

  if (!gltf) {
    // Fallback capsule so the game still runs if the model failed to load.
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3b3f8f }));
    m.position.y = 0.85;
    group.add(m);
    return { group, update() {}, play() {}, setCores() {}, setDashGlow() {}, reset() {}, gauntletWorld: new THREE.Vector3() };
  }

  const model = assets.prop('hero');
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow animation
      if (o.material) { o.material.roughness = 0.75; o.material.envMapIntensity = 0.8; }
    }
  });
  group.add(model);

  const bone = (name) => {
    let found = null;
    model.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; });
    return found;
  };

  /* ------------------------------ gear ------------------------------ */
  const brass = new THREE.MeshStandardMaterial({ color: 0xe0a84e, metalness: 1, roughness: 0.38 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1 });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa53a, emissiveIntensity: 0.4, roughness: 0.6 });
  const gauntletMat = new THREE.MeshStandardMaterial({ color: 0x1c1d2e, emissive: 0x7ad7ff, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 });
  disposables.push(brass, glass, sandMat, gauntletMat);

  // Goggles: strap ring around the head, two brass rims with tinted lenses.
  const goggles = new THREE.Group();
  goggles.name = 'Goggles';
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f2a33, emissive: 0x2fbfd6, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.08 });
  disposables.push(strapMat, lensMat);
  const strapGeo = new THREE.TorusGeometry(0.46, 0.035, 6, 40);
  const rimGeo = new THREE.TorusGeometry(0.115, 0.032, 10, 24);
  const lensGeo = new THREE.CircleGeometry(0.105, 24);
  const bridgeGeo = new THREE.BoxGeometry(0.08, 0.035, 0.04);
  disposables.push(strapGeo, rimGeo, lensGeo, bridgeGeo);
  const strap = new THREE.Mesh(strapGeo, strapMat);
  strap.rotation.x = Math.PI / 2;
  strap.scale.set(1, 1.08, 1);
  goggles.add(strap);
  for (const sx of [-0.15, 0.15]) {
    const rimMesh = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0xd6a24c, metalness: 1, roughness: 0.3 }));
    disposables.push(rimMesh.material);
    rimMesh.position.set(sx, 0, 0.47);
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(sx, 0, 0.475);
    goggles.add(rimMesh, lens);
  }
  const bridge = new THREE.Mesh(bridgeGeo, strapMat);
  bridge.position.set(0, 0, 0.48);
  goggles.add(bridge);
  goggles.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const headBone = bone('head');
  if (headBone) {
    headBone.add(goggles);
    // Sits on the forehead (pushed up), tilted back slightly.
    goggles.position.set(0, 0.62, 0.02);
    goggles.rotation.x = -0.32;
  }

  const pack = new THREE.Group();
  pack.name = 'HourglassPack';
  const plateGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 18);
  const rodGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6);
  const bulbGeo = new THREE.SphereGeometry(0.13, 18, 12);
  const sandTopGeo = new THREE.ConeGeometry(0.1, 0.13, 16);
  const sandBotGeo = new THREE.ConeGeometry(0.115, 0.11, 16);
  disposables.push(plateGeo, rodGeo, bulbGeo, sandTopGeo, sandBotGeo);
  const top = new THREE.Mesh(plateGeo, brass); top.position.y = 0.21;
  const bot = new THREE.Mesh(plateGeo, brass); bot.position.y = -0.21;
  pack.add(top, bot);
  for (let i = 0; i < 3; i++) {
    const rod = new THREE.Mesh(rodGeo, brass);
    const a = (i / 3) * Math.PI * 2;
    rod.position.set(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15);
    pack.add(rod);
  }
  const bulbTop = new THREE.Mesh(bulbGeo, glass); bulbTop.scale.set(1, 0.85, 1); bulbTop.position.y = 0.1;
  const bulbBot = new THREE.Mesh(bulbGeo, glass); bulbBot.scale.set(1, 0.85, 1); bulbBot.position.y = -0.1;
  const sandTop = new THREE.Mesh(sandTopGeo, sandMat); sandTop.rotation.x = Math.PI; sandTop.position.y = 0.09;
  const sandBot = new THREE.Mesh(sandBotGeo, sandMat); sandBot.position.y = -0.14;
  pack.add(bulbTop, bulbBot, sandTop, sandBot);
  pack.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const chest = bone('chest') || bone('spine');
  if (chest) {
    chest.add(pack);
    // KayKit bones are in the rig's (scaled) space — place it on the back.
    pack.position.set(0, 0.32, -0.42);
    pack.rotation.x = -0.18;
    pack.scale.setScalar(1.25);
  } else {
    group.add(pack);
    pack.position.set(0, 1.2, -0.3);
  }

  const ringGeo = new THREE.TorusGeometry(0.11, 0.035, 8, 20);
  disposables.push(ringGeo);
  const gauntlet = new THREE.Mesh(ringGeo, gauntletMat);
  gauntlet.name = 'ChronoGauntlet';
  const wrist = bone('wrist.r') || bone('hand.r');
  if (wrist) { wrist.add(gauntlet); gauntlet.rotation.x = Math.PI / 2; gauntlet.scale.setScalar(1.3); }

  // KayKit characters are authored ~1.8 units tall, which matches our metre
  // scale (eye height 1.6 m), so the model is used at scale 1.

  /* ------------------------------ animation ------------------------------ */
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [key, name] of Object.entries(CLIP)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (ONE_SHOTS.has(key)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[key] = a;
  }
  let base = 'idle';
  let oneShot = null;
  let oneShotUntil = 0;
  let time = 0;
  if (actions.idle) actions.idle.play();

  function fadeTo(key, dur = 0.22) {
    const next = actions[key];
    if (!next || key === base) return;
    const prev = actions[base];
    next.reset().setEffectiveWeight(1).fadeIn(dur).play();
    if (prev) prev.fadeOut(dur);
    base = key;
  }

  /** Play a one-shot clip on top of locomotion. hold=true keeps the last frame (death/cheer). */
  function play(key, { hold = false, speed = 1, loop = false } = {}) {
    const a = actions[key];
    if (!a) return;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (oneShot && actions[oneShot] && oneShot !== key) actions[oneShot].fadeOut(0.1);
    a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).fadeIn(0.08).play();
    if (actions[base]) actions[base].fadeOut(0.08);
    oneShot = key;
    oneShotUntil = hold || loop ? Infinity : time + a.getClip().duration / speed - 0.12;
  }

  let wasGrounded = true;
  let cores = 0;
  let dashGlow = 0;

  function update(dt, st) {
    time += dt;
    // finish a one-shot → fade locomotion back in
    if (oneShot && time >= oneShotUntil) {
      actions[oneShot].fadeOut(0.18);
      oneShot = null;
      const b = actions[base];
      if (b) b.reset().fadeIn(0.18).play();
    }
    if (!oneShot) {
      let want = 'idle';
      if (!st.grounded) want = 'jumpAir';
      else if (st.speed > 6.2) want = 'run';
      else if (st.speed > 0.35) want = 'walk';
      if (want !== base) fadeTo(want, want === 'jumpAir' ? 0.12 : 0.22);
      if (base === 'walk' && actions.walk) actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(st.speed / 3.2, 0.7, 1.6));
      if (base === 'run' && actions.run) actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(st.speed / 7.5, 0.85, 1.35));
    }
    if (st.grounded && !wasGrounded && st.fallSpeed > 9 && !oneShot) play('land', { speed: 1.6 });
    wasGrounded = st.grounded;
    mixer.update(dt);

    // gear: sand glow tracks recovered cores, gauntlet pulses
    sandMat.emissiveIntensity = 0.35 + cores * 0.9 + Math.sin(time * 3) * 0.08;
    sandTop.scale.setScalar(Math.max(0.15, 1 - cores * 0.28));
    sandBot.scale.setScalar(0.35 + cores * 0.25);
    dashGlow = Math.max(0, dashGlow - dt * 3);
    gauntletMat.emissiveIntensity = 1.2 + Math.sin(time * 4) * 0.4 + dashGlow * 6;
  }

  return {
    group,
    update,
    play,
    setCores(n) { cores = n; },
    setGauntletColor(hex) { gauntletMat.emissive.setHex(hex); },
    setDashGlow() { dashGlow = 1; },
    /** Back to normal locomotion (ends a held/looping clip). */
    release() {
      if (!oneShot) return;
      actions[oneShot].fadeOut(0.25);
      oneShot = null;
      const b = actions[base];
      if (b) b.reset().fadeIn(0.25).play();
    },
    goggles,
    reset() {
      oneShot = null;
      for (const a of Object.values(actions)) a.stop();
      base = 'idle';
      if (actions.idle) actions.idle.reset().play();
    },
    dispose() { disposables.forEach((d) => d.dispose()); },
  };
}
