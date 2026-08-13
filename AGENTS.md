# AI RPG Repository Instructions

This file contains hard repository rules for coding agents. `docs/architecture.md` is the canonical design description and `docs/status.md` is the canonical current-status summary.

## 1. Authority and state ownership

- The deterministic engine owns objective world state.
- Models/controllers choose intentions; they do not directly mutate canonical mechanics or mind arrays.
- `data/world.json` is authored/static source data. Generated world files are build products.
- A save owns compatible runtime state.
- Save migration is always **fresh current authored world + compatible saved runtime overlay**.
- Current authored definitions/descriptions/known facts win over stale saved authored copies.
- Compatible runtime position, inventory/item state, money, sleeping, beliefs, relationships, memories, continuations, dynamic lock state, committed events, pending observations, queue state, and counters survive migration.
- Generic migration may sanitize references to removed entities, but must not contain story-specific special cases.
- A well-formed externally patched pending observation is legitimate runtime state and must survive generic migration when its references remain valid.

## 2. Formal actions and grounding

- All formal character actions go through the canonical `CharacterAPI` path.
- `ActionRegistry`/current GameAPI action implementation is the single deterministic authority for action mechanics.
- `view.available_actions` is the only current capability contract exposed to a controller.
- AI formal actions must be validated against the current action type and that action's current concrete options before execution.
- Narrative/speech never substitutes for tracked mechanics such as movement, item transfer/transformation, money transfer, locks, sleeping state, or ability results.
- Model prose belongs to the attempt phase; deterministic engine result is authoritative completion/failure.
- An impossible request outside the current action contract does not advance the Human world tick.
- A legitimate available action attempt that fails in-world consumes the turn and emits grounded failure feedback.

## 3. Canonical view and AI context

- Ordinary HumanController and AIController use the same canonical restricted character `view` for public/operational truth.
- AI ordinary-decision context may add private identity instructions, private mind state, continuation, and prepared pending observations, but must not create an alternate public world projection.
- Do not duplicate large data already present in the view under aliases.
- Maintenance workflows (timelapse planning, reflection, consolidation, narrator work) are not ordinary controller decisions and may use purpose-specific compact contexts.
- Do not build a full ordinary character view only to discard most of it for a maintenance request.

## 4. Controllers and world ticks

- Exactly one character is HumanController-controlled.
- Switching Human control is atomic and repairs/rejects invalid zero/multiple-Human states.
- Human Submit creates one world tick.
- After a valid Human turn, synchronously process AI reactions causally created by that tick.
- Each eligible AI character reacts at most once per Human world tick.
- Ordinary AI reactions remain sequential because a later AI may need observations created by an earlier committed reaction.
- Formal-action targets receive stronger within-tick initiative than speech targets; speech targets outrank normal deterministic queue order.
- Off-screen AI reactions still execute canonically; presentation depends on the invisible-events debug setting.

## 5. Continuation

- `continuation` is model-authored opaque working intention.
- The engine stores/returns it but does not interpret, validate, prioritize, or execute its semantic content.
- Ordinary tick continuation must be re-evaluated against the refreshed canonical view on each reaction.
- Tick-mode continuation is cut when entering coarse timelapse. Do not pass unfinished granular tick obligations into timelapse planning.

## 6. Timelapse

- Timelapse is a generic coarse-time framework; only overnight mode is currently exposed.
- Generic code belongs in `24-timelapse-core.js`; overnight-only entry/exit policy belongs in `24-night-timelapse.js`.
- Generic prompts must be mode-aware and must not hard-code overnight semantics.
- Current overnight mode uses five sequential committed rounds.
- Independent structural requests may run concurrently where explicitly allowed by the timelapse workflow.
- `narrate` is not a tracked-state mutation channel.
- Authored timelapse actions are deterministic macros for tracked coarse-time effects.
- AI characters sleeping at the end of overnight remain sleeping in the morning. HumanController is returned/woken; AI is not auto-woken.
- Progressive output may reveal already committed results but never speculative plans/thinking.

