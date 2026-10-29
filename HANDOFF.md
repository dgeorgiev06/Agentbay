# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds`. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | done |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | B-6, B-7, C-7 done; B-8 todo |
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

Slice 2, item 0 and item 5, and item 6 README part (5b15c98, 4a595a0, fca12db, 4127fdb):
0. `adapters` is in `model.PROTECTED` again (owner decision); the claude-code adapter uses `model.PROTECTED`
   (its own copy is gone). Pinned list in tests/test_boundaries.py is `["framework", "bay", "schemas",
   "adapters"]`; new test `test_adapter_code_is_protected_when_the_project_is_the_kit`. framework-dev's
   `fs.write` gains `adapters` (it could write `bay/adapters/` before the move; without it forge.extend could
   not edit adapter code at all).
5. Every settings-taker has `config.example.yaml` (its settings body, no `<name>:` key): feed-briefing,
   mail-briefing, x-api, gmail-api, fake, fake-mail, framework improve and claude-transcripts. READMEs for
   modes briefing, feed-briefing, mail-briefing, delivery; connectors x-api, gmail-api (Gmail setup moved here),
   fake, fake-mail; framework improve, claude-transcripts. `bay/config.py`: `KERNEL_HEADER`,
   `KERNEL_WORKFLOWS`, `OFFLINE_SWITCH`, `takes_settings`, `fragment`, `example(kit)`. `bay config example
   [--stdout]` writes/prints agentbay.config.example.yaml (user extensions first, then framework, by name; envs
   offline switch from `substitutes:`). `lint.lint_self_description`: user modes/connectors need README.md;
   settings-takers need a config.example.yaml their schema accepts (`features` ignored); the example file must
   equal `config.example(kit)` ("agentbay.config.example.yaml is stale; run bay config example").
   Scaffolds write README.md (templates `framework/modes/forge/templates/{mode,connector}/README.md`).
   tests/test_config_example.py (4); helper `helpers.self_describe` for hand-written test modes.
6. (README part) README.md rewritten to contracts only (911 words): instance names only inside fenced
   examples; Settings section; `bay auth <connector>`, `bay config example`, `bay boundary` in the table;
   framework-mode commands (`bay improve ...`) are listed in that mode's README. B-11 now skips instances
   under a core `owns:` path (briefing base mode, corpus-store): they are core, not extensions.

Slice 2, item 6 (rest) and item 7 (9bd9f51, d7e728c):
6. DESIGN.md (1603 words) and INTERFACES.md describe contracts only. Instance text moved to READMEs:
   framework/modes/cos/ and forge/ (new), improve (detectors, interface/connector table, cron);
   framework/connectors/{workflow-runner,ledger,git,artifact-graph,improve-detect,improve-store}/README.md (new);
   connectors/gmail-api/README.md "How it reads" (the DESIGN mail paragraph). Word collisions reworded
   ("run log", "version control", `bay/model.py` `USER_FRAMEWORK_ENVS` for the shareable framework envs,
   `<env>: <offline env>`). B-11 now counts: the `DOCS_COUNTS` switch is removed (always on, no dead
   toggle); hit lines say the fix. `--docs` 0 hits. README.md trimmed to 858 words, setup steps kept.
7. B-4: `lint.lint_ownership` runs `git ls-files` in the kit (skipped when not a checkout) and fails every
   tracked file that is not core docs, other, under a core `owns:` or in an extension `at:` folder
   (`boundary.stray`), naming the file and the fix. The shipped kit has no stray file. Test:
   `test_ownership_lint_names_stray_tracked_files_b4`.

