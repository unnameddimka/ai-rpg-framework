# AI RPG Mind Architecture v3

## Status

Design specification for the next mind-system overhaul.

This spec replaces the current layered mind-maintenance behavior for autobiographical memory and beliefs. It does **not** replace authored known facts, relationship state, controller state, world state, or the core perception/scheduler architecture.

The primary design goal is **structural correctness over fine tuning**. Numerical constants are intentionally configurable and may be tuned later. The architecture must remain useful and stable even when those constants are imperfect.

---

# 1. Core model

Mind v3 separates four concepts that must not be conflated:

1. **Pending observations** — unprocessed runtime stimuli used by the scheduler.
2. **Verbatim observations** — already experienced recent history preserved nearly exactly.
3. **Autobiographical memory** — thematic memory of what happened, in short-term and long-term layers.
4. **Beliefs** — inductive interpretations of what remembered experience means.

Relationships remain a separate existing layer for v3. They may later be folded into beliefs, but that is explicitly out of scope for this migration.

The conceptual loop is:

```text
experienced events
    ↓
verbatim observations
    ↓
short-term memory consolidation
    ↓
short-term thematic memories
    ↓
long-term memory consolidation
    ↓
long-term thematic memories

memory at both consolidation levels
    ↕
belief induction / reinforcement / contradiction
    ↕
beliefs influence interpretation and salience

periodic maintenance
    ↓
belief reconciliation + activation decay
```

The central distinction is:

> **Memory answers: “What happened to me?”**

> **Beliefs answer: “What does what happened to me mean?”**

Beliefs may influence interpretation of memory, but beliefs are not themselves remembered events.

---

# 2. Non-goals

Mind v3 does not attempt to:

- simulate human cognition with scientific fidelity;
- implement a vector database or general semantic retrieval engine;
- make beliefs objectively correct;
- eliminate confirmation bias or self-reinforcing interpretations;
- force contradictory beliefs to resolve immediately;
- regenerate a character's old beliefs from old memory during migration;
- turn relationship summaries into beliefs in this version;
- make auxiliary mind work canonical world simulation;
- make background mind work block normal gameplay;
- tune exact reinforcement/decay coefficients to a final value in the first implementation.

---

# 3. Data ownership and layers

## 3.1 Pending observations

`mind.pendingObservations` is the authoritative **AI-scheduler inbox** of stimuli that have not yet been processed through the normal AI reaction flow.

Pending observations are **not autobiographical memory**. They are runtime/scheduler state and must not be used as a substitute for verbatim remembered experience.

Only AI-controlled characters retain delivered observations in this inbox. Human- and Dummy-controlled characters still receive committed experience through the normal perception/verbatim path, but do not retain scheduler pending observations. Switching a character away from AI clears its scheduler inbox; switching a former Human character back to AI starts from a clean inbox plus any new controller-transition observation rather than replaying historical Human experience. Save migration normalizes stale non-AI pending backlogs away.

Verbatim eligibility is based on actual committed/delivered experience, not on whether a scheduler pending record exists.

---

## 3.2 Verbatim observations

Add a persistent per-character layer:

```js
mind.verbatimObservations = []
```

This is the character's recent experienced history in compact perceptual form.

It contains:

- observations actually delivered to and experienced by the character;
- the character's own committed actions;
- the character's own committed spokenText;
- relevant committed public narrative produced by the character when it represents their own experienced action/state;
- committed timelapse experiences.

It must not contain:

- scheduler metadata;
- provider/model diagnostics;
- speculative model output;
- failed or rejected intentions;
- uncommitted actions;
- raw canonical event envelopes;
- hidden information the character could not perceive.

### 3.2.1 Representation

Use a compact observation record designed for persistence and model context, for example:

```js
{
  id,
  turn,
  kind,
  actorId?,
  targetId?,
  text,
  interactionId?,
  sourceEventId?
}
```

The exact field names may follow existing compact observation projection conventions.

The record must be sufficient to reconstruct what the character experienced without carrying engine-internal bookkeeping.

### 3.2.2 Ordering

Verbatim observations are strictly ordered by experienced sequence.

They should have stable IDs so an asynchronous consolidation job can identify exactly which source records it prepared against.

---

# 4. Verbatim retention and STM trigger

## 4.1 Normal gameplay trigger

Default threshold:

```text
STM_CONSOLIDATION_TRIGGER = > 40 verbatim observations
```

A consolidation job should become eligible once the character has more than 40 verbatim observations.

The exact threshold is configurable.

## 4.2 Eviction rule

When STM consolidation begins, take a snapshot of the **entire current verbatim buffer**.

Let:

```text
N = number of verbatim observations in the snapshot
```

The newest 20 observations form the retained window.

All older observations form the eviction set:

```text
retained = newest 20
EvictionSet = all observations before retained
```

Examples:

```text
41 observations → evict 21, retain 20
57 observations → evict 37, retain 20
83 observations → evict 63, retain 20
```

Do **not** process a fixed 40-record chunk and leave arbitrary extra backlog behind.

The model receives the full snapshot, including both the eviction set and retained window.

The prompt must explicitly explain:

- the eviction-set observations will be removed from verbatim memory after successful commit;
- the retained observations will remain available verbatim;
- information in the eviction set therefore has preservation priority;
- retained observations should still be used as context to interpret the older material correctly.

This is a preservation priority, not a claim that older events are inherently more important.

---

# 5. Short-term memory

## 5.1 Purpose

Short-term memory answers:

> **What has been happening recently, organized into topics with minimal information loss?**

STM is a thematic, relatively high-detail representation of experienced history.

It should preserve:

- meaningful event detail;
- who did what;
- important wording or intent when consequential;
- causal relationships;
- uncertainty and subjective interpretation;
- ongoing topics and unresolved developments;
- emotionally meaningful details when relevant.

STM may compress repetition and routine detail, but its primary objective is **organization and initial interpretation**, not aggressive forgetting.

## 5.2 Data model

Recommended shape:

```js
{
  id,
  topic,
  summary,
  importance
}
```

Where:

- `id` is engine-owned and stable;
- `topic` is a concise model-authored thematic label;
- `summary` is the autobiographical memory content;
- `importance` is optional/configurable metadata used primarily for later LTM selection.

STM and LTM now share the same canonical **4000-character per-record summary boundary**. The Utility model may still prefer concise STM summaries at or below **2000 characters** when practical, but that is a preferred STM target rather than a hard boundary. Record capacity no longer defines the difference between STM and LTM: STM optimizes for high-fidelity preservation, while LTM is a subtractive transformation that intentionally removes low-value detail while preserving durable significance. Do not truncate an accepted memory automatically merely because it moved to LTM.

Do not use the topic string as identity.

## 5.3 Upsert and semantic repartition

STM consolidation should prefer updating an existing matching topic **only while the old and new evidence still form one coherent bounded memory record**. It must not force all evidence about a broad or continuing scene into one giant thematic STM.

