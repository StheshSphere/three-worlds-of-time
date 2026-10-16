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
const { clueInZone, interactionPoint, CLUE_ZONE_RADIUS } = await import('../src/core/interaction.js');
const { flashlightHitsInk } = await import('../src/core/flashlightInk.js');
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
  play(name) { sounds.push(name); }, stopEffects() {}, stopMusic() {}, duck() {}, playVoice() {}, stopVoice() {},
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

test('Archive ink beam check: light off, wrong direction and excessive distance all fail', () => {
  const target = new THREE.Vector3(-3, 1.6, -20);
  const origin = new THREE.Vector3(-1.5, 1.6, -20);
  const flash = { on: false, pos: origin, dir: new THREE.Vector3(-1, 0, 0) };
  assert.equal(flashlightHitsInk(flash, target), false);
  flash.on = true;
  assert.equal(flashlightHitsInk(flash, target), true);
  flash.dir.set(0, 0, -1);
  assert.equal(flashlightHitsInk(flash, target), false);
  flash.dir.set(-1, 0, 0); flash.pos.set(10, 1.6, -20);
  assert.equal(flashlightHitsInk(flash, target), false);
});
test('Arrow-left/right turn the flashlight in place without strafing; A/D still strafe', () => {
  load(1); player.mode = 'third';
  levels.debug.takeFlashlight(); continueDialogue();
  pose([0, 0, -17], 0, 0);
  player._updateFlashlight();
  const x = player.position.x, z = player.position.z, yaw = player.yaw;
  const before = new THREE.Vector3(); player.getFlashlightState({ on: false, pos: new THREE.Vector3(), dir: before });
  player._key2('ArrowLeft', true); player.update(.2); player._key2('ArrowLeft', false);
  assert.ok(player.yaw > yaw + .3, 'left arrow turns toward the left wall');
  assert.ok(Math.abs(player.position.x - x) < .001 && Math.abs(player.position.z - z) < .001, 'turning does not walk');
  const after = new THREE.Vector3(); player.getFlashlightState({ on: false, pos: new THREE.Vector3(), dir: after });
  assert.ok(after.x < before.x - .2, 'flashlight follows the turn');
  player._key2('ArrowRight', true); player.update(.2); player._key2('ArrowRight', false);
  assert.ok(Math.abs(player.yaw - yaw) < .02, 'right arrow turns back');
  load(0); player._key2('ArrowLeft', true);
  assert.equal(player.keys.left, true, 'arrow left retains its original strafe role in the Past');
  assert.equal(player.keys.turnLeft, false); player._key2('ArrowLeft', false);
});
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
  test(`${view}: invisible tablet circle is limited to nearby accessible space`, () => {
    load(0); player.mode = view;
    const tablet = player.interactables.find(o => o.userData.interaction?.label === 'Carved tablet' && o.position.z < -45);
    pose([4.7, .1, -46.4], Math.PI); // 7+ metres away: outside enlarged 6m circle
    assert.notEqual(player.nearbyInteractable?.id, tablet.id);
    pressE(); assert.equal(levels.debug.state.tablets[2], false);
    pose([14.2, .1, -47]); // opposite side of the Sun Court wall
    assert.notEqual(player.nearbyInteractable?.id, tablet.id);
    pressE(); assert.equal(levels.debug.state.tablets[2], false);
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
      // The nearby circle is deliberately not enough for the Archive ink.
      player.setFlashlight(false);
      pose([m.position.x * .55, 0, m.position.z], 0, 0);
      player._updateFlashlight(); player._updateInteraction();
      assert.notEqual(player.nearbyInteractable?.id, m.id, 'ink is unavailable with the light off');
      player.setFlashlight(true); player._updateFlashlight(); player._updateInteraction();
      assert.notEqual(player.nearbyInteractable?.id, m.id, 'even flashlight ON cannot reveal an unlit wall mark');
      pressE(); assert.equal(levels.debug.state.marks.filter(Boolean).length, marks.indexOf(m));
      // Turn to face the wall; light is shoulder-offset from the camera.
      player.yaw = m.position.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      player.pitch = .03;
      player._placeCamera(0); player._updateFlashlight(); player._updateInteraction();
      assert.equal(player.nearbyInteractable?.id, m.id, 'beam aimed at ink must enable the E prompt');
      pressE(); continueDialogue();
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
test('Present: E at wall console opens full-screen routing grid and rotates chosen tile', () => {
  load(1); player.mode = 'first';
  const consoles = player.interactables.filter(o => promptOf(o) === 'Open the power-routing grid');
  assert.equal(consoles.length, 1, 'one large wall target, no tiny individual tile controls');
  assert.equal(player.interactables.filter(o => promptOf(o) === 'Rotate the conduit tile').length, 0);
  const console = consoles[0];
  pose([0, 0, -42.8]);
  player.camera.lookAt(console.position); player.camera.updateMatrixWorld(true); player._updateInteraction();
  assert.equal(player.nearbyInteractable?.id, console.id);
  pressE();
  assert.equal(ui.isOpen('power-grid-screen'), true, 'E opens the puzzle overlay');
  assert.equal(ui.panelOpen, true);
  const before = levels.level.snapshot().tiles;
  const oldStatus = document.getElementById('power-grid-status').textContent;
  assert.match(oldStatus, /Live tiles/);
  ui.rotatePowerTile(5);
  const after = levels.level.snapshot().tiles;
  assert.equal(after[5], (before[5] + 1) % 4, 'selected tile rotated in original game state');
  assert.deepEqual(after.filter((_, i) => i !== 5), before.filter((_, i) => i !== 5));
  press('Digit2');
  assert.equal(levels.level.snapshot().tiles[1], (before[1] + 1) % 4, '1-9 keyboard rotates matching tile');
  ui.closeTopPanel();
  assert.equal(ui.isOpen('power-grid-screen'), false);
  assert.equal(ui._powerGrid, null, 'closing modal clears level callback');
});
test('Present: rotated power tiles persist in saved state; puzzle can still be completed', () => {
  load(1);
  const console = player.interactables.find(o => promptOf(o) === 'Open the power-routing grid');
  console.userData.onInteract();
  assert.equal(ui.isOpen('power-grid-screen'), true);
  ui.rotatePowerTile(0);
  const saved = levels.level.snapshot();
  assert.equal(saved.tiles.length, 9);
  ui.closeAllPanels();
  const changed = saved.tiles[0];
  levels.level.restore(saved);
  assert.equal(levels.level.snapshot().tiles[0], changed);
  console.userData.onInteract();
  const solution = [1, 1, 2, 3, 0, 0, 0, 2, 1];
  const rotations = levels.level.snapshot().tiles;
  for (let i = 0; i < 9; i++) {
    const turns = (solution[i] - rotations[i] + 4) % 4;
    for (let j = 0; j < turns; j++) ui.rotatePowerTile(i);
  }
  assert.equal(levels.debug.state.power, true, 'rotating via the full-screen UI solves the real puzzle');
  assert.match(document.getElementById('power-grid-status').textContent, /POWER RESTORED/);
  assert.equal(ui._powerGrid.getState().solved, true);
  ui.closeTopPanel();
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
  assert.equal(document.getElementById('interaction-help').textContent, 'Move closer · 6 m');
  ui.setInteractionGuide(true, 400, 200, 'Carved tablet', 'blocked', 2);
  assert.equal(document.getElementById('interaction-help').textContent, 'Move to an accessible side');
  ui.setInteractionGuide(true, 400, 200, 'Carved tablet', 'ready', 2);
  assert.equal(document.getElementById('interaction-help').textContent, 'Press E now');
  
// Future first-gap regression: exercise real W + Shift + Space key handling,
// gravity and actual platform walkables (not just a formula for jump range).

// Exact player-requested controls — keyboard events, not only private flags.
test('V7: W and ArrowUp each produce a normal forward jump; Shift makes each a BIG jump', () => {
  const cases = [
    ['KeyW', false], ['ArrowUp', false],
    ['KeyW', true], ['ArrowUp', true],
  ];
  const outcomes = [];
  const key = (type, code) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat: false }); window.dispatchEvent(e); };
  for (const [forward, shift] of cases) {
    load(2); pose([0, 0, -4], 0); player.onGround = true;
    player.isLocked = true;
    key('keydown', forward);
    if (shift) key('keydown', 'ShiftLeft');
    key('keydown', 'Space');
    player.update(1/60);
    assert.equal(player._forwardJump, true, `${forward} should start a forward jump`);
    assert.equal(player._sprintLeap, shift, `${forward} + Shift=${shift} selects the correct jump`);
    key('keyup', 'Space');
    assert.ok(player.velocity.y > (shift ? 10 : 8), 'releasing Space should not cut either Future forward jump');
    for (let frame = 0; frame < 30; frame++) player.update(1/60);
    outcomes.push({forward, shift, distance: -4 - player.position.z});
    key('keyup', forward);
    if (shift) key('keyup', 'ShiftLeft');
    player._clearKeys(); player.isLocked = false;
  }
  for (let i = 0; i < 2; i++) {
    assert.ok(outcomes[i].distance > 1.5, `${outcomes[i].forward} normal jump moves forward`);
    assert.ok(outcomes[i+2].distance > outcomes[i].distance * 1.45,
      `${outcomes[i+2].forward} BIG jump travels significantly farther than normal`);
  }
});
test('V7: Future does not activate dash from Q or right-click', () => {
  load(2); pose([0, 0, 0]); player.onGround = true;
  player._key2('KeyQ', true);
  assert.equal(player.canDash, false);
  assert.equal(player.isDashing, false);
});
test('V7: Shift + forward + Space clears the 8m first gap', () => {
  load(2); player.mode = 'third';
  assert.equal(player.canSprintLeap, true, 'long jump enabled only in Future');
  pose([0, 0, -4.4], 0, -0.05);
  player.onGround = true;
  player.groundObject = null;
  player._key2('KeyW', true);
  player._key2('ShiftLeft', true);
  for (let i = 0; i < 12; i++) { player.update(1/60); levels.update(1/60); }
  assert.ok(player.position.z < -5.2 && player.position.z > -6.85, `approaching edge: ${player.position.z.toFixed(2)}`);
  const from = player.position.z;
  player._key2('Space', true);
  player.update(1/60); levels.update(1/60);
  assert.equal(player._sprintLeap, true, 'Shift+Space must trigger actual long-jump physics');
  assert.ok(player.velocity.z < -12, 'takeoff immediately boosts forward momentum');
  player._key2('Space', false); // tap should not cancel the Future long jump
  let arrived = false;
  for (let i = 0; i < 100; i++) {
    player.update(1/60); levels.update(1/60);
    if (player.onGround && player.position.z < -15 && player.position.z > -23 && player.position.y >= .45) {
      arrived = true; break;
    }
    if (player.position.y < -7) break;
  }
  assert.ok(arrived, `leap from ${from.toFixed(2)} stopped at z=${player.position.z.toFixed(2)}, y=${player.position.y.toFixed(2)}; should land on first platform`);
  assert.equal(player._sprintLeap, false, 'leap ends when landing');
  player._key2('KeyW', false); player._key2('ShiftLeft', false);
  console.log('V6 first gap landing:', player.position.toArray());
});
test('V7: real keyboard Shift + W + Space selects the big jump', () => {
  load(2); pose([0, 0, -4.5], 0); player.onGround = true;
  player.isLocked = true;
  const key = (type, code) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat: false }); window.dispatchEvent(e); };
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft'); key('keydown', 'Space');
  player.update(1/60);
  assert.equal(player._sprintLeap, true, 'real keyboard combo triggers long jump');
  key('keyup', 'Space');
  assert.equal(player._sprintLeap, true, 'tapping Space does not cut long jump');
  key('keyup', 'ShiftLeft'); key('keyup', 'KeyW');
  player.isLocked = false;
  load(2); pose([0, 0, -4.5], 0); player.onGround = true;
  player._key2('Space', true); player.update(1/60);
  assert.equal(player._sprintLeap, false, 'Space alone must remain normal jump');
  assert.equal(player.canDash, false, 'no Q dash in Future: jump controls are only forward + Space (+ Shift)');
  player._clearKeys();
});
test('V7: Past and Present keep their original jump physics', () => {
  load(1); pose([0, 0, 0]); player.onGround = true;
  player._key2('KeyW', true); player._key2('ShiftLeft', true); player._key2('Space', true);
  player.update(1/60);
  assert.equal(player.canSprintLeap, false);
  assert.equal(player._sprintLeap, false);
  assert.ok(Math.abs(player.velocity.y - (8.7 - 24/60)) < .01, 'normal jump retains original 8.7 m/s vertical speed');
  player._clearKeys();
});

