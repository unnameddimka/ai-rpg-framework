(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function fail(code, message, details) {
        const error = { code: code, message: message };
        if (details) error.details = details;
        return { ok: false, error: error };
    }

    function busyState() {
        const controllerBusy = Boolean(setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight());
        const waveBusy = Boolean(setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight());
        const executor = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus ? setup.AIRequestExecutor.getStatus() : null;
        const executorBusy = Boolean(executor && (executor.blockingBusy !== undefined ? executor.blockingBusy : executor.busy));
        const migrationBusy = Boolean(setup.SaveMigration && setup.SaveMigration.isInFlight && setup.SaveMigration.isInFlight());
        return {
            busy: controllerBusy || waveBusy || executorBusy || migrationBusy,
            controllerBusy: controllerBusy,
            waveBusy: waveBusy,
            executorBusy: executorBusy,
            migrationBusy: migrationBusy
        };
    }

    function ensureSafeBoundary() {
        const status = busyState();
        return status.busy
            ? fail("AI_ADMIN_BUSY", "AI activity cannot be changed while a model request, reaction wave, or migration is in flight.")
            : { ok: true };
    }

    function candidateWorld() {
        return clone(setup.Game.getWorld());
    }

    function getCharacter(candidate, characterId) {
        const actor = candidate && candidate.entities && candidate.entities[characterId];
        return actor && actor.type === "character" ? actor : null;
    }

    function acknowledgeDismissed(actorId, observations, candidate) {
        const ids = new Set((Array.isArray(observations) ? observations : []).map(function (observation) {
            return observation && observation.sourceEventId;
        }).filter(function (value) { return Number.isFinite(value); }));
        if (ids.size === 0 || !Array.isArray(candidate.events)) return;
        candidate.events.forEach(function (event) {
            if (!event || !ids.has(event.id)) return;
            if (!Array.isArray(event.processedBy)) event.processedBy = [];
            if (!event.processedBy.includes(actorId)) event.processedBy.push(actorId);
            delete event.pendingFor;
        });
    }

    function dismissOnCandidate(candidate, characterId) {
        const actor = getCharacter(candidate, characterId);
        if (!actor) return fail("AI_ADMIN_CHARACTER_MISSING", `Character ${characterId} does not exist.`);
        if (!actor.mind || !Array.isArray(actor.mind.pendingObservations)) {
            return fail("AI_ADMIN_MIND_INVALID", `Character ${characterId} has no valid pending-observation inbox.`);
        }
        const dismissed = actor.mind.pendingObservations.slice();
        actor.mind.pendingObservations = [];
        acknowledgeDismissed(characterId, dismissed, candidate);
        if (!candidate.ai || !Array.isArray(candidate.ai.turnQueue)) {
            return fail("AI_ADMIN_QUEUE_INVALID", "The AI scheduler queue is missing or invalid.");
        }
        const beforeQueue = candidate.ai.turnQueue.length;
        candidate.ai.turnQueue = candidate.ai.turnQueue.filter(function (entry) {
            return !entry || entry.characterId !== characterId;
        });
        return {
            ok: true,
            dismissedObservationCount: dismissed.length,
            removedQueueEntries: beforeQueue - candidate.ai.turnQueue.length
        };
    }

    function clearIntentionOnCandidate(candidate, characterId) {
        const actor = getCharacter(candidate, characterId);
        if (!actor) return fail("AI_ADMIN_CHARACTER_MISSING", `Character ${characterId} does not exist.`);
        if (!candidate.ai || !candidate.ai.continuations || typeof candidate.ai.continuations !== "object") {
            return fail("AI_ADMIN_CONTINUATIONS_INVALID", "The AI continuation store is missing or invalid.");
        }
        const hadContinuation = Object.prototype.hasOwnProperty.call(candidate.ai.continuations, characterId)
            && candidate.ai.continuations[characterId] !== null
            && candidate.ai.continuations[characterId] !== "";
        delete candidate.ai.continuations[characterId];
        return { ok: true, clearedContinuation: hadContinuation };
    }

    function commitCandidate(candidate, result) {
        const validation = setup.GameInternals.validateWorld(candidate);
        if (!validation || !validation.ok) {
            return fail("AI_ADMIN_WORLD_INVALID", "The requested admin change would leave the world invalid.", validation && validation.error || null);
        }
        State.variables.world = candidate;
        return Object.assign({ ok: true }, result || {});
    }

    function dismissPendingReactions(characterId) {
        const safe = ensureSafeBoundary();
        if (!safe.ok) return safe;
        const candidate = candidateWorld();
        const result = dismissOnCandidate(candidate, characterId);
        if (!result.ok) return result;
        return commitCandidate(candidate, result);
    }

    function clearCurrentIntention(characterId) {
        const safe = ensureSafeBoundary();
        if (!safe.ok) return safe;
        const candidate = candidateWorld();
        const result = clearIntentionOnCandidate(candidate, characterId);
        if (!result.ok) return result;
        return commitCandidate(candidate, result);
    }

    function clearAIActivity(characterId) {
        const safe = ensureSafeBoundary();
        if (!safe.ok) return safe;
        const candidate = candidateWorld();
        const dismissed = dismissOnCandidate(candidate, characterId);
        if (!dismissed.ok) return dismissed;
        const intention = clearIntentionOnCandidate(candidate, characterId);
        if (!intention.ok) return intention;
        return commitCandidate(candidate, {
            dismissedObservationCount: dismissed.dismissedObservationCount,
            removedQueueEntries: dismissed.removedQueueEntries,
            clearedContinuation: intention.clearedContinuation
        });
    }

    function clearAllAIActivity(keepCharacterIds) {
        const safe = ensureSafeBoundary();
        if (!safe.ok) return safe;
        const candidate = candidateWorld();
        const keep = new Set(Array.isArray(keepCharacterIds) ? keepCharacterIds : []);
        const affected = [];
        let dismissedObservationCount = 0;
        let removedQueueEntries = 0;
        let clearedContinuationCount = 0;

        Object.keys(candidate.control && candidate.control.assignments || {}).forEach(function (characterId) {
            if (candidate.control.assignments[characterId] !== "ai" || keep.has(characterId)) return;
            const dismissed = dismissOnCandidate(candidate, characterId);
            if (!dismissed.ok) throw dismissed;
            const intention = clearIntentionOnCandidate(candidate, characterId);
            if (!intention.ok) throw intention;
            affected.push(characterId);
            dismissedObservationCount += dismissed.dismissedObservationCount;
            removedQueueEntries += dismissed.removedQueueEntries;
            if (intention.clearedContinuation) clearedContinuationCount++;
        });

        return commitCandidate(candidate, {
            affectedCharacterIds: affected,
            keptCharacterIds: Array.from(keep),
            dismissedObservationCount: dismissedObservationCount,
            removedQueueEntries: removedQueueEntries,
            clearedContinuationCount: clearedContinuationCount
        });
    }

    function removeFromQueue(characterId) {
        const safe = ensureSafeBoundary();
        if (!safe.ok) return safe;
        const world = setup.Game.getWorld();
        const actor = world.entities && world.entities[characterId];
        if (!actor || actor.type !== "character") return fail("AI_ADMIN_CHARACTER_MISSING", `Character ${characterId} does not exist.`);
        const before = world.ai && Array.isArray(world.ai.turnQueue) ? world.ai.turnQueue.length : 0;
        if (!world.ai || !Array.isArray(world.ai.turnQueue)) return fail("AI_ADMIN_QUEUE_INVALID", "The AI scheduler queue is missing or invalid.");
        world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) { return !entry || entry.characterId !== characterId; });
        return {
            ok: true,
            removedQueueEntries: before - world.ai.turnQueue.length,
            note: actor.mind && Array.isArray(actor.mind.pendingObservations) && actor.mind.pendingObservations.length
                ? "Pending observations remain; scheduler repair can make this character eligible again."
                : "No pending observations remain."
        };
    }

    setup.AIAdmin = {
        getBusyState: busyState,
        dismissPendingReactions: dismissPendingReactions,
        clearCurrentIntention: clearCurrentIntention,
        clearAIActivity: clearAIActivity,
        clearAllAIActivity: function (options) {
            const source = options && typeof options === "object" ? options : {};
            try {
                return clearAllAIActivity(source.keepCharacterIds || []);
            } catch (errorResult) {
                return errorResult && errorResult.ok === false
                    ? errorResult
                    : fail("AI_ADMIN_FAILED", "AI activity cleanup failed unexpectedly.");
            }
        },
        removeFromQueue: removeFromQueue
    };
}());