Slice 3, B-6, B-7 and C-7 (commits on feat/source-kinds after 313120a; see `git log`):
- B-6: modes declare `reads: [<kind>/v<N>]`, items.source connectors `produces: [<kind>/v<N>]` (schema fields
  added). `lint.lint_contract_versions` refuses an unversioned `needs:`/`implements:`/`reads:`/`produces:`, an
  unknown kind, an items.source connector without `produces:`, a non-abstract mode needing items.source/v1
  without `reads:`, a version mismatch, and a read no bound connector produces (message names forge.connect).
  Envs checked: every env the mode's `roles:` map (mode-wide and per endpoint) plus every env that
  `substitutes:` one of them. Known kinds = `schemas/data/*.schema.json` whose `allOf` refs item/v1
  (`model.item_kinds`; today post/v1, email/v1). Filled in: feed-briefing reads post/v1, mail-briefing
  email/v1; x-api, fake produce post/v1; gmail-api, fake-mail email/v1. briefing declares none. The connector
  scaffold writes a `produces:` TODO line.
- B-7: `lint.lint_extension_names`: mode files (mode.yaml, playbook.md, config.example.yaml,
  config.schema.json, features/, skills/, types/) never name a connector or another mode (extends ancestors
  excepted); connector .py/.yaml never name a mode or another connector; connector code imports no other
  connector's entry module. Word-bounded like B-11. Fixed hits: mail-briefing config example `in: Work`
  (Gmail notation table now only in connectors/gmail-api/README.md "Selectors in Gmail notation"),
  mail-briefing description "your email", mail-sql skill id example `<source>:...`, fake-mail description
  no longer names gmail-api, forge create playbook "stubbed HTTP layer".
- C-7: "content type" and "item" in the fixed vocabulary; C-4 and C-8 statements name B-7.
- `SLICES_BUILT = 3`; touches: conformance.yaml `planned` off, forge create playbook added.
- tests/test_contract_versions.py (4 tests); briefing-child fixtures in test_inheritance/test_roles now
  declare `reads: [post/v1]` (required by B-6).

## Decisions
- Classification order: other (tests/, HANDOFF.md, docs/proposals/, docs/research/, repo meta, the
  proposal) → core docs → core `owns:` (most specific glob wins, so bay/selector.py is briefing) →
  extension `at:` → unowned (fails unless listed). Core wins over a contract's `at:` (corpus-store,
  modes/briefing/, bay/adapters/ are core today).
- Extension `at:` is a list, so framework instances (framework/modes/, framework/connectors/,
  framework/envs/) are extensions of the same contracts. `framework/interfaces/` is kernel-owned (core
  interfaces); `interfaces/<name>.yaml` is the extension interface contract.
- Kernel also owns coordinator/, bay.sh, requirements.txt,
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