ui.resetTransient(); assert.equal(document.getElementById('interaction-guide').classList.contains('hidden'), true);
});

// V8 regression: test exact physical key order and single-tap handling.
test('V8: Shift held FIRST, then W/Up, then ONE Space tap triggers a BIG jump', () => {
  const key = (type, code, shiftKey = false) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, shiftKey, repeat: false });
    window.dispatchEvent(event);
  };
  for (const forward of ['KeyW', 'ArrowUp']) {
    load(2); pose([0, 0, -4.5], 0); player.onGround = true;
    player.isLocked = true;
    const results = [];
    player.addEventListener('jump', onJump);
    function onJump(e) { results.push(e.kind); }
    key('keydown', 'ShiftLeft', true);
    key('keydown', forward, true);
    key('keydown', 'Space', true);
    key('keyup', 'Space', true); // very quick tap, before any physics frame
    player.update(1 / 60);
    assert.equal(player._sprintLeap, true, `${forward} triggers a BIG jump`);
    assert.equal(player._forwardJump, true);
    assert.deepEqual(results, ['big'], `${forward} should launch once`);
    assert.ok(player.velocity.y > 10);
    assert.ok(player.velocity.z < -12);
    key('keyup', forward, true);
    key('keyup', 'ShiftLeft', false);
    player.removeEventListener('jump', onJump);
    player.isLocked = false;
    player._clearKeys();
  }
});
test('V8: Space keydown snapshot survives Shift/forward release before next animation frame', () => {
  load(2); pose([0, 0, -5], 0); player.onGround = true;
  player._key2('ShiftLeft', true);
  player._key2('ArrowUp', true);
  player._key2('Space', true);
  player._key2('Space', false);
  player._key2('ShiftLeft', false);
  player._key2('ArrowUp', false);
  player.update(1 / 60);
  assert.equal(player._sprintLeap, true);
  assert.equal(player._forwardJump, true);
});
test('V8: Future accepts a late Shift + forward + Space tap, but not a mid-air double-jump', () => {
  load(2); pose([0, -0.5, -7.6], 0); player.onGround = false;
  player._coyote = .26;
  player._key2('ShiftLeft', true);
  player._key2('KeyW', true);
  player._key2('Space', true);
  player.update(1 / 60);
  assert.equal(player._sprintLeap, true, 'late jump launches after running off edge');
  const vy = player.velocity.y;
  player._key2('Space', false);
  player._key2('Space', true); // in-air second tap should not launch again
  player.update(1 / 60);
  assert.ok(player.velocity.y < vy, 'no extra lift mid-air');
});
test('V8: W / Up + single Space without Shift stays NORMAL, also supports native shiftKey', () => {
  for (const forward of ['KeyW', 'ArrowUp']) {
    load(2); pose([0, 0, -4], 0); player.onGround = true;
    player._key2(forward, true);
    player._key2('Space', true);
    player._key2('Space', false);
    player.update(1 / 60);
    assert.equal(player._forwardJump, true);
    assert.equal(player._sprintLeap, false);
    player._clearKeys();
    load(2); pose([0, 0, -4], 0); player.onGround = true;
    player._key2(forward, true);
    player._key2('Space', true, false, true); // browser Space event reports Shift held
    player.update(1 / 60);
    assert.equal(player._sprintLeap, true);
    player._clearKeys();
  }
});