Example of an ordinary bounded upsert:

```text
Existing STM:
"Price, Nell, and Garrick's tavern banter"

New observations:
more foam-technique jokes and message-fee jokes

Desired result:
update the same coherent STM
```

If one STM becomes too broad, contains separable subthemes, or cannot absorb relevant new evidence while preserving useful detail within 4000 characters, the model may explicitly **semantically repartition** one or more existing unprotected STM records into multiple replacement records.

Conceptually:

```text
existing STM A + new evidence
→ STM B + STM C + STM D
```

The operation is model-owned semantically but engine-owned structurally:

- `sourceStmIds` names the existing STM record(s) being reorganized;
- `replacementRecords` collectively represent the source material after reorganization;
- meaningful information from the source STM and newly consumed eviction evidence should be preserved across the replacement set;
- topical/subtopical boundaries are chosen by the model, not by character count, midpoint, event count, or arbitrary `part 1 / part 2` chunking;
- do not split a coherent bounded memory merely to create smaller records;
- normal STM creation remains appropriate for a genuinely new topic that does not reorganize an existing STM.

A replacement record normally omits `id`, and the engine allocates a new canonical memory ID at serialized commit time from the then-current global allocator. At most one replacement record within one repartition may retain one of that operation's source STM IDs when it is a clear continuation of that source topic. The model never invents canonical memory IDs.

Repartition is atomic. The validator requires existing unique source IDs, a non-empty valid replacement set, no protected source, no overlap between repartitions, and no source that is simultaneously a normal STM upsert target. Every replacement summary independently obeys the 4000-character hard limit and every retrieval brief independently obeys its 600-character limit. If validation, stale checking, candidate validation, or commit fails, source STM and verbatim eviction evidence remain intact.

The existing STM write-set budget remains authoritative: every normal upsert, normal add, and every resulting repartition replacement record counts as one memory write toward `STM_WRITE_SET_LIMIT`. Repartition introduces no separate low global STM-count cap.

The model is explicitly given existing STM and instructed to:

- update a matching thematic memory when it remains coherent and bounded;
- add a new STM for genuinely distinct material;
- repartition an oversized or semantically over-broad STM instead of deleting useful detail to make one record fit;
- preserve important nuance from the eviction set and source STM across the resulting records;
- use retained verbatim observations as interpretive context.

## 5.4 Retrieval metadata

STM and LTM records persist a compact derived index field:

```js
retrievalBrief
```

`topic` plus `retrievalBrief` are used by ordinary-turn semantic preflight retrieval. `summary` remains the canonical autobiographical content and is never replaced by the brief. Retrieval metadata is not evidence, belief, relationship state, or character consciousness.

New or materially updated STM/LTM should update the brief together with the memory. STM, LTM, and ambient brief backfill use one shared retrieval-brief contract and validator. `retrievalBrief` has a hard limit of **600 characters** and should normally be substantially shorter. It is compact retrieval metadata, not a second summary: describe the memory's main subject and when/why it may matter for retrieval; do not retell the event sequence or duplicate the full summary. Older compatible records normalize missing briefs to the empty string. Empty briefs are valid in canonical memory: semantic retrieval can still use the topic alone. During normal maintenance opportunities an independent Utility-model recovery job backfills **all currently empty** STM/LTM briefs using the same shared guidance. That job may write only the brief field, is stale-checked against unchanged topic/summary, creates no full mind recovery snapshot, and never blocks or invalidates autobiographical maintenance or gameplay. Briefs persist through saves and portable-mind transfer.

---

# 6. STM consolidation request

## 6.1 Input

The STM consolidation auxiliary request receives, at minimum:

- character authored identity/AI description;
- the complete verbatim snapshot;
- explicit eviction boundary or eviction IDs;
- existing STM;
- relevant LTM;
- current relationships as contextual state;
- current beliefs including `confidence` and `activation`;
- the shared belief-semantics instruction block defined below.

It must not receive hidden world truth unavailable to the character merely to make memory more objectively correct.

## 6.2 Required task

The request performs two logical tasks in one response:

1. update/add STM;
2. report belief effects induced by the material being consolidated.

The two tasks may share one model call but remain logically distinct in validation and commit.

Recommended response shape:

```js
{
  shortTermMemoriesToUpsert: [
    { id, topic, summary, importance }
  ],
  shortTermMemoriesToAdd: [
    { topic, summary, importance }
  ],
  beliefEffects: [
    {
      beliefId,
      effect,      // supports | contradicts | ambiguous
      strength     // 0..1
    }
  ],
  beliefsToAdd: [
    {
      text,
      initialConfidence,
      initialActivation?
    }
  ],
  activatedBeliefIds: []
}
```

Exact naming may follow existing protocol conventions.

## 6.3 Evidence scope

For **direct belief reinforcement/contradiction**, only information in the current eviction set counts as newly consumed evidence.

The retained final 20 observations may influence interpretation but must not be counted again as fresh reinforcement in future overlapping consolidation passes.

This avoids double reinforcement caused by the rolling verbatim window.

The model may use existing STM/LTM/beliefs to interpret the evidence, but old memory is not automatically new evidence.

---

# 7. Beliefs

## 7.1 Meaning

A belief is an inductive interpretation of remembered experience.

Examples:

```text
Price is unsettling.
Garrick is greedy.
Nell is kind.
Dmytro is the most wonderful person I have ever met.
Authority is dangerous.
I am safer relying on myself than asking officials for help.
```

These statements do not need to have appeared explicitly in any event.

They are conclusions drawn from experience.

Beliefs never overwrite or mutate authored `knownFacts`. Known facts remain a separate authored knowledge layer.

Beliefs may be:

- accurate;
- mistaken;
- biased;
- emotionally loaded;
- self-contradictory;
- resistant to contrary evidence.

This is intentional.

## 7.2 Data model

Beliefs retain existing stable IDs and text.

Required fields:

```js
{
  id,
  text,
  confidence,
  activation
}
```

### Confidence

`confidence` means:

> How strongly the character currently regards this interpretation as true.

### Activation

`activation` means:

> How psychologically salient, accessible, and influential this belief currently is.

Confidence and activation are independent.

Examples:

```text
confidence 0.95, activation 0.10
→ "I strongly believe this, but it is rarely on my mind right now."

confidence 0.55, activation 0.95
→ "I am uncertain, but I am thinking about this constantly."
```

A contradiction may lower confidence while increasing activation.

---

# 8. Shared belief semantics prompt block

Whenever beliefs are supplied to any model request for:

- ordinary character interpretation/decision;
- STM consolidation;
- LTM consolidation;
- belief induction;
- belief reconciliation;
- memory selection/salience decisions;
- any other process where beliefs influence interpretation;

the prompt must include a shared, centralized explanation of belief semantics.

The block should communicate approximately:

