"""Validate the static module graph and package a self-contained LAMP release."""
from pathlib import Path
from html.parser import HTMLParser
import json
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
errors = []
required = set()


def require(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        errors.append(f'Path escapes project: {path.name}')
    elif not path.is_file():
        errors.append(f'Missing/case-mismatched file: {path.relative_to(ROOT)}')
    else:
        required.add(path)
    return path


def relative_url(url, parent):
    if url.startswith(('data:', '#', 'https://', 'mailto:')):
        return
    if url.startswith(('/', 'http:', 'file:', 'C:', '\\')):
        errors.append(f'Non-relative runtime path: {url}')
        return
    return require(parent / url.split('?')[0].split('#')[0])


class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('src', 'href') and value:
                relative_url(value, ROOT)


for name in ('index.html', 'credits.html'):
    p = require(ROOT / name)
    if p.is_file():
        Links().feed(p.read_text(encoding="utf-8"))

html = (ROOT / 'index.html').read_text(encoding="utf-8")
imports = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.S)[1])['imports']
seen = set()


def module(path):
    path = require(path)
    if path in seen or not path.is_file():
        return
    seen.add(path)
    source = re.sub(r'/\*.*?\*/', '', path.read_text(encoding="utf-8"), flags=re.S)
    source = re.sub(r'^\s*//.*$', '', source, flags=re.M)
    for spec in re.findall(r'(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?[\'"]([^\'"]+)[\'"]', source):
        if spec.startswith('.'):
            dependency = path.parent / spec
        elif spec in imports:
            dependency = ROOT / imports[spec]
        else:
            prefix = next((k for k in imports if k.endswith('/') and spec.startswith(k)), None)
            if not prefix:
                errors.append(f'Unresolved module {spec} in {path.relative_to(ROOT)}')
                continue
            dependency = ROOT / imports[prefix] / spec[len(prefix):]
        module(dependency)


module(ROOT / 'src/main.js')
for p in (ROOT / 'src').rglob('*.js'):
    # Node is a dev-only syntax check, not required by the hosted game.
    check = subprocess.run(['node', '--check', '--input-type=module'], input=p.read_bytes(), capture_output=True)
    if check.returncode:
        errors.append(f'Syntax error: {p.relative_to(ROOT)}\n{check.stderr.decode()}')
    if re.search(r'''(?:from\s*['"][/]|(?:load|fetch)\w*\(\s*['"](?:/|https?://|file://))''', p.read_text(encoding="utf-8")):
        errors.append(f'Absolute runtime import/asset path: {p.relative_to(ROOT)}')

css = require(ROOT / 'src/style.css')
for url in re.findall(r'url\([\'"]?([^\)\'\"]+)', css.read_text(encoding="utf-8")):
    relative_url(url, css.parent)

manifest = (ROOT / 'src/core/assets.js').read_text(encoding="utf-8")
for path in re.findall(r"['\"](models/[^'\"]+\.glb)['\"]", manifest):
    require(ROOT / 'assets' / path)
for key, folder, suffix in [('textures', 'textures', None), ('music', 'audio/music', '.ogg'), ('sfx', 'audio/sfx', '.ogg'), ("'modern-lab'", 'audio/modern-lab', '.ogg')]:
    block = re.search(re.escape(key) + r':\s*\[([^\]]*)\]', manifest)[1]
    block = re.sub(r'//[^\n]*', '', block)
    for name in re.findall(r"['\"]([a-z0-9-]+)['\"]", block):
        for ending in (['/color.webp', '/normal.webp', '/arm.webp'] if suffix is None else [suffix]):
            require(ROOT / 'assets' / folder / (name + ending))

for p in list(required):
    if p.is_relative_to(ROOT / 'assets') and not re.fullmatch(r'[a-z0-9/_.-]+', p.relative_to(ROOT / 'assets').as_posix()):
        errors.append(f'Asset name must be lowercase and contain no spaces: {p.name}')
require(ROOT / 'libs/three/LICENSE')
for p in (ROOT / 'licenses').glob('*.txt'):
    require(p)

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
if '--check' in sys.argv:
    print(f'PASS: {len(seen)} runtime modules, {len(required)} required files; syntax, imports, asset paths and case.')
    sys.exit(0)

dest = ROOT / 'dist'
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir()
for p in sorted(required):
    target = dest / p.relative_to(ROOT)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, target)
archive = ROOT / 'three-worlds-of-time.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in sorted(dest.rglob('*')):
        if p.is_file():
            z.write(p, p.relative_to(dest))
with zipfile.ZipFile(archive) as z:
    assert 'index.html' in z.namelist()
    assert z.testzip() is None
print(f'PASS: {len(seen)} runtime modules; {len(required)} files; ZIP root and integrity verified.')
print(f'Release: {archive.name} ({archive.stat().st_size / 1048576:.2f} MiB)')
print('Test independently: cd dist && python3 -m http.server 8000')
print('Then upload the ZIP contents via the course Moodle/LAMP route and test the published URL.')
