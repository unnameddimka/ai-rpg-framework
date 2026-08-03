"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const context = {
    setup: {},
    State: { variables: {} },
    document: {},
    Engine: {},
    $: function () { return { on: function () {} }; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "src/30-game-ui.js"), "utf8"), context, { filename: "30-game-ui.js" });
const model = context.setup.AbilityUIModel;
function assert(condition, message) { if (!condition) throw new Error(message); }
function viewFor(actorId, abilityIds, grant) {
    return {
        self: {
            id: actorId,
            abilities: abilityIds.map(function (id) {
                return { id: id, name: "Read aura", playerDescription: "Sense nearby auras.", actionType: "read_aura" };
            })
        },
        available_actions: grant ? {
            read_aura: {
                schema: { type: "object", properties: { type: { const: "read_aura" } }, required: ["type"] },
                sources: [{ kind: "character_ability", id: "readAura", name: "Read aura" }]
            }
        } : {}
    };
}

for (const actorId of ["player", "innkeeper", "futureCharacter"]) {
    const buttons = model.discoverAvailableAbilities(viewFor(actorId, ["readAura"], true));
    assert(buttons.length === 1 && buttons[0].actionType === "read_aura", `${actorId} should receive the same generic ability model`);
}
const controlledPlayerView = viewFor("player", [], false);
const controlledInnkeeperView = viewFor("innkeeper", ["readAura"], true);
assert(model.discoverAvailableAbilities(controlledPlayerView).length === 0 &&
    model.discoverAvailableAbilities(controlledInnkeeperView).length === 1,
    "switching HumanController should recalculate controls entirely from the new actor view");
assert(model.discoverAvailableAbilities(viewFor("hoodedWoman", [], true)).length === 0,
    "an action grant without an assigned ability should not render a control");
assert(model.discoverAvailableAbilities(viewFor("hoodedWoman", ["readAura"], false)).length === 0,
    "an assigned but unavailable ability should not render a control");
const parameterized = viewFor("player", ["readAura"], true);
parameterized.available_actions.read_aura.schema.properties.target_id = { type: "string" };
assert(model.discoverAvailableAbilities(parameterized).length === 0,
    "the milestone renderer should not guess parameters for parameterized actions");

const escaped = model.abilityResultMarkup({ ok: true, feedback: [{ code: "AURA_SCAN_RESULT", text: "Read.", data: {
    results: [{ name: "<img src=x onerror=alert(1)>", aura: "<& dangerous>" }]
} }] });
assert(!escaped.includes("<img") && escaped.includes("&lt;img") && escaped.includes("&lt;&amp; dangerous&gt;"),
    "structured aura result names and text should be HTML escaped");
const escapedError = model.abilityResultMarkup({ ok: false, error: { message: "<unsafe failure>" } });
assert(escapedError.includes("&lt;unsafe failure&gt;") && !escapedError.includes("<unsafe failure>"),
    "ability execution errors should be escaped for the normal result area");
const state = { abilityResultsByActor: { player: { ok: true, marker: "private-player" }, innkeeper: { ok: true, marker: "private-innkeeper" } } };
assert(model.getActorAbilityResult(state, "player").marker === "private-player" &&
    model.getActorAbilityResult(state, "innkeeper").marker === "private-innkeeper" &&
    model.getActorAbilityResult(state, "hoodedWoman") === null,
    "displayed private results should be isolated by controlled actor ID");

console.log("All ability UI tests passed.");
