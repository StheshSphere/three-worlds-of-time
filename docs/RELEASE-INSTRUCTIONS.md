# Release and handoff instructions

## Local checks

The game requires HTTP and a modern desktop Chrome browser with WebGL; no server-side JavaScript, PHP or build service is required. Development checks use Python 3.10+ and Node 20+.

From the source root:

```bash
node tools/test-integration.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
```

The build creates `dist/` and `three-worlds-of-time.zip`. The delivered `three-worlds-of-time-lamp-release.zip` has the same release contents, with `index.html` at ZIP root. Unzip it into a fresh folder, open a terminal there and run:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Never use `file://`. Complete the browser checklist in `final-verification-summary.md`.

Optional regression runner: install the existing development dependencies with `npm --prefix tools install`, then run from the source root while the separately extracted release is served:

```bash
VIEW=third node tools/play.mjs tools/tests/member4-release.json out/third
VIEW=first node tools/play.mjs tools/tests/member4-release.json out/first
```

Set `CHROME` to an installed Chrome/Chromium executable if discovery fails, `HEADLESS=0` for a visible window, and `URL` to a different local or hosted game address. Environment-variable syntax above is for Bash; in PowerShell use `$env:VIEW = "first"` before the Node command. Screenshots/logs/results go under `out/`. The script uses puzzle shortcuts, checks the real main loop/UI transitions and fails on assertions/timeouts/resource errors. It has **not been executed successfully in this environment** and does not replace manual route traversal or audible checks.

## Moodle / LAMP

1. Use the course's authorised Moodle/LAMP submission route. Upload `three-worlds-of-time-lamp-release.zip`; do not wrap it in another directory or ZIP.
2. Open the published URL in Chrome. Hard-refresh with DevTools Network open; inspect Console for exceptions and Network for missing files, JavaScript MIME failures and mixed content.
3. Play Ancient → Lab → Future → victory → restart on that URL in both camera modes. Check the exact acceptance list and listen to transitions/mute.
4. If a defect appears, fix the source, rebuild, rerun local checks, upload the new release, and repeat the hosted checks.

No Moodle/LAMP login, course submission URL or deployment credentials were supplied. **Nothing has been deployed.** The guide specifies the course route, not a server address, so no URL is invented.

## Git handoff

Work was prepared on `feature/04-final-integration-release` using a local snapshot baseline. The upload had no Git metadata or remote, so the source ZIP excludes the synthetic `.git/`; no push, PR or merge occurred.

In your real clone, first commit or stash your own outstanding changes, then:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/04-final-integration-release
```

If that branch already exists, switch to it instead. Copy the **contents** of the updated project folder into the clone; preserve the clone's `.git/`. The supplied ZIP represents original snapshot `ce29877b2ce54894f71563b00fd9822e3d9cbcf1` (archive comment). If current main has newer work, reconcile the differences before overwriting those files.

```bash
git status --short
git diff --check
git diff --stat
node tools/test-integration.mjs
node tools/test-audio.mjs
bash tools/build-deploy.sh
python3 tools/test-release.py
git add AGENTS.md README.md index.html credits.html src docs licenses tools
git commit -m "Complete Member 4 integration and release preparation"
git push -u origin feature/04-final-integration-release
```

Run the push yourself when ready. Open a PR against main using your repository host, attach the verification results, and obtain the required team review. Complete browser/hosted checks and resolve the audit/specification items before representing the work as fully accepted. No force push or automatic merge is needed.
