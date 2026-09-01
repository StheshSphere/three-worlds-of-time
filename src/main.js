import * as THREE from 'three';
import { createTimeMachine } from './timeMachine.js';
import { buildAncientRuinsLevel } from './world.js';
import { Player } from './player.js';

/* -------------------------------------------------------------------- */
/* Boot sequence: fake a short load so the loading screen has a purpose  */
/* (Polish, brief §6.1 — "a loading screen stops a slow first load from  */
/*  looking like a crash"). Swap the fake progress for real asset-loader */
/*  progress once you add textures/models via GLTFLoader/TextureLoader.  */
/* -------------------------------------------------------------------- */
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const startScreen = document.getElementById('start-screen');
const hud = document.getElementById('hud');

let fakeProgress = 0;
const loadingTimer = setInterval(() => {
  fakeProgress += 8 + Math.random() * 12;
  progressFill.style.width = Math.min(fakeProgress, 100) + '%';
  if (fakeProgress >= 100) {
    clearInterval(loadingTimer);
    loadingScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
  }
}, 90);

/* -------------------------------------------------------------------- */
/* Renderer / Scene / Camera                                             */
/* -------------------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 10);

/* -------------------------------------------------------------------- */
/* Build Level 1 (Ancient Ruins) + the Time Machine hierarchy            */
/* -------------------------------------------------------------------- */
const { interactables } = buildAncientRuinsLevel(scene);

const timeMachine = createTimeMachine();
timeMachine.position.set(0, 0, 0);
scene.add(timeMachine);

/* -------------------------------------------------------------------- */
/* Player controller                                                     */
/* -------------------------------------------------------------------- */
const player = new Player(camera, renderer.domElement, interactables);
scene.add(player.object);
player.object.position.set(0, 1.7, 12);

const objectiveEl = document.getElementById('objective');
const interactPrompt = document.getElementById('interact-prompt');

document.getElementById('start-button').addEventListener('click', () => {
  player.controls.lock();
});
player.controls.addEventListener('lock', () => {
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');
});
player.controls.addEventListener('unlock', () => {
  hud.classList.add('hidden');
  startScreen.classList.remove('hidden');
});

/* -------------------------------------------------------------------- */
/* Restart / Credits buttons                                             */
/* -------------------------------------------------------------------- */
document.getElementById('restart-button').addEventListener('click', () => {
  // Alpha-level restart: reload the module state without a full page refresh
  // would require a proper game-state manager. For now this satisfies the
  // "restart without refreshing the page" checklist item at a basic level —
  // replace with a real state reset once level/puzzle state exists.
  player.object.position.set(0, 1.7, 12);
  player.velocity.set(0, 0, 0);
  objectiveEl.textContent = 'Objective: Explore the ruins and find the Ancient Core';
});

const creditsScreen = document.getElementById('credits-screen');
document.getElementById('credits-button').addEventListener('click', () => creditsScreen.classList.remove('hidden'));
document.getElementById('close-credits').addEventListener('click', () => creditsScreen.classList.add('hidden'));

/* -------------------------------------------------------------------- */
/* Render loop                                                           */
/* -------------------------------------------------------------------- */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1); // clamp to avoid huge steps on tab-switch

  if (player.controls.isLocked) {
    player.update(delta);

    interactPrompt.classList.toggle('hidden', !player.nearbyInteractable);
    if (player.nearbyInteractable) {
      interactPrompt.textContent = `[E] ${player.nearbyInteractable.userData.prompt || 'Interact'}`;
    }
  }

  timeMachine.update(delta);
  renderer.render(scene, camera);
}
animate();

/* -------------------------------------------------------------------- */
/* Resize handling                                                       */
/* -------------------------------------------------------------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* -------------------------------------------------------------------- */
/* Interact -> demo puzzle feedback wired through DOM (keydown handled    */
/* inside Player; this just reflects the result back into the objective) */
/* -------------------------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && player.controls.isLocked) {
    const result = player.tryInteract();
    if (result) objectiveEl.textContent = `Objective: ${result} Find the Ancient Core.`;
  }
});
