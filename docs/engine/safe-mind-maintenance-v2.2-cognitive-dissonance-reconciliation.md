# Safe Mind Maintenance v2.2 — Cognitive Dissonance Reconciliation + Formal Action Precedence

## 1. Scope

This is an incremental extension of Safe Mind Maintenance v2/v2.1.

It preserves:

- bounded recent-memory consolidation;
- `maintenanceArchive` preservation;
- protected-memory immutability;
- one all-or-nothing maintenance transaction;
- five successful pre-maintenance snapshots;
- tiny optional long-term merges;
- v2.1 exact response schemas and read-only recent correction context;
- shared manual/overnight `MemoryConsolidator.compress()`;
- portable mind v2;
- split-file Emergency Dump.

v2.2 supersedes the former broad/general consistency-repair phase. It also establishes Formal Action Precedence as a general grounding invariant for ordinary AI turns.

## 2. Epistemic principle

Beliefs and memories are both fallible representations.

- a belief is what the character currently thinks or infers;
- a memory is what the character remembers experiencing.

Neither record type automatically overrides the other. A contradiction is resolved from the available evidence, not by record type, raw confidence, or recency alone.

The target is the **most justified internal state, not necessarily one definitive fact**.

Valid outcomes include:

- revise the belief;
- revise the long-term memory;
- revise both;
- keep the conflict unresolved.

A revised belief may explicitly represent uncertainty, suspected deception, or unreliable recollection. If evidence is insufficient, leaving the conflict in place is safer than inventing certainty.

## 3. Per-character reconciliation cursor

Each character has world-local operational maintenance state:

```json
{
  "mindMaintenanceState": {
    "reconciliationCursor": {
      "afterBeliefId": null
    }
  }
}
```

The cursor:

- belongs to one character only;
- survives save/load and compatible migration;
- appears in Emergency Dump;
- is excluded from ordinary AI context;
- is excluded from portable mind transfer;
- is not part of the character's autobiographical `mind`.

The anchor is a stable belief ID rather than a raw array index. Active beliefs are deterministically ordered by ID. If the anchor still exists, scanning resumes after it. If it was removed, scanning resumes from the first deterministic ID after the stored anchor, wrapping to the beginning when necessary.

## 4. Discovery batch

Each successful maintenance run examines at most:

```text
RECONCILIATION_BELIEF_BATCH_SIZE = 5
```

The engine chooses the next five beliefs using the per-character cursor. The model does not choose which beliefs are interesting.

Discovery runs whenever the candidate mind has at least one active belief and one active long-term memory. The old high belief-count threshold is not required for this bounded scan. Existing automatic daytime/tick candidate thresholds may still control when automatic maintenance is invoked; manual and overnight maintenance run the canonical pipeline directly.

## 5. Read-only contradiction discovery

Discovery receives:

- the next up-to-five actionable current beliefs;
- all active long-term memories as read-only comparison material;
- current authored/grounded known facts as read-only context.

The discovery stage has **no modification authority**.

Exact response shape:

```json
{
  "conflicts": [
    {
      "beliefId": "existing_batch_belief_id",
      "longTermMemoryId": "existing_active_memory_id",
      "strength": "direct"
    }
  ]
}
```

At most 8 candidates may be returned.

Allowed strengths:

- `direct` — both claims cannot reasonably be true in the same interpretation;
- `strong` — substantially incompatible, but additional context may reconcile them;
- `possible` — tension or inconsistency worth noticing, but not necessarily an error.

Differences in tone, incomplete perspective, or emotion are not automatically contradictions.

## 6. Deterministic conflict selection

The engine sorts validated candidates by:

```text
direct > strong > possible
```

with stable belief ID / long-term memory ID ordering as the tie-breaker.

Only the two strongest candidates are investigated further:

```text
MAX_CONFLICTS_RESOLVED_PER_MAINTENANCE = 2
```

`contradictionStrength` is ephemeral diagnostic data. It is not stored in the character mind.

## 7. Independent bounded resolution

Each selected conflict is resolved in a separate model call.

The resolver receives:

- the selected belief;
- the selected long-term memory;
- current active recent memories;
- current active long-term memories;
- current active beliefs;
- authored/grounded known facts;
- relationships only as read-only social context.

Only the selected belief and selected long-term memory are writable. All other records are evidence only.

