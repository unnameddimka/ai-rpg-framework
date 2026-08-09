# AI Controller Prompt: Direct Address and Active Continuation Discipline

## Goal

Strengthen the common AI-controller system prompt in two areas exposed by live multi-character
testing:

1. characters sometimes return a meaningless full no-op after being directly addressed;
2. characters sometimes begin a clear multi-step task but fail to retain the unfinished intention
   in `continuation`, causing them to lose the thread after the first atomic action.

This is a prompt-level behavioral correction. Do not change scheduler, perception, event delivery,
action execution, world-tick mechanics, or add a planning engine.

## Directly addressed speech

Speech that has already been delivered to the controlled character is something the character
perceived. Meaningful speech directly addressed to the controlled character should normally produce
an appropriate in-character reaction through dialogue, visible behavior, a formal action, or some
combination of them.

A completely empty response (`action`, `publicNarrative`, and `spokenText` all null) should normally
not be selected immediately after meaningful direct address.

Intentional silence remains valid when it makes sense because of personality, hostility, fear,
distraction, tactical reasons, refusal to engage, or another concrete situational reason. The desired
distinction is intentional in-character silence versus accidental failure to react to supplied direct
speech.

## Delivered perception is authoritative

Do not make the model independently re-evaluate whether a delivered observation was physically
perceivable. If the perception/event system supplied an observation to the character, the framework
has already decided that the character perceived it.

This is especially important for quiet or selectively delivered speech. Do not second-guess delivered
speech because of distance, posture, loudness, or room layout. The deterministic perception system
owns delivery; the model owns interpretation and reaction after delivery.

## Multi-step intention and `continuation`

When a character adopts a concrete short-term intention that cannot be completed by the single atomic
formal action available in the current response, the character should normally preserve the unfinished
purpose in `continuation`.

Example: a waitress receives money from a patron who asks for ale and chooses `move -> bar` as the
current action. Moving to the bar is only one atomic step, so the unfinished purpose should remain in
`continuation`, conceptually equivalent to "bring the patron an ale using the money they gave me."

Do not clear continuation merely because the first step was selected.

## Continuation is not an action queue

`continuation` remains nullable, model-authored, free-form, temporary, private, and semantically
uninterpreted by the framework. It records an unfinished purpose, not a mandatory sequence such as:
move, give money, take ale, return, give ale.

The model still chooses exactly one current formal action after inspecting the new canonical view and
observations on every reaction.

## Re-evaluate on every reaction

An existing continuation never compels blind execution. On each reaction the model must reconsider:

- current canonical `view`;
- currently available formal actions;
- new pending observations;
- engine-confirmed results or failures;
- character personality and priorities;
- current `continuation`.

The model may continue, change approach, revise the continuation, respond to something more urgent,
abandon the intention, or clear the continuation.

## Prefer meaningful progress over accidental no-op

If the continuation describes a still-relevant unfinished short-term intention, the current canonical
view contains an obvious available action that materially advances it, and no more important
circumstance overrides it, the model should generally prefer taking that step over returning an empty
no-op.

The model still decides the exact step itself.

## Clearing continuation

A continuation should normally be revised or cleared when its intended outcome is confirmed complete,
becomes impossible or irrelevant, is superseded by something more important, is deliberately abandoned,
or was based on a mistaken understanding.

Do not require continuation to survive forever.

## Memory versus continuation

Use `continuation` for temporary unfinished working intention. Do not add routine recent memories solely
to remember which step of an unfinished task the character is on.

A durable underlying fact may still deserve memory independently, but durable memory must not be used as
a substitute for retaining the current working intention while the task is still underway.

## No engine changes

Do not modify as part of this task:

- observation recipient calculation;
- loudness or perception rules;
- speech targeting;
- scheduler ordering;
- initiative;
- AI once-per-world-tick limits;
- action validation or execution;
- event delivery;
- movement;
- automatic retries;
- background AI execution.

Live testing showed that the relevant observations and available actions were already reaching the
models.

## Tests

Update deterministic prompt tests to verify that the common system instructions explicitly communicate:

- directly addressed delivered speech normally merits a reaction;
- deliberate in-character silence remains possible;
- delivered observations are already perceived and should not be second-guessed;
- unfinished multi-step intentions should normally persist in `continuation`;
- continuation represents purpose, not an action queue;
- an obvious available step toward an active continuation should normally be preferred to an accidental
  empty no-op;
- continuation may be revised or cleared when completed, impossible, irrelevant, superseded, or
  deliberately abandoned;
- temporary workflow tracking should use continuation rather than routine recent memory.

Do not attempt to unit-test that a probabilistic model will always obey these instructions. Test the
deterministic prompt construction and existing continuation plumbing instead.
