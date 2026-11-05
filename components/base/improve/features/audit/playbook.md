# improve.audit

## Purpose
Find slop, unused implementation, inefficiency, complexity, oversized or stale docs, compatibility layers and framework-conformance violations in the project (or the kit), each with exact evidence.

## Inputs
- `root` (optional, `project` or `kit`, default `project`): what to audit. When the project is the agentbay checkout both are the same.

## Steps
1. `detect`: the dispatcher runs `improve.detect/v1.artifacts` (code, read-only) over artifacts.read/v1 (files, text, reference graph) and the ledger: slop (filler phrases, duplicate or near-duplicate rules by 3-word shingles, comments that restate code, padded messages), unused (no AST reference from other Python code or no reference-graph edge, AND zero ledger uses in the window; scripts, tests and connector entry points are roots), inefficient (whole-store reads per query, subprocess or API calls in for-loops, oversized per-role context by token estimate), complexity (functions above `maxComplexity` decision points or `maxFunctionLines` lines), unused-constant (module-level names no Python code reads), doc-size (markdown over `docWords` words), doc-stale (links, backticked paths and `file.py` `symbol` pairs that no longer exist; `historyDocs` such as docs/proposals/ are skipped), compat-layer (comments, docstrings, identifiers and schema properties marked as a compatibility layer, with their age in releases) and every rule of framework/rules/conformance.yaml that has a deterministic check. `manual` lists the conformance rules with no check.
2. `store`: the dispatcher runs `improve.findings/v1.upsert` (code): candidates are stored (dedup by fingerprint).
3. `judge`: the analyst (conformance-audit skill) judges the project against the rules in `manual` only and returns violations with file:line evidence. An empty list is a valid answer.
4. `resolve`: the dispatcher runs `improve.detect/v1.resolve` (code); analyst findings whose files or lines do not exist, or that cite only measurements, are rejected with a reason.
5. `record`: the dispatcher runs `improve.findings/v1.upsert` (code) for the accepted findings.

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
- conformance.yaml is invalid: `bay check` reports it; fix it before auditing.
