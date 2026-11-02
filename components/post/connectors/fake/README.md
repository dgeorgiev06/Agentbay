# fake

Offline `items.source/v1` for tests and demos: serves `post/v1` items from a JSON fixture (or a built-in
sample) with no network, no secrets and no cost. The `offline:` block of env `local-feeds` (switched on by `offline: true` in agentbay.config.yaml) binds it.

**Settings** (`connectors.fake`, all optional): `fixture` (a JSON list of `{id, handle, name, text, ageHours,
list?}`), `deleted` (ids to report deleted), `blocked` (simulate an expired login). See `config.example.yaml`.
