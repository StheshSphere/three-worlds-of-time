"""Serve an independently extracted release under /game/ and verify every file."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from threading import Thread
from urllib.request import urlopen
import json
import struct
import sys
import tempfile
import zipfile

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'three-worlds-of-time.zip').resolve()

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with tempfile.TemporaryDirectory(prefix='three-worlds-release-') as temp:
    root = Path(temp)
    game = root / 'game'
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        assert 'index.html' in names, 'index.html must be at ZIP root'
        assert len(set(names)) == len(names), 'Duplicate ZIP entries'
        assert z.testzip() is None, 'Corrupt ZIP'
        for name in names:
            p = PurePosixPath(name)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in name, name
            assert p.parts[0] not in {'tools', 'docs', '.git', 'node_modules', 'dist', 'out'}, name
        z.extractall(game)
    # GLB assets must embed data or reference an existing relative dependency.
    models = 0
    for model in game.rglob('*.glb'):
        data = model.read_bytes()
        assert data[:4] == b'glTF'
        length, kind = struct.unpack_from('<II', data, 12)
        assert kind == 0x4E4F534A
        gltf = json.loads(data[20:20+length])
        for item in gltf.get('buffers', []) + gltf.get('images', []):
            uri = item.get('uri', '')
            if uri and not uri.startswith('data:'):
                assert not uri.startswith(('/', 'http:', 'https:', 'file:'))
                assert (model.parent / uri).is_file(), (model, uri)
        models += 1
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    total = 0
    try:
        base = 'http://127.0.0.1:' + str(server.server_port) + '/game/'
        for name in names:
            if name.endswith('/'):
                continue
            with urlopen(base + name, timeout=10) as response:
                assert response.status == 200, name
                assert response.read() == (game / name).read_bytes(), name
                if name.endswith('.js'):
                    assert 'javascript' in response.headers.get_content_type(), (name, response.headers)
            total += 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print(json.dumps({
        'suite': 'Extracted static release at HTTP /game/ subfolder',
        'status': 'PASS', 'files_http_200_and_exact_bytes': total,
        'glb_dependency_checks': models,
        'zip_root_integrity_case_and_module_mime': 'PASS',
        'browser_execution': 'NOT VERIFIED',
        'lamp_deployment': 'NOT VERIFIED'
    }, indent=2))
