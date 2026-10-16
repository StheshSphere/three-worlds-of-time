# FINAL ENHANCEMENT REPORT — VERIFIED BUILD
## Water reflection · Cinematic close-up · Audio-driven lip sync · Camera return

**The Three Worlds of Time — The Broken Hourglass**
Deliverable: `Three_Worlds_of_Time_VERIFIED_Water_LipSync_Camera_FINAL.zip`

This build answers your report that four things were not working when you played the previously
delivered ZIP. I investigated **the ZIP itself** (not just the dev workspace), found one real
code-level defect — the exact one that could remove Ari's reflection from the pool — fixed it, and
then re-verified all four behaviours by playing **a fresh extraction of this package** the way you
do: serve it locally, normal player camera. Nothing else was rebuilt or redesigned. Voices were
**not regenerated, not re-pitched, not shortened**; dialogue text, levels, puzzles, controls
(sprint / jump / sprint-leap), checkpoints, saves, statistics and every other shader are untouched.
**Nothing was committed, pushed or merged to GitHub.**

---

## 1. What you reported, and what I found in the delivered ZIP

### 1.1 "Ari has no recognisable reflection in the Level-1 water" — real defect, found and fixed

**Root cause (confirmed in the delivered code):** `src/shaders/water.js`, function `setQuality()`.
The quality preset is stored in the browser per origin. At the **Low** preset the function swapped
the pool surface to a material **without the mirror pass at all** — the reflection stopped being
rendered. Anyone whose browser had ever stored the Low preset (or whose machine fell back to it)
would see exactly what you described: no recognisable reflection, while everything else about the
water still looked right. The old report even stated this as intended behaviour ("Low skips the
mirror pass") — that is the mistake that shipped, and it is corrected now.

**Fix:** the mirror render now **always runs at every quality tier**. Low renders it into a 0.4×
viewport-sized target instead of dropping it; Medium 0.5×, High 0.7×. The dead low-tier
"procedural sky" stand-in path (a 1×1 dummy texture) was removed. This is the only functional
change in the whole package (see §6).

### 1.2 "No close-ups · no lip movement · camera did not return" — cannot be reproduced as code faults

All three behaviours are present in the delivered ZIP, correctly connected, and demonstrably run
in a clean test of that ZIP (§3–§5). I found no code defect behind them. The most plausible single
explanation for all three appearing dead at once on your machine is that **your browser was still
running game modules from an earlier ZIP**:

- every ZIP you tested was served from the same origin (`http://localhost:8000`); browsers cache
  ES modules hard, and a normal reload does not guarantee they are re-fetched;
- the cinematic close-up and lip sync arrived with newly-added module files (`src/core/cinematic.js`,
  `src/core/visemes.js`) that an older cached `main.js` never imports — so an old cached module
  graph plays the old game, with none of the new features, while everything else looks normal.

I cannot prove what your browser had cached, so I state this as the most likely cause, not a fact.
§7 shows the 30-second procedure (a **fresh port**) that makes stale modules impossible when you
test this ZIP — please use it before judging this build.

---

## 2. How each behaviour works (unchanged from the previous build, for reference)

**Water** — a true second render pass: the pool is a three.js `Reflector` (a live mirrored
camera render of the real scene) re-shaded by our custom water shader — no static image, no
silhouette, no shadow substitute. Fresnel mix `0.40 + 0.60·pow(1−cosθ, 2.4)` keeps her mirror
image readable from the gameplay look-down angle; wave normals wobble the mirror lookup; the
turquoise depth colouring, caustics, shoreline rim, sun glint, fog, wade rings and jump/land
splash particles are all preserved.

**Cinematic close-up** — `src/core/cinematic.js`, updated once per frame from the render loop.
Engages only when the caption on screen is an Ari line **and** that line's voice recording is the
one actually playing. Smoothly blends (k=5/s) to a front ¾ close-up (FOV 42°, 2.1 m from a face
anchor); candidate angles are collision-tested against the same colliders the player camera uses;
if every angle is blocked the shot is dropped and the gameplay view remains. The gameplay pose is
captured once and never overwritten while held; consecutive Ari lines keep one stable view. On
release (0.8 s after the voice ends, or immediately when the line is advanced) the camera eases
back (k=6/s) to the saved pose — chasing the live camera if the player already resumed control.
Narrator and Prof. Adeyemi lines never trigger it; cutscenes keep their own cameras.

**Lip sync** — the mouth is driven by the **real audio playhead**, not by text timing guesses:
`ms = (voiceTime() − 0.08 s decoder calibration + 0.04 s smoother lead)·1000` indexes a
per-line precomputed viseme event stream in `src/core/visemes.js` (29 lines; generated from the
shipped audio itself by `tools/generate-lipsync.py`). Visemes: M/B/P pressed, A/AH open, E/EE
wide, O/OO round, F/V lip-teeth, S/Z teeth close, W/U protrude, silence rest — applied to five
runtime-injected morph targets on the actual head mesh (`src/character.js`; the model ships with
no jaw bone and no morphs, so the rig is built at load). When the voice ends or is interrupted the
voice record clears and the mouth closes fast. Ari is never seen mouthing after her voice stops.

---

## 3. How I verified it (you asked for the real game, not a debug camera)

Every check below was executed in a **headless Chrome playing the game through the ordinary
player flow** — boot the title screen, **trusted click on PLAY**, advance the opening story with
Enter, then play with the **normal third-person camera** (no debug camera at any point):

1. Extraction: the ZIP was extracted into a **fresh empty directory** and served on a **fresh port
   no previous session had used**, so nothing could come from a cache.
2. The hero was then placed at the temple court with the game's own state (a scripted stand-in for
   walking there — pointer-lock mouse-look makes scripted walking unreliable headless). From that
   moment everything is real: the courtyard trigger fires, the tutorial card shows, Ari's line
   plays through the real audio system, the close-up engages, the caption and Enter-advance work.
