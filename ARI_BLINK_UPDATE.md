# Ari — natural eyelids and eyelashes (16 October 2026)

## Change
- Existing original skinned eye geometry retained: no separate eye or eyelid meshes, so facial features remain attached during movement and cinematics.
- Warm skin-tone upper and lower eyelids painted onto Ari's existing eye texture with soft contours, a light crease and short dark-brown eyelashes attached to the moving upper lid.
- Both eyes blink together every approximately 4 seconds (3.65–4.35 seconds between blinks), with an occasional subtle double blink. The eyelids close and reopen in 0.19 seconds.
- The eyelid texture redraws only while blinking, avoiding unnecessary per-frame texture uploads.
- Resetting the character returns eyelids to the open position.

## Files changed
- `src/core/faceMakeover.js` — eyelid/eyelash texture and blink timing controller.
- `src/character.js` — reset blink state when resetting the hero.
- `tools/test-face-fix.mjs` — support new canvas drawing methods in test mock.
- `tools/test-blink.mjs` — new focused blink and original-geometry regression tests.

## Testing
- Focused eye/face geometry and blink tests passed using the decoded character geometry fixture.
- Game's existing jump-controls, dialogue, audio, integration, and interactions suites passed.
- Release module graph, JavaScript syntax, asset dependencies, ZIP integrity and extracted HTTP subdirectory file serving checked.
- **Not verified:** real-time visual playthrough of the animated face in a browser and actual Wits LAMP hosting. Test locally before submission.

## Local testing
Extract the source ZIP and open `three-worlds-of-time-main` in VS Code. Run `py -m http.server 8010`, open `http://localhost:8010/`, then trigger Ari's dialogue and watch her eyes for about 5–10 seconds.
