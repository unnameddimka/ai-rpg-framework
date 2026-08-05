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

    function eventTexts(actionResult) {
        return actionResult && Array.isArray(actionResult.events)
            ? actionResult.events.map(function (event) { return event.text; }).filter(Boolean)
            : [];
    }

    function describeSubmittedIntent(actorId, input, intentResult) {
        const fragments = [];
        const actionResult = intentResult && intentResult.actionResult;
        const actionTexts = eventTexts(actionResult);
        const text = input && typeof input.text === "string" ? input.text.trim() : "";
        const speaker = actorName(actorId);
        const addressee = input && input.target_id ? targetName(input.target_id) : "";

        if (actionTexts.length > 0 && text) {
            fragments.push(`${actionTexts.join(" ")} ${speaker}${addressee ? ` to ${addressee}` : ""} said: “${text}”`);
        } else {
            actionTexts.forEach(function (item) { fragments.push(item); });
            if (text) fragments.push(`${speaker}${addressee ? ` to ${addressee}` : ""} said: “${text}”`);
        }

        if (actionResult && !actionResult.ok && actionResult.error) {
            fragments.push(`${speaker}'s formal action failed: ${actionResult.error.message}`);
        }
        return fragments;
    }

    function describeAIResult(result) {
        const fragments = [];
        if (!result || !result.ok) return fragments;
        if (result.narrativeText && result.narrativeText.trim()) {
            fragments.push(result.narrativeText.trim());
        }
        eventTexts(result.actionResult).forEach(function (text) {
            fragments.push(text);
        });
        if (result.actionResult && !result.actionResult.ok && result.actionResult.error) {
            fragments.push(`${actorName(result.actorId)}'s formal action failed: ${result.actionResult.error.message}`);
        }
        return fragments;
    }

    function describeWave(waveResult) {
        const fragments = [];
        (waveResult && waveResult.results || []).forEach(function (result) {
            fragments.push.apply(fragments, describeAIResult(result));
        });
        return fragments;
    }

    async function submitHumanIntent(input, client) {
        const actorId = setup.Game.getHumanCharacterId();
        const intentResult = setup.CharacterAPI.submitIntent(actorId, input || {});
        if (!intentResult.ok) return intentResult;

        const fragments = describeSubmittedIntent(actorId, input || {}, intentResult);
        const waveResult = await setup.AITurnScheduler.processAfterSubmit(client || setup.OpenRouterClient);
        fragments.push.apply(fragments, describeWave(waveResult));

        return {
            ok: true,
            actorId: actorId,
            intentResult: clone(intentResult),
            waveResult: clone(waveResult),
            narrativeFragments: fragments,
            destinationId: intentResult.actionResult && intentResult.actionResult.ok && input.action && input.action.type === "move"
                ? input.action.destination_id
                : null
        };
    }

    async function pass(client) {
        const waveResult = await setup.AITurnScheduler.processWave(client || setup.OpenRouterClient);
        return {
            ok: waveResult.ok,
            error: waveResult.ok ? null : clone(waveResult.error),
            waveResult: clone(waveResult),
            narrativeFragments: describeWave(waveResult)
        };
    }

    setup.TurnFlow = {
        submitHumanIntent: submitHumanIntent,
        pass: pass,
        describeWave: describeWave
    };
}());
