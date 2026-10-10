#!/usr/bin/env bash
# Plain static files; works without a bundler or game dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/build-release.py "$@"
