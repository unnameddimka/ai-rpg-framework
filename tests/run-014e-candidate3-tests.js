"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fresh() {
    setup.Game.resetWorld();
    setup.Game.acceptPlayerDisclaimer();
    setup.Game.acknowledgeAISetup();
    setup.Game.finalizePlayerSetup({ mode: "generic" });
    return setup.Game.getWorld();
}

runtimeFiles.augment([
    "src/00-model-list.js", "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js", "src/10-game-api.js",
    "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js", "src/13-verbatim-memory.js", "src/14-event-perception.js",
    "src/17-runtime-diagnostics.js", "src/21-ai-settings.js", "src/21-ai-request-profiles.js", "src/23-ai-protocol.js", "src/23-world-environment.js", "src/24-timelapse-core.js"
]).forEach(load);

(function stageA() {
    const product = JSON.parse(fs.readFileSync(path.join(root, "data/product.json"), "utf8"));
    assert((product.version === "0.1.4e-candidate3" || /^0\.1\.4f-playtest\d+$/.test(product.version)), "candidate3 product version must be authored");
    const expectedGameKeys = [
        "AbilityEffectRegistry", "ActionRegistry", "ItemEffectRegistry", "TimelapseEffectRegistry", "WORLD_SCHEMA_VERSION", "WORLD_VERSION",
        "acceptPlayerDisclaimer", "acknowledgeAISetup", "acknowledgeEvent", "assignNonHumanController", "bootstrap", "canReachCharacter",
        "createInitialWorld", "finalizePlayerSetup", "getBuildProfile", "getHumanCharacterId", "getPendingEventsFor", "getPlayerSetup",
        "getRequiredDisclosureVersion", "getWorld", "isPlayerSetupComplete", "isPublicDisclosureRequired", "logController", "resetWorld",
        "takeHumanControl", "updateCharacterProfile", "validateHumanControllerInvariant", "validateWorld"
    ].sort();
    assert(JSON.stringify(Object.keys(setup.Game).sort()) === JSON.stringify(expectedGameKeys), "setup.Game facade must remain exact across Stage A extraction");

    const expectedActionTypes = [
        "authored_interaction", "consume", "defer_departure", "drop_item", "equip", "fill", "give_item", "give_money", "go_hunting", "lock",
        "move", "move_within_location", "offer_day_work", "place_item", "read_paper", "serve_food", "show_hidden_location", "sleep", "take_item",
        "transfer_items", "unequip", "unlock", "use_ability", "use_item", "write_paper"
    ].sort();
    assert(JSON.stringify(Object.keys(setup.Game.ActionRegistry).sort()) === JSON.stringify(expectedActionTypes), "action catalog types must remain exact after extraction");
    expectedActionTypes.forEach(function (type) {
        const definition = setup.Game.ActionRegistry[type];
        assert(typeof definition.aiDescription === "string" && Array.isArray(definition.aiPrerequisites), `${type} must retain attached AI metadata`);
    });

    const expectedInternals = [
        "CONTROLLER_IDS", "LEGACY_WORLD_VERSION", "SUPPORTED_MIGRATION_SCHEMA_VERSIONS", "WORLD_SCHEMA_VERSION",
        "applyItemConsume", "applyTravelerIdentity", "characterHasDiscoveredCharacter", "characterHasDiscoveredLocation", "characterRequiresDiscovery",
        "clone", "createInitialWorld", "currentAuthoringRevision", "enqueueAITurn", "enqueueObservation", "ensureWorld", "eventTouchesUndiscoveredCharacter",
        "eventTouchesUndiscoveredLocation", "fail", "getCharacter", "getCharacters", "getLocation", "getSublocation", "getWorldTransactionDebug",
        "grantCharacterDiscovery", "grantLocationDiscovery", "instantiateDeferredCharacter", "inventoryItems", "itemInstanceDisplayName", "locationExitEntries", "locationRequiresDiscovery",
        "normalizeCharacterDiscoveries", "normalizeCharacterDiscoveriesByCharacter", "normalizePlayerSetup", "ok", "positionText", "pushDebugLog",
        "repairAIQueue", "repairControlInvariant", "resetWorldTransactionDebug", "restoreWorldInPlace", "runAuthoredOutcomeTable", "snapshotWorld",
        "synchronizeDerivedItemPlacement", "transferItem", "transformItem", "validCustomTravelerAuthoring", "validateControlAssignments", "validateWorld"
    ].sort();
    assert(JSON.stringify(Object.keys(setup.GameInternals).sort()) === JSON.stringify(expectedInternals), "GameInternals must not re-expand during module extraction");

    const world = fresh();
    const view = setup.CharacterAPI.getView("player");
    const expectedOptions = {
        move: { destination_ids: ["bar", "commonRoom", "street"], speech_targets_by_destination: {} },
        drop_item: { item_ids: ["silverChain_01"] },
        equip: { item_ids: ["silverChain_01"], items: [{ id: "silverChain_01", name: "Silver chain", slots: ["neck"] }] },
        unequip: { item_ids: ["travelerClothing_01"], items: [{ id: "travelerClothing_01", name: "Traveler's clothes", slot: "clothing" }] },
        transfer_items: { routes: [{ source_inventory_id: "inventory_player", target_inventory_id: "inventory_tavernEntrance", direction: "character_to_container", label: "Put items in Tavern entrance", item_ids: ["silverChain_01"] }] }
    };
    Object.entries(expectedOptions).forEach(function (entry) {
        assert(JSON.stringify(view.available_actions[entry[0]].options) === JSON.stringify(entry[1]), `${entry[0]} options must match candidate2 deterministic fixture`);
    });
    assert(setup.Game.validateWorld(world).ok, "Stage A fixture must remain world-valid");

    const gameSource = fs.readFileSync(path.join(root, "src/10-game-api.js"), "utf8");
    const itemSource = fs.readFileSync(path.join(root, "src/10-game-00-item-mechanics.js"), "utf8");
    const validationSource = fs.readFileSync(path.join(root, "src/10-game-01-validation.js"), "utf8");
    const actionSource = fs.readFileSync(path.join(root, "src/10-game-02-actions.js"), "utf8");
    const runtimeSource = fs.readFileSync(path.join(root, "tests/runtime-files.js"), "utf8");
    assert(!gameSource.includes("const ActionRegistry = {") && actionSource.includes("const ActionRegistry = {"), "ActionRegistry must be owned by GameActions");
    assert(!gameSource.includes("function validateItemInvariants(") && validationSource.includes("function validateItemInvariants("), "runtime validation must be owned by GameValidation");
    assert(!gameSource.includes("function applyItemConsume(") && itemSource.includes("function applyItemConsume("), "generic item mechanics must be owned by GameItemMechanics");
    ["10-game-00-item-mechanics.js", "10-game-01-validation.js", "10-game-02-actions.js"].forEach(function (name) {
        assert(runtimeSource.includes(name), `${name} must be represented in canonical runtime test ordering`);
    });

    console.log("0.1.4e-candidate3 Stage A architecture tests passed.");
}());

