(function () {
    "use strict";

    const STATIC_MAX_TOKENS = 400;
    const DYNAMIC_MAX_TOKENS = 700;
    const NARRATOR_TEMPERATURE = 0.7;
    const IMMUTABLE_KINDS = new Set(["human_narrative", "narrative"]);
    let enabled = false;

    const STATIC_SYSTEM_PROMPT = [
        "You are the presentation narrator for a role-playing game.",
        "You do not control characters and you do not decide what happens.",
        "The supplied static location facts are authoritative.",
        "Rewrite them into concise, vivid literary prose suitable for showing the player on entering the location.",
        "Keep a slightly ornate, novel-like voice, but write like an aggressively edited book: prefer one strong detail over several weak ones, avoid filler, and do not repeat the same fact in different words.",
        "Do not invent, remove, or alter concrete locations, objects, architecture, state, actions, people, sounds, weather, lighting conditions, emotions, intentions, atmosphere facts, or causal facts that are not supplied.",
        "Restrained stylistic flavour, rhythm, metaphor, and phrasing are allowed only when they do not create new objective world facts.",
        "Do not add dynamic characters or mutable items that are not supplied.",
        "Return only the finished prose. Usually one or two compact paragraphs are enough. Do not explain the task and do not use a markdown code fence."
    ].join(" ");

    const TICK_SYSTEM_PROMPT = [
        "You are writing the next few lines of a role-playing novel. The game has already decided what happened; you only present it.",
        "tickEvents is the chronological spine of this completed tick. snapshot is the authoritative final visible state, but it is reference information, not a checklist to repeat.",
        "Use tickEvents to tell what just happened and snapshot only when needed to keep the result consistent with the final positions, possessions, visible items, and other visible state.",
        "Some tickEvents have kind=character. Those passages are already written and the game will insert them unchanged. Do not quote, paraphrase, translate, summarize, or reproduce their text. Write only the prose that belongs before, between, and after those passages.",
        "Return one JSON object: {\"prose\":[\"...\"]}. Use one prose slot before the first character passage, one between each pair, and one after the last. A slot may be an empty string when nothing useful belongs there.",
        "Do not add filler just to fill a slot, and do not re-describe unchanged room or snapshot facts unless clarity requires them.",
        "Keep grounded events and results true. Never turn an attempt or failure into success.",
        "Do not invent concrete unsupplied objects, people, actions, sounds, weather, architecture, visible environmental details, emotions, intentions, or causal events.",
        "Restrained rhythm, metaphor, and literary flavour are welcome only when they do not become new objective facts.",
        "Be concise, vivid, slightly ornate, and aggressively edited. Return the JSON object and nothing else."
    ].join(" ");

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function asText(value) {
        return value === undefined || value === null ? "" : String(value);
    }

    function thirdPersonSelfPosition(view) {
        const name = view && view.self && view.self.name || "Character";
        const text = asText(view && view.self && view.self.position_text).trim();
        if (!text) return `${name} is present.`;
        if (/^You are\b/.test(text)) return `${name} is${text.slice("You are".length)}`;
        if (/^You\b/.test(text)) return `${name}${text.slice("You".length)}`;
        return `${name}: ${text}`;
    }

    function itemNames(items) {
        return (Array.isArray(items) ? items : []).map(function (item) {
            return item && (item.name || item.id) || "item";
        }).filter(Boolean);
    }

    function buildStaticFacts(view) {
        if (!view || !view.location) return [];
        const facts = [`Location: ${view.location.name}.`];
        (view.location.description || []).forEach(function (text) {
            if (asText(text).trim()) facts.push(asText(text).trim());
        });
        (view.location.sublocations || []).forEach(function (sublocation) {
            if (sublocation && asText(sublocation.public_text).trim()) facts.push(asText(sublocation.public_text).trim());
        });
        return facts;
    }

    function buildSnapshot(view) {
        if (!view || !view.location || !view.self) return [];
        const facts = [thirdPersonSelfPosition(view)];
        const selfItems = itemNames(view.self.inventory || []);
        if (selfItems.length) {
            facts.push(`${view.self.name || "Character"} carries: ${selfItems.join(", ")}.`);
        }
        (view.location.characters || []).forEach(function (character) {
            if (!character) return;
            const presence = asText(character.presence_text || character.playerDescription).trim();
            const position = asText(character.position_text).trim();
            const combined = [presence, position].filter(Boolean).join(" ");
            if (combined) facts.push(combined);
        });

        const locationItems = itemNames(view.location.items || []);
        if (locationItems.length) {
            facts.push(`Visible dynamic items in ${view.location.name}: ${locationItems.join(", ")}.`);
        }
        (view.accessible_inventories || []).forEach(function (inventory) {
            if (!inventory || inventory.owner_id === view.location.id) return;
            const names = itemNames(inventory.items || []);
            if (!names.length) return;
            facts.push(`Visible dynamic items at ${inventory.name || inventory.owner_id}: ${names.join(", ")}.`);
        });
        return facts;
    }

    function buildTickEvents(entries) {
        const immutableBlocks = {};
        const immutableOrder = [];
        const tickEvents = [];
        let nextId = 1;

        (Array.isArray(entries) ? entries : []).forEach(function (entry) {
            if (!entry || entry.visibleToHuman === false || !asText(entry.text).trim()) return;
            const text = asText(entry.text);
            if (IMMUTABLE_KINDS.has(entry.kind)) {
                const id = `v${nextId++}`;
                immutableBlocks[id] = text;
                immutableOrder.push(id);
                tickEvents.push({
                    kind: "character",
                    id: id,
                    sourceKind: entry.kind || null,
                    actorId: entry.actorId || null,
                    text: text
                });
            } else {
                tickEvents.push({
                    kind: "fact",
                    sourceKind: entry.kind || null,
                    actorId: entry.actorId || null,
                    text: text.trim()
                });
            }
        });

        return {
            tickEvents: tickEvents,
            immutableBlocks: immutableBlocks,
            immutableOrder: immutableOrder
        };
    }

    function staticMessages(view) {
        const facts = buildStaticFacts(view);
        return {
            messages: [
                { role: "system", content: STATIC_SYSTEM_PROMPT },
                { role: "user", content: `STATIC LOCATION FACTS:\n${facts.map(function (fact) { return `- ${fact}`; }).join("\n")}` }
            ],
            input: { staticFacts: facts }
        };
    }

    function tickMessages(view, entries) {
        const snapshot = buildSnapshot(view);
        const stream = buildTickEvents(entries);
        const payload = {
            snapshot: snapshot,
            tickEvents: stream.tickEvents,
            immutableBlockOrder: stream.immutableOrder
        };
        return {
            messages: [
                { role: "system", content: TICK_SYSTEM_PROMPT },
                { role: "user", content: `NARRATOR INPUT JSON:\n${JSON.stringify(payload)}` }
            ],
            input: clone(payload),
            snapshot: snapshot,
            tickEvents: stream.tickEvents,
            immutableBlocks: stream.immutableBlocks,
            immutableOrder: stream.immutableOrder
        };
    }

    function stripSingleCodeFence(value) {
        const text = asText(value).trim();
        const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        return match ? match[1].trim() : text;
    }

    function splitNarratableText(value) {
        const text = asText(value).trim();
        if (!text) return [];
        return text.split(/\n\s*\n+/).map(function (part) { return part.trim(); }).filter(Boolean);
    }

    function validateDynamicObject(parsed) {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.prose)) {
            return {
                ok: false,
                error: "Narrator dynamic response must be an object containing a prose array."
            };
        }
        for (let index = 0; index < parsed.prose.length; index++) {
            if (typeof parsed.prose[index] !== "string") {
                return {
                    ok: false,
                    error: `Narrator prose segment ${index} is not a string.`
                };
            }
        }
        return {
            ok: true,
            prose: parsed.prose.slice(),
            ignoredKeys: Object.keys(parsed).filter(function (key) { return key !== "prose"; })
        };
    }

    function balancedJsonObjectCandidates(value) {
        const text = asText(value);
        const candidates = [];
        const maxCandidates = 64;

        for (let start = 0; start < text.length && candidates.length < maxCandidates; start++) {
            if (text[start] !== "{") continue;
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let index = start; index < text.length; index++) {
                const character = text[index];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (character === "\\") {
                        escaped = true;
                    } else if (character === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (character === '"') {
                    inString = true;
                    continue;
                }
                if (character === "{") {
                    depth++;
                    continue;
                }
                if (character === "}") {
                    depth--;
                    if (depth === 0) {
                        candidates.push({
                            start: start,
                            end: index + 1,
                            text: text.slice(start, index + 1)
                        });
                        break;
                    }
                    if (depth < 0) break;
                }
            }
        }

        return candidates;
    }

    function parseDynamicResponse(value) {
        const raw = asText(value).trim();
        let exactParsed;
        try {
            exactParsed = JSON.parse(raw);
            const exactValidation = validateDynamicObject(exactParsed);
            if (exactValidation.ok) {
                return {
                    ok: true,
                    prose: exactValidation.prose,
                    ignoredKeys: exactValidation.ignoredKeys,
                    responseParsing: {
                        mode: "exact",
                        candidateCount: 0,
                        acceptedCandidateIndex: null,
                        ignoredPrefixLength: 0,
                        ignoredSuffixLength: 0
                    }
                };
            }
        } catch (error) {
            exactParsed = null;
        }

        const candidates = balancedJsonObjectCandidates(raw);
        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index];
            let parsed;
            try {
                parsed = JSON.parse(candidate.text);
            } catch (error) {
                continue;
            }
            const validation = validateDynamicObject(parsed);
            if (!validation.ok) continue;
            return {
                ok: true,
                prose: validation.prose,
                ignoredKeys: validation.ignoredKeys,
                responseParsing: {
                    mode: "recovered",
                    candidateCount: candidates.length,
                    acceptedCandidateIndex: index,
                    ignoredPrefixLength: candidate.start,
                    ignoredSuffixLength: raw.length - candidate.end
                }
            };
        }

        return {
            ok: false,
            error: "Narrator dynamic response contained no usable JSON object with a prose string array.",
            responseParsing: {
                mode: "failed",
                candidateCount: candidates.length,
                acceptedCandidateIndex: null,
                ignoredPrefixLength: 0,
                ignoredSuffixLength: 0
            }
        };
    }

    function assembleDynamicPresentation(proseSegments, immutableBlocks, immutableOrder) {
        const prose = Array.isArray(proseSegments) ? proseSegments.slice() : [];
        const order = Array.isArray(immutableOrder) ? immutableOrder.slice() : [];
        const expectedCount = order.length + 1;
        const receivedCount = prose.length;
        const paddedCount = Math.max(0, expectedCount - receivedCount);
        const extrasAppendedCount = Math.max(0, receivedCount - expectedCount);
        while (prose.length < expectedCount) prose.push("");

        const fragments = [];
        function appendProse(value) {
            fragments.push.apply(fragments, splitNarratableText(value));
        }

        for (let index = 0; index < order.length; index++) {
            appendProse(prose[index]);
            const original = asText(immutableBlocks && immutableBlocks[order[index]]);
            if (original !== "") fragments.push(original);
        }
        appendProse(prose[order.length]);
        for (let index = expectedCount; index < prose.length; index++) {
            appendProse(prose[index]);
        }

        return {
            fragments: fragments,
            text: fragments.join("\n\n"),
            prose: proseSegments ? proseSegments.slice() : [],
            expectedProseCount: expectedCount,
            receivedProseCount: receivedCount,
            paddedCount: paddedCount,
            extrasAppendedCount: extrasAppendedCount
        };
    }

    function traceFor(stage, messages, response, rawContent, validationErrors, parsedValue, presentationInput, responseParsing) {
        return {
            stage: stage,
            presentationInput: presentationInput ? clone(presentationInput) : null,
            responseParsing: responseParsing ? clone(responseParsing) : null,
            attempts: [{
                attempt: 1,
                kind: "narration",
                messages: clone(messages || []),
                modelId: response && response.modelId || null,
                rawContent: rawContent || "",
                usage: response && response.usage ? clone(response.usage) : null,
                providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                parsedValue: parsedValue ? clone(parsedValue) : null,
                responseParsing: responseParsing ? clone(responseParsing) : null,
                validationErrors: clone(validationErrors || [])
            }],
            finalStatus: validationErrors && validationErrors.length ? "invalid" : (response && response.ok ? "valid" : "failed"),
            repaired: false
        };
    }

    function narratorTransport(stage, modelId) {
        const profileName = stage === "location" ? "presentation-location" : "presentation-tick";
        return {
            enforceRequestTiming: true,
            chat: function (messages) {
                const options = setup.AIRequestProfiles.resolve(profileName, { actorId: null });
                options.modelId = modelId;
                return setup.OpenRouterClient.chatWithOptions(messages, options);
            }
        };
    }

    function failureResult(stage, messages, response, modelId, error, rawContent, validationErrors, presentationInput, responseParsing) {
        return {
            ok: false,
            value: null,
            error: error,
            fallbackUsed: true,
            repaired: false,
            modelId: response && response.modelId || modelId,
            usage: response && response.usage || null,
            rawContent: rawContent || "",
            trace: traceFor(stage, messages, response, rawContent || "", validationErrors || [], null, presentationInput, responseParsing),
            execution: { fallbackUsed: true }
        };
    }

    function executeNarration(specification, clientOverride) {
        const spec = specification || {};
        const stage = spec.stage;
        const messages = clone(spec.messages || []);
        const modelId = setup.AIRuntimeSettings.getSelectedNarratorModelId();
        return setup.AIRequestExecutor.executeCustom({
            actorId: null,
            purpose: stage === "location" ? "presentation-location" : "presentation-tick",
            stage: stage,
            messages: clone(messages),
            client: clientOverride || narratorTransport(stage, modelId),
            run: async function (policyClient) {
                const response = await policyClient.chat(messages);
                if (!response || !response.ok) {
                    const error = response && response.error
                        ? clone(response.error)
                        : { code: "NARRATOR_REQUEST_FAILED", message: "Narrator request failed." };
                    return failureResult(stage, messages, response, modelId, error,
                        response && typeof response.content === "string" ? response.content : "", [], spec.input);
                }

                const rawContent = asText(response.content).trim();
                if (!rawContent) {
                    return failureResult(stage, messages, response, modelId,
                        { code: "NARRATOR_EMPTY_RESPONSE", message: "Narrator returned empty content." },
                        rawContent, ["Narrator returned empty content."], spec.input);
                }

                let value;
                if (stage === "tick") {
                    const parsed = parseDynamicResponse(rawContent);
                    if (!parsed.ok) {
                        return failureResult(stage, messages, response, modelId,
                            { code: "NARRATOR_INVALID_RESPONSE", message: "Narrator returned an unusable dynamic response.", details: [parsed.error] },
                            rawContent, [parsed.error], spec.input, parsed.responseParsing);
                    }
                    const assembled = assembleDynamicPresentation(parsed.prose, spec.immutableBlocks || {}, spec.immutableOrder || []);
                    if (!assembled.fragments.length) {
                        return failureResult(stage, messages, response, modelId,
                            { code: "NARRATOR_EMPTY_PRESENTATION", message: "Narrator produced no usable dynamic presentation." },
                            rawContent, ["Narrator produced no usable dynamic presentation."], spec.input);
                    }
                    value = {
                        stage: stage,
                        text: assembled.text,
                        fragments: clone(assembled.fragments),
                        prose: clone(parsed.prose),
                        immutableBlockIds: clone(spec.immutableOrder || []),
                        assembly: {
                            expectedProseCount: assembled.expectedProseCount,
                            receivedProseCount: assembled.receivedProseCount,
                            paddedCount: assembled.paddedCount,
                            extrasAppendedCount: assembled.extrasAppendedCount,
                            ignoredResponseKeys: clone(parsed.ignoredKeys || []),
                            responseParsing: clone(parsed.responseParsing || null)
                        }
                    };
                } else {
                    const prose = stripSingleCodeFence(rawContent);
                    const fragments = splitNarratableText(prose);
                    if (!fragments.length) {
                        return failureResult(stage, messages, response, modelId,
                            { code: "NARRATOR_EMPTY_PRESENTATION", message: "Narrator produced no usable static presentation." },
                            rawContent, ["Narrator produced no usable static presentation."], spec.input);
                    }
                    value = {
                        stage: stage,
                        text: prose,
                        fragments: clone(fragments),
                        immutableBlockIds: []
                    };
                }

                return {
                    ok: true,
                    value: value,
                    error: null,
                    fallbackUsed: false,
                    repaired: false,
                    modelId: response.modelId || modelId,
                    usage: response.usage || null,
                    rawContent: rawContent,
                    trace: traceFor(stage, messages, response, rawContent, [], value, spec.input,
                        stage === "tick" && value && value.assembly ? value.assembly.responseParsing : null),
                    execution: { fallbackUsed: false }
                };
            }
        });
    }

    function describeLocation(view, clientOverride) {
        if (setup.AIRequestExecutor && setup.AIRequestExecutor.isRateLimitCooldownActive
                && setup.AIRequestExecutor.isRateLimitCooldownActive()) {
            return Promise.resolve({
                ok: false, skipped: true, attempted: false, fallbackUsed: true,
                error: {
                    code: "NARRATOR_SKIPPED_RATE_LIMIT",
                    message: "Static narration skipped during provider cooldown.",
                    retryAfterMs: setup.AIRequestExecutor.getRateLimitCooldownRemainingMs()
                }
            });
        }
        if (!enabled) {
            return Promise.resolve({
                ok: false,
                skipped: true,
                fallbackUsed: true,
                error: { code: "NARRATOR_DISABLED", message: "Narrator is disabled." }
            });
        }
        const assembled = staticMessages(view);
        return executeNarration({
            stage: "location",
            messages: assembled.messages,
            input: assembled.input
        }, clientOverride);
    }

    function narrateTick(input, clientOverride) {
        if (setup.AIRequestExecutor && setup.AIRequestExecutor.isRateLimitCooldownActive
                && setup.AIRequestExecutor.isRateLimitCooldownActive()) {
            return Promise.resolve({
                ok: false, skipped: true, attempted: false, fallbackUsed: true,
                error: {
                    code: "NARRATOR_SKIPPED_RATE_LIMIT",
                    message: "Turn narration skipped during provider cooldown.",
                    retryAfterMs: setup.AIRequestExecutor.getRateLimitCooldownRemainingMs()
                }
            });
        }
        if (!enabled) {
            return Promise.resolve({
                ok: false,
                skipped: true,
                fallbackUsed: true,
                error: { code: "NARRATOR_DISABLED", message: "Narrator is disabled." }
            });
        }
        const source = input && typeof input === "object" ? input : {};
        const assembled = tickMessages(source.view, source.entries || []);
        return executeNarration({
            stage: "tick",
            messages: assembled.messages,
            input: assembled.input,
            immutableBlocks: assembled.immutableBlocks,
            immutableOrder: assembled.immutableOrder
        }, clientOverride);
    }

    setup.PresentationAssembler = {
        buildStaticFacts: buildStaticFacts,
        buildSnapshot: buildSnapshot,
        buildDynamicFacts: buildSnapshot,
        buildTickEvents: buildTickEvents,
        buildTickStream: buildTickEvents,
        staticMessages: staticMessages,
        tickMessages: tickMessages,
        parseDynamicResponse: parseDynamicResponse,
        balancedJsonObjectCandidates: balancedJsonObjectCandidates,
        assembleDynamicPresentation: assembleDynamicPresentation
    };

    setup.NarratorService = {
        STATIC_MAX_TOKENS: STATIC_MAX_TOKENS,
        DYNAMIC_MAX_TOKENS: DYNAMIC_MAX_TOKENS,
        NARRATOR_MAX_TOKENS: DYNAMIC_MAX_TOKENS,
        NARRATOR_TEMPERATURE: NARRATOR_TEMPERATURE,
        STATIC_SYSTEM_PROMPT: STATIC_SYSTEM_PROMPT,
        TICK_SYSTEM_PROMPT: TICK_SYSTEM_PROMPT,
        isEnabled: function () { return enabled; },
        setEnabled: function (value) {
            enabled = Boolean(value);
            return { ok: true, enabled: enabled };
        },
        getStatus: function () {
            const settings = setup.AIRuntimeSettings && setup.AIRuntimeSettings.getStatus
                ? setup.AIRuntimeSettings.getStatus()
                : null;
            return {
                enabled: enabled,
                modelId: settings && settings.selectedNarratorModelId || null,
                modelName: settings && settings.selectedNarratorModelName || null
            };
        },
        describeLocation: describeLocation,
        narrateTick: narrateTick
    };
}());
