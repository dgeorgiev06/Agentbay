# improve.scan

## Purpose
Turn the sessions of a window into redacted episodes and find recurring failures and waste in them, with evidence.

## Inputs
- `since` (optional, default config `window`, 7d): ISO-8601 or relative; episodes that started inside the window.
- `until` (optional): end of the window.

## Steps
1. `detect`: the dispatcher runs `improve.findings/v1.scan` (code). It reads episodes from every bound session.events/v1 source (agentbay ledger, Claude Code transcripts redacted on read, git) and review verdicts, runs the deterministic session detectors (review rounds, repeated rule failures, lintable blockers, mid-run instruction changes, out-of-scope additions, slow or costly steps, retries, permission friction, interrupts, reverts and churn), writes their findings to the store (dedup by fingerprint) and prunes closed findings past `retention`.
2. `patterns`: the improve-analyst reads the detect results (and the store through its use shim) and returns only recurring patterns the detectors missed, each with evidence ids from the plan. An empty list is a valid answer.
3. `record`: the dispatcher runs `improve.findings/v1.record` (code): analyst findings whose evidence does not resolve, or session patterns with fewer than 2 episodes that are not severe, are rejected with a reason.

## Definition of Done
- [DOD-1] (must) Every finding in the store from this call cites at least one evidence ref that resolves to an episode id, file or rule.
- [DOD-2] (must) Every recurring session finding cites at least 2 distinct episodes, or has severity severe.
- [DOD-3] (must_not) No transcript text, secret or path appears in the store, the ledger or the output; episodes carry structure and metadata only.
- [DOD-4] (must) The output lists every finding id this call produced or touched in `summary`.
- [DOD-5] (should) `stats` reports per-source counts, including unknown transcript record types and bad lines.

## Outputs
`RecordOut`: `{new, merged, reopened, rejected, summary}`. The detect step's full result (window, stats, ids) is in the call state (`bay show <callId>`).

## Failure handling
- A source fails (unreadable ledger, no git): the step fails with the source named; nothing is written. Fix or unbind the source in improve-local.
- The transcript format changed: unknown record types are counted in `stats`, never fatal; update bay/improve/transcripts.py when counts grow.
