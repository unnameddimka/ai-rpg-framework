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

"$NODE_EXE" tools/generate-model-list.js
"$NODE_EXE" tools/generate-world-data.js
"$NODE_EXE" tools/generate-world-editor.js

TEST_FILES=(
    tests/run-tests.js
    tests/run-migration-tests.js
    tests/run-persistence-tests.js
    tests/run-editor-tests.js
    tests/run-ui-tests.js
    tests/run-starter-character-tests.js
    tests/run-ai-tests.js
    tests/run-action-contract-repair-tests.js
    tests/run-quality-pass-tests.js
    tests/run-ai-liveness-tests.js
    tests/run-generator-tests.js
    tests/run-narrator-tests.js
    tests/run-memory-consolidation-tests.js
    tests/run-mind-retrieval-tests.js
    tests/run-night-timelapse-tests.js
    tests/run-daytime-tests.js
    tests/run-weekly-merchant-tests.js
    tests/run-release-profile-tests.js
)

for test_file in "${TEST_FILES[@]}"; do
    printf 'Running %s...\n' "$test_file"
    "$NODE_EXE" "$test_file"
done

printf 'All test suites passed.\n'
