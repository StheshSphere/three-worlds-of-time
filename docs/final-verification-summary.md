# Final verification summary

**10 October 2026 · Member 4 · feature/04-final-integration-release**

**PASS** means the described check actually ran. **FAIL** identifies a demonstrated mismatch. **NOT VERIFIED** means there is no executed evidence for that scope. A logic PASS never substitutes for the real-browser column.

| Executed check | Result |
|---|---|
| Node gameplay/controller/UI/cleanup suite | **PASS — 19/19**, real project code with renderer/DOM/audio doubles and fallback meshes |
| Node audio lifecycle/routing suite | **PASS — 4/4**, real AudioManager/Three audio classes with a deterministic Web Audio double |
| Source syntax / static import and asset graph | **PASS — 30 source JS modules, 48 imported runtime modules**, exact case and relative paths |
| Release ZIP root/integrity/dev-file exclusion | **PASS — 180 files**, root index.html; no tools, docs, npm packages, caches or Git metadata |
| Independent extracted release over HTTP at /game/ | **PASS — 180/180 files**, HTTP 200, exact bytes and JavaScript MIME |
| GLB dependencies | **PASS — 33 models**, embedded or existing relative dependencies |
| Preservation of inherited assets | **PASS — 125/125 original asset files byte-identical** |
| Browser progression runner | **NOT VERIFIED — prepared, not successfully run** |
| Real browser, GPU/FPS and LAMP | **NOT VERIFIED** |

Raw evidence in the source ZIP: `docs/verification/logic-results.json`, `audio-results.json`, `release-results.json`, `build-results.txt` and `release-sha256.txt`. The browser executable exited before opening a page; the cloud browser could not access localhost. No screenshots, browser performance measurements or hosted results are fabricated.

## Mandatory acceptance criteria

| # | Criterion | Executed code/file evidence | Real browser |
|---|---|---|---|
| 1 | Launch via HTTP; no critical console errors | PASS files/imports; console execution untested | NOT VERIFIED |
| 2 | Start/play menu | NOT VERIFIED main menu flow | NOT VERIFIED |
| 3 | WASD/mouse/Space/Shift/interactions | PASS jump, fall/landing, dash collision and input clearing; full input set untested | NOT VERIFIED |
| 4 | V camera switch | PASS both modes and yaw preservation; physics-only camera wall | NOT VERIFIED |
| 5 | Ancient puzzle completable | PASS plate/mirror/tablet/drum/core state flow via debug shortcuts | NOT VERIFIED |
| 6 | Ancient core → 1/3 | PASS core count and HUD text | NOT VERIFIED |
| 7 | First transition; Ancient audio ends | PASS era transition, Lab track selection; separate audio disposal tests | NOT VERIFIED |
| 8 | Keycard/flashlight/note/BLUE→RED→GREEN | **FAIL against literal older specification:** keycard/breaker variant absent. PASS supplied logs/flashlight/reveal/keypad/conduit logic | NOT VERIFIED |
| 9 | Lab power visuals | PASS power/field state; visual effect untested | NOT VERIFIED |
| 10 | Lab checkpoint/respawn | PASS checkpoint and restored position | NOT VERIFIED |
| 11 | Lab core → 2/3 | PASS progression/core count | NOT VERIFIED |
| 12 | Volume/mute | PASS master/music/SFX bus routing with Web Audio double; buttons/audibility untested | NOT VERIFIED |
| 13 | Future transition | PASS index, core count, track and flashlight cleanup | NOT VERIFIED |
| 14 | Future movers/barriers/hazards | PASS mover state changes, barrier/phase presence and checkpoint logic; timed traversal/damage fairness untested | NOT VERIFIED |
| 15 | Future checkpoint/fall | PASS fall returns to checkpoint | NOT VERIFIED |
| 16 | Custom shaders | PASS JS/import packaging; GLSL compile/render untested | NOT VERIFIED |
| 17 | Final core → 3/3 | PASS sequence lock refuses early core, accepts solved core, HUD 3/3 | NOT VERIFIED |
| 18 | Restoration/victory | PASS restoration flag and level-manager won state; main epilogue/credits/win UI untested | NOT VERIFIED |
| 19 | Restart without refresh | PASS puzzle/core/checkpoint/flashlight/dash reset and camera preference; audio lifecycle tested separately | NOT VERIFIED |
| 20 | Pause/options/credits/controls | PASS input clearing, duplicate-panel guard and keypad callback cleanup; complete UI flow untested | NOT VERIFIED |
| 21 | Both camera modes | PASS accelerated progression in both configured modes | NOT VERIFIED |
| 22 | No missing assets/critical exceptions | PASS asset graph and HTTP bytes; browser decode/runtime exceptions untested | NOT VERIFIED |
| 23 | Stable repeated gameplay/restarts | PASS repeated ownership/positional counts and bounded audio tails; FPS/GPU/heap trends untested | NOT VERIFIED |

The Lab mismatch is inherited from the authoritative uploaded main, not introduced by Member 4. Its working investigation/keypad/conduit puzzle has been preserved. Confirm that this newer variant is acceptable to the course if the older checklist is applied literally.

## Remaining browser acceptance

Using the **separately extracted release**, perform one normal complete route in third-person and one in first-person (use Options for the starting view), then repeat transitions/restarts three times. Keep Console/Network open.

- Verify mouse capture, keyboard movement/sprint/jump/dash/E, camera switching near walls, moving-platform landings and fair hazard contacts.
- Complete Ancient blocks/mirrors/tablets/drums; Lab logs/flashlight/reveal/keypad/conduit/containment; Future platforms/barriers/collapse/sequence lock. Avoid debug shortcuts for these route checks.
- Observe cores and objectives at each transition, checkpoint respawns, restoration, epilogue, credits, win and restart.
- Open/close notes and keypad, pause/resume repeatedly, hold a movement key while changing focus, deny pointer lock once, visit every menu, and confirm recovery without stuck input.
- Listen for the outgoing era fading away, missing/duplicate loops, positional falloff and master/music/effects/mute controls.
- Check title/loading/HUD/panels at 1920×1080, 1366×768 and a narrow/short window. Inspect bloom, water/floor reflections, force fields, reveal ink, grass and Future effects.
- Record hardware, resolution and quality. After warm-up, collect actual FPS/frame-time and renderer memory at matching points over repeated runs. Do not label cached assets as leaks merely because they remain allocated.

Full build, optional assertion-runner, Moodle/LAMP and safe Git commands are in the source ZIP's `docs/RELEASE-INSTRUCTIONS.md`. Upload only `three-worlds-of-time-lamp-release.zip` through the course route, then repeat the checklist on the published URL. **Deployment has not occurred.**

The source/asset audit also retains one unresolved permission item: Paul Kellett's pink-noise filter. See `docs/ASSET-AUDIT.md`; do not claim the attribution audit is fully cleared.
