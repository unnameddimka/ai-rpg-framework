# AI RPG — LTM Semantic Preflight, Sparse Reflection Activation, MVP Status, and API-Key Retention Specification

## Status

Follow-up implementation specification for the current Mind v3 / MVP baseline.

This change addresses two production scaling issues observed with Mara's growing mind:

1. LTM consolidation receives the entire historical LTM archive in full, making the main consolidation request increasingly large and expensive.
2. Timelapse reflection may treat merely visible existing beliefs as newly salient and attempt to activate a large fraction of the belief table.

It also records two product-level baseline changes:

- the project is no longer considered a POC; it is now an MVP;
- persisted API-key retention is extended to seven days.

## 1. Goals

The change must keep all current STM material fully available during STM→LTM consolidation, keep the complete belief landscape available as a significance lens, stop sending every historical LTM summary into the expensive consolidation request, use `retrievalBrief` as the LTM semantic index, preserve high recall, and keep the existing no-op, fresh-evidence, subtractive-LTM, retirement, provenance, and protected-memory invariants intact.

## 2. Two-stage LTM maintenance

STM→LTM maintenance becomes a two-stage workflow:

```text
Stage 1: LTM semantic preflight
Stage 2: selected-context STM→LTM consolidation
```

Stage 1 is read-only. Stage 2 performs the existing memory transformation.

## 3. Stage 1 input

Stage 1 receives:

- all current STM being considered for consolidation, in full;
- every existing LTM only as compact retrieval metadata: `id`, `topic`, `retrievalBrief`, `importance`, plus minimal structural metadata such as `protected` when useful;
- beliefs in full, using the current compact belief records;
- relationships and the same remaining character/background context currently required by LTM maintenance.

Do not send historical LTM `summary` bodies in the general preflight catalog.

## 4. Stage 1 task

The selector has one task:

> Identify every existing LTM whose full contents may plausibly matter to consolidation of the supplied STM.

Relevance includes continuation/update of an old durable topic, duplicate avoidance, semantic overlap, comparison with prior experience, durable autobiographical context, and determining whether current STM is already adequately represented.

The selector must optimize for high recall, not minimum count:

> Missing a genuinely relevant LTM is worse than selecting an extra possibly relevant LTM.

If uncertain, include the LTM. There is no arbitrary numeric selection cap and no target count.

## 5. Stage 1 output

Return only:

```json
{
  "relevantLtmIds": ["memory_ai_123", "memory_ai_456"]
}
```

No LTM writes, belief effects, retirement decisions, explanations, scores, or other mutations are permitted.

Unknown or duplicate IDs are invalid. Preflight failure leaves canonical state unchanged and Stage 2 must not run from an invented/fallback selection.

## 6. Stage 2 input

Stage 2 receives:

- all source STM again in full;
- only the Stage-1-selected historical LTM in full;
- the complete belief landscape;
- relationships and the rest of the current background context in full.

The semantic task, response schema, subtractive LTM semantics, retirement rules, no-op rules, fresh-evidence rules, and higher-order belief rules otherwise remain the same.

## 7. Existing-LTM mutation scope

An existing LTM may be upserted or used as historical LTM provenance only if its full record was selected by Stage 1.

An unselected LTM remains canonical and unchanged but is intentionally unavailable to Stage 2. The model must not invent its contents, cite it, or claim to update it.

New LTM creation is not constrained by preflight selection.

## 8. Beliefs remain the complete significance lens

Do not add a belief preflight in this change.

All beliefs remain available because they help answer what matters to this specific character. A superficially minor event may deserve durable retention because of existing attachments, commitments, fears, goals, or worldview.

Beliefs remain context, not fresh evidence merely because they were supplied.

## 9. Stale-state handling

The Stage-1 result is prepared against a specific mind snapshot. Before Stage 2 runs, the actor's compatible mind state must still match that snapshot under current stale-result rules.

If the mind changes materially between preflight and Stage 2, abort the prepared workflow and preserve the newer canonical state.

The existing final stale check before commit remains authoritative as well.

## 10. RetrievalBrief as archive index

The existing common STM/LTM `retrievalBrief` becomes active LTM-maintenance index infrastructure.

It retains the same semantics:

> Compact retrieval metadata describing what the memory contains and when retrieving the full record would be useful.

It is not a second summary and no LTM-maintenance-specific brief format is introduced.