> Beliefs are the character's inductive interpretations of what their remembered experience means. They are not objective facts and may be mistaken, biased, incomplete, or contradictory. `confidence` expresses how strongly the character currently considers a belief true. `activation` expresses how psychologically salient and influential the belief currently is. Highly activated beliefs should have more influence on current interpretation and attention. Beliefs may influence how experience is interpreted, but a belief is not itself evidence that confirms itself. New remembered evidence may support, contradict, or reshape beliefs.

Use one shared helper/source string rather than duplicating slightly different explanations across prompts.

---

# 9. Belief reinforcement and contradiction

## 9.1 Model responsibility

For an existing belief, the model does **not** directly choose an arbitrary replacement numeric confidence.

Instead it reports semantic evidence:

```js
{
  beliefId,
  effect: "supports" | "contradicts" | "ambiguous",
  strength: 0.0..1.0
}
```

The model decides:

- whether new evidence is relevant;
- whether it supports or contradicts the belief;
- how diagnostic/strong that evidence is.

The engine owns the confidence update formula.

## 9.2 New beliefs

The model may propose a new belief when the newly processed memory supports a genuinely new durable interpretation.

For a new belief it may provide an initial confidence estimate because there is no previous confidence to update.

The engine validates and bounds the value.

New beliefs should begin with meaningful activation because they were just induced from currently salient experience.

## 9.3 No self-evidence loop

A belief may bias interpretation, but the same belief must not become evidence for itself merely because it influenced that interpretation.

This does **not** prohibit realistic confirmation bias.

It means:

- existing belief can make ambiguous evidence feel more suspicious or important;
- the model may overweight compatible evidence within reason;
- but belief existence alone is not counted as a new supporting event.

Direct reinforcement must ultimately point to newly consumed memory evidence.

---

# 10. Confidence update math

The exact coefficients are configuration, not architecture.

The update function must satisfy these structural properties:

- bounded strictly inside `(0, 1)`;
- diminishing movement near certainty/extreme disbelief;
- stronger evidence produces larger movement;
- contradictory evidence can meaningfully weaken strong beliefs;
- no single ordinary observation should normally jump a belief directly to certainty;
- repeated independent evidence accumulates;
- model cannot bypass the function by directly overwriting confidence.

Recommended representation: **log-odds**.

Convert confidence `p` to:

```text
L = log(p / (1 - p))
```

Then apply signed evidence:

```text
support:     L' = L + K_support * strength
contradict:  L' = L - K_contradict * strength
ambiguous:   no direct confidence movement
```

Convert back:

```text
p' = 1 / (1 + exp(-L'))
```

Clamp only for serialization safety, e.g. `[0.001, 0.999]`, never exact 0 or 1.

`K_support` and `K_contradict` are configurable.

They do not need to be equal.

This is the preferred initial implementation because the useful saturation behavior emerges structurally rather than from many hand-tuned special cases.

---

# 11. Activation dynamics

## 11.1 Activation range

Activation is represented on `(0, 1)` and should not reach exact 1 under normal updates.

## 11.2 Activation increase

Use a saturating update.

Recommended form:

```text
a' = 1 - (1 - a) * exp(-K_activation * strength)
```

Properties:

- low activation rises quickly;
- already-high activation rises slowly;
- repeated activation approaches but does not reach 1;
- strength can represent how strongly the current process made the belief salient.

## 11.3 Sources of activation

Activation may increase when:

- new memory evidence directly concerns the belief;
- the belief is used to interpret a consolidation;
- the belief is explicitly relevant to a current character decision;
- the belief's subject is directly mentioned;
- the belief is contradicted by surprising evidence;
- a reconciliation process actively considers it.

Not every prompt that receives a belief should automatically increase activation.

Prefer explicit returned `activatedBeliefIds` or equivalent structured usage tracking.

## 11.4 Activation decay

Activation decays during timelapse mind maintenance.

Recommended form:

```text
a' = a * exp(-K_decay * elapsedMaintenanceUnits)
```

Exact decay strength is configurable.

Decay affects salience, not remembered history.

A low-activation belief is not automatically deleted.

## 11.5 Confidence does not automatically decay with time

Mind v3 does not apply generic time decay directly to belief confidence.

A character does not stop believing Garrick is greedy merely because they have not seen Garrick for a month.

Instead:

- activation decreases;
- the belief becomes less psychologically influential;
- later evidence or reconciliation may change confidence.

---

# 12. Long-term memory

## 12.1 Purpose

Long-term memory answers:

> **What from my remembered experience remains important enough that I should still know it after the source STM is gone?**

LTM is thematic, durable, and intentionally **subtractive**. STM preserves recent experience with high fidelity; STM→LTM deliberately removes low-value information while retaining the most significant durable facts.

It should preserve, when significant:

- durable relationship history;
- major discoveries;
- important conflicts;
- promises and commitments;
- important changes in understanding;
- emotionally significant episodes;
- recurring patterns;
- identity-relevant biography;
- information likely to affect future decisions.

It may intentionally discard:

- routine detail;
- repetitive wording or banter;
- transient logistics;
- low-value action-by-action sequencing;
- details whose later loss would not materially damage autobiographical understanding.

There is **no fixed compression ratio**. The appropriate degree of subtraction is model-owned: a highly significant STM may retain most of its semantic content, while a routine/repetitive STM may retain little.

LTM and STM share the same **4000-character summary hard boundary**. This is a per-record capacity limit, not a target length or cognitive compression policy. If several distinct durable themes deserve preservation, prefer several coherent LTM records over discarding significant facts merely to keep one record small or minimize record count. Semantic fan-out may be `one STM -> many LTM`, `many STM -> one LTM`, or `many STM -> many LTM`. Do not mechanically split by size or arbitrary `part 1 / part 2` chronology.

## 12.2 STM → LTM consolidation

This occurs during timelapse mind maintenance or explicit manual maintenance. The model may see the complete current STM and existing LTM needed to recognize autobiographical context. Its primary retention question is: **if the source STM were deleted forever after this successful commit, which facts would be important for the character to still remember?**

There is no arbitrary per-pass count limit on justified LTM writes or STM retirement, and the model must not optimize for the minimum number of LTM records. Additional semantically precise records are acceptable because ordinary gameplay uses semantic preflight over `topic + retrievalBrief` before fetching full summaries. Higher-order belief output is not count-targeted: it remains governed by the fresh-evidence contract below and should be sparse, usually empty. Transport uses a dedicated large Utility completion allowance; output size is not itself a cognitive policy.

Every material LTM write carries machine-readable provenance:

```js
{
  id?,
  ref?,
  topic,
  summary,
  retrievalBrief,
  importance,
  sourceStmIds: [],
  sourceLtmIds: []
}
```

At least one meaningful source is required. For an upsert, citing only the target LTM itself is insufficient; self-reference may accompany new STM evidence or another distinct LTM, but cannot justify cosmetic retopicing/rephrasing by itself. New LTM may use a response-local `ref` so retirement coverage can refer to the not-yet-engine-assigned record; this ref never persists in canonical mind state.

