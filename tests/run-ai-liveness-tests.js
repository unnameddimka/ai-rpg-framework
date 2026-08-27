"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(value, message) { assert(value && value.ok, `${message}: ${JSON.stringify(value)}`); return value.value === undefined ? value : value.value; }
function fresh() { setup.Game.resetWorld(); setup.Game.acceptPlayerDisclaimer(); setup.Game.acknowledgeAISetup(); setup.Game.finalizePlayerSetup({ mode: "generic" }); setup.AITurnQueue.repair(); return setup.Game.getWorld(); }
function response(status, body, headers) {
    const normalizedHeaders = Object.assign({}, headers || {});
    return {
        ok: status >= 200 && status < 300,
        status: status,
        statusText: status === 429 ? "Too Many Requests" : "OK",
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: { get: function (name) {
            const key = Object.keys(normalizedHeaders).find(function (candidate) { return candidate.toLowerCase() === String(name).toLowerCase(); });
            return key ? normalizedHeaders[key] : null;
        } },
        text: async function () { return JSON.stringify(body || {}); }
    };
}
function idleStatus() {
    const executor = setup.AIRequestExecutor.getStatus();
    return executor.activeExecutions === 0 && executor.queuedExecutions === 0 && executor.activeTransportCalls === 0 &&
        setup.AIController.isInFlight() === false && setup.AITurnScheduler.isWaveInFlight() === false;
}

load("src/00-model-list.js"); load("src/generated/world-data.js"); load("src/07-mind-v3.js"); load("src/08-mind-validators.js"); load("src/09-passage-rules.js"); load("src/09-world-derived-state.js"); load("src/10-game-api.js"); load("src/10-weekly-rhythm.js"); load("src/10-presence.js"); load("src/10-authored-effects.js");
load("src/11-save-migration.js"); load("src/12-character-context.js"); load("src/13-character-memory.js"); load("src/13-verbatim-memory.js"); load("src/14-event-perception.js");
load("src/21-ai-settings.js"); load("src/21-ai-request-profiles.js"); load("src/22-openrouter-client.js"); load("src/23-ai-protocol.js"); load("src/23-structured-ai-request.js");
load("src/24-ai-request-executor.js"); load("src/24-item-model-effects.js"); load("src/24-ai-turn-scheduler.js"); load("src/20-controllers.js");
load("src/26-presentation-narrator.js");

