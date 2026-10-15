/**
 * Regression checks for nearby E interactions and solid push-block paths.
 * Renderer/DOM/audio are doubles; missing cached props use the game's fallback meshes.
 * This is NOT a browser playthrough, shader compilation, visual QA or FPS measurement.
 * Run from root: node tools/test-interactions.mjs
 */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./tests/support/loader.mjs', import.meta.url);
const { Element } = await import('./tests/support/dom.mjs');
const THREE = await import('three');
const { settings } = await import('../src/core/settings.js');
const { JourneyStore, SAVE_KEY, validateSave } = await import('../src/core/save.js');
const { Player } = await import('../src/player.js');
const { createTimeMachine } = await import('../src/timeMachine.js');
const { createLevelManager } = await import('../src/levelManager.js');
const { createKit } = await import('../src/core/kit.js');
const { UI } = await import('../src/core/ui.js');
const { Cutscene } = await import('../src/core/cutscene.js');
const { assets } = await import('../src/core/assets.js');
const { ARRIVALS, ERA_CARDS } = await import('../src/story.js');
if (process.env.REAL_MODELS === '1') {
  const { loadModelGeometry } = await import('./tests/support/models.mjs');
  await loadModelGeometry();
}
settings.set('quality', 'low');
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.stack }); console.error('FAIL', name, e.stack); }
}
const dom = new Element();
dom.requestPointerLock = () => { document.pointerLockElement = dom; document.dispatchEvent(new Event('pointerlockchange')); };
const camera = new THREE.PerspectiveCamera(72, 16/9, 0.05, 600);
const player = new Player(camera, dom);
const scene = new THREE.Scene();
scene.add(player.object, player.worldFx, camera);
const tm = createTimeMachine(); scene.add(tm);
const sounds = [];
const positionals = new Set();
const audio = {
  play(name) { sounds.push(name); }, stopEffects() {}, stopMusic() {}, duck() {},
  playMusic(name) { this.music = name; }, setAmbience(name) { this.ambience = name; },
  positional(name, object) {
    const sound = { isPlaying: true, setVolume() {}, pause() { this.isPlaying = false; }, play() { this.isPlaying = true; } };
    const handle = { sound, dispose() { sound.isPlaying = false; positionals.delete(handle); } };
    positionals.add(handle); return handle;
  },
};
const ui = new UI(audio);
const postfx = { u: { uGlitch: { value: 0 }, uWarp: { value: 0 }, uFlash: { value: 0 } }, setEra() {} };
const minimap = { setObjective() {}, setAccent() {} };
const levels = createLevelManager({ scene, renderer: {}, camera, player, timeMachine: tm, audio, ui, postfx, minimap });
const tick = (seconds, physics = false) => { for (let i=0;i<Math.ceil(seconds*60);i++) { levels.update(1/60); tm.update(1/60); scene.updateMatrixWorld(true); if (physics) player.update(1/60); } };
const press = code => { const e = new Event('keydown', { cancelable:true }); Object.assign(e,{code,repeat:false}); window.dispatchEvent(e); };
const continueDialogue = () => { let n=0; while (ui.dialogue.active) { assert.ok(++n<50); assert.ok(ui.dialogue.advance()); } };
const play = (seconds, physics = false) => { for (let i=0;i<Math.ceil(seconds*60);i++) { continueDialogue(); tick(1/60,physics); } continueDialogue(); };

const promptOf = o => typeof o.userData.prompt === 'function' ? o.userData.prompt() : o.userData.prompt;
function pose(pos, yaw = 0, pitch = 0) {
  player.position.fromArray(pos); player.yaw = yaw; player.pitch = pitch;
  player.velocity.set(0, 0, 0); player._clearKeys();
  player.frozen = false; player.inputEnabled = true;
  scene.updateMatrixWorld(true); player._placeCamera(0); player._updateInteraction();
}
function pressE() { player._key2('KeyE', true); player._key2('KeyE', false); }
function load(i) { levels.load(i); continueDialogue(); ui.closeAllPanels(); player.inputEnabled = true; }

