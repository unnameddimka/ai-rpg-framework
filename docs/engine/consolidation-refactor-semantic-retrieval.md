# AI RPG Consolidation, Refactor, and Semantic Mind Retrieval

## Status

Implementation specification for the consolidation pass based on committed baseline `ai-rpg-framework(20260818-193824).zip`.

This pass preserves working gameplay semantics while consolidating the architecture after Mind v3, fixing known lifecycle/tooling defects, adding semantic ordinary-turn memory retrieval, reducing avoidable snapshot/debug/build overhead, and making canonical documentation match the current code.

## Accepted invariants and scope

### Ordinary decision retrieval

- Semantic preflight applies only to ordinary `game-decision` in this pass.
- Existing context budgets remain configurable: beliefs 16, STM 12, LTM 8; verbatim remains the newest 20 and is not semantically retrieved.
- A cheap Utility-model preflight receives runtime context plus a compact mind catalog and returns only `beliefIds`, `stmIds`, and `ltmIds` up to the configured limits.
- STM/LTM catalog entries expose only `id`, `topic`, and `retrievalBrief`; full summaries never go to preflight.
- Belief catalog entries expose `id`, `text`, `confidence`, and `activation`; beliefs do not get `retrievalBrief`.
- Preflight runtime context includes pending observations, recent dialogue, recent verbatim, location/sublocation, present characters, notable visible items/objects, and current continuation/intention. It does not need formal-action catalogs.
- Preflight failure, timeout, malformed output, or invalid IDs must not fail gameplay; fall back to the existing deterministic bounded selector and record diagnostics.
- Occasional imperfect autobiographical recall is acceptable. Canonical world truth remains supplied by deterministic world/view state.

### Retrieval brief lifecycle

- Add persistent `retrievalBrief` to STM/LTM. Older/malformed-compatible records normalize to `""` without a model call.
- New or materially updated STM/LTM must generate/update the brief together with the memory.
- Empty briefs remain usable through `topic` alone.
- During normal maintenance opportunities, an independent idempotent Utility subtask backfills all currently empty STM/LTM briefs. It can only write the brief field and cannot block/fail autobiographical maintenance or gameplay.
- Backfill commits only if the target record still exists, its topic/summary still match the snapshot, and the brief is still empty.
- Briefs persist in save, emergency dump, and portable mind.
- Retrieval metadata is derived index data, not memory/evidence/consciousness.

### Pending-observation lifecycle

- `mind.pendingObservations` is strictly an AI-scheduler inbox.
- AI-controlled characters retain delivered scheduler observations until processed.
- Human/Dummy-controlled characters still receive experienced/verbatim information but do not retain scheduler pending observations.
- Switching AI -> Human/Dummy clears scheduler inbox; switching Human -> AI never replays historical human observations, but normal controller-transition observations may be generated.
- Loading older saves normalizes pending backlogs away for non-AI characters.

### LTM hardening

- Existing evidence-driven LTM semantics remain: unrestricted justified operation counts, 12k completion allowance, provenance, coverage retirement, protected memory, candidate validation, atomic commit.
- Self-only provenance is not sufficient for a material LTM upsert. A target may cite itself only if at least one source STM or another distinct LTM is also cited.
- Cosmetic/no-op retopicing under self-only provenance must not commit.
- Higher-order existing-belief effects use only `{beliefId,effect,strength}`; existing confidence/activation remain engine-owned and direct replacement numeric fields are invalid.

### Structured request lifecycle

- Introduce one shared configurable structured-request runner above `AIRequestExecutor` for request, parse, truncation handling, normalize, validate, bounded repair/retry, diagnostics, and normalized result/error reporting.
- Domain validators remain with their protocols. Purpose-specific policies remain configurable.
- Migrate ordinary protocol/timelapse/mind structured flows as safely practical in this pass; semantic preflight and brief backfill use the shared runner from inception.
- Remove dead Mind v2 protocol code once unreachable.

