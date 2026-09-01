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
        if (!world.environment || world.environment.timePhase !== "evening") {
            if (human) human.sleeping = false;
            return failure("NIGHT_TIMELAPSE_NOT_EVENING", "Sleeping until morning is only available during Evening.");
        }
        if (!human || human.sleeping !== true) return failure("HUMAN_NOT_SLEEPING", "The HumanController must be asleep before the overnight timelapse can begin.");
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            human.sleeping = false;
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before sleeping until morning.");
        }

        const triggeredBoundary = setup.TriggeredEvents && typeof setup.TriggeredEvents.processTimelapseStart === "function"
            ? setup.TriggeredEvents.processTimelapseStart({ random: options.random })
            : { ok: true };
        if (!triggeredBoundary.ok) {
            human.sleeping = false;
            return failure("TIMELAPSE_TRIGGERED_EVENT_FAILED", triggeredBoundary.error && triggeredBoundary.error.message || "A triggered timelapse-start event failed.");
        }
        const nightPhase = setup.TimelapseCore.setTimePhase("nighttime_timelapse");
        if (!nightPhase.ok) return failure(nightPhase.error && nightPhase.error.code || "TIMELAPSE_PHASE_INVALID", nightPhase.error && nightPhase.error.message || "Night phase could not be committed.");
        inFlight = true;
        try {
            const result = await setup.TimelapseCore.run(client, Object.assign({}, options, { mode: MODE, roundCount: ROUND_COUNT }));
            const currentWorld = setup.Game.getWorld();
            const wrapperMutationSnapshot = clone(currentWorld);
            if (currentWorld.entities && currentWorld.entities[humanId]) currentWorld.entities[humanId].sleeping = false;
            const wakeValidation = setup.Game.validateWorld();
            if (!wakeValidation.ok) {
                State.variables.world = wrapperMutationSnapshot;
                return setup.TimelapseCore.recordFinalResult({ ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                    failedStage: "wrapper-wake-validation", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(wakeValidation.error) }, "wrapper-wake-validation");
            }
            if (!result.ok) {
                const eveningPhase = setup.TimelapseCore.setTimePhase("evening");
                if (!eveningPhase.ok) return setup.TimelapseCore.recordFinalResult(Object.assign({}, result, { failedStage: "wrapper-phase-validation", error: clone(eveningPhase.error) }), "wrapper-phase-validation");
            } else {
                if (setup.WorldEnvironment && typeof setup.WorldEnvironment.refreshWeather === "function") {
                    try { await setup.WorldEnvironment.refreshWeather(client || setup.OpenRouterClient); } catch (error) { /* optional weather never blocks */ }
                }
                if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.advanceDayBoundary === "function") {
                    if (typeof options.onProgress === "function") {
                        try { options.onProgress({ stage: "day-boundary", text: "Advancing to the next day…", mode: MODE }); } catch (error) { /* presentation-only */ }
                    }
                    const boundary = setup.WeeklyRhythm.advanceDayBoundary(currentWorld, { random: options.random });
                    if (!boundary.ok) {
                        return setup.TimelapseCore.recordFinalResult({ ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                            failedStage: "day-boundary", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(boundary.error) }, "day-boundary");
                    }
                    result.dayBoundary = clone(boundary);
                }
                const morningPhase = setup.TimelapseCore.setTimePhase("morning");
                if (!morningPhase.ok) {
                    return setup.TimelapseCore.recordFinalResult({ ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                        failedStage: "wrapper-phase-validation", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(morningPhase.error) }, "wrapper-phase-validation");
                }
            }
            const validation = setup.Game.validateWorld();
            if (!validation.ok) {
                return setup.TimelapseCore.recordFinalResult({ ok: false, mode: MODE, humanId: humanId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0,
                    failedStage: "wrapper-validation", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(validation.error) }, "wrapper-validation");
            }
            return setup.TimelapseCore.recordFinalResult(result, result.ok ? "complete" : (result.failedStage || "core-failed"));
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
