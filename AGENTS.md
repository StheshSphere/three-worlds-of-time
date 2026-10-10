# AGENTS.md — The Three Worlds of Time: The Broken Hourglass

Context for any AI coding agent (ChatGPT/Codex, Claude Code, Qoder, or a human) working in this repo. Keep this file
short — if a rule stops mattering, delete it rather than letting it pile up.

## What this project is

A 3D browser game for a university CGV group project, built with Three.js r160, **no bundler**. Three eras of the same
place (Ancient Ruins / Modern Lab / Neon Future); recover a core in each and restore the Time Machine. Four members.

## Run it

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000`. **Never** open `index.html` via `file://`. Three.js is vendored in `libs/three/` and
resolved by the import map in `index.html` — no CDN, no `npm install` for the game.

## File map

```
index.html               import map, every screen/overlay (loading/title/HUD/pause/options/controls/credits/journal/…)
src/main.js              renderer, game-state flow (title/cutscene/playing/paused/overlay/failed/credits/won), loop, window.__game
src/story.js             story cutscene scripts (prologue, wake-up, arrival lines, epilogue) for src/core/cutscene.js
src/levels/prologue.js   non-playable cutscene set (the lab on the night of Field Test 7 / the next morning)
src/player.js            controller: input, physics (AABB walls + ground raycast), camera rig, interact, dash, hurt
src/character.js         hero GLB + our gear parented to bones + AnimationMixer state machine
src/timeMachine.js       hierarchical Time Machine — DO NOT flatten the hierarchy
src/levelManager.js      era lifecycle, the level `api`, stability/fail, transitions, finale, disposal
src/core/kit.js          level toolkit: materials, world-UV boxes, props, scatter, colliders, interactables, map layer
src/core/{assets,audio,postfx,minimap,settings,ui}.js
src/shaders/*.js         all custom GLSL (documented in docs/SHADERS.md)
src/levels/*.js          ancientRuins.js / modernLab.js / neonFuture.js (+ glyphs.js)
tools/                   dev only (asset pipeline, deploy build, headless tests) — never shipped
```

Ownership follows the four-member completion guide: Members 1–3 own the Ancient, Lab and Future work respectively;
Member 4 owns final integration, controls/camera polish, UI consistency, performance/cleanup, credits and release/LAMP.
Preserve completed shared systems and each member's level. Ask before rewriting someone else's level.

## Conventions an agent must follow

- **Relative paths only** (`./assets/...`) — the game is hosted in a subfolder.
- **Asset filenames lowercase-hyphenated**, no spaces — the server is case-sensitive. JS modules keep their camelCase names; import them with the exact case.
- **Level contract.** Each `src/levels/*.js` exports `meta` (`name, numeral, title, subtitle, objective, music, ambience, sky, stability, accent, surface, sun?, fallPenalty?`) and `build(kit, api)` returning `kit.result({ spawn, spawnYaw, bounds, killY, dash?, debug? })`.
  Create everything through `kit` (so it's disposed on unload); add per-frame logic with `kit.update((dt, t) => …)`.
  Talk to the game only through `api`: `message, setObjective, setHint, setMarker, checkpoint, penalize, hurt, sound,
  positional, journal, reader, keypad, grantFlashlight, flashlight, shake, completeLevel, player, sky, quality`.
- **Physics** — visuals and physics are separate: `kit.box({solid, walk})`, `kit.proxy(...)` (invisible collider),
  `kit.prop(name, {solid})`. Colliders are AABBs in `userData.solidBox`; `userData.onPush` / `onTouch` hook into the player.
- **No allocations in the render loop** (reuse scratch vectors). **Dispose** everything a level creates (kit does it).
- **Credit everything** third-party in `#credits-list` in `index.html`, same commit as the asset. New assets go through `tools/prepare-assets.mjs`.
- **Levels must differ** — new mechanic, new visual identity, new kind of challenge.

## Git workflow

- `main` is protected — work on `feature/<short-description>` branches, merge via PR with one review.
- Commit messages: present tense, specific.
- Before a PR: serve locally, play the change, run `bash tools/build-deploy.sh` (pre-flight checks must pass).
- Node logic checks: `node tools/test-integration.mjs` and `node tools/test-audio.mjs` (render/audio doubles).
- Browser QA hook is available only with `?qa=1`. See `docs/RELEASE-INSTRUCTIONS.md` and the verification report.

## Ask before doing, don't just do it

- Restructuring folders/modules in a way that changes the run instructions; adding a bundler.
- Pulling in a large third-party asset pack.
- Rewriting another team member's level file rather than extending it.

## Definition of done, per task

- Runs from a clean `python3 -m http.server`, no console errors (headless: `node tools/play.mjs <script> <out>`).
- No absolute paths; asset names lowercase; credits updated if an asset was added.
