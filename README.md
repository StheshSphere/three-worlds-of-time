# The Three Worlds of Time — The Broken Hourglass
### Alpha build

This is a **preliminary, playable Three.js scaffold** for the CGV group project — enough to walk your mentor through what the game will ultimately look like, per brief §8.1 ("You should have Three.js up and running, with a preliminary implementation").

It is *not* the finished Level 1. It's a small vertical slice that proves the architecture: a controllable player, a lit and shadowed 3D environment, one interactable object, and the hierarchical Time Machine that anchors all three levels.

## Running it locally

No npm install, no build step — this uses an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to pull Three.js straight from a CDN, exactly like the "plain files" option described in the brief (§6.3). That means:

```bash
cd three-worlds-of-time
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome. **Do not** open `index.html` directly as a `file://` URL — module scripts are blocked under `file://` and you'll get a blank screen (brief §6.3).

If your team later wants a bundler (Vite, etc.) for asset pipelines, GLTF/Draco loading, or hot reload, that's a fine upgrade — just remember to set `base: './'` in `vite.config.js` so paths stay relative (brief §6.2), since the LAMP server publishes your game inside a subdirectory, not at the domain root.

## Project structure

```
three-worlds-of-time/
├── index.html          Entry point, import map, loading/start/HUD/credits screens
├── README.md
└── src/
    ├── style.css        HUD, menus, loading bar
    ├── main.js           Boot sequence, renderer/scene/camera, render loop
    ├── player.js         PointerLockControls wrapper: WASD, sprint, jump, interact raycast
    ├── world.js           Level 1 (Ancient Ruins) geometry, lighting, one interactable puzzle block
    └── timeMachine.js      The hierarchical Time Machine model (the game's visual anchor)
```

## What this alpha already demonstrates against the rubric

- **Viewing** — a lit, shadowed 3D scene with fog, a moving/rotating hierarchical object (the Time Machine), and a first-person camera that moves through the world.
- **Control & Playability** — working keyboard (WASD, Shift, Space, E) and mouse (pointer-lock look) controls, movement in all three dimensions (jump/gravity included), and a simple objective the player can advance (push the block onto the pressure plate).
- **Hierarchical modelling** — `timeMachine.js` nests rings inside rings inside a base, each rotating independently but carrying its children, so you can *explain in the demo* why each mesh is parented where it is.
- **3D Effects (partial)** — directional + hemisphere lighting, shadow mapping, fog, emissive materials on the core. Antialiasing, skyboxes, reflections/refractions, bump/height maps and multiple light sources beyond this are still to add.
- **Polish (partial)** — loading screen, start/pause menu, in-HUD objective text, a Credits screen stub, and a restart button.

## What is deliberately NOT in the alpha (and should come next)

These are placeholders on purpose — the brief only expects a **preliminary** implementation at this stage:

1. **Real assets.** Every stone block, pillar and rubble piece is primitive Three.js geometry (`BoxGeometry`, `CylinderGeometry`, `DodecahedronGeometry`). Swap these for real models (GLTF via Blender) or better procedural detail before the beta.
2. **Full puzzle chain.** Only one interactable block exists. Level 1's design calls for pushing blocks, rotating a bridge, finding symbols, and a final mechanism (pitch doc §4).
3. **Levels 2 and 3.** The Modern Laboratory and Neon Future aren't built yet — `world.js` currently only exports `buildAncientRuinsLevel`. Plan a `LevelManager` that can tear down one level's scene/lights/interactables and load the next, calling `.dispose()` on old geometries/materials/textures as you go (brief §6.1) so memory doesn't climb across a three-level playthrough.
4. **Custom shaders.** Everything currently uses built-in `MeshStandardMaterial`. The Shaders category (10%) is marked separately from built-in effects — you'll want at least one custom vertex/fragment shader (e.g. a time-distortion effect around the Time Machine, per pitch doc §9) before the beta.
5. **Sound/music**, a proper physics/collision system (current collision is a flat-plane assumption plus world-bounds clamping — fine for a ruins courtyard, not for real platforming), and the multi-view/minimap options mentioned under Viewing.
6. **Credits list.** `#credits-list` in `index.html` only has two placeholder entries — fill it in as you add third-party assets, code or tutorials (brief §3, mandatory).

## Design notes for your mentor conversation

- The Time Machine is deliberately the *first* thing built because it's the one object that has to survive across all three levels and demonstrates hierarchical modelling cleanly — good to lead with in the alpha walkthrough.
- `player.js` and `world.js` are separated so that when Level 2/3 are added, only `world.js`-equivalents change; the player controller and Time Machine stay the same across levels, which keeps "genuinely different levels" (brief §1) about environment and mechanic, not about re-plumbing controls each time.
- All asset and script paths are relative (`./src/...`), never absolute (`/src/...`), per brief §6.2 — this avoids the most common cause of a game that works locally but shows a blank canvas once hosted on the LAMP server.
