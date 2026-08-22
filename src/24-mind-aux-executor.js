(function () {
    "use strict";

    const jobs = new Map();
    let generation = 1;
    let pumpScheduled = false;
    let lastErrorByCharacterId = {};

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

    function currentWorldMatches(world) {
        try { return !world || world === setup.Game.getWorld(); } catch (error) { return false; }
    }

    function autoEnabled() {
        return !setup.AITurnScheduler || typeof setup.AITurnScheduler.isAutoMemoryCompressionEnabled !== "function" || setup.AITurnScheduler.isAutoMemoryCompressionEnabled();
    }

    function canonicalBusy() {
        const status = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus ? setup.AIRequestExecutor.getStatus() : null;
        return Boolean(status && status.blockingBusy) || Boolean(setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight());
    }

    function hasKey() {
        if (!setup.AIRuntimeSettings || typeof setup.AIRuntimeSettings.getStatus !== "function") return true;
        return setup.AIRuntimeSettings.getStatus().hasKey === true;
    }

    function eligible(characterId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        return Boolean(actor && actor.type === "character" && (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(actor, world)) && actor.mind && Array.isArray(actor.mind.verbatimObservations) && actor.mind.verbatimObservations.length > setup.MindV3.CONFIG.STM_TRIGGER_COUNT);
    }

    function schedulePump(delay) {
        if (pumpScheduled) return;
        pumpScheduled = true;
        setTimeout(function () {
            pumpScheduled = false;
            pump();
        }, Math.max(0, delay || 0));
    }

    function schedule(characterId) {
        if (!eligible(characterId)) return { ok: true, scheduled: false, reason: "not-eligible" };
        if (jobs.has(characterId)) return { ok: true, scheduled: false, reason: "already-active-or-queued" };
        jobs.set(characterId, { characterId: characterId, state: "queued", generation: generation, queuedAt: new Date().toISOString(), startedAt: null });
        schedulePump(0);
        return { ok: true, scheduled: true };
    }

    async function runJob(job) {
        if (!job || job.generation !== generation || jobs.get(job.characterId) !== job) return;
        job.state = "active";
        job.startedAt = new Date().toISOString();
        const tokenGeneration = job.generation;
        let result;
        try {
            result = await setup.MemoryConsolidator.consolidateSTM(job.characterId, setup.OpenRouterClient, {
                purpose: "mind-background",
                concurrent: true,
                trigger: "automatic",
                beforeCommit: function () {
                    return tokenGeneration === generation && jobs.get(job.characterId) === job && job.state === "active";
                }
            });
            if (!result.ok) lastErrorByCharacterId[job.characterId] = clone(result.error || { code: "MIND_BACKGROUND_FAILED", message: "Background mind work failed." });
            else delete lastErrorByCharacterId[job.characterId];
        } catch (error) {
            lastErrorByCharacterId[job.characterId] = { code: "MIND_BACKGROUND_EXCEPTION", message: error && error.message || "Background mind work failed." };
        } finally {
            const shouldRetryBacklog = Boolean(result && result.ok && tokenGeneration === generation && eligible(job.characterId));
            if (jobs.get(job.characterId) === job) jobs.delete(job.characterId);
            if (shouldRetryBacklog) schedule(job.characterId);
        }
    }

    function pump() {
        if (!autoEnabled() || canonicalBusy() || !hasKey()) {
            if (canonicalBusy()) schedulePump(200);
            return;
        }
        const queued = Array.from(jobs.values()).filter(function (job) { return job.state === "queued" && job.generation === generation; });
        queued.forEach(function (job) { runJob(job); });
    }

    function noteVerbatimChanged(characterId, world) {
        if (!currentWorldMatches(world) || !autoEnabled()) return;
        if (eligible(characterId)) schedule(characterId);
    }

    function pokeEligible() {
        if (!autoEnabled()) return [];
        const world = setup.Game.getWorld();
        const scheduled = [];
        Object.values(world.entities).forEach(function (entity) {
            if (!entity || entity.type !== "character") return;
            const result = schedule(entity.id);
            if (result.scheduled) scheduled.push(entity.id);
        });
        return scheduled;
    }

    function canonicalWorkFinished() {
        pump();
    }

    function invalidateForTimelapse() {
        generation += 1;
        Array.from(jobs.entries()).forEach(function (entry) {
            const job = entry[1];
            if (job.state === "queued") jobs.delete(entry[0]);
            else job.state = "invalidated";
        });
        return { ok: true, generation: generation };
    }

    function getStatus() {
        return {
            generation: generation,
            jobs: Array.from(jobs.values()).map(function (job) { return clone(job); }),
            queuedCount: Array.from(jobs.values()).filter(function (job) { return job.state === "queued"; }).length,
            activeCount: Array.from(jobs.values()).filter(function (job) { return job.state === "active"; }).length,
            lastErrorByCharacterId: clone(lastErrorByCharacterId)
        };
    }

    setup.MindAuxExecutor = {
        schedule: schedule,
        noteVerbatimChanged: noteVerbatimChanged,
        pokeEligible: pokeEligible,
        canonicalWorkFinished: canonicalWorkFinished,
        invalidateForTimelapse: invalidateForTimelapse,
        getStatus: getStatus
    };
}());