// No directional waypoint, and it always labels a distance only.
test('Blue badge is distance-only, does not transform into a compass', () => {
  ui.setWaypoint(true, 9999, -8888, 18);
  assert.equal(document.getElementById('wp-dist').textContent, '18 m to clue');
  assert.equal(document.getElementById('waypoint').style.transform, undefined);
  ui.setWaypoint(false);
  assert.equal(document.getElementById('waypoint').classList.contains('hidden'), true);
});
// All clues across all eras use the SAME invisible floor-space proximity zone.
test('Invisible clue circles in all three eras; no 3D arrows or floor rings', () => {
  assert.ok(!scene.children.some(c => c.name === 'CloseRangeClueArrows'));
  for (const era of [0, 1, 2]) {
    load(era);
    if (era === 2) {
      pose([-2.9, 3, -138.5]); play(.1);
      assert.equal(levels.debug.solvePuzzle(), true); play(2);
    }
    const clue = player.interactables.find(o => o.userData.interaction?.kind === 'clue' && promptOf(o));
    assert.ok(clue, `era ${era} must include collectible clues`);
    const point = interactionPoint(clue, new THREE.Vector3());
    const foot = new THREE.Vector3(point.x + .2, point.y - 1.5, point.z);
    assert.equal(clueInZone(foot, point, clue, []), true, `era ${era}: centre of circle should activate`);
    foot.x = point.x + CLUE_ZONE_RADIUS + .2;
    assert.equal(clueInZone(foot, point, clue, []), false, `era ${era}: outside circle must not activate`);
    assert.equal(scene.children.some(c => c.name === 'CloseRangeClueArrows'), false, 'no visible markers');
  }
});
test('Real world lab desk furniture does not block the invisible clue circle', () => {
  load(1); player.mode = 'third';
  // Where the reported bug occurs: left side of professor's desk, eyes facing
  // away from the tiny flashlight mesh, with desk collision between them.
  pose([-21, 0, -3.5], 0, -.2);
  assert.equal(player.nearbyInteractable?.userData.interaction.label, 'Flashlight');
  assert.equal(player.interaction.status, 'ready');
  pressE(); assert.equal(levels.debug.state.flashlight, true);
});
test('The E prompt and action use precisely the same invisible clue zone', () => {
  const f = fixture();
  pose([0, 0, 0], Math.PI, .9);
  assert.equal(player.nearbyInteractable?.id, f.clue.id);
  assert.equal(promptOf(player.nearbyInteractable), 'Collect');
  // Place solid furniture in the middle; it must not shrink the E circle.
  f.kit.proxy({ size: [.6, 1, 1.1], pos: [.9, .6, 0] });
  player._updateInteraction();
  assert.equal(player.nearbyInteractable?.id, f.clue.id);
  pressE(); assert.equal(f.count(), 1);
  pose([-5, 0, 0]);
  assert.equal(player.nearbyInteractable?.id, undefined);
  pressE(); assert.equal(f.count(), 1);
});
test('Architectural walls prevent E-through-wall even when inside the circle', () => {
  const f = fixture();
  const wall = f.kit.proxy({ size: [.2, 3, 5], pos: [.9, 1.5, 0] });
  pose([0, 0, 0]);
  assert.equal(player.nearbyInteractable?.id, undefined);
  pressE(); assert.equal(f.count(), 0);
  f.kit.removeCollider(wall);
  player._updateInteraction();
  assert.equal(player.nearbyInteractable?.id, f.clue.id);
  pressE(); assert.equal(f.count(), 1);
});
// E-ZONES V3: verify the WHOLE interaction flow at keydown, not just internal
// selector calls. Both the HUD and the actual pickup must refer to the clue.
test('V3: every registered clue uses the same 6m proximity rule', () => {
  for (const era of [0, 1, 2]) {
    load(era);
    if (era === 2) { pose([-2.9, 3, -138.5]); play(.1); assert.equal(levels.debug.solvePuzzle(), true); play(2); }
    for (const clue of player.interactables.filter(o => o.userData.interaction?.kind === 'clue')) {
      const opts = clue.userData.interaction;
      const point = interactionPoint(clue, new THREE.Vector3());
      assert.ok(opts, `missing clue metadata in ${era}`);
      // A purely geometric radius check is independent of object size or
      // graphics-model pivots, unlike ray hits and bounding spheres.
      const feet = new THREE.Vector3(point.x, point.y - 1.0, point.z);
      assert.equal(clueInZone(feet, point, clue, []), true, `${era}: ${opts.label}`);
    }
  }
  assert.equal(CLUE_ZONE_RADIUS, 6.0);
});
test('V3: real E keydown collects a clue without camera aiming', () => {
  load(1); player.mode = 'third';
  pose([-21, 0, -3.5], 0, .25);
  player.isLocked = true;
  const pre = player.nearbyInteractable?.userData.interaction?.label;
  assert.equal(pre, 'Flashlight');
  press('KeyE');
  assert.equal(levels.debug.state.flashlight, true);
  player.isLocked = false;
});
test('V3: a direct E press resolves the correct clue despite stale selector target', () => {
  load(1); pose([-21, 0, -3.5]);
  const original = player.nearbyInteractable;
  const decoy = player.interactables.find(o => o.userData.interaction?.kind !== 'clue');
  assert.ok(decoy);
  player.nearbyInteractable = decoy;
  pressE();
  assert.equal(levels.debug.state.flashlight, true);
  assert.notEqual(original, undefined);
});


