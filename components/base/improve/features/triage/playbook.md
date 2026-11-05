# improve.triage

## Purpose
Turn open findings into ranked, explained work: dedup, cross-lens links, root causes, preventive fixes, routes and priority.

## Inputs
- `top` (optional, default config `triageTop`, 5): how many top open findings the analyst examines.

## Steps
1. `rank`: the dispatcher runs `improve.findings/v1.triage` (code): findings are already unique by fingerprint; it links findings of different lenses that point at the same file, recomputes priority = impact x frequency / effort and returns the `top` open findings.
2. `analyze`: the analyst (pattern-analysis skill) examines each finding in `rank.top`: confirms its evidence (`evidenceChecked`), states the root cause, proposes a fix (preferring a preventive one: a deterministic check, a lint or conformance rule, a test, a clearer playbook step), a route (forge.extend for the framework, mode-fix for a user mode) and an effort 1-5.
3. `review`: the reviewer checks every annotation against the finding's evidence and the DoD and rules below.
4. `apply`: only after a passing review, the dispatcher runs `improve.findings/v1.annotate` (code) to store the annotations on findings that are still open and re-score priority.

## Definition of Done
- [DOD-1] (must) Every annotation's `evidenceChecked` refs appear in that finding's evidence.
- [DOD-2] (must) Every root cause names a mechanism (a missing check, step, input, rule or test), not a restatement of the symptom.
- [DOD-3] (must) Every proposed fix names its route (forge.extend or mode-fix) and the file or concept it changes.
- [DOD-4] (should) A category with 2 or more findings gets a preventive fix: a new check, lint or conformance rule, or a test.
- [DOD-5] (must_not) No artifact outside the improve store is changed.

## Outputs
`RecordOut`: `{annotated, missing, refused, summary}` after the apply step; links and ranking are in the rank step's result.

## Failure handling
- Review fails a must item or finds a blocker: the call ends `partial` before `apply`; nothing is stored. Re-run triage.
- An annotation names an unknown id: it is listed in `missing` and skipped.