## 7. AI request architecture

- Production requests should resolve through `setup.AIRequestProfiles` unless an exception is explicit and documented.
- Model roles:
  - Character: ordinary AIController decisions.
  - Utility: timelapse planning/replanning/intents/resolver, reflection, consolidation.
  - Narrator: presentation-only prose.
- Utility default is DeepSeek V4 Flash; if an invalid/unavailable configured Utility model cannot be resolved locally, fall back safely to Character role where the workflow supports fallback.
- Ordinary character decisions retain the Character model.
- OpenRouter routing defaults to `provider.sort = "latency"` with fallbacks enabled.
- Use stable non-secret `session_id` values for sticky routing/cache locality.
- Never put API keys or secrets into `session_id`, logs, saves, model context, or world data.
- Do not enable response caching for gameplay responses.
- Preserve stable prompt prefixes where practical to benefit provider prompt caching.
- The one-second live transport pacing guard is intentional and must remain unless explicitly redesigned.
- Ordinary causal reaction waves must not be parallelized for latency.

## 8. Model protocol and safety

- Model outputs are local JSON contracts, not executable code.
- Reject extra/invalid fields according to the relevant protocol.
- At most one repair request is permitted for malformed/schema-invalid structured output unless a workflow explicitly documents otherwise.
- Repair prompts must remain grounded in the current canonical contract/options.
- Model failures must not silently commit speculative state.
- A failed AI reaction restores that reaction's uncommitted snapshot; earlier committed reactions remain committed.

## 9. Memory

- Authored `knownFacts` come from current world authoring.
- Runtime beliefs, relationships, recent memories, long-term memories, continuation, and pending observations live in the save/runtime.
- Engine-owned memory updates support bounded recent-memory append, belief upsert, and relationship upsert.
- Memory consolidation is transactional and may run as maintenance work.
- Retrieval-based old-memory selection/embeddings are future work; do not add them incidentally.

## 10. Movement, perception, sleeping

- Major location movement emits one canonical `character_moved` event with source and destination.
- Deliver that event to the union of characters who can perceive the actor from either side.
- Do not split one movement into separate departure/arrival canonical events.
- Sleeping is explicit canonical state, separate from lying on a bed.
- Observation alone does not mechanically wake a character.
- Existing wake-on-own-action/speech semantics remain authoritative.

## 11. Items and authored content

- Item definitions are authored types; item entities are stable/runtime instances.
- Initial stable instances belong in `data/world.json` and appear in new worlds/fresh authored baselines.
- Saved compatible runtime placement/state for an existing stable item instance wins over its authored starting placement.
- New authored stable instances absent from an older save remain in their current authored starting placement after migration.
- Item use may emit private/public grounded feedback without requiring buffs/stats. Narrative-only effects are valid when explicitly authored.
- Do not add one-off story migration fields to item definitions/instances.

## 12. UI/editor

- Normal gameplay UI is generated from canonical state/action availability.
- Do not add alternate manual execution paths for pending AI work. Read-only/debug visibility is acceptable.
- The standalone editor edits `data/world.json`; it does not need Node/server/build tooling.
- Do not hand-edit `src/generated/` artifacts.

## 13. Files and refactoring

- Keep the public `setup.GameAPI`/`CharacterAPI` facade stable where practical.
- Prefer extraction over broad rewrites.
- Current internal split:
  - `10-game-api.js`: deterministic facade/actions/events/world helpers;
  - `11-save-migration.js`: save reconciliation;
  - `12-character-context.js`: restricted views/context;
  - `13-character-memory.js`: mind/continuation state helpers.
- Preserve stable IDs, JSON field names, save compatibility, event order, and available-action shapes during structural refactors.

## 14. Validation before completion

For any implementation patch:

1. run `./test.sh` (or `test.bat` on Windows);
2. run `./build.sh` (or `build.bat`);
3. ensure generated files are current;
4. when delivering a patch, verify it by applying it to a clean copy of the declared source archive and rerun tests/build;
5. do not touch Git/GitHub unless explicitly asked.
