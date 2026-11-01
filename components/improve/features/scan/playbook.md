# improve.scan

## Purpose
Turn the sessions of a window into redacted episodes and find recurring failures and waste in them, with evidence.

## Inputs
- `since` (optional, default config `window`, 7d): ISO-8601 or relative; episodes that started inside the window.
- `until` (optional): end of the window.

## Steps
1. `detect`: the dispatcher runs `improve.detect/v1.sessions` (code, read-only). It reads episodes from every bound session.events/v1 source (agentbay ledger, Claude Code transcripts as structure only, git) and review verdicts, and runs the deterministic session detectors (review rounds, repeated rule failures, lintable blockers, mid-run instruction changes, out-of-scope additions, slow or costly steps, retries, permission friction, interrupts, repeated status questions, environment gaps, reverts and churn). It returns candidates and episode summaries.
2. `store`: the dispatcher runs `improve.findings/v1.upsert` (code): candidates are stored (dedup by fingerprint) and closed findings past `retention` are pruned.
3. `patterns`: the analyst (pattern-analysis skill) reads the episode summaries and stored findings in its plan (and more through its use shims) and returns only recurring patterns the detectors missed, each citing episode ids from the plan. An empty list is a valid answer.
4. `resolve`: the dispatcher runs `improve.detect/v1.resolve` (code): findings whose evidence does not resolve, that rely on measurements only, or session patterns with fewer than 2 episodes that are not severe, are rejected with a reason.
5. `record`: the dispatcher runs `improve.findings/v1.upsert` (code) for the accepted findings.

## Definition of Done
- [DOD-1] (must) Every finding in the store from this call cites at least one evidence ref that resolves to an episode id, file or rule.
- [DOD-2] (must) Every recurring session finding cites at least 2 distinct episodes, or has severity severe.
- [DOD-3] (must_not) No transcript text, secret or path appears in the store, the ledger or the output; episodes carry structure and metadata only.
- [DOD-4] (must) The output lists every finding id this call produced or touched in `summary`.
- [DOD-5] (should) `stats` reports per-source counts, including unknown transcript record types and bad lines.

## Outputs
`RecordOut`: `{new, merged, reopened, rejected, summary}`. The detect step's full result (window, stats, episode summaries) is in the call state (`bay show <callId>`).

## Failure handling
- A source fails (unreadable ledger, no git): the step fails with the source named; nothing is written. Fix or unbind the source in improve-local.
- The transcript format changed: unknown record types and malformed lines are counted in `stats`, never fatal; a file that cannot be read is named in `stats.errors`. Update the claude-transcripts connector's parser.py when counts grow.
