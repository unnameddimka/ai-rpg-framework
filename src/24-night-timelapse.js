(function () {
    "use strict";

    const MODE = "overnight";
    const ROUND_COUNT = 5;
    let inFlight = false;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }

    async function runOvernight(client, options) {
        options = options && typeof options === "object" ? options : {};
        if (inFlight) return failure("TIMELAPSE_IN_FLIGHT", "An overnight timelapse is already in progress.");
        if (setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight()) {
            return failure("TIMELAPSE_BUSY", "Another AI request is already in progress.");
        }
        const humanId = setup.Game.getHumanCharacterId();
        const world = setup.Game.getWorld();
        const human = world.entities[humanId];
        if (!human || human.sleeping !== true) return failure("HUMAN_NOT_SLEEPING", "The HumanController must be asleep before the overnight timelapse can begin.");
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            human.sleeping = false;
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before sleeping until morning.");
        }

        inFlight = true;
        try {
            const result = await setup.TimelapseCore.run(client, Object.assign({}, options, { mode: MODE, roundCount: ROUND_COUNT }));
            const currentWorld = setup.Game.getWorld();
            if (currentWorld.entities && currentWorld.entities[humanId]) currentWorld.entities[humanId].sleeping = false;
            const validation = setup.Game.validateWorld();
            if (!validation.ok) {
                return { ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                    hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(validation.error) };
            }
            return result;
        } finally {
            inFlight = false;
        }
    }

    setup.NightTimelapse = {
        ROUND_COUNT: ROUND_COUNT,
        run: runOvernight,
        isInFlight: function () { return inFlight; },
        validatePlan: function (value, catalog, remainingRounds) {
            return setup.TimelapseCore.validatePlan(value, catalog, remainingRounds);
        }
    };
}());
