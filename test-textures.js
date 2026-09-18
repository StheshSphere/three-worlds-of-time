import * as THREE from 'three';
import { createTimeMachine } from './src/timeMachine.js';
import { createLevelManager } from './src/levelManager.js';
import { Player } from './src/player.js';

/**
 * Visual check for the textured levels (Job 1). Mounts the REAL game stack
 * (levelManager + player + timeMachine), cycles 5 seconds per level forever
 * — which also exercises the texture library's create/dispose-on-swap path
 * every cycle — and parks the camera at a labelled vantage per era.
 * Expected console noise: one 404 + info per missing drop-in file
 * (assets/textures/<level>/…, assets/models/player/character.glb).
 */
const labelEl = document.getElementById('level-label');
const statusEl = document.getElementById('status');
const errorsEl = document.getElementById('errors');
const errorLines = [];
window.addEventListener('error', (e) => {
  errorLines.push(String(e.message));
  errorsEl.textContent = `JS ERRORS:\n${errorLines.join('\n')}`;
});

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(800, 450, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 800 / 450, 0.1, 300);

const timeMachine = createTimeMachine();
scene.add(timeMachine);

const player = new Player(camera, canvas, []);
player.mode = 'third';
player.rig.visible = true;
scene.add(player.object);

const levelManager = createLevelManager(scene, player, renderer);
levelManager.registerTimeMachine(timeMachine);

const LEVELS = [
  {
    name: 'LEVEL 1 — THE ANCIENT RUINS',
    vantage: { target: new THREE.Vector3(0, 2, 8), radius: 22, height: 7 },
  },
  {
    name: 'LEVEL 2 — THE MODERN LABORATORY',
    vantage: { target: new THREE.Vector3(-2, 1.5, 0), radius: 17, height: 5 },
  },
  {
    name: 'LEVEL 3 — THE NEON FUTURE',
    vantage: { target: new THREE.Vector3(0, 2.5, -16), radius: 24, height: 9 },
  },
];
const HOLD_SECONDS = 5;
let index = 0;
let held = 0;
let cycles = 0;

levelManager.loadLevel(0);
labelEl.textContent = LEVELS[0].name;

const clock = new THREE.Clock();
const _lookTarget = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  held += delta;

  if (held >= HOLD_SECONDS) {
    held = 0;
    index = (index + 1) % LEVELS.length;
    if (index === 0) cycles++;
    levelManager.loadLevel(index);
    labelEl.textContent = LEVELS[index].name;
  }

  // Level animation runs (movers, barriers, flickers) so shots look alive.
  levelManager.update(delta);
  timeMachine.update(delta);

  // Slow orbit around the era's vantage point.
  const v = LEVELS[index].vantage;
  const a = performance.now() * 0.00012 + index * 2.1;
  camera.position.set(
    v.target.x + Math.cos(a) * v.radius,
    v.height,
    v.target.z + Math.sin(a) * v.radius,
  );
  _lookTarget.copy(v.target);
  camera.lookAt(_lookTarget);

  statusEl.textContent =
    `era ${index + 1}/3 · ${held.toFixed(1)}s · full cycles completed: ${cycles} `
    + `· anisotropy ${renderer.capabilities.getMaxAnisotropy()}`;

  renderer.render(scene, camera);
}
animate();
window.__textureTest = { levelManager, player, cycles: () => cycles };
