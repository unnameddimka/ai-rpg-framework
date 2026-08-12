# Character Memory Consolidation Specification

## Purpose

Add a character-memory consolidation mechanism that converts older individual `recentMemories` into a smaller set of durable, thematic `longTermMemories`.

The goal is not only to reduce prompt size. Long-term memory should represent how a character remembers their life: important episodes, relationships, discoveries, conflicts, changes in understanding, and other durable autobiographical material rather than a chronological transcript of every event.

The first implementation must support both manual and automatic consolidation. Automatic consolidation must exist but be disabled by default so existing playthroughs continue to behave exactly as they do now until the user explicitly enables it.

---

## Manual Memory Compression

The existing character selector in the left sidebar is also used to select the character whose memory will be compressed.

Add a `Compress memory` button near the existing character-control controls.

Pressing `Compress memory` applies only to the character currently selected in that selector.

Memory compression must not change controller assignment. It must work for a character regardless of whether that character is currently controlled by HumanController, AIController, or DummyController.

This is intentionally available for every character so individual characters can be tested separately during an existing playthrough.

If the selected character has 10 or fewer `recentMemories`, no model request is made and the UI reports:

`Nothing to compress.`

---

## Which Memories Are Consolidated

For a character with more than 10 recent memories, preserve the newest 10 `recentMemories` exactly as they currently exist.

Everything older than those newest 10 entries becomes the consolidation input.

Example:

- the character has 34 recent memories;
- memories 1 through 24 are selected for consolidation;
- memories 25 through 34 are retained unchanged;
- after a successful consolidation, memories 1 through 24 are removed from `recentMemories`;
- the newest 10 remain with their original IDs and contents.

The retained newest 10 memories are not rewritten, summarized, re-IDed, or otherwise modified by consolidation.

---

## Long-Term Memory Semantics

Long-term memory is thematic, not a record of compression runs.

A consolidation of many old memories should produce a small number of durable autobiographical memories covering meaningful topics or episodes.

For example, old memories about repeated conversations with Traveler might become long-term memories about:

- what the character learned about Traveler and the nature of the world;
- how the character's relationship with Traveler developed;
- a particular major episode such as the cottage.

When later consolidation input contains new experiences that naturally belong to an existing long-term memory, the model should update that existing memory by ID instead of creating a near-duplicate entry.

A new long-term memory should be created only when the new material represents a genuinely distinct durable topic, episode, relationship development, discovery, conflict, or other significant part of the character's life.

The first implementation allows the model to:

- update an existing long-term memory by ID;
- add a new long-term memory.

The first implementation does not allow the model to delete an existing long-term memory.

New long-term-memory IDs are assigned by the framework, never by the model.

Long-term memories must remain subjective autobiographical memories of that character. The consolidator must preserve uncertainty, misunderstanding, conflicting recollections, and the character's own interpretation when those are present in the source material. It must not silently replace the character's remembered experience with objective world truth.

---

## AI Operation

Memory consolidation uses the configured Character model.

It does not use the presentation narrator model.

It is a separate AI operation belonging to the character AI/memory system, for example:

- `purpose: "memory-consolidation"`
- `stage: "memory-consolidation"`

It is not a normal AI reaction.

Conceptually:

```text
manual UI or automatic scheduler
        ↓
AIController / character-memory operation
        ↓
MemoryConsolidator / AIMemory
        ↓
AIRequestExecutor
        ↓
configured Character model
```

The implementation should reuse the existing model-selection, OpenRouter request, tracing, validation, exchange-log, and busy-request infrastructure where practical rather than introduce a second independent model client.

---

## Consolidation Request Context

The consolidation request receives only the information needed to interpret the character's older memories.

The request context must include:

- character ID and current character identity;
- current `aiDescription`;
- current `knownFacts`;
- current `beliefs`;
- current `relationships`;
- current existing `longTermMemories`;
- `memoriesToConsolidate`, containing every `recentMemory` older than the newest 10.

The newest 10 retained recent memories are not consolidation material and should not be included as memories to rewrite.

`knownFacts`, `beliefs`, and `relationships` are supplied only as interpretive context. They are not writable outputs of this operation.

The request does not need the normal operational `view.available_actions`, pending observations, or normal turn-response schema because consolidation cannot act in the world.

---

## Model Prompt Semantics

The consolidation request must explicitly tell the model that it is reorganizing the selected character's autobiographical memory, not taking a game turn.

