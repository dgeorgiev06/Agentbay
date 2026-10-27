# feed-briefing.prune

## Purpose
Keep the store within retention and honor deletions made at the source.

## Inputs
- `olderThan` (optional, e.g. `30d`). Default: config `retention`, else the mode's `lookbackMax`.

## Steps
1. The dispatcher runs `feed.store/v1.prune` (code step, no agent).
2. The store removes posts older than the cutoff and every post whose `source:id` is on the deleted list.

## Definition of Done
- [DOD-1] (must) No post deleted at its source remains in the store.
- [DOD-2] (must) No post older than the cutoff remains in the store.
- [DOD-3] (should) Coverage `from` is moved forward to the cutoff.

## Outputs
`{removed, remaining, deleted}`.

## Failure handling
- Corrupt store line: the step fails with file:line; fix or delete the line and re-run.
