#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

find_node() {
    if [[ -n "${NODE_EXE:-}" && -x "$NODE_EXE" ]]; then
        printf '%s\n' "$NODE_EXE"
        return 0
    fi
    command -v node 2>/dev/null && return 0
    return 1
}

find_tweego() {
    if [[ -n "${TWEEGO_EXE:-}" && -x "$TWEEGO_EXE" ]]; then
        printf '%s\n' "$TWEEGO_EXE"
        return 0
    fi
    if command -v tweego >/dev/null 2>&1; then
        command -v tweego
        return 0
    fi
    local candidate
    for candidate in \
        "$ROOT_DIR/.tools/tweego/tweego" \
        "$HOME/.local/bin/tweego" \
        "$HOME/.local/share/tweego/tweego"; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

NODE_EXE="$(find_node || true)"
if [[ -z "$NODE_EXE" ]]; then
    printf 'ERROR: node was not found on PATH.\n' >&2
    exit 1
fi
export NODE_EXE

TWEEGO_EXE="$(find_tweego || true)"

if [[ -n "$TWEEGO_EXE" && -z "${TWEEGO_PATH:-}" ]]; then
    for candidate in \
        "$ROOT_DIR/.tools/tweego/storyformats" \
        "$(dirname -- "$TWEEGO_EXE")/storyformats" \
        "$HOME/.local/share/tweego/storyformats"; do
        if [[ -d "$candidate" ]]; then
            export TWEEGO_PATH="$candidate"
            break
        fi
    done
fi

printf 'Generating model list...\n'
"$NODE_EXE" tools/generate-model-list.js

printf 'Generating world data...\n'
"$NODE_EXE" tools/generate-world-data.js

mkdir -p dist

printf 'Running JavaScript tests...\n'
bash ./test.sh

printf 'Building dist/game.html...\n'
if [[ -n "$TWEEGO_EXE" ]]; then
    "$TWEEGO_EXE" -o dist/game.html src
else
    printf 'Tweego not found; reusing the SugarCube runtime embedded in the existing dist/game.html.\n'
    "$NODE_EXE" tools/build-from-existing-runtime.js
fi

printf 'Build complete: dist/game.html\n'