async function main() {
    setup.AIRuntimeSettings.save("sk-or-v1-LIVENESS-TEST-KEY-ONLY", false, null, Date.now());

    // Hard timeout applies to the complete transport, including a response body that never finishes.
    let bodyReadStarted = false;
    let bodyTransportCalls = 0;
    const hangingBodyClient = {
        enforceRequestTiming: true,
        chat: function (messages, requestOptions) {
            bodyTransportCalls++;
            const fakeFetch = async function () {
                return {
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    url: "https://openrouter.ai/api/v1/chat/completions",
                    headers: { get: function () { return null; } },
                    text: function () { bodyReadStarted = true; return new Promise(function () {}); }
                };
            };
            return setup.OpenRouterClient.chatWithOptions(messages, Object.assign({}, requestOptions || {}, { timeoutMs: 25 }), fakeFetch);
        }
    };
    const timeoutResult = await setup.AIRequestExecutor.executeCustom({
        actorId: "hoodedWoman", purpose: "liveness-timeout", stage: "test", client: hangingBodyClient,
        run: function (policyClient) { return policyClient.chat([{ role: "user", content: "timeout fixture" }], { timeoutMs: 25 }); }
    });
    assert(!timeoutResult.ok && timeoutResult.error && timeoutResult.error.code === "AI_REQUEST_TIMEOUT" &&
        bodyReadStarted && bodyTransportCalls === 1, "hard timeout should cover a body read that never completes");
    assert(idleStatus(), `all busy counters should return to idle after timeout: ${JSON.stringify(setup.AIRequestExecutor.getStatus())}`);

    // Optional presentation work is diagnostically busy but must never count as blocking game work.
    let releaseOptional;
    const optionalHold = setup.AIRequestExecutor.executeCustom({
        actorId: null, purpose: "presentation-location", stage: "location",
        run: function () { return new Promise(function (resolve) { releaseOptional = resolve; }); }
    });
    await new Promise(function (resolve) { setImmediate(resolve); });
    let optionalStatus = setup.AIRequestExecutor.getStatus();
    assert(optionalStatus.busy === true && optionalStatus.blockingBusy === false &&
        optionalStatus.blockingActiveExecutions === 0 && optionalStatus.blockingQueuedExecutions === 0,
        `optional narrator execution must not become blocking busy: ${JSON.stringify(optionalStatus)}`);
    releaseOptional({ ok: true, value: { fragments: ["fixture"] }, error: null });
    await optionalHold;

    let releaseCanonical;
    const canonicalHold = setup.AIRequestExecutor.executeCustom({
        actorId: "hoodedWoman", purpose: "game-decision", stage: "decision",
        run: function () { return new Promise(function (resolve) { releaseCanonical = resolve; }); }
    });
    await new Promise(function (resolve) { setImmediate(resolve); });
    const canonicalStatus = setup.AIRequestExecutor.getStatus();
    assert(canonicalStatus.busy === true && canonicalStatus.blockingBusy === true && canonicalStatus.blockingActiveExecutions === 1,
        `canonical execution must remain blocking busy: ${JSON.stringify(canonicalStatus)}`);
    releaseCanonical({ ok: true, value: null, error: null });
    await canonicalHold;
    assert(idleStatus(), "busy classification fixtures must return executor state to idle");

    // A real OpenRouter 429 preserves Retry-After and sanitized diagnostics.
    const direct429 = await setup.OpenRouterClient.chatWithOptions([{ role: "user", content: "rate fixture" }], { timeoutMs: 1000 }, async function () {
        return response(429, { error: { message: "slow down" } }, { "Retry-After": "0.2" });
    });
    assert(!direct429.ok && direct429.error.code === "RATE_LIMITED" && direct429.status === 429 &&
        direct429.error.status === 429 && direct429.retryAfterMs === 200 && direct429.error.retryAfterMs === 200 &&
        direct429.providerResponse && direct429.providerResponse.status === 429,
        `429 should retain structured provider timing: ${JSON.stringify(direct429)}`);

    // Executor shares the 429 cooldown; optional narrator work skips immediately and makes no model call.
    let rateCalls = 0;
    const rateLimitedClient = {
        enforceRequestTiming: true,
        chat: async function () {
            rateCalls++;
            return {
                ok: false, status: 429, content: "", usage: null, retryAfterMs: 250,
                error: { code: "RATE_LIMITED", message: "Rate limited fixture.", status: 429, retryAfterMs: 250 }
            };
        }
    };
    const executor429 = await setup.AIRequestExecutor.executeCustom({
        actorId: "hoodedWoman", purpose: "liveness-rate", stage: "test", client: rateLimitedClient,
        run: function (policyClient) { return policyClient.chat([{ role: "user", content: "rate" }]); }
    });
    assert(!executor429.ok && executor429.error.code === "RATE_LIMITED" && setup.AIRequestExecutor.isRateLimitCooldownActive(),
        "executor should enter shared provider cooldown after 429");
    let narratorTransportCalls = 0;
    const narratorClient = { chat: async function () { narratorTransportCalls++; return { ok: true, content: "should not run" }; } };
    fresh();
    const view = setup.CharacterAPI.getView("player");
    const staticNarration = await setup.NarratorService.describeLocation(view, narratorClient);
    const tickNarration = await setup.NarratorService.narrateTick({ view: view, entries: [] }, narratorClient);
    assert(staticNarration.skipped && staticNarration.attempted === false && staticNarration.error.code === "NARRATOR_SKIPPED_RATE_LIMIT" &&
        tickNarration.skipped && tickNarration.attempted === false && tickNarration.error.code === "NARRATOR_SKIPPED_RATE_LIMIT" && narratorTransportCalls === 0,
        "optional narrator work must make no transport call during shared rate-limit cooldown");

    // Wait out the short supplied cooldown, then verify missing Retry-After receives the executor fallback cooldown.
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    const fallbackClient = {
        enforceRequestTiming: true,
        chat: async function () { return { ok: false, status: 429, content: "", usage: null, retryAfterMs: null, error: { code: "RATE_LIMITED", message: "fallback fixture", status: 429 } }; }
    };
    const fallback429 = await setup.AIRequestExecutor.executeCustom({
        actorId: null, purpose: "liveness-rate-fallback", stage: "test", client: fallbackClient,
        run: function (policyClient) { return policyClient.chat([{ role: "user", content: "fallback" }]); }
    });
    const fallbackStatus = setup.AIRequestExecutor.getStatus();
    assert(!fallback429.ok && fallback429.error.code === "RATE_LIMITED" && fallbackStatus.rateLimitCooldownRemainingMs > 8000,
        `429 without Retry-After should use fallback cooldown: ${JSON.stringify(fallbackStatus)}`);

    // Use a fresh module-local executor context for canonical wave behavior so the fallback cooldown above does not suppress the fixture.
    // Reloading this file in the same VM is impossible without replacing setup, so clear only runtime wait by waiting is unnecessary:
    // scheduler uses the provided client and the current cooldown does not pre-suppress canonical requests.
    let world = fresh();
    ok(setup.Game.assignNonHumanController("blacksmith", "dummy"), "disable blacksmith for isolated wave");
    ok(setup.Game.assignNonHumanController("nell", "dummy"), "disable Nell for isolated wave");
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "enter room");
    ok(setup.CharacterAPI.narrate("player", { text: "Mara?", target_id: "hoodedWoman" }), "queue canonical reaction");
    const pendingBefore = world.entities.hoodedWoman.mind.pendingObservations.length;
    const waveRateClient = {
        // Do not enforce transport pacing here: the wave behavior itself is under test, while shared cooldown was tested above.
        enforceRequestTiming: false,
        chat: async function () {
            return { ok: false, status: 429, content: "", usage: null, retryAfterMs: 1200,
                error: { code: "RATE_LIMITED", message: "wave rate fixture", status: 429, retryAfterMs: 1200 } };
        }
    };
    const waveResult = await setup.AITurnScheduler.processWave(waveRateClient);
    world = setup.Game.getWorld();
    assert(!waveResult.ok && waveResult.error.code === "RATE_LIMITED" && /AI reaction\(s\) remain queued/.test(waveResult.error.message) &&
        world.entities.hoodedWoman.mind.pendingObservations.length === pendingBefore &&
        setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "hoodedWoman"; }),
        `rate-limited canonical wave must preserve inbox and queue: ${JSON.stringify(waveResult)}`);
    assert(idleStatus(), "canonical 429 must release controller/wave/executor busy state");

    console.log("All AI liveness tests passed.");
}

main().catch(function (error) { console.error(error); process.exit(1); });
