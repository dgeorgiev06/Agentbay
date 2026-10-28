# improve.backlog

## Purpose
Write the weekly backlog report the user reviews: the top open and approved items with evidence and proposed fixes.

## Inputs
- `top` (optional, default config `backlogTop`, 10): number of items.
- `week` (optional, `YYYY-Www`): report name; default the current ISO week.

## Steps
1. `report`: the dispatcher runs `improve.findings/v1.backlog` (code) and writes `.agentbay/data/improve/reports/<isoweek>.md`: per item the title, id, lens/kind, severity, priority, status, route, pattern, measurement, up to 5 evidence refs with exact text and rewrites, root cause, proposed fix and links, plus the decide command.

## Definition of Done
- [DOD-1] (must) The report lists at most `top` items, open and approved only, ordered by priority.
- [DOD-2] (must) Every listed item shows its id, at least one evidence ref and the `bay improve decide` command.
- [DOD-3] (must_not) The report contains no secret values or transcript text (secret-scanned before writing).

## Outputs
`BacklogOut`: `{report, week, items, counts}`.

## Failure handling
- The store is corrupt: the step fails naming the file and line; fix or delete that line.
