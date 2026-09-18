# The Three Worlds of Time — The Broken Hourglass

### Beta-track build

A playable Three.js game for the CGV group project: **three complete levels** — Past (Solve), Present (Investigate) and Future (Survive) — chained by a level manager, with a win state, restart-without-refresh, and a custom shader. All three cores recovered triggers the Time Machine's restoration sequence and the win screen.

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
├── index.html            Entry point, import map, loading/start/HUD/pause/win/credits screens
├── README.md
└── src/
    ├── style.css          HUD, banners, pause/win/transition overlays
    ├── main.js            Boot sequence, renderer/scene/camera, render loop, game-state flow
    ├── player.js          First/third-person controller: WASD, sprint, jump, ground raycast, wall collision,
    │                      moving-platform carry, camera modes (V), flashlight (F)
    ├── character.js       Player character model: articulated procedural body with idle/walk/run/jump poses;
    │                      auto-replaced by assets/models/player/character.glb when present (GLTF + AnimationMixer)
    ├── levelManager.js    Level lifecycle: mount/dispose per era, level chaining, transitions
    ├── timeMachine.js     The hierarchical Time Machine model + socket lighting + win sequence
    └── levels/
        ├── ancientRuins.js   Level 1 (Past) — SOLVE: plates, rotating bridge, hidden runes, altar
        ├── modernLab.js      Level 2 (Present) — INVESTIGATE: keycard, flashlight, breaker sequence
        └── neonFuture.js     Level 3 (Future) — SURVIVE: moving platforms, GLSL energy barriers
```

## What this build demonstrates against the rubric

- **Viewing** — first-person _and_ third-person camera (press **V**), a lit, shadowed, fogged 3D scene in three distinct art identities, and an animated environment (rings, platforms, barriers, screens).
- **Control & Playability** — keyboard (WASD, Shift, Space, E, V, F) + mouse (pointer-lock look); camera-relative movement in both view modes (W always walks toward where you look); clear objectives and win state; 3D movement with gravity, jumping, step-climb, wall collision and moving-platform carry.
- **Hierarchical modelling** — `timeMachine.js` nests rings inside rings inside a base; `player.js` rigs a visible third-person body under a head anchor; levels parent rims/lights onto platform decks.
- **3D Effects** — era-specific lighting (warm sun / cool indoor / neon void), shadow mapping, fog, emissive materials, transparent glass, additive light beams.
- **Shaders** — `neonFuture.js` builds its energy barriers from a custom `THREE.ShaderMaterial`: a pass-through vertex shader exporting `vUv`, and a fragment shader driven by a `uTime` uniform (scrolling scanlines + a slow pulse). The same pulse computed in JS decides when the barrier is solid, so visuals and gameplay share one formula. Every member should read the comment block above `barrierVertexShader` — it is written to be explained out loud in the demo.
- **Gameplay & Experience** — three levels with three different verbs (SOLVE / INVESTIGATE / SURVIVE), full puzzle chains, timed hazards, respawn on falling into the void, message banner guidance.
- **Polish** — loading screen, start screen, pause menu (Esc), win screen, era-transition overlay, restart-without-refresh that resets levels, sockets, player and UI.

## What is deliberately NOT built yet (post-Beta backlog)

1. **Real assets.** All geometry is still primitive Three.js shapes. Swap in GLTF models or better procedural detail if time allows (Innovation, not required).
2. **Sound/music and SFX** — nothing audible yet; brief marks sound under Gameplay & Experience.
3. **Bump/height maps, reflections, skybox** — the 3D Effects category rewards "several advanced effects"; these are the next candidates.
4. **Second custom shader** (e.g. a `uTime` ripple around the Time Machine during transitions, per pitch doc §9) and a minimap if time allows.
5. **Credits list** — `#credits-list` still only lists Three.js + PointerLockControls. Keep it current as assets land (mandatory per brief §3).
6. **Trailer + devlog** — post-Beta deliverables; start capturing footage now that all levels are playable.

## Design notes

- The Time Machine sits at the world origin in every era — the one object that survives across levels and demonstrates hierarchical modelling cleanly.
- `player.js`, `timeMachine.js` and `levelManager.js` are level-agnostic; each level file only builds its own world and returns it. "Genuinely different levels" (brief §1) comes from environment and mechanic, not re-plumbed controls.
- All asset and script paths are relative (`./src/...`), never absolute (`/src/...`), per brief §6.2 — this avoids the most common cause of a game that works locally but shows a blank canvas once hosted on the LAMP server.
