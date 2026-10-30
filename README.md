# Three Worlds of Time

Complete game source and runtime assets, updated 30 October 2026.

## Latest fixes

This version uses the submitted 24 October game as its base and includes the Ancient Ruins archway wall fix from the supplied GitHub version. The walls now meet the arch piers without overlapping faces that cause flickering.

The title menu adapts its spacing to shorter windows and hides its scrollbar on small displays. Wheel, touch and keyboard focus scrolling remain available when the content needs more room.

The Level 1 Sun Gate now stays solid for its entire 2.6-second opening animation. Players can enter only when it is fully open. Its dialogue and Sun Court entry trigger also wait until the animation has finished. Restart this era restores the closed gate and its collision barrier.

The tablet combinations, journal reset, save/continue, optional hints, dialogue controls and final statistics review from the submitted game are retained.

## Review the final statistics

The final Timeline Restored screen now includes **Back to statistics**. It reopens all three levels' results and the overall statistics, ranks, titles, medal and earned badges in one scrollable view. Background clicks do not dismiss this review. Select **Back to results** to return to the final time and menu options. Reviewing results does not update the best-time record or remove the original new-best label, and it can be repeated as often as needed. The option also works after continuing a completed saved journey.

## Play locally

Open this folder in VS Code. In its terminal run:

```powershell
npm start
```

Open http://localhost:8000. No package installation or build is needed. Node.js 22.15 or newer is required for the included server and tests; the game itself runs in a WebGL-capable browser. Alternatively run `python -m http.server 8000` in this folder.

## Level 1 tablet fix

Each tablet has an hour number and a symbol. Match the left, middle and right drums to hours **I, II and III**. Collection order does not change those numbers. The journal now displays the tablet clues in numerical order, and each drum's interaction prompt identifies the symbol it currently shows.

For example, if the tablets show **I = Moon, II = Hourglass, III = Peak**, that is the drum order even if the tablets were found in a different order.

* Every generated combination can unlock the altar and reveal the Ancient Core.
* Restart Journey clears the journal and previous saved journey before the opening story, then gives Level 1 a fresh tablet code.
* Restart this era in Level 1 clears the entire journal, including entries from older saves, and resets every clue and puzzle. New tablets must be collected. The fresh puzzle and empty journal are saved immediately, so exiting and continuing after a restart cannot restore the old clues.
* Exit and Continue preserve the exact tablets, their assigned hours, collected clues, drum positions and journal entries.
* New saves record the exact code and tablet assignment. Older saves remain supported, with collected journal clues used to repair an old mismatch.

## Automated checks

```powershell
npm test
```

The tests exercise all 120 generated symbol codes, six assignments of hour numbers to tablet locations and six collection orders: 4,320 full-level interaction cases. They also cover all 216 possible symbol triples, the six drum face textures against the actual Three.js geometry, save/continue, restart/rewind, legacy saves and collection of the Ancient Core followed by the Level 2 transition. They use real scene geometry with mocked drawing and GPU environment generation; they do not perform a browser rendering test.

## Submission

Use the separate LAMP ZIP for submission. Its root contains `index.html`, `credits.html`, `assets/`, `libs/`, `licenses/` and `src/`. All required runtime assets are included and use relative paths. The GitHub ZIP additionally includes these instructions, the local server and regression tests.
