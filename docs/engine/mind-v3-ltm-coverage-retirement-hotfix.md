# Mind v3 LTM Coverage-Based Retirement Hotfix

## Status

Implemented hotfix specification for Mind v3 long-term-memory consolidation.

This hotfix changes only the STM → LTM retirement contract. It does not change the conceptual roles of STM, LTM, beliefs, verbatim memory, timelapse, protected memories, or atomic commit safety.

## 1. Problem

The first real Mind v3 overnight runs exposed a mismatch between the desired semantics and the existing bounded LTM protocol.

A character may accumulate an unpredictable amount of STM during a lived period. A quiet day may produce very little; a dense day may produce dozens of thematic STM records. Therefore a fixed rule such as “retire at most 12 STM per night” has no semantic relationship to how much memory is actually mature enough for long-term consolidation.

The observed Mara run contained 67 STM records. The LTM model reasonably attempted to consolidate most or all of them into a small number of durable themes. The engine rejected or truncated that attempt because retirement count was bounded even though the actual durable write-set was small.

The problem is not that many STM records were selected for retirement. The real safety question is:

> Is the durable autobiographical content of each retiring STM either represented in resulting LTM, or explicitly judged safe to forget?

Retirement must therefore be bounded by preservation semantics, not by an arbitrary record count.

## 2. Core rule

A single LTM maintenance pass may retire any number of STM records.

The existing LTM write-set remains bounded:

```text
LTM_WRITE_SET_LIMIT = 6
```

There is no numeric STM-retirement limit.

Every retiring STM must belong to exactly one explicit retirement group with one of two dispositions:

- `represented` — meaningful durable content is represented by one or more LTM records that will exist after the same atomic commit;
- `safe_to_forget` — the STM contains routine or low-value detail that the character judges acceptable to forget instead of carrying into LTM.

There is no requirement to empty STM during maintenance. Any STM omitted from retirement groups remains STM for a later pass.

## 3. Protected memory

Protected STM may never be retired through either disposition.

In particular:

```text
protected STM + safe_to_forget = invalid
protected STM + represented = invalid
```

Existing protected-LTM rules remain unchanged.

## 4. One-pass architecture

No separate semantic audit or repair model request is added.

The LTM utility request performs all of the following in one response:

1. sees the complete current STM context;
2. sees existing LTM as durable context;
3. proposes at most six LTM writes;
4. optionally proposes higher-order belief effects/additions under existing limits;
5. explicitly identifies which STM can now be retired and why.

This avoids additional token and latency cost from audit/repair passes.

The model owns the semantic judgment. The engine validates structure, IDs, protected-memory rules, write limits, reference integrity, and atomicity.

## 5. LTM add local references

A new LTM record does not yet have an engine-owned memory ID while the model is constructing its response. Retirement groups nevertheless need to be able to say that retiring STM is represented by that proposed new LTM.

Therefore every `longTermMemoriesToAdd` proposal carries a temporary model-local `ref`:

```js
{
  ref: "new_ltm_1",
  topic: "Trust and intimacy with Dmytro",
  summary: "...",
  importance: 0.9
}
```

The `ref`:

- is unique within the response;
- exists only for cross-reference inside that response;
- is never persisted into canonical mind state;
- does not replace the engine-owned stable memory ID.

At atomic commit the engine allocates the normal `memory_ai_*` ID and stores only the canonical LTM fields.

For compatibility with observed provider output, an LTM add that otherwise has the old valid `{topic, summary, importance}` shape may receive a deterministic temporary ref at ingress. Such an implicitly assigned ref cannot magically satisfy a model-authored coverage reference unless the response actually uses the same ref.

## 6. Retirement groups

The LTM response replaces `shortTermMemoryIdsToRetire` with:

```js
retirementGroups: []
```

### 6.1 Represented group

```js
{
  stmIds: ["memory_ai_10", "memory_ai_11", "memory_ai_12"],
  disposition: "represented",
  representedByLtmRefs: ["memory_ai_90", "new_ltm_1"]
}
```

`representedByLtmRefs` may reference:

- an existing LTM ID that remains after commit;
- an existing LTM ID being materially upserted in this response;
- a temporary `ref` belonging to a proposed LTM add.

At least one reference is required.

### 6.2 Safe-to-forget group

