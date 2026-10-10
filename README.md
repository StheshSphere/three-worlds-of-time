# The Three Worlds of Time — The Broken Hourglass

A 3D browser adventure built with **Three.js r160** for the Wits CGV group project (COMS3006A/COMS3025A).

**Story.** 03:07 a.m. at the Chronos Research Facility: Ari, Professor Adeyemi's student inventor, runs Field Test 7
alone. The hourglass drive overloads and the Time Machine's three energy cores are flung across time — into the distant
past, into that very night, and into a far future. Ari wakes in an ancient temple beside the machine and must recover
one core from each era of the *same place* — the temple, the lab built on top of it, and the neon city it becomes — to
put the timeline back together. The game opens with a skippable cutscene (prologue), Ari comments on arriving in each
era, and it ends with an epilogue in the lab the next morning, an end card and a credits roll.

| Era | Verb | What this level does that the others don't |
|---|---|---|
| **I · The Past** — Temple of the First Hour | **Solve** | The world itself is the puzzle: you push stone blocks across a grid, rotate bronze mirrors to steer a sunbeam, and decode carved rune tablets. |
| **II · The Present** — Chronos Research Facility | **Investigate** | You win with information: read logs, find a flashlight whose beam reveals invisible phosphor ink, crack a keypad code and reroute power — which transforms the whole level from emergency red to full light. |
| **III · The Future** — The Fractured Skyline, 2187 | **Survive** | A new ability (the Chrono-Dash) and a timing gauntlet over a bottomless neon city: moving and phasing platforms, barriers you dash *through*, lasers, and a collapsing bridge chased by a time rift. |

## Run it locally

No build step and no `npm install` for the game itself — it's plain files plus an import map, and Three.js is
vendored in `libs/` (no CDN dependency).

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000> in Chrome. **Never** open `index.html` as a `file://` URL — module scripts are blocked.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move (camera-relative) |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (hold for a higher jump) |
| E / left click | Interact — push, rotate, read, take |
| Walk into a stone block | Push it one tile (the Past) |
| F | Flashlight (the Present, once found) |
| Q / right click | Chrono-Dash (the Future) |
| V | First / third person |
| M | Minimap on/off |
| J | Field journal (clues you've found) |
| Esc | Pause (options, controls, credits, restart) |

## What's in it (mapped to the rubric)

- **Viewing** — third-person over-the-shoulder camera with wall collision + first-person toggle; orthographic
  **minimap** (second camera, layer-filtered); animated rigged hero; cinematic title and finale cameras.
- **Control & Playability** — acceleration-based movement, coyote time + jump buffering, push-blocks, dash, moving
  platform carry. Clear objectives, hints and a minimap marker. **Fail states**: timeline-stability countdown per era,
  falls, barrier shocks, lasers, the rift. Checkpoints.
- **3D Effects** — PBR materials (albedo + normal + AO/roughness/metal maps), image-based lighting from each era's sky,
  shadow-mapped sun that follows the player, a shadow-casting flashlight, **planar reflections** (temple pool, lab floor),
  **refraction** (transmission glass on High quality), procedural skybox, fog, bloom, MSAA, instancing.
- **Shaders** — 17 custom GLSL shaders (16 full ShaderMaterials + 1 PBR injection), each driven by time and/or game state — see [`docs/SHADERS.md`](docs/SHADERS.md).
- **Gameplay & Experience** — three distinct eras and verbs, a story told through logs, tablets and the setting
  (the lab's glass floor shows the temple underneath), per-era music + synthesised ambience + 3D positional sound,
  randomised codes (replay value), best-time record.
- **Polish** — loading screen with real progress, title / pause / options / controls / credits / journal / fail / win
  screens, restart without refresh, consistent per-era colour scheme, quality presets with an automatic downgrade on
  slow machines, FPS counter.
- **Innovation** — own procedural Time Machine, trees, rock cliffs, procedural city; flashlight-revealed ink;
  dash-phasing through barriers; one place transformed across three eras.

## Project structure

```
index.html              import map → ./libs/three, all screens (loading/title/HUD/pause/options/credits/…)
src/main.js             boot, renderer, game-state flow (title → prologue → play → epilogue → credits), render loop
src/story.js            the story: prologue, wake-up, era arrival lines, epilogue (cutscene scripts)
src/player.js           controller: input, physics, camera rig, interaction, dash, hurt/checkpoints
src/character.js        hero model (KayKit CC0) + our hourglass gear on its bones + animation blending
src/timeMachine.js      the hierarchical Time Machine (scene graph — do not flatten) + force field
src/levelManager.js     era lifecycle, level API, stability/fail, transitions, finale, disposal
src/core/               assets, audio, postfx, kit (level toolkit), minimap, settings, ui, cutscene (camera/caption engine)
src/shaders/            every custom GLSL shader (see docs/SHADERS.md)
src/levels/             ancientRuins.js · modernLab.js · neonFuture.js · glyphs.js · prologue.js (cutscene set)
assets/                 optimised CC0 models/textures/audio + OFL fonts (generated by tools/)
libs/three/             vendored three.js r160 + the add-ons we use
tools/                  dev-only: asset pipeline, deploy build, headless test runner (NOT uploaded)
docs/                   SHADERS.md (explain-the-shaders guide), TEAM-GUIDE.md (levels, solutions, demo notes)
```

## Deploying to the LAMP server

```bash
bash tools/build-deploy.sh
```

Runs the brief's pre-flight checks (no absolute paths, lowercase asset names, every asset present), copies only what
the browser needs into `dist/`, and zips it as `three-worlds-of-time.zip` **with `index.html` at the top level**.
Test the build (`cd dist && python3 -m http.server`), upload the zip via Moodle, then play the published URL in Chrome
and check the console for 404s.

## Rebuilding assets (only if you change them)

```bash
cd tools && npm install && node prepare-assets.mjs all
```

Downloads the CC0 sources (Poly Haven, KayKit, Kenney, OpenGameArt), simplifies meshes to triangle budgets,
re-encodes textures to WebP, meshopt-compresses geometry and converts audio to Ogg Opus. Credits for every asset are in
the in-game **Credits** screen.

## Automated checks (dev only)

Requires Node 20+ and Python 3.10+ for development checks; neither is needed on the static host.

```bash
node tools/test-integration.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
```

The first two execute real gameplay/audio lifecycle code with DOM, renderer and Web Audio doubles.
The release check extracts the ZIP independently and verifies every file over HTTP at a subfolder URL.
These checks do **not** verify visuals, GPU memory, real input, audible output or a complete spatial playthrough.

For installed Chrome, `tools/play.mjs` runs assertions and captures screenshots; it fails on console exceptions,
asset warnings, missing resources and timeouts. The QA hook is opt-in with `?qa=1` (the runner adds it).
See [release instructions](docs/RELEASE-INSTRUCTIONS.md), [Member 4 report](docs/member4-completion-report.md)
and [verification results](docs/final-verification-summary.md) for the remaining manual browser/LAMP checks.

## AI assistance

Large parts of this remaster were produced with AI assistance (Claude Code, Anthropic). This is declared in the in-game
credits. Member 4 integration and release work also used OpenAI ChatGPT/Codex. Every team member should still be able
to explain the code they present.

```bash
# Serve the extracted release in one terminal. In another, from the source root:
npm --prefix tools install
VIEW=third node tools/play.mjs tools/tests/member4-release.json out/third
VIEW=first node tools/play.mjs tools/tests/member4-release.json out/first
```
