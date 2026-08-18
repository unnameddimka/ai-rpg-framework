"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");

function storage() {
    const map = new Map();
    return { getItem: k => map.has(k) ? map.get(k) : null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) };
}
global.window = { localStorage: storage() };
global.localStorage = global.window.localStorage;
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }

load("src/00-model-list.js");
load("src/generated/world-data.js");
load("src/07-mind-v3.js"); load("src/08-mind-validators.js");
load("src/10-game-api.js");
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js"); load("src/13-verbatim-memory.js");
load("src/14-event-perception.js");
load("src/21-ai-settings.js");
load("src/21-ai-request-profiles.js");
load("src/22-openrouter-client.js");
load("src/23-ai-protocol.js");
load("src/24-ai-request-executor.js");
load("src/24-item-model-effects.js");
load("src/24-ai-turn-scheduler.js");
load("src/20-controllers.js");
load("src/15-ai-admin.js");
load("src/16-emergency-diagnostics.js");
load("src/17-runtime-diagnostics.js");
load("src/24-memory-consolidator.js"); load("src/24-mind-aux-executor.js");
load("src/24-prompt-lab.js");

function fresh() {
    setup.Game.resetWorld();
    setup.AITurnQueue.repair();
    return setup.Game.getWorld();
}
function place(character, location, world) {
    character.locationId = location.id;
    character.sublocationId = location.defaultSublocationId;
}
function clearRuntime(character) {
    character.mind.pendingObservations = [];
    character.recentDialogue = [];
}