STM retirement is selective and evidence-driven rather than count-driven. A pass returns grouped retirement instructions:

```js
retirementGroups: [
  {
    disposition: "represented",
    stmIds: ["..."],
    representedByLtmRefs: ["existing-or-new-ref"]
  },
  {
    disposition: "safe_to_forget",
    reason: "routine" | "redundant" | "transient",
    stmIds: ["..."]
  }
]
```

A group may contain any number of STM records. `represented` means the **significant durable content that deserves to survive** is represented by one or more resulting LTM records; it does not require preserving every minor STM detail because LTM is intentionally subtractive. `safe_to_forget` is intentional forgetting of non-protected material with no unique durable value. Unique promises, boundaries, secrets, important biography, meaningful relationship changes, unresolved goals/conflicts, discoveries, defining episodes and consequential causal facts should be represented rather than casually forgotten. STM omitted from all validated groups remains in STM. Protected-memory semantics remain authoritative.

The engine validates source IDs, response-local refs, coverage uniqueness, forgetting reason codes, protected-memory rules, candidate state and stale sources before one atomic commit. Failed/truncated/invalid LTM work retires nothing. No second semantic audit/repair pass is required merely to judge information preservation; the single consolidation response must provide provenance and retirement justification itself.

## 12.3 Model Output Must Have Effect during memory consolidation

Mind v3 follows the project-wide **Model Output Must Have Effect** invariant. The model may inspect all supplied STM/LTM as context without returning them. Relevance is not mutation. `shortTermMemoriesToUpsert` and `longTermMemoriesToUpsert` contain only records whose normalized model-writable state actually changes; unchanged records are omitted entirely and remain persistent automatically. A memory's effective writable state for deterministic no-op comparison is its normalized `topic`, `summary`, `importance`, and `retrievalBrief`; engine-owned `protected`/ID state and transient provenance/debug metadata do not create a model-authored effect. Cosmetic paraphrase merely to make an otherwise unnecessary upsert look different is forbidden by prompt contract even where semantic equivalence cannot be proven deterministically.

For LTM specifically, `sourceStmIds`/`sourceLtmIds` are evidence for a real transformation, not an effect by themselves. The model must not return an existing LTM just because current STM is related to it. This prompt-level prevention exists primarily to avoid wasting completion tokens before validation: validators still reject exact normalized no-ops and repair guidance tells the model to remove them instead of inventing cosmetic differences. The dedicated 12000-token LTM ceiling remains a transport safety allowance, not permission to echo the archive, and no arbitrary LTM write-count cap is reintroduced.

STM semantic repartition obeys the same rule. If a replacement retains a source STM ID, that replacement must materially change that source record. When an old STM should remain exactly intact and new evidence belongs in a separate new topic, use normal STM creation instead of routing the unchanged source through repartition.

Relationship summaries in ordinary turns/reflection are also delta-only model upserts: an unchanged normalized relationship summary is omitted. Explicit semantic negative/null decisions remain valid; `action:null`, empty mutation arrays, deliberate no reaction, and LTM `safe_to_forget` are not redundant rewrites merely because they may not create a positive record mutation.

---

# 13. Belief effects during LTM consolidation

LTM consolidation must **not** count autobiographical material as fresh direct evidence a second time merely because that material is being reread, merged, promoted or compared. Existing STM, existing LTM, relationships and existing beliefs are context. Their presence, retrieval, relevance or consistency is not fresh belief evidence. **Consistency is not new evidence.**

The model must not iterate through supplied beliefs looking for beliefs compatible with supplied memories. Existing beliefs are not evidence for themselves, and old memories that already contributed to belief formation/reinforcement do not earn another confidence/activation update simply by being consolidated into LTM.

Instead, this stage supports **sparse higher-order induction/reappraisal**. `higherOrderBeliefEffects` is used only when the current consolidation creates a genuinely new cross-memory inference: combining multiple memories reveals a pattern or implication that is not contained in any constituent memory alone and is not merely a restatement of an existing belief. The field should usually be empty. There is no arbitrary hard count cap; the restriction is semantic rather than numeric.

Examples:

- several individually reinforced events jointly reveal a broader pattern not explicit in any one memory;
- multiple STM/LTM topics jointly imply a new durable interpretation;
- accumulated experience creates a genuinely new contextualization that was not already represented by the old belief/memories.

Therefore the LTM-stage belief protocol may:

- add a genuinely new higher-order belief;
- activate only beliefs whose salience materially shaped this specific consolidation/inference;
- report pattern-level support/contradiction only when a genuinely new cross-memory inference exists.

`activatedBeliefIds` is likewise sparse. Do not list beliefs merely because they were inspected, appeared in context or were compatible with a memory. An empty activation list is valid and often preferable.

For an **existing** belief, the accepted higher-order effect shape is exactly the same engine-owned evidence protocol used elsewhere:

```js
{ beliefId, effect: "supports" | "contradicts" | "ambiguous", strength }
```

The model must not return replacement `newConfidence`, `newActivation`, or equivalent direct numeric state for an existing belief. The engine owns confidence and activation math. Structural validation can verify shape/IDs/numbers, but cannot deterministically prove whether an inference is semantically novel; the fresh-evidence rule is therefore deliberately prompt/contract-first. See `ltm-fresh-evidence-belief-effects-contract.md`.

---

# 14. Belief reconciliation replaces contradiction scanner

The current contradiction/reconciliation mechanism is replaced by a broader **Belief Reconciliation** maintenance stage.

## 14.1 Purpose

Reconciliation answers:

> **Given what I now remember and believe, how do I live with interpretations that conflict, overlap, or have become outdated?**

This is not a database deduplication task.

Cognitive dissonance is allowed to persist.

## 14.2 Candidate selection

Prefer clusters containing beliefs that are:

- highly activated;
- recently changed;
- recently supported and contradicted;
- semantically contradictory;
- redundant or near-duplicate;
- potentially superseded;
- mutually contextualizable;
- strongly connected to recently consolidated STM/LTM.

Do not require scanning the full belief set on every maintenance cycle.

## 14.3 Evidence context

Reconciliation receives relevant STM/LTM supporting the candidate cluster.

It must not resolve contradictions solely by looking at belief text without remembered evidence.

## 14.4 Allowed outcomes

The model may propose:

- `revise` — rewrite a belief to fit accumulated evidence;
- `merge` — replace redundant beliefs with a richer combined belief;
- `weaken` — reduce confidence through a validated semantic contradiction result;
- `reinforce` — strengthen one interpretation where evidence clearly supports it;
- `contextualize` — preserve both ideas but clarify when each applies;
- `supersede` — replace an older interpretation with a newer one;
- `remove` — remove a belief that is obsolete/redundant and safely represented elsewhere;
- `leave_unresolved` — intentionally preserve cognitive dissonance.

Examples:

```text
"Price is creepy."
"Price seems genuinely kind to Nell."
```

