# Mind v3 Night Timelapse Ingress and Time Sync Hotfix

## Status

Implemented hotfix specification.

This hotfix addresses three production failures observed during the second real overnight Mind v3 timelapse. It does not redesign Mind v3, alter autobiographical-memory semantics, or weaken atomic source-memory protection.

## 1. STM belief-reference salvage

### Observed failure

A valid STM consolidation response for Mara contained many valid memory writes and belief effects, but one model-authored belief ID did not exist in the supplied canonical belief set (`dmytro_respects_boundaries` instead of the actual supplied ID `traveler_respects_boundaries`). The whole STM response was rejected and no otherwise-valid autobiographical consolidation committed.

### Rule

Syntactically valid belief effects and activation references that point to no supplied belief are safely separable auxiliary mutations.

At STM ingress:

- use only exact IDs from the supplied canonical belief set;
- do not fuzzy-match, rename, or infer an alias for an unknown belief ID;
- drop a syntactically valid effect whose `beliefId` is unknown;
- drop an unknown string in `activatedBeliefIds`;
- continue validating and committing the remaining response normally;
- malformed effect records remain validation failures;
- valid duplicate effects retain the existing bounded normalization rules;
- the same valid belief may appear in both `beliefEffects` and `activatedBeliefIds`; application still produces only the intended activation behavior.

This preserves valid autobiographical memory without letting the engine guess belief identity.

## 2. LTM ingress hardening

### 2.1 Distinct STM/LTM ID spaces

`longTermMemoriesToUpsert` may reference only an ID already present in `existingLongTermMemories`.

If the model instead supplies a structurally valid LTM upsert whose ID belongs to a supplied STM and not to LTM, ingress interprets this narrowly as an attempted promotion:

- remove the STM ID from that write;
- convert the record into `longTermMemoriesToAdd`;
- do not automatically retire the source STM;
- retire the STM only if it is separately covered by a validated retirement group under the current LTM protocol.

An unknown ID belonging to neither supplied STM nor supplied LTM remains invalid.

### 2.2 Missing topic on a known LTM upsert

If an upsert contains exactly `id`, `summary`, and `importance`, and the ID is a supplied LTM, ingress may inherit the existing LTM topic. No new topic is inferred.

The same narrow inheritance may be used before converting a supplied STM-ID upsert into an LTM add.

### 2.3 No-op LTM writes

An exact no-op upsert of an existing LTM is removed from the write-set at ingress rather than invalidating useful independent writes in the same response.

A materially changed protected LTM remains forbidden.

### 2.4 Observed belief-add shape adapter

The production model returned a new belief in this exact alternate form:

```json
{
  "topic": "Kindness from strangers can be genuine",
  "summary": "...evidence/rationale...",
  "confidence": 0.6,
  "activation": 0.5
}
```

Ingress may adapt only this exact structurally valid shape to:

```json
{
  "text": "Kindness from strangers can be genuine",
  "initialConfidence": 0.6,
  "initialActivation": 0.5
}
```

The `summary` is treated as model rationale and is not stored as belief text or autobiographical memory. Other malformed belief shapes remain invalid.

### 2.5 Prompt contract

The LTM prompt must state explicitly that:

- STM IDs and LTM IDs are separate namespaces;
- LTM upserts use existing LTM IDs only;
- STM promotion uses an LTM add with no ID;
- belief adds use exactly `text`, `initialConfidence`, `initialActivation`.

## 3. Canonical time and legacy SugarCube time mirror

`world.environment.timePhase` remains the authoritative time state.

The legacy SugarCube `State.variables.time` value is a compatibility/debug mirror only, but it must not contradict canonical time after a coarse-time transition.

`WorldEnvironment.setTimePhase()` therefore synchronizes both:

- `evening` -> `Evening`
- `nighttime_timelapse` -> `Night`
- `morning` -> `Morning`
- `daytime_timelapse` -> `Day`

Overnight and daytime wrappers must use the synchronized phase setter for entry, success, and rollback/failure transitions. A successful overnight timelapse must leave both canonical `timePhase = "morning"` and legacy `$time = "Morning"`.

## 4. Failure semantics

This hotfix does not weaken candidate-clone/atomic commit behavior.

- Unknown belief references are dropped only when their record shape is otherwise valid and separable.
- Malformed belief effects still reject the STM response.
- Unknown LTM upsert IDs still reject the LTM response.
- Protected-memory rules remain unchanged.
- Converted STM-ID LTM writes never implicitly delete the source STM.
- Any remaining validation failure preserves source STM/LTM/verbatim data as before.

## 5. Required regression tests

1. A valid STM response with one unknown but syntactically valid belief effect still commits memory writes and valid effects.
2. Unknown activation IDs are dropped without inventing aliases.
3. Malformed belief effects still reject atomically.
4. One valid belief may appear in both effect and activation lists.
5. An LTM upsert using a supplied STM ID becomes an LTM add and does not retire the STM implicitly.
6. An LTM upsert using an unknown ID remains invalid.
7. A known LTM upsert missing only `topic` inherits the persisted topic.
8. An exact no-op LTM upsert is removed while independent useful writes still commit.
9. The observed `topic/summary/confidence/activation` belief-add shape converts to the canonical belief record.
10. Other malformed belief-add shapes remain invalid.
11. The LTM prompt explicitly distinguishes STM and LTM ID spaces and gives the canonical belief-add shape.
12. Successful overnight timelapse leaves canonical time `morning` and legacy `$time` equal to `Morning`.
13. Failed/rolled-back overnight transitions restore both canonical and legacy time to Evening.
14. Successful daytime timelapse leaves canonical time `evening` and legacy `$time` equal to `Evening`.
