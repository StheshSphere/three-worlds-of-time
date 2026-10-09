#!/usr/bin/env bash
# Builds the Moodle/LAMP upload (brief §5–6, §12).
#
#   bash tools/build-deploy.sh            → dist/ + three-worlds-of-time.zip
#
# There is no bundler: the game is plain files + an import map, so the
# "production build" is a clean copy of exactly what the browser needs —
# index.html, src/, libs/, assets/ — and nothing else (no tools/, no
# node_modules/, no docs). index.html sits at the TOP of the zip.
#
# It also runs the brief's pre-flight checks and refuses to build if one fails:
#   - no absolute paths ("/..." in src/href/url()/loaders)
#   - asset filenames lowercase, no spaces (Linux server is case-sensitive)
#   - every model/texture/audio file named in src/core/assets.js exists
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Pre-flight checks"
fail=0
if grep -rnE '(src|href)="/[^/]|load(Async)?\(\s*["'"'"']/|from ["'"'"']/|url\(["'"'"']?/[^/]' index.html src; then
  echo "✗ absolute paths found (they 404 when hosted in a subfolder)"; fail=1
fi
if find assets -type f | grep -E '[A-Z ]'; then
  echo "✗ asset filenames must be lowercase with no spaces"; fail=1
fi
node -e '
const fs = require("fs");
const s = fs.readFileSync("src/core/assets.js", "utf8");
let missing = 0;
for (const m of s.matchAll(/["\x27](models\/[^"\x27]+\.glb)["\x27]/g)) if (!fs.existsSync("assets/" + m[1])) { console.log("missing assets/" + m[1]); missing++; }
const block = (k) => (s.match(new RegExp(k + ":\\s*\\[([^\\]]*)\\]")) || [, ""])[1];
for (const t of block("textures").match(/[a-z0-9-]+/g) || []) for (const f of ["color", "normal", "arm"]) if (!fs.existsSync(`assets/textures/${t}/${f}.webp`)) { console.log(`missing assets/textures/${t}/${f}.webp`); missing++; }
for (const t of block("music").match(/[a-z0-9-]+/g) || []) if (!fs.existsSync(`assets/audio/music/${t}.ogg`)) { console.log(`missing music ${t}`); missing++; }
for (const t of block("sfx").match(/[a-z0-9-]+/g) || []) if (!fs.existsSync(`assets/audio/sfx/${t}.ogg`)) { console.log(`missing sfx ${t}`); missing++; }
process.exit(missing ? 1 : 0);
' || { echo "✗ files listed in src/core/assets.js are missing"; fail=1; }
[ "$fail" = 0 ] || { echo "Pre-flight failed — fix the above before uploading."; exit 1; }
echo "✓ paths relative, filenames lowercase, all assets present"

echo "== Building dist/"
rm -rf dist three-worlds-of-time.zip
mkdir -p dist
cp index.html dist/
cp -R src libs assets dist/
find dist -name '.DS_Store' -delete
du -sh dist | sed 's/^/   size: /'

echo "== Zipping (index.html at the top level)"
(cd dist && zip -qr ../three-worlds-of-time.zip .)
unzip -l three-worlds-of-time.zip | head -5
echo
echo "Done. Test the BUILD before uploading:"
echo "   cd dist && python3 -m http.server 8000   → play it through at http://localhost:8000"
echo "Then upload three-worlds-of-time.zip via the Moodle submission and play the published URL in Chrome,"
echo "checking the console for 404s (brief §12)."