Valid reconciliation:

```text
"I still find Price unsettling, but his warmth toward Nell seems genuine."
```

Also valid:

```text
leave both unresolved
```

Another example:

```text
"Dmytro is kind and respects me."
"Dmytro has terrifying power over my world."
```

A valid new interpretation could be:

```text
"Dmytro's power frightens me even though I trust him personally."
```

The system must never force one belief to disappear merely because two beliefs create tension.

---

# 15. Timelapse boundary

Timelapse is a major cognitive boundary.

## 15.1 Before timelapse

Before normal timelapse planning/maintenance begins:

- snapshot all current verbatim observations;
- run forced STM consolidation even if the buffer is below the normal threshold;
- tell the model explicitly that **the entire verbatim snapshot is the eviction set**;
- after validated commit, remove all pre-timelapse verbatim observations.

If forced consolidation fails:

- do not erase verbatim observations;
- do not pretend the boundary was successfully consolidated;
- timelapse policy may either continue while preserving the old buffer or stop maintenance cleanly according to higher-level timelapse error handling, but no memory loss is allowed.

Preferred behavior: preserve the old buffer and continue gameplay/timelapse with a diagnostic warning rather than destroying state.

## 15.2 During timelapse

Committed timelapse events generate new experienced observations normally.

Use a temporary/current timelapse observation stream if useful for implementation, but the semantics are identical: only actual committed/delivered experiences count.

Do not create fake verbatim observations from timelapse summaries.

## 15.3 After timelapse

Run timelapse mind maintenance:

1. STM/LTM consolidation as eligible;
2. higher-order belief reappraisal;
3. belief reconciliation;
4. activation decay.

After the timelapse completes, preserve up to the newest 20 timelapse verbatim observations.

Examples:

- character slept through the night with no meaningful delivered observations → verbatim may be empty;
- character performed three actions → those three may remain verbatim;
- character experienced 37 committed observations → newest 20 remain verbatim after maintenance, older material is preserved through STM.

---

# 16. Background auxiliary mind work

Normal STM consolidation may run asynchronously in a non-blocking auxiliary lane.

All mind consolidation/reconciliation model calls must route through the configured **auxiliary/utility model path** rather than the character's primary roleplay decision model. The implementation must not hard-code a particular provider model ID; it should use the existing configurable auxiliary-model selection (currently the same utility lane used for memory consolidation).

## 16.1 User-facing invariant

> **Auxiliary mind work must never produce or prolong the global gameplay `Thinking...` lock.**

Canonical character decisions have priority.

## 16.2 One job per character

Allow at most one active/queued background mind job per character.

Do not run concurrent STM consolidation jobs against the same mind.

## 16.3 Snapshot/prepare/commit architecture

Every auxiliary job follows:

```text
snapshot → async model computation → validate → stale check → atomic commit
```

The async computation must not mutate canonical world/mind state.

The snapshot records at least:

- source verbatim observation IDs;
- eviction observation IDs;
- mind revision/version;
- relevant STM/LTM IDs and versions if needed;
- belief revision/version if needed.

## 16.4 New observations during background work

New gameplay may append observations while consolidation is in flight.

That is allowed.

On successful commit:

- apply validated STM/belief changes if the stale check passes;
- remove **only the exact eviction observation IDs captured by the job**;
- never remove observations that arrived after the snapshot.

## 16.5 Stale results

If the mind changed incompatibly while the model was working, reject the stale result without partial commit.

For STM repartition, every source STM must still exist and the maintained STM source state must remain compatible with the preparation snapshot. A materially changed source record therefore invalidates the prepared repartition. New global memory-ID allocation by unrelated work is not itself stale: new replacement IDs are allocated only from the live candidate world at serialized commit.

The observations remain available and a later job may retry.

## 16.6 Canonical priority and preemption

Canonical work includes at least:

- `game-decision` requests;
- active reaction waves;
- required timelapse character decisions.

Canonical work always has priority over optional background mind work.

If a mind job is queued but not started, do not start it ahead of known canonical work.

If a background mind transport is already active and the request executor architecture supports safe abort/preemption, it may be aborted to free capacity for canonical work.

Abort/preemption must be safe because no canonical state has been mutated yet.

The job can be retried later from preserved observations.

A full general-purpose priority queue rewrite is not required if the same invariant can be achieved with separate lanes/purpose gating.

## 16.7 Save/load

In-flight auxiliary requests are transient runtime state.

They are not persisted and are not resurrected after reload.

The source observations/memory remain persisted, so the work simply becomes eligible again.

## 16.8 Persistent recovery snapshots

The transient source snapshot used for stale-safe computation is distinct from persisted developer recovery history. Persist **at most one full mind recovery snapshot per logical maintenance run**: ordinary background STM, forced pre-timelapse STM boundary, post-timelapse maintenance, or manual maintenance. A multi-stage post-timelapse run (`STM → LTM → reconciliation → activation decay`) shares one pre-run recovery snapshot rather than persisting near-identical copies before every stage. Persist lazily only before the first canonical psychological mutation; no-op runs need not add a snapshot. Retrieval-brief-only recovery never creates one. Granular rollback to an internal stage boundary is not a product requirement.

## 16.9 Retrieval-brief recovery

Brief backfill is an independent auxiliary metadata task, not autobiographical consolidation. It finds every STM/LTM whose `retrievalBrief` is empty, asks the Utility model only for `{id,retrievalBrief}` values, stale-checks each result against unchanged topic/summary, and writes only still-empty briefs. Failure is diagnostic-only and does not fail the surrounding maintenance opportunity.

---

# 17. Timelapse auxiliary work is different

Timelapse mind maintenance is a deliberate synchronization boundary.

Before entering timelapse maintenance:

- do not allow a stale ordinary background mind job to race with timelapse consolidation;
- cancel, wait for, or invalidate ordinary background mind work at a safe boundary;
- take a fresh snapshot for timelapse maintenance.

Timelapse may wait for its own required mind-maintenance stages because maintenance is part of completing the time skip.

However provider/model failure must still fail cleanly and preserve memory source data.

No failed timelapse mind job may leave the application in permanent busy state.

---

# 18. Migration from Mind v2 to v3

The migration goal is **identity preservation, not cleanup**.

In particular, existing developed characters such as Mara must not be reinterpreted from scratch.

## 18.1 Trigger

Migration occurs deterministically when loading a save or importing a portable mind whose `mind.schemaVersion` is older than v3.

No model request is required to load the save.

## 18.2 Migration invariant

> **Existing beliefs are carried forward as psychological state, not recomputed from memory. Existing memories are carried forward as remembered history, not reinterpreted as fresh evidence.**

## 18.3 Beliefs

For every existing belief:

- preserve stable `id`;
- preserve exact `text`;
- preserve existing `confidence` semantics/value, converting only if required by old enum representation;
- add `activation` using a neutral deterministic migration default;
- do not run reinforcement/contradiction during migration;
- do not ask a model whether the belief is still justified.

