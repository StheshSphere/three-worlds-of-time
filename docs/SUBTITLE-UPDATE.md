# Player-controlled subtitles — 11 October 2026

Every existing spoken caption and narrative era card now waits for **Enter, Numpad Enter, or a click**. Text appears in full, in its original order. Click the panel/Continue control when the pointer is free; while the mouse is captured, left-click also continues and cannot interact with the scene behind it. Holding Enter advances only once. The first line explains the controls.

A single reusable controller queues unread lines and shows **“Press ENTER or CLICK to continue.”** after 10 seconds. Advancing hides the reminder and starts a fresh timer. Pause, overlays, lost focus and hidden tabs suspend its remaining time. Ending/cancelling dialogue, changing era or restarting clears obsolete text, timers and callbacks.

Cutscenes, era introductions, arrival dialogue and pending core transitions wait for acknowledgement. Escape pauses a cutscene; Space/Enter no longer skip an entire story sequence. Ordinary in-game thoughts remain non-blocking. HUD notifications, objectives, tutorial cards and puzzle readers retain their existing roles.

## Changed files

- Runtime: `src/core/dialogue.js` (new), `src/core/ui.js`, `src/core/cutscene.js`, `src/main.js`, `src/levelManager.js`, `src/style.css`, `index.html`.
- Checks: `tools/test-dialogue.mjs` (new), `tools/test-integration.mjs`, `tools/tests/support/dom.mjs`, `tools/play.mjs`, `tools/tests/member4-release.json`.
- This note and `docs/verification/subtitle-*` evidence. All previous level/puzzle files, story text, shaders, assets, audio, libraries and licences are unchanged.

## Actually verified

- **19 focused dialogue checks passed:** first instruction, persistent text, Enter/held-key/click handling, 10-second reminder/reset, pause/overlay/focus behaviour, queue/cleanup, HUD independence, and every original prologue/wake-up/epilogue line and completion.
- **22 integration checks passed:** existing controls and puzzle/progression checks in both views, all three era cards, Lab/Future arrival lines, pending transitions and restart cleanup.
- These execute real game logic with DOM/render/audio substitutes; reminder timing uses a controlled clock. They do not prove browser rendering or native pointer lock.
- Release build/module checks and independently extracted HTTP file checks are recorded in the accompanying `subtitle-*` evidence.

## Remaining browser check

Chrome exited before opening a page here. Browser visuals, native input/pointer lock, console errors and the published LAMP URL remain **not verified**. Serve the release over HTTP, read the intro, wait 10 seconds, hold Enter, click, pause/resume and restart; repeat through all three eras and the ending in both camera views. Confirm no click interacts behind a caption and keypad Enter still submits normally.

The updated `tools/tests/member4-release.json` browser regression acknowledges dialogue through the existing browser runner. It was prepared, not executed here. Older exploratory browser scripts still assume the previous automatic timing; use this updated regression.