// Future first-gap regression: exercise real W + Shift + Space key handling,
// gravity and actual platform walkables (not just a formula for jump range).
test('V7: Shift + forward + Space clears the 8m first gap', () => {
  load(2); player.mode = 'third';
  assert.equal(player.canSprintLeap, true, 'long jump enabled only in Future');
  pose([0, 0, -4.4], 0, -0.05);
  player.onGround = true;
  player.groundObject = null;
  player._key2('KeyW', true);
  player._key2('ShiftLeft', true);
  for (let i = 0; i < 12; i++) { player.update(1/60); levels.update(1/60); }
  assert.ok(player.position.z < -5.2 && player.position.z > -6.85, `approaching edge: ${player.position.z.toFixed(2)}`);
  const from = player.position.z;
  player._key2('Space', true);
  player.update(1/60); levels.update(1/60);
  assert.equal(player._sprintLeap, true, 'Shift+Space must trigger actual long-jump physics');
  assert.ok(player.velocity.z < -12, 'takeoff immediately boosts forward momentum');
  player._key2('Space', false); // tap should not cancel the Future long jump
  let arrived = false;
  for (let i = 0; i < 100; i++) {
    player.update(1/60); levels.update(1/60);
    if (player.onGround && player.position.z < -15 && player.position.z > -23 && player.position.y >= .45) {
      arrived = true; break;
    }
    if (player.position.y < -7) break;
  }
  assert.ok(arrived, `leap from ${from.toFixed(2)} stopped at z=${player.position.z.toFixed(2)}, y=${player.position.y.toFixed(2)}; should land on first platform`);
  assert.equal(player._sprintLeap, false, 'leap ends when landing');
  player._key2('KeyW', false); player._key2('ShiftLeft', false);
  console.log('V6 first gap landing:', player.position.toArray());
});
test('V7: real keyboard Shift + W + Space selects the big jump', () => {
  load(2); pose([0, 0, -4.5], 0); player.onGround = true;
  player.isLocked = true;
  const key = (type, code) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat: false }); window.dispatchEvent(e); };
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft'); key('keydown', 'Space');
  player.update(1/60);
  assert.equal(player._sprintLeap, true, 'real keyboard combo triggers long jump');
  key('keyup', 'Space');
  assert.equal(player._sprintLeap, true, 'tapping Space does not cut long jump');
  key('keyup', 'ShiftLeft'); key('keyup', 'KeyW');
  player.isLocked = false;
  load(2); pose([0, 0, -4.5], 0); player.onGround = true;
  player._key2('Space', true); player.update(1/60);
  assert.equal(player._sprintLeap, false, 'Space alone must remain normal jump');
  assert.equal(player.canDash, false, 'no Q dash in Future: jump controls are only forward + Space (+ Shift)');
  player._clearKeys();
});
test('V7: Past and Present keep their original jump physics', () => {
  load(1); pose([0, 0, 0]); player.onGround = true;
  player._key2('KeyW', true); player._key2('ShiftLeft', true); player._key2('Space', true);
  player.update(1/60);
  assert.equal(player.canSprintLeap, false);
  assert.equal(player._sprintLeap, false);
  assert.ok(Math.abs(player.velocity.y - (8.7 - 24/60)) < .01, 'normal jump retains original 8.7 m/s vertical speed');
  player._clearKeys();
});


