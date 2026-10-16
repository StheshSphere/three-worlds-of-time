# ENHANCEMENT_CHANGES — Human Voices + Realistic Reflective Water

Scope: this build changes ONLY (1) the voice acting and (2) the Level 1 water
rendering, plus test/verification tooling. Gameplay, levels, puzzles, controls,
dialogue scripts, checkpoints, statistics, ending and lighting are untouched.

---

## 1. Voice acting — natural, emotional performances

### Engine and voices
Edge neural TTS (edge-tts, MIT-licensed tool) regenerated the entire script —
all 29 lines — with the most expressive voices the engine offers. No cloned or
unauthorised voices; everything is a stock Microsoft neural voice:

| Role | Voice (new) | Character |
|---|---|---|
| Ari | `en-US-AvaMultilingualNeural` | Expressive, Caring, Pleasant |
| Narrator (opening/closing only) | `en-US-AndrewMultilingualNeural` | Warm, Confident, Authentic — storyteller register |
| Prof. Adeyemi | `en-US-EmmaMultilingualNeural` | same “Emma” identity, newer, more natural model |

### Performance model (not one flat render per line)
`tools/generate-voice.py` now renders each line as several **performance
segments**, each with its own rate, pitch and volume, then joins them with
expressive silences (hesitation 240–520 ms, interruption 80–160 ms). 29 lines →
**73 segments**. Silences are energy-trimmed per segment and gap-joined; the
result is encoded to one mp3 per line with the **same filename** the game
already loads (no runtime code change).

Examples of punctuation interpreted as acting (text unchanged on screen):
- `"...No — WHEN am I?"` → groggy low whisper (−12% rate, −8 Hz) → startled
  "No —" (+5%) → disbelief "when am I?" (+10 Hz); the whole line's loudness
  nearly doubles from head to tail.
- `"A hundred and twenty… a hundred and FORTY?! Shut it down — shut it DOWN!"`
  → calm counting → shocked question (+11%, +13 Hz) → urgent shout (+15%/+24%)
  → full shout (+16%/+26%); head-to-tail RMS rises ~15%.
- `?` lines are rendered with rising intonation (pitch offsets), `…` with real
  pauses, `—` as an interruption, `!` with genuine projection (volume up).

### Preserved dialogue behaviour (verified unchanged)
Enter/click advancing, immediate stop on advance, no overlap, music ducking,
Ari-only female voice, narrator only in opening/closing, no spoken cards/
hints/tutorials, 10-second reminder, all audio bundled offline (no network at
play time).

### Voice verification (automated)
- All 29 mp3s decode through the **real in-game asset pipeline** in Chromium
  (Web Audio `decodeAudioData`): 29/29 buffers, durations 2.2–10.4 s.
- `playVoice` → source starts; `stopVoice` → stops; second line starts clean.
- Loudness-dynamics check on the actual encoded files proves the emotion is in
  the audio, not just in the parameters.
- **Limitation (disclosed):** verification is measurement-based; I cannot
  listen to the audio, so subjective “sounds like a real person” quality rests
  on the voice choices and the prosody design above, not on a listening test.

---

## 2. Level 1 water — visibly realistic water

### Root causes found (why it looked like a “dark road”)
1. **Fresnel bias starved the reflection.** `fresnel = 0.08 + 0.92·pow(1−dot,4)`
   meant that from the high third-person camera ~92 % of the pixel was the dark
   water base colour and only a few percent came from the mirror.
2. **Base colour was nearly black** (`0x0d3b3a`) and the mirror image was tinted
   by a dark `0xb9c9c4`, dimming the reflection further.
3. **Low quality replaced the shader** with a static dark `MeshStandardMaterial`.
4. **`sunDir` was passed in but never copied to the uniform** — the sun glint
   was dead code.

### What changed (`src/shaders/water.js`)
- Bright turquoise palette (`uShallow 0x6fd6c4` → `uDeep 0x0e5a68`) with a
  depth gradient from the pool edges to the middle, plus a soft shallow rim
  where water meets the stone rim (shoreline contact).
- Reflection now dominates at grazing angles and stays clearly visible from
  above: `fresnel = 0.32 + 0.68·pow(1−dot,3)`; mirror tint raised to near-white.
- Waves: three scrolling fbm layers drive the normal; the normal perturbs the
  mirror lookup so reflections wobble with the surface.
- Sun glint, sky-tint fallback (`uZenith/uHorizon`), fog preserved.
- **Low quality no longer goes dark**: it renders the same shader with a
  procedural sky reflection (`uUseMirror = 0`) instead of the dark fallback.
  *(Superseded in the VERIFIED build — the pool mirror now always runs at every
  tier; Low renders it into a smaller target. See FINAL_ENHANCEMENT_REPORT.md.)*
- Mirror render target resolution still scales with the quality pixel ratio;
  one mirror render per frame, ripple count bounded (16), pooled particles
  (96), everything disposed on unload.
- `sunDir` is now applied at construction (bug 4 fixed).

### Water verification — real renderer, real gameplay camera
Headless Chrome runs the actual game renderer with the actual third-person
camera (CDP screenshots of composited output). Captures (`$TEMP/twot-shot/`):

| Capture | Result |
|---|---|
| `water-still` | turquoise water with visible moving wave shading + Ari wading — vs the earlier dark flat “road” capture from the same pose |
| `refl-grazing` vs `refl-grazehide` | **Ari’s reflection visible in the water below her feet**; hiding her mesh removes it (pixel diff over the water band: mean 15.65, max 177, 15.1 % of pixels changed) — proves she is rendered into the mirror pass and her reflection is geometry-based, not pasted |
| `water-splash` | landing produces a ripple ring burst + white droplet particles rising off the water |
| `water-low` | Low preset still reads as water (waves, shore rim; since the VERIFIED build the mirror renders too, at a smaller target) |

**Limitations (disclosed):** in-page canvas pixel readback returns zeros
without `preserveDrawingBuffer`, so statistics come from image analysis of the
captured PNGs, not from live-canvas readback; and a headless Chrome session
reports benign `glGetProgramiv: Program object expected` warnings during shader
compilation (rendering itself is correct, screenshots prove it).

---

## 3. Regression testing

All Node suites pass (render/audio doubles):
`test-integration` (0 failures), `test-audio` (0), `test-interactions` (0),
`test-dialogue` (21/21 — one harness double lacked the new `stopVoice` method;
fixed in the test, not the game), `test-jump-controls` (15/15).

Console: a pre-existing shader-warm-up `pageerror` (`...reading 'isReady'`)
appears at level load. **It also occurs in the previous build's ZIP** (verified
by running that build with the same harness), so it is not a regression from
this work; the game continues to render and play normally.

## 4. Not achieved / not verifiable here
- Subjective listening test of the voices (measurement-based verification only).
- Real-laptop FPS measurement (no benchmark run; the design keeps the same
  rendering budget as before: one extra reflection render only at Medium/High,
  where it already existed).