for (const view of ['first', 'third']) {
  test(`${view}: all three wall tablets collect with E without aiming at them`, () => {
    load(0); player.mode = view;
    const positions = [[24, .1, 7.6], [-7, .1, -32.4], [10, .1, -47]];
    positions.forEach((pos, i) => {
      pose(pos, 0, .35); // look along -Z and upwards, away from each wall carving
      assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Carved tablet');
      assert.equal(player.interaction.status, 'ready'); pressE();
      assert.equal(levels.debug.state.tablets[i], true); continueDialogue();
    });
    assert.equal(ui.journal.filter(j => j.key?.startsWith('tablet-')).length, 3);
    pressE(); continueDialogue(); assert.equal(ui.journal.filter(j => j.key?.startsWith('tablet-')).length, 3, 'rereading does not duplicate clues');
  });
  test(`${view}: tablet guide appears before reach; walls and distance prevent collection`, () => {
    load(0); player.mode = view;
    pose([6.8, .1, -46.4], Math.PI);
    assert.equal(player.nearbyInteractable?.id, undefined, promptOf(player.nearbyInteractable || { userData: {} }));
    assert.equal(player.interaction.guide?.userData.interaction.label, 'Carved tablet');
    assert.equal(player.interaction.status, 'closer'); pressE();
    assert.equal(levels.debug.state.tablets[2], false);
    pose([14.2, .1, -47]); // other side of the Sun Court wall
    assert.equal(player.nearbyInteractable?.id, undefined, promptOf(player.nearbyInteractable || { userData: {} }));
    assert.equal(player.interaction.status, 'blocked'); pressE();
    assert.equal(levels.debug.state.tablets[2], false);
  });
  test(`${view}: Lab logs, tiny flashlight and ink can be collected with E`, () => {
    load(1); player.mode = view;
    pose([10.5, 0, 8.2], Math.PI, .25);
    assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Incident log');
    pressE(); assert.equal(levels.debug.state.readIncident, true); ui.closeAllPanels(); continueDialogue();
    pose([-19.8, 0, -3.2], Math.PI, .25);
    assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Flashlight');
    pressE(); assert.equal(levels.debug.state.flashlight, true); continueDialogue();
    assert.equal(player.flashlightOn, true);
    pose([-18, 0, -2.7], Math.PI, .25);
    assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Professor’s notes');
    pressE(); assert.ok(ui.journal.some(j => j.key === 'prof')); ui.closeAllPanels(); continueDialogue();
    pose([-21, 0, 2.6], 0, .2);
    assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Chalkboard');
    pressE(); assert.equal(ui.panelOpen, true); ui.closeAllPanels(); continueDialogue();
    const marks = player.interactables.filter(o => o.userData.interaction?.label === 'Phosphor ink');
    for (const m of marks) {
      player.setFlashlight(false); pose([m.position.x * .55, 0, m.position.z]);
      assert.notEqual(player.nearbyInteractable?.id, m.id, 'ink is unavailable with the light off');
      player.setFlashlight(true); player._updateInteraction();
      assert.equal(player.nearbyInteractable?.id, m.id); pressE(); continueDialogue();
    }
    assert.equal(levels.debug.state.marks.filter(Boolean).length, 4);
    assert.equal(ui.journal.filter(j => j.key?.startsWith('mark-')).length, 4);
  });
}