The prompt must require the model to follow these rules:

1. Use only the supplied character context and memories.
2. Do not invent events, conversations, motives, relationships, facts, or outcomes that are not supported by the supplied material.
3. Preserve the character's subjective perspective. If the character was mistaken, uncertain, suspicious, confused, or internally inconsistent, do not silently correct that from an omniscient perspective.
4. Preserve important nuance that may affect future behavior, relationships, decisions, fears, goals, or understanding of the world.
5. Discard routine or low-value detail when it has no durable autobiographical significance.
6. Prefer updating an existing long-term memory when new material extends the same topic.
7. Add a new long-term memory only for genuinely distinct durable material.
8. Do not create one new long-term memory merely because a consolidation operation occurred.
9. Do not delete existing long-term memories.
10. Do not modify known facts, beliefs, relationships, continuation, controller state, or world state.
11. Do not mention memory compression, summarization, prompts, models, or the framework inside the character's memories.
12. Return only the required JSON object and no prose outside it.

A suitable system instruction is:

```text
You are consolidating one character's autobiographical memory.

You are not taking a game turn and you cannot act in the world.

Use only the supplied character context, existing long-term memories, and recent memories selected for consolidation.

Produce durable long-term memories that preserve what this character would meaningfully remember about important episodes, relationships, discoveries, conflicts, changes in understanding, and other experiences likely to matter later.

Long-term memory is thematic rather than chronological. When new material belongs to an existing long-term topic, update that existing memory by its supplied ID instead of creating a duplicate. Add a new long-term memory only when the material represents a genuinely distinct durable topic or episode.

Preserve the character's subjective perspective, including uncertainty, mistakes, suspicions, conflicting interpretations, and unresolved contradictions. Do not replace remembered experience with objective world truth unless the supplied memories themselves show that the character learned the correction.

Do not invent events or conclusions. Do not preserve routine detail merely because it occurred. Preserve important nuance that could affect future behavior, relationships, decisions, or understanding.

You may update existing long-term memories or propose new ones. You may not delete an existing long-term memory.

Do not modify known facts, beliefs, relationships, continuation, controller state, world state, recent memories, or any other state.

Do not mention memory consolidation, summarization, prompts, AI models, or the framework as an experience of the character.

Return exactly one JSON object with the keys longTermMemoriesToUpsert and longTermMemoriesToAdd, and nothing else.
```

The user message should contain a structured JSON context rather than prose assembled from the UI.

Conceptually:

```json
{
  "character": {
    "id": "hoodedWoman",
    "aiDescription": "..."
  },
  "mindContext": {
    "knownFacts": [],
    "beliefs": [],
    "relationships": []
  },
  "existingLongTermMemories": [],
  "memoriesToConsolidate": []
}
```

---

## Model Response Contract

The model must return exactly:

```json
{
  "longTermMemoriesToUpsert": [
    {
      "id": "existing_long_term_memory_id",
      "summary": "Updated durable autobiographical memory.",
      "importance": 0.8
    }
  ],
  "longTermMemoriesToAdd": [
    {
      "summary": "A new durable autobiographical memory.",
      "importance": 0.7
    }
  ]
}
```

Both arrays must always be present, even when empty.

### Upsert validation

For every `longTermMemoriesToUpsert` entry:

- `id` must exactly match an existing long-term-memory ID supplied in the request;
- the same ID may not appear more than once;
- `summary` must be a non-empty string;
- `importance` must be a finite number from 0 through 1.

Unknown IDs are invalid. The model may not use an upsert to create a new ID.

### Add validation

For every `longTermMemoriesToAdd` entry:

- there is no model-supplied ID;
- `summary` must be a non-empty string;
- `importance` must be a finite number from 0 through 1.

The framework assigns each accepted new memory a unique persistent memory ID using the normal memory-ID mechanism.

### Framework-owned fields

If long-term-memory records contain framework-owned metadata beyond `id`, `summary`, and `importance`, an upsert must preserve that metadata unless the implementation specification for that metadata explicitly says otherwise.

The model is not allowed to overwrite framework-owned fields by returning additional properties.

The response validator should reject extra fields.

---

## Commit Semantics and Atomicity

Memory consolidation is transactional.

Before starting the model request, capture the exact consolidation input state required to verify a safe commit:

- selected character ID;
- IDs and contents of the `recentMemories` selected for consolidation;
- IDs and contents of the newest 10 retained recent memories;
- existing long-term memories used by the request.

