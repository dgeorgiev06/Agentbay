# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds`. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | partial (items 1-4 of 7 done) |
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

Slice 2, items 1-4 (e769955, 902b7bf, 7419371, 3ae26b7, 463e662):
1. Adapters: `adapters/claude-code/` (`claude_code.py` + `adapter.yaml`: name, module, class). Protocol,
   `BuildReport` and discovery in `bay/adapter.py` (`discover`, `module`, `get`); REGISTRY dict gone;
   `bay/adapters/` removed. Map's adapter contract: `at: ["adapters/<name>/"], protocol: bay/adapter.py`.
2. `items.source.v1.yaml`, `items.store.v1.yaml` moved to `framework/interfaces/` (briefing owns
   `framework/interfaces/items.*`); `interfaces/` is now empty (user interfaces only). `workflow.run` was
   already there.
3. `bay auth <connector> [--env E]`: runs the connector's declared `spec.login` (a function in its entry;
   schema field added). Kernel passes `cli.LoginContext`: `secret`/`store_secret` limited to the connector's
   `needs.secrets` (read values are `vault.remember`ed), `http` limited to its `needs.network` that the env
   allows, `open_browser`, `say`. Env = `--env` or the one env that binds the connector. TTY only, as before.
   Gmail flow is `connectors/gmail-api/gmail_api.py cli_login`. Hints now say `bay auth gmail-api`;
   mail-briefing's playbooks say "the `bay auth <connector>` command the reason names".
4. Config schemas extend: `Doc.config_files` (schema chain along `extends`, root first),
   `model.config_schema(kit, md, gaps)` merges them; redefining an inherited key is a gap and a
   `bay lint` error (`lint.lint_config_schemas`). mail-briefing's `config.schema.json` holds only `important`.
   improve's graph reads config keys from the chain.
Tests added: tests/test_auth.py (4), test_adapter discovery, gmail cli_login, two in test_inheritance.

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

- (slice 2) Tests that imported `bay.adapters` now import `bay.adapter`; `COORDINATOR_CMDS` comes from
  `module("claude-code")`. Test bodies, including the guard/security tests, are unchanged.
- (slice 2) `model.PROTECTED` stays `("framework", "bay", "schemas")` (security tests pin it), so the adapter
  code at `adapters/` is no longer inside a protected kit dir when the project is the kit (like `connectors/`
  and `modes/` already). See Open problems.
- (slice 2) `bay auth` takes the connector name (`gmail-api`), not the source id; no alias for `gmail`.
- (slice 2) Touches added to 0006 for crossings the build needed: `bay/adapter.py`, `modes/*/README.md`,
  `modes/*/config.example.yaml`, `modes/mail-briefing/` and `modes/mail-briefing/features/*/playbook.md`.
  `tests/test_boundary.py` `SLICES_BUILT = 2`: entries of later slices must stay `planned`.
- (slice 2) Envs are single files (`envs/<name>.yaml`), not folders, so "per-env README" has no place; the
  offline switch in the generated example should be derived from envs' `substitutes:` (planned, item 5).

## Next
Resume slice 2 at item 5 (items 1-4 are done and pushed; the boundary check is at 0 failing). In order:
5. Per-extension README.md + config.example.yaml. Settings-takers: modes briefing, mail-briefing (and give
   feed-briefing, delivery a README), connectors x-api, gmail-api, fake, fake-mail, framework/modes/improve,
   framework/connectors/claude-transcripts (add touches entries for the two framework folders). Move
   README "Gmail setup" to connectors/gmail-api/README.md, X setup to connectors/x-api/README.md. Plan
   for `bay config example` (bay/config.py + cli): fragment = YAML body of that extension's settings,
   indented under `modes:`/`connectors:` + `<name>:` (an all-comment fragment gets `# <name>:`); kernel header
   (secrets, workflows) as a constant in bay/config.py; `envs:` offline switch derived from envs'
   `substitutes:`. `bay config example` writes the kit's agentbay.config.example.yaml (`--stdout` prints);
   lint check `agentbay.config.example.yaml is stale; run bay config example`. The current file is the
   content to reproduce.
6. Docs describe contracts only (B-11): then `DOCS_COUNTS = True` and update
   `test_docs_check_names_instances_outside_fences_and_is_not_counted`. Note README/DESIGN/INTERFACES got
   small path fixes in items 1-3 (adapter path, items.* path, `bay auth gmail-api`).
7. B-4 lint (core files only under core `owns:`; any file neither core, extension `at:` nor "other" fails,
   naming the file and the fix). Watch: `interfaces/` is empty now; framework/ root files.
Then: flip `planned` on the remaining slice-2 touches you land (registry.py, config.py,
agentbay.config.example.yaml, README/DESIGN/INTERFACES, corpus-store, envs if touched), update this file.

## Test status
`python3 tests/run.py -q`: 363 passed, 0 failed (the suite takes ~2-3 min; use a long timeout).
`bay lint` clean, `bay validate` ok.

## Open problems
- B-4 (lint that core files live only under core paths) is not built; slice 2 item 7 owns it.
- B-11 still report-only (`DOCS_COUNTS = False`); slice 2 item 6.
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