async function main() {
    // Locked passage perception: source side is identified, far side is anonymous and scheduler-eligible even while sleeping.
    let world = fresh();
    const corridor = world.entities.upstairsCorridor;
    const room = world.entities.guestRoom1;
    place(world.entities.player, corridor, world);
    place(world.entities.captainPrice, corridor, world);
    place(world.entities.nell, room, world);
    place(world.entities.hoodedWoman, world.entities.villageTemple, world);
    ["player", "captainPrice", "nell", "hoodedWoman"].forEach(id => clearRuntime(world.entities[id]));
    world.ai.turnQueue = [];
    world.entities.nell.sleeping = true;
    const sourceLock = corridor.exits.guestRoom1.locked;
    const reciprocalLock = room.exits.upstairsCorridor.locked;
    const failed = setup.CharacterAPI.perform("player", { type: "move", destination_id: "guestRoom1" });
    assert(!failed.ok && failed.error.code === "PASSAGE_LOCKED", "locked traversal should fail as a grounded in-world attempt");
    assert(world.entities.player.locationId === "upstairsCorridor" && corridor.exits.guestRoom1.locked === sourceLock && room.exits.upstairsCorridor.locked === reciprocalLock,
        "locked attempt must not move the actor or mutate reciprocal lock state");
    assert(world.entities.player.mind.pendingObservations.some(o => o.kind === "action_feedback" && o.code === "PASSAGE_LOCKED"),
        "actor should receive grounded locked-door failure feedback");
    const sourceObservation = world.entities.captainPrice.mind.pendingObservations.find(o => o.eventType === "passage_interaction_attempted");
    const farObservation = world.entities.nell.mind.pendingObservations.find(o => o.eventType === "passage_interaction_attempted");
    assert(sourceObservation && sourceObservation.actorId === "player" && sourceObservation.text.includes("Traveler"),
        "source-side perceiver should receive the ordinary physical attempt with grounded identity");
    assert(farObservation && farObservation.actorId === null && farObservation.text === "Someone tried the door from the other side.",
        "far-side perceiver should hear the attempt without identity leakage");
    assert(world.entities.nell.sleeping === true && setup.AITurnQueue.getStatus().entries.some(e => e.characterId === "nell"),
        "sleeping far-side AI should remain sleeping but become reaction-eligible through its delivered observation");
    assert(world.entities.hoodedWoman.mind.pendingObservations.length === 0, "unrelated locations must not receive locked-door observations");
    const farProjected = setup.EventPerception.projectObservationForModel("nell", farObservation, world);
    assert(!Object.prototype.hasOwnProperty.call(farProjected, "actorId") && !JSON.stringify(farProjected).includes("player"),
        "far-side model projection must remain anonymous");

    // Inbox is authoritative; event acknowledgement follows observation consumption rather than maintaining pendingFor.
    const sourceEventId = farObservation.sourceEventId;
    ok(setup.AIMemory.consumeObservations("nell", [farObservation.id]), "consume far-side observation");
    assert(!world.entities.nell.mind.pendingObservations.some(o => o.id === farObservation.id), "consumption must remove authoritative inbox entry");
    const journalEvent = world.events.find(e => e.id === sourceEventId);
    assert(journalEvent && journalEvent.processedBy.includes("nell") && !Object.prototype.hasOwnProperty.call(journalEvent, "pendingFor"),
        "debug journal may record acknowledgement but must not retain a second pending source of truth");
    assert(!setup.Game.getPendingEventsFor("nell").some(e => e.id === sourceEventId), "getPendingEventsFor must agree with the inbox");

    // Structured human speech and rolling dialogue.
    world = fresh();
    const entrance = world.entities.tavernEntrance;
    ["player", "hoodedWoman", "captainPrice"].forEach(function (id) { place(world.entities[id], entrance, world); clearRuntime(world.entities[id]); });
    world.ai.turnQueue = [];
    const structured = ok(setup.CharacterAPI.narrate("player", {
        text: "Hello *smiles* there",
        target_id: "hoodedWoman",
        noticeability: "noticeable"
    }), "structured human narrative");
    assert(structured.event.text === "Hello *smiles* there" && structured.event.spokenText === "Hello there" && structured.event.publicNarrative === "smiles",
        "human RP text should preserve visible original while deriving speech and public narrative separately");
    assert(world.entities.player.recentDialogue.slice(-1)[0].text === "Hello there" && world.entities.hoodedWoman.recentDialogue.slice(-1)[0].text === "Hello there" &&
        world.entities.captainPrice.recentDialogue.slice(-1)[0].text === "Hello there",
        "speaker and perceivers should receive only spoken text in recent dialogue");

    // Regression: the real HumanController submitIntent path must not suppress parsed speech by forwarding spokenText: undefined.
    world.entities.player.recentDialogue = [];
    world.entities.hoodedWoman.recentDialogue = [];
    world.entities.captainPrice.recentDialogue = [];
    ok(setup.CharacterAPI.submitIntent("player", { text: "Traveler A", target_id: "hoodedWoman", noticeability: "hidden", action: null }),
        "human submitIntent dialogue A");
    ok(setup.CharacterAPI.submitIntent("hoodedWoman", { text: "Mara B", target_id: "player", noticeability: "hidden", action: null }),
        "Mara submitIntent dialogue B");
    ok(setup.CharacterAPI.submitIntent("player", { text: "Traveler C", target_id: "hoodedWoman", noticeability: "hidden", action: null }),
        "human submitIntent dialogue C");
    assert(world.entities.hoodedWoman.recentDialogue.map(function (entry) { return `${entry.speakerId}:${entry.text}`; }).join("|") ===
        "player:Traveler A|hoodedWoman:Mara B|player:Traveler C",
        "Mara rolling dialogue must interleave delivered HumanController speech with her own speech on the real submitIntent path");
    const beforeNarrativeOnly = world.entities.hoodedWoman.recentDialogue.length;
    ok(setup.CharacterAPI.narrate("player", { text: "*waves*", target_id: "hoodedWoman", noticeability: "noticeable" }), "narrative-only input");
    assert(world.entities.hoodedWoman.recentDialogue.length === beforeNarrativeOnly, "public behavior without speech must not become dialogue");
    const unmatched = setup.EventPerception.parseStructuredNarrative("Hello *unfinished gesture");
    assert(unmatched.spokenText === "Hello *unfinished gesture" && unmatched.publicNarrative === "", "unmatched asterisk must be treated conservatively as speech");

    world.entities.captainPrice.recentDialogue = [];
    for (let index = 0; index < 10; index++) {
        ok(setup.CharacterAPI.narrate("player", {
            text: `private line ${index}`,
            target_id: "hoodedWoman",
            noticeability: "hidden"
        }), "hidden dialogue fixture");
    }
    assert(world.entities.hoodedWoman.recentDialogue.length === 8 && world.entities.hoodedWoman.recentDialogue[0].text === "private line 2" &&
        world.entities.captainPrice.recentDialogue.length === 0,
        "dialogue window should cap at eight, evict oldest first, and exclude undelivered hidden speech");
    const context = setup.ContextBuilder.build("hoodedWoman");
    assert(context.recentDialogue.length === 8 && context.recentDialogue[7].speakerId === "player" && context.recentDialogue[7].text === "private line 9",
        "AI context should expose the bounded local dialogue window");
    const windowBeforeControlSwitch = clone(world.entities.hoodedWoman.recentDialogue);
    ok(setup.Game.takeHumanControl("hoodedWoman"), "switch Mara to human");
    ok(setup.Game.takeHumanControl("player"), "switch Mara back to authored controller");
    assert(JSON.stringify(world.entities.hoodedWoman.recentDialogue) === JSON.stringify(windowBeforeControlSwitch), "Human/AI control switching must preserve dialogue context");
    const savedDialogue = clone(world.entities.hoodedWoman.recentDialogue);
    State.variables.world = JSON.parse(JSON.stringify(world));
    ok(setup.Game.bootstrap(), "bootstrap JSON-restored world");
    assert(JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.recentDialogue) === JSON.stringify(savedDialogue), "save/load must preserve recent dialogue");

    const exportResult = ok(setup.CharacterMindTransfer.exportMind("hoodedWoman"), "export portable mind");
    assert(!Object.prototype.hasOwnProperty.call(exportResult.document.mind, "recentDialogue") && !Object.prototype.hasOwnProperty.call(exportResult.document, "recentDialogue"),
        "portable mind export must exclude transient dialogue context");
    assert(!JSON.stringify(exportResult.document).includes("mindMaintenanceSnapshots"),
        "portable mind export must exclude world-local maintenance rollback snapshots");
    world = setup.Game.getWorld();
    world.entities.hoodedWoman.recentDialogue = [{ speakerId: "player", text: "world-local sentinel", turn: 999, interactionId: 999 }];
    ok(setup.CharacterMindTransfer.importMind("hoodedWoman", exportResult.document), "reimport portable mind");
    assert(setup.Game.getWorld().entities.hoodedWoman.recentDialogue[0].text === "world-local sentinel", "portable mind import must not overwrite world-local dialogue context");

    // Compact observation projection removes engine metadata recursively while retaining grounded semantics.
    const compact = setup.EventPerception.projectObservationForModel("hoodedWoman", {
        id: 900, kind: "event", eventType: "character_moved", actorId: "nell", text: "Nell moved.",
        data: { type: "character_moved", fromLocationId: "bar", toLocationId: "commonRoom", recipients: ["x"], processedBy: ["y"], nested: { pendingFor: ["z"], itemId: "mug" } }
    }, setup.Game.getWorld());
    const compactJson = JSON.stringify(compact);
    assert(compact.data.fromLocationId === "bar" && compact.data.toLocationId === "commonRoom" && !compactJson.includes("recipients") && !compactJson.includes("processedBy") && !compactJson.includes("pendingFor"),
        "model observation projection should retain semantic movement data without scheduler/journal metadata");

    // Admin operations are atomic, non-story mutations and keep continuation/sleep semantics separate.
    world = fresh();
    const nell = world.entities.nell;
    nell.sleeping = true;
    const durableBefore = clone({
        beliefs: nell.mind.beliefs, relationships: nell.mind.relationships, shortTermMemories: nell.mind.shortTermMemories,
        longTermMemories: nell.mind.longTermMemories, knownFacts: nell.mind.knownFacts, wallet: nell.wallet,
        inventory: world.inventories[nell.inventoryId], locationId: nell.locationId, sleeping: nell.sleeping
    });
    setup.EventPerception.enqueueObservation("nell", { kind: "event", text: "admin fixture", actorId: "player", targetId: "nell" }, world);
    ok(setup.AIWorkingState.setContinuation("nell", "Finish serving the table."), "seed Nell continuation");
    const eventsCountBeforeAdmin = world.events.length;
    ok(setup.AIAdmin.dismissPendingReactions("nell"), "dismiss Nell reactions");
    world = setup.Game.getWorld();
    assert(world.entities.nell.mind.pendingObservations.length === 0 && !world.ai.turnQueue.some(e => e.characterId === "nell") &&
        world.ai.continuations.nell === "Finish serving the table.", "dismiss should clear inbox/queue but preserve continuation");
    ok(setup.AIAdmin.clearCurrentIntention("nell"), "clear Nell intention");
    assert(!Object.prototype.hasOwnProperty.call(setup.Game.getWorld().ai.continuations, "nell"), "clear intention should touch only continuation");
    setup.EventPerception.enqueueObservation("nell", { kind: "event", text: "second fixture", actorId: "player", targetId: "nell" }, setup.Game.getWorld());
    ok(setup.AIWorkingState.setContinuation("nell", "Another purpose."), "reseed continuation");
    ok(setup.AIAdmin.clearAIActivity("nell"), "clear selected AI activity");
    world = setup.Game.getWorld();
    const durableAfter = clone({
        beliefs: world.entities.nell.mind.beliefs, relationships: world.entities.nell.mind.relationships, shortTermMemories: world.entities.nell.mind.shortTermMemories,
        longTermMemories: world.entities.nell.mind.longTermMemories, knownFacts: world.entities.nell.mind.knownFacts, wallet: world.entities.nell.wallet,
        inventory: world.inventories[world.entities.nell.inventoryId], locationId: world.entities.nell.locationId, sleeping: world.entities.nell.sleeping
    });
    assert(JSON.stringify(durableBefore) === JSON.stringify(durableAfter) && world.events.length === eventsCountBeforeAdmin,
        "admin activity cleanup must not alter persistent mind/physical state, sleeping, or emit story events");

    ["hoodedWoman", "captainPrice", "nell"].forEach(function (id) {
        setup.EventPerception.enqueueObservation(id, { kind: "event", text: `pending ${id}`, actorId: "player", targetId: id }, world);
        setup.AIWorkingState.setContinuation(id, `purpose ${id}`);
    });
    world.entities.player.mind.pendingObservations.push({ id: world.nextObservationId++, kind: "event", text: "human pending" });
    const humanPending = world.entities.player.mind.pendingObservations.length;
    ok(setup.AIAdmin.clearAllAIActivity({ keepCharacterIds: ["hoodedWoman"] }), "global clear with keep list");
    world = setup.Game.getWorld();
    assert(world.entities.hoodedWoman.mind.pendingObservations.length > 0 && world.ai.continuations.hoodedWoman &&
        world.entities.captainPrice.mind.pendingObservations.length === 0 && world.entities.nell.mind.pendingObservations.length === 0 &&
        !world.ai.continuations.captainPrice && !world.ai.continuations.nell && world.entities.player.mind.pendingObservations.length === humanPending,
        "global clear should affect non-kept AI only and never clear HumanController state");

    setup.EventPerception.enqueueObservation("nell", { kind: "event", text: "queue-only fixture", actorId: "player", targetId: "nell" }, world);
    setup.AITurnQueue.repair();
    const inboxBeforeRemove = world.entities.nell.mind.pendingObservations.length;
    ok(setup.AIAdmin.removeFromQueue("nell"), "queue-only diagnostic removal");
    assert(!world.ai.turnQueue.some(e => e.characterId === "nell") && world.entities.nell.mind.pendingObservations.length === inboxBeforeRemove,
        "queue-only diagnostic removal must leave inbox intact");
    setup.AITurnQueue.repair();
    assert(setup.AITurnQueue.getStatus().entries.some(e => e.characterId === "nell"), "queue repair should re-derive eligibility from pending inbox");

    let releaseBusy;
    const busyPromise = setup.AIRequestExecutor.executeCustom({ actorId: null, purpose: "quality-busy", stage: "test", messages: [] , run: function () {
        return new Promise(function (resolve) { releaseBusy = resolve; });
    }});
    const busyAdmin = setup.AIAdmin.clearAIActivity("nell");
    assert(!busyAdmin.ok && busyAdmin.error.code === "AI_ADMIN_BUSY", "admin mutation must reject while model execution is queued/in flight");
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert(typeof releaseBusy === "function", "busy fixture should have entered executor operation");
    releaseBusy({ ok: true, value: null, error: null });
    await busyPromise;

    // Portable Mind v3 carries durable state + bounded verbatim; v2 imports migrate deterministically without preserving the obsolete archive as active cognition.
    world = fresh();
    const mara = world.entities.hoodedWoman;
    mara.mind.beliefs = [{ id: "portable_v3_belief", text: "The Traveler is unusual.", confidence: 0.7, activation: 0.55 }];
    mara.mind.shortTermMemories = [{ id: "memory_ai_501", topic: "Traveler", summary: "The Traveler made an unusual promise.", importance: 0.7, protected: false }];
    mara.mind.longTermMemories = [{ id: "memory_ai_502", topic: "World changes", summary: "World changes can preserve personal continuity.", importance: 0.9, protected: true }];
    mara.mind.verbatimObservations = [{ id: "verbatim_hoodedWoman_portable_1", turn: 10, kind: "observation", actorId: "player", text: "The Traveler promised to warn me before the next reset." }];
    const v3Export = ok(setup.CharacterMindTransfer.exportMind("hoodedWoman"), "export Mind v3");
    assert(v3Export.document.version === 3 && v3Export.document.mind.schemaVersion === 3 &&
        v3Export.document.mind.shortTermMemories[0].id === "memory_ai_501" &&
        v3Export.document.mind.verbatimObservations[0].id === "verbatim_hoodedWoman_portable_1" &&
        !Object.prototype.hasOwnProperty.call(v3Export.document.mind, "maintenanceArchive"),
        "portable Mind v3 should carry STM/LTM/beliefs/relationships/verbatim but not the obsolete v2 archive");
    const legacyV2 = {
        schema: "ai-rpg.character-mind", version: 2, exportedAt: "2026-08-15T00:00:00.000Z", characterId: "hoodedWoman", characterName: "Mara the Hedge Witch",
        mind: {
            beliefs: [{ id: "legacy_belief", text: "Old understanding.", confidence: "low" }],
            relationships: [{ targetCharacterId: "player", summary: "A remembered acquaintance." }],
            recentMemories: [{ id: "memory_ai_601", summary: "Legacy recent memory.", importance: 0.5, protected: false }],
            longTermMemories: [{ id: "memory_ai_602", summary: "Legacy durable memory.", importance: 0.8, protected: true }],
            maintenanceArchive: { memories: [{ record: { id: "ignored_archive_memory" } }], beliefs: [] }
        }
    };
    assert(setup.CharacterMindTransfer.validateDocument(legacyV2, "hoodedWoman").ok, "portable mind v2 must remain importable");
    setup.Game.resetWorld();
    ok(setup.CharacterMindTransfer.importMind("hoodedWoman", legacyV2), "import v2 mind into v3");
    const migratedPortable = setup.Game.getWorld().entities.hoodedWoman.mind;
    assert(migratedPortable.schemaVersion === 3 && migratedPortable.shortTermMemories[0].id === "memory_ai_601" &&
        migratedPortable.shortTermMemories[0].summary === "Legacy recent memory." && migratedPortable.longTermMemories[0].id === "memory_ai_602" &&
        migratedPortable.beliefs[0].id === "legacy_belief" && migratedPortable.beliefs[0].confidence === 0.3 && migratedPortable.beliefs[0].activation === setup.MindV3.CONFIG.MIGRATED_BELIEF_ACTIVATION &&
        migratedPortable.verbatimObservations.length === 0 && !Object.prototype.hasOwnProperty.call(migratedPortable, "maintenanceArchive"),
        "v2 portable import must preserve active identity/history deterministically, initialize neutral activation, and never fabricate verbatim from summaries");

    // Shared validators govern stored state and preserve historical portable relationships.
    world = fresh();
    let invalidWorld = clone(world);
    invalidWorld.entities.hoodedWoman.mind.beliefs.push({ id: "bad id", text: "bad", confidence: 0.8, activation: 0.5 });
    assert(!setup.GameInternals.validateWorld(invalidWorld).ok, "validateWorld must reject malformed stored beliefs");
    invalidWorld = clone(world);
    invalidWorld.entities.hoodedWoman.mind.shortTermMemories.push({ id: "broken", topic: "", summary: "", importance: 2, protected: false });
    assert(!setup.GameInternals.validateWorld(invalidWorld).ok, "validateWorld must reject malformed stored memories");
    const badRelationship = setup.AIMemory.applyTurnUpdates("hoodedWoman", {
        relationshipsToUpsert: [{ targetCharacterId: "historical_missing_person", summary: "Old acquaintance." }], activatedBeliefIds: []
    });
    assert(!badRelationship.ok, "live relationship update must require a current character target");
    const historicalDoc = ok(setup.CharacterMindTransfer.exportMind("hoodedWoman"), "historical relationship fixture").document;
    historicalDoc.mind.relationships.push({ targetCharacterId: "historical_missing_person", summary: "Someone remembered from another timeline." });
    assert(setup.CharacterMindTransfer.validateDocument(historicalDoc, "hoodedWoman").ok,
        "portable historical relationship should preserve an absent target character");

    // Emergency diagnostics are best-effort, comprehensive, and redact secrets without requiring a second Sphere export.
    setup.AITransientDebug = { apiKey: "DO-NOT-EXPORT", nested: { authorization: "Bearer hidden", useful: "keep-me" } };
    await setup.AIRequestExecutor.executeCustom({
        actorId:"hoodedWoman", purpose:"diagnostic-fixture", stage:"diagnostic-fixture", messages:[{role:"user",content:"fixture"}],
        run:async function(){return {ok:true,value:{sentinel:"exchange-history-present"},modelId:"test",usage:null,rawContent:"{}",trace:null};}
    });
    setup.EmergencyDiagnostics.recordTimelapseResult({ok:false,mode:"overnight",committedRounds:5,failedStage:"maintenance-commit",error:{code:"SYNTHETIC_TIMELAPSE_FAILURE",message:"handled coarse-time failure"}});
    setup.EmergencyDiagnostics.recordError("synthetic-test", new Error("diagnostic sentinel"));
    const aiToken=setup.RuntimeDiagnostics.beginAITransport({actorId:"hoodedWoman",purpose:"fixture",stage:"fixture",modelId:"test",provider:"OpenRouter",endpoint:"https://openrouter.ai/api/v1/chat/completions",attempt:1});
    setup.RuntimeDiagnostics.completeAITransport(aiToken,{ok:false,status:503,statusText:"Unavailable",error:{code:"PROVIDER_UNAVAILABLE",message:"synthetic transport failure"},rawContent:"",providerResponse:{status:503}});
    const netToken=setup.RuntimeDiagnostics.beginNetwork ? setup.RuntimeDiagnostics.beginNetwork({purpose:"weather-refresh",stage:"ip-geolocation",service:"fixture",url:"https://example.invalid/"}) : null;
    if(netToken&&setup.RuntimeDiagnostics.completeNetwork) setup.RuntimeDiagnostics.completeNetwork(netToken,{ok:false,status:0,error:{code:"NETWORK_FETCH_FAILED",message:"synthetic network failure"}});
    setup.WorldEnvironment={getWeatherDiagnostics:function(){return {ok:false,failedStage:"ip-geolocation",fallbackUsed:true,error:{code:"WEATHER_REFRESH_FAILED",message:"synthetic weather failure"}};}};
    const emergency = setup.EmergencyDiagnostics.capture();
    const emergencyJson = JSON.stringify(emergency);
    assert(emergency.schema === "ai-rpg.emergency-dump" && emergency.version === 3 && emergency.sections["game-state.json"].world &&
        emergency.sections["ui-runtime.json"].transientDebug.nested.useful === "keep-me" && emergency.sections["minds.json"].characters.hoodedWoman.mind.schemaVersion === 3 &&
        emergency.sections["scheduler-state.json"].mindAuxExecutor && emergency.sections["ai-exchange-log.json"].schema === "ai-rpg.ai-exchange-log" && emergency.sections["ai-exchange-log.json"].exchangeHistory.count > 0 &&
        emergency.sections["ai-transport-log.json"].count === 1 && emergency.sections["ai-transport-log.json"].entries[0].error.code === "PROVIDER_UNAVAILABLE" &&
        emergency.sections["network-log.json"] && emergency.sections["weather-runtime.json"].failedStage === "ip-geolocation" &&
        emergency.sections["timelapse-runtime.json"].lastResult.failedStage === "maintenance-commit" && emergency.sections["timelapse-runtime.json"].lastResult.error.code === "SYNTHETIC_TIMELAPSE_FAILURE",
        "emergency dump should contain game/mind state, semantic and transport AI logs, network/weather diagnostics, and handled coarse-time failure diagnostics");
    assert(!emergencyJson.includes("DO-NOT-EXPORT") && !emergencyJson.includes("Bearer hidden") &&
        emergencyJson.includes("[REDACTED]") && emergencyJson.includes("diagnostic sentinel"),
        "emergency dump must redact API/auth secrets while retaining captured runtime errors");
    const oldGetStatus = setup.AIRuntimeSettings.getStatus;
    setup.AIRuntimeSettings.getStatus = function () { throw new Error("broken settings fixture"); };
    const partialEmergency = setup.EmergencyDiagnostics.capture();
    setup.AIRuntimeSettings.getStatus = oldGetStatus;
    assert(partialEmergency.sections["game-state.json"] && partialEmergency.sections["ui-runtime.json"].captureError &&
        partialEmergency.captureErrors.some(function (entry) { return entry.section === "ui-runtime.json"; }),
        "one broken diagnostic section must not prevent the rest of an emergency dump from being captured");
    const zipBytes = setup.EmergencyDiagnostics.buildStoredZip({ "manifest.json": "{}", "game-state.json": "{}" });
    assert(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b && zipBytes.length > 40, "emergency diagnostic packager should emit a real ZIP container");

    console.log("All quality-pass core tests passed.");
}

main().catch(function (error) {
    console.error(error && error.stack || error);
    process.exit(1);
});
