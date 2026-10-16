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
| **III · The Future** — The Fractured Skyline, 2187 | **Survive** | Two clear forward jumps (normal and very big) and a timing gauntlet over a bottomless neon city: moving and phasing platforms, timed barriers, lasers, and a collapsing bridge chased by a time rift. |

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
| WASD / ↑ ↓ | Move (camera-relative); A/D strafe |
| ← / → | Turn camera and flashlight left/right (mouse look also works) |
| Mouse | Look |
| Shift | Sprint; hold with W or ↑ and press Space for a BIG forward jump in the Future |
| W / ↑ + Space | Normal forward jump (hold forward, press Space). |
| Shift + W / ↑ + Space | Very big forward jump in the Future; use it for the first wide gap. |
| E / left click | Interact — push, read, take, or open a console. Most clues use a generous invisible E circle. |
| Present power-console puzzle | Approach the large wall console and press E to open the entire 3×3 tile grid. Click a tile or press 1–9 to rotate clockwise; Esc closes the panel. Connect GRID IN (middle-left) to VAULT OUT (middle-right). Bright cyan pipes are powered. |
| Walk into a stone block | Push it one tile (the Past) |
| F | Flashlight (the Present, once found) |
| V | First / third person |
| M | Minimap on/off |
| Invisible clue circles | Most clues use the 6m-radius easy proximity circle. **Exception:** Present Archive phosphor ink only offers **Press E** when the flashlight beam actually lights the mark. |
| J | Field journal (clues you've found) |
| Esc | Pause (options, controls, credits, restart) |
| Enter / click | Advance the current subtitle or important instruction |
| X / Skip cinematic | Skip the current cinematic |
| H | Reopen the latest tutorial |

## Save and continue

**Continue Journey** restores the latest valid browser-local journey. Completed puzzles, clues, journal,
unlocked geometry, cores and stable puzzle configurations survive closing the browser. Progress autosaves
at milestones and periodically; **Esc → Save Game** saves manually. The Future resumes at the last safe
checkpoint with temporary hazards reset. **Resume** only closes the pause menu.

Saves belong to the current browser profile and site origin on this device. Clearing site data removes them;
another browser, device or host does not share them. Storage errors leave the previous save intact and show
a notice. New Journey and restarting an era require confirmation before replacing existing progress.
Reading important instructions pauses gameplay hazards and the stability countdown.

See [FINAL_RELEASE_REPORT.md](FINAL_RELEASE_REPORT.md) for the final changes, test evidence and remaining
Chrome/Ubuntu checks. Earlier member reports are retained as historical handoff documents.

## What's in it (mapped to the rubric)

- **Viewing** — third-person over-the-shoulder camera with wall collision + first-person toggle; orthographic
  **minimap** (second camera, layer-filtered); animated rigged hero; cinematic title and finale cameras.
- **Control & Playability** — acceleration-based movement, coyote time + jump buffering, push-blocks, dash, moving
  platform carry. Clear objectives, hints, a distance-only clue badge (no directional arrow), and invisible clue interaction circles. **Fail states**: timeline-stability countdown per era,
  falls, barrier shocks, lasers, the rift. Checkpoints.
- **3D Effects** — PBR materials (albedo + normal + AO/roughness/metal maps), image-based lighting from each era's sky,
  shadow-mapped sun that follows the player, a shadow-casting flashlight, **planar reflections** (temple pool, lab floor),
  **refraction** (transmission glass on High quality), procedural skybox, fog, bloom, MSAA, instancing.
- **Shaders** — custom GLSL effects driven by time and/or game state, including 21 effects documented in [`docs/SHADERS.md`](docs/SHADERS.md).
- **Gameplay & Experience** — three distinct eras and verbs, a story told through logs, tablets and the setting
  (the lab's glass floor shows the temple underneath), per-era music + synthesised ambience + 3D positional sound,
  randomised codes (replay value), best-time record.
- **Polish** — loading screen with real progress, title / pause / options / controls / credits / journal / fail / win
  screens, restart without refresh, consistent per-era colour scheme, quality presets with an automatic downgrade on
  slow machines, FPS counter.
- **Innovation** — own procedural Time Machine, trees, rock cliffs, procedural city; flashlight-revealed ink;
  timing through pulsing barriers; one place transformed across three eras.

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
the browser needs into `dist/`, and zips it as `Three_Worlds_of_Time_FINAL_LAMP.zip` **with `index.html` at the top level**.
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
node tools/test-dialogue.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
```

The first three execute real gameplay, dialogue and audio lifecycle code with DOM, renderer and Web Audio doubles.
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


### E-ZONES V3 — reliable clue collection (October 2026)

**Ordinary clues can be activated within a 6 m radius (12 m diameter)** without looking at the small model, including the office flashlight and Past tablets. **Present Archive phosphor ink is deliberately harder:** it requires a flashlight-on, accurately aimed beam on the wall mark before the E prompt and collection are available. Use the left/right arrow keys or mouse to turn the beam; aiming alone never auto-collects ink. The same shared nearest-clue resolver drives both the green **E** prompt and the actual E action. The E handler independently rechecks the clue circle at key-down, so nearby machinery and raycasts cannot steal clue pickups. Architectural walls still prevent picking items through inaccessible rooms; completed/locked items preserve their level-specific behaviour. The blue HUD still shows distance only.

**Verify that the new code really loaded:** In the game's top-right HUD, look for `JUMP V9 · HOLD SHIFT + FORWARD, TAP SPACE`. If this badge is missing, you are playing an older copy or cached version (serve the folder containing this `index.html`, stop old Python servers, then hard-refresh with Ctrl+Shift+R).

### Pipe-grid V5 — clear full-screen power-routing puzzle

In the Present power room, walk to the wall console and press E. Instead of rotating tiny 3D wall tiles, this opens a 3×3 close-up grid like the Archive keypad. Click tiles (or use number keys 1–9 in reading order) to rotate their pipes 90° clockwise. Connect GRID IN at the left-middle edge to VAULT OUT at the right-middle edge; connected pipes glow cyan. The panel can be closed with Esc and reopened without resetting rotations. Completion still uses the original pipe-connection algorithm, level transformation, progress save, and vault-opening sequence. Other levels and the flashlight-only ink clue mechanic are unchanged.


### Future jump input fix V8
- Hold **Shift**, then hold **W or ↑**, then **tap Space once** for a large forward jump.
- Without Shift, hold **W or ↑** and tap **Space** for the normal forward jump.
- The Space keydown captures the combination immediately; the jump buffer and edge grace make a single tap reliable even on a slow PC or just off a ledge.
- A short **BIG JUMP!** or **NORMAL JUMP** HUD label confirms the action. The player must face the landing platform.

### Future jumping and disappearing platforms (V9)
- Hold **W** or **↑**, then tap **Space** once for a normal jump.
- Hold **Shift** and **W** (or **↑**) at the same time, then tap **Space** once for the **BIG JUMP**. The jump begins on Space keydown, not on a later animation frame.
- In the Future, phase-platform decks are wider (4.2 m instead of 3.4 m). The cycle is 4.7 s fully solid, 0.8 s fading, 0.65 s absent, 0.85 s reappearing. Bridge tiles now delay collapse 0.95 s rather than 0.42 s, and the rift approaches slightly more slowly.
- A **BIG JUMP!** visual confirms the long leap fired; only the Future uses these physics.
- To avoid serving the wrong extraction folder, run `START_GAME_V9.bat` from the root of this extracted game.


## Future level V10 improvements

- **Jump**: Hold Shift, keep it held while holding Up arrow (or W), then **tap Space once**. You do not need to keep Space held or release Up first. Normally the big jump starts on Space keydown; if that event is missing, a delivered Space keypress or the end of the tap can recover it while Shift and forward are still held. Recently released movement keys are never treated as held. A normal forward jump uses Up arrow (or W) + Space. Normal jumps allow WASD/arrow steering; long jumps keep their takeoff direction.
- **Falling bricks**: Sprint with Shift + Up / W. Tiles remain solid for about 2.15 seconds; the rift moves more slowly. Falling or being caught returns to the safe pre-bridge platform and resets the bridge. Spire checkpoint is only earned after landing on the spire.
- **Colour lock finale**: Much larger world panel with numbered colour order, persistent high-contrast HUD hint, six-second colour cycles, highlighted matching orb, easier close-range E interaction, and step confirmation.

### Check the three-key combination

Open `tools/keyboard-check.html` in a browser (double-clicking this standalone checker is fine).
Hold Shift, then hold Up, then tap Space while keeping Shift and Up held. The checker retains the result of the tap,
so you do not have to catch the brief Space highlight. If no Space event appears until another key is released,
the keyboard/browser is not delivering the requested combination; the game cannot recover a tap with no events.
Compare the other Shift key and the working W combination.
The checker only observes input; it does not run or alter the game.

Run `node tools/test-jump-controls.mjs` for the exact held-key sequence, release behaviour and jump-steering checks.
