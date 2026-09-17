import * as THREE from 'three';
import { createTimeMachine } from './timeMachine.js';
import { createLevelManager } from './levelManager.js';
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
const pauseScreen = document.getElementById('pause-screen');
const winScreen = document.getElementById('win-screen');
const objectiveEl = document.getElementById('objective');
const interactPrompt = document.getElementById('interact-prompt');
const cameraModeEl = document.getElementById('camera-mode');
const pauseLevelEl = document.getElementById('pause-level');

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
/* Time Machine — persistent across all levels (the visual anchor). It   */
/* is NEVER owned by a level, so the level manager never disposes it.    */
/* -------------------------------------------------------------------- */
const timeMachine = createTimeMachine();
timeMachine.position.set(0, 0, 0);
scene.add(timeMachine);

/* -------------------------------------------------------------------- */
/* Player + Level Manager: the player's interactables array is created   */
/* empty here and mutated in place by the level manager on every swap.   */
/* -------------------------------------------------------------------- */
const player = new Player(camera, renderer.domElement, []);
scene.add(player.object);

const levelManager = createLevelManager(scene, player);
levelManager.registerTimeMachine(timeMachine);
levelManager.loadLevel(0);

/* -------------------------------------------------------------------- */
/* Game flow: start / pause / win / restart / credits                    */
/* -------------------------------------------------------------------- */
let gameState = 'menu';   // 'menu' | 'playing' | 'paused' | 'won'
let winDelay = 0;         // seconds of restoration animation before the win screen

const ERA_INTROS = [
  'You emerge into the past — an ancient temple guards the first core.',
  'The present: a dark laboratory, frozen mid-experiment. Restore its power.',
  'The future collapses around you. Cross the void and survive.',
];

levelManager.setOnLevelLoaded((index) => {
  objectiveEl.textContent = levelManager.getObjectiveText();
  pauseLevelEl.textContent = `You are in ${levelManager.getLevelName()}.`;
  levelManager.showMessage(ERA_INTROS[index], 3200);
});

// Falling out of the world (chasm / void) respawns at the level spawn.
player.onFall = () => {
  player.reset();
  levelManager.showMessage('You fell out of time itself — the timeline pulls you back…', 2200);
};

function showScreen(el) {
  for (const s of [startScreen, pauseScreen, winScreen, hud]) s.classList.add('hidden');
  if (el) el.classList.remove('hidden');
}

function enterGame() {
  gameState = 'playing';
  showScreen(hud);
  player.controls.lock();
}

/** Full restart without a page refresh: level state, sockets, player, UI. */
function restartRun() {
  levelManager.restart();
  objectiveEl.textContent = levelManager.getObjectiveText();
  winDelay = 0;
  enterGame();
}

document.getElementById('start-button').addEventListener('click', enterGame);
document.getElementById('resume-button').addEventListener('click', enterGame);
document.getElementById('pause-restart-button').addEventListener('click', restartRun);
document.getElementById('win-restart-button').addEventListener('click', restartRun);

// Esc releases the pointer lock, which is our pause trigger.
player.controls.addEventListener('lock', () => {
  gameState = 'playing';
  showScreen(hud);
});
player.controls.addEventListener('unlock', () => {
  if (gameState === 'playing') {
    gameState = 'paused';
    showScreen(pauseScreen);
  }
});

/* Credits (reachable from the pause menu) */
const creditsScreen = document.getElementById('credits-screen');
document.getElementById('pause-credits-button').addEventListener('click', () => {
  creditsScreen.classList.remove('hidden');
});
document.getElementById('close-credits').addEventListener('click', () => {
  creditsScreen.classList.add('hidden');
});

/* -------------------------------------------------------------------- */
/* Render loop                                                           */
/* -------------------------------------------------------------------- */
const clock = new THREE.Clock();
let lastObjectiveText = '';
let lastPromptText = '';
let lastCameraMode = '';

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1); // clamp to avoid huge steps on tab-switch

  const playing = gameState === 'playing' && player.controls.isLocked;

  if (playing) {
    // Levels animate BEFORE the player physics runs, so moving platforms
    // publish this frame's carry delta before the player consumes it.
    levelManager.update(delta);
    player.update(delta);
  }

  timeMachine.update(delta);

  // Win sequence: the third socket lit the machine's restoration; let the
  // animation play out before raising the win screen.
  if (gameState !== 'won' && timeMachine.userData.isRestoring) {
    if (gameState !== 'paused') winDelay += delta;
    if (winDelay > 4.2) {
      gameState = 'won';
      player.controls.unlock();
      showScreen(winScreen);
    }
  }

  // HUD refresh — only touch the DOM when the text actually changes.
  if (gameState === 'playing') {
    const objectiveText = levelManager.getObjectiveText();
    const hint = levelManager.getHint();
    const fullObjective = hint ? `${objectiveText} · ${hint}` : objectiveText;
    if (fullObjective !== lastObjectiveText) {
      objectiveEl.textContent = fullObjective;
      lastObjectiveText = fullObjective;
    }

    const prompt = player.nearbyInteractable
      ? `[E] ${player.nearbyInteractable.userData.prompt || 'Interact'}`
      : '';
    if (prompt !== lastPromptText) {
      interactPrompt.classList.toggle('hidden', !prompt);
      if (prompt) interactPrompt.textContent = prompt;
      lastPromptText = prompt;
    }

    const modeLabel = player.mode === 'first' ? 'First-person (C)' : 'Third-person (C)';
    if (modeLabel !== lastCameraMode) {
      cameraModeEl.textContent = modeLabel;
      lastCameraMode = modeLabel;
    }
  }

  renderer.render(scene, camera);
}
animate();

/* -------------------------------------------------------------------- */
/* Debug/QA hook: lets the console (and automated testing) drive the     */
/* game without pointer lock — check states, force transitions, verify   */
/* disposal. Harmless in production; grep for __game when debugging.     */
/* -------------------------------------------------------------------- */
window.__game = { levelManager, player, timeMachine, scene, renderer };

/* -------------------------------------------------------------------- */
/* Resize handling                                                       */
/* -------------------------------------------------------------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
