# AI RPG — STM Semantic Repartition / Split Specification

## Status

Follow-up Mind v3 specification.

This change addresses a production failure mode observed during long social scenes where one thematic STM record repeatedly grows until it reaches the 4000-character hard limit.

The goal is **not** to compress STM more aggressively.

The goal is to preserve high-fidelity short-term information while allowing the model to reorganize an oversized thematic STM into multiple semantically meaningful STM records.

---

# 1. Problem

Current STM consolidation strongly prefers updating an existing matching topic.

In long-running scenes this can produce:

```text
existing thematic STM
→ new related observations
→ update same STM
→ more related observations
→ update same STM
→ summary approaches 4000 chars
→ next update exceeds hard limit
→ validation failure
→ repair
→ model tries same oversized update again
→ consolidation never commits
→ verbatim eviction cannot complete
→ verbatim backlog grows indefinitely
```

This has been observed with both Mara and Nell.

The problem is not that the memories contain too much detail.

The problem is that one STM record is being forced to represent too broad a semantic cluster.

---

# 2. Core invariant

> The 4000-character STM hard limit is a record-size boundary, not a signal to discard additional information.

When one STM can no longer represent the relevant evidence within the limit while preserving useful detail, the model should **semantically repartition the information across multiple STM records**.

Do not aggressively compress an STM simply to make it fit.

STM should preserve recent information at relatively high fidelity.

---

# 3. Model-owned semantic partitioning

The model chooses how to divide an oversized thematic memory.

Do not mechanically split by:

- character count;
- time;
- event count;
- midpoint;
- arbitrary `"part 1" / "part 2"` boundaries.

Prefer meaningful semantic clusters.

Example source scene:

```text
long tavern evening involving:
- Dmytro's stories about travel and war
- Mara's autobiographical anecdotes
- Nell growing closer to Dmytro
- playful teasing among all three
- Mara and Nell becoming friendlier
```

Possible resulting STM records:

```text
Travel, war, Rome, and Dmytro's distant homeland

Playful teasing and growing closeness among Dmytro, Mara, and Nell

Mara and Nell becoming more comfortable with each other

Emergent village stories and autobiographical anecdotes
```

The exact partition is model-owned.

---

# 4. Information-preservation goal

When repartitioning:

> Preserve as much meaningful information as reasonably possible from both:
> - the existing STM record;
> - the newly consolidated observation evidence.

The model should not solve size pressure by deleting substantial detail simply because it is easier.

Some abstraction is inherent in STM consolidation, but repartition exists specifically to avoid unnecessary information loss.

---

# 5. Allowed repartition operation

STM consolidation may replace one existing STM with multiple STM records.

Conceptually:

```text
existing STM A
+ new evidence
→ STM B
+ STM C
+ STM D
```

The original STM A may therefore disappear if its information is adequately represented by the replacement set.

This is different from merely creating a continuation memory while leaving A untouched.

The model may:

- preserve A and create B;
- materially update A and create B;
- replace A with B + C;
- replace A with B + C + D;

depending on the semantic structure of the material.

---

# 6. Identity semantics

STM IDs remain engine-owned.

The model must not invent canonical memory IDs.

For repartition proposals, the model describes:

- which existing STM record(s) are being replaced/reorganized;
- the desired resulting STM records.

The engine allocates new IDs for newly created STM records at commit time using the current canonical global memory-ID allocator.

Existing STM IDs may be retained where one resulting record is a clear continuation of an existing topic.

Exact ID allocation must continue to obey the existing serialized commit invariant.

---

# 7. Proposed protocol extension

Extend the STM consolidation result with an explicit repartition operation.

Conceptual shape:

```json
{
  "stmUpserts": [],
  "stmCreates": [],
  "stmRepartitions": [
    {
      "sourceStmIds": ["memory_ai_592"],
      "replacementRecords": [
        {
          "topic": "...",
          "summary": "...",
          "importance": 0.7,
          "retrievalBrief": "..."
        },
        {
          "topic": "...",
          "summary": "...",
          "importance": 0.8,
          "retrievalBrief": "..."
        }
      ]
    }
  ]
}
```