3. While she spoke, an in-page recorder sampled the **actual morph-target influences** and
   `audio.voiceTime()` every 40 ms (386 samples across the 7.752 s line in the delivered-package
   run). Timing analysis runs
   afterwards in Node against the shipped viseme timeline (`analyze.mjs`), comparing the observed
   mouth motion with the timeline indexed by the audible playhead.
4. A second line was played to its **natural end**, then a third was **interrupted mid-speech
   with Enter**; the camera pose was compared against the settled gameplay pose in both cases.
5. Finally the hero was placed standing in the pool and the same camera framed her **together with
   her reflection**, at Medium and at Low quality, on the shipped game (screenshots below).

What is simulated, honestly: headless Chrome cannot grant pointer lock, so the lock-success event
is dispatched synthetically (the state a real browser reaches automatically); everything else —
click, Enter, trigger, voice, camera — is the real thing. The complete raw sample log ships as
`verification/realflow-log.json`.

---

## 4. Results — each of your required tests, with evidence

Evidence files are in the `verification/` folder of the ZIP.

| # | Your required test | Result | Evidence |
|---|---|---|---|
| 1 | Ari **and** her recognisable reflection together, normal camera | Pass — her mirrored figure (hair, cream outfit, posture) is visible in the water below her, live (it moves with her), at Medium **and** Low | `realflow-water.png`, `realflow-water-low.png` |
| 2 | Camera framing her **face** during a spoken line | Pass — close-up engaged automatically when her voice started (blend factor reached 1.0); face + ARI caption in frame | `realflow-closeup.png` |
| 3 | Her mouth **changes shape** during speech | Pass — mouth-open captures at openness **0.56–0.86** vs mouth-closed captures at **0.00–0.05** (delivered-package run: 0.65 / 0.65 / 0.56 / 0.65 open vs 0.00 / 0.00 closed; same framing, measured from the real morph weights) | `realflow-mouth-open-0…3.png`, `realflow-mouth-closed-0…1.png` |
| 4 | Lip-sync timing against **her actual audio** | Pass — mouth motion vs the audible playhead timeline: correlation **r = 0.83–0.87, always at best lag 0 samples (0 ms)** over three full runs (delivered-package run: r = 0.847); 96–99 % of speech frames moving; full numbers in §5 | `realflow-log.json` (386 raw samples) |
| 5 | Mouth **closes when the voice finishes** | Pass — at natural end: voice null, mouth open **0.000**; at most 2 of ~875 sampled moments in any run (delivered-package run: 1 of 874) had any opening while silent — always a single ≤80 ms decay pair right after the deliberate mid-line interruption; interruption: voice cut, mouth sealed within one sample | `realflow-log.json`; `realflow-interrupt-mid.png` |
| 6 | Camera **returns to the original gameplay view** | Pass — after both the natural end and the interruption the camera pose equalled the settled gameplay pose exactly: **Δposition 0.000 m, orientation dot 1.000** | `realflow-return-before.png` / `realflow-return-after.png`; log |

Console/network: the game itself produced **zero errors**; the HTTP server log shows **zero**
failed requests during the whole session (one intermittent, URL-less Chrome-internal console line
that also appeared in earlier sessions is environmental and matches no request to the game server).

---

## 5. Lip-sync numbers in detail (line `ari-plates`, 7.752 s)

- Sampled frames while she spoke: **386** in the delivered-package run (387 in the rehearsal),
  every 40 ms, real morph weights + `voiceTime()`.
- Mouth openness peaked at **0.89** during the line; **347 distinct** weight combinations — the
  motion is continuously shaped, never a repeating on/off.
- Alignment against the **audible** timeline: best lag **0 samples (0 ms)** in every run,
  correlation **r = 0.83–0.87** (delivered-package run: r = 0.847; two earlier full runs:
  0.865 / 0.831). The ±50 ms target is met with a half-frame margin.