test('V9: Shift then W/Up then a single Space TAP launches immediately before any physics frame', () => {
  const send = (type, code, shiftKey) => {
    const ev = new Event(type, { cancelable: true });
    Object.assign(ev, { code, repeat: false, shiftKey });
    window.dispatchEvent(ev);
  };
  for (const forward of ['KeyW', 'ArrowUp']) {
    load(2); pose([0, 0, -4.5], 0);
    player.onGround = true;
    player.isLocked = true;
    const jumped = [];
    const onJump = e => jumped.push(e.kind);
    player.addEventListener('jump', onJump);
    send('keydown', 'ShiftLeft', true);
    send('keydown', forward, true);
    send('keydown', 'Space', true);
    assert.deepEqual(jumped, ['big'], `${forward} must fire BIG JUMP on Space keydown`);
    assert.ok(player.velocity.y >= 11, 'immediate vertical jump speed');
    assert.ok(player.velocity.z <= -12.9, 'immediate big forward speed');
    send('keyup', 'Space', true);
    assert.deepEqual(jumped, ['big'], 'Space release must not fire another jump');
    send('keyup', forward, true);
    send('keyup', 'ShiftLeft', false);
    player.removeEventListener('jump', onJump);
    player.isLocked = false;
    player._clearKeys();
  }
});

