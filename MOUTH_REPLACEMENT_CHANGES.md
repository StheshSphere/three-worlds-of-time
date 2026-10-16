# Ari — Proportional Face and Mouth Correction

## Problem corrected

The earlier game had two mouths: the KayKit character's original painted mouth at approximately `y = -0.40`, and a second, small circular animated mouth placed lower on the chin at `y = -0.545`. The animated mouth looked disproportionately round. An initial attempt to delete the original mouth's six triangles could also leave an actual hole in the face, because those triangles are part of the front skin surface.

## New implementation

- `src/core/mouthRig.js` **neutralises the original lip colouring** by retargeting only eight UV coordinates of the original face's mouth patch to the adjacent skin tone. The original six face triangles and all head/nose/eye vertices are preserved, preventing a hole or changes to the nose.
- **One new mouth** is attached to the original head bone at the original mouth height. It uses a wider (0.564-unit at rest), softly contoured Cupid's-bow upper lip and fuller lower lip, with a dark interior, conditional teeth and tongue. No circular skin-coloured disc is added.
- The new mouth opens into a wide oval, including for O/OO phonemes, rather than an isolated round hole. Its width and opening follow the existing audio-aligned viseme weights; it closes when speech ends.
- The original nose, eyes, eyebrows, hair, goggles and face silhouette remain unchanged. A full head-model replacement was not necessary: preserving those features keeps Ari recognisable and avoids creating additional facial duplicates.
- `src/character.js` attaches the mouth rig. Existing cinematic face camera and obstruction avoidance, water reflections, dialogue, voices, all three levels and controls are unchanged.
- `tools/build-release.py` includes the 29 pre-rendered MP3 voices in the static LAMP deployment ZIP.

## Checks performed

- Source and import checks, JS syntax, relative assets and filename case: **PASS**.
- Offline head-geometry test: **PASS**. The eight mouth-patch UV values are changed, while face triangles, all original 3D vertex positions and nose/eye UVs remain unchanged. One independent lip rig is attached. Closed/open/wide/rounded mouth geometry verified numerically.
- LAMP ZIP structure and integrity, static assets and all 29 voices: **PASS**.
- Extracted LAMP ZIP served over HTTP from a `/game/` subdirectory: **PASS**.
- **Not verified:** a full visual browser playthrough and live deployment to the university LAMP server. Please test the speaking close-up locally before submission. This package does not modify GitHub automatically.

## Local testing

Extract the full source ZIP, open `three-worlds-of-time-main` in VS Code, and run `py -m http.server 8010`. Open `http://localhost:8010/`, press Ctrl+Shift+R, then test Ari's dialogue. Confirm there is only one mouth, the new lips are proportionate, the nose does not move, the mouth follows speech and closes afterward, and walls do not block the speaking camera.