Do not modify the character's mind before the request succeeds.

After a valid model response, verify that the character's relevant memory state has not changed since the consolidation request was created. If it has changed unexpectedly, abort the commit and leave the current state untouched rather than applying the result to different memories.

On a successful commit, perform both changes atomically:

1. apply validated long-term-memory upserts and add newly assigned long-term memories;
2. remove exactly the recent-memory prefix that was consolidated, leaving the original newest 10 recent memories unchanged.

If the model request fails, parsing fails, validation fails, the source memory state changed, or the resulting memory state is invalid, the entire consolidation operation fails and no memory is removed or rewritten.

---

## No In-World Awareness of Consolidation

Memory consolidation is maintenance of the character's stored mind state, not an in-world event.

It must not:

- consume a world tick;
- count as an AI reaction;
- create a world event;
- create an observation;
- create a new memory describing the compression operation;
- produce `spokenText`;
- produce `publicNarrative`;
- execute a formal action;
- change position, inventory, money, controller assignment, or any world state;
- modify `continuation`.

A character becomes aware only of the resulting remembered content in the ordinary sense that future AI reactions receive the newly consolidated memory.

The character must never be told that their memory was "compressed."

---

## Fields That Consolidation May and May Not Change

The only persistent character-mind changes made by a successful consolidation are:

- updates to existing `longTermMemories`;
- additions to `longTermMemories`;
- removal of the successfully consolidated old prefix from `recentMemories`.

The operation must not modify:

- `knownFacts`;
- `beliefs`;
- `relationships`;
- `continuation`;
- `pendingObservations`;
- controller assignment;
- any world entity or inventory;
- any other character.

Manual compression of Mara must leave Price, Nell, Garrick, and every other character unchanged.

---

## Persistence and Save Behaviour

Consolidated memory is normal persistent character state.

After a successful consolidation, the resulting `recentMemories` and `longTermMemories` must be saved and restored by the existing save system.

Loading a save or restoring a session does not itself trigger consolidation.

Example:

1. Mara has 35 recent memories in a save.
2. `Auto-compress character memory` is off.
3. The user loads the save.
4. Mara still has all 35 recent memories.
5. The user selects Mara and presses `Compress memory`.
6. Only Mara is consolidated.
7. Mara now has the newest 10 recent memories plus the resulting long-term memories.
8. Price, Nell, Garrick, and all other characters remain unchanged.
9. The user saves the game.
10. Reloading that new save restores Mara's already-consolidated memory.
11. Reloading does not perform another consolidation.

Save migration must preserve already-consolidated `longTermMemories` in the same way it preserves the rest of the character's lived memory.

---

## Automatic Memory Compression Setting

Add a checkbox to the existing lower AI/settings area near the narrator and automatic-AI-processing controls:

`Auto-compress character memory`

The default is OFF.

When it is OFF, the framework performs no automatic memory consolidation.

In particular, automatic consolidation must not run:

- when starting a new game;
- when loading a save;
- after F5/session restoration;
- simply because a character exceeds the threshold;
- during a world tick;
- before an AI reaction.

With the checkbox off, character contexts continue growing exactly as they do now unless the user explicitly presses `Compress memory` for a selected character.

Manual compression remains available while automatic compression is off.

The checkbox state may be persisted with the existing UI/runtime settings, but loading a save must never itself trigger compression. If a persisted setting is ON, the first possible automatic consolidation occurs only when a later normal world tick begins.

---

## Automatic Consolidation Threshold

When automatic consolidation is enabled, a character is eligible when:

```text
recentMemories.length >= 30
```

Automatic consolidation uses exactly the same consolidation request, validation, transaction, and commit implementation as the manual button.

There must not be separate manual and automatic consolidation algorithms.

A successful automatic consolidation still retains exactly the newest 10 recent memories.

---

## When Automatic Consolidation Runs

Automatic consolidation runs at the beginning of the next normal world tick, before the ordinary AI reaction wave.

Conceptually:

```text
human turn is committed
        ↓
new world tick begins
        ↓
optional automatic memory consolidation
        ↓
normal AI reaction wave
```

For every eligible character, consolidation should complete before that character's next normal AI reaction context is built, so the reaction sees the compacted memory.

Automatic consolidation requests must use the existing serialized AI request infrastructure. Do not run character consolidation requests concurrently with ordinary character requests or narrator requests.