Exact field names may follow current project conventions.

The important semantic distinction is:

> Repartition explicitly states that the resulting records collectively replace/reorganize the source STM record(s).

---

# 8. Why explicit repartition is preferable

Do not infer repartition solely from:

```text
upsert A
+ create B
```

because the engine then cannot reliably know whether:

- A is still complete;
- B merely adds new information;
- B contains information moved out of A;
- A is now redundant;
- deleting/replacing A would lose information.

Explicit repartition gives the validator a meaningful atomic operation.

---

# 9. Repartition atomicity

A repartition operation is atomic.

Conceptually:

```text
validate entire replacement set
→ allocate required new IDs
→ candidate-clone transformation
→ validate resulting mind
→ commit
```

If any replacement record is invalid:

- do not remove the source STM;
- do not partially create replacement STM;
- the whole repartition operation fails.

Existing canonical STM remains intact.

---

# 10. Size rules

Each resulting STM record must satisfy:

```text
summary <= 4000 characters
retrievalBrief <= 600 characters
```

The model should generally remain substantially below the hard boundaries when semantic partitioning allows it.

However:

> The prompt must not instruct the model to reduce detail merely to target an arbitrary smaller size.

The priority order is:

1. semantic coherence;
2. information preservation;
3. compliance with hard record limits;
4. compactness.

---

# 11. Retrieval brief rules

Each replacement record receives its own retrieval brief.

Existing brief invariant remains:

- retrieval metadata only;
- describe what the memory is about;
- describe when/why it is relevant;
- do not duplicate the full summary;
- do not chronologically retell the events;
- hard limit 600 characters.

Repartition therefore also improves retrieval granularity.

Instead of one broad catalog entry:

```text
"Tavern evening with Dmytro and Nell"
```

the selector may later see several more discriminative entries.

---

# 12. Prompt change

Update STM consolidation instructions.

Current preference:

> Prefer updating an existing matching topic over creating duplicates.

must be qualified.

New meaning:

> Prefer updating an existing STM when the new evidence still belongs to a coherent bounded memory record.

Add explicitly:

> Do not force all evidence about a broad or continuing topic into one STM record.

> If an existing STM has grown too broad or cannot incorporate new relevant evidence while preserving useful detail within the 4000-character summary limit, semantically repartition it into multiple STM records.

> Choose meaningful subtopics yourself. Do not mechanically create chronological "part 1 / part 2" chunks unless chronology itself is the meaningful distinction.

> Preserve important information from the original STM and the new observations across the replacement set.

---

# 13. Repair guidance

Improve STM validation errors.

Instead of only:

```text
Invalid STM upsert.
```

provide actionable diagnostics such as:

```text
STM memory_ai_592 proposed summary is 6356 characters.
Hard maximum is 4000 characters.

Do not discard meaningful information merely to fit the existing record.
You may:
- semantically repartition the source STM into multiple coherent STM records; or
- produce another valid structure that preserves the relevant information.
```

This gives repair a route out of the failure loop.

---

# 14. Repartition source coverage

A repartition result must not silently discard the entire semantic content of its source STM.

Validation cannot perfectly prove semantic preservation deterministically.

Therefore use two layers:

## Structural guarantees

The engine ensures:

- source STM exists;
- replacement set is non-empty;
- all replacement records are valid;
- no source is removed unless the whole operation validates;
- protected STM rules are respected.

## Semantic responsibility

The model prompt explicitly requires preserving meaningful source information.

No additional audit-model pass is required.

This follows the current Mind v3 philosophy of model semantic judgment + engine structural guarantees.

---

# 15. Protected STM

Protected-memory invariants remain authoritative.

A protected STM must not be removed through repartition unless current protected-memory semantics explicitly permit transformation.

Default rule:

> Repartitioning must not bypass protected-memory safeguards.

If protected STM is transformable under existing rules, the resulting replacement set must preserve the protected information according to those rules.

Do not treat repartition as a deletion loophole.

---

# 16. Relationship to new observations

Repartition may use:

