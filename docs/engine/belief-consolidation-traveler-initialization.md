# Belief Consolidation + Traveler Initialization Profiles

> **Historical / superseded:** Mind v3 (`ai-rpg-mind-v3.md`) is now canonical for autobiographical memory, beliefs, maintenance, migration, and portable mind. Keep this document only for implementation history or non-mind features that Mind v3 explicitly leaves intact.


## Status

Implementation specification for the current AI RPG framework.

This patch adds two independent features delivered together:

1. bounded consolidation of semantically redundant active beliefs, preserving exact source records in the existing maintenance archive;
2. a fresh-world initialization flow with an adult AI-interaction disclaimer followed by selection of the Traveler identity from the generic Traveler, authored Traveler profiles, or a Custom Traveler.

The implementation builds on Safe Mind Maintenance v2.2 and the existing single-HumanController architecture. Existing grounding, save/migration, portable-mind, timelapse, and controller invariants remain authoritative.

---

## 1. Belief consolidation

### Purpose

The active belief set represents the character's current understanding, not a permanent history of every intermediate wording of that understanding. Reconciliation handles contradictions; this new stage handles semantic redundancy.

Belief consolidation is active-state compression, not deletion of character history.

### Archive invariant

Continue using `mind.maintenanceArchive.beliefs`. Do not create another archive. Every source belief that disappears, and every survivor payload that is materially rewritten, must be archived verbatim before replacement. Portable mind v2 continues to carry the archive unchanged.

### Eligibility and bounds

Keep `BELIEF_MAINTENANCE_THRESHOLD = 60`.

When the candidate has at least 60 active beliefs, run one `memory-consolidation-beliefs` stage before v2.2 reconciliation.

The stage receives read-only character identity, known facts, relationships, and the complete active belief set. It may propose at most 4 disjoint merge groups. Each group contains 2-4 active source belief IDs.

Response shape:

```json
{
  "groups": [
    {
      "sourceBeliefIds": ["belief_a", "belief_b"],
      "replacement": {
        "text": "Consolidated current belief.",
        "confidence": "medium"
      }
    }
  ]
}
```

No model-supplied IDs or extra fields are allowed. Existing bounded repair behavior applies.

### Merge semantics

Merge only clearly redundant or successive formulations of substantially the same proposition. Do not merge merely because records concern the same person/topic/emotion. Do not use consolidation to resolve contradictions, strengthen certainty, invent broader traits, or summarize the whole personality. When uncertain, leave beliefs separate.

For every validated group, choose the lexicographically first source belief ID as the stable survivor ID. No global ID is allocated.

If the replacement payload is identical to the survivor, archive only the other source beliefs. If it changes the survivor, archive the old survivor too. Remove the other sources and install the replacement under the survivor ID.

### Pipeline

Canonical maintenance order:

1. recent-memory consolidation;
2. belief consolidation when threshold is met;
3. v2.2 belief/memory reconciliation;
4. bounded long-term-memory merge;
5. atomic commit.

Existing parallel-prepare / serialized-commit rules remain unchanged.

### Reporting

Add:

- `beliefMergeGroups`
- `beliefMergeSources`
- `beliefsRemovedByConsolidation`

`totalBeliefs` and archive totals continue reporting post-commit state.

---

## 2. Traveler authoring profiles

### Stable player shell

The canonical world entity remains `player`. Do not create or swap in a separate runtime character entity.

The `player` entity continues to own starting location, inventory, wallet, controllers, abilities, initial mind/known facts, equipment references, and engine facts. Startup selection overlays identity authoring only.

A selected Traveler identity may replace only:

- `name`
- `playerDescription`
- `aiDescription`

`interactionLabel` and the player inventory display name may be deterministically derived from the selected name.

### Shared Traveler aura

The otherworldly aura is a property of all Travelers and remains on `characters.player.engineFacts.aura`. Profiles and Custom authoring cannot edit or replace it.

Use gender-neutral authored aura text so all Traveler identities receive the same supernatural invariant.

### Authored profiles

Add top-level authoring collection:

