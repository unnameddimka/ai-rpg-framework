#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

NODE_EXE="${NODE_EXE:-}"
if [[ -z "$NODE_EXE" ]]; then
    NODE_EXE="$(command -v node || true)"
fi
if [[ -z "$NODE_EXE" ]]; then
    printf 'ERROR: node was not found on PATH.\n' >&2
    exit 1
fi

"$NODE_EXE" tests/run-all.js
