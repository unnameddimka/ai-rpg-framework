# AI RPG — Semantic Retrieval Tolerant Ingress Hotfix

## Status

Production hotfix specification following the first live semantic-retrieval dumps.

## Goal

Prevent a mostly-correct read-only semantic selection from being discarded because of one harmless model mistake, while keeping canonical STM writes strict and engine-owned state authoritative.

## Observed failures

1. The semantic selector correctly selected relevant family memories, but also hallucinated one nonexistent belief ID. Strict whole-response validation discarded all useful IDs and deterministic fallback omitted the needed memory.
2. The selector sometimes returned more than the configured 16/12/8 budgets or attempted to enumerate a large fraction of the catalog.
3. STM consolidation sometimes echoed `protected:false` from supplied STM context. Because `protected` is not model-writable, the otherwise valid response triggered an unnecessary full repair request.

## Invariant

- **Canonical model writes are strict.** Invalid IDs, illegal operations, protected-memory violations and unknown write fields remain validation errors.
- **Read-only semantic selections are tolerant.** Safe local mistakes are removed without discarding unrelated valid selections.

## Semantic selection sanitation

After JSON parsing and before ordinary decision-context construction:

- require `beliefIds`, `stmIds`, and `ltmIds` arrays;
- discard non-string/empty values;
- discard IDs absent from the supplied catalog;
- discard IDs returned in the wrong mind layer;
- remove duplicates while preserving first occurrence;
- preserve model ordering;
- truncate valid selections to current configured limits (16 beliefs / 12 STM / 8 LTM by current defaults);
- accept the remaining selection even if it is empty.

Do not re-rank a salvaged semantic result with deterministic ranking.

## Fallback

Use deterministic fallback only for genuine selector failure:

- transport/provider/timeout failure;
- empty/no response;
- malformed/unparseable JSON;
- missing/non-array required selection fields.

Unknown IDs, duplicates, wrong-layer IDs, budget overflow, or an empty valid result are not fallback conditions.

Selector parse/truncation failure must not issue a second model repair request; fall back immediately.

## Selector prompt

The Utility selector must be told explicitly:

- return only IDs present in the supplied catalog;
- current maximum belief/STM/LTM counts are maxima, not targets;
- select the smallest sufficient relevant set;
- do not fill unused capacity;
- do not invent IDs;
- return only the required JSON object and no reasoning.

The actual configured limits are inserted dynamically.

## Retrieval diagnostics

Record, in addition to existing selector diagnostics:

- raw selected counts;
- final selected counts;
- dropped unknown IDs;
- dropped wrong-layer IDs;
- dropped duplicate IDs;
- dropped invalid values;
- per-layer trimmed counts;
- whether the semantic result was used;
- whether deterministic fallback was used and why.

No additional full prompt/response duplication is required.

## STM engine-owned field sanitation

Before strict STM upsert/add validation, ignore the known engine-owned echo field:

```text
protected
```

The model-supplied value is never interpreted. It cannot protect or unprotect a memory.

All other STM write rules remain strict. In particular:

- an upsert targeting canonically protected STM is still invalid;
- unexpected non-engine-owned fields remain exact-schema errors;
- the engine remains the sole owner of protected state.

The STM system prompt should explicitly instruct the model not to return `protected`.

## Required regressions

Semantic retrieval tests must cover:

- valid IDs plus one unknown ID are salvaged without fallback;
- wrong-layer IDs are dropped;
- duplicates are dropped;
- over-budget output is truncated in original relevance order;
- mixed corruption still yields a usable semantic result;
- valid empty selection remains semantic and does not fallback;
- malformed JSON falls back with only one selector request;
- provider truncation falls back without retry/repair;
- missing required arrays falls back;
- sanitation diagnostics are populated.

STM tests must cover:

- otherwise valid upsert plus `protected:false` succeeds in one model call;
- model `protected:false` cannot bypass canonical protected-memory validation;
- unrelated unexpected STM write fields remain invalid.

## Non-goals

This hotfix does not change retrieval budgets, deterministic fallback ranking, retrievalBrief lifecycle, timelapse retrieval, belief math, LTM consolidation, snapshot architecture, emergency-dump layout, or broader module boundaries.
