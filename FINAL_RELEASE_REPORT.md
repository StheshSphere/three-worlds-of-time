# Three Worlds of Time — Final Release

**The Broken Hourglass · 11 October 2026**

The supplied game has been updated in place. The three eras, puzzles, story, cinematics, assets and custom shader effects are retained. This release adds browser-local save/continue and addresses the reported archive, camera, dialogue and rendering issues. Automated logic and static-release checks pass. A full Chrome playthrough and Ubuntu hardware performance measurements remain unverified; this report does not certify a grade or claim those tests passed.

## Implemented fixes

- **Lighting and first-use stalls:** era loading initializes textures and compiles scene materials, including hidden reward materials, behind a loading overlay. The Past's crystal light and bridge slabs are already allocated before activation. The laboratory now keeps its lights mounted and varies intensity, avoiding repeated shader variants as emergency/main lighting changes. The flashlight's spotlight is prepared before pickup. Effects and bridge animation are preserved. These changes address identifiable compilation/allocation paths; actual GPU frame times still require measurement.
- **Archive route:** split the laboratory's decorative north-wall panel across the intended doorway. The corridor opening is clear; the security door's collision remains until the keypad unlocks it. Loading an unlocked door restores both the visible opening and passable collision.
- **Camera:** third-person obstruction checks sweep the full head-to-shoulder path against expanded collision boxes and walkable surfaces. Ceilings have explicit camera blockers. The camera retracts immediately, eases outward and applies shake as rotation. First-/third-person preference and orientation are saved.
- **Reading and skipping:** subtitles, era cards and essential tutorials share one Enter/click queue. They wait for acknowledgement, show the required first-message instruction, then a fresh ten-second reminder on each unadvanced message. Input ownership blocks double advancement and unrelated button clicks. Mandatory reading freezes gameplay hazards and stability loss. A visible skip button and X skip only the current cinematic, preserve critical events and restore controls; repeated rapid skips are guarded.
- **UI and credits:** improved overlay contrast, HUD spacing, panel scrolling and smaller-desktop layout; added save notices and overwrite dialogs. Credits show Raquel de Franca, Sthembile Ndaba, Keitumetse Julius, Lesego Ngobeni and Ntandoyenkosi Nemadozi with the requested title and “DEVELOPED BY” heading. No individual roles were invented.
- **Shader portability and quality:** corrected reversed-edge `smoothstep` expressions using ordered edges and complementary masks. Original shader effects remain. Quality changes now update reflections, shadow settings, grass/city density, stars, distant lights and laboratory transmission promptly; reduced grass counts retain coverage across patches.

## Save and Continue Journey

The title menu offers **New Journey** and **Continue Journey**, with the saved era/checkpoint displayed. Continue is enabled only for a valid save. Pause provides **Save Game** and the separate **Resume** action. Starting over and retrying an era require confirmation. A completed save returns to the completion screen without awarding another core.

The versioned `three-worlds-journey-v1` record uses a separate key from settings. Saves validate structure, ranges, version and essential progression relationships. Invalid or unavailable storage disables Continue with an explanation. Each write is one atomic `localStorage.setItem`; quota/storage failures retain the previous record and show a notice.

| Era | Restored permanent and stable state |
|---|---|
| Past | Layout/clue seed; block positions and plates; gate; mirror orientations and lit crystal; completed bridge with walkable slabs; tablet discoveries; rune-drum positions and solved lock; core ownership; objectives and checkpoint. |
| Present | Seed and code; incident log and discovered hidden writing; flashlight ownership/on state; archive access; all nine power-tile rotations; completed power/vault/containment state; matching door/field collisions; journal, objective and checkpoint. |
| Future | Seed and colour sequence; reached checkpoints and permanent collapse-route completion; partial/final sequence progress; removed containment field; core state. Temporary platforms, lasers and rift animations restart safely from their initial phase. |

All eras also preserve stability, statistics, camera preference, relevant player pose, tutorial/story flags and unread playable dialogue. Restores reconstruct each level and apply its own snapshot to the existing puzzle state. Collected cores remain collected; a save committed during collection resumes at the next consistent era boundary. A solved light puzzle restores a fully formed bridge even if saved during its rising animation.

Autosaves follow objectives, checkpoints and permanent progress, with a debounce and minimum write interval; a periodic save also captures intermediate configurations. Returning to the title and leaving the page attempt a safe save. Invalid transitions, teardown and hurt/respawn windows are excluded. Past/Present resume at a validated grounded pose, falling back to the checkpoint when unsafe. Future always resumes at the last safe checkpoint; temporary movement timing is deliberately not preserved.

**Storage scope:** progress belongs to this browser profile, device and site origin. Clearing site data removes it; changing browser/device or moving between localhost and the hosted site does not transfer it. Closing before a pending autosave finishes can lose the most recent unsaved action; use Save Game and wait for “Timeline Saved” before quitting when exact timing matters.

## Verification performed

