# AI RPG — LTM Subtractive Consolidation / Unified Record Bounds Specification

## Status

Follow-up Mind v3 specification.

This change clarifies the semantic role of Long-Term Memory, removes the artificial record-size distinction between STM and LTM, and makes STM→LTM consolidation explicitly subtractive rather than compression-ratio-driven.

## 1. Core semantic distinction

The memory pipeline is:

```text
verbatim observations
→ STM
→ LTM
```

STM is a high-fidelity thematic representation of recent experience. Its priority is to preserve as much useful source information as reasonably possible.

LTM is a subtractive representation of experience. Its priority is to preserve the most significant facts that the character should still know after the source STM records are gone.

The difference between STM and LTM is therefore semantic function, not container size.

## 2. LTM as a subtractive function

STM→LTM consolidation conceptually performs:

```text
STM information
- trivial details
- repetition
- transient context
- low-value sequencing
- details unlikely to matter later
= LTM
```

The model should ask:

> If the source STM were permanently deleted after this successful consolidation, which facts would be important for the character to still remember?

Those facts should preferentially survive into LTM.

## 3. No fixed compression ratio

Do not prescribe a numeric STM→LTM compression ratio, retained percentage, or target summary length.

A highly significant STM may preserve most of its semantic content. A repetitive or low-value STM may preserve only a small fraction. The degree of subtraction is model-owned and should emerge from durable significance.

## 4. Durable significance

LTM should preferentially retain facts likely to matter in future interactions, including meaningful personal experience, relationship developments, commitments, conflicts, discoveries, decisions, revelations, important biography, emotionally defining episodes, recurring patterns, and durable changes in understanding.

LTM may intentionally discard repetitive banter, minor physical sequencing, transient logistics, repeated wording, conversational filler, and other details whose later loss would not materially damage autobiographical understanding.

This list is illustrative rather than exhaustive.

## 5. Prefer semantic partition over significant information loss

Information loss in LTM is expected and desirable when it removes low-value material.

However:

> Do not discard a significant durable fact merely because one LTM record would otherwise become too large.

If several distinct durable themes deserve preservation, create several coherent LTM records.

Prefer:

```text
multiple meaningful LTM topics
```

over:

```text
one heavily compressed LTM
that loses significant durable information
```

## 6. Semantic fan-out

One STM may produce zero, one, or many LTM records. Multiple STM records may jointly produce one or many LTM records.

The model owns the semantic boundaries.

Do not split by character count, midpoint, event count, or arbitrary `part 1 / part 2` chronology. Chronological separation is acceptable only when chronology itself is the meaningful durable distinction.

Do not optimize for the minimum number of LTM records. More semantically precise LTM records are acceptable when they preserve durable meaning and improve future retrieval.

## 7. Unified record bounds

STM and LTM now use the same per-record summary boundary:

```text
STM summary <= 4000 characters
LTM summary <= 4000 characters
```

The previous LTM `<=2000` limit is removed.

This is a per-record hard boundary, not a target size and not a compression policy.

Existing LTM records already below 2000 remain valid. No save migration is required for the limit increase.

## 8. Unified retrievalBrief semantics

STM and LTM use one common retrieval-brief mechanism.

For both:

```text
retrievalBrief <= 600 characters
```

`retrievalBrief` is compact semantic retrieval metadata describing what the memory is mainly about and when/why it may matter for retrieval. It is not a second summary and must not retell the event sequence.

The same prompt guidance and validator should be reused for STM, LTM, and retrieval-brief backfill where technically practical.

## 9. Relationship to semantic retrieval

Many LTM records are acceptable because ordinary retrieval uses compact metadata before fetching full summaries:

```text
many STM/LTM records
        ↓
topic + retrievalBrief preflight
        ↓
small relevant subset
        ↓
full summaries
```

Record count is therefore not equivalent to prompt size.

## 10. Existing STM repartition semantics

STM Semantic Repartition remains unchanged:

- STM optimizes for high fidelity;
- oversized or over-broad STM should repartition rather than aggressively discard detail;
- each STM record remains bounded at 4000 characters.

LTM uses the same ability to create multiple semantic topics, but with a different retention criterion: low-value detail may be discarded while significant durable facts should survive.

