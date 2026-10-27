# improve.verify

## Purpose
After a fix ships, re-run the finding's detector on newer data and close the item only if the pattern is gone.

## Inputs
- `id` (required): a finding that is `in-progress` or `fixed`.

## Steps
1. `check`: the dispatcher runs `improve.findings/v1.verify` (code): session findings are re-detected on episodes since the item went in-progress; artifact findings on the current files. Gone -> `verified`; still present -> reopened (`open`); no new episodes -> `inconclusive`.

## Definition of Done
- [DOD-1] (must) `verified` only when the same detector ran on data newer than the fix and produced no finding with the same fingerprint.
- [DOD-2] (must) A finding whose pattern is still present is reopened with a history entry.
- [DOD-3] (must) Without new data the result is `inconclusive` and the status is unchanged.

## Outputs
`VerifyOut`: `{id, result, status, newData, note?}`.

## Failure handling
- Analyst findings have no deterministic detector: the result is `inconclusive`; check by hand after the next scan.
