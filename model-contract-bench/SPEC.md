# Model Contract Bench — v0.1 specification

## Goal

Qualify candidate LLMs against a small, coverage-complete corpus of real production requests. Correctness means obeying the request's formal output contract and deterministic invariants. Semantic/role-play quality is intentionally outside the automated score.

## Independence

The benchmark is a standalone project. Mallowstead supplies benchmark data only. A corpus case contains a frozen request, role/stage metadata and a validator contract version. No Mallowstead source import is required at runtime.

## Corpus policy

A seed corpus should be small but cover:

1. every protocol/stage present in source dumps;
2. Utility and Character independently;
3. Narrator where data exists;
4. small, medium, large and near-limit inputs where available;
5. historically interesting failures/repair cases.

v0.1 selects min/median/max request size per `(role, stage)` and force-includes every exchange that originally failed or required repair. Future dumps may extend the corpus without invalidating existing cases.

## Metrics

Authoritative metrics:

- Utility clean pass rate;
- Character clean pass rate;
- breakdown by stage/protocol;
- breakdown by input-size bucket;
- failure-category distribution;
- truncation rate;
- latency, tokens and cost.

Narrator is reported separately when present.

`Sort score = mean(Utility clean pass %, Character clean pass %)` over roles with data. It exists only for sorting.

## Persistence / cost control

SQLite is authoritative for cases and run history. Paid calls are cached by captured request hash, model ID, effective request settings, contract version and repetition. `Run missing` never overwrites a matching result. Reruns must be explicit.

Raw responses, provider, finish reason, validation error, token usage, cost and latency are retained.

## Contract pass semantics

A clean pass requires the first response to satisfy the locally versioned validator. Markdown JSON fences are accepted because captured production behavior accepted them. Leading/trailing prose around JSON is not accepted. A provider `finish_reason=length` is truncation regardless of whether a prefix appears parseable.

v0.1 does not automatically repair a new model response. Historical imported runs retain whether the original engine passed cleanly or after repair. A benchmark-side repair experiment may be added later, but it must remain a separate metric from first-pass reliability.

## Roles

- `utility`: retrieval, memory maintenance, timelapse planning/intents/reflection and similar service protocols.
- `character`: game decision and character-owned daytime work narration/settlement.
- `narrator`: narrator-role calls such as weather narration.

A single candidate model can be replayed against any or all roles; the dashboard never merges the role scores into the authoritative result.

## Candidate model registry

A human-editable `models-to-test.json` may ship with the benchmark. It is not part of corpus correctness and does not affect run cache keys except through the selected `model_id` itself.

The registry exists to maintain a small current shortlist of models worth spending money to benchmark. Entries may include a price snapshot, context size, role focus and selection rationale. These fields are advisory; measured benchmark pass rates and actual run costs remain authoritative.

Prefer immutable/revision-specific OpenRouter IDs when available. Avoid moving `latest` aliases for persisted comparisons unless no stable ID exists. Updating the shortlist must not delete or reinterpret historical runs for models removed from the list.