(function stageB() {
    ["tradeKnowledge", "runArrivalHooks", "restockCharacter", "settleDeparture", "noteItemTransfer"].forEach(function (name) {
        assert(!(name in setup.WeeklyRhythm), `WeeklyRhythm must not retain trade lifecycle method ${name}`);
        assert(setup.TradeLifecycle && typeof setup.TradeLifecycle[name] === "function", `TradeLifecycle must own ${name}`);
    });
    const world = fresh();
    const trade = setup.TradeLifecycle.tradeKnowledge("roadMerchant", world);
    assert(trade && trade.currentWallet === 60 && trade.saleStockInventoryId === "inventory_merchantSaleChest" && trade.currentSaleStockCount === 20, "trade knowledge must preserve candidate2 merchant stock/wallet grounding");
    assert(JSON.stringify(trade.externalSaleValues) === JSON.stringify([
        { definitionId: "healingSalve", name: "Healing Salve", externalSaleValue: 6 },
        { definitionId: "staminaPotion", name: "Stamina Potion", externalSaleValue: 7 },
        { definitionId: "squirrelPelt", name: "Squirrel Pelt", externalSaleValue: 2 }
    ]), "trade knowledge external values must remain exact");
    const privateContext = setup.CharacterContext.buildPrivateCharacter("roadMerchant");
    assert(privateContext.tradeKnowledge && JSON.stringify(privateContext.tradeKnowledge) === JSON.stringify(trade), "CharacterContext must receive trade grounding from TradeLifecycle unchanged");

    const weeklySource = fs.readFileSync(path.join(root, "src/10-weekly-rhythm.js"), "utf8");
    const tradeSource = fs.readFileSync(path.join(root, "src/10-trade-lifecycle.js"), "utf8");
    assert(!weeklySource.includes("function tradeKnowledge(") && tradeSource.includes("function tradeKnowledge("), "trade knowledge implementation must move out of WeeklyRhythm");
    assert(!weeklySource.includes("function settleDeparture(") && tradeSource.includes("function settleDeparture("), "departure settlement implementation must move out of WeeklyRhythm");
    assert(!weeklySource.includes("function noteItemTransfer(") && tradeSource.includes("function noteItemTransfer("), "trade transfer provenance must move out of WeeklyRhythm");
    assert(fs.readFileSync(path.join(root, "src/10-game-00-item-mechanics.js"), "utf8").includes("setup.TradeLifecycle.noteItemTransfer"), "item transfer must route provenance through TradeLifecycle");
    console.log("0.1.4e-candidate3 Stage B trade lifecycle tests passed.");
}());