test('V9: Future phasing pads remain solid longer and reappear after a shorter gap', () => {
  load(2); levels.state = 'playing';
  const sample = () => levels.debug.phases()[0];
  play(4.0); 
  assert.ok(sample().solid, 'platform stays walkable for first 4 seconds');
  play(1.0);  // t=5.0, fading; still bright enough to hold the player
  assert.ok(sample().solid, 'solid while early in the warning fade');
  play(0.46);  // t=5.46, almost fully faded, now absent
  assert.equal(sample().solid, false, 'eventually phases out');
  play(0.44); // t=5.90, brief absent portion
  assert.equal(sample().solid, false, 'the absent phase is still a hazard');
  play(0.70); // t=6.60, past most of reappearance
  assert.equal(sample().solid, true, 'platform reappears and becomes walkable quickly');
});

test('V9: the collapse bridge gives a longer warning before falling', () => {
  load(2); levels.state = 'playing';
  const tile = player.walkables.find(o => o.userData.tileIndex === 0);
  assert.ok(tile, 'first crumble tile is present');
  player.groundObject = tile;
  pose([0, 1.6, -112], 0);
  player.groundObject = tile;
  player.onGround = true;
  play(0.45);
  assert.equal(levels.debug.collapse().fallen, 0, 'bridge still present after 0.45 s');
  play(1.35);  // total 1.8 seconds - plenty of time to sprint off
  assert.equal(levels.debug.collapse().fallen, 0, 'bridge remains solid for almost 2 seconds');
  play(0.45);  // total 2.25 seconds - eventually falls if player stands still
  assert.ok(levels.debug.collapse().fallen >= 1, 'first tile eventually falls');
});