- one or more existing STM records;
- current consolidation evidence from verbatim observations.

This allows the model to reinterpret the topical structure once additional events reveal that the old grouping was too broad.

Example:

Initially:

```text
STM:
Tavern evening with Dmytro and Nell
```

After much more interaction, the model may realize the useful durable short-term structure is:

```text
Dmytro's travel stories and background

Playful group teasing and increasing social closeness

Mara and Nell's developing friendship
```

This is expected.

---

# 17. Multiple-source repartition

The protocol may permit more than one source STM in a single repartition if the model decides two existing STM records should be reorganized together.

Example:

```text
STM A: conversation with Dmytro
STM B: jokes with Nell
```

may become:

```text
STM C: Dmytro's personal history
STM D: group bonding with Dmytro and Nell
```

This is optional capability but architecturally desirable.

If implemented, source STM IDs within one repartition must be unique and existing.

Overlapping repartitions affecting the same source STM in one response are invalid.

---

# 18. Interaction with normal upserts

A source STM included in `stmRepartitions` must not simultaneously receive an independent `stmUpsert` in the same proposal.

That would make final ownership ambiguous.

Reject proposals where the same existing STM is:

- repartition source;
- normal upsert target;
- source of another overlapping repartition.

The proposal must describe one unambiguous transformation.

---

# 19. Interaction with STM creation

Normal STM creation remains valid for genuinely new topics.

Repartition should not be required every time a scene changes subject.

Examples:

```text
new unrelated event
→ normal create
```

versus:

```text
existing broad STM has accumulated multiple separable subthemes
→ repartition
```

The model chooses based on semantics.

---

# 20. Commit semantics

Recommended implementation:

```text
snapshot current STM + evidence
→ model proposal
→ normalize
→ validate operations
→ candidate clone

for each normal upsert:
    apply to candidate

for each normal create:
    allocate temporary/provisional representation

for each repartition:
    verify source records unchanged from snapshot
    remove source records in candidate
    add replacement records

→ validate candidate mind
→ serialized canonical commit
→ allocate canonical IDs for new records from live world.nextMemoryId
→ apply eviction cleanup only after successful commit
```

Exact mechanics should remain compatible with the existing parallel-prepare / serialized-commit architecture.

---

# 21. Stale-result handling

Repartition requires stronger stale checks than a simple create.

Before commit:

- every source STM must still exist;
- source STM content relevant to the prepared proposal must still match the snapshot;
- source STM must not have been materially changed by another maintenance operation.

If stale:

- reject the repartition result;
- preserve canonical state;
- future maintenance may recompute.

Ambient retrievalBrief-only changes may continue to use their existing safe stale semantics where appropriate.

---

# 22. Verbatim eviction semantics

Verbatim observations are removed only after a successful STM consolidation commit.

If repartition fails:

```text
source STM remains
+ verbatim evidence remains
```

No information is lost.

After a successful repartition/consolidation:

- normal eviction rules apply;
- newest retained verbatim window remains intact.

---

# 23. Relationship to LTM

STM repartition is not permanent ontology.

Later STM → LTM consolidation may:

- merge multiple STM records;
- preserve them separately;
- reorganize them again;
- extract higher-order durable themes.

Example:

```text
STM:
- travel stories
- playful teasing
- group bonding

→ later LTM:
- Dmytro's background and distant homeland
- growing social bond among Mara, Nell, and Dmytro
```

Therefore STM partitioning should optimize short-term information preservation and retrieval, not predict final LTM structure.

---

# 24. No chronological chunking requirement

Do not require:

```text
Evening part 1
Evening part 2
Evening part 3
```

unless chronological separation is actually meaningful.

Semantic boundaries are preferred.

Good:

```text
Dmytro's travel and war stories

Playful teasing and mutual affection

Mara and Nell becoming friends
```

Acceptable when appropriate:

```text
Before Garrick returned

After the group sat drinking together
```

The model chooses based on meaning.

---

# 25. No new arbitrary STM-count cap

Do not introduce a low global cap on the number of STM records merely because splitting can create more records.

Existing operational safeguards may remain.