// Small real Three.js fixture: no geometry/raycast doubles.
function fixture() {
  const kit = createKit({}); let count = 0;
  const clue = kit.box({ size: [.2, .2, .2], pos: [1.8, 1.4, 0], mat: kit.basic(0xffffff), solid: false, walk: false, map: false });
  kit.interact(clue, 'Collect', () => { count++; }, { kind: 'clue', label: 'Test clue' });
  player.setLevel({ colliders: kit.colliders, interactables: kit.interactables, spawn: new THREE.Vector3() });
  return { kit, clue, count: () => count };
}
test('E rechecks distance, visibility, disabled state and dialogue/input lock at key-down', () => {
  const f = fixture(); pose([0, 0, 0]); assert.equal(player.nearbyInteractable?.id, f.clue.id);
  player.position.x = -10; pressE(); assert.equal(f.count(), 0);
  pose([0, 0, 0]); f.clue.visible = false; pressE(); assert.equal(f.count(), 0);
  f.clue.visible = true; pose([0, 0, 0]); f.clue.userData.prompt = () => null; pressE(); assert.equal(f.count(), 0);
  f.clue.userData.prompt = 'Collect'; pose([0, 0, 0]); player.inputEnabled = false; pressE(); assert.equal(f.count(), 0);
  player.inputEnabled = true; player.frozen = true; pressE(); assert.equal(f.count(), 0);
  player.frozen = false; pressE(); assert.equal(f.count(), 1);
});
test('Invisible wall proxies block E; a low floor decoration does not block eye-level reach', () => {
  const f = fixture(); const wall = f.kit.proxy({ size: [.1, 3, 3], pos: [.9, 1.5, 0] });
  pose([0, 0, 0]); pressE(); assert.equal(f.count(), 0);
  f.kit.removeCollider(wall);
  f.kit.proxy({ size: [.1, .2, 3], pos: [.9, .1, 0] });
  player._updateInteraction(); pressE(); assert.equal(f.count(), 1);
});
test('Hidden ancestors and a foreground inactive target do not mask a valid clue', () => {
  const f = fixture(); const parent = new THREE.Group(); parent.add(f.clue); parent.visible = false;
  pose([0, 0, 0]); pressE(); assert.equal(f.count(), 0);
  parent.visible = true;
  const inactive = f.kit.box({ size: [2, 2, .2], pos: [0, 1.5, -1], mat: f.kit.basic(0xffffff), solid: false, map: false });
  f.kit.interact(inactive, () => null, () => { throw new Error('Inactive target used'); });
  f.clue.position.set(0, 1.5, -2); pose([0, 0, 0]); pressE(); assert.equal(f.count(), 1);
});
test('Exact aiming selects the intended conduit tile among adjacent controls', () => {
  load(1); player.mode = 'first';
  const tiles = player.interactables.filter(o => promptOf(o) === 'Rotate the conduit tile');
  const before = levels.level.snapshot().tiles;
  const selected = tiles[5];
  pose([0, 0, -43.5]);
  player.camera.lookAt(selected.position); player.camera.updateMatrixWorld(true); player._updateInteraction();
  assert.equal(player.nearbyInteractable?.id, selected.id); pressE();
  const after = levels.level.snapshot().tiles;
  assert.equal(after[5], (before[5] + 1) % 4);
  assert.deepEqual(after.filter((_, i) => i !== 5), before.filter((_, i) => i !== 5));
});
test('Future: transformed energy nodes respond to E; the locked core cannot be taken', () => {
  load(2); player.mode = 'third';
  pose([-2.9, 3, -138.5], 0, -.15);
  assert.match(promptOf(player.nearbyInteractable) || '', /Touch the node/);
  let interactions = 0; const onUse = () => interactions++; player.addEventListener('interact', onUse);
  pressE(); assert.equal(interactions, 1); player.removeEventListener('interact', onUse); continueDialogue();
  pose([0, 3, -140]);
  assert.notEqual(player.nearbyInteractable?.userData.interaction?.label, 'Neon Core');
  assert.equal(levels.debug.state.coreTaken, false);
  play(.1); assert.equal(levels.debug.solvePuzzle(), true); play(2);
  pose([0, 3, -141], Math.PI, .3); pressE();
  assert.equal(levels.debug.state.coreTaken, true);
});
test('Lab: E cannot bypass containment, then collects the core after the powered console releases it', () => {
  load(1); player.mode = 'third';
  pose([18, 0, 2.3], 0, .15); pressE();
  assert.equal(levels.debug.state.coreTaken, false);
  levels.debug.solveGrid(); play(3);
  pose([15.35, 0, -1.8], 0, -.1);
  assert.equal(promptOf(player.nearbyInteractable || { userData: {} }), 'Disengage the containment field');
  pressE(); assert.equal(levels.debug.state.fieldDown, true); continueDialogue(); play(2);
  pose([18, 0, 2.3], Math.PI, .25);
  assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Lab Core');
  pressE(); assert.equal(levels.debug.state.coreTaken, true);
});

