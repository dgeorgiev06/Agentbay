# briefing.sync

## Purpose
Bring the corpus store up to date with items from every source bound to items.source/v1 that match the configured selectors, within budget.

## Inputs
- `lookback` (optional, e.g. `3d`): how far back to fill on a first, gapped or new-selector sync. Default: config `lookback`, capped by `lookbackMax`.
- `maxItems` (optional): extra per-run cap; the strictest of this, `maxItemsPerRun`, `monthlyItems` and `spendUsd` wins.
- Config `selectors`: which items to keep.

## Steps
1. `fetch`: the dispatcher runs `items.store/v1.sync` (code step, no agent).
2. The store re-tags stored items with the shared matcher if the selectors changed (no refetch).
3. The store splits each selector by the source's capability table and fetches each distinct native query, newer than its cursor; a query with a new selector backfills its lookback window.
4. The store keeps items that match a selector, tags them with `matched`, dedups by item id, drops ids deleted at the source, and updates cursors, coverage and monthly budget usage.

## Definition of Done
- [DOD-1] (must) Items are stored once per item id (`<source>:<extId>`).
- [DOD-2] (must) No budget cap is exceeded; if a cap stopped the run, `stopped` names it.
- [DOD-3] (must) `coverage` reports the window the store can actually answer for.
- [DOD-4] (should) Warnings explain any lookback the source API could not serve.
- [DOD-5] (must) Every stored item's `matched` lists exactly the configured selector ids it matches.

## Outputs
`{added, fetched, kept, billed, deleted, rematched, stopped, sources, budget, coverage, warnings?}`.

## Failure handling
- Budget cap with nothing fetched: status `blocked`, reason names the cap. Raise the cap in agentbay.config.yaml or wait for the next month.
- Source blocked (an expired login): this sync ends `blocked` with the reason and the fix; the source's cursors and items are kept and status is `stale`. A digest or ask whose refresh step is blocked goes on with the stored items and ends `partial`, the gap in its coverage (unless nothing is stored yet: then it is `blocked` too).
- Source error (rate limit, server): the step fails or warns; nothing already stored is lost (the sync is one transaction). Re-run later.
- Selector a source cannot express: `bay validate` names the field; fix the selector.
