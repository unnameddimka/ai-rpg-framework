# AI RPG Framework — History, Locks, and Model Budget Update

Base implementation: `6afbfdd71d4156fb8d3d81568d344ec9a2ac2ee9`.

## Player-facing History

- Add a collapsed `History ▾` section above `Latest turn`.
- Preserve chronological HumanController and AIController presentation entries.
- Each entry stores whether it was visible to the HumanController at creation time.
- `Show invisible events` filters both the current turn and History at render time.
- History is presentation state only; AI context never consumes it.
- Runtime History is unbounded. SugarCube state keeps only a rolling 100-entry mirror for save/load restoration.
- Loading a save resets the transient runtime list from that saved mirror.

## Passage locks and keys

- A lockable exit record has one `lockId`, one canonical `locked` Boolean state, and optional `lockedReason`.
- The reciprocal exit of the same physical passage must use the same `lockId` and locked state.
- A key is an ordinary item definition with one optional `keyLockId`.
- Multiple physical passages may share a `lockId`; each passage still keeps independent locked/unlocked state.
- A true key-to-many-lock/master-key relationship is out of scope.
- `unlock` and `lock` are grounded formal actions exposed only when the actor holds a matching key.
- Both actions work from either side and synchronize only the reciprocal pair being operated.
- Locked destinations remain in ordinary `move` options. Attempting movement while locked resolves as grounded `TRANSITION_BLOCKED` failure and therefore keeps existing turn-consumption semantics.
- Keys are never consumed by lock/unlock and have no consume/fill behavior unless their own authored definition explicitly declares it.

## OpenRouter completion/reasoning budget

- Send `max_tokens: 3000`.
- Send unified OpenRouter `reasoning: { max_tokens: 1500 }`.
- Do not require provider parameter support; OpenRouter/provider routing may map or ignore unsupported controls normally.
- Treat `finish_reason: "length"` as `MODEL_OUTPUT_TRUNCATED`, including the no-content case, rather than as malformed provider output.

## Editor

- Exit editor exposes optional Lock ID, initial locked state, and locked failure text while preserving generic Blocked transitions.
- Item type editor exposes optional Key lock ID.
- Validation requires reciprocal lock consistency and validates key lock IDs.
- Beds require no special editor primitive: they use the existing authorable sublocation fields exactly like tavern tables.
