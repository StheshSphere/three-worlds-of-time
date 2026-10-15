# Invisible proximity circles for EVERY clue (15 October 2026)

## What was fixed

Players no longer need to look directly at a clue, squeeze around a desk, find a tiny prop's hitbox, or search for a particular camera angle to activate the `E` prompt.

Every interactable tagged `kind: 'clue'` uses the same invisible **3.6 m ground-plane radius**, or a larger radius when explicitly configured for that clue. This includes the Past carved tablets and Ancient Core, Present incident log/flashlight/professor's laptop/chalkboard/phosphor ink/Lab Core, and the Future Neon Core. A reasonable vertical tolerance accommodates raised clue objects.

1. The player enters the invisible circle on foot.
2. If the clue is active/uncollected and accessible, the central `E` prompt immediately appears without needing to aim.
3. Pressing `E` rechecks the same zone; it actually reads/collects the prompted clue.
4. Moving outside the circle removes the prompt. Locked, hidden, or already-taken items never become available early.
5. Furniture, desks, low tables, and the exact visible mesh do **not** block interaction. Full-height architectural walls and locked doors still prevent pickup from another room.

When two clues are next to each other, closer clues and available pickups take priority. Existing direct-aim interactions with machinery retain their original controls.

## Interface policy

- The invisible circle is **never drawn**.
- **No 3D glowing arrows or floor rings.** The previous marker renderer has been disabled.
- The blue clue badge only shows **distance**, not a bearing or arrow.
- The central `E` prompt is the important visual signal.

## Implementation

- `src/core/interaction.js`: `clueInZone()` applies to every `kind: 'clue'`; `InteractionSelector` chooses a nearby available clue independently of camera angle.
- `src/player.js`: line-of-sight helper applies the same zone rule to clues.
- `src/main.js`: no world-space clue arrow renderer runs.
- `src/core/clueGuidance.js`: intentionally non-rendering compatibility stub.
- `tools/test-interactions.mjs`: added automated regression checks for all three eras, the office desk, invisible wall blockers, prompt/action agreement, and preserving puzzle controls.

## Manual test, crucial before submission

From the project root, run `py -m http.server 8000` in PowerShell, browse to `http://localhost:8000`, then press **Ctrl+Shift+R** (hard refresh).

- **Present / Professor's office:** Stand beside the desk even if the lamp, table and chair obscure the flashlight. `E – Take the flashlight` should show before you aim directly at it; press E to pick it up.
- **Past:** Stand beside each of the three tablets and press E from any accessible side, without precise camera aiming.
- **Present / Archive:** Switch the flashlight on and stand near each phosphor ink mark, then press E. You cannot collect marks before switching on the flashlight.
- **Present / Vault:** The Core remains locked until the containment field is down.
- **Future:** Solve the node sequence; then approach the core and press E. The locked core must not be collectable.
- **Blue badge:** It still reads `N m to clue` and does not point toward the item.

Note: Automated Node.js regressions and the source/import syntax check passed. Graphical browser automation was blocked by the test environment, so the steps above need manual verification on the actual machine.
