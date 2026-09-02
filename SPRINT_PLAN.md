# Sprint plan — Alpha → Beta → Final

Reference: the brief gives you **three weeks total** from release to the graded Beta, and warns explicitly not to lose the first week. You've already cleared Alpha (mentor walkthrough, scaffold running). This plan covers what's left: get to Beta fast, then use the gap before Final to finish properly.

Exact dates are on Moodle and override anything here — plug them into the headings below when you have them.

---

## Right now (before anyone branches off) — do this together, same sitting

One person drives, everyone watches — this only needs doing once and every level depends on it being right.

1. Split `src/world.js` into `src/levels/ancientRuins.js`, create empty stubs for `src/levels/modernLab.js` and `src/levels/neonFuture.js`, each exporting `build(scene) → { interactables }`.
2. Write `src/levelManager.js`: holds current level index, a `loadLevel(scene, index)` that disposes the previous level's objects/lights and calls the next level's `build()`, and a `nextLevel()` the game calls when a core is recovered.
3. Wire `main.js` to go through the level manager instead of calling `buildAncientRuinsLevel` directly.
4. Commit this straight to `main` (it's foundational, not feature work) and push. Everyone pulls before branching.
5. Turn on branch protection on `main` now, if you haven't (Settings → Branches, require PR + 1 approval).

If this step slips more than a day, everyone downstream is blocked — treat it as the literal first thing that happens.

---

## Week 1 — now through Beta demo

Beta only needs to be "fundamentally finished, minor bugs OK, a level or two can be incomplete." Don't polish yet — get all three levels *playable start to finish* first, even roughly, then improve whichever has the most slack.

**Person 1 — Level 1: Ancient Ruins** (`src/levels/ancientRuins.js`)
- Finish the puzzle chain from the pitch doc: push blocks onto plates, rotate a bridge into place, find hidden symbols, trigger a final mechanism.
- On completion, call `timeMachine.lightSocket(0)` and hand off to `levelManager.nextLevel()`.
- Keep using primitive geometry — do not chase real models this week, that's next-week polish.

**Person 2 — Level 2: Modern Laboratory** (`src/levels/modernLab.js`)
- Cool lighting, glass/metal materials, a keycard pickup, a flashlight toggle (SpotLight on the camera), a switch-sequence or simple circuit puzzle.
- On completion, call `timeMachine.lightSocket(1)`.

**Person 3 — Level 3: Neon Future** (`src/levels/neonFuture.js`)
- Emissive/neon materials, moving platforms (sine-wave position updates), a timed hazard the player must avoid.
- On completion, call `timeMachine.lightSocket(2)`.

**Person 4 — Player, Time Machine, integration**
- Own `player.js`, `timeMachine.js`, `levelManager.js`.
- Add basic physics/collision appropriate to gameplay (brief explicitly marks "relevant physics" under Gameplay & Experience) — even simple AABB or raycast-down-for-ground-height is enough at this stage.
- Build the win-state sequence: once all three sockets are lit, a short cinematic camera move + Time Machine animation.
- Integration duty: when Person 1/2/3 open PRs, you're the one who actually plays the merged build end-to-end before approving, since you're the one who understands how the levels chain together.

**Person 5 — Shell, HUD, sound, deployment**
- Get the current alpha build hosted on the LAMP server *this week*, not later — brief section 6 flags "deploy early" as the single habit that prevents last-minute disasters. Confirm it loads over the real URL in Chrome with no console 404s.
- Add background music and basic SFX (interact, footsteps, win/fail) — Gameplay & Experience marks sound explicitly.
- Keep the credits list current as others add assets — chase people for licence/source info in the group chat rather than waiting for a big cleanup at the end.
- Start a shader sketch (see Week 2 — better to have a rough one running early than start it under deadline pressure).

**Everyone, ongoing**
- Small commits, `feature/*` branches, PR before merging (see `CONTRIBUTING.md`).
- Daily 5-minute async check-in (chat message: what you did, what's next, anything blocking you) plus the weekly sync in person.

### Beta-day checklist
- [ ] All three levels load in sequence, each reachable by finishing the one before.
- [ ] Controls (keyboard + mouse) work in all three levels.
- [ ] Each level's one-sentence "what's different" is ready to say out loud.
- [ ] Hosted build works in Chrome, console checked.
- [ ] Everyone can answer questions about their own level's implementation.

---

## Week 2+ — Beta feedback through Final

This is where the rubric categories you *haven't* touched yet get their attention: Shaders (10%), 3D Effects (15% — you only need "several advanced effects," you have lighting/shadows/fog already), Polish (10%), Innovation (10%), Trailer (10%).

**Person 1, 2, 3 — per-level polish**, in priority order:
1. Fix whatever your mentor/tutors flagged at Beta first.
2. Replace primitive placeholder geometry with better blockouts or real models if time allows (not required for a good mark, but helps Innovation/Viewing).
3. Add a second layer of interactivity or a small twist to your level if you have slack — this is what pushes Gameplay & Experience from "functional" to "fun."

**Person 4 — physics/game-feel pass + Time Machine finale**
- Tighten collision, jump feel, and the interact range based on Beta playtesting.
- Finish the win/restart flow: restart-without-refresh must reset *all* level and player state, not just position (brief explicitly checks this).
- Add a pause/options menu if time allows (Polish).

**Person 5 — shaders, trailer, devlog, deployment**
- Land the custom shader for real this stretch: a `ShaderMaterial` with a `uTime` uniform driving something visible — a ripple around the Time Machine on level transition is a strong, explainable choice. Every member must be able to explain it, so walk the team through the GLSL once it's working, don't just merge it silently.
- Own the trailer (max 2 minutes, uploaded to YouTube) and the devlog. Start capturing footage as soon as each level is playable — don't wait until the last week to realize you have no footage of Level 1.
- Re-run the deployment check after every merge to `main` in this phase: hosted, played through, console clean, filenames case-matched, no absolute paths, memory doesn't climb across a full three-level playthrough.

### Final submission checklist (from the brief — copy this into your tracker as-is)
- [ ] Game has three levels/stages, playable start to finish.
- [ ] Each level introduces something the others don't — one sentence per level, ready to say.
- [ ] Keyboard and mouse controls both work.
- [ ] At least one custom shader is in the game, and every member can explain what it does.
- [ ] Game can be restarted without refreshing the page.
- [ ] Credits screen lists everything not made by the team — libraries, models, textures, sounds, music, adapted code/tutorials — with sources and licences.
- [ ] Production build created (not the source tree, not `node_modules`).
- [ ] Built game tested locally over HTTP, played all the way through.
- [ ] No absolute paths beginning with `/` anywhere.
- [ ] Asset filenames match the case used in code, exactly.
- [ ] Archive uploaded via Moodle, `index.html` at the top level.
- [ ] Published URL opened in Chrome and played through, console checked for 404s.
- [ ] Frame rate acceptable on lab hardware; memory doesn't climb across the three levels.
- [ ] Trailer (max 2 min) uploaded to YouTube, link submitted.
- [ ] Devlog video submitted.
- [ ] Every member has submitted their individual Moodle contribution report — this affects up to 20% of your *individual* mark, separate from the group mark, so don't skip it.

---

## If you're behind schedule at any point

Cut scope on level *content* before cutting level *count* — a rubric grader can give partial credit to "three levels, one of them thin" but "two levels, both polished" loses marks under Gameplay & Experience for the missing third level regardless of how good the other two are. If something has to give, it's decoration and secondary puzzle steps, not the third era existing and being finishable.
