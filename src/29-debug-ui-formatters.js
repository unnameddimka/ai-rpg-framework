(function () {
    "use strict";

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function promptLabJson(value, emptyText) {
        return value === null || value === undefined
            ? escapeHtml(emptyText || "None")
            : escapeHtml(JSON.stringify(value, null, 2));
    }

    function promptLabTraceMarkup(run) {
        if (!run || !run.trace) return `<p>No prompt-lab response has been recorded.</p>`;
        const attempts = Array.isArray(run.trace.attempts) ? run.trace.attempts : [];
        return attempts.map(function (attempt) {
            const errors = attempt.validationErrors && attempt.validationErrors.length
                ? `<ul>${attempt.validationErrors.map(function (error) { return `<li>${escapeHtml(error)}</li>`; }).join("")}</ul>`
                : `<p>Protocol validation passed for this response.</p>`;
            const provider = attempt.providerResponse
                ? `<h5>OpenRouter HTTP response</h5><pre>${promptLabJson(attempt.providerResponse, "No provider diagnostics")}</pre>`
                : "";
            return `<details class="prompt-lab-attempt"${attempt.attempt === attempts.length ? " open" : ""}>
                <summary>Attempt ${escapeHtml(attempt.attempt)} &mdash; ${escapeHtml(attempt.kind)}</summary>
                <h5>Messages sent</h5><pre>${promptLabJson(attempt.messages, "No messages")}</pre>
                ${provider}
                <h5>Raw model content</h5><pre>${escapeHtml(attempt.rawContent || "(empty response)")}</pre>
                <h5>Parsed JSON</h5><pre>${promptLabJson(attempt.parsedValue, "JSON parsing did not succeed.")}</pre>
                <h5>Validation</h5>${errors}
                <h5>Usage</h5><pre>${promptLabJson(attempt.usage, "No usage data")}</pre>
            </details>`;
        }).join("");
    }

    function promptLabQueueMarkup(snapshot, hasKey) {
        const queue = snapshot.queue;
        if (!queue || !queue.entries || queue.entries.length === 0) {
            return `<div class="prompt-lab-queue-empty"><strong>The scheduler queue is empty.</strong><p>Speak or act near an AI-controlled character to create an observation for it.</p></div>`;
        }
        return queue.entries.map(function (entry) {
            const selected = snapshot.selectedQueueCharacterId === entry.characterId;
            const classes = ["prompt-lab-queue-entry"];
            if (entry.isNext) classes.push("is-next");
            if (selected) classes.push("is-selected");
            const observations = entry.observationPreview.length
                ? `<ol>${entry.observationPreview.map(function (observation) {
                    const turn = observation.turn === null ? "" : ` <span class="prompt-lab-observation-turn">turn ${escapeHtml(observation.turn)}</span>`;
                    return `<li><span class="prompt-lab-observation-type">${escapeHtml(observation.type)}</span>${turn}<br>${escapeHtml(observation.summary)}</li>`;
                }).join("")}</ol>`
                : `<p>No valid observation preview is available.</p>`;
            const hidden = entry.hiddenObservationCount > 0 ? `<p class="prompt-lab-more">+ ${escapeHtml(entry.hiddenObservationCount)} more observations in this request batch</p>` : "";
            const liveButton = entry.isNext ? `<button class="prompt-lab-process-live"${(!hasKey || snapshot.busy) ? " disabled" : ""}>Process live</button>` : "";
            return `<article class="${classes.join(" ")}" data-character-id="${escapeHtml(entry.characterId)}">
                <header><span class="prompt-lab-queue-number">#${escapeHtml(entry.position)}</span>${entry.isNext ? `<span class="prompt-lab-next-badge">NEXT REQUEST</span>` : ""}${selected ? `<span class="prompt-lab-loaded-badge">LOADED</span>` : ""}</header>
                <h5>${escapeHtml(entry.recipientName)}</h5>
                <dl><dt>Recipient</dt><dd>${escapeHtml(entry.recipientName)} <code>${escapeHtml(entry.characterId)}</code></dd><dt>Location</dt><dd>${escapeHtml(entry.locationName)}</dd><dt>Queued because</dt><dd>${escapeHtml(entry.reason)}</dd><dt>Initiative</dt><dd>${escapeHtml(entry.initiativeScore || 0)}</dd><dt>Request</dt><dd>Decision stage; ${escapeHtml(entry.requestObservationCount)} observation(s); ${escapeHtml(entry.availableActionCount)} formal action type(s)</dd></dl>
                <div class="prompt-lab-observation-list"><strong>Observations that will be sent</strong>${observations}${hidden}</div>
                <div class="prompt-lab-button-row"><button class="prompt-lab-inspect-queue"${snapshot.busy ? " disabled" : ""}>Inspect request</button><button class="prompt-lab-test-queue"${(!hasKey || snapshot.busy) ? " disabled" : ""}>Dry run</button>${liveButton}</div>
            </article>`;
        }).join("");
    }

    function mindV3DebugHtml(character) {
        if (!character || character.type !== "character" || !character.mind) return "Mind unavailable.";
        const mind = character.mind;
        const aux = setup.MindAuxExecutor && typeof setup.MindAuxExecutor.getStatus === "function" ? setup.MindAuxExecutor.getStatus() : { jobs: [], lastErrorByCharacterId: {} };
        const job = (aux.jobs || []).find(function (record) { return record.characterId === character.id; });
        const lastError = aux.lastErrorByCharacterId && aux.lastErrorByCharacterId[character.id];
        const diagnostics = character.mindDiagnostics && character.mindDiagnostics.beliefHistoryById || {};
        const beliefs = (mind.beliefs || []).map(function (belief) {
            const history = diagnostics[belief.id] || [];
            const recent = history.length ? history[history.length - 1] : null;
            const delta = recent ? ` — ${escapeHtml(recent.source || "change")}${typeof recent.deltaConfidence === "number" ? ` Δc=${escapeHtml(recent.deltaConfidence.toFixed(3))}` : ""}${typeof recent.deltaActivation === "number" ? ` Δa=${escapeHtml(recent.deltaActivation.toFixed(3))}` : ""}` : "";
            return `<li><code>${escapeHtml(belief.id)}</code> ${escapeHtml(belief.text)} <small>(c=${escapeHtml(Number(belief.confidence).toFixed(3))}, a=${escapeHtml(Number(belief.activation).toFixed(3))})${delta}</small></li>`;
        }).join("") || "<li>none</li>";
        const stm = (mind.shortTermMemories || []).map(function (memory) { return `<li><code>${escapeHtml(memory.id)}</code> ${escapeHtml(memory.topic)}</li>`; }).join("") || "<li>none</li>";
        const ltm = (mind.longTermMemories || []).map(function (memory) { return `<li><code>${escapeHtml(memory.id)}</code> ${escapeHtml(memory.topic)}</li>`; }).join("") || "<li>none</li>";
        return `<div><strong>Mind v3 debug — ${escapeHtml(character.name)}</strong></div>
            <div>Verbatim: ${escapeHtml((mind.verbatimObservations || []).length)} · Pending: ${escapeHtml((mind.pendingObservations || []).length)} · Revision: ${escapeHtml(character.mindRevision || 0)}</div>
            <div>Aux job: ${escapeHtml(job ? job.state : "idle")}${lastError ? ` · last error: ${escapeHtml(lastError.code || lastError.message || "error")}` : ""}</div>
            <details><summary>Beliefs (${escapeHtml((mind.beliefs || []).length)})</summary><ul>${beliefs}</ul></details>
            <details><summary>STM topics (${escapeHtml((mind.shortTermMemories || []).length)})</summary><ul>${stm}</ul></details>
            <details><summary>LTM topics (${escapeHtml((mind.longTermMemories || []).length)})</summary><ul>${ltm}</ul></details>`;
    }

    setup.DebugUIFormatters = {
        promptLabJson: promptLabJson,
        promptLabTraceMarkup: promptLabTraceMarkup,
        promptLabQueueMarkup: promptLabQueueMarkup,
        mindV3DebugHtml: mindV3DebugHtml
    };
}());