The model should create the number of STM records required to represent coherent recent themes within current protocol limits.

If record proliferation becomes a real production problem, address it from evidence later.

---

# 26. Anti-fragmentation guidance

Although splitting is allowed, the prompt should discourage pointless fragmentation.

Add:

> Do not split a coherent memory merely to create smaller records.

> Repartition only when separate themes/subthemes would make the memory more coherent, more retrievable, or necessary to preserve information within the record-size limit.

This balances:

```text
one giant diary record
```

against:

```text
twenty tiny sentence memories
```

---

# 27. Expected production behavior for Mara

Current state conceptually:

```text
memory_ai_592
Tavern evening with Dmytro and Nell
~3735 chars
```

plus substantial new observations.

Instead of:

```text
upsert memory_ai_592 → 6400 chars → FAIL
```

the model should be allowed to propose something like:

```text
replacement STM 1:
Dmytro's travel, war, Rome, and distant homeland stories

replacement STM 2:
Playful teasing and growing intimacy during the tavern evening

replacement STM 3:
Mara and Nell warming to each other in Dmytro's company
```

while retaining meaningful details distributed across the records.

No exact partition is mandated by this specification.

---

# 28. Expected production behavior for Nell

Nell's current near-limit STM should likewise be able to reorganize rather than enter the same failure loop.

For example:

```text
Serving ale independently and dealing with Garrick's absence

Learning about Dmytro's background and decision to remain in the village

Warm group teasing and Nell's growing sense of belonging with Dmytro and Mara
```

Again, this is illustrative only.

---

# 29. Required regression tests

Add tests covering:

1. Existing STM near 4000 + substantial matching new evidence can be replaced by multiple valid STM records.

2. Repartition preserves source STM when any replacement record fails validation.

3. Successful repartition removes/replaces the specified source STM atomically.

4. New replacement STM IDs are engine-allocated.

5. Repartition replacement summaries each obey `<=4000`.

6. Replacement briefs each obey `<=600`.

7. Source STM cannot simultaneously be normal-upserted and repartitioned.

8. Overlapping repartition source sets are rejected.

9. Unknown source STM ID rejects the operation.

10. Stale source STM prevents commit.

11. Verbatim observations remain when repartition commit fails.

12. Verbatim eviction proceeds normally after successful repartition.

13. Protected STM safeguards cannot be bypassed through repartition.

14. Prompt explicitly instructs semantic repartition rather than aggressive compression.

15. Prompt explicitly discourages mechanical part-number splitting.

16. Prompt explicitly emphasizes preservation of meaningful source information.

17. Repair diagnostic for oversized STM mentions semantic repartition as a valid remedy.

18. Existing normal STM upsert behavior remains unchanged for bounded coherent memories.

19. Existing normal STM create behavior remains unchanged for new topics.

20. LTM consolidation accepts the resulting multiple STM records normally.

---

# 30. Documentation update

Update canonical Mind v3 documentation.

Document:

- STM 4000-character limit as per-record boundary;
- high-fidelity STM preservation goal;
- semantic repartition;
- model-owned topical boundaries;
- atomic replacement semantics;
- no forced chronological chunking;
- relationship to later LTM consolidation.

Old task/hotfix specs remain historical and are not deleted.

---

# 31. Acceptance criteria

The change is accepted when:

- Mara/Nell-style long scenes no longer get permanently stuck because one STM reached 4000 characters;
- the system does not solve the problem by aggressively deleting detail;
- the model can semantically reorganize one broad STM into several meaningful STM records;
- all resulting records remain bounded and retrievable;
- failures remain atomic and preserve both existing STM and source verbatim evidence;
- protected-memory invariants remain intact;
- later LTM consolidation works without special handling;
- existing simple STM consolidation behavior remains unchanged.

---

# 32. Final invariant

```text
STM is high-fidelity thematic working memory.

If one thematic record becomes too broad to remain coherent and bounded:

    do not force stronger compression;
    do not mechanically split by size;
    let the model reorganize it into meaningful semantic subtopics;
    preserve the information across the resulting STM set.
```