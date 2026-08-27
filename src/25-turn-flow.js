(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function actorName(actorId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        return actor && actor.name || actorId || "Character";
    }

    function targetName(targetId) {
        if (!targetId) return "";
        const world = setup.Game.getWorld();
        const target = world.entities[targetId];
        return target && target.name || targetId;
    }

    function locationName(locationId) {
        if (!locationId) return "";
        const world = setup.Game.getWorld();
        const location = world.entities[locationId];
        return location && location.name || locationId;
    }

    function locationHiddenFromHuman(locationId, humanId) {
        if (!locationId || !humanId || !setup.GameInternals) return false;
        const world = setup.Game.getWorld();
        return setup.GameInternals.locationRequiresDiscovery(locationId, world) &&
            !setup.GameInternals.characterHasDiscoveredLocation(humanId, locationId, world);
    }

    function eventHiddenFromHuman(event, humanId) {
        return Boolean(event && humanId && setup.GameInternals &&
            setup.GameInternals.eventTouchesUndiscoveredLocation(event, humanId, setup.Game.getWorld()));
    }

    function presentationEntry(text, visibleToHuman, actorId, locationId, kind) {
        return {
            text: String(text || ""),
            visibleToHuman: Boolean(visibleToHuman),
            actorId: actorId || null,
            actorName: actorName(actorId),
            locationId: locationId || null,
            locationName: locationName(locationId),
            kind: kind || "reaction"
        };
    }

    function splitPresentation(entries, humanId) {
        const visible = [];
        const hidden = [];
        const allowedEntries = [];
        (entries || []).forEach(function (entry) {
            if (!entry || !entry.text) return;
            if (humanId && locationHiddenFromHuman(entry.locationId, humanId)) return;
            allowedEntries.push(entry);
            if (entry.visibleToHuman) visible.push(entry.text);
            else hidden.push(clone(entry));
        });
        return { visible: visible, hidden: hidden, entries: clone(allowedEntries) };
    }

    function eventTexts(actionResult) {
        return actionResult && Array.isArray(actionResult.events)
            ? actionResult.events.map(function (event) { return event.text; }).filter(Boolean)
            : [];
    }

    function describeSubmittedIntent(actorId, input, intentResult) {
        const entries = [];
        const actionResult = intentResult && intentResult.actionResult;
        const text = input && typeof input.text === "string" ? input.text.trim() : "";
        const speaker = actorName(actorId);
        const addressee = input && input.target_id ? targetName(input.target_id) : "";
        const narrativeEvent = intentResult && intentResult.narrativeResult && intentResult.narrativeResult.event;

        if (text) {
            entries.push(presentationEntry(
                `${speaker}${addressee ? ` to ${addressee}` : ""}: ${text}`,
                true,
                actorId,
                narrativeEvent && narrativeEvent.locationId,
                "human_narrative"
            ));
        }

        (actionResult && Array.isArray(actionResult.events) ? actionResult.events : []).forEach(function (event) {
            if (!event || !event.text) return;
            entries.push(presentationEntry(
                event.text,
                true,
                actorId,
                event.locationId || event.toLocationId || event.fromLocationId,
                "human_action_event"
            ));
        });

        if (actionResult && !actionResult.ok && actionResult.error) {
            entries.push(presentationEntry(
                `${speaker}'s formal action failed: ${actionResult.error.message}`,
                true,
                actorId,
                setup.Game.getWorld().entities[actorId] && setup.Game.getWorld().entities[actorId].locationId,
                "human_action_failure"
            ));
        }
        return splitPresentation(entries, actorId);
    }

    function humanReceivesEvent(event, humanId) {
        return Boolean(event && Array.isArray(event.recipients) && event.recipients.includes(humanId));
    }

    function actorVisibleToHuman(actorId, humanId) {
        const view = setup.CharacterAPI.getView(humanId);
        return Boolean(view && view.location && Array.isArray(view.location.characters) &&
            view.location.characters.some(function (character) { return character.id === actorId; }));
    }

    function describeAIResult(result, humanId) {
        const entries = [];
        if (!result || !result.ok) return splitPresentation(entries, humanId);

        const actorId = result.actorId;
        const intentResult = result.intentResult || {};
        const narrativeEvent = intentResult.narrativeResult && intentResult.narrativeResult.event;
        if (result.narrativeText && result.narrativeText.trim() && !eventHiddenFromHuman(narrativeEvent, humanId)) {
            const text = result.narrativeText.trim();
            const visibleNarrative = narrativeEvent
                ? humanReceivesEvent(narrativeEvent, humanId)
                : actorVisibleToHuman(actorId, humanId);
            const actor = setup.Game.getWorld().entities[actorId];
            const narrativeLocationId = narrativeEvent && narrativeEvent.locationId || actor && actor.locationId;
            if (!locationHiddenFromHuman(narrativeLocationId, humanId)) {
                entries.push(presentationEntry(
                    `${actorName(actorId)}: ${text}`,
                    visibleNarrative,
                    actorId,
                    narrativeLocationId,
                    "narrative"
                ));
            }
        }

        const actionResult = result.actionResult;
        (actionResult && Array.isArray(actionResult.events) ? actionResult.events : []).forEach(function (event) {
            if (!event || !event.text || eventHiddenFromHuman(event, humanId)) return;
            entries.push(presentationEntry(
                event.text,
                humanReceivesEvent(event, humanId),
                actorId,
                event.locationId || event.toLocationId || event.fromLocationId,
                "action_event"
            ));
        });

        if (actionResult && !actionResult.ok && actionResult.error) {
            const actor = setup.Game.getWorld().entities[actorId];
            if (!locationHiddenFromHuman(actor && actor.locationId, humanId)) {
                entries.push(presentationEntry(
                    `${actorName(actorId)}'s formal action failed: ${actionResult.error.message}`,
                    actorVisibleToHuman(actorId, humanId),
                    actorId,
                    actor && actor.locationId,
                    "action_failure"
                ));
            }
        }
        return splitPresentation(entries, humanId);
    }

    function describeTriggeredResult(triggerResult, humanId) {
        const entries = [];
        (triggerResult && Array.isArray(triggerResult.events) ? triggerResult.events : []).forEach(function (event) {
            if (!event || !event.text || eventHiddenFromHuman(event, humanId)) return;
            entries.push(presentationEntry(
                event.text,
                humanReceivesEvent(event, humanId) || event.actorId === humanId,
                event.actorId || null,
                event.locationId || null,
                "triggered_event"
            ));
        });
        return splitPresentation(entries, humanId);
    }

    function describeWave(waveResult, humanId) {
        const entries = [];
        (waveResult && waveResult.results || []).forEach(function (result) {
            const described = describeAIResult(result, humanId);
            entries.push.apply(entries, described.entries);
        });
        return splitPresentation(entries, humanId);
    }



    function progressivePublishingEnabled(options, meta) {
        if (!options || typeof options.onCommittedPresentation !== "function") return false;
        if (meta && meta.phase === "timelapse-round") return true;
        return !(setup.NarratorService && setup.NarratorService.isEnabled && setup.NarratorService.isEnabled());
    }

    function emitCommittedPresentation(options, presentation, meta) {
        if (!progressivePublishingEnabled(options, meta)) return;
        try {
            options.onCommittedPresentation({
                entries: clone(presentation && presentation.entries || []),
                visible: clone(presentation && presentation.visible || []),
                hidden: clone(presentation && presentation.hidden || []),
                meta: clone(meta || {})
            });
        } catch (error) {
            // Presentation callbacks never affect canonical turn execution.
        }
    }

    async function narratePresentation(presentation, humanId) {
        const rawFragments = presentation && Array.isArray(presentation.visible) ? presentation.visible.slice() : [];
        if (!setup.NarratorService || !setup.NarratorService.isEnabled || !setup.NarratorService.isEnabled()) {
            return {
                attempted: false,
                used: false,
                rawFragments: rawFragments,
                narratedFragments: [],
                result: null
            };
        }
        let result;
        try {
            const view = setup.CharacterAPI.getView(humanId);
            result = await setup.NarratorService.narrateTick({
                view: view,
                entries: presentation && presentation.entries || []
            });
        } catch (error) {
            result = {
                ok: false,
                fallbackUsed: true,
                error: {
                    code: "NARRATOR_PRESENTATION_EXCEPTION",
                    message: "Narrator presentation failed unexpectedly; raw presentation was used."
                }
            };
        }
        const narratedFragments = result && result.ok && result.value && Array.isArray(result.value.fragments)
            ? result.value.fragments.filter(Boolean)
            : [];
        return {
            attempted: true,
            used: narratedFragments.length > 0,
            rawFragments: rawFragments,
            narratedFragments: narratedFragments,
            result: result || null
        };
    }


    function beginOrdinaryTick() {
        const world = setup.Game.getWorld();
        const previousTickId = Number.isInteger(world.ordinaryTickId) && world.ordinaryTickId >= 0 ? world.ordinaryTickId : 0;
        const tickId = previousTickId + 1;
        world.ordinaryTickId = tickId;
        return { tickId: tickId, previousTickId: previousTickId };
    }

    function rollbackOrdinaryTick(reservation) {
        if (!reservation) return;
        const world = setup.Game.getWorld();
        if (world && world.ordinaryTickId === reservation.tickId) world.ordinaryTickId = reservation.previousTickId;
    }

    async function submitHumanIntent(input, client, options) {
        options = options && typeof options === "object" ? options : {};
        const actorId = setup.Game.getHumanCharacterId();
        if (setup.Game.isPlayerSetupComplete && !setup.Game.isPlayerSetupComplete()) {
            return { ok: false, error: { code: "PLAYER_SETUP_INCOMPLETE", message: "Complete Traveler setup before gameplay begins." }, actorId: actorId, turnConsumed: false };
        }
        input = input && typeof input === "object" ? input : {};
        const startsNightTimelapse = Boolean(input.action && input.action.type === "sleep");
        const startsDayTimelapse = Boolean(input.action && input.action.type === "go_hunting");
        if ((startsNightTimelapse || startsDayTimelapse) && setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            return {
                ok: false,
                error: { code: "AI_KEY_MISSING", message: startsNightTimelapse ? "Enter an OpenRouter API key before sleeping until morning." : "Enter an OpenRouter API key before spending the day hunting." },
                actorId: actorId,
                turnConsumed: false
            };
        }
        const preflight = setup.CharacterAPI && typeof setup.CharacterAPI.preflightIntent === "function"
            ? setup.CharacterAPI.preflightIntent(actorId, input)
            : { ok: false, error: { code: "INTENT_PREFLIGHT_UNAVAILABLE", message: "Human intent preflight is unavailable." } };
        if (!preflight.ok) {
            return {
                ok: false,
                error: clone(preflight.error),
                actorId: actorId,
                turnConsumed: false
            };
        }

        const tickReservation = beginOrdinaryTick();
        const triggeredResult = setup.TriggeredEvents && typeof setup.TriggeredEvents.processOrdinaryTick === "function"
            ? setup.TriggeredEvents.processOrdinaryTick({ tickId: tickReservation.tickId })
            : { ok: true, events: [] };
        if (!triggeredResult.ok) {
            rollbackOrdinaryTick(tickReservation);
            return { ok: false, error: clone(triggeredResult.error), actorId: actorId, turnConsumed: false };
        }
        const triggeredPresentation = describeTriggeredResult(triggeredResult, actorId);
        if (triggeredPresentation.entries.length > 0) {
            emitCommittedPresentation(options, triggeredPresentation, { phase: "triggered-event", actorId: null });
        }

        const intentResult = setup.CharacterAPI.submitIntent(actorId, input, {
            actionWasPrevalidated: Boolean(preflight.plan && preflight.plan.action),
            preflightPlan: preflight.plan
        });
        if (!intentResult.ok) {
            return Object.assign({}, intentResult, { actorId: actorId, turnConsumed: true });
        }
        if (intentResult.actionResult && intentResult.actionResult.ok && setup.ItemModelEffects) {
            const modelEffects = await setup.ItemModelEffects.resolveActionResult(
                actorId,
                intentResult.actionResult,
                client || setup.OpenRouterClient
            );
            if (!modelEffects.ok) {
                return {
                    ok: false,
                    error: clone(modelEffects.error),
                    actorId: actorId,
                    turnConsumed: true,
                    intentResult: clone(intentResult)
                };
            }
        }

        const submittedPresentation = describeSubmittedIntent(actorId, input, intentResult);
        emitCommittedPresentation(options, submittedPresentation, { phase: "human", actorId: actorId });

        let waveResult;
        let timelapseResult = null;
        let extraHiddenEntries = [];
        if ((startsNightTimelapse || startsDayTimelapse) && intentResult.actionResult && intentResult.actionResult.ok) {
            const timelapseRunner = startsNightTimelapse ? setup.NightTimelapse : setup.DaytimeTimelapse;
            timelapseResult = await timelapseRunner.run(client || setup.OpenRouterClient, {
                onRoundCommitted: function (roundCommit) {
                    const presentation = splitPresentation(roundCommit && roundCommit.entries || [], actorId);
                    emitCommittedPresentation(options, presentation, {
                        phase: "timelapse-round",
                        mode: roundCommit && roundCommit.mode || "overnight",
                        round: roundCommit && roundCommit.round || null,
                        totalRounds: roundCommit && roundCommit.totalRounds || null
                    });
                },
                onProgress: function (progress) {
                    if (typeof options.onTimelapseProgress === "function") {
                        try { options.onTimelapseProgress(clone(progress)); } catch (error) { /* presentation-only */ }
                    }
                }
            });
            extraHiddenEntries = clone(timelapseResult.hiddenNarrativeEntries || []);
            waveResult = {
                ok: Boolean(timelapseResult.ok),
                timelapse: true,
                processedCount: 0,
                reactedCharacterIds: [],
                results: [],
                remainingQueue: setup.AITurnScheduler.getQueueView()
            };
            if (!timelapseResult.ok) {
                const partialEntries = triggeredPresentation.entries.concat(submittedPresentation.entries).concat(extraHiddenEntries);
                const partialPresentation = splitPresentation(partialEntries, actorId);
                return {
                    ok: false,
                    error: clone(timelapseResult.error),
                    actorId: actorId,
                    turnConsumed: true,
                    intentResult: clone(intentResult),
                    waveResult: clone(waveResult),
                    timelapseResult: clone(timelapseResult),
                    narrativeFragments: partialPresentation.visible,
                    rawNarrativeFragments: partialPresentation.visible,
                    narratedNarrativeFragments: [],
                    narrator: { attempted: false, used: false, fallbackUsed: false, error: null },
                    hiddenNarrativeEntries: partialPresentation.hidden,
                    historyEntries: partialPresentation.entries,
                    destinationId: null
                };
            }
        } else {
            waveResult = await setup.AITurnScheduler.processAfterSubmit(client || setup.OpenRouterClient, {
                onCommittedResult: function (aiResult) {
                    const described = describeAIResult(aiResult, actorId);
                    emitCommittedPresentation(options, described, { phase: "ai-reaction", actorId: aiResult.actorId || null });
                }
            });
        }
        const wavePresentation = describeWave(waveResult, actorId);
        const entries = triggeredPresentation.entries.concat(submittedPresentation.entries).concat(wavePresentation.entries).concat(extraHiddenEntries);
        const presentation = splitPresentation(entries, actorId);
        const narration = await narratePresentation(presentation, actorId);

        return {
            ok: true,
            actorId: actorId,
            turnConsumed: true,
            intentResult: clone(intentResult),
            waveResult: clone(waveResult),
            timelapseResult: timelapseResult ? clone(timelapseResult) : null,
            narrativeFragments: narration.used ? narration.narratedFragments : narration.rawFragments,
            rawNarrativeFragments: narration.rawFragments,
            narratedNarrativeFragments: narration.narratedFragments,
            narrator: {
                attempted: narration.attempted,
                used: narration.used,
                fallbackUsed: Boolean(narration.attempted && !narration.used),
                error: narration.result && !narration.result.ok ? clone(narration.result.error) : null
            },
            hiddenNarrativeEntries: presentation.hidden,
            historyEntries: presentation.entries,
            destinationId: intentResult.actionResult && intentResult.actionResult.ok && input.action && input.action.type === "move"
                ? input.action.destination_id
                : null
        };
    }

    async function resolveDayWorkOffer(accept, client, options) {
        options = options && typeof options === "object" ? options : {};
        const humanId = setup.Game.getHumanCharacterId();
        if (setup.Game.isPlayerSetupComplete && !setup.Game.isPlayerSetupComplete()) {
            return { ok: false, error: { code: "PLAYER_SETUP_INCOMPLETE", message: "Complete Traveler setup before gameplay begins." }, actorId: humanId, turnConsumed: false };
        }
        if (!setup.DaytimeTimelapse || !setup.DaytimeTimelapse.hasPendingOffer()) {
            return { ok: false, error: { code: "DAY_WORK_OFFER_MISSING", message: "There is no pending day-work offer." }, actorId: humanId, turnConsumed: false };
        }
        if (accept) {
            if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
                return { ok: false, error: { code: "AI_KEY_MISSING", message: "Enter an OpenRouter API key before beginning day work." }, actorId: humanId, turnConsumed: false };
            }
            const accepted = setup.DaytimeTimelapse.acceptPendingOffer();
            if (!accepted.ok) return { ok: false, error: clone(accepted.error), actorId: humanId, turnConsumed: false };
            const timelapseResult = await setup.DaytimeTimelapse.run(client || setup.OpenRouterClient, {
                onRoundCommitted: function (roundCommit) {
                    const presentation = splitPresentation(roundCommit && roundCommit.entries || [], humanId);
                    emitCommittedPresentation(options, presentation, {
                        phase: "timelapse-round",
                        mode: roundCommit && roundCommit.mode || "daytime",
                        round: roundCommit && roundCommit.round || null,
                        totalRounds: roundCommit && roundCommit.totalRounds || null
                    });
                },
                onProgress: function (progress) {
                    if (typeof options.onTimelapseProgress === "function") {
                        try { options.onTimelapseProgress(clone(progress)); } catch (error) { /* presentation-only */ }
                    }
                }
            });
            const presentation = splitPresentation(clone(timelapseResult.hiddenNarrativeEntries || []), humanId);
            const narration = await narratePresentation(presentation, humanId);
            return {
                ok: Boolean(timelapseResult.ok),
                error: timelapseResult.ok ? null : clone(timelapseResult.error),
                actorId: humanId,
                turnConsumed: false,
                timelapseResult: clone(timelapseResult),
                waveResult: { ok: Boolean(timelapseResult.ok), timelapse: true, processedCount: 0, reactedCharacterIds: [], results: [], remainingQueue: setup.AITurnScheduler.getQueueView() },
                narrativeFragments: narration.used ? narration.narratedFragments : narration.rawFragments,
                rawNarrativeFragments: narration.rawFragments,
                narratedNarrativeFragments: narration.narratedFragments,
                narrator: { attempted: narration.attempted, used: narration.used, fallbackUsed: Boolean(narration.attempted && !narration.used), error: narration.result && !narration.result.ok ? clone(narration.result.error) : null },
                hiddenNarrativeEntries: presentation.hidden,
                historyEntries: presentation.entries
            };
        }

        const declined = setup.DaytimeTimelapse.declinePendingOffer();
        if (!declined.ok) return { ok: false, error: clone(declined.error), actorId: humanId, turnConsumed: false };
        const declinedEntry = presentationEntry(declined.value.text, true, humanId, setup.Game.getWorld().entities[humanId] && setup.Game.getWorld().entities[humanId].locationId, "day_work_declined");
        const initialPresentation = splitPresentation([declinedEntry], humanId);
        emitCommittedPresentation(options, initialPresentation, { phase: "human", actorId: humanId });
        const waveResult = await setup.AITurnScheduler.processAfterSubmit(client || setup.OpenRouterClient, {
            alreadyReactedCharacterIds: declined.value.reactedCharacterIds || [],
            onCommittedResult: function (aiResult) {
                const described = describeAIResult(aiResult, humanId);
                emitCommittedPresentation(options, described, { phase: "ai-reaction", actorId: aiResult.actorId || null });
            }
        });
        const wavePresentation = describeWave(waveResult, humanId);
        const presentation = splitPresentation(initialPresentation.entries.concat(wavePresentation.entries), humanId);
        const narration = await narratePresentation(presentation, humanId);
        return {
            ok: Boolean(waveResult.ok),
            error: waveResult.ok ? null : clone(waveResult.error),
            actorId: humanId,
            turnConsumed: false,
            waveResult: clone(waveResult),
            timelapseResult: null,
            narrativeFragments: narration.used ? narration.narratedFragments : narration.rawFragments,
            rawNarrativeFragments: narration.rawFragments,
            narratedNarrativeFragments: narration.narratedFragments,
            narrator: { attempted: narration.attempted, used: narration.used, fallbackUsed: Boolean(narration.attempted && !narration.used), error: narration.result && !narration.result.ok ? clone(narration.result.error) : null },
            hiddenNarrativeEntries: presentation.hidden,
            historyEntries: presentation.entries
        };
    }

    async function pass(client, options) {
        options = options && typeof options === "object" ? options : {};
        const actorId = setup.Game.getHumanCharacterId();
        if (setup.Game.isPlayerSetupComplete && !setup.Game.isPlayerSetupComplete()) {
            return { ok: false, error: { code: "PLAYER_SETUP_INCOMPLETE", message: "Complete Traveler setup before gameplay begins." }, actorId: actorId, turnConsumed: false };
        }
        const tickReservation = beginOrdinaryTick();
        const triggeredResult = setup.TriggeredEvents && typeof setup.TriggeredEvents.processOrdinaryTick === "function"
            ? setup.TriggeredEvents.processOrdinaryTick({ tickId: tickReservation.tickId })
            : { ok: true, events: [] };
        if (!triggeredResult.ok) { rollbackOrdinaryTick(tickReservation); return { ok: false, error: clone(triggeredResult.error), actorId: actorId, turnConsumed: false }; }
        const triggeredPresentation = describeTriggeredResult(triggeredResult, actorId);
        if (triggeredPresentation.entries.length > 0) {
            emitCommittedPresentation(options, triggeredPresentation, { phase: "triggered-event", actorId: null });
        }
        const waveResult = await setup.AITurnScheduler.processWave(client || setup.OpenRouterClient, {
            onCommittedResult: function (aiResult) {
                const described = describeAIResult(aiResult, actorId);
                emitCommittedPresentation(options, described, { phase: "ai-reaction", actorId: aiResult.actorId || null });
            }
        });
        const wavePresentation = describeWave(waveResult, actorId);
        const presentation = splitPresentation(triggeredPresentation.entries.concat(wavePresentation.entries), actorId);
        const narration = await narratePresentation(presentation, actorId);
        return {
            ok: waveResult.ok,
            error: waveResult.ok ? null : clone(waveResult.error),
            actorId: actorId,
            turnConsumed: true,
            waveResult: clone(waveResult),
            narrativeFragments: narration.used ? narration.narratedFragments : narration.rawFragments,
            rawNarrativeFragments: narration.rawFragments,
            narratedNarrativeFragments: narration.narratedFragments,
            narrator: {
                attempted: narration.attempted,
                used: narration.used,
                fallbackUsed: Boolean(narration.attempted && !narration.used),
                error: narration.result && !narration.result.ok ? clone(narration.result.error) : null
            },
            hiddenNarrativeEntries: presentation.hidden,
            historyEntries: presentation.entries
        };
    }

    setup.TurnFlow = {
        submitHumanIntent: submitHumanIntent,
        resolveDayWorkOffer: resolveDayWorkOffer,
        pass: pass,
        describeWave: describeWave,
        describeAIResult: describeAIResult
    };
}());
