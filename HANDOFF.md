# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds`. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | todo |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | todo |
| 4 | `feature.yaml` (workflow, skills, `uses:`), whole-feature override, `bay show <mode> --resolved` | E | B-3, B-8 | todo |
| 5 | Per-feature `uses:` enforced in the use shim (security) | E | B-9 | todo |
| 6 | Contract tests: connector, source (incl. change-feed), mode; run against every instance | A | B-5 | todo |
| 7 | forge.extend rewrite: `foreach:` slices, code `check` step running B-1..B-12, DoD/rules, generated briefs; forge shared protocol; improve `boundary-crossing` detector | C, F | all | todo |

PRs: slices 1-3, 4-5 and 6-7 each make one PR, with an independent review per PR.

## Done
Slice 1 (7970db8, a1493ce, a2e8fa8, 048577a):
- `tests/run.py -q`: only failures (with tracebacks) and the summary line.
- `framework/components.yaml` (kernel, briefing; paths as today) + `schemas/components.schema.json`; `bay lint`
  validates it and checks every `owns:` glob matches a real path (`lint.lint_components`).
- `bay/proposal.py`: front-matter `touches:` parser. 0006 now starts with front matter listing step 1's
  crossings (slice 1 entries, and slices 2-7 marked `planned: true`).
- `bay boundary --base <ref> [--head <ref>] [--proposal <file>] [--docs] [--json]` (`bay/boundary.py`).
- `tests/test_boundary.py` (11 tests, tmp git repos).

Acceptance, PR #9 range with no proposal (`bay boundary --base b8e7512 --head 07aae9e`), exit 1:
```
README.md: core docs - core docs change only when the proposal lists them
agentbay.config.example.yaml, bay/cli.py, bay/connect.py, bay/dispatch.py, bay/lint.py,
schemas/connector.schema.json, schemas/data/email.v1.schema.json: kernel - core path (B-1)
bay/selector.py, bay/sqlsandbox.py, framework/connectors/corpus-store/{corpus_store.py,tests/test_corpus_store.py},
interfaces/items.source.v1.yaml, interfaces/items.store.v1.yaml, modes/briefing/features/sync/playbook.md: briefing - core path (B-1)
connectors/fake/{connector.yaml,fake.py}: connector fake - existing connector folder (B-2)
docs/DESIGN.md, docs/INTERFACES.md: core docs
boundary b8e7512...07aae9e: 47 changed paths (14 core, 3 docs, 22 extension, 8 other); 19 failing (B-1: 14, B-2: 2, docs: 3)
```
(new folders `modes/mail-briefing/`, `connectors/gmail-api/`, `connectors/fake-mail/`, `envs/local-mail*.yaml` pass.)
This branch against 0006: `bay boundary --base 07aae9e --proposal docs/proposals/0006-...md` → 0 failing.

## Decisions
- Classification order: other (tests/, HANDOFF.md, docs/proposals/, docs/research/, repo meta, the
  proposal) → core docs → core `owns:` (most specific glob wins, so bay/selector.py is briefing) →
  extension `at:` → unowned (fails unless listed). Core wins over a contract's `at:` (corpus-store,
  modes/briefing/, bay/adapters/ are core today).
- Extension `at:` is a list, so framework instances (framework/modes/, framework/connectors/,
  framework/envs/) are extensions of the same contracts. `framework/interfaces/` is kernel-owned (core
  interfaces); `interfaces/<name>.yaml` is the extension interface contract.
- Kernel also owns coordinator/, bay.sh, requirements.txt, agentbay.config.example.yaml,
  framework/components.yaml.
- B-3: a feature path of an existing mode passes only if a `touches:` glob matches it AND the glob's
  literal prefix reaches `<mode>/features/` (so `modes/x/` covers mode-wide files but not features;
  `modes/x/features/*/` covers all features explicitly).
- Globs: `*`/`?` within a segment, `**` across, trailing `/` = folder and everything under it.
- `touches:` entries may carry `slice:` and `planned:`; both informational, every entry counts.
- Diff is of commits only (`git diff base...head`): commit before running the check.
- B-11 (`--docs`) scans the core docs at `--head` for discovered mode, connector, env and content-type
  names (word-bounded; `git.read` is not `git`), skipping ``` and ~~~ fenced blocks. Framework instances
  count (they are extensions), so words like improve, ledger, git, forge, cos hit.
- Contract `schema:`/`tests:` paths are named in the map but not checked for existence yet
  (content-type schema and tests/contracts/ arrive in later slices); lint checks only shape and `owns:`.

## Next
Slice 2. Must know:
- **B-11 is report-only:** `bay/boundary.py` `DOCS_COUNTS = False`. Today's docs have 64 hits
  (`bay boundary --base main --docs`). Slice 2 rewrites README/DESIGN/INTERFACES to describe
  contracts only, then sets `DOCS_COUNTS = True` and updates the test
  `test_docs_check_names_instances_outside_fences_and_is_not_counted` (exit code becomes 1 on hits).
- `framework/components.yaml` has two `# moves in slice 2` marks: the adapter contract
  (`bay/adapters/<name>.py` → `adapters/`) and briefing's `interfaces/items.*` (→ `framework/interfaces/`).
  Update the map with the move; `lint_components` fails if an `owns:` glob stops matching.
- 0006's `touches:` slice-2 entries are `planned: true`; flip `planned` off as each lands.
- Run `bay boundary --base 07aae9e --proposal docs/proposals/0006-component-contracts-and-content-types.md`
  after each commit; it must stay at 0 failing.

## Test status
`python3 tests/run.py -q`: 355 passed, 0 failed (the suite takes ~2-3 min; use a long timeout).
`bay lint` clean, `bay validate` ok.

## Open problems
- B-4 (lint that core files live only under core paths) is not built; slice 2 owns it.
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
