# Team guide — levels, solutions, and what to say in the demo

## The one-sentence answers (brief §12: "say in one sentence what each level introduces")

- **The Past (Solve):** the world itself is the puzzle — you physically push stone, steer sunlight with mirrors and decode carvings.
- **The Present (Investigate):** you win with information — a flashlight whose beam reveals invisible ink, logs, a keypad code and a power-routing puzzle that relights the whole lab.
- **The Future (Survive):** a new ability (the Chrono-Dash) and a timing gauntlet — moving and phasing platforms, barriers you dash through, lasers and a collapsing bridge chased by a rift.

## Story beats

A student inventor's homemade Time Machine overloads during Field Test 7 and flings its three cores across time.
Same location, three eras: the temple (Past) → the Chronos lab built **on top of** the temple — you can see the
temple stones through a glass floor panel (Present) → the neon city of 2187 (Future). Each era's core lights a socket
on the machine; the hero's hourglass pack fills with sand as cores return; the finale restores the machine.

## Level walkthroughs (solutions)

### I · The Past — `src/levels/ancientRuins.js`
1. **Courtyard of Weights.** 2 m grid; walk *into* a block to slide it one tile. Plates are on the north row (columns
   3 and 6 from the left). One solution: block A → push east once, north four times, then west once onto its plate;
   block B → west once, north three times, east once. Deadlocked? Use the **sun stone** by the entrance to reset.
   Both plates down → the Sun Gate sinks into the floor (checkpoint).
2. **Sun Court.** The sunbeam enters through the round window in the west wall. Rotate (E) the mirrors so the beam goes
   east → north → east → north into the crystal by the chasm (the north-east mirror is a decoy). Lit crystal → the
   floating stone bridge assembles.
3. **Tablets.** Three carved tablets (behind the reflecting pool; north-west corner of the courtyard; east alcove of the
   Sun Court). Each shows a glyph and a numeral (I/II/III) — recorded in the journal (J). **Randomised every load.**
4. **Sanctum.** Turn drums I, II, III to the glyphs of hours I, II, III → the Ancient Core rises. Take it.

### II · The Present — `src/levels/modernLab.js`
1. Read the **incident log** (laptop on the east workbench near the windows).
2. **Office (west):** take the **flashlight** (F toggles), read Prof. Adeyemi's laptop and the chalkboard.
3. **Archive (north, pitch dark):** sweep the walls slowly with the flashlight — four phosphor-ink marks show a digit
   and 1–4 dots (= position). Decoy scribbles too. **Randomised every load.** Each read mark goes into the journal.
4. **Keypad** at the end of the Archive: enter the 4 digits in dot order. Wrong code = −15 s stability.
5. **Power room:** rotate the 3×3 conduit tiles so power flows GRID IN (left, middle row) → VAULT OUT (right, middle row).
   Solution path: middle-left ↑, top-left →, top-middle →, top-right ↓, middle-right →.
6. **Power on** → lights cascade on, screens wake, the vault (east of the hall) opens. Use the console to drop the
   containment field, take the Lab Core.

### III · The Future — `src/levels/neonFuture.js`
1. **Dash gap** — too wide to jump: sprint, jump, press **Q / right-click** in the air.
2. **Moving platforms** (they carry you). 3. **Phase platforms** — they dissolve in a wave; go when the next is solid.
4. **Gauntlet** — barriers pulse on/off; **dashing phases you through** even when they're on; jump the sweeping lasers.
5. **Collapse run** — tiles fall ~0.4 s after you step on them and the rift chases you; don't stop. Take the Neon Core
   on the spire → finale.

Checkpoints after each section. Falling costs 12 s; shocks 6–10 s.

## Systems everyone should be able to explain

- **Hierarchical modelling:** `timeMachine.js` (dais → clock face → hands; gimbal → ring → ring → ring → heart → light)
  and `character.js` (hourglass pack and gauntlet parented to the skeleton's bones).
- **Cameras:** third-person orbit with collision pull-in, first-person (V), orthographic minimap rendering only layer 2.
- **Lighting:** shadow-mapped sun that follows the player (texel-snapped), image-based lighting from each sky,
  point/spot lights, a shadow-casting flashlight, emissive + bloom.
- **Physics:** gravity, jump with coyote time and buffering, AABB circle-vs-box walls, ground raycast, moving-platform
  carry, push-blocks.
- **Fail/succeed:** timeline stability per era (runs out → era collapses → rewind), falls, hazards, checkpoints.
- **Disposal:** everything a level creates goes through `kit` and is disposed on unload; GPU memory stays flat.

## Suggested demo split (match the ownership in AGENTS.md)

| Person | Demo + questions |
|---|---|
| 1 | The Past: block grid logic, mirror beam tracing (axis-aligned ray marching + reflection formula), randomised rune code |
| 2 | The Present: reveal-ink shader + cone test, keypad flow, conduit graph search (DFS over tile connection bitmasks), power-on sequence |
| 3 | The Future: dash, moving/phase platforms, barrier timing + dash phasing, laser hit test, collapse/rift |
| 4 | Player controller, cameras, Time Machine hierarchy, hero animation blending, level manager & disposal |
| 5 | Post-processing (bloom + time-warp pass), sky shader, UI/HUD/menus, audio, deployment build |

## Handy console commands (Chrome DevTools, while playing)

```js
__game.skipTo(1)                    // jump to an era (0, 1, 2)
__game.levels.debug                 // per-level shortcuts, e.g. .solveBlocks(), .alignMirrors(), .solveGrid()
__game.settings.set('showFps', true)
```