| Check | Result |
|---|---|
| `node tools/test-integration.mjs` | **35 passed, 0 failed**. Real controller/era logic with DOM/render/audio doubles: puzzles, transitions, restart, both camera modes, save/restore in all eras, repeat loads, cross-era cores, corruption/storage failures, confirmations, archive/camera collision, stable light count, live quality and reading pauses. |
| `node tools/test-dialogue.mjs` | **21 passed, 0 failed**. Manual advancement, reminders, input isolation, focus/pause, queued tutorials, saved unread instructions, cinematic order/cancellation and critical-event skipping. |
| `node tools/test-audio.mjs` | **4 passed, 0 failed**. Music/ambience lifecycle, effect cleanup and late-unlock disposal using Web Audio doubles. |
| `bash tools/build-deploy.sh` | **Passed:** 50 reachable runtime modules; 182 required production files; syntax, imports, relative asset paths, filename case and ZIP integrity. ZIP publication is atomic after validation. |
| `python3 tools/test-release.py` | **Passed:** independently extracted production ZIP, all 182 files returned exact bytes over HTTP under `/game/`, JavaScript MIME checks, 33 GLB dependency checks, root `index.html`, no development directories. |
| Preservation/package checks | All 237 original project files retained. All 125 original asset files and 23 vendored library files remain byte-identical. Source/deployment archive contents and CRC integrity verified before delivery. |

Machine-readable evidence is in `docs/verification/final-release-results.json`. Older member reports/results are preserved as historical records, not evidence for this release. The optional browser scenario was adjusted to acknowledge persistent help and the new restart confirmation, but was not executed successfully here.

**Unverified:** no local Chrome/Chromium executable was available; the remote browser could not reach the local game. Therefore actual WebGL compilation/rendering, pointer-lock behavior, audible output, screenshots at laptop sizes, complete spatial puzzle traversal, GPU memory across transitions, frame-time/FPS measurements and published LAMP execution were not verified. Object/disposal tests are not a GPU-memory profile. Before submission, play the whole route in Chrome on an Ubuntu lab computer in both camera modes; close/reopen after each era's milestones, exercise cinematic skip and all quality presets, inspect Console/Network, and measure the light-puzzle activation on that hardware. No deployment was performed.

## Rubric coverage and shader demonstration

| Applicable category | Release coverage |
|---|---|
| Viewing — 10% | Retained animated player, minimap and two camera modes; added ceiling/wall obstruction handling and restored camera state. |
| Control & Playability — 10% | Retained movement, sprint, jump, dash, interactions and checkpoints; tested failure/restart and safe restore logic. |
| 3D Effects — 15% | Preserved PBR textures, lighting, shadows, fog, reflections, transparency, particles and post-processing; corrected live preset changes. |
| Custom Shaders — 10% | Preserved time/game-state-driven vertex and fragment effects; corrected non-portable interpolation masks. |
| Gameplay & Experience — 25% | Preserved Solve / Investigate / Survive and all puzzle chains; restored actual accomplishments and removed mandatory-reading time pressure. |
| Polish — 10% | Save/continue, confirmation, loading feedback, persistent instructions, skip controls, credits and responsive panels. |
| Innovation — 10% | Preserved flashlight ink, dash-phasing, the hierarchical Time Machine and one location evolving across three eras. |

Key shaders to demonstrate (full existing guide: `docs/SHADERS.md`):

- **Time warp:** full-frame UV distortion, chromatic offsets, glitch bands and era grading; driven by transition, damage and stability uniforms.
- **Reveal ink:** per-fragment world-space flashlight-cone masking makes hidden text glow only inside the beam; JavaScript performs the matching discovery test.
- **Force field/barriers:** vertex wobble, Fresnel rims, hex grids and noise-based dissolve; core count, power and hazard state change the appearance.
- **Sky/water:** procedural sky colour, sun/clouds/stars; reflected temple water uses projective sampling, ripples and Fresnel mixing. Low quality uses the existing cheaper water mode.
- **Grass/phase platforms:** vertex wind and player displacement in instanced grass; a PBR shader injection discards phase-platform fragments with a glowing dissolve rim, synchronized with walkability.
- **City/particles/beacons:** instanced procedural windows and GPU-driven particles/traffic; checkpoint uniforms produce visible beacon pulses.

Existing resource acknowledgements and bundled MIT/OFL texts are retained. The Paul Kellett coefficient table had uncertain reusable licence evidence, so it was removed from active audio synthesis and replaced with an original simple low-pass noise mix. The historical influence is acknowledged without asserting licence permission. The primary attribution reference remains [MusicDSP](https://www.musicdsp.org/en/latest/Filters/76-pink-noise-filter.html). No new external art/audio assets were introduced; existing project asset provenance is retained rather than represented as a fresh licence audit.

## Run, build and deploy

Extract `Three_Worlds_of_Time_FINAL_SOURCE.zip`, enter its project folder and run:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in desktop Chrome. Use HTTP, not a direct file URL. Development checks need Node 20+ and Python 3.10+; the game needs no runtime Node, database, PHP or package installation.

```bash
node tools/test-integration.mjs
node tools/test-dialogue.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
```

The build creates `dist/` and `Three_Worlds_of_Time_FINAL_LAMP.zip`. The delivered LAMP ZIP is the actual static build: `index.html`, credits, reachable source modules, vendored dependencies, assets and licences are at the correct relative paths, with `index.html` at ZIP root. Upload that ZIP through the course's authorized Moodle/LAMP route, or extract its contents into the assigned web directory without an extra enclosing project folder. Open the published subdirectory URL in Chrome and complete the checks above. No GitHub push or Moodle upload was performed.
