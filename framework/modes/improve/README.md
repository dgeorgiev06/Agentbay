# improve (framework mode)

Finds recurring failures and waste in sessions and in the code and content, with evidence, ranks them in a
weekly backlog and hands the items you approve to forge. It never edits what it inspects.

Features: `scan` (session lens), `audit` (artifact lens), `triage`, `backlog` (`schedule: weekly`),
`implement` (one approved item) and `verify`. `bay improve weekly` runs scan, audit, triage and backlog;
`bay improve decide <id> approve|defer|wontfix` records your decision.

**Settings** (`config.schema.json`, `modes.improve`): `window`, `retention`, `backlogTop`, `triageTop`,
`thresholds`, `historyDocs`; see `config.example.yaml`.
