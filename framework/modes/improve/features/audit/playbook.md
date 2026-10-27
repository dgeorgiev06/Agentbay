# improve.audit

## Purpose
Find slop, unused implementation, inefficiency and framework-conformance violations in the project (or the kit), each with exact evidence.

## Inputs
- `root` (optional, `project` or `kit`, default `project`): what to audit. When the project is the agentbay checkout both are the same.

## Steps
1. `detect`: the dispatcher runs `improve.findings/v1.audit` (code) over artifacts.read/v1 (files, text, reference graph) and the ledger: slop (filler phrases, duplicate or near-duplicate rules by 3-word shingles, comments that restate code, padded messages), unused (no reference in the AST and reference graph AND zero ledger uses in the window), inefficient (whole-store reads per query, subprocess or API calls in for-loops, oversized per-role context by token estimate) and every rule of framework/rules/conformance.yaml that has a deterministic check. Findings go to the store (dedup by fingerprint); `manual` lists the conformance rules with no check.
2. `judge`: the auditor judges the project against the rules in `manual` only and returns violations with file:line evidence. An empty list is a valid answer.
3. `record`: the dispatcher runs `improve.findings/v1.record` (code); auditor findings whose files or lines do not exist are rejected with a reason.

## Definition of Done
- [DOD-1] (must) Every artifact finding cites file:line evidence that exists, plus the exact text and a rewrite, a measurement, or the broken rule id.
- [DOD-2] (must) Every `unused` finding has 0 references in the reference graph and 0 ledger uses in the window.
- [DOD-3] (must) Every conformance finding names the id of the conformance rule it breaks.
- [DOD-4] (must_not) No file outside .agentbay/data/improve/ is created or changed.
- [DOD-5] (should) At most `maxFindingsPerDetector` findings per detector, so the backlog stays readable.

## Outputs
`RecordOut`: `{new, merged, reopened, rejected, summary}`; the detect step's stats (files, graph nodes, conformance rules checked) are in the call state.

## Failure handling
- A file cannot be parsed (syntax error, binary): it is skipped by the detectors that need to parse it.
- conformance.yaml is invalid: `bay lint` reports it; fix it before auditing.