Recommended default:

```text
MIGRATED_BELIEF_ACTIVATION = 0.5
```

The exact value is configurable and is not intended to encode psychological history.

It simply prevents all migrated beliefs from starting either fully dormant or maximally active.

## 18.4 Old recent memories → initial STM

Existing `recentMemories` are not verbatim observations.

Do not pretend they are.

Convert them deterministically into initial STM records with minimal transformation.

Preferred conservative mapping:

```js
old recent memory
→ one legacy STM record
```

Preserve:

- original summary text exactly or near-exactly;
- original stable memory ID where compatible, or preserve it as migration/source metadata;
- importance;
- protected semantics if present.

Assign a deterministic temporary topic, for example derived from the old ID or a generic `Legacy recent memory <id>` label.

Do **not** call a model during load to regroup these records.

Future normal maintenance may gradually merge and retopic them.

This prioritizes preserving the character over immediately achieving aesthetic STM structure.

## 18.5 Old LTM

Existing `longTermMemories` migrate directly to v3 LTM.

Preserve:

- IDs;
- summaries;
- importance;
- protected flags;
- any compatible metadata.

No belief effects are generated by migration.

## 18.6 Relationships

Preserve existing relationships unchanged.

Mind v3 does not migrate relationships into beliefs.

## 18.7 Verbatim observations

Initialize:

```js
mind.verbatimObservations = []
```

The pre-v3 system did not preserve the required canonical verbatim experience stream, so it must not be fabricated from summaries.

New verbatim memory begins at the point the v3 system starts operating.

## 18.8 Pending observations

Preserve legitimate pending observations according to the normal save migration rules.

Do not reinterpret pending observations as already remembered verbatim experience.

## 18.9 Optional legacy backup

It is recommended to preserve an emergency migration backup of the pre-v3 mind during migration/export tooling.

The backup is diagnostic/recovery data only and is **not** included in model context.

It may include:

- old beliefs;
- old relationships;
- old recent memories;
- old long-term memories;
- old schema version.

The exact storage location should avoid bloating ordinary runtime prompts.

---

# 19. Portable mind v3

Portable mind export/import must include the durable psychological state needed to preserve character continuity:

- beliefs including confidence and activation;
- relationships;
- STM;
- LTM;
- any protected-memory metadata required by those layers.

Do not include:

- pending observations;
- scheduler queue;
- active auxiliary jobs;
- in-flight HTTP state;
- controller state;
- continuation;
- location/inventory/equipment/world physical state;
- provider diagnostics.

Decision for `verbatimObservations`:

For v3 portable mind, include them **only if the product goal remains “carry the exact current mind state forward.”** If strict portability should represent durable personality rather than current conversational working memory, exclude them.

For the initial v3 implementation, preferred behavior is:

```text
portable mind includes verbatimObservations
```

because the existing character-transfer feature is explicitly intended to preserve continuity across world resets. Their bounded size (normally ≤20 outside a brief over-threshold interval) is small.

When importing an older portable mind, apply the same deterministic v2→v3 migration rules.

---

# 20. Ordinary character-turn context

Mind storage may grow independently of ordinary decision-context size. Current configurable budgets remain tuning knobs rather than cognitive laws:

```text
verbatim newest 20
beliefs up to 16
STM up to 12
LTM up to 8
```

Current world/view, available formal actions, prepared pending observations, bounded recent dialogue, bounded recent verbatim, authored known facts and relationships remain ordinary grounded context. Beliefs/STM/LTM are selected through a cheap semantic preflight before the expensive `game-decision`.

The Utility-model preflight receives only compact runtime context (pending observations, recent dialogue/verbatim, current location/sublocation, present characters, notable visible items/objects, continuation/current intention) plus a compact mind catalog:

```text
STM/LTM: id + topic + retrievalBrief
Beliefs: id + text + confidence + activation
```

It does **not** receive full STM/LTM summaries or the formal action catalog. Its only output is:

```json
{ "beliefIds": [], "stmIds": [], "ltmIds": [] }
```

The selector may return fewer than the configured maxima. Semantic relevance is primary; activation/confidence are secondary signals. The engine then fetches the full canonical selected records for the Character-model decision.

Preflight is Phase-1 ordinary-turn retrieval only; timelapse planning/reflection continue using their current context paths. Semantic selection is a tolerant read-path: after JSON parsing, the engine removes unknown IDs, IDs returned in the wrong mind layer, duplicates and non-string values, then truncates each ordered selection to the configured budget. Any remaining valid semantic selection — including a valid empty selection — is used directly. This sanitation never mutates mind state and diagnostics record dropped/trimmed IDs. Deterministic fallback is reserved for genuine selector failure such as transport/timeout failure, malformed/unparseable JSON, or missing required selection arrays; selector parse/truncation failure does not trigger an extra model repair request. Occasional autobiographical retrieval misses are acceptable; canonical world truth is never supplied through this recall mechanism.

---

# 21. Memory and belief commit safety

Canonical model writes remain strict, but STM ingress may discard explicitly known engine-owned echo fields before validation. In particular, a model-returned `protected` field is ignored rather than treated as an instruction: canonical protection remains engine-owned, protected STM still cannot be rewritten, and unrelated unknown fields still fail the exact STM write schema. This prevents harmless context echo from causing an otherwise unnecessary full repair request without weakening protected-memory safety.

All model-produced mind mutations must use candidate-clone validation before commit.

No partial mutation is allowed.

For every mind operation:

1. snapshot source state;
2. run model request;
3. parse structured output;
4. validate IDs, record shapes, bounds, protected-memory invariants, and source freshness;
5. apply mutations to candidate clone;
6. validate complete candidate mind;
7. commit atomically;
8. only then remove source observations/memories that the operation consumed.

If any step fails, source data remains intact.

---

# 22. Protected memories

Existing protected-memory semantics remain.

A protected LTM or STM record may be updated only according to explicit existing protected rules and may not be silently deleted by consolidation/reconciliation.

Migration preserves protected flags.

Belief reconciliation must not indirectly destroy protected autobiographical memory in order to make beliefs more coherent.

---

# 23. Debug metadata and observability

The architecture should be understandable without inspecting raw model prompts.

For each belief, maintain optional engine-owned diagnostic history that is **not part of the character's consciousness** and is not normally sent to the model.

Recommended bounded entries:

```js
{
  atTurn,
  source,
  effect,
  deltaConfidence?,
  deltaActivation?,
  sourceIds?
}
```

Examples:

```text
STM consolidation: support strength 0.7, confidence 0.61 → 0.72
Relevant evidence: activation 0.25 → 0.58
Timelapse decay: activation 0.58 → 0.41
Reconciliation: belief revised from X to Y
```

Keep only a small recent diagnostic history per belief.

This metadata:

- must not influence roleplay unless explicitly surfaced through debug/admin UI;
- must not itself act as evidence;
- may be omitted from portable mind unless needed for diagnostics.

Add admin/debug UI visibility for at least:

- belief text;
- confidence;
- activation;
- recent diagnostic changes;
- STM topics;
- LTM topics;
- current verbatim count;
- current pending-observation count;
- current/queued auxiliary mind job state.

---

# 24. Configuration defaults

The following are defaults, not core semantics:

```text
VERBATIM_RETAIN_COUNT = 20
STM_TRIGGER_COUNT = 40        // consolidation eligible when count > 40
STM_SUMMARY_PREFERRED_MAX_CHARS = 2000
STM_SUMMARY_MAX_CHARS = 4000      // per-record boundary; semantic repartition handles over-broad STM
STM_WRITE_SET_LIMIT = 8           // normal writes + every repartition replacement record
LTM_SUMMARY_MAX_CHARS = 4000      // same per-record capacity as STM; LTM differs by subtractive semantics
MIGRATED_BELIEF_ACTIVATION = 0.5
NEW_BELIEF_ACTIVATION = implementation default, medium-high
BELIEF_CONFIDENCE_MIN = 0.001
BELIEF_CONFIDENCE_MAX = 0.999
```

Also expose configurable coefficients for:

- support log-odds gain;
- contradiction log-odds loss;
- ordinary activation bump;
- strong-evidence activation bump;
- activation decay per maintenance unit;
- maximum STM/LTM counts if bounded limits remain.

Do not scatter magic numbers across prompt or engine files.

Centralize mind-v3 tuning constants.

---

# 25. Failure semantics

## 25.1 Background STM failure

If background STM consolidation fails due to:

- timeout;
- provider error;
- rate limit;
- invalid output;
- stale source state;

then:

- gameplay remains interactive;
- no verbatim observations are deleted;
- no STM/belief mutation commits;
- job state clears normally;
- the character becomes eligible for later retry.

## 25.2 Timelapse maintenance failure

If timelapse mind maintenance fails:

- preserve all uncommitted source memory;
- end any busy state cleanly;
- surface a diagnostic/non-fatal maintenance failure where appropriate;
- never corrupt the character or silently drop memory.

## 25.3 Save during auxiliary work

Saving while background mind work is in flight stores committed mind/world state only.

The in-flight job is not canonical and is not serialized as active work.

On reload, source state is restored and normal eligibility logic may schedule a fresh job.

---

# 26. Suggested module boundaries

Exact filenames may follow the codebase's current split, but Mind v3 should avoid rebuilding one giant `character-memory.js` monolith.

Recommended responsibilities:

```text
mind-schema / validators
    record shapes, schemaVersion, migration validation

verbatim-memory
    append experienced records, retention helpers, source IDs

stm-consolidation
    snapshot construction, prompt protocol, candidate commit

ltm-consolidation
    timelapse durable-memory packing

belief-model
    confidence math, activation math, belief CRUD helpers

belief-reconciliation
    candidate selection, reconciliation protocol, commit

mind-aux-executor
    per-character background job lifecycle, stale checks, preemption

mind-migration
    deterministic v2→v3 save and portable-mind migration

mind-context
    context selection/ranking for normal turns and auxiliary prompts
```

The exact public API should minimize circular dependencies.

---

# 27. Required invariants

The implementation is accepted only if all of the following hold.

## Memory invariants

1. Pending observations and verbatim observations are different layers.
2. Verbatim contains only committed experienced information.
3. Ordinary consolidation sends the full current verbatim snapshot.
4. Ordinary consolidation retains the newest 20 and evicts everything older only after successful commit.
5. The prompt explicitly identifies which observations will be evicted.
6. STM is thematic and upsert-oriented.
7. LTM is thematic and intentionally more lossy than STM.
8. Failed consolidation never deletes source memory.
9. Timelapse pre-boundary consolidation treats all current verbatim observations as eviction candidates.
10. Timelapse never fabricates verbatim observations from summaries.

## Belief invariants

11. Beliefs represent interpretations, not event history.
12. Every model use of beliefs receives the shared semantics block.
13. Beliefs have both confidence and activation.
14. Existing belief confidence is updated through engine-owned math, not arbitrary model replacement.
15. Direct reinforcement uses newly consumed evidence, not overlapping retained observations twice.
16. Activation can rise when a belief becomes relevant even if confidence falls.
17. Activation decays during timelapse maintenance.
18. Confidence does not automatically decay merely because time passes.
19. Beliefs may remain wrong or contradictory.
20. Reconciliation may intentionally leave dissonance unresolved.

## Async invariants

21. Background auxiliary mind work never blocks normal gameplay UI.
22. Canonical AI decisions always have priority over auxiliary mind work.
23. Auxiliary computation cannot mutate canonical state before validated commit.
24. New observations arriving during a job are never removed by that older job.
25. Stale auxiliary results do not commit.
26. In-flight auxiliary work is not resurrected from saves.

## Migration invariants

27. v2 beliefs are preserved, not re-induced.
28. v2 recent memories are preserved as initial STM, not fabricated into verbatim observations.
29. v2 LTM is preserved.
30. relationships are preserved unchanged.
31. v3 verbatim begins empty for migrated saves unless a genuine v3 verbatim stream already exists.
32. migration requires no model call.
33. loading an old save must not meaningfully change the character's established personality solely because the schema changed.

---

# 28. Regression and acceptance tests

Add tests covering at least the following.

## Verbatim capture

1. Delivered external observation is appended to verbatim after experience.
2. Character's own committed spoken action is represented in verbatim.
3. Failed/rejected intention is not added.
4. Hidden event is not leaked into verbatim.
5. Scheduler metadata is absent from persisted verbatim records.

## Normal STM consolidation

6. 40 observations do not consolidate if trigger is strictly `>40`.
7. 41 observations schedule consolidation.
8. Snapshot includes all 41.
9. Eviction set contains first 21; retained contains newest 20.
10. 57 observations snapshot all 57 and evict first 37.
11. Model receives explicit eviction information.
12. Successful commit removes exactly eviction IDs.
13. New observations arriving during in-flight job remain after commit.
14. Invalid model output removes nothing.
15. Timeout removes nothing.
16. Stale result removes nothing.
17. Matching STM topic is upserted rather than duplicated.

## Belief reinforcement

18. Supporting evidence raises confidence through engine math.
19. Contradicting evidence lowers confidence.
20. Ambiguous evidence does not directly change confidence.
21. Strength affects magnitude.
22. Confidence remains strictly below 1 and above 0.
23. Repeated support has saturating effect.
24. Retained overlap is not counted as direct evidence again on the next consolidation.
25. Relevant contradiction may lower confidence while raising activation.
26. New belief can be added with bounded initial confidence.
27. Existing model output cannot directly overwrite confidence outside the defined protocol.

## Activation