(function stageC() {
    assert(setup.TimelapseProtocol && typeof setup.TimelapseProtocol.requestPlan === "function" && typeof setup.TimelapseProtocol.requestReflection === "function", "TimelapseProtocol must own planner/reflection request surfaces");
    assert(typeof setup.TimelapseCore.run === "function" && typeof setup.TimelapseCore.validatePlan === "function", "TimelapseCore must retain execution plus compatibility validation facade");
    const protocolSource = fs.readFileSync(path.join(root, "src/23-timelapse-protocol.js"), "utf8");
    const coreSource = fs.readFileSync(path.join(root, "src/24-timelapse-core.js"), "utf8");
    const daytimeSource = fs.readFileSync(path.join(root, "src/24-daytime-timelapse.js"), "utf8");
    assert(protocolSource.includes("async function requestPlan(") && protocolSource.includes("async function requestReflection("), "timelapse model request implementations must live in protocol module");
    assert(!coreSource.includes("async function requestPlan(") && !coreSource.includes("function plannerSystem(") && coreSource.includes("snapshot") && coreSource.includes("lastCommittedWorld"), "TimelapseCore must keep transactions while shedding model protocol ownership");
    assert(daytimeSource.includes("setup.StructuredAIRequest.run") && !daytimeSource.includes("function parseJsonObject(") && !daytimeSource.includes("for (let attempt = 0; attempt < 2; attempt++)"), "sponsor settlement must use common structured request lifecycle rather than private parse/repair loop");
    assert(fs.readFileSync(path.join(root, "tests/runtime-files.js"), "utf8").includes('"src/24-timelapse-core.js", ["src/23-timelapse-protocol.js"]'), "TimelapseProtocol must be represented in canonical runtime ordering");
    console.log("0.1.4e-candidate3 Stage C protocol split tests passed.");
}());