```json
{
  "travelerProfiles": {
    "profileId": {
      "id": "profileId",
      "name": "Example Traveler",
      "playerDescription": "Externally visible identity.",
      "aiDescription": "Private authored identity/personality baseline."
    }
  }
}
```

Traveler profiles are authoring templates, not world entities. They have no location, controller, inventory, wallet, mind, aura, abilities, or runtime state.

The standalone editor exposes a separate `Traveler profiles` section with add/delete/edit for technical ID, name, visible description, and AI-facing authoring description. It must not expose mechanical/aura fields.

Zero authored profiles is valid. The generic Traveler is always available separately and does not need a duplicate profile record.

### Custom Traveler

Custom startup authoring contains:

- name: 1-120 characters;
- visible description: non-empty, max 2000 characters;
- character authoring / AI description: non-empty, max 4000 characters.

The Custom form may prefill the generic Traveler identity. Custom authoring is runtime/save state only and does not write back to `world.json`.

---

## 3. Adult AI-interaction disclaimer

This is a project/product invariant, not a legal age-verification system.

Every genuinely fresh world first shows a standalone disclaimer before Traveler selection:

> **AI Interaction Disclaimer**
>
> This game does not contain explicit 18+ content by default. However, AI-generated interactions may be unfiltered depending on the model you use.
>
> If you decide to get kinky with the characters — or otherwise take things into adult territory — you should be 18 or older.

Exactly one action is required:

**Okay, fine**

Do not add DOB entry, checkboxes, secondary confirmations, or other age-verification bureaucracy.

Accepting the disclaimer is an out-of-world bootstrap action. It emits no event/observation, consumes no turn, advances no time, creates no memory, and triggers no AI work.

---

## 4. Runtime startup state

Fresh runtime world:

```json
{
  "playerSetup": {
    "disclaimerAccepted": false,
    "completed": false,
    "mode": null,
    "profileId": null,
    "customAuthoring": null
  }
}
```

Completed modes are `generic`, `authored`, `custom`, or migration-only `legacy`.

Normal gameplay/AI reaction processing is permitted only when:

```text
playerSetup.disclaimerAccepted === true
AND
playerSetup.completed === true
```

A fresh world may be mechanically instantiated behind the setup screen, but Human turns, AI reaction waves, automatic maintenance reached through reaction processing, and weather-model initialization must not begin until setup completes.

Startup sequence:

1. create canonical fresh world;
2. show disclaimer;
3. `Okay, fine` marks disclaimer accepted;
4. show `Choose your Traveler`;
5. generic Traveler is selected by default;
6. user selects Generic, an authored profile, or Custom;
7. one explicit `Enter world` action validates and atomically applies the permitted identity overlay;
8. mark setup complete;
9. render normal game UI and allow normal model activity.

Finalizing setup is not an in-world action and creates no events/observations/turns/memories.

---

## 5. Save/load and migration

`playerSetup` persists in saves. A save after disclaimer acceptance but before Traveler completion resumes at Traveler selection. Completed saves resume directly in gameplay.

`Reset World` creates a genuinely fresh world and therefore returns to disclaimer + Traveler selection.

Old saves without `playerSetup` migrate to accepted/completed `legacy` setup and are not interrupted by startup UI.

Authoring migration rules:

- Generic: use current authored generic Traveler identity.
- Authored: if the saved `profileId` still exists, reapply the current authored version of that profile.
- Custom: reapply saved `customAuthoring` to the fresh canonical `player` shell.
- Missing authored profile: preserve the saved runtime player identity as compatibility fallback, keep gameplay valid, and add a migration warning.

In all modes, current authored `player.engineFacts` (including aura), mechanics, abilities, physical state, and current authored shell remain authoritative. A profile/custom identity cannot overwrite them.

Existing ordinary-NPC authored-description migration behavior remains unchanged.

---

## 6. Non-goals

This patch does not add multiple human players, selecting an ordinary NPC as the initial protagonist, profile-specific locations/inventories/wallets/abilities/equipment/minds, profile-specific aura, portraits/classes/stats, automatic personality generation, hard belief caps, or archive deletion.
