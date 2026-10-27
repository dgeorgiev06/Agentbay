# briefing.prune

## Purpose
Keep the store within retention, honor deletions made at the source, and drop items no selector matches any more.

## Inputs
- `olderThan` (optional, e.g. `30d`). Default: config `retention`, else the mode's `lookbackMax`.

## Steps
1. `prune`: the dispatcher runs `items.store/v1.prune` (code step, no agent).
2. The store re-tags items if the selectors changed, then removes items older than the cutoff, every item whose id is on the deleted list, and items matching no selector.
3. `review`: the reviewer checks the result (`removed`, `remaining`, `deleted`, `unmatched`, `cutoff`) against this Definition of Done and the rules before the call completes.

## Definition of Done
- [DOD-1] (must) No item deleted at its source remains in the store.
- [DOD-2] (must) No item older than `cutoff` remains in the store.
- [DOD-3] (should) Coverage `from` is moved forward to the cutoff.
- [DOD-4] (must) No item that matches no configured selector remains in the store.

## Outputs
`{removed, remaining, deleted, unmatched, cutoff}`.

## Failure handling
- Store file unreadable or from a newer kit: the step fails naming the file; run `bay migrate` or update agentbay.
- Review fails a must item: the call ends `partial` with the reviewer's evidence; the items already removed stay removed.
