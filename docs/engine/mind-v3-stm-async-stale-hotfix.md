# Mind v3 STM Async Stale-Check Hotfix

## Status

Implementation mini-spec for the live Mind v3 background-consolidation starvation observed on 2026-08-18 after the STM production-budget hotfix.

This hotfix changes only the compatibility/stale check used when an asynchronous ordinary STM job attempts to commit. It does not change the `>40` trigger, newest-20 retention rule, STM/LTM/belief semantics, request model/profile, confidence math, activation math, or timelapse maintenance ordering.

## 1. Production failure

A live Mara STM job correctly took a snapshot and began an asynchronous Utility request while gameplay remained interactive. Before the Utility response returned, a normal `game-decision` used existing beliefs and therefore raised their `activation` values.

The ordinary turn incremented the character-wide `mindRevision`. The STM commit path treated any `mindRevision` change as incompatible and would reject the eventual result as `MIND_V3_STALE` even though:

- the exact source verbatim observations still existed unchanged;
- no STM or LTM record had changed;
- no belief ID, text, or confidence had changed;
- only belief salience/activation had changed through normal gameplay.

This creates starvation: an intentionally non-blocking background job can invalidate itself whenever the character continues to think and speak while it is running.

## 2. Required compatibility rule

Ordinary background STM commit must use an operation-specific optimistic compatibility check rather than the coarse character-wide `mindRevision` equality check.

The following concurrent changes are **compatible** with an in-flight STM snapshot:

1. new verbatim observations appended after the snapshot;
2. activation-only changes to existing beliefs;
3. engine-owned belief diagnostic history associated with those activation changes;
4. a character-wide `mindRevision` increment caused only by otherwise-compatible changes.

The following changes are **incompatible** and must reject the STM result as stale:

1. an STM record is added, removed, reordered, or changed;
2. an LTM record is added, removed, reordered, or changed;
3. a relationship record is added, removed, reordered, or changed;
4. a belief is added or removed;
5. an existing belief's stable ID, text, or confidence changes;
6. any source verbatim observation captured by the snapshot disappears or changes in place.

Belief activation is intentionally excluded from the incompatible-state comparison because activation is salience, not autobiographical evidence or belief identity/meaning/certainty.

## 3. Commit merge semantics

The STM model still computes against its immutable snapshot.

At commit time:

1. validate the operation-specific compatibility projection against current canonical state;
2. separately verify that every verbatim source record from the snapshot still exists byte-for-byte/structurally unchanged;
3. clone the **current** canonical world, not the old snapshot;
4. apply validated STM upserts/adds and belief effects to that current clone;
5. therefore preserve activation changes that occurred during the request;
6. if the consolidation itself activates a belief, apply that saturating activation bump on top of the current activation value;
7. remove only the exact captured eviction IDs;
8. preserve every verbatim observation appended after the snapshot;
9. validate the complete candidate world and commit atomically.

No last-writer-wins overwrite from the snapshot is permitted.

## 4. Scope

This hotfix applies to ordinary asynchronous `mind-v3-stm` commit only.

LTM consolidation and belief reconciliation retain their existing strict revision stale check for now. They run as deliberate maintenance/timelapse stages rather than the normal always-live background STM lane, and there is no production evidence requiring weaker compatibility there.

Do not add new serialized revision counters merely for this hotfix. The operation-specific projection is intentionally local to STM consolidation and can later be replaced by finer-grained revision counters if the architecture grows enough to justify them.

## 5. Failure safety

Unchanged:

- incompatible results commit nothing;
- source verbatim memory is never deleted on stale failure;
- new observations are never removed by an older job;
- provider/validation failures commit nothing;
- background work never holds the global gameplay `Thinking...` lock;
- one background mind job per character remains authoritative.

## 6. Acceptance tests

Add regressions proving at least:

1. an activation-only ordinary mind update during an in-flight STM request no longer makes the result stale;
2. the commit preserves the live activation value rather than restoring the snapshot activation;
3. an STM-returned activation bump is applied on top of the live activation value;
4. new verbatim observations arriving in flight still survive exact eviction;
5. changing belief confidence during the request rejects the result as `MIND_V3_STALE` and removes nothing;
6. changing STM content during the request rejects the result as stale and removes nothing;
7. changing a relationship during the request rejects the result as stale and removes nothing;
8. existing provider failure, invalid output, protected-memory, exact-eviction and atomic candidate validation regressions remain green.
