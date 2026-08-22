# Timelapse Observation Boundary Bugfix

## Scope

Fix one coarse-time boundary regression: pending observations that already existed when a timelapse began could survive the entire timelapse when their recipient AI character was already sleeping and therefore skipped active planning.

## Invariant

The timelapse boundary consumes the pre-existing pending-observation inbox of **every AI-controlled character**, regardless of whether that character is awake, sleeping, actively planned, fixed by a daytime activity, or otherwise skipped by planner eligibility.

Only observations that existed at timelapse entry are boundary-consumed. Observations created during the timelapse remain subject to normal delivery/queue semantics.

## Commit timing

Preserve current rollback truthfulness: pre-existing observation IDs are snapshotted before planning, but are consumed only after the first round successfully commits. If the timelapse fails before any committed round, the original inbox remains intact through existing rollback semantics.

## Night behavior

Already-sleeping AI characters still skip active nighttime planning. This fix must not add model calls merely to make sleeping characters continue sleeping.

Example regression: Mara may enter the night asleep with a pending `Traveler went to sleep.` observation. She receives no night plan, but after the first successfully committed night round that old observation is consumed and must not wake up as a stale morning reaction.

## Implementation

In the shared `24-timelapse-core.js`, snapshot the initial pending-observation IDs for all AI characters before planner sleep/eligibility checks. Reuse the existing first-committed-round consumption path.

Do not create a separate night/day cleanup implementation.

## Tests

Add regression coverage proving that:

- a sleeping AI with a pre-existing pending observation receives no active night plan;
- after a successful first committed round / completed night, that observation is gone;
- an already-sleeping AI still receives no unnecessary planner request;
- existing timelapse behavior and full test suite remain green.
