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


    function setTimePhase(phase) {
        if (setup.WorldEnvironment && typeof setup.WorldEnvironment.setTimePhase === "function") {
            const result = setup.WorldEnvironment.setTimePhase(phase);
            if (result && result.ok) return result;
        }
        const world = setup.Game.getWorld();
        if (!world.environment) world.environment = {};
        world.environment.timePhase = phase;
        const labels = { evening: "Evening", nighttime_timelapse: "Night", morning: "Morning", daytime_timelapse: "Day" };
        if (typeof State !== "undefined" && State.variables) State.variables.time = labels[phase] || phase;
        return { ok: true, value: { timePhase: phase, timeLabel: labels[phase] || phase } };
    }

    function recordFinalTimelapseResult(result, finalStage) {
        if (setup.EmergencyDiagnostics && typeof setup.EmergencyDiagnostics.recordTimelapseResult === "function") {
            try {
                const world = setup.Game && setup.Game.getWorld ? setup.Game.getWorld() : null;
                setup.EmergencyDiagnostics.recordTimelapseResult(Object.assign({}, clone(result || {}), {
                    wrapperStage: finalStage || null,
                    finalTimePhase: world && world.environment && world.environment.timePhase || null
                }));
            } catch (error) { /* diagnostics never affect gameplay */ }
        }
        return result;
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
        if (!world.environment || world.environment.timePhase !== "evening") {
            if (human) human.sleeping = false;
            return failure("NIGHT_TIMELAPSE_NOT_EVENING", "Sleeping until morning is only available during Evening.");
        }
        if (!human || human.sleeping !== true) return failure("HUMAN_NOT_SLEEPING", "The HumanController must be asleep before the overnight timelapse can begin.");
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            human.sleeping = false;
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before sleeping until morning.");
        }

        setTimePhase("nighttime_timelapse");
        inFlight = true;
        try {
            const result = await setup.TimelapseCore.run(client, Object.assign({}, options, { mode: MODE, roundCount: ROUND_COUNT }));
            const currentWorld = setup.Game.getWorld();
            if (currentWorld.entities && currentWorld.entities[humanId]) currentWorld.entities[humanId].sleeping = false;
            if (!result.ok) {
                setTimePhase("evening");
            } else {
                if (setup.WorldEnvironment && typeof setup.WorldEnvironment.refreshWeather === "function") {
                    try { await setup.WorldEnvironment.refreshWeather(client || setup.OpenRouterClient); } catch (error) { /* optional weather never blocks */ }
                }
                setTimePhase("morning");
            }
            const validation = setup.Game.validateWorld();
            if (!validation.ok) {
                return recordFinalTimelapseResult({ ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                    failedStage: "wrapper-validation", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(validation.error) }, "wrapper-validation");
            }
            return recordFinalTimelapseResult(result, result.ok ? "complete" : (result.failedStage || "core-failed"));
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