const blocks = () => player.colliders.filter(o => o.userData.onPush);
test('A low thin obstacle between tiles stops the entire block push, even with a clear destination', () => {
  load(0); const block = blocks()[0], before = block.position.clone();
  const obstacle = new THREE.Object3D();
  obstacle.userData.solidBox = new THREE.Box3(new THREE.Vector3(-2.04, .05, -23.3), new THREE.Vector3(-1.96, .25, -22.7));
  player.colliders.push(obstacle);
  assert.equal(block.userData.onPush(1, 0), false);
  play(.6); assert.ok(block.position.equals(before));
  assert.deepEqual(levels.level.snapshot().blocks[0], [2, 2]);
  player.colliders.splice(player.colliders.indexOf(obstacle), 1);
  assert.equal(block.userData.onPush(1, 0), true); play(.6);
  assert.deepEqual(levels.level.snapshot().blocks[0], [3, 2]);
});
test('All fallen columns have collision boxes; courtyard rubble stays in its own tile', () => {
  load(0);
  const rubble = levels.level.objects.filter(o => o.name === 'fallen-column');
  assert.ok(rubble.length >= 4);
  for (const o of rubble) {
    assert.ok(player.colliders.includes(o));
    if (o.position.z < -18 && o.position.z > -33) {
      const box = o.userData.solidBox; assert.ok(box.max.x - box.min.x <= 1.701); assert.ok(box.max.z - box.min.z <= 1.701);
    }
  }
});
test('Reset during a push restores mesh, collision, plate and save coordinates together', () => {
  load(0); const b = blocks(); b[0].userData.onPush(1, 0); tick(.1);
  assert.equal(b[1].userData.onPush(-1, 0), false, 'no crossing in-flight block moves');
  const reset = player.interactables.find(o => promptOf(o) === 'Reset the weights'); reset.userData.onInteract();
  assert.deepEqual(levels.level.snapshot().blocks, [[2, 2], [5, 3]]);
  assert.deepEqual(levels.debug.state.plates, [false, false]);
  assert.equal(b[0].position.x, -3); assert.equal(b[0].userData.solidBox.getCenter(new THREE.Vector3()).x, -3);
  play(1); assert.equal(b[0].position.x, -3, 'old animation must not resume');
});
test('The full weight puzzle remains solvable with normal walking pushes and solid rubble', () => {
  // This seed reproduced the rotated-column false collision before the fix.
  const random = Math.random; Math.random = () => 3942026415 / 4294967296;
  try { load(0); } finally { Math.random = random; }
  player.mode = 'first';
  const b = blocks();
  const route = [[0, 0, -1], [0, 1, 0], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, -1, 0],
    [1, -1, 0], [1, 0, -1], [1, 0, -1], [1, 0, -1], [1, 1, 0]];
  for (const [index, ax, az] of route) {
    const block = b[index], start = block.position.clone();
    pose([start.x - ax * 1.45, .1, start.z - az * 1.45], Math.atan2(-ax, -az));
    player._pushCooldown = 0; player.keys.forward = true;
    const old = JSON.stringify(levels.level.snapshot().blocks[index]);
    for (let i = 0; i < 80 && JSON.stringify(levels.level.snapshot().blocks[index]) === old; i++) {
      continueDialogue(); tick(1 / 60, true);
    }
    player._clearKeys(); player.velocity.set(0, 0, 0);
    assert.notEqual(JSON.stringify(levels.level.snapshot().blocks[index]), old, `walking push failed: ${index},${ax},${az}; block=${block.position.toArray()}; player=${player.position.toArray()}; timer=${player._pushTimer}; cd=${player._pushCooldown}; moving=${JSON.stringify(levels.level.snapshot().blocks)}; seed=${levels.level.snapshot().seed}`);
    play(.5, true);
    assert.ok(Math.abs(block.position.x - (start.x + ax * 2)) < 1e-6);
    assert.ok(Math.abs(block.position.z - (start.z + az * 2)) < 1e-6);
  }
  assert.deepEqual(levels.debug.state.plates, [true, true]); assert.equal(levels.debug.state.gateOpen, true);
});
test('UI guide changes between approach, obstruction and E-ready and clears on reset', () => {
  ui.setInteractionGuide(true, 400, 200, 'Carved tablet', 'closer', 5.2);
  assert.equal(document.getElementById('interaction-help').textContent, 'Approach the glowing arrow · 6 m');
  ui.setInteractionGuide(true, 400, 200, 'Carved tablet', 'blocked', 2);
  assert.equal(document.getElementById('interaction-help').textContent, 'Follow the nearby arrow to a clear side');
  ui.setInteractionGuide(true, 400, 200, 'Carved tablet', 'ready', 2);
  assert.equal(document.getElementById('interaction-help').textContent, 'Press E now');
  ui.resetTransient(); assert.equal(document.getElementById('interaction-guide').classList.contains('hidden'), true);
});