```js
{
  stmIds: ["memory_ai_13", "memory_ai_14"],
  disposition: "safe_to_forget",
  representedByLtmRefs: []
}
```

This disposition is intended for genuinely low-value detail such as routine actions, transient chatter, or detail that no longer matters to future identity/decisions.

It must not claim LTM representation.

### 6.3 Grouping

The model should group many thematically related STM IDs together when they share the same disposition and LTM coverage.

There is deliberately no one-group-per-STM requirement. Compact grouped coverage prevents the preservation contract itself from producing unnecessarily large output.

## 7. Structural validation

Before candidate-clone commit, the engine validates:

- response exact-key shape;
- total LTM upserts + adds ≤ 6;
- all existing LTM upsert IDs are valid and non-protected;
- all LTM-add local refs are non-empty and unique;
- every retirement group has exactly `stmIds`, `disposition`, and `representedByLtmRefs`;
- every retiring STM ID exists in the source snapshot;
- no retiring STM is protected;
- no STM appears in more than one retirement group;
- `represented` groups have at least one valid resulting-LTM reference;
- `safe_to_forget` groups have no LTM references;
- every referenced LTM is either an existing LTM or a proposed LTM-add ref;
- existing belief/LTM write-set limits remain satisfied.

The engine does not attempt a second semantic evaluation of whether the model's LTM prose truly preserves the source content. That semantic responsibility remains with the same utility model call that creates the consolidation proposal.

## 8. Atomic commit

Commit order remains candidate-clone based:

```text
snapshot
→ utility model response
→ ingress normalization
→ structural validation
→ stale check
→ clone current canonical world
→ apply bounded LTM writes
→ apply belief changes
→ remove STM named by validated retirement groups
→ validate complete candidate world
→ atomic world commit
```

No STM is removed before all validation succeeds.

If the response is truncated, malformed, stale, references nonexistent LTM, attempts to retire protected STM, or otherwise fails validation:

- no LTM write commits;
- no belief mutation commits;
- no STM is retired;
- source autobiographical memory remains intact.

## 9. Prompt semantics

The LTM prompt must explicitly state:

- there is no numeric retirement target or quota;
- there is no goal to empty STM;
- retire only when `represented` or `safe_to_forget` is justified;
- if uncertain, leave the STM unretired;
- protected STM is never eligible;
- existing LTM is read-only by default and only materially changed durable topics should be upserted;
- total LTM writes remain bounded at six;
- use compact thematic retirement groups rather than one group per STM;
- new LTM adds use temporary local refs for coverage links.

## 10. Compatibility

The old `shortTermMemoryIdsToRetire` response field is no longer the canonical LTM protocol and is not accepted as proof of safe retirement.

In-flight auxiliary work is transient and is not persisted, so no saved canonical state requires migration for this protocol change.

Existing STM/LTM records require no schema migration.

## 11. Acceptance tests

Add regressions covering at least:

1. 67 STM may all retire in one pass when represented by a bounded LTM delta.
2. LTM writes remain limited to six regardless of STM count.
3. New-LTM temporary refs can be used by represented retirement groups.
4. Temporary refs are not persisted into canonical LTM.
5. Existing LTM IDs can satisfy represented coverage without an upsert.
6. Routine unprotected STM can retire as `safe_to_forget` without creating LTM.
7. Protected STM cannot retire as `safe_to_forget`.
8. Protected STM cannot retire as `represented`.
9. A represented group referencing nonexistent LTM fails atomically.
10. A `safe_to_forget` group with LTM references fails.
11. The same STM appearing in multiple groups fails.
12. STM omitted from all retirement groups remains untouched.
13. Oversized LTM write-set still fails atomically.
14. Invalid/truncated output still preserves all source STM.
15. Night and daytime maintenance mocks use the new retirement-group protocol.

## 12. Final invariant

> STM retirement is not rate-limited by record count. A maintenance pass may retire as much mature STM as it can safely account for through resulting durable memory or explicit low-value forgetting, while LTM mutation itself remains a bounded delta and all removal remains atomic.


## Superseded operation-count rule

The original `LTM_WRITE_SET_LIMIT = 6` rule in this hotfix is superseded by `mind-v3-ltm-evidence-driven-consolidation.md`. Coverage-based retirement remains current; arbitrary LTM operation-count caps do not.
