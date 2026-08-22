#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
PROFILE="${1:-public}"
if [[ $# -gt 1 ]]; then printf 'ERROR: usage: ./build.sh [public|private]\n' >&2; exit 1; fi

find_node() {
    if [[ -n "${NODE_EXE:-}" && -x "$NODE_EXE" ]]; then printf '%s\n' "$NODE_EXE"; return 0; fi
    command -v node 2>/dev/null && return 0
    return 1
}
find_tweego() {
    if [[ -n "${TWEEGO_EXE:-}" && -x "$TWEEGO_EXE" ]]; then printf '%s\n' "$TWEEGO_EXE"; return 0; fi
    if command -v tweego >/dev/null 2>&1; then command -v tweego; return 0; fi
    local candidate
    for candidate in "$ROOT_DIR/.tools/tweego/tweego" "$HOME/.local/bin/tweego" "$HOME/.local/share/tweego/tweego"; do
        if [[ -x "$candidate" ]]; then printf '%s\n' "$candidate"; return 0; fi
    done
    return 1
}
NODE_EXE="$(find_node || true)"
if [[ -z "$NODE_EXE" ]]; then printf 'ERROR: node was not found on PATH.\n' >&2; exit 1; fi
export NODE_EXE
"$NODE_EXE" tools/build-profile.js "$PROFILE" >/dev/null

TWEEGO_EXE="$(find_tweego || true)"
if [[ -n "$TWEEGO_EXE" && -z "${TWEEGO_PATH:-}" ]]; then
    for candidate in "$ROOT_DIR/.tools/tweego/storyformats" "$(dirname -- "$TWEEGO_EXE")/storyformats" "$HOME/.local/share/tweego/storyformats"; do
        if [[ -d "$candidate" ]]; then export TWEEGO_PATH="$candidate"; break; fi
    done
fi

mkdir -p dist
printf 'Running JavaScript tests against the public canonical world...\n'
bash ./test.sh
printf 'Preparing %s build source...\n' "$PROFILE"
"$NODE_EXE" tools/prepare-build.js "$PROFILE"
SOURCE_DIR="$ROOT_DIR/.build/$PROFILE/src"
if [[ "$PROFILE" == "private" ]]; then OUTPUT="$ROOT_DIR/dist/mallowstead-private.html"; else OUTPUT="$ROOT_DIR/dist/mallowstead.html"; fi

printf 'Building %s...\n' "$OUTPUT"
if [[ -n "$TWEEGO_EXE" ]]; then
    "$TWEEGO_EXE" -o "$OUTPUT" "$SOURCE_DIR"
else
    printf 'Tweego not found; reusing an embedded SugarCube runtime template.\n'
    TEMPLATE="$ROOT_DIR/dist/mallowstead.html"
    [[ -f "$TEMPLATE" ]] || TEMPLATE="$ROOT_DIR/dist/game.html"
    "$NODE_EXE" tools/build-from-existing-runtime.js --source "$SOURCE_DIR" --output "$OUTPUT" --template "$TEMPLATE"
fi
"$NODE_EXE" tools/postprocess-product-title.js --input "$OUTPUT"
if [[ "$PROFILE" == "public" ]]; then
    "$NODE_EXE" tools/package-public-release.js
fi
"$NODE_EXE" tools/cleanup-build.js "$PROFILE"
printf 'Build complete: %s\n' "$OUTPUT"
