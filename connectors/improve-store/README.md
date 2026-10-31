# improve-store (framework connector)

Implements `improve.findings/v1` for the improve mode, in env `improve-local`: storage of
`improve.finding/v1` under `.agentbay/data/improve/` with `upsert`, `annotate`, `query`, `get`, `triage`,
`decide`, `backlog`, `claim`, `handoff` and `verify`. Findings are deduplicated by fingerprint
(hash of kind and detector key).
