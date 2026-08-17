# Post-Daytime Patch Bugfix — Timelapse Maintenance, Diagnostics & UI Labels

## Scope

This is a focused bugfix patch on top of the Daytime Timelapse / Jobs / Weather implementation.

It fixes only the issues discovered during the first live playthrough:

1. concurrent mind-maintenance commit races that can abort a completed timelapse and return the world to `Evening`;
2. Emergency Dump completeness so one dump contains the Sphere / AI exchange log and the actual coarse-time failure result;
3. misleading same-location sublocation exit labels;
4. misleading lock/unlock passage labels.

A later consistency/refactoring pass remains separate future work. Existing historical task specs remain unchanged.

## Maintenance concurrency defect

`world.nextMemoryId` is a global allocator for unique `memory_ai_N` IDs. Multiple character maintenance operations may prepare concurrently against the same allocator value. If one operation commits first and advances the allocator, unrelated operations must not become stale merely because the shared allocator changed.

The required maintenance architecture is:

```text
parallel prepare
→ await barrier
→ sequential commit
```

### Parallel prepare

Per-character maintenance computations, including model calls and structured response validation, may run concurrently. Prepare operations may read canonical state and produce proposed mind changes, but they must not mutate shared canonical world state and must not advance the canonical global memory-ID allocator.

### Barrier

No prepared maintenance result is committed until every prepare operation in the batch has finished.

### Sequential commit

After the barrier, commit prepared results one at a time. Each commit validates only the relevant maintained character state, materializes any newly generated memory IDs from the then-current canonical `world.nextMemoryId`, applies the candidate mind state, increments the allocator, validates the resulting world, and then proceeds to the next character.

A different character advancing `world.nextMemoryId` is not a stale condition. Genuine same-character changes to the maintained mind/maintenance cursor between prepare and commit remain stale and must still be rejected.

The fix belongs in the canonical shared maintenance pipeline so manual maintenance and timelapse maintenance use the same prepare/commit behavior. Timelapse may use a batch helper to run multiple prepares concurrently and commits sequentially.

Existing timelapse committed-round rollback semantics remain unchanged.

## Timelapse diagnostics

Emergency Dump must contain enough information to diagnose handled coarse-time failures without requiring a second Sphere export.

Add the full portable AI exchange/Sphere diagnostic representation to the dump, including source/focus request, last run, Sphere state, exchange history, scheduler queue, and safe runtime/game summary. Reuse the existing Prompt Lab exchange-log builder rather than inventing a second schema. API keys and authorization secrets must remain excluded/redacted.

The runtime must also retain the latest coarse-time result, including handled `ok:false` failures. Diagnostic state should identify at least:

- mode;
- success/failure;
- error;
- committed round count;
- failed stage where available.

The failure stage should distinguish planning/round work/reflection/maintenance prepare/maintenance commit/settlement/final validation when the engine knows that boundary.

Emergency Dump remains a cross-cutting escape hatch and must stay usable under gameplay locks, pending job overlay, AI processing, timelapse, maintenance, error states, and `Thinking...`.

## Same-location sublocation labels

The grounded `move_within_location` mechanic is correct, but UI labels must not imply re-entering the top-level location when the actor is already inside it.

When moving from furniture/posture to the generic/default interior of the same location, use a local reverse-action label:

- bed → `Get up`;
- table/seated position → `Stand up`;
- other positioned sublocation → a concise generic equivalent such as `Step away` or `Return to the room`.

Authored enter labels remain valid when moving into a specific sublocation. Do not build a new posture architecture for this bugfix.

## Lock/unlock labels

Player-facing lock controls must refer to the connecting door rather than implying the destination itself is locked.

Default labels:

```text
Lock the door to <destination name>
Unlock the door to <destination name>
```

This rule is relative to the actor's current side of the passage, so from a guest room it names the Upstairs Corridor, and from the corridor it names the relevant Guest Room.

No generic passage ontology is introduced in this patch.

## Confirmed non-bug

Already-sleeping AI characters do not need nighttime planner calls merely to continue sleeping. If Harlan is the only awake AI at night, it is correct for him to be the only AI receiving an active night plan while all relevant characters may still participate in reflection/maintenance.

Do not change nighttime roster behavior.

## Required regression coverage

Add tests for:

