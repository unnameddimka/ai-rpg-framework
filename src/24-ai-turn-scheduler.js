(function () {
    "use strict";

    const AUTO_PAUSE_KEY = "ai-rpg.stop-auto-ai-processing";
    let waveInFlight = false;
    let autoProcessingPaused = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function characterName(characterId, world) {
        const character = world.entities[characterId];
        return character && character.type === "character" ? character.name : characterId || "Unknown";
    }

    function locationName(locationId, world) {
        const location = world.entities[locationId];
        return location && location.type === "location" ? location.name : locationId || "Unknown";
    }

    function observationType(observation) {
        return observation && observation.data && observation.data.type
            ? observation.data.type
            : (observation && observation.actionType) || (observation && observation.kind) || "observation";
    }

    function interactionIdOf(observation) {
        return observation && (observation.interactionId || observation.data && observation.data.interactionId) || null;
    }

    function combineInteractionObservations(observations, world) {
        const grouped = [];
        const byInteraction = new Map();

        observations.forEach(function (observation) {
            const interactionId = interactionIdOf(observation);
            if (!interactionId) {
                grouped.push(clone(observation));
                return;
            }
            let group = byInteraction.get(interactionId);
            if (!group) {
                group = { interactionId: interactionId, items: [], insertionIndex: grouped.length };
                byInteraction.set(interactionId, group);
                grouped.push(group);
            }
            group.items.push(observation);
        });

        return grouped.map(function (entry) {
            if (!entry || !entry.items) return entry;
            if (entry.items.length === 1) return clone(entry.items[0]);

            const items = entry.items;
            const first = items[0];
            const narrativeItems = items.filter(function (item) { return observationType(item) === "narrative_input"; });
            const mechanicalItems = items.filter(function (item) { return observationType(item) !== "narrative_input"; });
            const actorId = first.actorId || first.data && first.data.actorId || null;
            const actor = characterName(actorId, world);
            const mechanicalText = mechanicalItems.map(function (item) { return item.text; }).filter(Boolean).join(" ");
            const narrativeText = narrativeItems.map(function (item) { return item.text; }).filter(Boolean).join(" ");
            const narrativeTargetId = narrativeItems.find(function (item) { return item.targetId; })?.targetId || null;
            const mechanicalTargetId = mechanicalItems.find(function (item) { return item.targetId; })?.targetId || null;
            const textParts = [];
            if (narrativeText) {
                const addressee = narrativeTargetId ? characterName(narrativeTargetId, world) : null;
                textParts.push(`${actor}${addressee ? ` to ${addressee}` : ""} said: “${narrativeText}”`);
            }
            if (mechanicalText) textParts.push(mechanicalText);

            return {
                id: first.id,
                observationIds: items.map(function (item) { return item.id; }),
                interactionId: entry.interactionId,
                kind: "intent",
                turn: first.turn || null,
                actorId: actorId,
                targetId: mechanicalTargetId || narrativeTargetId || null,
                text: textParts.join(" "),
                data: {
                    type: "combined_intent",
                    interactionId: entry.interactionId,
                    formalActionTargetId: mechanicalTargetId,
                    spokenTargetId: narrativeTargetId,
                    targetIds: Array.from(new Set([mechanicalTargetId, narrativeTargetId].filter(Boolean))),
                    observations: clone(items)
                }
            };
        });
    }

    function describeObservation(observation, world) {
        const data = observation && observation.data || {};
        const type = observationType(observation);
        const actorId = observation.actorId || data.actorId || null;
        const targetId = observation.targetId || data.targetId || null;
        const actor = actorId ? characterName(actorId, world) : "World";
        const target = targetId ? characterName(targetId, world) : "";
        const text = observation && typeof observation.text === "string" ? observation.text : "";
        let summary = text || type;

        if (type === "combined_intent" || observation && observation.kind === "intent") {
            summary = text || `${actor} performed a combined intent.`;
        } else if (type === "narrative_input") {
            summary = target
                ? `${actor} to ${target}: “${text}”`
                : `${actor}: “${text}”`;
        } else if (type === "character_moved") {
            summary = `${actor} moved from ${locationName(data.fromLocationId, world)} to ${locationName(data.toLocationId, world)}.`;
        } else if (type === "character_entered_location") {
            summary = `${actor} entered ${locationName(data.toLocationId || data.locationId, world)}.`;
        } else if (type === "character_left_location") {
            summary = `${actor} left ${locationName(data.fromLocationId || data.locationId, world)}.`;
        } else if (observation && observation.kind === "action_feedback") {
            summary = `${observation.code || observation.actionType || "Action feedback"}: ${text}`;
        }

        return {
            id: observation.id,
            turn: observation.turn || null,
            kind: observation.kind || "observation",
            type: type,
            actorId: actorId,
            actorName: actor,
            targetId: targetId,
            targetName: target,
            text: text,
            summary: summary
        };
    }

    function buildDecisionRequest(characterId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character" || !actor.mind || !Array.isArray(actor.mind.pendingObservations)) {
            return { ok: false, error: { code: "AI_SCHEDULER_ACTOR_INVALID", message: "The queued AI character has no valid observation inbox." } };
        }
        if (world.control.assignments[characterId] !== "ai" || actor.mind.pendingObservations.length === 0) {
            return { ok: false, error: { code: "AI_SCHEDULER_ENTRY_STALE", message: "The selected AI queue entry is no longer eligible." } };
        }
        const originalObservations = clone(actor.mind.pendingObservations.slice(0, 50));
        const observations = combineInteractionObservations(originalObservations, world);
        const context = setup.ContextBuilder.build(actor.id, { pendingObservations: observations });
        if (context && context.ok === false) return context;
        return {
            ok: true,
            actorId: actor.id,
            actorName: actor.name,
            stage: "decision",
            observations: observations,
            originalObservations: originalObservations,
            observationIds: originalObservations.map(function (item) { return item.id; }),
            context: context,
            messages: setup.AIProtocol.decisionMessages(context)
        };
    }

    function initiativeContribution(observation, characterId) {
        if (!observation) return 0;
        const data = observation.data || {};
        const targetId = observation.targetId || data.targetId || null;
        if (targetId !== characterId) return 0;
        const type = observationType(observation);
        let score = type === "narrative_input" ? 1 : (observation.kind === "event" ? 2 : 0);
        if (score > 0) {
            const sourceControllerId = observation.sourceControllerId || data.sourceControllerId || null;
            if (sourceControllerId === "human") score += 2;
        }
        return score;
    }

    function initiativeScore(characterId, world) {
        const actor = world.entities[characterId];
        const pending = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
            ? actor.mind.pendingObservations
            : [];
        return pending.reduce(function (total, observation) {
            return total + initiativeContribution(observation, characterId);
        }, 0);
    }

    function orderedQueueEntries(excludedCharacterIds) {
        const world = setup.Game.getWorld();
        const excluded = excludedCharacterIds || new Set();
        return setup.AITurnQueue.getStatus().entries.map(function (entry, index) {
            return {
                entry: clone(entry),
                index: index,
                initiativeScore: initiativeScore(entry.characterId, world)
            };
        }).filter(function (record) {
            return !excluded.has(record.entry.characterId);
        }).sort(function (left, right) {
            if (left.initiativeScore !== right.initiativeScore) return right.initiativeScore - left.initiativeScore;
            return left.index - right.index;
        });
    }

    function getQueueView() {
        const world = setup.Game.getWorld();
        const ordered = orderedQueueEntries();
        const entries = ordered.map(function (record, index) {
            const entry = record.entry;
            const actor = world.entities[entry.characterId];
            const originalObservations = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
                ? actor.mind.pendingObservations.slice(0, 50)
                : [];
            const observations = combineInteractionObservations(originalObservations, world);
            const described = observations.map(function (observation) {
                return describeObservation(observation, world);
            });
            const actorView = actor ? setup.CharacterAPI.getView(actor.id) : null;
            const available = actorView && actorView.available_actions || {};
            return {
                index: index,
                position: index + 1,
                isNext: index === 0,
                characterId: entry.characterId,
                recipientName: actor && actor.name || entry.characterId,
                locationId: actor && actor.locationId || null,
                locationName: actor ? locationName(actor.locationId, world) : "Unknown",
                reason: entry.reason || "observation",
                initiativeScore: record.initiativeScore,
                pendingObservationCount: actor && actor.mind && actor.mind.pendingObservations
                    ? actor.mind.pendingObservations.length
                    : 0,
                requestObservationCount: observations.length,
                availableActionCount: available && typeof available === "object" ? Object.keys(available).length : 0,
                primaryObservation: described[0] || null,
                observationPreview: described.slice(0, 4),
                hiddenObservationCount: Math.max(0, described.length - 4)
            };
        });
        return {
            count: entries.length,
            entries: entries,
            head: entries[0] || null
        };
    }

    function readAutoProcessingPaused() {
        if (autoProcessingPaused !== null) return autoProcessingPaused;
        try {
            autoProcessingPaused = window.localStorage.getItem(AUTO_PAUSE_KEY) === "true";
        } catch (error) {
            autoProcessingPaused = false;
        }
        return autoProcessingPaused;
    }

    function setAutoProcessingPaused(paused) {
        autoProcessingPaused = Boolean(paused);
        try {
            window.localStorage.setItem(AUTO_PAUSE_KEY, autoProcessingPaused ? "true" : "false");
        } catch (error) {
            // The setting still applies for the current page when storage is unavailable.
        }
        return { ok: true, paused: autoProcessingPaused };
    }

    async function processNext(client) {
        const next = orderedQueueEntries()[0];
        if (!next) return { ok: false, error: { code: "AI_QUEUE_EMPTY", message: "No pending AI turns." } };
        return setup.AIController.takeQueuedTurn(next.entry.characterId, client || setup.OpenRouterClient);
    }

    async function processWave(client) {
        if (waveInFlight || setup.AIController.isInFlight()) {
            return { ok: false, error: { code: "AI_WAVE_IN_FLIGHT", message: "An AI reaction wave is already in progress." } };
        }
        if (orderedQueueEntries().length === 0) {
            return { ok: true, processedCount: 0, reactedCharacterIds: [], results: [], remainingQueue: getQueueView() };
        }
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            return { ok: false, error: { code: "AI_KEY_MISSING", message: "Enter an OpenRouter API key before processing AI reactions." } };
        }

        waveInFlight = true;
        const reacted = new Set();
        const results = [];
        const emergencyLimit = 64;
        try {
            for (let count = 0; count < emergencyLimit; count++) {
                const next = orderedQueueEntries(reacted)[0];
                if (!next) break;

                const result = await setup.AIController.takeQueuedTurn(next.entry.characterId, client || setup.OpenRouterClient);
                results.push(clone(result));
                if (!result.ok) {
                    return {
                        ok: false,
                        error: clone(result.error),
                        processedCount: reacted.size,
                        reactedCharacterIds: Array.from(reacted),
                        results: results,
                        remainingQueue: getQueueView()
                    };
                }
                reacted.add(next.entry.characterId);
            }

            const unreacted = orderedQueueEntries(reacted);
            if (unreacted.length > 0 && reacted.size >= emergencyLimit) {
                return {
                    ok: true,
                    truncated: true,
                    warning: `AI world tick stopped at the emergency limit of ${emergencyLimit} model decisions; remaining observations stay pending.`,
                    processedCount: reacted.size,
                    reactedCharacterIds: Array.from(reacted),
                    results: results,
                    remainingQueue: getQueueView()
                };
            }

            return {
                ok: true,
                processedCount: reacted.size,
                reactedCharacterIds: Array.from(reacted),
                results: results,
                remainingQueue: getQueueView()
            };
        } finally {
            waveInFlight = false;
        }
    }

    async function processAfterSubmit(client) {
        if (readAutoProcessingPaused()) {
            return {
                ok: true,
                paused: true,
                processedCount: 0,
                reactedCharacterIds: [],
                results: [],
                remainingQueue: getQueueView()
            };
        }
        return processWave(client);
    }

    setup.AITurnScheduler = {
        processNext: processNext,
        processWave: processWave,
        processAfterSubmit: processAfterSubmit,
        buildDecisionRequest: buildDecisionRequest,
        getQueueView: getQueueView,
        combineInteractionObservations: function (observations) {
            return clone(combineInteractionObservations(observations || [], setup.Game.getWorld()));
        },
        describeObservation: function (observation) {
            return clone(describeObservation(observation, setup.Game.getWorld()));
        },
        getInitiativeScore: function (characterId) {
            return initiativeScore(characterId, setup.Game.getWorld());
        },
        isAutoProcessingPaused: readAutoProcessingPaused,
        setAutoProcessingPaused: setAutoProcessingPaused,
        isWaveInFlight: function () { return waveInFlight; },
        getStatus: function () {
            return {
                queue: getQueueView(),
                executor: setup.AIRequestExecutor.getStatus(),
                waveInFlight: waveInFlight,
                autoProcessingPaused: readAutoProcessingPaused()
            };
        }
    };
}());
