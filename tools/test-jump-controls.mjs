/** Focused controller checks: real Three.js physics, DOM/render doubles. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./tests/support/loader.mjs', import.meta.url);
const { Element } = await import('./tests/support/dom.mjs');
const THREE = await import('three');
const { Player } = await import('../src/player.js');
const player = new Player(new THREE.PerspectiveCamera(72, 16 / 9, .05, 600), new Element());
const floor = new THREE.Mesh(new THREE.BoxGeometry(100, .1, 100), new THREE.MeshBasicMaterial());
floor.position.y = -.05;
floor.updateMatrixWorld(true);
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.message); }
}
function reset(mode = 'third', future = true) {
  player.setLevel({ walkables: [floor], spawn: new THREE.Vector3() });
  player.canSprintLeap = future;
  player.mode = mode;
  player.isLocked = true;
  player.frozen = false;
  player.inputEnabled = true;
  player.update(1 / 60);
  assert.equal(player.onGround, true);
}
function key(type, code, extra = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat: false, ...extra });
  window.dispatchEvent(event);
  return event;
}
const down = (code, extra) => key('keydown', code, extra);
const up = (code, extra) => key('keyup', code, extra);
const step = frames => { for (let i = 0; i < frames; i++) player.update(1 / 60); };

test('Both Shift keys + W/Up launch the same long jump on one Space tap', () => {
  for (const mode of ['first', 'third']) for (const shift of ['ShiftLeft', 'ShiftRight']) {
    for (const forward of ['KeyW', 'ArrowUp']) {
      reset(mode); down(shift); down(forward);
      assert.equal(down('Space', { shiftKey: true }).defaultPrevented, true);
      up('Space', { shiftKey: true });
      assert.equal(player._sprintLeap, true);
      assert.equal(player.velocity.y, 11.1);
      assert.equal(player.velocity.z, -13);
    }
  }
});
test('Up + Shift + Space works when the browser supplies key/keyCode instead of code', () => {
  for (const legacy of [false, true]) {
    reset();
    down('Unidentified', legacy ? { keyCode: 16 } : { key: 'Shift' });
    down('', legacy ? { keyCode: 38 } : { key: 'ArrowUp' });
    const space = down('Unidentified', legacy ? { keyCode: 32 } : { key: ' ' });
    assert.equal(player._sprintLeap, true);
    assert.equal(space.defaultPrevented, true);
  }
});
test('Releasing an overlapping W/Shift key cannot cancel held Up/other Shift', () => {
  reset(); down('ShiftLeft'); down('ShiftRight'); down('KeyW'); down('ArrowUp');
  up('KeyW'); up('ShiftLeft'); step(25);
  assert.equal(player.keys.forward, true);
  assert.equal(player.keys.sprint, true);
  down('Space'); assert.equal(player._sprintLeap, true);
});
test('A first observed repeated Space event launches once; holding it does not auto-jump', () => {
  reset(); down('ShiftLeft'); down('ArrowUp'); down('Space', { repeat: true });
  assert.equal(player._sprintLeap, true);
  step(80); assert.equal(player.onGround, true);
  down('Space', { repeat: true }); step(1);
  assert.equal(player.onGround, true);
});
test('A missed Space DOWN is recovered from the tap while Shift and Up remain held', () => {
  reset(); down('ShiftLeft'); down('ArrowUp'); up('Space', { shiftKey: true });
  assert.equal(player._sprintLeap, true);
  assert.equal(player.onGround, false);
  assert.equal(player.velocity.y, 11.1);
  assert.equal(player.keys.forward && player.keys.sprint, true);
  assert.equal(player.keys.jump, false, 'Space does not have to stay held');
  assert.equal(player._jumpBuffer, 0);
  up('Space', { shiftKey: true });
  assert.equal(player._jumpBuffer, 0, 'a duplicate release in flight cannot buffer another leap');
  reset(); down('ShiftLeft'); down('ArrowUp');
  player.isLocked = false; up('Space', { shiftKey: true });
  assert.equal(player.onGround, true);
});
test('A very quick Space tap launches before a physics frame while Shift and Up stay held', () => {
  for (const shift of ['ShiftLeft', 'ShiftRight']) {
    reset(); down(shift, { shiftKey: true }); step(8);
    down('ArrowUp', { shiftKey: true }); step(12);
    const z = player.position.z;
    down('Space', { shiftKey: true }); up('Space', { shiftKey: true });
    assert.equal(player._sprintLeap, true);
    assert.equal(player.velocity.y, 11.1, 'quick release must not cut leap height');
    assert.equal(player.keys.forward && player.keys.sprint, true);
    assert.equal(player.keys.jump, false);
    step(12);
    assert.ok(player.position.y > 1 && player.position.z < z - 2);
    up('ArrowUp'); up(shift);
    assert.equal(player._sprintLeap, true, 'releasing the other keys after takeoff does not stop the leap');
  }
});
test('Space keypress can recover a missing keydown without double-launching a normal tap', () => {
  reset(); down('ShiftLeft'); down('ArrowUp');
  key('keypress', '', { key: ' ', keyCode: 32, shiftKey: true });
  assert.equal(player._sprintLeap, true);
  assert.equal(player.velocity.y, 11.1);
  step(3); const vy = player.velocity.y;
  key('keypress', 'Space', { shiftKey: true }); up('Space', { shiftKey: true });
  assert.equal(player.velocity.y, vy);
  assert.equal(player._jumpBuffer, 0);
});
test('Tap recovery never requires or triggers from an arrow/Shift release', () => {
  for (const release of ['ArrowUp', 'ShiftLeft']) {
    reset(); down('ShiftLeft'); down('ArrowUp'); up(release);
    assert.equal(player.onGround, true);
    up('Space');
    assert.equal(player.onGround, true);
    assert.equal(player._jumpBuffer, 0);
  }
  reset(); down('ShiftLeft'); down('ArrowUp'); down('Space'); step(80);
  assert.equal(player.onGround, true);
  up('Space', { shiftKey: true });
  assert.equal(player.onGround, true, 'releasing a tracked Space press after landing cannot launch again');
});
test('Exact held sequence launches at Space DOWN before any release, once per press', () => {
  for (const mode of ['first', 'third']) for (const shift of ['ShiftLeft', 'ShiftRight']) {
    for (const forward of ['ArrowUp', 'KeyW']) {
      reset(mode);
      const jumps = [];
      const onJump = e => jumps.push({ kind: e.kind, shift: player.keys.sprint, forward: player.keys.forward, space: player.keys.jump });
      player.addEventListener('jump', onJump);
      down(shift, { shiftKey: true }); step(8);
      down(forward, { shiftKey: true }); step(12);
      const startZ = player.position.z;
      down('Space', { shiftKey: true });
      assert.deepEqual(jumps, [{ kind: 'big', shift: true, forward: true, space: true }]);
      assert.equal(player.onGround, false, 'takeoff occurs before any key is released');
      assert.equal(player.velocity.y, 11.1);
      step(12);
      assert.ok(player.position.y > 1 && player.position.z < startZ - 2);
      assert.equal(player.keys.sprint && player.keys.forward && player.keys.jump, true);
      step(68); assert.equal(player.onGround, true);
      down('Space', { repeat: true, shiftKey: true }); step(1);
      assert.equal(jumps.length, 1, 'holding all three through landing cannot auto-launch again');
      up(forward, { shiftKey: true }); up('Space', { shiftKey: true }); up(shift);
      assert.equal(jumps.length, 1, 'releases do not trigger a jump');
      player.removeEventListener('jump', onJump);
    }
  }
});
test('Releasing Up before a delayed Space DOWN cannot masquerade as a held long jump', () => {
  reset(); down('ShiftLeft'); down('ArrowUp');
  up('ArrowUp', { shiftKey: true });
  down('Space', { shiftKey: true });
  assert.equal(player._sprintLeap, false);
  assert.equal(player.velocity.y, 8.7);
  reset(); down('ShiftLeft'); down('ArrowUp'); up('ShiftLeft'); down('Space');
  assert.equal(player._sprintLeap, false, 'recently released Shift is not still held');
});
test('Normal forward and standing jumps can steer in all WASD/arrow directions', () => {
  const directions = [['KeyW', 0, -1], ['ArrowUp', 0, -1], ['KeyS', 0, 1], ['ArrowDown', 0, 1],
    ['KeyA', -1, 0], ['ArrowLeft', -1, 0], ['KeyD', 1, 0], ['ArrowRight', 1, 0]];
  for (const mode of ['first', 'third']) for (const moving of [false, true]) {
    for (const [code, x, z] of directions) {
      reset(mode); if (moving) down('ArrowUp');
      down('Space'); if (moving) up('Space');
      step(3); up('ArrowUp'); down(code); step(17);
      assert.equal(player.onGround, false);
      assert.equal(player._sprintLeap, false);
      assert.ok(player.velocity.x * x + player.velocity.z * z > .5, `${mode}/${moving}/${code} must steer`);
    }
  }
});
test('Normal diagonal steering stays camera-relative and does not gain extra speed', () => {
  reset(); player.yaw = Math.PI / 2; down('KeyW'); down('Space'); up('Space');
  down('KeyD'); step(15);
  assert.ok(player.velocity.x < -3 && player.velocity.z < -2);
  assert.ok(Math.hypot(player.velocity.x, player.velocity.z) <= 6.4 + 1e-8);
  down('ShiftLeft'); step(6);
  assert.equal(player._sprintLeap, false, 'Shift during a normal jump cannot turn it into a long jump');
});
test('Long jump ignores direction changes, camera turns and Shift release until landing', () => {
  for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    reset(); down('ShiftLeft'); down('ArrowUp'); down('Space'); up('Space');
    up('ArrowUp'); up('ShiftLeft'); player.yaw = Math.PI / 2; down(code); step(25);
    assert.equal(player._sprintLeap, true);
    assert.ok(Math.abs(player.velocity.x) < 1e-8);
    assert.ok(Math.abs(player.velocity.z + 13) < 1e-8);
    assert.ok(Math.abs(player.position.x) < 1e-8);
    up(code); step(40); assert.equal(player.onGround, true);
    down('ArrowLeft'); step(10);
    assert.ok(player.velocity.z > 1, 'directional movement works again after landing');
  }
});
test('Buffered normal jump keeps its tap-time type when Shift is pressed before landing', () => {
  reset(); player.position.y = .1; player.onGround = false; player._coyote = 0;
  player.velocity.y = -2; down('ArrowUp'); down('Space'); down('ShiftLeft'); step(6);
  assert.equal(player._forwardJump, true);
  assert.equal(player._sprintLeap, false);
  assert.ok(player.velocity.y > 5);
});
test('Blur clears both key aliases, and earlier eras retain standard jump speed', () => {
  reset(); down('KeyW'); down('ArrowUp'); down('ShiftRight');
  window.dispatchEvent(new Event('blur'));
  down('KeyA'); assert.equal(player.keys.forward, false); assert.equal(player.keys.sprint, false);
  reset('third', false); down('ShiftLeft'); down('ArrowUp'); down('Space');
  assert.equal(player.velocity.y, 8.7); assert.equal(player._sprintLeap, false);
});
console.log(JSON.stringify({ passed, failed }));
process.exitCode = failed ? 1 : 0;