(function stageD() {
    assert(setup.ActionOptionValidation && typeof setup.ActionOptionValidation.validate === "function", "shared action option validator must be loaded");

    function response(action) {
        return {
            action: action,
            publicNarrative: null,
            spokenText: null,
            spokenTargetId: null,
            spokenLoudness: null,
            continuation: null,
            memoryUpdates: { relationshipsToUpsert: [], activatedBeliefIds: [] }
        };
    }
    function definition(type, field, optionKey, allowed) {
        const properties = { type: { const: type } };
        properties[field] = { type: "string" };
        const options = {};
        options[optionKey] = allowed.slice();
        return { schema: { properties: properties, required: ["type", field] }, options: options };
    }
    function decision(action, catalog) {
        return setup.AIProtocol.validateDecision(response(action), catalog, [], [], []);
    }

    const scalarCases = [
        ["offer_day_work", "activity_id", "activity_ids", "work_a"],
        ["use_ability", "ability_id", "ability_ids", "ability_a"],
        ["authored_interaction", "interaction_id", "interaction_ids", "interaction_a"],
        ["serve_food", "serving_action_id", "serving_action_ids", "serving_a"],
        ["show_hidden_location", "location_id", "location_ids", "location_a"]
    ];
    scalarCases.forEach(function (record) {
        const type = record[0], field = record[1], optionKey = record[2], legal = record[3];
        const def = definition(type, field, optionKey, [legal]);
        if (type === "show_hidden_location") {
            def.schema.properties.target_id = { type: "string" };
            def.schema.required.push("target_id");
            def.options.target_ids = ["target_a"];
            def.options.locations = [{ id: legal, target_ids: ["target_a"] }];
        }
        const catalog = {}; catalog[type] = def;
        const legalAction = { type: type }; legalAction[field] = legal;
        const illegalAction = { type: type }; illegalAction[field] = `${legal}_missing`;
        if (type === "show_hidden_location") { legalAction.target_id = "target_a"; illegalAction.target_id = "target_a"; }
        assert(decision(legalAction, catalog).ok, `${field} legal option must remain accepted`);
        assert(!decision(illegalAction, catalog).ok, `${field} unavailable option must be rejected by AI protocol`);
    });

    const bulkCatalog = {
        transfer_items: {
            schema: {
                properties: { type: { const: "transfer_items" }, source_inventory_id: { type: "string" }, target_inventory_id: { type: "string" }, item_ids: { type: "array" } },
                required: ["type", "source_inventory_id", "target_inventory_id", "item_ids"]
            },
            options: { routes: [{ source_inventory_id: "source_a", target_inventory_id: "target_a", item_ids: ["item_a"] }] }
        }
    };
    assert(decision({ type: "transfer_items", source_inventory_id: "source_a", target_inventory_id: "target_a", item_ids: ["item_a"] }, bulkCatalog).ok,
        "legal bulk-transfer route must remain accepted");
    assert(!decision({ type: "transfer_items", source_inventory_id: "source_a", target_inventory_id: "target_missing", item_ids: ["item_a"] }, bulkCatalog).ok,
        "unavailable bulk-transfer route must be rejected by AI protocol");
    assert(!decision({ type: "transfer_items", source_inventory_id: "source_a", target_inventory_id: "target_a", item_ids: ["item_missing"] }, bulkCatalog).ok,
        "bulk-transfer item outside selected route must be rejected by AI protocol");

    const hiddenCatalog = {
        show_hidden_location: {
            schema: {
                properties: { type: { const: "show_hidden_location" }, location_id: { type: "string" }, target_id: { type: "string" } },
                required: ["type", "location_id", "target_id"]
            },
            options: {
                location_ids: ["location_a", "location_b"],
                target_ids: ["target_a", "target_b"],
                locations: [
                    { id: "location_a", target_ids: ["target_a"] },
                    { id: "location_b", target_ids: ["target_b"] }
                ]
            }
        }
    };
    assert(decision({ type: "show_hidden_location", location_id: "location_a", target_id: "target_a" }, hiddenCatalog).ok,
        "legal hidden-location location/target pair must remain accepted");
    assert(!decision({ type: "show_hidden_location", location_id: "location_a", target_id: "target_b" }, hiddenCatalog).ok,
        "individually legal but mismatched hidden-location target/location pair must be rejected");

    const pureAction = { type: "equip", item_id: "chain", slot: "neck" };
    const pureDefinition = {
        options: { item_ids: ["chain"], items: [{ id: "chain", slots: ["neck"] }] }
    };
    const beforeAction = clone(pureAction);
    const beforeDefinition = clone(pureDefinition);
    assert(setup.ActionOptionValidation.validate(pureAction, pureDefinition).length === 0, "shared validator must accept legal option fixture");
    assert(JSON.stringify(pureAction) === JSON.stringify(beforeAction) && JSON.stringify(pureDefinition) === JSON.stringify(beforeDefinition),
        "shared action option validation must be pure and not mutate action or option catalog");

    const gameSource = fs.readFileSync(path.join(root, "src/10-game-api.js"), "utf8");
    const aiSource = fs.readFileSync(path.join(root, "src/23-ai-protocol.js"), "utf8");
    const sharedSource = fs.readFileSync(path.join(root, "src/09-action-option-validation.js"), "utf8");
    assert(gameSource.includes("setup.ActionOptionValidation.validate(action, actionDefinition)"), "Game preflight contract validation must use shared option validator");
    assert(aiSource.includes("setup.ActionOptionValidation.validate(action, actionDefinition)"), "AI protocol must use shared option validator");
    assert(sharedSource.includes('activity_id: "activity_ids"') && sharedSource.includes('serving_action_id: "serving_action_ids"') && sharedSource.includes("bulk_transfer_route_unavailable"),
        "shared validator must own the expanded option relationships rather than a second protocol-local list");
    assert(gameSource.includes("const contractValidation = validateActionRequest(actorId, action);") && gameSource.includes("postStartContractFailure"),
        "submit-time canonical revalidation path must remain present for same-tick TOCTOU failures");
    assert(fs.readFileSync(path.join(root, "tests/runtime-files.js"), "utf8").includes("09-action-option-validation.js"),
        "shared validator must be represented in canonical runtime test ordering");

    console.log("0.1.4e-candidate3 Stage D shared option validation tests passed.");
}());