### Maintenance recovery snapshots

- Persist at most one full recovery snapshot per logical maintenance run: ordinary background STM, forced pre-timelapse STM, post-timelapse maintenance, or manual maintenance.
- The snapshot represents pre-run mind state; granular after-STM/before-reconciliation rollback is not required.
- Persist lazily only before the first canonical mutation of a run; no-op runs need not add snapshots.
- Brief-only backfill creates no full recovery snapshot.

### Auto maintenance

- Enabling auto-consolidation immediately evaluates and schedules already eligible characters; no additional dialogue is required.

### Module consolidation

- Split `24-memory-consolidator.js` along real ownership boundaries (STM, LTM, reconciliation, orchestration, retrieval/backfill) without excessive micro-modules.
- Split internals of `10-game-api.js` by ownership while preserving `setup.Game`, `setup.CharacterAPI`, and `setup.TimelapseAPI` facades.
- Extract clearly separable debug/admin/Prompt Lab UI from `30-game-ui.js`; do not rewrite stable scene/action rendering.
- Separate runtime world normalization/synchronization from pure validation where practical.

### Editor/authored validation

- Replace independent editor/generator authored validators with one shared JS validator used by both.
- The editor remains a single offline HTML artifact with the shared validator embedded/generated into it.
- Editor validation must support current Mind v3 (`schemaVersion`, STM/LTM/verbatim, numeric confidence/activation, `retrievalBrief`) and no longer require v2 `recentMemories` or enum confidence.
- Current committed `data/world.json` must validate identically in generator and editor, including `dayActivities` and `timelapseActions` contracts.
- Remove the independent PowerShell validator/generator implementation. A thin compatibility wrapper may remain, but it must delegate to the canonical JavaScript generator/shared authored validator and contain no duplicated validation logic.

### Tests/build

- Add a canonical test/runtime loader/manifest so module splits do not require repeated manual load orders.
- Remove duplicate generator execution from build/test while preserving validation coverage.

### Emergency dump

- Preserve everything necessary to reconstruct a save from every recovery point represented by the dump and diagnose network/provider/protocol/scheduler/maintenance/migration/structural failures.
- Preserve canonical world/minds/SugarCube/event/recovery state required for reconstruction.
- Preserve complete diagnostic request/response data exactly once.
- Remove duplicate exchange files/payloads and make trace/activity records metadata/delta-only where possible; preserve stage/run/repair/retry correlations.

### Documentation

- Canonical docs become authoritative for the final implementation.
- Merge all current behavior/invariants from task/hotfix specs into canonical docs and reconcile against final code.
- Historical specs remain in the repository for now but become non-authoritative and may be deleted later by the developer.
- Add the project-wide sensitive-content engineering invariant: existing explicit game data is opaque domain data that must be faithfully preserved for engineering, migration, diagnostics and analysis; developer-facing explanations should prefer neutral semantic labels unless exact text is technically necessary.

## Explicit non-goals

- No embeddings/vector database.
- No semantic preflight for timelapse in this pass.
- No removal of current STM operation-count caps without production evidence.
- No global per-stage timelapse barriers solely for architectural neatness.
- No physical abort propagation for already-running auxiliary transports.
- No public facade redesign.
- No speculative action-pipeline clone rewrite unless it falls out trivially from the refactor.
- Do not delete historical task specs in this pass.

## Acceptance summary

The pass is accepted when ordinary decisions use semantic preflight with deterministic fallback, mind briefs self-heal ambiently, non-AI scheduler backlogs are eliminated, LTM provenance/effect contracts are hardened, maintenance snapshots are one-per-logical-run, editor/generator validation agrees on current authored schema, request lifecycle duplication is reduced, emergency dumps retain recovery/diagnostic fidelity without redundant full payload copies, all existing gameplay regressions remain green, and canonical docs describe the final current architecture without requiring historical hotfix specs.
