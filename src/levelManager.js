import * as THREE from 'three';
import * as ancientRuins from './levels/ancientRuins.js';
import * as modernLab from './levels/modernLab.js';
import * as neonFuture from './levels/neonFuture.js';

const LEVELS = [ancientRuins, modernLab, neonFuture];

const OBJECTIVES = [
  'Objective: Explore the ruins and find the Ancient Core',
  'Objective: Investigate the laboratory and recover the Power Core',
  'Objective: Navigate the neon city and survive the timeline',
];

/**
 * Manages level transitions, resource lifecycle and GPU disposal.
 *
 * Usage from main.js:
 *   const levelManager = createLevelManager(scene, player);
 *   levelManager.loadLevel(scene, 0);          // initial load
 *   levelManager.nextLevel();                   // after recovering a core
 *   levelManager.restart();                     // full state reset
 */
export function createLevelManager(scene, player) {
  let currentLevelIndex = -1;

  // Persistent containers — reused across levels so we never re-add to scene
  const levelGroup = new THREE.Group();
  levelGroup.name = 'LevelObjects';
  scene.add(levelGroup);

  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'LevelLights';
  scene.add(lightsGroup);

  // Shared reference to the player's interactables array.
  // We mutate it in-place so Player's stored reference stays valid.
  const levelInteractables = player.interactables;

  /** Dispose a single geometry/material/texture if it has a dispose method. */
  function disposeResource(resource) {
    if (resource && typeof resource.dispose === 'function') {
      resource.dispose();
    }
  }

  /** Walk every mesh in the level group and dispose GPU resources. */
  function disposeLevel() {
    levelGroup.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });

    // Dispose light shadow maps (e.g. DirectionalLight shadow)
    lightsGroup.traverse((child) => {
      if (child.isLight && child.shadow && child.shadow.map) {
        child.shadow.map.dispose();
      }
    });

    // Also dispose anything the level explicitly flagged
    if (currentLevelData && currentLevelData.disposables) {
      currentLevelData.disposables.forEach(disposeResource);
    }

    // Clear all child objects from the containers
    while (levelGroup.children.length > 0) {
      levelGroup.remove(levelGroup.children[0]);
    }
    while (lightsGroup.children.length > 0) {
      lightsGroup.remove(lightsGroup.children[0]);
    }
  }

  let currentLevelData = null;

  function loadLevel(scene, levelIndex) {
    if (levelIndex < 0 || levelIndex >= LEVELS.length) return;
    if (levelIndex === currentLevelIndex) return;

    // Tear down the previous level
    disposeLevel();
    levelInteractables.length = 0;
    scene.background = null;
    scene.fog = null;

    // Build the new level into our persistent containers
    const levelModule = LEVELS[levelIndex];
    const result = levelModule.build(scene);

    currentLevelData = result;
    currentLevelIndex = levelIndex;

    // Route meshes into levelGroup, lights into lightsGroup
    if (result.objects) {
      result.objects.forEach((obj) => levelGroup.add(obj));
    }
    if (result.lights) {
      result.lights.forEach((light) => lightsGroup.add(light));
    }

    // Update interactables in-place (Player holds the same array reference)
    if (result.interactables) {
      result.interactables.forEach((obj) => levelInteractables.push(obj));
    }

    // Reset player to a safe position
    player.object.position.set(0, 1.7, 12);
    player.velocity.set(0, 0, 0);
  }

  function nextLevel() {
    const next = currentLevelIndex + 1;
    if (next < LEVELS.length) {
      loadLevel(scene, next);
    }
    // If next >= LEVELS.length, all cores recovered — trigger win state
    // (Person 4 will wire this up in the integration phase)
  }

  function restart() {
    currentLevelIndex = -1;
    loadLevel(scene, 0);
  }

  function getObjectiveText() {
    return OBJECTIVES[currentLevelIndex] || OBJECTIVES[0];
  }

  function getCurrentLevelIndex() {
    return currentLevelIndex;
  }

  function getLevelCount() {
    return LEVELS.length;
  }

  return {
    loadLevel,
    nextLevel,
    restart,
    getObjectiveText,
    getCurrentLevelIndex,
    getLevelCount,
  };
}
