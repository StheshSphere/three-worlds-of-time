import * as THREE from 'three';
import * as ancientRuins from './levels/ancientRuins.js';
import * as modernLab from './levels/modernLab.js';
import * as neonFuture from './levels/neonFuture.js';

const LEVELS = [ancientRuins, modernLab, neonFuture];

const OBJECTIVES = [
  'Past — Solve: recover the Ancient Core',
  'Present — Investigate: restore power and recover the Lab Core',
  'Future — Survive: cross the collapsing city and recover the Neon Core',
];

const LEVEL_NAMES = ['the Ancient Ruins', 'the Modern Laboratory', 'the Neon Future'];

/**
 * Owns the level lifecycle: mounting one era at a time, disposing the
 * previous era's GPU resources, driving per-frame level updates (platforms,
 * barriers, doors) and chaining 1 → 2 → 3 → win.
 *
 * Level contract (see AGENTS.md):
 *   build(scene, api) → { interactables, objects, lights, disposables, update? }
 *
 * `api` gives every level the same integration surface without imports:
 *   api.completeLevel()  — light this level's socket, then advance
 *   api.showMessage(t)   — timed HUD banner
 *   api.setHint(fn)      — per-level hint text provider for the [E] prompt
 *
 * Objects flagged userData.persistent = true survive disposal and are only
 * detached (levels reuse shared assets that way if they want to).
 */
export function createLevelManager(scene, player) {
  let currentLevelIndex = -1;
  let currentLevelData = null;
  let timeMachine = null;
  let levelUpdate = null;
  let hintProvider = null;
  let onLevelLoaded = null;
  let transitioning = false;
  let transitionToken = 0; // bumping this cancels a pending level swap (restart)

  const transitionEl = document.getElementById('transition-overlay');
  const messageEl = document.getElementById('message-banner');
  let messageTimer = null;

  // Persistent containers — reused across levels so we never re-add to scene.
  const levelGroup = new THREE.Group();
  levelGroup.name = 'LevelObjects';
  scene.add(levelGroup);

  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'LevelLights';
  scene.add(lightsGroup);

  // Shared reference to the player's interactables array; mutated in-place
  // so Player's stored reference stays valid across level swaps.
  const levelInteractables = player.interactables;

  // ---- per-level API handed to every build() ---------------------------
  function completeLevel() {
    if (transitioning || currentLevelIndex < 0) return;
    timeMachine.lightSocket(currentLevelIndex);
    if (currentLevelIndex < LEVELS.length - 1) {
      transitioning = true;
      const token = ++transitionToken;
      showMessage(`The ${['Ancient', 'Laboratory', 'Neon'][currentLevelIndex]} Core is recovered — the timeline shifts…`, 2600);
      if (transitionEl) transitionEl.classList.add('active');
      setTimeout(() => {
        if (token !== transitionToken) return; // a restart cancelled this swap
        loadLevel(currentLevelIndex + 1);
        transitioning = false;
        if (transitionEl) transitionEl.classList.remove('active');
      }, 900);
    } else {
      // Third core: main.js watches timeMachine.userData.isRestoring and
      // raises the win screen after the restoration sequence plays.
    }
  }

  function showMessage(text, ms = 2400) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.add('active');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => messageEl.classList.remove('active'), ms);
  }

  function setHint(fn) { hintProvider = fn; }

  // Flashlight bridge — Level 2 grants it, any level could reuse it.
  function grantFlashlight() { player.addFlashlight(); }
  function isFlashlightOn() { return !!player.flashlight && player.flashlightOn; }

  const api = { completeLevel, showMessage, setHint, grantFlashlight, isFlashlightOn };

  function getHint() {
    if (!hintProvider) return null;
    try { return hintProvider(); } catch { return null; }
  }

  // ---- disposal ---------------------------------------------------------
  function disposeObject3D(root) {
    root.traverse((child) => {
      if (child.userData && child.userData.persistent) return;
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (!m) return;
          // Shared materials may already be gone from an earlier dispose.
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
            if (m[key]) m[key].dispose();
          }
          m.dispose();
        });
      }
      if (child.isLight && child.shadow && child.shadow.map) {
        child.shadow.map.dispose();
      }
    });
  }

  function disposeResource(resource) {
    if (resource && typeof resource.dispose === 'function') resource.dispose();
  }

  function disposeLevel() {
    if (currentLevelData) {
      if (currentLevelData.objects) currentLevelData.objects.forEach(disposeObject3D);
      if (currentLevelData.lights) currentLevelData.lights.forEach(disposeObject3D);
      if (currentLevelData.disposables) currentLevelData.disposables.forEach(disposeResource);
    }
    while (levelGroup.children.length > 0) levelGroup.remove(levelGroup.children[0]);
    while (lightsGroup.children.length > 0) lightsGroup.remove(lightsGroup.children[0]);
  }

  // ---- loading ----------------------------------------------------------
  function loadLevel(levelIndex) {
    if (levelIndex < 0 || levelIndex >= LEVELS.length) return;
    if (levelIndex === currentLevelIndex) return;

    disposeLevel();
    levelInteractables.length = 0;
    player.setColliders([]);
    player.setWalkables([]);
    player.clearLevelAttachments();
    levelUpdate = null;
    hintProvider = null;
    scene.background = null;
    scene.fog = null;

    const spawn = new THREE.Vector3(0, 1.7, 12);

    const result = LEVELS[levelIndex].build(scene, api);
    currentLevelData = result;
    currentLevelIndex = levelIndex;

    if (result.objects) result.objects.forEach((obj) => levelGroup.add(obj));
    if (result.lights) result.lights.forEach((light) => lightsGroup.add(light));
    if (result.interactables) result.interactables.forEach((obj) => levelInteractables.push(obj));
    if (result.colliders) player.setColliders(result.colliders);
    if (result.walkables) player.setWalkables(result.walkables);
    if (result.spawn) spawn.copy(result.spawn);
    if (result.update) levelUpdate = result.update;

    player.spawn.copy(spawn);
    player.reset();
    if (onLevelLoaded) onLevelLoaded(levelIndex);
  }

  function nextLevel() {
    if (currentLevelIndex < LEVELS.length - 1) loadLevel(currentLevelIndex + 1);
  }

  function restart() {
    if (timeMachine) timeMachine.reset();
    // Cancel any pending transition AND dispose whatever is still mounted —
    // nulling currentLevelData before disposal would leak the GPU resources.
    transitionToken++;
    transitioning = false;
    if (transitionEl) transitionEl.classList.remove('active');
    disposeLevel();
    currentLevelData = null;
    currentLevelIndex = -1;
    loadLevel(0);
  }

  /** Called every frame from main.js's render loop. */
  function update(delta) {
    if (levelUpdate) levelUpdate(delta);
  }

  function registerTimeMachine(machine) { timeMachine = machine; }
  function setOnLevelLoaded(fn) { onLevelLoaded = fn; }
  function isTransitioning() { return transitioning; }

  function getObjectiveText() {
    return `Objective: ${OBJECTIVES[currentLevelIndex] || OBJECTIVES[0]}`;
  }
  function getCurrentLevelIndex() { return currentLevelIndex; }
  function getLevelCount() { return LEVELS.length; }
  function getLevelName() { return LEVEL_NAMES[currentLevelIndex] || LEVEL_NAMES[0]; }

  return {
    loadLevel,
    nextLevel,
    restart,
    update,
    registerTimeMachine,
    setOnLevelLoaded,
    isTransitioning,
    getHint,
    showMessage,
    getObjectiveText,
    getCurrentLevelIndex,
    getLevelCount,
    getLevelName,
  };
}
