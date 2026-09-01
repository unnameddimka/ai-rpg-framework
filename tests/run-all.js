"use strict";

const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const node = process.execPath;

const PREPARE = [
    "tools/generate-model-list.js",
    "tools/generate-world-data.js",
    "tools/generate-world-editor.js"
];

const TEST_FILES = [
    "tests/run-tests.js",
    "tests/run-migration-tests.js",
    "tests/run-persistence-tests.js",
    "tests/run-editor-tests.js",
    "tests/run-ui-tests.js",
    "tests/run-starter-character-tests.js",
    "tests/run-ai-tests.js",
    "tests/run-action-contract-repair-tests.js",
    "tests/run-playtest-action-availability-tests.js",
    "tests/run-quality-pass-tests.js",
    "tests/run-ai-liveness-tests.js",
    "tests/run-generator-tests.js",
    "tests/run-narrator-tests.js",
    "tests/run-memory-consolidation-tests.js",
    "tests/run-mind-retrieval-tests.js",
    "tests/run-night-timelapse-tests.js",
    "tests/run-daytime-tests.js",
    "tests/run-secrets-tests.js",
    "tests/run-chuhaister-food-tests.js",
    "tests/run-hardening-tests.js",
    "tests/run-transaction-presence-hardening-tests.js",
    "tests/run-awayable-tests.js",
    "tests/run-weekly-merchant-tests.js",
    "tests/run-release-profile-tests.js",
    "tests/run-014a-medallion-intimacy-tests.js",
    "tests/run-014b-anticipation-tests.js",
    "tests/run-014c-farmers-tests.js",
    "tests/run-014d-cognitive-tests.js",
    "tests/run-014e-candidate1-tests.js",
    "tests/run-014e-candidate2-tests.js",
    "tests/run-014e-candidate3-tests.js",
    "tests/run-014f-playtest1-tests.js"
];

function run(relativePath, announce) {
    if (announce) process.stdout.write(`Running ${relativePath}...\n`);
    const result = childProcess.spawnSync(node, [relativePath], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

PREPARE.forEach(function (file) { run(file, false); });
TEST_FILES.forEach(function (file) { run(file, true); });
process.stdout.write("All test suites passed.\n");

module.exports = { PREPARE, TEST_FILES };
