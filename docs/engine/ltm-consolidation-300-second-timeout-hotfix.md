# AI RPG — LTM Consolidation 300-Second Timeout Hotfix

## Status

Targeted production liveness hotfix on top of the LTM semantic-preflight MVP baseline.

## Problem

Mara's two-stage LTM maintenance now completes semantic preflight correctly, but the expensive Stage 2 `mind-v3-ltm` request can still require more than the shared 180-second transport timeout when the selected historical working set remains large.

The semantic preflight remains useful and must not be removed. Tightening its recall aggressively would risk hiding existing durable memories that the consolidator needs for continuation, deduplication, or safe STM retirement.

## Change

Keep the shared OpenRouter transport timeout at 180 seconds by default.

Override only the Stage 2 Mind v3 LTM consolidation request profile:

```text
mind-v3-ltm timeout = 300000 ms (300 seconds)
```

Do not extend the timeout for ordinary gameplay decisions, LTM semantic preflight, STM consolidation, timelapse planning/reflection, narrator work, item utility requests, or other profiles without separate production evidence.

The same 300-second timeout applies to the bounded repair attempt for Stage 2 because repair reuses the same request options.

## Rationale

This is an experiment in provider/model liveness, not a replacement for semantic working-set control. It tests whether the current selected working set is processable when the provider is given more wall-clock time without making ordinary gameplay hangs last five minutes.

## Safety

Existing maintenance atomicity is unchanged. If Stage 2 still times out at 300 seconds, source STM and canonical LTM remain intact and no partial maintenance commit occurs.

## Acceptance criteria

- `mind-v3-ltm` resolves with `timeoutMs = 300000`.
- LTM semantic preflight and ordinary gameplay keep the shared 180-second default.
- The low-level global timeout default remains 180 seconds.
- Existing preflight, subtractive consolidation, no-op, fresh-evidence, retirement and stale-result behavior remains unchanged.
- Full tests and build pass.