- multiple concurrent maintenance prepares that each generate new memories, followed by sequential commits with globally unique final IDs and no false cross-character stale failure;
- real same-character stale detection remaining active;
- a night timelapse with one awake planner and multiple maintained minds completing successfully to `Morning`;
- Emergency Dump containing the portable Sphere/AI exchange log plus the last handled coarse-time failure/result and no secret;
- Emergency Dump remaining callable under a blocking job overlay;
- cottage bed reverse label `Get up`;
- cottage work-table reverse label `Stand up`;
- door lock/unlock labels using `the door to <destination>` from both sides.

## Documentation policy

Update living architecture/status documentation as needed. Do not modify pre-existing historical specs under `docs/engine` or `docs/world`; this file is the new historical spec for the bugfix.

## Diagnostic addendum: low-level transport and weather visibility

The high-level Sphere / AI exchange log is not the sole diagnostic source. Requests may fail below the semantic/request-management layer before a normal exchange record is completed, and framework-owned external API requests are not model exchanges at all.

### Low-level AI transport log

Add a bounded diagnostic log at the lowest shared OpenRouter transport layer. It must observe every physical model HTTP attempt regardless of caller, including ordinary character decisions, timelapse planning/interactions, reflection, maintenance/reconciliation, reward settlement, weather narration, presentation narration, Prompt Lab, and future callers using the same transport.

Each physical attempt records, where available:

- start/end timestamps and duration;
- actor ID and semantic purpose/stage propagated by the shared executor;
- model/provider/endpoint;
- physical attempt number within the semantic execution;
- HTTP status/status text;
- timeout/network exception;
- sanitized provider response/body diagnostics;
- raw assistant content when a response exists;
- final transport success/failure.

A failed request must remain visible even when it dies before an HTTP response, for example `Failed to fetch`, hard timeout, HTTP 429/5xx, malformed provider JSON, or provider rejection. The log is a bounded ring buffer (initially up to roughly 200 physical attempts) and never exports API keys, Authorization headers, tokens, or comparable secrets.

The existing high-level semantic exchange log remains. The two layers answer different questions: semantic exchange logging explains what the framework asked and whether structured validation/repair succeeded; transport logging explains what physically happened at the provider boundary.

Emergency Dump must export the transport history as `ai-transport-log.json`.

### External network log

Framework-owned non-AI HTTP calls use a small shared bounded network diagnostic facility. This is not a browser-wide HTTP interceptor. It currently covers the real-weather pipeline and may be reused by comparable infrastructure APIs later.

Each entry records purpose/stage, service, sanitized endpoint, timestamps/duration, HTTP status, parse/network failure, and concise provider error information. Do not persist the user's public IP merely because an IP-geolocation service returns it. Emergency Dump exports this history as `network-log.json`.

### Weather pipeline diagnostics

The weather subsystem retains the latest refresh attempt with explicit stages:

```text
ip-geolocation
weather-fetch
weather-narration
weather-commit
```

The diagnostic state records success/failure, `failedStage`, fallback use, previous/final weather source, and the concrete error. Emergency Dump exports it as `weather-runtime.json`.

Weather failure remains non-fatal: preserve existing saved weather, or the fixed neutral fallback when no successful narrative exists, and allow the coarse-time transition to complete. The reason must no longer be silently discarded.

### IP geolocation provider correction

Use a browser-CORS-capable public IP geolocation endpoint suitable for direct JavaScript access. The implementation uses `https://ipwho.is/`, then feeds the resulting approximate coordinates to Open-Meteo. Accuracy is intentionally non-critical. No browser geolocation permission is introduced.

### Narrator-toggle independence

The ordinary **Enable narrator** presentation toggle does not control weather rendering. Weather narration is infrastructure: a successful refresh still performs IP lookup → Open-Meteo → narrowly scoped weather Narrator → canonical `weatherNarrative` commit while the optional presentation Narrator is disabled.

### Additional regression coverage

Add tests proving:

- a successful physical OpenRouter request appears in the low-level transport log with propagated actor/purpose/stage/attempt metadata;
- a pre-response network failure appears in the transport log;
- Emergency Dump includes semantic AI exchange, AI transport, external network, weather runtime, and timelapse runtime diagnostics together;
- the weather pipeline uses the CORS-capable IP endpoint followed by Open-Meteo;
- external weather network diagnostics do not export the returned public IP;
- successful weather refresh reaches `weather-commit` and stores `real_weather`;
- failed IP lookup is visible as `failedStage = ip-geolocation` while preserving the prior weather;
- weather narration remains active when the optional presentation Narrator is disabled.
