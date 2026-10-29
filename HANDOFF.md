# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds`. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | todo |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | todo |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | todo |
| 4 | `feature.yaml` (workflow, skills, `uses:`), whole-feature override, `bay show <mode> --resolved` | E | B-3, B-8 | todo |
| 5 | Per-feature `uses:` enforced in the use shim (security) | E | B-9 | todo |
| 6 | Contract tests: connector, source (incl. change-feed), mode; run against every instance | A | B-5 | todo |
| 7 | forge.extend rewrite: `foreach:` slices, code `check` step running B-1..B-12, DoD/rules, generated briefs; forge shared protocol; improve `boundary-crossing` detector | C, F | all | todo |

PRs: slices 1-3, 4-5 and 6-7 each make one PR, with an independent review per PR.

## Done
(none yet)

## Decisions
(none yet)

## Next
Slice 1.

## Test status
main at 07aae9e plus the proposal: 344 passed.

## Open problems
(none)