// No directional waypoint, and it always labels a distance only.
test('Blue badge is distance-only, does not transform into a compass', () => {
  ui.setWaypoint(true, 9999, -8888, 18);
  assert.equal(document.getElementById('wp-dist').textContent, '18 m to clue');
  assert.equal(document.getElementById('waypoint').style.transform, undefined);
  ui.setWaypoint(false);
  assert.equal(document.getElementById('waypoint').classList.contains('hidden'), true);
});
// All levels use the same shared close-range clue marker. No distant arrows.
const { ClueGuidance } = await import('../src/core/clueGuidance.js');
test('Shared physical clue arrows appear nearby and hide from a distance or after collection', () => {
  const effect = new ClueGuidance(scene);
  try {
    load(0); player.mode = 'third'; pose([6.8, .1, -46.4], Math.PI);
    effect.update(player, 1/60, 1, true);
    const wallTablet = player.interactables.find(o => o.userData.interaction?.label === 'Carved tablet' && o.position.z < -45);
    assert.equal(effect.markers.get(wallTablet)?.ring.visible, true, 'near-but-not-ready tablet should offer a reachable stand-here ring');
    for (const era of [0, 1, 2]) {
      load(era);
      if (era === 2) {
        pose([-2.9, 3, -138.5]); play(.1);
        assert.equal(levels.debug.solvePuzzle(), true); play(2);
      }
      const clue = player.interactables.find(o => o.userData.interaction?.kind === 'clue' && promptOf(o));
      assert.ok(clue, `era ${era} must have at least one clue`);
      const point = new THREE.Vector3();
      clue.updateWorldMatrix(true, false);
      point.copy(clue.userData.interaction.point).applyMatrix4(clue.matrixWorld);
      pose([point.x + 1.1, point.y - player.head.position.y + 0.1, point.z]);
      effect.update(player, 1/60, 1, true);
      assert.equal(effect.markers.get(clue)?.sprite.visible, true, `era ${era} clue not marked`);
      pose([point.x + 30, point.y - player.head.position.y, point.z]);
      effect.update(player, 1/60, 2, true);
      assert.equal(effect.markers.get(clue)?.sprite.visible, false, `era ${era} distant clue wrongly visible`);
      effect.update(player, 1/60, 2, false);
      assert.equal(effect.root.visible, false);
    }
  } finally { effect.reset(); scene.remove(effect.root); effect.ringGeo.dispose(); effect.texture.dispose(); }
});
ui.resetTransient();
console.log(JSON.stringify({ suite: 'Collision and nearby E interaction regressions (real Three.js, DOM/audio doubles)', passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results }, null, 2));
process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);

