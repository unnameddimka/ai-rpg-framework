# AI RPG — LTM Fresh-Evidence / Higher-Order Belief Contract

## Status

Mind v3 protocol-hardening follow-up.

This change addresses a production LTM-maintenance failure where a character with a large belief set returned pattern-level belief effects for almost the entire table. Those effects were structurally valid and would have changed confidence/activation, but they mostly re-counted already remembered autobiographical material as if rereading it during LTM consolidation were fresh evidence.

The fix is a model-facing semantic contract. It does not add an arbitrary higher-order belief count cap and does not move higher-order belief processing into a separate maintenance pass.

---

## 1. Problem

LTM consolidation receives current STM, existing LTM, relationships and beliefs so the model can recognize durable autobiographical patterns.

That context can tempt a model into this invalid interpretation:

```text
memory is consistent with belief
→ belief is supported again
→ emit higherOrderBeliefEffects
```

This double-counts old evidence. A previously experienced event does not become new belief evidence merely because the same autobiographical material is later read, merged or promoted into LTM.

A large belief table can therefore produce a very large but superficially valid response, wasting output tokens and repeatedly inflating confidence/activation.

---

## 2. Core invariant

> Existing STM, existing LTM, relationships and existing beliefs are context during LTM consolidation, not fresh direct belief evidence merely because they are present, retrieved, relevant or mutually consistent.

> Consistency is not new evidence.

The model must not iterate through supplied beliefs looking for beliefs that agree or disagree with supplied memories and emit effects for them.

---

## 3. Higher-order belief effects

`higherOrderBeliefEffects` is a sparse semantic channel for a genuinely new cross-memory inference created by the current LTM consolidation.

Use it only when combining multiple supplied memories reveals a pattern or implication that:

- is not contained in any constituent memory alone;
- is not merely a restatement of an existing belief;
- is not a second accounting of direct evidence that already affected beliefs during earlier processing.

The field should usually be empty.

No hard numeric cap is introduced. If a pass genuinely derives several independent higher-order inferences, all may be returned. The restriction is semantic, not numeric.

---

## 4. Existing beliefs are not evidence for themselves

The existence, wording, confidence or activation of an existing belief is psychological context.

It must never be treated as evidence supporting that same belief.

Likewise, an existing LTM that already encodes the events behind a belief does not become fresh support merely because it participates in another consolidation pass.

---

## 5. New beliefs

`beliefsToAdd` follows the same higher-order rule.

A new belief may be added when the current consolidation genuinely induces a new durable interpretation from multiple memories or a newly visible pattern.

Do not create a new belief merely by relabeling, paraphrasing or re-counting one already represented event or belief.

---

## 6. Activation

`activatedBeliefIds` is also sparse during LTM consolidation.

Include only supplied belief IDs whose salience materially shaped this specific consolidation or genuinely new inference.

Do not activate beliefs merely because:

- they were inspected;
- they appeared in context;
- they were compatible with a memory;
- the model scanned the belief table while deciding what to do.

An empty `activatedBeliefIds` array is valid and often preferable.

---

## 7. Prompt contract

The LTM system prompt must state explicitly, in substance:

```text
FRESH-EVIDENCE CONTRACT FOR BELIEFS

Existing STM, existing LTM, relationships and beliefs are context.
Their presence, retrieval, relevance or consistency is not fresh evidence.

Do not iterate through supplied beliefs looking for compatible beliefs.
Consistency is not new evidence.

Do not emit supports/contradicts/ambiguous merely because a supplied
memory agrees or disagrees with an existing belief.

higherOrderBeliefEffects is only for genuinely new cross-memory inference
and should usually be empty.
```

The payload should expose the same contract in machine-readable policy metadata so diagnostics clearly show the intended semantics of the request.

---

## 8. Remove misleading unbounded-language coupling

The LTM prompt may continue to state that genuinely required LTM writes and STM retirements are not subject to an arbitrary operation-count cap.

Do not group `higherOrderBeliefEffects` or belief activation into a sentence advertising that there are "NO arbitrary numeric limits" on those outputs. That wording can be misread as encouragement to enumerate the entire belief table.

This does not introduce a hidden cap. It simply stops framing higher-order belief output as a quantity to maximize.

---

## 9. Validation boundary

The engine continues to validate structurally that higher-order effects:

- use supplied belief IDs;
- use the canonical `{beliefId,effect,strength}` shape;
- use allowed effects;
- use bounded numeric strength;
- do not directly replace engine-owned confidence/activation.

The engine does not attempt to deterministically prove that a proposed effect is a genuinely novel semantic inference. That would require another semantic judgment pass and is outside this fix.

Therefore this invariant is deliberately prompt/contract-first.

---

## 10. Relationship to Model Output Must Have Effect

This is distinct from the project-wide no-op invariant.

A redundant LTM upsert has no effect and can be rejected deterministically.

A redundant belief `supports` effect *does* mechanically change confidence/activation, so it is not a no-op. Its defect is that it reuses consumed evidence improperly.

Therefore:

```text
Model Output Must Have Effect
```

and:

```text
Consumed/remembered evidence is not fresh evidence again
```

are complementary invariants.

---

## 11. No architecture split yet

This fix intentionally leaves higher-order belief processing inside the existing LTM consolidation response.

Do not introduce a separate higher-order-belief pass as part of this change.

If production evidence shows that the strengthened contract is still insufficient, separating higher-order belief processing into its own optional maintenance pass may be considered later.

---

## 12. Required regression coverage

Tests should verify that:

1. the LTM prompt names a fresh-evidence contract;
2. it explicitly says consistency is not new evidence;
3. it forbids scanning supplied beliefs for compatible beliefs;
4. it describes `higherOrderBeliefEffects` as sparse and usually empty;
5. it applies equivalent sparsity guidance to `activatedBeliefIds`;
6. the payload exposes the higher-order belief policy explicitly;
7. the prompt no longer advertises unbounded higher-order belief effects;
8. genuinely required LTM writes remain uncapped by the former numeric write limits;
9. canonical higher-order effect shape and engine-owned confidence/activation math remain unchanged;
10. the full project test/build suite remains green.

---

## 13. Acceptance criteria

The change is accepted when:

- rereading existing memories no longer counts as fresh direct belief evidence by contract;
- the model is explicitly told not to walk the belief table for compatibility;
- `higherOrderBeliefEffects` is framed as novel cross-memory inference and usually empty;
- activation is likewise sparse and materially salient only;
- no new arbitrary higher-order belief count cap exists;
- no separate higher-order maintenance pass is introduced yet;
- existing meaningful LTM consolidation behavior remains intact.

---

## 14. Final invariant

```text
Memory context may explain a belief without reinforcing it again.

Do not count remembered evidence twice.
Do not scan beliefs for consistency.
Use higher-order belief effects only for genuinely new cross-memory inference.
Usually return none.
```