(async function stageDRepairEligibility() {
    const catalog = {
        offer_day_work: definitionForRepair()
    };
    function definitionForRepair() {
        return {
            schema: { properties: { type: { const: "offer_day_work" }, activity_id: { type: "string" } }, required: ["type", "activity_id"] },
            options: { activity_ids: ["work_a"] }
        };
    }
    function responseForRepair(activityId) {
        return JSON.stringify({
            action: { type: "offer_day_work", activity_id: activityId },
            publicNarrative: null,
            spokenText: null,
            spokenTargetId: null,
            spokenLoudness: null,
            continuation: null,
            memoryUpdates: { relationshipsToUpsert: [], activatedBeliefIds: [] }
        });
    }
    const messages = [{ role: "user", content: JSON.stringify({ context: { view: { available_actions: catalog, location: { characters: [] } }, mindContext: { beliefs: [], relationships: [] } } }) }];
    let calls = 0;
    const result = await setup.AIProtocol.requestValidated(messages, "decision", {
        chat: async function () {
            calls += 1;
            return { ok: true, content: responseForRepair(calls === 1 ? "work_missing" : "work_a") };
        }
    });
    assert(result.ok && result.repaired === true && calls === 2 && result.trace.attempts.some(function (attempt) { return attempt.kind === "repair"; }),
        "newly rejected illegal action option must enter the existing single-repair lifecycle and accept a legal repair");
    console.log("0.1.4e-candidate3 Stage D repair-eligibility test passed.");
}()).catch(function (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