- (slice 2) The config example is keyed by installable mode: an abstract mode (briefing) has a README but no
  config.example.yaml; each child ships its own (feed-briefing does, though its schema is briefing's).
- (slice 2) agentbay.config.example.yaml is generated, so `bay boundary` classifies it as other (not kernel):
  adding a settings-taking extension regenerates it and must stay `touches: []` (DOD-4). Lint guarantees it
  holds no hand edits. Removed from kernel `owns:` in framework/components.yaml.
- (slice 2) README.md is required for user modes/connectors only; framework instances get one when touched
  (improve, claude-transcripts so far). Envs are files, so no README.
- (slice 2) Touches added: framework/envs/framework-dev.yaml, framework/modes/improve/,
  framework/connectors/claude-transcripts/, framework/modes/forge/templates/, bay/scaffold.py (now slice 2;
  its slice-3 planned entry merged into it). `planned` flipped off: bay/config.py,
  agentbay.config.example.yaml, README.md.

- (slice 2) B-4 checks tracked files only (an untracked scratch file is not the kit's). It reuses the boundary
  classification, so a file is "owned" exactly when `bay boundary` would classify it.
- (slice 2) Touches added: `framework/modes/*/README.md`, `framework/connectors/*/README.md`. Removed, as slice 2
  did not need them: bay/registry.py (the catalog already lists discovered extensions), `envs/*.yaml` (bindings
  name interfaces, not paths), framework/connectors/corpus-store/. `planned` off: docs/DESIGN.md,
  docs/INTERFACES.md, `modes/*/mode.yaml`.
- (slice 2) B-11 is word-bounded on dotted names, so `forge.extend`, `cos.run` in the docs do not hit; the docs
  still avoid instance endpoints where a contract sentence does the job.

- (slice 3) `reads:`/`produces:` cover item kinds only; framework modes and connectors read/produce no item
  kind and declare none. Presence is required only around items.source/v1.
- (slice 3) B-7 exemptions: README.md (documents the extension's own setup and may name what its env binds) and
  `tests/` inside an extension folder (fixtures pick concrete stand-ins, e.g. the fake connector). Core
  instances (under a core `owns:` path: briefing base mode, corpus-store) are not extensions and are not
  scanned. Framework instances may name each other (they ship and change together, only via forge.extend) but
  never a user extension. A mode may name every `extends:` ancestor, not only its direct parent.
- (slice 3) The kernel's selector matcher still accepts `label:`/`in:` spelling (tests use it); only the mode's
  own files moved to the neutral vocabulary.
- (slice 3) Claude Code skill names (folder under .claude/skills/ and SKILL.md `name:`) allow lowercase
  letters, digits and hyphens only (max 64); Claude Code adds `plugin:` itself for plugins. So B-8 must write
  `<mode>--<skill>` (same separator as role units `<role>--<mode>`), not `<mode>:<skill>`.

## Next
Slice 3, remaining: B-8, per-mode skill namespaces. Then "Slices 1-3 complete: open PR 1 for review".
- Build writes each mode's skills as `.claude/skills/<mode>--<skill>/` (':' is not valid there, see Decisions),
  rewriting the copied SKILL.md `name:`; a child's same-named skill overrides its parent's for that child only
  (`model.mode_skills` already resolves the chain, nearest first). Places: adapters/claude-code/claude_code.py
  `_skills` (~l.243) and the copy loop (~l.136), `_write_agent` "## Skills" list (~l.223); model.py role skills
  merge (`skills={**mode_skills(md), **rd.skills}`, ~l.830) and `mode_skills`; cli.py/registry.py list
  `r.skills`; step plans (grep bay/playbook.py, dispatch.py for skills) must list namespaced names. Role skills
  (framework/roles/skills, e.g. research-brief) need a namespace too (e.g. `role--<skill>` or keep as is:
  decide and record).
- mail-briefing's skills are `mail-sql`, `mail-digest` (rename workaround). Either rename to `sql`/`digest`
  (playbooks name them) or keep; pick the simpler and record it.
- Replace `lint.lint_skill_names` (global-name clash) with: lint fails on a skill a feature playbook or role
  references that does not exist in its mode chain (and on any remaining clash of namespaced names).
- Tests: two modes with the same skill name build without clobbering; feed-briefing's analyst gets briefing's
  skills, mail-briefing's analyst gets mail-briefing's. Update tests that expect bare skill folders.
- Flip `planned` off on `modes/*/skills/` (and add `adapters/`-path touches if needed: `adapters/` is a slice-2
  entry already). bay/improve/ (slice 3, planned) stays planned unless a conformance check changes.
- Then update this file: slice 3 done; Next: "Slices 1-3 complete: open PR 1 for review"; reviewer notes:
  B-7 scope decisions (framework instances, core instances, tests/ exemption) and B-6 env set (substitutes).

## Test status
`python3 tests/run.py -q`: 373 passed, 0 failed (the suite takes ~2-3 min; use a long timeout).
`bay lint` clean, `bay validate` ok, build + clean on a scratch project ok. `bay boundary --base 07aae9e
--proposal docs/proposals/0006-...md --docs`: 0 failing, 0 B-11 hits.

## Open problems
- DESIGN.md is 1603 words (target ~1.5k); further trimming would cut contract text (safety, store invariants).
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
