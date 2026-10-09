# Custom shaders — the explain-it guide

The brief: *"Have you written your own vertex and fragment shaders… are uniforms driven by time or game state… does the
shader achieve something the built-in materials cannot… you must be able to explain your shader code."*
Every member should be able to talk through **at least the first five** below. Each one is a `THREE.ShaderMaterial`
(or a `Reflector`/`ShaderPass` using our own GLSL) unless stated otherwise.

## The 60-second primer (say this first)

- The **vertex shader** runs once per vertex: it decides *where* the vertex ends up on screen
  (`gl_Position = projectionMatrix * viewMatrix * modelMatrix * position`). We can move vertices here (waves, wind).
- The **fragment shader** runs once per pixel: it decides the pixel's colour (`gl_FragColor`).
- **Uniforms** are values JavaScript sends every frame (time, player position, flashlight state…) — the same for every
  vertex/pixel. **Attributes** are per-vertex data (position, normal, uv, our own per-instance data).
  **Varyings** carry values from the vertex stage to the fragment stage, interpolated across the triangle.
- `src/shaders/noise.glsl.js` holds shared helpers: `hash` (pseudo-random), `noise` (smooth value noise), `fbm`
  (several octaves of noise added together → clouds, water, dissolve edges).

## Signature shaders (everyone should know these)

| # | Shader | File | Driven by | What to say |
|---|---|---|---|---|
| 1 | **Time-warp post-process** | `shaders/timeWarp.js`, used in `core/postfx.js` | `uWarp` (era transition, dash), `uGlitch` (low stability), `uFlash`, `uDamage`, per-era grade | Runs on the *whole frame* (full-screen quad). Swirl = rotation matrix whose angle falls off with distance from the centre; ripple = `sin(r*40 - t*12)`; glitch = random rows (`hash(row, time)`) shifted sideways; chromatic aberration = R/G/B sampled at slightly different UVs. Colour grading gives each era its look. |
| 2 | **Phosphor reveal-ink** | `shaders/labShaders.js` → `createRevealInkMaterial` | `uLightPos`, `uLightDir`, `uOn` = the flashlight, every frame | For each pixel: vector light→pixel, compare its angle with the beam direction (`dot`), `smoothstep` between the cone's inner/outer cosines → only pixels *inside the flashlight cone* glow. A surface's visibility depends on game state per-pixel — impossible with built-in materials. JS runs the same cone test to know when a mark has been "read". |
| 3 | **Time Machine force field** | `shaders/forceField.js` | `uTime`, `uCores` (0→3), `uUnstable` | **Vertex**: push each vertex along its normal by scrolling 3D noise → the bubble wobbles; wobble shrinks as cores return. **Fragment**: Fresnel rim (`1 - |dot(view, normal)|`) → see-through centre, glowing edge; hexagon grid + upward scan band; colour lerps broken-red → restored-gold with `uCores`. |
| 4 | **Energy barrier / containment / rift** | `shaders/labShaders.js` → `createBarrierMaterial` | `uActive` (pulse cycle / power), `uDissolve`, `uWarn` | **Vertex**: travelling sine + noise ripple along the normal. **Fragment**: hex lattice, flowing fbm energy, edge glow, Fresnel; **dissolve** = `if (noise < uDissolve) discard;` with a hot rim at the boundary, so the wall burns away instead of popping. Same shader drives the Future's barriers, the lab's containment field and the rift. |
| 5 | **Procedural sky** | `shaders/sky.js` | `uTime`, `uFlash` (lightning), per-era preset uniforms | Per pixel we know the *view direction*: gradient from `dir.y`, sun disc from `dot(dir, sunDir)`, clouds by projecting the direction onto a plane (`dir.xz / dir.y`) and scrolling fbm, stars from hashing a quantised direction, nebula from two fbm layers. `gl_Position = p.xyww` pins it to the far plane. The same dome is rendered into a PMREM cube map → it also **lights** the scene (image-based lighting). |

## Supporting shaders

