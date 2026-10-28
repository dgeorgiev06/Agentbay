# improve.verify

## Purpose
After a fix ships, re-run the finding's detector on newer data and close the item only if the pattern is gone.

## Inputs
- `id` (required): a finding that is `in-progress` or `fixed`.

## Steps
1. `finding`: the dispatcher runs `improve.findings/v1.get` (code) for the finding.
2. `recheck`: the dispatcher runs `improve.detect/v1.recheck` (code, read-only): session findings are re-detected on episodes since the item went in-progress; artifact findings on the current files.
3. `apply`: the dispatcher runs `improve.findings/v1.verify` (code): gone -> `verified`; still present -> reopened (`open`); no new data or no detector -> `inconclusive`.

## Definition of Done
- [DOD-1] (must) `verified` only when the same detector ran on data newer than the fix and produced no finding with the same fingerprint.
- [DOD-2] (must) A finding whose pattern is still present is reopened with a history entry.
- [DOD-3] (must) Without new data the result is `inconclusive` and the status is unchanged.

## Outputs
`VerifyOut`: `{id, result, status, newData, note?}`.

## Failure handling
- Analyst findings have no deterministic detector: the result is `inconclusive`; check by hand after the next scan.
