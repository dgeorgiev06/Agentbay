# HANDOFF part 2: T-20261030-4424 (recorded with `bay plan`)

Outcome: slice 8 finished, slice-7a findings F-1..F-7 fixed with tests, improve blind spots closed.
To-do, as recorded with `bay plan` (done: 1, 2, 6, 7, 8, 9; open: 3, 4, 5, 10, 11, 12). Tests: 436 pass.
1 done F-4/F-5/F-6. 2 done submit refused without plan (`Dispatcher._require_plan`; tests/helpers.py wraps `submit` to
record dispatch+plan, `submit_strict` is the real one; tests/test_submit_needs_plan.py). 3 open: optional outcome/todo citation in
review.verdict/v1 (VERDICT in bay/dispatch.py, `_accept_review`) and the recorded plan (ledger.plans) in the review brief (`_plan`, kind review).
4 open: improve backlog reads ledger.plans and `_agent_groups` (bay/cli.py) figures. 5 PARTIAL: forge.extend skip is done and tested
(mode.yaml `propose` has `when: "!$in.proposal"`; playbook.md updated); docs still open: README, docs/INTERFACES.md, docs/DESIGN.md,
framework/modes/cos/playbook.md (cos runs `bay dispatched` before every Agent dispatch; chat approvals carry `--sha <prefix>`), role brief
template (subagents run `bay plan` first). 6 done F-1 (`--sha`). 7 done F-2 (guard `dequote`). 8 done F-3 (`_state_holds`). 9 done F-7 (adapter ask/deny).
10 open claude-transcripts connector (0 episodes with `root` set; fixture = top-level session .jsonl + subagents/). 11 open git episode subjects (scrubbed).
12 open `bay review-record <taskId> '<verdict json>'` -> review.verdict/v1 event (event type must be added to schemas/event.schema.json and ledger.TYPES).
Note: the dead `when: approved <f>` branch in Dispatcher._skip is no longer used by forge; remove it with its test when convenient.

# HANDOFF: 0008 stage 1 (slice 8, agent run records, plus dogfood bug fixes)

Task T-20261030-c91d, call C-20261030-bc7db5, step `implement`. Stands in for `bay plan` until it exists.

## Outcome (what done looks like)

Slice 8 acceptance line of docs/proposals/0008-simplify-without-losing-features.md:

- A subagent can run `bay plan` and no other `bay` command.
- Plan events are scrubbed, size-limited, append-only and refused for another taskId.
- `step.started` carries the step's inputs.
- `bay status` lists a dispatched agent even with the spawn hook off (cos logs the dispatch).
- A role-step submit without a recorded outcome is refused.
- `bay show` prints outcome, to-do progress and inputs.
- `bay status --agents` groups runs by role, mode, model and tier from the ledger alone.
- A reviewer verdict cites outcome and to-do items.
- improve's weekly backlog reads the same figures.

Dogfood bugs, each with a test:

- (a) result block `protocol:` and the step `Result` type agree.
- (b) with `approvals.chat` on, gate plan and `bay show` name the chat path.
- (c) approval binds to proposal path and sha256 even when written by the same call's propose step.
- (d) one skip rule: ledger approval of the proposal's current content skips propose and approve; front-matter marker grants nothing.
- (e) ledger approval binding for 0008's current content, if (c) makes it derivable.

Constraints: security only stricter (except `bay plan`, which only appends its own events); guard tests only added to; no new dependencies; no compat code; commit per green item; stop near 50 tool calls with this file updated.

## To-do (status: open / done / dropped(reason) / blocked(reason))

