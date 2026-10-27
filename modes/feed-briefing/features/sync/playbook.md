# feed-briefing.sync

## Purpose
Bring the local store up to date with posts from every source bound to feed.source/v1, within budget.

## Inputs
- `lookback` (optional, e.g. `3d`): how far back to fill on a first or gapped sync. Default: config `lookback`, capped by `lookbackMax`.
- `maxPosts` (optional): extra per-run cap; the strictest of this, `maxPostsPerRun`, `monthlyPosts` and `spendUsd` wins.

## Steps
1. The dispatcher runs `feed.store.sync` (code step, no agent).
2. The store asks each bound source for posts newer than its cursor (or since the lookback start).
3. The store dedups by `source:id`, drops ids deleted at the source, and updates cursors, coverage and monthly budget usage.

## Definition of Done
- [DOD-1] (must) Posts are stored once per `source:id`.
- [DOD-2] (must) No budget cap is exceeded; if a cap stopped the run, `stopped` names it.
- [DOD-3] (must) `coverage` reports the window the store can actually answer for.
- [DOD-4] (should) Warnings explain any lookback the source API could not serve.

## Outputs
`{added, fetched, stopped, sources, budget, coverage, warnings?}`.

## Failure handling
- Budget cap with nothing fetched: status `blocked`, reason names the cap. Raise the cap in agentbay.config.yaml or wait for the next month.
- Source error (auth, rate limit): the step fails or warns; nothing already stored is lost. Re-run later.