Eligibility is based on the character having a mind and meeting the recent-memory threshold, not on the character currently being assigned to AIController.

---

## Interaction With Automatic AI Processing Pause

If the existing global automatic AI-processing option is disabled, automatic memory consolidation is also suspended.

Disabling automatic AI processing must prevent background consolidation model requests.

Manual `Compress memory` remains available because it is an explicit user request, provided no incompatible AI request is already in flight.

---

## Automatic Failure Behaviour

A failed automatic consolidation must not abort the world tick.

On failure:

- leave the character's memory unchanged;
- record diagnostic information;
- do not retry consolidation again during the same world tick;
- continue normal reaction processing using the uncompressed memory.

If the character is still above the threshold on a later world tick, consolidation may be attempted again.

No retry cooldown or backoff mechanism is required in this version.

---

## UI Behaviour

During manual consolidation, show a clear busy status such as:

`Compressing Mara's memory...`

Disable controls that could start incompatible AI operations while the request is running.

On success, show a concise result such as:

`Memory compressed: 24 recent memories consolidated, 10 retained, 3 long-term memories added or updated.`

If there is nothing to compress:

`Nothing to compress.`

On failure, show a failure message and leave the character's memory untouched.

Automatic consolidation may reuse the existing global busy presentation, but scheduler/debug status should identify the active operation as memory consolidation rather than a normal AI reaction.

---

## AI Exchange and Diagnostics

Memory-consolidation requests must appear in the existing AI exchange/debug log under their own purpose and stage.

The recorded exchange should make it possible to inspect:

- character ID;
- model ID;
- existing long-term memories supplied to the request;
- old recent memories selected for consolidation;
- raw model response;
- parsed response;
- validation errors if any;
- generated IDs for new long-term memories;
- number of recent memories consolidated;
- number retained;
- whether the transaction committed successfully.

This is especially important for the initial manual-testing phase, because the feature is intended to let the user inspect how individual characters reorganize their autobiographical memory.

---

## Acceptance Criteria

The implementation is complete when all of the following are verified:

1. The existing sidebar character selector determines which character the manual memory-compression button targets.
2. `Compress memory` is available for every character regardless of controller assignment.
3. Manual compression affects only the selected character.
4. Ten or fewer recent memories cause no model request.
5. With more than ten recent memories, exactly the newest ten remain unchanged.
6. Only memories older than those newest ten are supplied as consolidation material.
7. Existing long-term memories are supplied to the model.
8. The model can update an existing long-term memory only by a valid existing ID.
9. The model can propose new long-term memories without supplying IDs.
10. The framework assigns unique IDs to new long-term memories.
11. Existing long-term memories cannot be deleted by this version of the consolidator.
12. The model is explicitly instructed to consolidate thematically rather than create one summary per compression run.
13. The model is explicitly instructed to preserve the character's subjective perspective and unresolved contradictions.
14. The model cannot write known facts, beliefs, relationships, continuation, or world state.
15. Consolidation uses the configured Character model, not the narrator model.
16. Consolidation is logged as a separate `memory-consolidation` AI operation.
17. Consolidation consumes no world tick and no AI reaction.
18. It generates no speech, public narrative, event, observation, or in-world awareness of memory compression.
19. The operation is atomic.
20. A failed request never deletes old recent memories.
21. A stale consolidation result is not committed if the character's relevant memory changed while the request was in flight.
22. Successful consolidated memory is persisted in normal saves.
23. Reloading a save restores consolidated memory without triggering another consolidation.
24. Loading an old save with auto-compression OFF performs no compression.
25. `Auto-compress character memory` exists and defaults to OFF.
26. With auto-compression OFF, memory growth behaves exactly as it does before this feature unless the user manually compresses a character.
27. With auto-compression ON, a character becomes eligible at 30 or more recent memories.
28. Automatic consolidation runs only on a later normal world tick, never merely because a save was loaded or the page was refreshed.
29. Automatic consolidation happens before ordinary AI reactions for the eligible character.
30. Manual and automatic consolidation use the same core implementation.
31. Disabling automatic AI processing also disables automatic memory consolidation.
32. Manual consolidation remains available while automatic processing is disabled.
33. Failure of automatic consolidation does not abort the world tick.
34. Manually compressing Mara leaves Price, Nell, Garrick, and every other character's mind state unchanged.
35. A save made after compressing Mara restores Mara's compressed memory and leaves the other characters in their independently persisted states.