The resolver is asked for the best justified internal state, not "which one is objectively true".

Evidence guidance is conservative:

1. authored/grounded information actually available to the character;
2. explicit later corrections;
3. direct remembered observations;
4. mutually supporting records;
5. current interpretation/inference;
6. unsupported inference.

Recency, confidence, or record type alone do not establish truth.

## 8. Resolution contract

The implementation uses one exact three-key response shape:

```json
{
  "resolution": "keep_conflict",
  "beliefReplacement": null,
  "memoryReplacement": null
}
```

`resolution` must be exactly one of:

```text
revise_belief
revise_memory
revise_both
keep_conflict
```

Rules:

- `keep_conflict`: both replacements are `null`;
- `revise_belief`: `beliefReplacement` is exactly `{text, confidence}`;
- `revise_memory`: `memoryReplacement` is exactly `{summary, importance}`;
- `revise_both`: both replacement objects are supplied.

The model never supplies new IDs or `protected` fields. Existing IDs are retained by the engine.

## 9. Resolution semantics

### revise_belief

Use when evidence strongly supports changing current understanding. The old exact belief is archived; the replacement retains the same belief ID.

### revise_memory

Use when the active long-term summary is materially inaccurate. The old exact memory is archived; the replacement retains the same memory ID.

Where meaningful, correction should preserve the autobiographical fact that the character once misremembered something rather than silently erasing that history.

### revise_both

Both records may change when that best represents the evidence. This may produce explicit uncertainty rather than one winner.

Example:

```text
memory: "I remember Garrick saying X, but Price later claimed the opposite."
belief: "Their accounts conflict; one of them may be lying, but I do not know which."
```

### keep_conflict

Use when evidence is insufficient, the apparent conflict can coexist, or resolution would require unsupported invention. This is a normal successful outcome.

## 10. Protected memories

Protected long-term memories may participate in discovery and may serve as read-only evidence.

They remain immutable. If a selected pair contains a protected memory, the resolver may revise the belief or keep the conflict, but cannot revise/archive/replace the protected memory.

## 11. No-op revision detection

Engine-side semantic-payload equality suppresses pointless rewrites.

Belief equality compares at least:

- `text`;
- `confidence`.

Memory equality compares at least:

- `summary`;
- `importance`.

An identical proposed revision:

- does not archive the existing record;
- does not count as a mind change;
- does not create a pre-maintenance snapshot solely because of that revision.

Cursor progress may still commit independently.

## 12. Cursor progress and snapshots

After a successful discovery/resolution slice, the cursor advances past the examined belief batch even when:

- no conflicts were found;
- selected conflicts resolved to `keep_conflict`;
- proposed revisions were no-ops.

If the maintenance transaction fails, the cursor does not advance.

Cursor-only progress is operational state and does not create a personality/mind snapshot.

Any actual persistent mind change still creates exactly one full pre-run mind snapshot immediately before the final atomic commit. FIFO remains five.

## 13. Transaction ordering

Canonical maintenance order is:

```text
capture source state
→ bounded recent consolidation
→ cognitive-dissonance discovery/resolution
→ tiny LT merge if eligible
→ validate candidate
→ atomic commit
```

Reconciliation sees the current candidate state, including durable memories produced by recent consolidation in the same run.

If any stage fails, all candidate work is discarded. No mind/archive/cursor/snapshot partial commit is allowed.

## 14. Long-term merge interaction

Long-term merge remains a separate bounded deduplication phase.

Contradictory records must not be treated as merge candidates merely because they concern the same event. Reconciliation runs first so the conflict can be understood before optional merging.

## 15. Tea regression

The canonical generic regression shape is based on the observed Mara case:

```text
current belief:
"I mistakenly thought Dmytro made me tea, but actually I made it."

stale LT:
"He is the first lover who made me tea first."

newer evidence:
"Dmytro corrected me: it was actually me who made the tea, not him."
```

Discovery should classify the belief/LT pair as `direct`.

Resolution has enough evidence to choose `revise_memory` while leaving the already-correct belief intact. The old LT is archived verbatim and the corrected active LT retains its stable ID.

No runtime code may special-case Mara, Dmytro, or tea.

## 16. Save/migration/portable rules

Older worlds without `mindMaintenanceState` initialize:

```json
{
  "reconciliationCursor": {
    "afterBeliefId": null
  }
}
```

