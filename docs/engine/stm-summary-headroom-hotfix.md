# AI RPG — STM Summary Headroom Hotfix

## Status

Production hotfix following the first post-refactor daytime timelapse run.

## Problem

A valid Mara STM consolidation repeatedly failed because the Utility model produced a detailed thematic STM summary around 2200–2850 characters while the engine enforced a 2000-character hard limit. The content was semantically valid, but the whole STM result was rejected and retried, wasting tokens and preventing downstream LTM/reconciliation for that maintenance run.

The failure was caused by an overly tight protocol bound, not by unsafe model behavior.

## Decision

Keep STM concise by prompt preference, but give it more hard headroom:

```text
STM preferred summary target: <= 2000 characters when practical
STM hard summary limit:       4000 characters
LTM hard summary limit:       2000 characters (unchanged)
```

Do not truncate model output automatically. STM summaries from 2001 through 4000 characters are accepted intact. Summaries above 4000 remain protocol errors.

## Scope

The dedicated STM maximum must be used consistently by:

- STM consolidation protocol validation;
- canonical world validation;
- current Mind v3 save migration/load validation;
- portable Mind v3 import/export validation.

LTM remains capped at 2000 characters in all of those paths.

The global generic text maximum is not changed.

## Prompt behavior

The STM consolidation prompt should continue to request concise thematic summaries and explicitly communicate both values:

- prefer <= 2000 characters when practical;
- never exceed the 4000-character hard maximum.

This preserves pressure toward compact STM without throwing away otherwise valid detailed consolidation results.

## Non-goals

This hotfix does not change:

- STM write-count limits;
- LTM limits;
- retrieval budgets;
- semantic retrieval behavior;
- belief math;
- maintenance ordering;
- automatic truncation or summarization behavior.

## Required regressions

1. A 2800-character STM proposal commits intact through normal STM consolidation.
2. Canonical world validation accepts that STM.
3. A 4001-character STM proposal is rejected.
4. A 2800-character LTM proposal remains rejected.
5. A portable Mind v3 round trip preserves a >2000 and <=4000 STM summary.
6. Current Mind v3 save migration preserves a >2000 and <=4000 STM summary.
7. Existing test suites remain green.