28. Relevant evidence raises activation.
29. Explicitly activated belief receives saturating bump.
30. High activation rises less than low activation for equal strength.
31. Timelapse maintenance decays activation.
32. Decay does not delete corresponding memory.
33. Decay does not automatically reduce confidence.

## LTM

34. STM material can upsert existing LTM.
35. LTM consolidation can create a new durable topic.
36. LTM stage does not blindly re-count old STM as direct reinforcement.
37. Higher-order belief induction from multiple STM topics is allowed.
38. Protected LTM cannot be silently removed.

## Reconciliation

39. Contradictory beliefs can be revised.
40. Redundant beliefs can be merged.
41. One belief may supersede another.
42. Two beliefs may be contextualized into a richer interpretation.
43. Reconciliation may return `leave_unresolved` and preserve both beliefs.
44. Reconciliation receives relevant memory evidence.
45. It cannot delete protected autobiographical memory.

## Timelapse

46. Pre-timelapse verbatim count <40 still triggers forced STM consolidation.
47. Whole pre-timelapse snapshot is marked eviction set.
48. Successful boundary clears all pre-timelapse verbatim.
49. Failed boundary consolidation preserves all pre-timelapse verbatim.
50. Timelapse committed events create new experience records.
51. Fake summary text is not inserted as verbatim.
52. After timelapse, newest up to 20 timelapse observations remain verbatim.
53. Character who experienced nothing may end with empty verbatim.
54. Activation decay occurs during timelapse maintenance.

## Background auxiliary work

55. Background STM job does not set global blocking `Thinking...`.
56. Only one mind job per character runs at once.
57. Canonical game-decision can run ahead of queued auxiliary work.
58. Safe preemption/abort leaves source observations intact.
59. Saving during in-flight auxiliary work serializes no active-job resurrection state.
60. Reload makes work eligible again from preserved source state.
61. Provider `429` in auxiliary job leaves gameplay interactive and source memory intact.
62. Auxiliary timeout leaves gameplay interactive and source memory intact.

## Migration

63. v2 save loads without model calls.
64. Every old belief ID/text/confidence survives migration.
65. Every migrated belief receives valid activation.
66. Old recent memories survive as initial STM content.
67. Old recent memories are not placed into verbatim.
68. Old LTM IDs/content/protected flags survive.
69. Relationships survive unchanged.
70. Pending observations survive according to existing save semantics.
71. Migrated verbatim starts empty.
72. Re-saving migrated state uses v3 schema.
73. Reloading the v3 save is idempotent and does not remigrate.
74. Portable mind v2 imports through the same semantic migration.
75. Portable mind v3 round-trip preserves beliefs/activation/STM/LTM/relationships and bounded verbatim according to export policy.

## Character continuity regression

76. Use a developed fixture representative of Mara's current mind.
77. Migrate it v2→v3.
78. Assert all original belief IDs/text/confidences remain represented exactly.
79. Assert relationship summary remains unchanged.
80. Assert all old recent-memory content remains present in migrated STM.
81. Assert all old long-term-memory content remains present in LTM.
82. Assert migration performs no belief induction/reconciliation.
83. Assert no source memory is lost merely because the new structure has different topic semantics.

---

# 29. Rollout plan

Implement in phases so failure can be isolated.

## Phase A — schema and deterministic migration

- add `mind.schemaVersion = 3`;
- add verbatim observations;
- add STM structure;
- add belief activation;
- add shared validators;
- implement v2→v3 save and portable-mind migration;
- add continuity regression fixture;
- do not yet enable background consolidation.

## Phase B — verbatim capture and STM consolidation

- append committed experiences;
- implement full-buffer snapshot/eviction rules;
- implement STM upsert protocol;
- implement direct belief evidence protocol;
- implement confidence and activation math;
- initially permit synchronous/manual invocation for debugging.

## Phase C — background auxiliary lane

- add one-job-per-character scheduler;
- snapshot/stale/atomic commit;
- canonical priority/preemption;
- non-blocking UI behavior;
- liveness/rate-limit integration.

## Phase D — timelapse integration

- forced pre-boundary STM consolidation;
- timelapse observation handling;
- STM→LTM consolidation;
- higher-order belief induction;
- activation decay.

## Phase E — belief reconciliation

- replace old contradiction scanner;
- implement candidate selection;
- revise/merge/contextualize/supersede/leave-unresolved protocol;
- add debug visibility.

## Phase F — tuning only after structural validation

Observe real characters over substantial play.

Tune only after inspecting:

- STM duplication rate;
- information loss;
- LTM growth;
- belief confidence trajectories;
- activation trajectories;
- frequency of self-reinforcing loops;
- reconciliation quality;
- auxiliary provider cost/latency;
- character continuity across save/reset.

Do not compensate for structural defects by tuning coefficients.

---

# 30. Final design principles

Mind v3 should follow these principles:

1. **Experience first.** The character's recent experienced history exists independently of interpretation.
2. **Memory preserves history.** STM and LTM answer what happened, at different compression levels.
3. **Beliefs induce meaning.** They are conclusions drawn from remembered experience.
4. **Interpretation is recursive but not magical.** Beliefs bias later interpretation, but belief existence is not evidence by itself.
5. **Salience is not certainty.** Activation and confidence are independent.
6. **Forgetting is mostly structural compression and declining salience, not arbitrary deletion of history.**
7. **Cognitive dissonance is allowed.** Reconciliation is reflective interpretation, not compulsory consistency repair.
8. **Model semantics, engine mathematics.** The model decides meaning and evidence direction; the engine owns bounds, formulas, IDs, validation, and atomic state changes.
9. **Background cognition is disposable; source memory is not.** Auxiliary work may fail or be aborted without losing experience.
10. **Migration preserves the person before beautifying the data.** Existing developed minds must survive the architecture change with minimal reinterpretation.
11. **Structure over tuning.** The system should behave sensibly because its information flow is correct, not because dozens of thresholds were hand-tuned around pathological feedback loops.


## LTM semantic preflight and fresh reflection activation

Historical LTM is treated as a searchable archive during STM→LTM consolidation. A read-only high-recall preflight sees all source STM in full and all historical LTM only through compact retrieval metadata (`id`, `topic`, `retrievalBrief`, `importance`, minimal protection metadata), while retaining the complete belief/relationship significance context. It returns only existing `relevantLtmIds` and has no arbitrary selection count cap. The main subtractive consolidation then sees all source STM in full again and only the selected historical LTM bodies in full. Unselected existing LTM cannot be upserted or cited as historical provenance in that proposal; new LTM creation is unaffected.

The preflight is snapshot-bound. Failure or material staleness before the main consolidation request preserves canonical mind state and leaves source STM available for a future pass.

Timelapse reflection follows the same fresh-evidence philosophy for activation: belief-table visibility or compatibility is not fresh salience. `activatedBeliefIds` is a sparse event-driven channel for beliefs actually brought into focus by newly completed timelapse events; empty is valid. Deterministic array/ID validation remains defense in depth.
