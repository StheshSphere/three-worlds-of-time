# AGENTS.md — The Three Worlds of Time: The Broken Hourglass

Context for any AI coding agent (ChatGPT/Codex, Claude Code, Qoder, or a human) working in this repo. Keep this file short — if a rule stops mattering, delete it rather than letting it pile up.

## What this project is

A 3D browser game for a university CGV group project, built with Three.js, no bundler. Player explores three eras (Ancient Ruins / Modern Laboratory / Neon Future), recovers an energy core in each, and returns them to a central Time Machine. Five people, working in parallel on separate levels.

## Run it

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. **Never** open `index.html` via `file://` — module scripts are blocked and you'll get a blank screen. There is no build step, no `npm install`, no test suite. Three.js loads from a CDN via the import map in `index.html`.

## File map

```
index.html            import map, loading/start/HUD/pause/win/credits screens
src/main.js            renderer/scene/camera setup, render loop, game-state flow (menu/play/pause/win)
src/player.js           first/third-person controller: WASD, sprint, jump, ground raycast, wall collision,
                       platform carry, camera modes (V), flashlight (F)
src/character.js        player character: articulated procedural body with idle/walk/run/jump poses,
                       auto-replaced by assets/models/player/character.glb (GLTFLoader + AnimationMixer)
src/timeMachine.js       hierarchical Time Machine model — DO NOT flatten the hierarchy
src/levelManager.js     level lifecycle: mount/dispose per era, chaining, transitions, banner hints
src/levels/*.js          one file per era: ancientRuins.js / modernLab.js / neonFuture.js
src/style.css           HUD, banners, pause/win/transition overlays
```

Ownership (avoid stepping on someone else's file without asking in the group chat first):
Person 1 → `levels/ancientRuins.js` · Person 2 → `levels/modernLab.js` · Person 3 → `levels/neonFuture.js` · Person 4 → `player.js`, `character.js`, `timeMachine.js`, `levelManager.js` · Person 5 → `style.css`, `index.html`, shaders.

## Conventions an agent must follow

- **Relative paths only.** Never write an absolute path (`/src/...`) in HTML, JS, or asset loaders — the game is hosted in a subdirectory on the department LAMP server, not at domain root.
- **Lowercase, hyphenated filenames**, no spaces — the server is case-sensitive.
- **Level module contract.** Every file in `src/levels/` exports `build(scene, api)` returning `{ interactables, objects, lights, disposables, colliders?, walkables?, update?, spawn? }`, matching `ancientRuins.js`. The `api` object (from `levelManager.js`) provides `completeLevel()`, `showMessage(text)`, `setHint(fn)`, `grantFlashlight()` and `isFlashlightOn()` — use those instead of importing main.js/player.js. Meshes/lights go into the returned arrays, NEVER directly into `scene`. `update(delta)` runs each frame BEFORE player physics (this is how moving platforms publish `userData.carryDelta`). Call `api.completeLevel()` when the level's core is recovered.
- **Dispose GPU resources.** Any geometry/material/texture created when a level loads must be disposed when that level unloads — the level manager handles this from the returned `objects`/`lights`/`disposables` arrays, so just make sure everything you create is in one of them. Don't allocate new `THREE.Vector3`/objects inside the animation loop.
- **Credit everything.** Any third-party model, texture, sound, font, code snippet, or tutorial goes in `#credits-list` in `index.html` with source and licence, same commit as the asset.
- **Levels must differ**, not reskin each other — a new mechanic, new lighting identity, or new kind of challenge each time.

## Git workflow

- `main` is protected — no direct pushes. Work on `feature/<short-description>` branches, merge via PR with at least one review.
- Commit messages: present tense, specific (`Add flashlight toggle to lab level`, not `wip`).
- Before opening a PR: pull latest `main`, serve locally, actually play the change.
- See `CONTRIBUTING.md` for the full team workflow.

## Ask before doing, don't just do it

- Restructuring folders/modules in a way that changes the run instructions.
- Adding a bundler (Vite, webpack, etc.) — if you do, set `base: './'` and update the README's run instructions.
- Pulling in a large third-party asset pack.
- Rewriting another team member's level file rather than extending it — flag it to them first.

## Definition of done, per task

- Runs from a clean `python3 -m http.server`, no console errors.
- No absolute paths introduced.
- Credits updated if a new asset was added.
- `README.md`'s "what's not built yet" section updated if this task closes an item on it.
