import * as THREE from 'three';
import { Player } from './src/player.js';
import { build } from './src/levels/ancientRuins.js';

/**
 * Acceptance test for camera-relative movement (Job 3). Runs the REAL
 * Player.update() inside the REAL Level 1 geometry, without pointer lock:
 * mouse-turns are simulated by setting the camera quaternion from a YXZ
 * euler — exactly how PointerLockControls composes the view — and keys are
 * synthetic KeyboardEvents on window. The rig's resulting displacement is
 * compared against the flattened camera forward direction.
 */
const resultsEl = document.getElementById('results');
const rows = [];
let failures = 0;
function check(name, pass, detail = '') {
  rows.push({ name, pass, detail });
  if (!pass) failures++;
  const div = document.createElement('div');
  div.className = pass ? 'pass' : 'fail';
  div.textContent = `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`;
  resultsEl.appendChild(div);
}

// --- mount renderer / scene / camera / player / Level 1 --------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(640, 360, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 640 / 360, 0.1, 200);

const levelGroup = new THREE.Group();
const lightsGroup = new THREE.Group();
scene.add(levelGroup, lightsGroup);

const interactables = [];
const player = new Player(camera, canvas, interactables);
scene.add(player.object);

const api = {
  completeLevel() {}, showMessage() {}, setHint() {},
  grantFlashlight() {}, isFlashlightOn() { return false; },
};
const level = build(scene, api);
level.objects.forEach((o) => levelGroup.add(o));
level.lights.forEach((l) => lightsGroup.add(l));
level.interactables.forEach((o) => interactables.push(o));
player.setColliders(level.colliders);
player.setWalkables(level.walkables);
player.spawn.copy(level.spawn);
player.reset();
// No render loop in this harness, so compute world matrices up front —
// otherwise every level mesh sits at an identity matrixWorld and raycasts
// hit geometry in its LOCAL pose (the arena "top" at +0.1 instead of 0).
// In the real game renderer.render() does this every frame.
scene.updateMatrixWorld(true);

// --- harness helpers --------------------------------------------------------
const DELTA = 1 / 60;
const STEPS = 40; // ~0.67 s of walking ≈ 3.7 units

function setLook(yaw, pitch) {
  // The same composition PointerLockControls uses: YXZ euler → quaternion.
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}
function key(code, down) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
}
function placeAtCentre() {
  player.rig.position.set(0, 0, 10); // arena centre: 6+ units of clearance
  player.velocity.set(0, 0, 0);
}

const _f = new THREE.Vector3();
function flatForward() {
  camera.getWorldDirection(_f);
  _f.y = 0;
  return _f.normalize();
}
function deviation(gotX, gotZ) {
  const got = new THREE.Vector3(gotX, 0, gotZ).normalize();
  const want = flatForward().clone();
  return Math.acos(THREE.MathUtils.clamp(got.dot(want), -1, 1)) * 180 / Math.PI;
}
const _head = new THREE.Vector3();

// Per-frame duplicate of the player's ground probe, for diagnosing the
// "looking up climbs 0.1u" anomaly: records rig.y, velocity.y and what the
// down-ray actually hits each frame.
const _torigin = new THREE.Vector3();
const _tdown = new THREE.Vector3(0, -1, 0);
const _tray = new THREE.Raycaster();
_tray.far = 1.2;
function tracedWalk(label, steps = STEPS) {
  const trace = [];
  for (let i = 0; i < steps; i++) {
    player.update(DELTA);
    _torigin.set(player.rig.position.x, player.rig.position.y + 0.5, player.rig.position.z);
    _tray.set(_torigin, _tdown);
    const thit = _tray.intersectObjects(player.walkables, true)[0];
    const g = thit ? thit.object : null;
    const anomalous = Math.abs(player.rig.position.y) > 0.02
      || (thit && Math.abs(thit.point.y) > 0.02);
    if (i < 2 || i > steps - 3 || anomalous) {
      trace.push(`f${i} y=${player.rig.position.y.toFixed(3)} vy=${player.velocity.y.toFixed(2)} `
        + `hitY=${thit ? thit.point.y.toFixed(3) : '—'} d=${thit ? thit.distance.toFixed(2) : '—'} `
        + `obj=${g ? `#${g.geometry.id}@${g.position.x.toFixed(1)},${g.position.y.toFixed(1)},${g.position.z.toFixed(1)}` : '—'} `
        + `at(${player.rig.position.x.toFixed(2)},${player.rig.position.z.toFixed(2)})`);
    }
  }
  const pre = document.createElement('pre');
  pre.textContent = `trace: ${label}\n${trace.join('\n')}`;
  resultsEl.appendChild(pre);
}

// --- the acceptance matrix: turn, then W must follow the NEW facing --------
const TURNS = [
  ['facing forward (0°)', 0],
  ['turned 90° left', Math.PI / 2],
  ['turned 180° (behind)', Math.PI],
  ['turned 270° (behind-right)', -Math.PI / 2],
];
for (const mode of ['first', 'third']) {
  player.mode = mode;
  for (const [label, yaw] of TURNS) {
    placeAtCentre();
    setLook(yaw, 0);
    key('KeyW', true);
    for (let i = 0; i < STEPS; i++) player.update(DELTA);
    key('KeyW', false);
    const dx = player.rig.position.x;
    const dz = player.rig.position.z - 10;
    const dist = Math.hypot(dx, dz);
    const deg = deviation(dx, dz);
    check(`${mode}-person: W after ${label} walks where you look`, deg < 2 && dist > 3,
      `deviation ${deg.toFixed(2)}°, distance ${dist.toFixed(2)}u`);
  }
}