1. done. Bug (a): align `protocol:` in the subagent result block and the `Result` type. Serves bug (a).
2. done. Bug (b): gate plan and `bay show` name the chat path when `approvals.chat` is on. Serves bug (b).
3. done. Bug (c): approval binding uses propose-step output artifacts or the call input. Serves bug (c).
4. done. Bug (d): single skip rule by ledger approval; remove front-matter reliance. Serves bug (d).
5. done. `ledger`: `agent.plan` / `agent.plan.done` events, scrubbed, size-limited, taskId-checked, fold. Serves "plan events scrubbed, size-limited, refused for another taskId".
6. done. `bay plan` CLI command, append-only; guard allows it as the only `bay` command for subagents. Serves "subagent can run bay plan and no other".
7. done. `step.started` carries inputs (value, or sha256 plus preview). Serves "step.started carries inputs".
8. done. `agent.dispatch` event via cos (`bay dispatched` or equivalent) and `bay status` lists it. Serves "status lists dispatched agent with hook off".
9. open (blocked on test churn: 48 existing role-step submits in tests lack a taskId/plan; needs its own pass). Refuse role-step submit with no recorded outcome. Serves "submit refused without outcome".
10. done. `bay show` prints outcome, to-do progress, inputs. Serves "bay show prints ...".
11. done. `bay status --agents` grouping by role, mode, model, tier. Serves "status --agents".
12. open (not started; review.verdict/v1 needs optional outcome/todo citations and the review brief needs the plan). Reviewer brief and verdict cite outcome and to-do items. Serves "reviewer verdict cites ...".
13. open (not started). improve weekly backlog reads the same figures. Serves "improve's backlog reads same figures".
14. open (bug (e) already answered: NOT derivable. The 0008 gate event of this call recorded `approves: none`, because the gate then named no file; recording a binding by hand would forge the owner's approval, so it is left to followups). Docs (README, INTERFACES, DESIGN, COORDINATOR/playbooks) and bug (e) binding. Serves R-4 and bug (e).

---

# HANDOFF - proposal 0006, step 1

Branch `feat/source-kinds` (slices 1-3, PR #10); slice 7a on `feat/extend-v2`, based on PR #10's branch. The spec is `docs/proposals/0006-component-contracts-and-content-types.md`
(approved). Step 1 is built in slices. Each slice is done by a fresh builder, ends with tests green, a
commit and a push, and updates this file. This file is removed in the last slice.

## Slices

| # | Slice | Proposal parts | Boundaries | Status |
|---|---|---|---|---|
| 1 | Quiet checks + component map + `bay boundary` (+ proposal `touches:` parsing) | A, F | B-1, B-2, B-3, B-11 | done |
| 2 | Ownership by folder: `adapters/`, `framework/interfaces/`, discovery, `bay auth <connector>`, per-extension README + `config.example.yaml`, `bay config example`, config schemas that extend, docs describe contracts only | A, D | B-4, B-11 | done |
| 3 | Versioned `reads:`/`produces:`/`needs:`/`implements:`, no extension names another, per-mode skill namespaces, C-7 vocabulary | D | B-6, B-7, B-8 | done |
| 4 | `feature.yaml` (workflow, skills, `uses:`), whole-feature override, `bay show <mode> --resolved` | E | B-3, B-8 | todo |
| 5 | Per-feature `uses:` enforced in the use shim (security) | E | B-9 | todo |
| 6 | Contract tests: connector, source (incl. change-feed), mode; run against every instance | A | B-5 | todo |
| 7a | Approvals from chat (Part G, behind `approvals.chat`); forge.extend skips `propose` for a proposal marked approved, the gate only for a recorded approval of its exact content; the kit ignores its own build output | G, C | - | done |
| 7b | The new forge.extend: propose, approve, `foreach:` implement, code `check`, review, release; observable DoD/rules; generated briefs; `HANDOFF.md` protocol | C, F | all existing | todo (plan below) |
| 7c | Shared forge protocol for create/connect; improve `boundary-crossing` detector | C, F | B-1..B-3 | todo (plan below) |

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

Slice 3, B-8 (bc7634a):
- Build writes a mode's skills (own and inherited) to `.claude/skills/<mode>--<skill>/` and a role's own skills
  to `<role>--<skill>/`; the copied SKILL.md `name:` is rewritten to the folder name (`_rename_skill`). A child's
  same-named skill overrides its parent's for that child only (`model.mode_skills`, nearest first).
- `model.skill_id`, `model.role_skill_names`, `SKILL_NAME_MAX = 64`. `ResolvedMode.skills` and
  `ResolvedRole.skills` are keyed by the namespaced name; `ResolvedRole.skill_names` maps short -> namespaced
  (a role's own skill replaces the mode's same-named one for that role).
- References: subagent "## Skills" lists `` `<mode>--<skill>` (<short>) ``; step plans carry
  `skills: {short: namespaced}`; COORDINATOR.md gets a "Skills (generated)" table (skill, from, playbooks call
  it). catalog.json / `bay show` list namespaced names. Playbooks and prompts keep short names.
- mail-briefing's skills renamed back to `corpus-sql` and `digest` (they override briefing's again).
- `lint.lint_skill_names` rewritten for B-8: short name must be `[a-z0-9]+(-[a-z0-9]+)*`; namespaced name at most
  64 (message names the overshoot and the fix); no two sources build the same name; every skill a mode's
  playbooks (mode playbook + each endpoint's resolved playbook) name ("the X skill", "(X skill)") is in the
  mode chain or the skills of a role the mode maps; a role prompt's reference is the role's own or in every
  mode that maps it. `bay clean` removes the folders (manifest), build is idempotent.
- Tests: test_adapter round trip (no clobbering, override child-only, name: rewritten, idempotent rebuild,
  clean removes `.claude/skills/`), test_dispatch plan `skills`, test_lint `*_b8` (3), test_inheritance.
- Touches: `modes/*/skills/` `planned` off; bay/dispatch.py's slice-5 planned entry merged into a slice-3 one.

Slice 7a (32b4eab, 838fbb9, 8dcb8ff, 74cdeb9, 515dbfb; correction de3d779):
- 0006 Part G "Approvals from chat" (owner decision 2026-10-29); 0006 front matter `status: approved`,
  `approvedBy: user`, `date: 2026-10-29`; Part C notes the approved-proposal skip; slice-7a `touches:`.
- `bay approve <id> --via chat --quote "<msg>"` (bay/cli.py `_approval_channel`): refused unless
  `approvals: { chat: true }` (schemas/config.schema.json, `config.chat_approvals`, exactly `true`); the quote is
  mandatory; `--quote` without `--via chat` is refused; the terminal path is unchanged (TTY + "yes").
- Ledger: call gates (`Dispatcher.approve(..., quote=)`) and workflow gates (new `Dispatcher.approve_run`, which
  also writes a `step.completed` event, none existed before) record `data: {approved, by, quote}`;
  `by` is `user@chat-via-cos` or `user@tty`. workflow.run/v1.approve takes `quote`.
- Guard (bay/guard.py): every subagent (agentbay role or not) is denied `bay approve` in any spelling
  (`runs_approve`: bay, bay.sh, .agentbay/bay, bay/cli.py, `-m bay.cli`; parsed words, raw text when the command
  does not parse) and any Bash command naming `agentbay.config.yaml` or a root-level glob matching it
  (`names_config`). File-tool writes to it were already denied (NEVER_FILES). (74cdeb9 also denied a subagent
  write that turned a proposal to `status: approved`; de3d779 removed it, see Decisions.)
- forge.extend: first step `proposal` (code, `forge.scaffold/v1.proposal`, `when: $in.proposal`) reads the
  front matter; `propose` carries `when: "!$steps.proposal.approved"` (approved = status approved +
  approvedBy + date). `approve` carries `approves: $in.proposal` and no `when:` (de3d779): the dispatcher hashes
  the file itself, `bay approve` records `data.approves: {path, sha256}`, and the gate is skipped only when the
  ledger's latest dispatcher decision by `user@tty`/`user@chat-via-cos` on that path and hash is an approval
  (`Dispatcher._gate_check`). An edit while the gate waits makes `bay approve` refuse and re-plan. The plan's
  `why`/`approves` and `bay show`'s `gates` say why the gate ran or was skipped; `bay approve` prints path + sha256.
  Lint: a gate takes no `when:`; `approves:` only on a gate. The path must match `docs/proposals/<name>.md` (interface pattern; the connector also
  resolves it under docs/proposals/).
- `when:` grammar: `[!]$in.<f>`, `[!]$steps.<id>.<f>`, `stale > <age>`; role steps now take `when:`; resolve
  fails when `$steps.<id>` is not an earlier step.
- `.gitignore`: `/.claude/`, `/CLAUDE.md`.
- Docs: cos playbook "Gates from chat"; extend playbook; README, DESIGN, INTERFACES; generated CLAUDE.md.
- Tests: test_boundaries `*chat*` (4), `test_guard_denies_bay_approve_*`, `test_no_subagent_writes_agentbay_config_yaml`,
  `test_no_subagent_writes_the_ledger`, `test_chat_approval_of_a_proposal_*`; test_dispatch
  `test_extend_marker_skips_propose_but_never_the_gate`, `test_a_recorded_approval_*`, `test_an_edit_after_*`,
  `test_only_bay_approve_events_*`, `test_a_gate_takes_no_when_*`, `test_when_names_only_an_earlier_step`; test_adapter `test_building_the_kit_into_itself_*`.
  test_boundary `SLICES_BUILT` is now the set {1, 2, 3, 7}.

### Review round 1 (PR #10, independent review)
Fixed (one commit each, pushed):
- F-2 `bay auth`: LoginContext reads and stores through vault.SecretAccessor (env `secrets.allow` x connector
  `needs.secrets`), `--env` must bind the connector, lint refuses a `login:` whose needs.secrets no binding env
  allows; docstring says it limits the API, not the in-process entry. Test: the reviewer's evil connector.
- F-3 test_roles creates `interfaces/` in the kit copy; stray empty `interfaces/` removed.
- F-1 `bay boundary` diffs with `--name-status --no-renames --no-relative -z` (deletions and both sides of a move;
  independent of git config). 0006 already listed `interfaces/items.*` and `framework/interfaces/`.
- F-4 new-extension detection is casefolded against `git ls-tree` at base; lint rejects case-colliding tracked
  paths and mode/connector/adapter folders without their manifest.
- F-5 B-11 fences follow CommonMark (opening char and length); names match with re.I.
- F-6 B-7: re.I, module form, `agentbay_connector_*`/`agentbay_adapter_*` keys, only top-level `tests/` exempt,
  manifest-referenced files (entry, mode config) scanned unless core; INTERFACES states the scan is incomplete.
- F-7 B-6 flags a bound connector producing a read kind at another version (mixed versions).
- F-8 skill references: re.I and "the skill X" (prose words after "the skill" skipped unless backticked).
- F-9 docs: `adapters/` in the protected lists; skill namespaces and SKILL.md `name:` rewrite; connector `login:`
  and the `bay auth` contract (INTERFACES section 4).
- F-10 `bay boundary` ignores `planned: true`; bay/improve/graph.py listed (slice 2), schemas/ and connectors/*/
  narrowed to this PR's files; later-slice globs stay planned.
- F-11 lint fails when two envs declare `substitutes:` of the same env, naming both (`lint.lint_substitutes`).
- F-12 `schemas/adapter.schema.json` (named in the component map; touches entry added to 0006); lint checks the
  schema, `name` = folder and `module` a file inside the folder (`lint.lint_adapters`, imports nothing).
  `adapter.discover()` leaves bad entries out and reports them (build/clean print them as warnings), so a broken
  runtime cannot stop another; only the selected runtime's code is imported. sys.modules key = folder with every
  non-alphanumeric character escaped (`adapter.module_key`): claude-code and claude_code differ.
- F-13 a child config schema's `$defs` colliding with the parent's, or any top-level keyword outside
  `model.CHILD_CONFIG_KEYS`, is a resolve gap and a lint error naming it.
- F-14 `bay boundary` reads framework/components.yaml at `--base` and the proposal's touches at `--head` (git
  show); an uncommitted proposal is an error. `.github/` dropped from OTHER (unowned: fails unless listed).
- F-15 `model.skill_front_matter` (yaml, CRLF normalised); lint reports an unclosed/non-YAML/non-mapping SKILL.md
  front matter; `_rename_skill` writes `name` first, keeps other keys, and on a bad block removes the copy and
  stops the build.
All round-1 findings (F-1 to F-15) fixed.

### Review round 2 (PR #10, confirmation review)
- N-1 `bay boundary` uses head's component map only when the diff adds it (status A in base...head); then no
  new-extension pass: every changed path outside other must be in touches:. A base without a map that the change
  does not add is an error. The reviewer's backdoor (a map making `bay/<name>` an adapter folder) fails. This PR
  still passes: all 93 paths are listed.
- N-2 the map and the "is this extension new" tree are read at `git merge-base base head` (what base...head diffs
  against); the stale-fork scenario (main deletes a mode after the fork, the PR edits it) fails B-3.
- N-3 `ComponentMap.parse` raises RuntimeError on bad YAML, a non-mapping document or a non-mapping
  `components:`; the CLI prints one line.
- N-4 a skill reference ("the X skill", "the skill X", "(X skill)") counts only when X is backticked or is a skill
  the kit builds (any mode chain or role); "the right skill", "the same skill" are prose.
- N-5 a child config schema may set top-level `type`/`additionalProperties` only to the parent's value; anything
  else is a resolve gap and a lint error naming the keyword.
All round-2 findings (N-1 to N-5) fixed.

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

- (slice 3, B-8) Separator `--`, not `:` (see above). Note the open Agent Skills spec (agentskills.io) also
  forbids consecutive hyphens; Claude Code's own docs only state the character set and 64. Owner chose `--`.
- (slice 3, B-8) Role skills get the role's namespace (`researcher--research-brief`), not the mode's: written
  under the mode's they would clash with a same-named mode skill for the mode's other roles. A mode named like a
  role could still clash on a name; lint catches it ("also built from").
- (slice 3, B-8) mail-briefing skills: back to `corpus-sql`/`digest` rather than keep `mail-sql`/`mail-digest`
  (the task said `sql`/`digest`, but the pre-workaround names were `corpus-sql`/`digest`). Same churn either way
  (2 renames, 2 playbook words), but keeping the mail- names would leave mail-briefing's analyst with briefing's
  post-oriented `corpus-sql` and `digest` inherited next to its own; overriding is what B-8 is for.
- (slice 3, B-8) Abstract modes are not built, so their skills get no folder of their own; their playbooks are
  still lint-checked against their own chain.
- (slice 3, B-8) The proposal text (D.1, row B-8) still says `<mode>:<skill>`; left as approved, code follows
  the Decision above.

- (review 1) B-7 skips a manifest-referenced file that lies under a core `owns:` path (feed-briefing's config is
  briefing's schema); core is not scanned. Content types get no manifest check yet (manifest name not fixed).
- (review 1, F-14; narrowed in review 2, N-1/N-2) Bootstrap: origin/main has no framework/components.yaml (this
  PR introduces it). The boundary reads the map at the merge-base; only when the diff adds the map (status A) it
  uses the map at `--head`, gives no new-extension pass (every path outside other must be listed) and says so.
  Any other base without a map is an error. Once merged, every later change is judged by the merge-base map.
- (review 1, F-12) The adapter manifest schema lives in schemas/ like the other contracts' (components.yaml
  `adapter` now has `schema:`), rather than inline in bay/adapter.py.
- (review 2, N-5, replaces F-13's note) A child's `type`/`additionalProperties` must equal the parent's value.
- (review 1) Login secrets: the old "does not declare" check stays first (security test pins its message), then
  the SecretAccessor intersection applies.
- (7a) Chat approvals skip the "Type yes" prompt: the quoted message is the confirmation, and Claude Code's
  permission prompt for the command (never pre-approved) is the second check.
- (7a, corrected by de3d779; owner policy: a gate passes only by a recorded approval) The front-matter marker
  skips `propose` only. The `approve` gate is skipped only for a ledger approval by `bay approve` (terminal or
  chat) of this proposal path at the sha256 of its current content; any edit re-runs the gate. The latest
  decision on that exact content wins (a rejection after an approval re-runs it). The 74cdeb9 guard rule that
  denied writing `status: approved` is removed: the marker grants nothing, and no other reason to keep it was
  found (it never covered the main thread or Bash, which was the hole). The ledger is the trust root: subagents
  cannot write `.agentbay/` (guard, tested for `.agentbay/ledger/`); a main-thread Bash write to the ledger is the
  same trust as the main thread typing `bay approve --via chat` (Open problems). Gates take no `when:` at all.
  The hash is computed by the dispatcher from the project file, never taken from connector output.
- (7a) The approval lookup is a forge.scaffold/v1 endpoint (code step, dispatcherOnly interface, forge already
  needs it) plus a generic `when:` negation, rather than a forge-specific dispatcher rule.
- (7a) `names_config` denies even reads of agentbay.config.yaml by Bash (subagents can use Read); a glob counts
  only in the project root, so `ls framework/*.yaml` passes.
- (7a) local-authoring's `fs.write` still lists agentbay.config.yaml; the guard's NEVER_FILES wins for every
  subagent, so it is dead. Left as is (removing it is 7b/7c cleanup with the forge.create protocol).

## Next
- PR #10 ready to merge; then slice 4 (or 7b, if the owner keeps 7 ahead of 4-6).

### Plan: slice 7b, the new forge.extend (Part C), not built
1. Workflow (framework/modes/forge/mode.yaml `extend`):
   `proposal` (code, as 7a) → `propose` (builder; writes problem, change, `touches:`, `slices:`; skipped when
   approved) → `approve` (gate, `approves: $in.proposal`; skipped only for a recorded approval of the unchanged proposal) → `implement` (builder, `foreach: $steps.propose.slices`)
   → `check` (code) → `review` (reviewer, deep, high) → `release` (builder).
   - Slices come from the proposal: for an approved proposal, `forge.scaffold/v1.proposal` also returns its
     `slices:` front matter, so `foreach:` reads `$steps.proposal.slices` there; `propose`'s Result carries them
     otherwise (one `$a|$b` fallback).
2. Dispatcher `foreach:` (bay/dispatch.py, bay/model.py, schemas/mode.schema.json): a role step runs once per
   entry of a list from an earlier step; state keeps `{index, outputs[]}`; each run is a fresh plan (new
   taskId, no shared conversation) whose envelope names the slice and `HANDOFF.md`; the step completes when
   every entry has; `bay show` reports `slice i/n`; lint: the list ref names an earlier step.
3. `check` code step (new dispatcherOnly capability, e.g. forge.check/v1.run, bound in framework-dev's code
   env): runs, quiet, `bay boundary --base <merge-base> --proposal <p> --docs` (B-1, B-2, B-3, B-11),
   `bay lint` (B-4, B-6, B-7, B-8), `bay validate`, `tests/run.py -q`, build + clean in a scratch project.
   Output per check `{id, ok, summary}`; B-5, B-9, B-10, B-12 listed as `pending` (slices 5, 6; no compat
   detector yet) and never reported as pass. A failing check blocks review (`partial`).
4. DoD and rules (features/extend/playbook.md, rules.yaml): DOD-1..DOD-9 and R-1..R-5 exactly as Part C;
   remove the quality-word DoD and "compatibility impact" from the propose task; DOD-1/DOD-3 cite the
   `check` output.
5. Generated builder briefs: the implement plan's envelope is built from the playbook, the DoD, the
   proposal's slice section and `HANDOFF.md` (framework/roles/ or bay/playbook.py); a test renders one for a
   sample proposal (Part "Steps" acceptance: dry run of `bay call forge.extend` gives per-slice plans + brief).
6. `HANDOFF.md` protocol: implement checks the file exists after each slice (done, decisions, next, test status,
   open problems) and writes one ledger note per slice; the last slice removes it.
7. Touches: framework/modes/forge/mode.yaml, features/extend/, bay/dispatch.py, bay/model.py,
   schemas/mode.schema.json, framework/interfaces/ (check capability), framework/connectors/ (its connector),
   framework/envs/framework-dev.yaml, framework/roles/; flip their `planned`.

### Plan: slice 7c, not built
1. Shared forge protocol: the slice-and-handoff protocol and quiet checks move into
   framework/modes/forge/playbook.md; forge.create (and forge.connect once it exists) run the same `check`
   step after `fill`; create's DoD names the boundary checks.
2. improve `boundary-crossing` detector (bay/improve/, framework/modes/improve/features/audit/): runs B-1..B-3
   over git history (each merge commit against its first parent, with the proposal it names), reports a
   crossing no `touches:` covered; fixtures with a seeded crossing; never runs code from history.
3. Touches: bay/improve/, framework/modes/improve/features/audit/, framework/modes/forge/playbook.md,
   framework/modes/forge/features/create/.

## Test status
`python3 tests/run.py -q`: 416 passed, 0 failed on a clean detached checkout of de3d779 (~4 min; use a long
timeout). `bay lint` clean, `bay validate` ok. `bay boundary --base origin/main --proposal docs/proposals/0006-...md
--docs`: 103 changed paths, 0 failing, 0 B-11 hits.

## Open problems
- (7a) The chat path trusts the main thread to relay the owner's words (Part G threat note). A main-thread
  prompt injection could still type `bay approve --via chat`; Claude Code's prompt for the command is the only
  stop then. That is the documented trade-off, off by default.
- (7a) The main thread (not a subagent) can append to `.agentbay/ledger/events.jsonl` by Bash, so it could forge
  a `bay approve` event; that is no more than it can already do by running `bay approve --via chat`. Hashing or
  signing ledger events is out of scope (the ledger is append-only JSON).
- DESIGN.md is 1603 words (target ~1.5k); further trimming would cut contract text (safety, store invariants).
- The `boundary-crossing` improve detector (B-1..B-3 over history) is slice 7.
- B-8 skill-reference lint matches two prose phrasings only; a feature.yaml `skills:` list (slice 4) should
  replace the regex as the declared reference.
- Proposal 0006 D.1 / row B-8 say `<mode>:<skill>`; the owner may want the text amended to `<mode>--<skill>`.