- Speech recall (frames with expected movement that moved): **98.0 %** (196/200) in the
  delivered-package run; 96.1–98.5 % across runs. Quiet-frame stillness: **71.0 %** (132/186) in
  the delivered-package run; 71–76 % across runs — the residual is the ~35–40 ms smoothing ease
  between shapes across very short pauses, not random opening; from silence the mouth stays
  exactly closed until the first audible word.
- While silent: **1 of 874** sampled moments had any opening in the delivered-package run (0–2
  across runs) — always inside a ≤80 ms decay immediately after the interruption test cut the
  voice short; by design the mouth closes fast but not within a single frame.

---

## 6. Files — exactly what changed, and proof of what is inside the ZIP

**Functional change in this build, vs the previously delivered ZIP — one file:**

| File | Change |
|---|---|
| `src/shaders/water.js` | Mirror now renders at **every** quality tier (Low = 0.4× target instead of "no reflection"); removed the dead low-tier stand-in path |

**Documentation files updated (no gameplay impact):**

| File | Change |
|---|---|
| `FINAL_ENHANCEMENT_REPORT.md` | This report (replaces the previous one, incl. its incorrect "Low skips the mirror" claim) |
| `docs/SHADERS.md` | One sentence corrected: the pool mirror always renders; the lab-floor reflection follows the quality preset |
| `ENHANCEMENT_CHANGES.md` | Two historical statements marked as superseded by this build (the mirror is no longer skipped on Low) |

**Everything else in the ZIP is byte-identical to the previously delivered ZIP** — verified by a
recursive diff of the two extracted trees (291-file game tree).

**Tested-then-shipped:** the game tree inside this ZIP was extracted again after packaging and
played end-to-end (the run whose numbers this report quotes). A byte-level diff between that
tested extract and this ZIP confirms every **game** file is identical — the single documented
exception is this report file itself, whose numbers were completed from that test's own log after
the run. No game code was touched after testing.

The feature code you asked me to confirm is inside the ZIP — verify yourself on your extraction
(Windows: `certutil -hashfile <file> SHA256`):

| File (in `three-worlds-of-time-main/`) | SHA-256 (first 16 chars) |
|---|---|
| `src/shaders/water.js` (the fix) | `ad9fbc7f4124233e…` |
| `src/core/cinematic.js` (close-up + lip-sync driver) | `fcf37c27570385de…` |
| `src/core/visemes.js` (audio timing data, 29 lines) | `dd055b8a0e1493bb…` |
| `src/character.js` (mouth rig on the head mesh) | `dd55cccafccc7d29…` |
| `index.html` | `4159aaaedd0fb803…` |

---

## 7. How to run and test it yourself (please read — this rules out stale caches)

```bash
# 1. extract this ZIP into a NEW, empty folder (not over an old extraction)
# 2. from the project folder:
python3 -m http.server 8017        # use a port you have NEVER used before
# 3. open:
http://localhost:8017               # never file://
```

A port never used before = a new browser origin = an empty cache for the game; nothing from any
earlier ZIP can leak in. If you prefer to stay on port 8000: open the page and hard-reload with
**Ctrl+Shift+R** (or keep DevTools open with "Disable cache" checked for the whole session).

Where to look: walk toward the temple courtyard until ARI speaks — the camera eases into a
close-up of her face while the voice plays and returns to your normal view when the line ends
(Enter skips; the picture returns immediately). Stand in the temple pool and look down — her
reflection is there at every quality tier. If anything still misbehaves on a fresh port, open the
browser console and send me what it says; with a fresh origin we would finally be looking at the
same build.

---

## 8. Tests performed — and tests I could not perform (stated plainly)

**Performed, on a fresh extraction of this package:** all six checks in §4 — real play flow with
trusted click, real audio, real camera; synchronous capture of morph weights + audio clock; and
the packaging diff/hash checks in §6. Repo checks re-run green: `node tools/test-integration.mjs`
(36/36), `node tools/test-audio.mjs` (4/4), `python tools/build-release.py --check` (PASS).

**Not performed — do not count these as verified by me:**

- A human, windowed-browser playthrough with a real mouse and speakers — all my runs are automated
  headless Chrome; pointer lock there is synthetically granted (disclosed in §3).
- Firefox and Safari — not exercised.
- The close-up's all-angles-blocked fallback — no blocked case occurred at the test location, so
  the fallback branch was not observed running.
- Close-up/lip-sync in the Modern Lab and Neon Future eras in **this** round — the Past-era flow was
  re-verified end-to-end here; the Lab/Future variants were verified in the previous round's harness
  and are unchanged (their code paths are the same module).
- Audio **decode-failure** and autoplay-block branches — present in code, not triggered.
- Frame-perfect 60 fps behaviour: sampling was every 40 ms; on a much slower machine the smoother
  shifts a few ms (the 40 ms lead already compensates the measured lag).

— End of report. One ZIP, nothing else. No GitHub commit or push.