## 11. Scaling intent

Without preflight, the expensive main consolidation request scales with the entire historical LTM archive.

With preflight, the expensive Stage 2 scales primarily with:

```text
current STM
+ complete significance/background context
+ semantically relevant historical LTM
```

Stage 1 still scans all LTM, but only through compact metadata and returns IDs only. No fixed percentage reduction is promised; the benefit should grow as historical LTM count and summary volume grow.

## 12. Timelapse reflection fresh-activation invariant

Timelapse reflection must not treat belief-table visibility as activation evidence.

Prompt guidance must state:

> Reading or recalling an existing belief is not activation evidence.

> Compatibility between a belief and supplied context is not fresh salience.

> Do not iterate through the supplied belief table looking for beliefs that fit the events.

> `activatedBeliefIds` is sparse and event-driven. Include only beliefs that new events in this timelapse actually brought into focus or materially engaged.

An empty activation set is valid and often preferable.

Existing deterministic reflection-array bounds remain as defense in depth, and activation IDs must come from the supplied belief landscape.

## 13. Existing memory invariants

This change does not alter:

- `Model Output Must Have Effect`;
- no-op upsert rejection;
- fresh-evidence rules for STM/LTM belief effects;
- subtractive LTM semantics;
- semantic fan-out into multiple LTM records;
- unified STM/LTM `summary <= 4000`;
- common `retrievalBrief <= 600`;
- protected-memory safeguards;
- retirement/provenance atomicity;
- absence of an arbitrary LTM write-count cap.

## 14. POC → MVP

The concept is considered proven.

Current project/product terminology changes from `POC` to `MVP` in active user-facing labels, current canonical documentation, and build/story metadata.

Follow-up correction: `StoryTitle` / SugarCube save identity is now `AI RPG Framework MVP`. The MVP loader accepts both the current MVP save ID and the legacy POC save ID, while all newly created saves use the MVP identity.

Historical specs are not mechanically rewritten when `POC` correctly described the project status at the time.

MVP means the concept has been demonstrated and development is now focused on a robust, usable, extensible minimum viable product. It does not mean feature-complete.

## 15. API-key retention

Persisted OpenRouter API-key retention changes to exactly:

```text
7 * 24 hours
```

After the TTL expires, a stored key is invalid and must not be silently restored. The persistence mechanism is otherwise unchanged; this is not a credential-storage redesign.

Current UI text must describe the seven-day retention period.

## 16. Required regression coverage

Cover at least:

1. Stage 1 receives all source STM in full.
2. Stage 1 receives all historical LTM as compact retrieval metadata without summaries.
3. Stage 1 retains complete beliefs/relationships required by current maintenance.
4. Stage 1 returns only existing LTM IDs.
5. Unknown and duplicate IDs are invalid.
6. No arbitrary selector count cap is introduced.
7. High-recall / uncertain-include guidance is present.
8. Stage 1 failure leaves canonical mind unchanged and skips Stage 2.
9. Stale mind after Stage 1 aborts before Stage 2.
10. Stage 2 receives all STM in full again.
11. Stage 2 receives selected LTM in full.
12. Stage 2 does not receive unselected LTM summaries.
13. Stage 2 retains the complete belief landscape.
14. New LTM creation remains independent of selected historical IDs.
15. Existing LTM upserts are restricted to preflight-selected IDs.
16. Existing no-op/fresh-evidence/subtractive/retirement/protected-memory regressions remain green.
17. Reflection prompt explicitly rejects belief-table visibility as activation evidence.
18. Reflection keeps sparse event-driven activation and existing deterministic bounds.
19. Current active product title uses MVP rather than POC.
20. Persisted API-key TTL is exactly seven 24-hour days and expires at the boundary.

## 17. Final invariant

```text
Current STM is the material being consolidated.
Beliefs are the complete significance lens.
Historical LTM is a searchable archive.

Before STM→LTM consolidation:
    show all STM in full;
    show all historical LTM through compact retrieval metadata;
    select every LTM that may plausibly matter, optimizing for high recall;

Then:
    show all STM in full again;
    show only selected historical LTM in full;
    keep the rest of required background context complete;
    perform normal subtractive STM→LTM consolidation.

Do not activate beliefs merely because they were visible.
Belief activation requires fresh event-driven salience.

The active project baseline is MVP, not POC.
Persisted API keys expire after seven days.
```