Compatible saved cursor state survives migration.

Portable character-mind export/import remains personality-only and does not carry the world-local reconciliation cursor. Imported characters begin reconciliation from the start of their current active belief set.

## 17. Diagnostics

Emergency Dump includes per-character `mindMaintenanceState` in `minds.json` and existing AI exchange traces show:

- discovery request/response;
- selected candidate pairs through resolver request context;
- individual resolution responses;
- validation/repair failures;
- model/provider metadata.

No user-facing maintenance audit UI is added.

---

# Formal Action Precedence

## 18. Architecture invariant

The simulation layer has precedence wherever it provides a grounded action.

> If `context.view.available_actions` contains a formal action capable of representing the intended tracked world-state change, the AI must use that formal action. Narrative may supplement the action but must not substitute for it or claim completion of additional grounded state changes.

Examples:

```text
remove equipped cloak → unequip exists → use unequip
remove equipped clothing → unequip exists → use unequip
take tracked item → take action exists → use formal take
canonical movement → move exists → use formal move
```

`action: null` plus narrative completion is not an acceptable substitute when the required current grounded action is offered.

## 19. Unsupported action classes remain narratively free

If the engine provides **no formal mechanic for an action class at all**, the fictional layer may describe that action narratively.

Observed example:

```text
lie on Mara's work table
```

There is currently no formal posture/position action for lying on that table. Narrative execution is therefore allowed. This patch does not add a table-lying mechanic.

## 20. Unavailable is not unsupported

If the engine models an action class but the relevant formal action is currently unavailable because constraints are unmet, narrative cannot bypass those constraints.

For example, if tracked item-taking exists but an item cannot currently be reached, narration may not establish that the character took it anyway.

The ordinary prompt explicitly names tracked classes such as movement, item transfer, equip/unequip, money transfer, and formal ability results.

## 21. Multi-step grounded goals

A multi-step goal proceeds one formal action at a time through ordinary continuation/reaction flow.

Example:

```text
goal: undress

1. unequip cloak
2. continuation retains unfinished purpose
3. later reaction: unequip clothing
4. after grounded undressing, unsupported incidental behavior may be narrated freely
```

A response performing `unequip cloak` may not narratively claim that the still-equipped clothing was also removed.

## 22. Validation boundary

This patch does **not** attempt arbitrary natural-language semantic validation of `publicNarrative`.

Formal action validation remains deterministic. Formal Action Precedence is enforced through the canonical decision protocol, explicit action-grounding instructions, continuation semantics, and regression coverage. If prompting still proves insufficient, stronger narrative/formal consistency validation can be designed separately.

## 23. Grounding regression

Use the observed generic fixture:

- two items are equipped;
- both corresponding `unequip` actions are present in `view.available_actions`;
- the player asks the character to undress.

Bad behavior:

```text
action: null
publicNarrative: removes both equipped items
```

Expected protocol behavior:

- select one current `unequip` action;
- do not claim the second grounded unequip is complete;
- retain unfinished intent through continuation when appropriate;
- perform the second grounded step on a later reaction;
- remain free to narrate an unsupported action class once no formal mechanic exists for it.

No character-specific runtime rule is permitted.

## 24. Acceptance criteria

The patch is complete when:

1. reconciliation cursor is independent per character and survives save/load/migration;
2. at most five beliefs are deterministically examined per maintenance run;
3. active long-term memories are compared read-only against that batch;
4. contradiction candidates are ranked `direct > strong > possible`;
5. at most the two strongest conflicts are resolved per run;
6. each resolution call can modify only its selected pair;
7. beliefs do not automatically override memories and memories do not automatically override beliefs;
8. uncertainty and `keep_conflict` are first-class outcomes;
9. protected memories remain immutable;
10. identical proposed revisions are true no-ops;
11. failed maintenance advances neither mind nor cursor;
12. successful cursor-only progress creates no personality snapshot;
13. replaced source records are archived verbatim;
14. the tea contradiction is discoverable and safely correctable from supplied evidence;
15. ordinary AI prompts establish Formal Action Precedence;
16. multi-step tracked goals use sequential grounded actions rather than narrative substitution;
17. unsupported action classes remain narratively expressible;
18. supported-but-unavailable mechanics cannot be bypassed through narrative;
19. manual and overnight maintenance still use the same canonical `MemoryConsolidator.compress()` transaction.