No new persistent `ltmRepartition` operation is required for the current STM→LTM fan-out case because the existing protocol already supports multiple `longTermMemoriesToAdd` records and retirement groups referencing multiple LTM refs.

## 11. Existing-LTM updates

Existing LTM may still be materially updated when new STM evidence genuinely extends or revises the same coherent durable topic.

The project-wide Model Output Must Have Effect invariant remains authoritative: relevance alone does not justify an upsert, and unchanged LTM must be omitted.

When new durable material is semantically distinct, creating another LTM is preferable to bloating an unrelated existing LTM.

## 12. Retirement semantics

STM retirement remains governed by existing provenance and coverage safeguards.

`represented` means the significant durable content that deserves to survive is represented by one or more resulting LTM records. It does not require preserving every minor STM detail because LTM is intentionally subtractive.

`safe_to_forget` remains available only under its existing rules for material with no unique durable value.

Failed, truncated, stale, or invalid LTM consolidation retires nothing.

## 13. Fresh-evidence and belief invariants

This change does not alter the fresh-evidence contract.

Existing STM/LTM/relationships/beliefs remain context rather than new belief evidence merely because they are reread during consolidation. `higherOrderBeliefEffects` remains sparse and reserved for genuinely new cross-memory inference.

## 14. Prompt requirements

The STM→LTM model prompt must explicitly communicate:

- LTM is subtractive durable memory;
- the primary question is what should remain known after source STM deletion;
- there is no fixed compression ratio;
- low-value details may be intentionally discarded;
- significant durable facts should not be removed merely to reduce record count;
- multiple LTM records are preferred when multiple durable themes deserve preservation;
- mechanical size or `part 1 / part 2` splitting is discouraged;
- each LTM summary must be `<=4000`;
- each retrievalBrief must be `<=600` and uses the common memory retrieval-brief semantics.

## 15. Oversize repair guidance

An oversized LTM diagnostic should report the actual length and hard limit, then tell the model:

- LTM is subtractive, so low-value detail may be removed;
- significant durable facts should be preserved;
- multiple semantically coherent LTM records are preferred when one record contains multiple durable themes;
- do not mechanically split by size merely to satisfy validation.

## 16. Regression requirements

At minimum cover:

1. LTM summaries up to 4000 are accepted.
2. LTM summaries over 4000 are rejected.
3. Existing STM bound remains 4000.
4. STM/LTM retrievalBrief remain bounded at 600.
5. Existing <=2000 LTM need no migration.
6. A production-like ~3008-character LTM can commit intact.
7. LTM prompt defines subtractive semantics and the post-STM-deletion retention criterion.
8. Prompt specifies no fixed compression ratio.
9. Prompt allows low-value information loss.
10. Prompt permits multiple LTM records for multiple durable themes.
11. Prompt discourages minimum-record optimization and mechanical chronological splitting.
12. Oversize repair mentions both subtraction and semantic fan-out.
13. STM/LTM/backfill reuse the same retrievalBrief guidance and validator where practical.
14. Existing no-op, fresh-evidence, retirement, protected-memory, and STM repartition regressions remain green.
15. No arbitrary LTM write-set cap is introduced.

## 17. Acceptance criteria

Accepted when:

- STM and LTM both use a 4000-character summary hard boundary;
- both use the same <=600 retrievalBrief semantics/validation;
- STM→LTM is explicitly subtractive rather than fixed-ratio compression;
- durable significance determines what survives;
- low-value detail may be lost intentionally;
- significant independent facts are not discarded merely to minimize count or fit one record;
- semantic fan-out into multiple LTM records is supported and encouraged when useful;
- existing retirement, no-op, fresh-evidence, and protected-memory invariants remain intact;
- the Mara-style 3008-character LTM no longer fails because of the obsolete 2000-character boundary;
- full regressions pass.

## 18. Final invariant

```text
STM preserves recent experience with high fidelity.

LTM is subtractive memory.

When STM is converted to LTM:
    ask what the character should still know
    after the STM is permanently gone;

    preserve the most significant durable facts;
    discard minor, repetitive, transient, and low-value information;
    do not use a fixed compression ratio;

    do not discard a significant fact merely
    to reduce the number or size of records;

    when useful, create additional coherent LTM topics.

STM and LTM share the same record bounds:
    summary <= 4000 characters
    retrievalBrief <= 600 characters

Their difference is semantic function,
not container size.
```
