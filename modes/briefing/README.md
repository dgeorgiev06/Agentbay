# briefing (abstract base mode)

The base of every source briefing. It is never installed or called itself: a mode with `extends: briefing`
gets its features and overrides what differs (purpose, constraints, `configDefaults`, types, playbooks,
rules, review, roles and their envs).

**Contract:** needs `items.store/v1` and `items.source/v1` (bound in the env). Features:

| feature | does |
|---|---|
| `sync` | pull new items from every bound source into the corpus store (selectors, budget caps) |
| `digest` | themes across recent items, each grounded in stored items |
| `ask` | answer a question from stored items through read-only SQL, with citations |
| `prune` | drop items past retention, deleted at the source or matched by no selector (`schedule: daily`) |

**Settings** (`config.schema.json`, under `modes.<child>` in agentbay.config.yaml): `lookback`, `retention`,
`maxItemsPerRun`, `monthlyItems`, `spendUsd`, `costPerPostUsd` and `selectors`. A child's own config schema
only adds settings; it changes a default through `configDefaults`. Each child ships its own
`config.example.yaml`.
