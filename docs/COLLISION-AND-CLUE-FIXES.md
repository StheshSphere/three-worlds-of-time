# Collision and clue fixes — 15 October 2026

This is the complete updated source project, based on the uploaded current game.

## What changed

- **Past / stone boxes:** each push checks the full path against physical objects, including low rubble, columns, walls, the reset stone and the other box. It does not only check the destination tile. Fallen column pieces now have collision boxes. Courtyard rubble stays inside its blocked tile, and column bounds are measured accurately so random rotations do not block valid routes.
- **Reset weights:** resets mesh positions, collisions, pressure plates and saved coordinates together. Boxes no longer animate through obstacles on their way back. Older unsolved saves with a box embedded in scenery restore the weights to their starting tiles while retaining the rest of the puzzle/clue progress.
- **Nearby clues:** walk close and press **E**. Tablets, logs, the flashlight, chalkboard, ink clues and unlocked cores have forgiving proximity selection in both camera views. You do not need to hit a tiny object with the crosshair.
- **Nearby guidance:** one arrow identifies the current nearby object. It says **Move closer**, **Move around the obstacle**, **Turn towards this object**, or **Press E**, as appropriate. Off-screen objects get an edge arrow. Guidance hides during dialogue and menus.
- **Puzzle controls:** aiming directly at a particular drum, conduit tile or energy node still selects that control. Nearby assistance is available without making a different control take priority over your aim.
- **Physical access:** invisible collision walls and locked containment fields block interaction. Hidden objects, completed pickups and inactive controls cannot be collected. The target is checked again when E is pressed.
- **Lab ink:** with the flashlight on, a nearby ink mark can be read with E. Holding the beam on it still works. Automatic discovery now checks walls and requests a progress save.
- **Other solid scenery:** the Past's vases, fallen trunk and scattered rocks also have collision. Floor surfaces, pressure plates and vegetation keep their intended traversal behaviour.
- **Packaging:** restored the missing `licenses/stats-mit.txt` notice already linked by the existing credits page. Source: <https://github.com/mrdoob/stats.js/blob/master/LICENSE>.

The existing Enter/click dialogue controls and Continue Journey system remain in place. No new game dependency or asset pack was added.

## Play locally

Extract the ZIP. Open a terminal inside `three-worlds-of-time-main` (the folder containing `index.html`). On Windows:

```powershell
py -m http.server 8000
```

On macOS/Linux use `python3 -m http.server 8000`. Open <http://localhost:8000> in your browser. Keep the terminal running. Do not double-click `index.html`.

Use the same browser and address/port as before to access that browser's existing saved journey. The game does not need `npm install`.

## Verification

| Check | Result |
| --- | --- |
| Collision and interaction regressions | 17 passed, using 32 shipped GLB models for their real geometry; image decoding is replaced in these Node checks |
| Existing integration, three-era progression and save/resume checks | 35 passed |
| Existing dialogue checks | 21 passed |
| Existing audio lifecycle checks | 4 passed |
| Release builder | Passed: 51 runtime modules; 184 required files |
| Independently extracted HTTP release | All 184 files returned HTTP 200 with matching bytes; all 33 GLB dependency checks passed |

The new regressions cover E-key tablet collection without precise aim in both views, all lab clue types, locked/unlocked core access, exact conduit selection, stale/hidden targets, thin debris between tiles, reset during a push, and a full weight-puzzle solution driven through the player's walking controller. The regression seed includes a previously failing rotated-column layout.

These are automated logic, geometry and file-serving checks. A visual browser playthrough, GPU/shader rendering and LAMP deployment were **not verified in this environment**: a browser binary was unavailable and its download failed. Before submission, play the game locally to confirm the arrow placement and appearance on your screen.

To rerun the development checks:

```bash
REAL_MODELS=1 node tools/test-interactions.mjs
node tools/test-integration.mjs
node tools/test-dialogue.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
```

For PowerShell, run `$env:REAL_MODELS = "1"` followed by `node tools/test-interactions.mjs`. The normal project run instructions and release workflow are unchanged.