// Future V10: test the exact trouble reports from the live game screenshot.
test('Space tap: missed press recovers while Shift and Up remain held, without an arrow release', () => {
  load(2); pose([0, 0, -4.4], 0); player.onGround = true; player.inputEnabled = true;
  player.isLocked = true;
  player._key2('ShiftLeft', true); player._key2('ArrowUp', true);
  // Some event streams report only the end of a tap. Shift and Up remain
  // held throughout; no release of the forward key is used or required.
  player._key2('Space', false, false, true);
  assert.equal(player._sprintLeap, true);
  assert.equal(player.keys.sprint && player.keys.forward, true);
  assert.equal(player.keys.jump, false);
  assert.ok(player.velocity.z < -12);
  player._key2('ArrowUp', false); player._key2('ShiftLeft', false); player.isLocked = false;
});
test('V10: falling off bricks ALWAYS respawns at the bridge START, never the final spire', () => {
  load(2); levels.state = 'playing';
  const bridge = player.walkables.find(o => o.userData.tileIndex === 0);
  pose([0, 1.5, -107], 0); player.onGround = true; player.groundObject = bridge;
  play(0.05);
  assert.equal(levels.debug.state.reached[4], true, 'checkpoint crossed');
  pose([0, -2.2, -139.5], 0); player.onGround = false;
  play(0.04);
  assert.ok(Math.abs(player.position.z - (-107)) < .01, 'respawn on safe platform BEFORE bricks');
  assert.equal(levels.debug.state.collapseComplete, false, 'no accidental spire checkpoint');
  assert.equal(levels.debug.collapse().fallen, 0, 'tiles rebuilt');
  assert.equal(player.getCheckpoint().position.z, -107);
});
test('V10: reaching spire in mid-air cannot complete the collapse or change checkpoint', () => {
  load(2); levels.state = 'playing';
  pose([0, 1.5, -107], 0); player.onGround = true; play(.04);
  pose([0, 3.7, -139], 0); player.onGround = false; player.groundObject = null;
  play(.06);
  assert.equal(levels.debug.state.collapseComplete, false);
  assert.equal(player.getCheckpoint().position.z, -107);
});
test('V10: final colour lock shows next colour and nodes remain in accessible nearby E zones', () => {
  load(2); levels.state = 'playing'; pose([-2.9, 3, -138.5], 0); play(.08);
  assert.match(document.body.children.at(-1).textContent || '', /COLOUR LOCK|LOCK OPEN/);
  const orb = player.interactables.find(o => o.userData.interaction?.label === 'Energy node 1');
  assert.ok(orb);
  assert.equal(orb.userData.interaction.zoneRadius, 2.1);
  assert.match(promptOf(player.nearbyInteractable), /Touch the node/);
});

test('V10: uninterrupted Shift + Up sprint crosses the crumbling bridge on real platforms', () => {
  load(2); levels.state = 'playing'; player.mode = 'third';
  pose([0, 1.5, -107], 0); player.onGround = true; player.groundObject = null;
  player._key2('ShiftLeft', true); player._key2('ArrowUp', true);
  let maxProgress = player.position.z, fellBack = false;
  for (let i = 0; i < 360; i++) {
    continueDialogue(); levels.update(1 / 60); continueDialogue(); player.update(1 / 60);
    maxProgress = Math.min(maxProgress, player.position.z);
    if (player.position.z > -108 && i > 40) fellBack = true;
    if (levels.debug.state.collapseComplete) break;
  }
  assert.equal(fellBack, false, 'full sprint should not reset to start');
  assert.equal(levels.debug.state.collapseComplete, true, `spire not reached, furthest z ${maxProgress.toFixed(2)}`);
  assert.ok(player.position.z < -138, 'sprinted onto spire');
  player._clearKeys();
});
ui.resetTransient();
console.log(JSON.stringify({ suite: 'Collision and nearby E interaction regressions (real Three.js, DOM/audio doubles)', passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results }, null, 2));
process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);