| # | Shader | File | Notes |
|---|---|---|---|
| 6 | Temple pool water | `shaders/water.js` | Our GLSL inside three's `Reflector`: projective lookup of the mirrored render (`texture2DProj`), ripple normal from the gradient of two scrolling fbm layers, Fresnel mix with deep-water colour, sun glint, manual exp² fog. |
| 7 | Interactive grass | `shaders/grass.js` | One `InstancedMesh` (thousands of blades, one draw call). **Vertex**: bend ∝ height², wind gusts from noise at the blade's world position, blades pushed away from `uPlayer`. **Fragment**: root→tip gradient, back-lit translucency, fog. |
| 8 | Flame billboards | `shaders/effects.js` → `createFlame` | Quad corners added in *view space* so it always faces the camera; teardrop mask eaten by upward-scrolling fbm; colour ramp by intensity. |
| 9 | Particles (fireflies, dust, embers, data, mist) | `shaders/effects.js` → `createParticles` | `THREE.Points`; each particle has a random `aSeed` attribute; the vertex stage moves it on a looping Lissajous path — the CPU never touches particles after creation. `gl_PointCoord` makes round glows. |
| 10 | Light beams (sun-mirror puzzle, lasers, core pillars, lion fountains) | `shaders/effects.js` → `createBeam` | `|dot(view, normal)|^k` makes a plain cylinder read as a soft volumetric shaft from any angle; noise scrolls along `uv.y × length` so energy flows. |
| 11 | Floor reflection overlay | `shaders/labShaders.js` → `createFloorReflection` | Reflector render added on top of the normally-lit floor, scaled by Fresnel and broken up by the tile normal map → wet/waxed floor. |
| 12 | Rain on glass + lightning | `shaders/labShaders.js` → `createRainGlassMaterial` | Grid cells each may hold a drop sliding down (`fract(y − t·speed)`) with a trail; static beads; `uFlash` from the lightning timer. |
| 13 | CRT / hologram screens | `shaders/labShaders.js` → `createScreenMaterial` | `uPower` fades from static noise to content; scanlines, rolling refresh bar, flicker, jitter; additive "holo" mode for the Future's billboards. |
| 14 | Procedural city | `shaders/neonShaders.js` → `createCity` | One instanced box mesh; windows invented in the fragment stage from world position → floor/column grid → hash decides lit/colour/flicker; neon roof trims. No textures. |
| 15 | Synthwave grid | `shaders/neonShaders.js` → `createGridFloor` | `fract()` grid lines with `fwidth()` for constant-width antialiased lines, scrolling, distance fade. |
| 16 | GPU traffic | `shaders/neonShaders.js` → `createTraffic` | Per-instance `aLane` attribute; the vertex stage moves cars with `mod(time × speed + offset, length)`. Head/tail lights chosen per vertex. |
| 17 | Phase dissolve (injection) | `shaders/neonShaders.js` → `phaseMaterial` | Keeps three's full PBR lighting but patches its GLSL with `onBeforeCompile`: world position → `noise > uPhase ⇒ discard`, neon rim added to `totalEmissiveRadiance`. The level animates `uPhase` on a timer and removes the platform from the walkable list while it's gone. |
| 18 | Starfield dome (Future) | `shaders/neonShaders.js` → `createStars` | One `THREE.Points` on a dome inside the camera's far plane; a raw ShaderMaterial ignores scene fog, so the sky keeps its depth behind the haze. Per-star `aSeed` drives size class, twinkle rate and warm/cool tint; the vertex stage does all animation (`sin(uTime·rate + seed)`), `gl_PointCoord` softens the sprite. Hundreds of stars, one draw call, zero CPU per frame. |
| 19 | Distant city lights (Future) | `shaders/neonShaders.js` → `createDistantLights` | One `THREE.Points` annulus of hovering beacon glows between the towers; a per-point `aColor` attribute picks the city-window palette, `aSeed` paces each lamp's slow pulse in the vertex stage; the fragment stage layers a wide halo over a tight core so points read as lamps, not dots. Size attenuation `300/-mv.z` shrinks them with distance for free. |
| 20 | **Time Machine warp ripple** | `shaders/warpRipple.js` | Flat ring on the ground around the dais — the machine's state as a visible shockwave. **Vertex**: a travelling swell `sin(r·k − t·s)` lifts the ring, amplitude grows with `uCharge`. **Fragment**: `fract(r·k − t·s)` sawtooth bands (sharp front, soft trail) expand outward through a radial envelope + slow angular wobble; a faint idle pulse otherwise. Game state: `uCharge` ← era-transition warp ramp (`setWarp` from the level manager), restoration progress, prologue overload; `uCores` shifts crackling-red → restored-gold like the force field. One draw call, no textures/noise — pure `sin`/`smoothstep`. |
| 21 | Holographic checkpoint beacons (Future) | `shaders/beacon.js` → `createBeaconMaterial` | Two crossed additive quads per checkpoint: soft pillar body, bright rims, drifting scan lines, one slow idle sweep; `uPulse` (fired by the level when a checkpoint is earned) flares the whole pillar and races a bright ring up it — the timeline visibly "remembers". |

## Likely marker questions (and short answers)

- *Why a ShaderMaterial and not a built-in one?* Built-in materials can't make visibility depend on the flashlight
  cone, can't move vertices with noise, can't dissolve with a burning edge, and can't post-process the frame.
- *What's the difference between a uniform and a varying?* Uniform: same value for the whole draw call, set from JS.
  Varying: computed per vertex, interpolated per pixel.
- *How is the shader tied to game state?* `uWarp`/`uGlitch` ← level manager (transitions, stability),
  `uOn/uLightPos/uLightDir` ← player flashlight, `uCores` ← Time Machine sockets, `uActive/uDissolve` ← barrier timers
  and power, `uPhase` ← platform cycle, `uPlayer` ← player position (grass), `uCharge` ← era-jump warp / restoration
  (Time Machine ripple), `uPulse` ← checkpoint earned (beacons).
- *Performance?* Instancing (grass, city, traffic, leaves) keeps draw calls low; particles and traffic animate on the GPU;
  stars and distant city lights are one GPU-animated `Points` draw each and also scale down on Low quality;
  reflections render at ⅓–½ resolution and are off on Low quality.
