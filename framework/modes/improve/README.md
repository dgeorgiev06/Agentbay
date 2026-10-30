# improve (framework mode)

Finds recurring failures and waste in sessions and in the code and content, with evidence, ranks them in a
weekly backlog and hands the items you approve to forge. It never edits what it inspects.

Features: `scan` (session lens), `audit` (artifact lens), `triage`, `backlog` (`schedule: weekly`),
`implement` (one approved item) and `verify`. The weekly run is scan, audit, triage, then backlog (the Chief of
Staff's playbook, or a cron line per call); `bay approve <id>` (or `--defer`, `--wontfix`) records your decision.

**Settings** (`config.schema.json`, `modes.improve`): `window`, `retention`, `backlogTop`, `triageTop`,
`thresholds`, `historyDocs`; see `config.example.yaml`.

## How it works

Its connectors run in env `improve-local` (no network, no secrets; writes only `.agentbay/data/improve/`);
its roles read through use shims.

| interface | endpoints | connector(s) |
|---|---|---|
| `session.events/v1` | `episodes {since, until}` -> `session.episode/v1[]` + stats | `ledger`, `claude-transcripts`, `git` |
| `review.verdicts/v1` | `verdicts {since, until}` | `ledger` |
| `artifacts.read/v1` | `files`, `graph`, `text` | `artifact-graph` |
| `improve.detect/v1` | `sessions`, `artifacts`, `resolve`, `recheck` | `improve-detect` |
| `improve.findings/v1` | `upsert` ... `verify` (storage) | `improve-store` |

- **scan** turns the ledger, git history and Claude Code transcripts into redacted `session.episode/v1`
  (structure and metadata only, never conversation text) and runs session detectors: review rounds, repeated
  rule failures, lintable blockers, out-of-scope work, instruction changes, slow or costly steps, retries,
  permission friction, interrupts, status questions, environment gaps, reverts.
- **audit** runs deterministic artifact detectors (slop, unused code and concepts, inefficiency, function
  complexity, doc size and stale doc references, compatibility layers and their age) and the rules in
  `framework/rules/conformance.yaml` that have a check, handing the rest to the analyst.
- **triage** ranks findings (`improve.finding/v1`) and has the analyst explain root causes; **backlog** writes
  the weekly report; you decide each item in your terminal; **implement** (on demand, behind a gate) drafts a
  forge.extend proposal or a task envelope; **verify** re-runs the detector after the fix.

Weekly, from cron:

```cron
17 8 * * 1  cd ~/code/my-repo && for f in scan audit triage; do .agentbay/bay call improve.$f '{}'; done >> .agentbay/data/improve/weekly.log 2>&1
```

The analysis steps of scan, audit and triage need an agent: the Chief of Staff finishes the calls the cron run left
pending, then runs `improve.backlog` to write the report.
