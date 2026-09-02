# Team workflow — 5 people

## Branching model

Keep `main` always playable. Nobody commits straight to it.

```
main                      ← always builds, always demo-able
 ├─ feature/level1-puzzles
 ├─ feature/level2-lab
 ├─ feature/level3-neon
 ├─ feature/timemachine-shader
 └─ feature/polish-ui
```

- Branch names: `feature/<short-description>` or `fix/<short-description>`.
- One branch per task, not per person — if you finish early, branch again for the next task rather than piling unrelated work into one branch.
- Merge into `main` via **pull request**, not `git push origin main`. Even solo, a PR gives the rest of the team a diff to skim before it lands.
- Rebase or merge `main` into your branch before opening the PR, so conflicts show up on your branch, not in the merge.

## Branch protection on GitHub (do this once, whoever owns the repo)

Settings → Branches → Add rule for `main`:
- Require a pull request before merging
- Require at least 1 approval
- Optional but recommended: require the branch to be up to date before merging

This physically prevents accidental direct pushes to `main` — worth the two minutes.

## Suggested split of work (5 people, mapped to the current file structure)

The codebase is already separated so five people can work with minimal file overlap:

| Person | Owns | Files |
|---|---|---|
| 1 | Level 1 — Ancient Ruins puzzle chain | `src/levels/ancientRuins.js` (currently `world.js`) |
| 2 | Level 2 — Modern Laboratory | `src/levels/modernLab.js` (new) |
| 3 | Level 3 — Neon Future | `src/levels/neonFuture.js` (new) |
| 4 | Player controller, Time Machine, level manager | `src/player.js`, `src/timeMachine.js`, `src/levelManager.js` (new) |
| 5 | Shaders, UI/HUD, polish, credits | `src/style.css`, `index.html`, custom shader files |

This isn't rigid — swap based on who wants to learn what — but each lane touches its own files, so merge conflicts stay rare. `main.js` is the one file everyone touches occasionally (wiring a new level in); keep edits there small and expect the odd conflict on it.

## Commit and PR habits

- Small commits, present tense: `Add flashlight toggle to lab level`, not `stuff` or `wip`.
- PR description should say what changed and, if it's a level, confirm the "what does this level do that the others don't" question from the brief — helps whoever reviews it think about Gameplay & Experience marks, not just whether the code runs.
- Before opening a PR: pull the latest `main`, serve your branch locally over HTTP (`python3 -m http.server`), and actually play through the change once. A PR that doesn't run wastes the reviewer's time.
- Whoever reviews doesn't need to rewrite your code — just check it runs, doesn't break other levels, and doesn't reintroduce an absolute path or a hardcoded `/` (brief §6.2).

## Weekly sync

Five people drifting on five branches for two weeks is how integration hell happens. Agree on a short weekly check-in (even 10 minutes) where everyone merges into `main` and plays the combined build together. Catch level-transition bugs and shared-state issues (like `timeMachine.lightSocket()` calls) early rather than the night before a deadline.