// Control: 0° pitch, traced — establishes what a clean grounded walk looks
// like in the real level geometry.
player.mode = 'first';
placeAtCentre();
setLook(0, 0);
key('KeyW', true);
tracedWalk('level geometry, 0° pitch');
key('KeyW', false);
check('level 0° pitch control: rig stays at y≈0', Math.abs(player.rig.position.y) < 0.01,
  `final y ${player.rig.position.y.toFixed(3)}u (see trace above)`);

// Looking steeply up while walking must not fly you or slow you down
// (the movement basis is flattened onto the ground plane every frame).
placeAtCentre();
setLook(0, 0.9); // 52° up
key('KeyW', true);
tracedWalk('level geometry, 52° up');
key('KeyW', false);
{
  const dx = player.rig.position.x;
  const dz = player.rig.position.z - 10;
  const dist = Math.hypot(dx, dz);
  const climbed = Math.abs(player.rig.position.y);
  const deg = deviation(dx, dz);
  check('looking 52° up: W stays grounded at full speed', climbed < 0.01 && deg < 2 && dist > 3.5,
    `climbed ${climbed.toFixed(3)}u, deviation ${deg.toFixed(2)}°, distance ${dist.toFixed(2)}u`);
}

// Bisect: same 52° up walk on a single sterile plane — if the climb
// reproduces here it is player.js; if not, it is level geometry.
const sterileGround = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x335577 })
);
sterileGround.rotation.x = -Math.PI / 2;
scene.add(sterileGround);
scene.updateMatrixWorld(true);
const savedWalkables = player.walkables;
player.setWalkables([sterileGround]);
placeAtCentre();
setLook(0, 0.9);
key('KeyW', true);
tracedWalk('sterile plane, 52° up');
key('KeyW', false);
check('52° up on sterile plane: rig stays at y≈0', Math.abs(player.rig.position.y) < 0.01,
  `final y ${player.rig.position.y.toFixed(3)}u`);
player.setWalkables(savedWalkables);

// Strafe sign: D must move along the camera's right, not its left.
placeAtCentre();
setLook(0, 0);
key('KeyD', true);
for (let i = 0; i < STEPS; i++) player.update(DELTA);
key('KeyD', false);
{
  const dx = player.rig.position.x;
  const dz = player.rig.position.z - 10;
  const right = new THREE.Vector3().crossVectors(flatForward().clone(), new THREE.Vector3(0, 1, 0)).normalize();
  const got = new THREE.Vector3(dx, 0, dz).normalize();
  const deg = Math.acos(THREE.MathUtils.clamp(got.dot(right), -1, 1)) * 180 / Math.PI;
  check('D strafes along the camera-right axis', deg < 2,
    `deviation ${deg.toFixed(2)}°, moved (${dx.toFixed(2)}, ${dz.toFixed(2)})`);
}

// V toggles the view when locked (C remains as the legacy alias).
player.controls.isLocked = true;
key('KeyV', true); key('KeyV', false);
const toggledOut = player.mode === 'third';
key('KeyC', true); key('KeyC', false);
const toggledBack = player.mode === 'first';
player.controls.isLocked = false;
check('V (and legacy C) toggle the camera mode', toggledOut && toggledBack,
  `V → third: ${toggledOut}, C → first: ${toggledBack}`);

// Esc / pause (pointer unlock) must clear held movement keys. three's
// EventDispatcher assigns event.target, so the synthetic event must be a
// plain object — exactly what PointerLockControls dispatches internally.
placeAtCentre();
key('KeyW', true);
player.controls.dispatchEvent({ type: 'unlock' });
const cleared = !player.keys.forward;
key('KeyW', false);
check('pointer unlock clears held keys', cleared, `keys.forward after unlock: ${cleared}`);

// Third-person camera pulls in when a pillar blocks the orbit.
// Pillar i=2 sits at (4.94, 22.36); stand ~0.9u in front of it, face away,
// and the orbit ray from the head runs into the pillar behind the player.
player.mode = 'third';
player.rig.position.set(4.94, 0, 20.8);
player.velocity.set(0, 0, 0);
setLook(0, 0);
for (let i = 0; i < 2; i++) player.update(DELTA);
player.head.getWorldPosition(_head);
const camDist = camera.position.distanceTo(_head);
check('third-person camera pulls in when geometry blocks it', camDist < 2.5,
  `camera ${camDist.toFixed(2)}u from head (nominal orbit ≈ 4.5u)`);

// --- final frame: a third-person hero shot for the screenshot --------------
player.mode = 'third';
placeAtCentre();
setLook(-Math.PI / 4, -0.12);
player.update(DELTA);
renderer.render(scene, camera);

const summary = document.createElement('div');
summary.className = 'summary ' + (failures === 0 ? 'pass' : 'fail');
summary.textContent = failures === 0
  ? `ALL ${rows.length} CHECKS PASS`
  : `${failures} OF ${rows.length} CHECKS FAILED`;
resultsEl.appendChild(summary);
console.log(rows);
window.__movementTest = { rows, failures };
