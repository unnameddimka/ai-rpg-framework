(function () {
    "use strict";

    const NARRATOR_MAX_TOKENS = 1200;
    const NARRATOR_TEMPERATURE = 0.7;
    const VERBATIM_KINDS = new Set(["human_narrative", "narrative"]);
    let enabled = true;

    const STATIC_SYSTEM_PROMPT = [
        "You are the presentation narrator for a role-playing game.",
        "You do not control characters and you do not decide what happens.",
        "The supplied static location facts are authoritative.",
        "Rewrite those facts into concise, natural literary prose suitable for showing the player on entering the location.",
        "Do not invent, remove, or alter locations, objects, architecture, state, actions, people, atmosphere facts, or causal facts.",
        "Do not add dynamic characters or items that are not supplied.",
        "You may combine repetitive sentences and vary wording, but every supplied fact must remain true.",
        "Return only the finished prose. Do not explain the task and do not use a markdown code fence."
    ].join(" ");

    const TICK_SYSTEM_PROMPT = [
        "You are the presentation narrator for a role-playing game.",
        "You do not control characters, choose actions, simulate psychology, or change the world.",
        "Everything supplied outside protected verbatim blocks is authoritative grounded presentation material.",
        "Rewrite the non-verbatim material into concise, natural literary prose while preserving every supplied fact and the causal order of the tick.",
        "The CURRENT DYNAMIC SCENE is the final visible state after the tick. Describe all supplied character positions and visible dynamic items; wording may vary from tick to tick.",
        "The TICK STREAM is chronological. Keep grounded actions and results in causal order relative to protected character text.",
        "Produce one continuous scene presentation: weave the final dynamic snapshot and chronological tick stream together instead of writing separate snapshot and event summaries.",
        "Place literary prose before, between, and after protected blocks where that best preserves causal flow. The protected character blocks must remain inline inside that prose, not collected into a separate section.",
        "Never invent actions, dialogue, objects, positions, ownership, results, emotions as objective facts, or unseen events.",
        "Never turn an attempt or failure into a success.",
        "Protected blocks use exactly <verbatim id=\"vN\"> ... </verbatim>.",
        "Their contents are read-only character-authored text. You may read them for linguistic continuity, but do not correct, paraphrase, translate, shorten, extend, split, merge, move, or delete them.",
        "Preserve every verbatim opening tag, id, closing tag, and block order exactly. Every supplied verbatim block must appear exactly once in the returned presentation. Do not introduce new verbatim blocks or nest them.",
        "Write natural prose around the protected blocks and return only the finished mixed presentation. Do not output wrapper tags or a markdown code fence."
    ].join(" ");

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function asText(value) {
        return value === undefined || value === null ? "" : String(value);
    }

    function escapeVerbatimPayload(value) {
        return asText(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
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

    function buildDynamicFacts(view) {
        if (!view || !view.location || !view.self) return [];
        const facts = [thirdPersonSelfPosition(view)];
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

    function buildTickStream(entries) {
        const originals = {};
        const order = [];
        const parts = [];
        let nextId = 1;
        (Array.isArray(entries) ? entries : []).forEach(function (entry) {
            if (!entry || entry.visibleToHuman === false || !asText(entry.text).trim()) return;
            if (VERBATIM_KINDS.has(entry.kind)) {
                const id = `v${nextId++}`;
                const original = asText(entry.text);
                originals[id] = original;
                order.push(id);
                parts.push(`<verbatim id="${id}">\n${escapeVerbatimPayload(original)}\n</verbatim>`);
            } else {
                parts.push(asText(entry.text).trim());
            }
        });
        return { parts: parts, originals: originals, order: order };
    }

    function staticMessages(view) {
        const facts = buildStaticFacts(view);
        return [
            { role: "system", content: STATIC_SYSTEM_PROMPT },
            { role: "user", content: `STATIC LOCATION FACTS:\n${facts.map(function (fact) { return `- ${fact}`; }).join("\n")}` }
        ];
    }

    function tickMessages(view, entries) {
        const dynamicFacts = buildDynamicFacts(view);
        const stream = buildTickStream(entries);
        const streamText = stream.parts.length ? stream.parts.join("\n\n") : "(No chronological tick events need separate presentation.)";
        return {
            messages: [
                { role: "system", content: TICK_SYSTEM_PROMPT },
                { role: "user", content: [
                    "CURRENT DYNAMIC SCENE:",
                    dynamicFacts.map(function (fact) { return `- ${fact}`; }).join("\n") || "- No visible dynamic scene facts.",
                    "",
                    "TICK STREAM:",
                    streamText
                ].join("\n") }
            ],
            originals: stream.originals,
            order: stream.order
        };
    }

    function validateVerbatimResponse(text, expectedOrder) {
        const source = asText(text);
        const expected = Array.isArray(expectedOrder) ? expectedOrder.slice() : [];
        const errors = [];
        const seen = [];
        let activeId = null;
        const tokenPattern = /<verbatim id="([^"]+)">|<\/verbatim>/g;
        let token;
        while ((token = tokenPattern.exec(source)) !== null) {
            if (token[1]) {
                if (activeId !== null) errors.push(`Nested verbatim block '${token[1]}' is not allowed.`);
                activeId = token[1];
                seen.push(activeId);
            } else {
                if (activeId === null) errors.push("Unexpected verbatim closing tag.");
                activeId = null;
            }
        }
        if (activeId !== null) errors.push(`Verbatim block '${activeId}' is not closed.`);

        const openingCount = (source.match(/<verbatim\b/g) || []).length;
        const closingCount = (source.match(/<\/verbatim>/g) || []).length;
        if (openingCount !== expected.length) errors.push(`Expected ${expected.length} verbatim opening tag(s), received ${openingCount}.`);
        if (closingCount !== expected.length) errors.push(`Expected ${expected.length} verbatim closing tag(s), received ${closingCount}.`);
        if (seen.length !== expected.length || seen.some(function (id, index) { return id !== expected[index]; })) {
            errors.push(`Verbatim block order must be exactly: ${expected.join(", ") || "(none)"}.`);
        }
        const unique = new Set(seen);
        if (unique.size !== seen.length) errors.push("Duplicate verbatim block IDs are not allowed.");
        seen.forEach(function (id) {
            if (!expected.includes(id)) errors.push(`Unexpected verbatim block '${id}'.`);
        });

        if (expected.length === 0 && (openingCount || closingCount)) {
            errors.push("Static narration must not introduce verbatim blocks.");
        }
        return { ok: errors.length === 0, errors: errors, seen: seen };
    }

    function splitNarratableText(value) {
        const text = asText(value).trim();
        if (!text) return [];
        return text.split(/\n\s*\n+/).map(function (part) { return part.trim(); }).filter(Boolean);
    }

    function restoreVerbatimFragments(text, originals, expectedOrder) {
        const validation = validateVerbatimResponse(text, expectedOrder);
        if (!validation.ok) {
            return { ok: false, errors: validation.errors, fragments: [], text: "" };
        }
        const source = asText(text);
        const fragments = [];
        const blockPattern = /<verbatim id="([^"]+)">[\s\S]*?<\/verbatim>/g;
        let cursor = 0;
        let match;
        while ((match = blockPattern.exec(source)) !== null) {
            fragments.push.apply(fragments, splitNarratableText(source.slice(cursor, match.index)));
            fragments.push(asText(originals && originals[match[1]]));
            cursor = match.index + match[0].length;
        }
        fragments.push.apply(fragments, splitNarratableText(source.slice(cursor)));
        return {
            ok: true,
            errors: [],
            fragments: fragments.filter(function (fragment) { return fragment !== ""; }),
            text: fragments.filter(function (fragment) { return fragment !== ""; }).join("\n\n")
        };
    }

    function traceFor(stage, messages, response, rawContent, validationErrors, parsedValue) {
        return {
            stage: stage,
            attempts: [{
                attempt: 1,
                kind: "narration",
                messages: clone(messages || []),
                modelId: response && response.modelId || null,
                rawContent: rawContent || "",
                usage: response && response.usage ? clone(response.usage) : null,
                providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                parsedValue: parsedValue ? clone(parsedValue) : null,
                validationErrors: clone(validationErrors || [])
            }],
            finalStatus: validationErrors && validationErrors.length ? "invalid" : (response && response.ok ? "valid" : "failed"),
            repaired: false
        };
    }

    function narratorTransport() {
        return {
            enforceRequestTiming: true,
            chat: function (messages) {
                return setup.OpenRouterClient.chatWithOptions(messages, {
                    modelId: setup.AIRuntimeSettings.getSelectedNarratorModelId(),
                    maxTokens: NARRATOR_MAX_TOKENS,
                    reasoningMaxTokens: 0,
                    temperature: NARRATOR_TEMPERATURE
                });
            }
        };
    }

    function executeNarration(stage, messages, originals, expectedOrder, clientOverride) {
        const modelId = setup.AIRuntimeSettings.getSelectedNarratorModelId();
        return setup.AIRequestExecutor.executeCustom({
            actorId: null,
            purpose: "narration",
            stage: stage,
            messages: clone(messages),
            client: clientOverride || narratorTransport(),
            run: async function (policyClient) {
                const response = await policyClient.chat(messages);
                if (!response || !response.ok) {
                    const error = response && response.error
                        ? clone(response.error)
                        : { code: "NARRATOR_REQUEST_FAILED", message: "Narrator request failed." };
                    return {
                        ok: false,
                        value: null,
                        error: error,
                        fallbackUsed: true,
                        repaired: false,
                        modelId: response && response.modelId || modelId,
                        usage: response && response.usage || null,
                        rawContent: response && typeof response.content === "string" ? response.content : "",
                        trace: traceFor(stage, messages, response, response && response.content || "", [], null),
                        execution: { fallbackUsed: true }
                    };
                }

                const rawContent = asText(response.content).trim();
                if (!rawContent) {
                    const errors = ["Narrator returned empty content."];
                    return {
                        ok: false,
                        value: null,
                        error: { code: "NARRATOR_EMPTY_RESPONSE", message: "Narrator returned empty content." },
                        fallbackUsed: true,
                        repaired: false,
                        modelId: response.modelId || modelId,
                        usage: response.usage || null,
                        rawContent: rawContent,
                        trace: traceFor(stage, messages, response, rawContent, errors, null),
                        execution: { fallbackUsed: true }
                    };
                }

                let restored;
                if (stage === "tick") {
                    restored = restoreVerbatimFragments(rawContent, originals || {}, expectedOrder || []);
                    if (!restored.ok) {
                        return {
                            ok: false,
                            value: null,
                            error: {
                                code: "NARRATOR_INVALID_VERBATIM",
                                message: "Narrator response did not preserve protected verbatim blocks.",
                                details: clone(restored.errors)
                            },
                            fallbackUsed: true,
                            repaired: false,
                            modelId: response.modelId || modelId,
                            usage: response.usage || null,
                            rawContent: rawContent,
                            trace: traceFor(stage, messages, response, rawContent, restored.errors, null),
                            execution: { fallbackUsed: true }
                        };
                    }
                } else {
                    const staticValidation = validateVerbatimResponse(rawContent, []);
                    if (!staticValidation.ok) {
                        return {
                            ok: false,
                            value: null,
                            error: {
                                code: "NARRATOR_INVALID_STATIC_RESPONSE",
                                message: "Narrator returned invalid static presentation framing.",
                                details: clone(staticValidation.errors)
                            },
                            fallbackUsed: true,
                            repaired: false,
                            modelId: response.modelId || modelId,
                            usage: response.usage || null,
                            rawContent: rawContent,
                            trace: traceFor(stage, messages, response, rawContent, staticValidation.errors, null),
                            execution: { fallbackUsed: true }
                        };
                    }
                    restored = {
                        ok: true,
                        fragments: splitNarratableText(rawContent),
                        text: rawContent,
                        errors: []
                    };
                }

                const value = {
                    stage: stage,
                    text: restored.text,
                    fragments: clone(restored.fragments),
                    verbatimIds: clone(expectedOrder || [])
                };
                return {
                    ok: true,
                    value: value,
                    error: null,
                    fallbackUsed: false,
                    repaired: false,
                    modelId: response.modelId || modelId,
                    usage: response.usage || null,
                    rawContent: rawContent,
                    trace: traceFor(stage, messages, response, rawContent, [], value),
                    execution: { fallbackUsed: false }
                };
            }
        });
    }

    function describeLocation(view, clientOverride) {
        if (!enabled) {
            return Promise.resolve({
                ok: false,
                skipped: true,
                fallbackUsed: true,
                error: { code: "NARRATOR_DISABLED", message: "Narrator is disabled." }
            });
        }
        return executeNarration("location", staticMessages(view), {}, [], clientOverride);
    }

    function narrateTick(input, clientOverride) {
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
        return executeNarration("tick", assembled.messages, assembled.originals, assembled.order, clientOverride);
    }

    setup.PresentationAssembler = {
        buildStaticFacts: buildStaticFacts,
        buildDynamicFacts: buildDynamicFacts,
        buildTickStream: buildTickStream,
        staticMessages: staticMessages,
        tickMessages: tickMessages,
        escapeVerbatimPayload: escapeVerbatimPayload,
        validateVerbatimResponse: validateVerbatimResponse,
        restoreVerbatimFragments: restoreVerbatimFragments
    };

    setup.NarratorService = {
        NARRATOR_MAX_TOKENS: NARRATOR_MAX_TOKENS,
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
