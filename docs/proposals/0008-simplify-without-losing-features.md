---
# Approval is recorded in the ledger by `bay approve` (at the forge.extend gate), not in this file; this front matter grants nothing. Direction agreed 2026-10-29: keep every feature and safety guarantee.
touches:
  # slice 1: boundary and lint
  - { path: bay/boundary.py, reason: "root files allowed; fewer named rules; one command", slice: 1 }
  - { path: bay/lint.py, reason: "B-7 scans imports and module keys only; rules named by plain reason", slice: 1 }
  - { path: framework/components.yaml, reason: "root-file allowance (OTHER set moves here)", slice: 1 }
  - { path: framework/rules/conformance.yaml, reason: "C-4, C-8 wording follows the B-7 change", slice: 1 }
  # slice 1: dead-code check (owner addition, 2026-10-30)
  - { path: framework/interfaces/improve.detect.v1.yaml, reason: "dead-code check: new `change` endpoint (base -> new findings, count of existing)", slice: 1 }
  - { path: framework/connectors/improve-detect/, reason: "dead-code check: implements `change` (connector.yaml, improve_detect.py, README.md)", slice: 1 }
  - { path: bay/improve/pipeline.py, reason: "dead-code check: `Pipeline.change` audits the tree and the tree at base (moves with slice 6)", slice: 1 }
  - { path: framework/modes/forge/mode.yaml, reason: "dead-code check: `deadcode` code step in extend between implement and review; `improve.detect/v1` in needs", slice: 1 }
  - { path: framework/envs/local-authoring.yaml, reason: "dead-code check: binds improve.detect/v1 for forge's code steps (the lead role runs in this env); framework-dev only if the step cannot run there", slice: 1 }
  - { path: framework/modes/forge/features/extend/playbook.md, reason: "dead-code check: Definition of Done item DOD-14, no new unused code or compatibility layers", slice: 1 }
  - { path: tests/test_deadcode_check.py, reason: "NEW. dead-code check fixture test", slice: 1 }
  # slice 2: envs, agent profile, config
  - { path: envs/local-feeds-offline.yaml, reason: "deleted: offline switch lives in the env", slice: 2 }
  - { path: envs/local-mail-offline.yaml, reason: "deleted: offline switch lives in the env", slice: 2 }
  - { path: "envs/*.yaml", reason: "`offline:` block; `limits:` is the ceiling", slice: 2 }
  - { path: framework/agents/claude-code.yaml, reason: "folded into adapter.yaml", slice: 2 }
  - { path: adapters/claude-code/adapter.yaml, reason: "holds the agent profile", slice: 2 }
  - { path: bay/config.py, reason: "no `envs:` map; settings only tighten env limits; offline flag; `bay config` prints from schemas", slice: 2 }
  - { path: agentbay.config.example.yaml, reason: "deleted; build writes a minimal config", slice: 2 }
  - { path: schemas/environment.schema.json, reason: "`offline:`; no `substitutes:`", slice: 2 }
  - { path: schemas/agent.schema.json, reason: "removed with the agent file", slice: 2 }
  - { path: schemas/adapter.schema.json, reason: "adds the profile", slice: 2 }
  - { path: schemas/config.schema.json, reason: "no `envs:`; `offline:`", slice: 2 }
  - { path: connectors/x-api/README.md, reason: "rename leftover: names `local-feeds-offline` and the `envs:` line of the config", slice: 2 }
  - { path: connectors/fake/README.md, reason: "rename leftover: names the env `local-feeds-offline`", slice: 2 }
  - { path: connectors/fake-mail/README.md, reason: "rename leftover: names the env `local-mail-offline`", slice: 2 }
  - { path: connectors/fake-mail/connector.yaml, reason: "rename leftover: description names the env `local-mail-offline`", slice: 2 }
  - { path: modes/feed-briefing/README.md, reason: "rename leftover: names `local-feeds-offline`", slice: 2 }
  - { path: modes/mail-briefing/README.md, reason: "rename leftover: names `local-mail-offline`", slice: 2 }
  # slice 3: one feature shape
  - { path: bay/model.py, reason: "feature = interface + inline steps + optional playbook and rules; substitution code removed", slice: 3 }
  - { path: bay/dispatch.py, reason: "runs inline steps", slice: 3 }
  - { path: schemas/mode.schema.json, reason: "`endpoints` + `workflows` become `features` with `steps`", slice: 3 }
  - { path: bay/scaffold.py, reason: "scaffolds the single shape", slice: 3 }
  - { path: "framework/modes/forge/templates/", reason: "one feature template", slice: 3 }
  - { path: "modes/*/mode.yaml", reason: "migrated to features", slice: 3 }
  - { path: "framework/modes/*/mode.yaml", reason: "migrated to features", slice: 3 }
  - { path: bay/playbook.py, reason: "rename leftover: says `endpoints.<feature>.review`; becomes `features.<feature>.review`", slice: 3 }
  # slice 4: CLI
  - { path: bay/cli.py, reason: "25 commands to about 15; `bay improve` removed", slice: 4 }
  - { path: bay/guard.py, reason: "command names", slice: 4 }
  - { path: bay.sh, reason: "command names", slice: 4 }
  - { path: coordinator/commands/bay-status.md, reason: "rename leftover: calls the removed `bay log`; becomes `status --log -n 10`", slice: 4 }
  - { path: bay/checks.py, reason: "rename leftover: detail text `bay lint clean`", slice: 4 }
  - { path: bay/registry.py, reason: "rename leftover: comment names `bay lint`", slice: 4 }
  - { path: framework/interfaces/improve.findings.v1.yaml, reason: "rename leftover: description names `bay improve decide`", slice: 4 }
  - { path: schemas/connector.schema.json, reason: "rename leftover: two descriptions name `bay lint` and `bay validate`", slice: 4 }
  - { path: framework/connectors/scaffold/connector.yaml, reason: "rename leftover: description names `bay <kind> new`", slice: 4 }
  - { path: framework/modes/forge/README.md, reason: "rename leftover: names `bay <kind> new`", slice: 4 }
  - { path: framework/modes/forge/playbook.md, reason: "stage-2 review follow-up: the coordinator runs `git fetch origin` before forge.extend", slice: 4 }
  - { path: framework/modes/forge/features/create/playbook.md, reason: "rename leftover: `bay <kind> new`, `./bay.sh lint` and `./bay.sh validate` (the builder's cli list now has `check`)", slice: 4 }
  - { path: framework/modes/forge/features/create/rules.yaml, reason: "rename leftover: R-1 names `bay lint`", slice: 4 }
  - { path: framework/modes/forge/features/extend/rules.yaml, reason: "rename leftover: R-3 names `bay lint`", slice: 4 }
  - { path: framework/modes/cos/features/run/playbook.md, reason: "rename leftover: names `bay lint`", slice: 4 }
  - { path: framework/modes/improve/features/audit/playbook.md, reason: "rename leftover: names `bay lint`", slice: 4 }
  - { path: framework/modes/improve/features/backlog/playbook.md, reason: "rename leftover: DOD-2 names `bay improve decide`; the report prints `bay approve`", slice: 4 }
  - { path: framework/modes/improve/features/backlog/rules.yaml, reason: "rename leftover: R-3 names `bay improve decide`", slice: 4 }
  - { path: framework/modes/improve/features/implement/playbook.md, reason: "rename leftover: names `bay improve decide`", slice: 4 }
  # slice 5: 0006 step 2 and slice 4
  - { path: "content-types/", reason: "post and email content types (0006 step 2)", slice: 5 }
  - { path: "modes/*/features/*/", reason: "feature.yaml folds into the feature (0006 slice 4)", slice: 5 }
  - { path: bay/use_shim.py, reason: "per-feature `uses:` (0006 B-9)", slice: 5 }
  # slice 5: finish 0006 (owner amendment, 2026-10-30)
  - { path: bay/contenttypes.py, reason: "NEW. content-type loader: views, child tables, derive.py, mode views (0006 Part B)", slice: 5 }
  - { path: schemas/content-type.schema.json, reason: "NEW. shape of content-type.yaml; declared in framework/components.yaml", slice: 5 }
  - { path: schemas/data/post.v1.schema.json, reason: "moved to content-types/post/fields.schema.json", slice: 5 }
  - { path: schemas/data/email.v1.schema.json, reason: "moved to content-types/email/fields.schema.json", slice: 5 }
  - { path: schemas/data/item.v1.schema.json, reason: "wording: no content type named in the envelope description", slice: 5 }
  - { path: bay/sqlsandbox.py, reason: "views, tables and functions come from the content-type loader; no type named; store_meta", slice: 5 }
  - { path: bay/selector.py, reason: "addr_key moves to content-types/email/derive.py", slice: 5 }
  - { path: "framework/connectors/corpus-store/", reason: "generic child tables, derive and views for the types a mode reads; tests follow", slice: 5 }
  - { path: framework/interfaces/items.store.v1.yaml, reason: "threads, sql and describe text name no content type; threads reads the mode's v_threads", slice: 5 }
  - { path: framework/interfaces/items.source.v1.yaml, reason: "wording: no content type named", slice: 5 }
  - { path: modes/briefing/skills/corpus-sql/SKILL.md, reason: "generic text: views come from the content types a mode reads", slice: 5 }
  - { path: modes/mail-briefing/views.sql, reason: "NEW. mode-owned v_threads with needsReply (0006 Part B)", slice: 5 }
  - { path: modes/mail-briefing/views.yaml, reason: "NEW. column docs and row metadata of the mode's views", slice: 5 }
  - { path: "modes/mail-briefing/skills/", reason: "skills follow the views the mode owns", slice: 5 }
  - { path: modes/mail-briefing/config.schema.json, reason: "wording: rows are marked important, not the store", slice: 5 }
  - { path: "modes/mail-briefing/features/digest/", reason: "feature playbook and rules follow the generic threads endpoint (B-3 needs the mode named)", slice: 5 }
  - { path: "modes/mail-briefing/features/ask/", reason: "feature playbook and rules follow the mode's views (B-3 needs the mode named)", slice: 5 }
  # slice 5: core-name renames (owner decision (e), 2026-10-30)
  - { path: bay/connect.py, reason: "rename: posts cost key -> items (reads the `costPerPostUsd` source setting, now `costPerItemUsd`)", slice: 5 }
  - { path: connectors/fake/connector.yaml, reason: "rename: posts cost key -> items (`costPerPostUsd: 0` becomes `costPerItemUsd: 0`)", slice: 5 }
  - { path: modes/briefing/config.schema.json, reason: "rename: posts cost key -> items (`costPerItemUsd`; the old key is refused)", slice: 5 }
  - { path: modes/briefing/README.md, reason: "rename: posts cost key -> items (names `costPerItemUsd`)", slice: 5 }
  - { path: modes/feed-briefing/config.example.yaml, reason: "rename: posts cost key -> items (example sets `costPerItemUsd`)", slice: 5 }
  # slice 6: improve as a mode
  - { path: bay/improve/, reason: "moved out of core", slice: 6 }
  - { path: framework/modes/improve/, reason: "receives the code; `decide` and `weekly` become features", slice: 6 }
  - { path: "framework/connectors/improve-*/", reason: "receive the moved code", slice: 6 }
  # slice 7: workflows
  - { path: bay/workflows.py, reason: "one stage syntax and validator", slice: 7 }
  - { path: framework/connectors/workflow-runner/, reason: "uses the shared implementation", slice: 7 }
  - { path: framework/modes/cos/, reason: "stays a mode, on the shared implementation", slice: 7 }
  # slice 7: top-level extension folders (owner decision, 2026-10-30). Moves come last, so code moves once. Paths in
  # earlier entries that start with framework/modes/, framework/envs/ or framework/connectors/ read as modes/, envs/
  # and connectors/ once this slice has landed.
  - { path: modes/, reason: "NEW contents: framework-shipped modes (cos, forge, improve, delivery) move here from framework/modes/", slice: 7 }
  - { path: envs/, reason: "NEW contents: framework-shipped envs (cos-local, framework-dev, improve-local, local-authoring, research, workspace) move here from framework/envs/", slice: 7 }
  - { path: connectors/, reason: "NEW contents: framework-shipped connectors move here from framework/connectors/", slice: 7 }
  - { path: framework/modes/, reason: "emptied: moved to modes/", slice: 7 }
  - { path: framework/envs/, reason: "emptied: moved to envs/", slice: 7 }
  - { path: framework/connectors/, reason: "emptied: moved to connectors/", slice: 7 }
  - { path: framework/components.yaml, reason: "declares which components are protected (cos, forge, and the envs and connectors they need); contract `at:` paths lose the framework/ variants; kernel `owns:` drops the moved folders", slice: 7 }
  - { path: bay/guard.py, reason: "reads protected paths from the component map, not a fixed list", slice: 7 }
  - { path: bay/model.py, reason: "PROTECTED list removed; `protected_writes` and `_check_protected` read the map; protected names are reserved", slice: 7 }
  - { path: bay/boundary.py, reason: "classifies the top-level folders by the map; edits to protected components must be listed under `touches:`", slice: 7 }
  - { path: bay/lint.py, reason: "a user extension may not take a protected name", slice: 7 }
  # slice 8: agent run records (owner addition)
  - { path: bay/ledger.py, reason: "event types `agent.plan`, `agent.plan.done`, `agent.dispatch`; fold into runs (line 14 STEP_TYPES, line 71 fold)", slice: 8 }
  - { path: bay/dispatch.py, reason: "`step.started` (line 331) carries resolved inputs; submit of a role step refused without a recorded outcome", slice: 8 }
  - { path: bay/cli.py, reason: "`bay plan`; `bay status` and `bay show` display outcome, to-do and inputs", slice: 8 }
  - { path: bay/guard.py, reason: "every subagent may run `bay plan` and nothing else of bay", slice: 8 }
  - { path: bay/lint.py, reason: "reviewer briefs judge against the recorded outcome", slice: 8 }
  - { path: "framework/modes/improve/", reason: "weekly backlog reads the per-run figures (item 6, judging performance)", slice: 8 }
  - { path: bay/secretscan.py, reason: "reused to scrub plan text and input previews", slice: 8 }
  - { path: "framework/roles/", reason: "builder, reviewer and other briefs start with the plan step", slice: 8 }
  - { path: .agentbay/COORDINATOR.md, reason: "generated; coordinator logs every dispatch", slice: 8 }
  # slice 9: docs and release
  - { path: README.md, reason: "commands, concepts", slice: 9 }
  - { path: docs/DESIGN.md, reason: "concepts", slice: 9 }
  - { path: docs/INTERFACES.md, reason: "feature shape, env, adapter, plan events", slice: 9 }
  - { path: bay/__init__.py, reason: "version bump", slice: 9 }
  # stage 1 crossings (slice 8, agent run records): schemas
  - { path: schemas/event.schema.json, reason: "stage 1: new event types agent.plan, agent.dispatch, review.recorded (8bea32b, 1aac204, 3bb7364)", slice: 8 }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "stage 1: verdict items may cite the recorded plan (55e6ba3)", slice: 8 }
  - { path: schemas/data/session.episode.v1.schema.json, reason: "stage 1: git episodes carry the scrubbed commit subject (0916492)", slice: 8 }
  # stage 1 crossings: connectors
  - { path: framework/connectors/git/connector.yaml, reason: "stage 1: git episodes carry the scrubbed commit subject (0916492)", slice: 8 }
  - { path: framework/connectors/git/README.md, reason: "stage 1: git episodes carry the scrubbed commit subject (0916492)", slice: 8 }
  - { path: framework/connectors/git/tests/test_git_connector.py, reason: "stage 1: git episodes carry the scrubbed commit subject (0916492)", slice: 8 }
  - { path: framework/connectors/claude-transcripts/tests/test_claude_transcripts.py, reason: "stage 1: sessions read directly under a project-folder root (213a915)", slice: 8 }
  - { path: framework/connectors/scaffold/scaffold.py, reason: "stage 1: dead 'when: approved' branch and unused proposal 'approved' output removed (56a6b82); also carried from 0006 slice 7a (Part G): approved proposal skips propose (74cdeb9)", slice: 8 }
  # stage 1 crossings: forge extend playbook, Result type, interface
  - { path: framework/modes/forge/features/extend/playbook.md, reason: "stage 1: extend playbook follows the one skip rule (54203f7); also carried from 0006 slice 7a (Part G): gate passes only by a recorded approval (74cdeb9, de3d779, 3de59ab)", slice: 8 }
  - { path: framework/modes/forge/types/Result.schema.json, reason: "stage 1: Result takes protocol (54203f7)", slice: 8 }
  - { path: framework/interfaces/forge.scaffold.v1.yaml, reason: "stage 1: unused proposal 'approved' output removed (56a6b82); also carried from 0006 slice 7a (Part G): 74cdeb9, de3d779, 54203f7", slice: 8 }
  # release 0.5.0 and the kernel's ownership of the changelog
  - { path: CHANGELOG.md, reason: "release 0.5.0 (0006 slice 7a, 0008 stage 1)", slice: 8 }
  - { path: bay/__init__.py, reason: "release 0.5.0 (0006 slice 7a, 0008 stage 1)", slice: 8 }
  - { path: framework/components.yaml, reason: "slice 1 adds CHANGELOG.md to the kernel", slice: 1 }
  # carried from 0006 slice 7a (Part G)
  - { path: adapters/claude-code/claude_code.py, reason: "carried from 0006 slice 7a (Part G): adapter asks for bay approve and denies Edit of the owner's config, F-7 (008e79d, 838fbb9)", slice: 7 }
  - { path: connectors/gmail-api/connector.yaml, reason: "privacy hygiene: real company domains replaced with example domains (f06a5b2, b0df5f9); not part of 0008 or 0006", slice: 7 }
  - { path: connectors/gmail-api/README.md, reason: "privacy hygiene: real company domains replaced with example domains (f06a5b2, b0df5f9); not part of 0008 or 0006", slice: 7 }
  - { path: connectors/gmail-api/tests/test_gmail_api.py, reason: "privacy hygiene: real company domains replaced with example domains (f06a5b2, b0df5f9); not part of 0008 or 0006", slice: 7 }
  - { path: framework/interfaces/workflow.run.v1.yaml, reason: "carried from 0006 slice 7a (Part G): chat approval wording for workflow gates (838fbb9)", slice: 7 }
  - { path: modes/mail-briefing/config.example.yaml, reason: "privacy hygiene: real company domains replaced with example domains (f06a5b2, b0df5f9); not part of 0008 or 0006", slice: 7 }
  # slice 9 (owner amendment, 2026-10-31)
  - { path: schemas/, reason: "apiVersion agentbay/v3; rules and conformance schemas merge; improve.finding.v1, session.episode.v1 and selector.v1 move to the modes that own them; approvals.plan in the config schema", slice: 9 }
  - { path: framework/interfaces/, reason: "apiVersion agentbay/v3 in every interface", slice: 9 }
  - { path: bay/limits.py, reason: "the ratchet compares against the base ceilings and writes limits.yaml only with --write at release", slice: 9 }
  - { path: bay/hook.py, reason: "same-behaviour trim (one-line return) paying for the plan gate under the bay/ ceiling", slice: 9 }
  - { path: bay/protocol.py, reason: "same-behaviour trim (parse_blocks as a comprehension, last block still wins) paying for the plan gate", slice: 9 }
  - { path: modes/forge/features/extend/, reason: "the re-check, plan step and review-round wording in the extend playbook and rules (B-3 needs the mode named)", slice: 9 }
  - { path: framework/limits.yaml, reason: "the ratchet writes the lower ceilings after the removals; an exception if the plan gate needs one", slice: 9 }
  # stage 5: slices 6-7 (owner amendment, 2026-10-30)
  # bay/connect.py (connector packages, D2) is already covered by path by the slice 5 entry above.
  - { path: bay/conformance.py, reason: "NEW. moved from bay/improve/conformance.py: the conformance rules loader and checks, used by lint and by improve-detect", slice: 6 }
  - { path: bay/graph.py, reason: "NEW. moved from bay/improve/graph.py: the file and reference graph, used by artifact-graph and improve-detect", slice: 6 }
  - { path: bay/util.py, reason: "short_hash, in_window and warn move here from bay/improve/ (several connectors use them)", slice: 6 }
  - { path: schemas/conformance.schema.json, reason: "description names bay/improve/conformance.py; follows the move to bay/conformance.py", slice: 6 }
  - { path: "framework/modes/improve/features/", reason: "wording follows the moved code (slice 6); moved to modes/improve/features/ (slice 7); B-3 needs this prefix", slice: 6 }
  - { path: "framework/modes/cos/features/", reason: "moved to modes/cos/features/; B-3 needs this prefix", slice: 7 }
  - { path: schemas/components.schema.json, reason: "`protected:` block of the component map", slice: 7 }
  - { path: schemas/interface.schema.json, reason: "`ownerOnly` endpoints: only the owner's command may call them (improve decide)", slice: 7 }
---
# 0008 - Simplify without losing features

- Status: approval is recorded in the ledger by `bay approve`, not in this file; this line grants nothing. Progress is in HANDOFF.md and the slice list below.
- Decided by the owner: keep every feature and every safety guarantee; `improve` becomes a plain mode; boundaries stay enforced and their misfires are fixed; workflows get one implementation and the Chief of Staff stays a mode.
- No new features, with three exceptions added at the owner's request: item 6 (every agent run records its outcome, its to-do list and its inputs; 2026-10-29), the dead-code check in item 1 (2026-10-30) and the top-level extension folders in item 7 (2026-10-30). Otherwise, items 1 to 5 each remove a duplicate way of doing one thing.

## Problem

An independent simplicity review measured what it costs to understand and extend the kit:

| Measure | Now |
|---|---|
| Core Python in `bay/` | 10,404 lines (review: 10,348), of which `bay/improve/` is 3,281 |
| CLI commands | 25 (`bay/cli.py`, lines 661-732) |
| Concepts a newcomer must know to extend | 24 |
| Files for a new kind of source | about 30, of which 10 are core |
| Named lint and boundary rules | 36 |
| Tests | 411 |

The same idea is written down several times: an endpoint, a workflow and a feature file describe one feature; an env and its `-offline` copy describe one env. Two boundary checks misfire, so people learn to ignore them.

## What stays untouched

Every safety guarantee: secrets never reach prompts, logs or the ledger; agents reach data only through read-only use shims; effects, network allowlist, budget caps and deletions are enforced at run time; every approval gate; mandatory independent review. Each item below says which test guards it. The tests that guard them (`tests/test_boundaries.py`, `test_resolver.py`, `test_dispatch.py`, `test_lint.py`, the connector tests) must pass unchanged, except where a test names a command or file that moved.

## Items

### 1. One boundary command, fewer rules, no misfires

- **Removed:** the separate rule numbers a user has to look up (B-1 to B-8, B-11 and the "unowned" rule). Two misfires:
  - Ordinary repo-root files such as `TODO.md` fail as "unowned" (`bay/boundary.py` line 15 and the `OTHER` list at line 40; `lint_ownership` in `bay/lint.py` line 834).
  - The B-7 name check (`lint_extension_names`, `bay/lint.py` line 502) matches names in any line of `playbook.md`, `skills/` and feature files, so prose that mentions a mode or connector fails.
- **Kept:** per-PR proof. A change passes only if every core path it edits is listed under the proposal's `touches:`. Layering rules stay; no extension imports another; versions agree.
- **Change:** `bay boundary` is the one command (`bay lint` calls it). Findings say what to do in plain words, with the old id in brackets. Repo-root files and `*.md` at the root are allowed. B-7 looks only at imports and the kernel's module keys (`agentbay_connector_*`), not prose. A short list of reasons replaces 36 names; the rules themselves stay.
- **Dead-code check (the owner asked for it, 2026-10-30):** `forge.extend` runs improve's audit detectors (unused code, compatibility layers, complexity) on every change, through a normal interface call, not a kernel shortcut, and fails the change if it adds any new finding. Findings that already existed don't count. Built as:
  - **Endpoint.** `improve.detect/v1` gets a `change {base}` endpoint. It audits the working tree and the tree at `base` (exported with `git archive` into a temp dir; its code is never run). It keeps only findings of kind unused, unused-constant, compat-layer and complexity whose fingerprint is absent at `base`. It returns the new findings and the count of existing ones.
  - **Step.** `forge.extend` gets a code step `deadcode` between `implement` and `review` (`run: improve.detect/v1.change`). Any new finding blocks the call. forge lists `improve.detect/v1` in `needs:`, and `local-authoring` (the env its code steps run in) binds it, as `improve-local` does.
  - **Definition of Done.** A new item, DOD-14: no new unused code or compatibility layers.
  - **Test.** A fixture test adds an unused function and a compat alias and expects two new findings; a finding that already existed does not count.
  - **Order.** The code lives in `bay/improve/` until slice 6 moves it, so slice 1 edits it where it is.
- **Release metadata:** `CHANGELOG.md` is owned by the kernel and written by `forge.extend`'s release step. Slice 1 adds it to the kernel's `owns:` in `framework/components.yaml`.
- **Benefit:** a stray `TODO.md` or a sentence in a playbook no longer blocks a change.
- **Safety impact:** none. A test must show that an import of another connector still fails and that a core edit without `touches:` still fails (`tests/test_boundary.py`, `tests/test_contract_versions.py`).
- **Effort:** small.

### 2. Merge duplicates

| Removed | Kept | Replaced by |
|---|---|---|
| `endpoints:`, `workflows:` and feature folder as three things | the feature's interface, steps, review | one `feature` with inline `steps:`; `playbook.md` and `rules.yaml` optional (code-only features need neither) |
| `envs/local-feeds-offline.yaml`, `envs/local-mail-offline.yaml`, `substitutes:` (`bay/model.py` lines 267-282, `bay/lint.py` line 199), the `envs:` map in config | fake-source runs with no network | an `offline:` block inside each env. Lint forces `network: []` and no secrets while offline |
| `framework/agents/claude-code.yaml` | the agent profile | a section of `adapters/claude-code/adapter.yaml` |
| `agentbay.config.example.yaml` (committed, generated) | a sample to start from | `bay build` writes a minimal config; `bay config` prints every setting from the schemas |
| limits in env and again in config | caps enforced at run time | limits live in the env; config may only tighten them (lint and `bay/config.py` `caps()` refuse a higher value) |
| 25 CLI commands | every capability | about 15 (see below) |

CLI target, 15 commands: `check` (validate, lint, boundary), `build`, `clean`, `catalog` (absorbs `ls`), `describe`, `call`, `submit`, `show` (absorbs `reclaim`), `approve`, `new` (mode, feature, connector, env), `secret`, `auth`, `config`, `status` (absorbs `log`), `note` (absorbs `task new`). The old names simply go: no aliases, no compatibility code (there are no installs).

- **Benefit:** to add a feature you write one block, not three files in three places. An offline demo is one flag. Fewer commands to learn.
- **Safety impact:** none if the tests agree. An offline test must show that an env with `offline:` on cannot reach the network or a secret, and that config cannot raise a limit (`tests/test_resolver.py`, `tests/test_config_example.py`, `tests/test_dispatch.py`).
- **Effort:** large. It is spread over slices 2 to 4 because it changes schemas.

### 3. Finish proposal 0006

- **Removed:** nothing new. This item finishes what 0006 already approved: step 2 (content types: the loader, `post` and `email` moved into `content-types/`, mail-specific views into mail-briefing) and slice 4 (self-contained features).
- **Kept:** the 0006 acceptance lines, word for word (identical offline sync, describe and status output; no core file names a content type or connector; security tests unchanged).
- **Change:** slice 4 of 0006 would have added `feature.yaml`. Item 2 already makes the feature one self-contained unit, so slice 4 lands inside it and no second file is added.
- **Benefit:** a new source is one connector plus one env binding line, and no core file names `post` or `email`.
- **Safety impact:** none; the per-feature `uses:` check in `bay/use_shim.py` is the guard, with the tests 0006 names.
- **Effort:** large (this is the biggest slice).
- **Decided (2026-10-30):**
  - (a) mail-briefing's describe changes in exactly three ways, all from 0006's design: no `v_posts` (it had 0 rows), no `addr_key` in `functions` (computed fields are stored), and views ordered type views, then the mode's views, then full-text views.
  - (b) `v_threads` belongs to mail-briefing, and `items.store/v1.threads` stays at v1 as a generic reader of the mode's `v_threads`.
  - (c) With no open call, a use-shim read falls back to the role-level grant, so the security tests stay unchanged.
  - (d) The store creates tables for the content types a mode `reads:`.
  - (e) Owner decision, 2026-10-30: rename both of the last core names. The base-column descriptions in `bay/sqlsandbox.py` `ITEM_COLUMNS` become generic: no `x, fake, gmail`, `post, email` or `null for posts`; for example source is "the source that produced the item", kind is "the item's content type" and title is "subject or headline, when the content type has one". The cost and budget counter key `posts` becomes `items` everywhere (run state cost, status line, budget caps, corpus-store budget), and the config and env setting `costPerPostUsd` (constant `COST_PER_POST_USD`) becomes `costPerItemUsd` (`COST_PER_ITEM_USD`). There is no alias: the schema refuses the old key, because no installs exist (the v3 store schema comes in slice 9). These are two more documented output changes, listed in the slice 5 acceptance.

### 4. `improve` becomes a plain mode

- **Removed:** `bay/improve/` from core (3,281 lines in 10 files) and the hard-wired `bay improve` command (`decide`, `weekly`).
- **Kept:** all six features (`scan`, `audit`, `triage`, `backlog`, `implement`, `verify`), the detectors, the rule that improve never edits what it inspects, the user-only approval of backlog items, and the reviewed hand-off to forge.
- **Change:** the code moves into `framework/modes/improve/` and the connectors it already uses (`improve-store`, `improve-detect`, `artifact-graph`, `claude-transcripts`). It is called with `bay call improve.<feature>`. The weekly run is a cron line or a project workflow. `decide` becomes a feature with an approval gate. The hand-off to forge is a declared call. If something cannot be built this way, the builder stops and names the missing mode contract in the proposal's follow-up; it does not add a back door to core.
- **Benefit:** core shrinks by about a third, and improve is an example of how to write a mode.
- **Safety impact:** none if user-only approval stays a gate (`tests/test_improve.py`, `tests/test_improve_detectors.py`, `tests/test_boundaries.py`).
- **Effort:** large.
- **Decided (2026-10-30), by the owner; where these differ from the text above, they win:**
  - D1. The shared `graph` and `conformance` code stays in core as `bay/graph.py` and `bay/conformance.py`, because each has two users and one connector may not import another. `bay/improve/` is still gone, and 2,758 lines leave core.
  - D2. A connector folder may hold several modules: `bay/connect.py` lets a connector import its own siblings. This is what lets improve-detect and improve-store take their code without one 1,500-line file.
  - D4. Security decision. `improve.findings/v1.decide` becomes `ownerOnly`: only the owner's `bay approve <F-id>` in a terminal reaches it, and no workflow step may call it. This prevents an ordinary `modes/improve/mode.yaml` (or any user mode) from approving its own findings with a `run:` step, which location-based protection used to prevent. The resolver and lint refuse such a step; `schemas/interface.schema.json` gains the `ownerOnly` key. Findings about improve itself now route to a mode fix, not `forge.extend`, and `origin` for improve in `bay catalog` reads `user`.
  - D5. `decide` is not turned into a gated feature. `bay approve <F-id>` stays terminal-only, because a gate can be approved from chat and a backlog item must never be decided from chat. The missing generic "owner decision" hook is a follow-up, not a back door.

- **Removed:** the second implementation. Today the mode workflow is checked in `bay/model.py` (around lines 1105-1180) and run in `bay/dispatch.py`, while project workflows have their own validator (`bay/workflows.py`, 235 lines) and runner (`framework/connectors/workflow-runner/`, 159 lines), each re-reading `$in`, `$steps` and `when:`.
- **Kept:** project workflows in `agentbay.config.yaml`, gates, `when:` and `$steps` references. The Chief of Staff stays a mode (`cos.run`, `cos.next`, `cos.status`).
- **Change:** one stage syntax, one validator, one step runner; a project workflow is a feature whose steps are calls.
- **Benefit:** a fix to `when:` or `$steps` works everywhere.
- **Safety impact:** none; `tests/test_workflows.py` and `tests/test_dispatch.py` must pass with only name changes.
- **Effort:** medium.
- **Decided (2026-10-30), by the owner; where these differ from the text above, they win:**
  - D6. "One step runner" means one parser, one validator and one `skip`, `substitute` and `advance` rule. Two executors stay: the dispatcher runs steps inside a call, and the cursor hands back `nextCall`. Nested calls would break the guarantee that each stage keeps its own grants, effects, budget, review and gates.
  - D7. Security decision. A gate with `when:` is refused in project workflows too, as it already is in mode features. The `when` value comes from the output the coordinator passes to `cos.next`, so an agent could fabricate it and skip an approval gate; refusing it prevents that. The cost is that project workflows lose conditional gates; no shipped workflow uses one. The error names the fix.
  - D8. The reference grammar is the union of both (`!` negation, hyphens, nested paths), spelled once in code. Nothing accepted today is rejected. records its outcome, its to-do list and its inputs (added by the owner)

- **Why:** reviewers grade against a moving target, and the ledger cannot say what an agent was asked to do. During this very dispatch `bay status` showed 0 running agents, because the spawn hooks (`bay/hook.py`) are not always active.
- **Removed:** nothing. This is the one deliberate addition.
- **Kept:** every guarantee in "What stays untouched". Subagents still cannot run `bay` except the one command below.
- **Change, in four parts:**
  - **Outcome and to-do first.** A subagent's first action is `bay plan <taskId> '<json>'`: the outcome (what done looks like, restated from the step plan's definition of done) and a short to-do list, each item naming the done criterion it serves. As items finish it runs `bay plan <taskId> --done <n>`. Its final Result lists each item as done, dropped (with a reason) or blocked.
  - **Logging.** `bay plan` appends one ledger event (`agent.plan` or `agent.plan.done`) through the existing `ledger.append` (`bay/ledger.py` line 32). Text is scrubbed with `bay/secretscan.py`, size-limited, attributed to the agent's unit and accepted only for the taskId the agent was dispatched with.
  - **Inputs.** The dispatcher adds the step's resolved inputs to its existing `step.started` event (`bay/dispatch.py` line 331): the value for a small input; the sha256 and a short scrubbed preview for a large input or a file. The coordinator records every subagent dispatch (taskId, subagent, model, input refs) as an `agent.dispatch` event, so a missing spawn hook no longer hides a running agent.
  - **Visible and checked.** `bay status` and `bay show <callId|taskId>` display the outcome, to-do progress and inputs. The reviewer is briefed with the recorded outcome and to-do list. A submit for a role step with no recorded outcome is refused by the dispatcher, and lint checks that every role brief starts with the plan step.
- **Judging performance (owner addition).** The records exist so reviewers and the owner can judge agent work. Nothing new is collected; every figure below is already in the ledger or in the events above:
  - **Per run:** outcome met or not (from the review verdict and the checks); to-do items done, dropped or blocked; inputs; tokens, cost and duration (the `--usage` the coordinator submits with each step); the number of fix rounds; and whether a later review or bug reopened the work.
  - **Reviewer verdicts** cite the run's recorded outcome and to-do items, item by item.
  - **Aggregation:** one read-only view (`bay status --agents`, no new command) groups runs by role, mode, model and tier over time. `improve` already reads the ledger, so its weekly backlog reads the same figures; this stays inside improve as a plain mode.
  - **Use:** choose tiers and models per role; spot roles whose playbooks produce rework; calibrate reviewers (findings that held up against bugs that slipped past).
- **Also built in stage 1, beyond `bay plan`:**
  - `bay dispatched`: the coordinator's dispatch log, so dispatches are logged even when spawn hooks are off.
  - `bay review-record` and the `review.recorded` event (3bb7364): reviews run outside a framework step become visible to improve, but can never pass a gate.
  - Commit subjects in `session.episode/v1` (0916492): to tell fix rounds from features.
  - The claude-transcripts root fix (213a915): improve could read no sessions.
  - Stage 1 also carries slice 7a of 0006 (chat approvals, gates bound to recorded approvals), whose review fixes F-1..F-7 are included.
- **How it is kept simple:**
  - no new store: the plan is ledger events, folded by the existing `fold` (line 71);
  - no second input log: the inputs ride on `step.started`;
  - `bay note` absorbs `task new` and takes the dispatch record, so the command count rises by one (`plan`) to about 16, not more.
- **Benefit:** a reviewer and the owner can see what each agent was meant to do, what it did and what it was given, and a missing item shows up as unfinished instead of vanishing.
- **Safety impact:** `bay plan` is write-only and append-only: it cannot read state, cannot edit or delete an event, cannot change a call, approval or config, and rejects a taskId that is not the caller's. Tests must show: a secret in plan text is scrubbed; an oversize plan is cut or refused; another agent's taskId is refused; `bay plan` is the only `bay` command a subagent may run (`tests/test_boundaries.py`, `tests/test_ledger.py`, `tests/test_dispatch.py`).
- **Effort:** medium.

### 7. Top-level extension folders, protection in the map (owner decision, 2026-10-30)

- **Why:** modes, envs and connectors shipped with the kit sit under `framework/`, while a user's own sit at the top level. The same kind of thing lives in two places, and the guard finds protected paths from a fixed list in code.
- **Removed:** `framework/modes/`, `framework/envs/` and `framework/connectors/`, and the fixed protected list in code (`bay/model.py`, read by `bay/guard.py`).
- **Kept:** every guarantee in "What stays untouched". Protected parts stay writable only through `forge.extend`.
- **Change:**
  - The kit ships one top-level `modes/`, `envs/` and `connectors/` folder. Framework-shipped modes, envs and connectors move there.
  - `framework/` shrinks to roles, the agent profile, rules, interfaces and the component map.
  - Protection is declared in the component map (`framework/components.yaml`). `cos` and `forge` are protected, with the control-plane envs and connectors they need. `improve` is an ordinary mode.
  - The guard and `bay boundary` read protected paths from the map.
  - Protected names are reserved: a user extension cannot take one.
  - Changes to a protected component go through `forge.extend`. Their approval may come from chat or the terminal, like every other gate. There is no terminal-only rule.
- **Benefit:** one place to look for a mode, env or connector, and one place that says what is protected.
- **Safety impact:** none if the tests agree. Tests must show: a role without `forge.extend` cannot write a protected path read from the map; a user extension named like a protected one is refused; an edit to a protected component without `touches:` fails; approval from chat and from the terminal both pass the gate (`tests/test_boundaries.py`, `tests/test_resolver.py`, `tests/test_guard_7a.py`).
- **Effort:** medium. It is one slice, and it comes after the improve and workflow changes so each folder moves once.
- **Decided (2026-10-30), by the owner; where these differ from the text above, they win:**
  - D3. Protection covers all six framework envs and all nine framework connectors, not only the strict closure of cos and forge. The other connectors scrub secrets, redact transcripts or hold approval state, and all were protected by location, so leaving them writable would loosen a guard decision nobody asked to loosen. `improve-local` is protected but lets the improve mode use it. Improve cannot ship its own connector fixes without `forge.extend`.
  - D9. `framework-dev` names each protected instance path in `fs.write`, kept in sync by a lint. The guard rule is unchanged: a protected path is writable only if an env path is at or under it. No new env syntax.
  - Note: `delivery` is already `modes/delivery/`, and the agent profile already lives in `adapters/`, so `framework/` keeps roles, rules, interfaces and the component map.

## Steps

Each slice is sized for one builder (about 40 tool calls) and ends with `python3 tests/run.py` green and `./bay.sh lint` clean.

1. **Boundary and lint.** Item 1. Acceptance: a `TODO.md` at the root and a prose mention of a connector in a playbook both pass; a cross-connector import and an unlisted core edit both fail; `improve.detect/v1` has a `change {base}` endpoint; `forge.extend` has a `deadcode` step between `implement` and `review` that fails a change adding an unused function or a compat alias (two new findings in the fixture test) and ignores findings that already existed; its Definition of Done has DOD-14; `CHANGELOG.md` is in the kernel's `owns:`.
   - Scope also carries these stage-2 items from the stage-1 reviews:
     - (a) a hook 'spawned' record without a callId can stand in for a plan's dispatch: judge a result's taskId by the coordinator's agent.dispatch record;
     - (b) `bay status` shows finished agents as running: a step's submit closes every run dispatched to that call and step;
     - (c) the README lost its mention of schedules (cron);
     - (d) the reviewer probe gate_repro_sha.py's R5 step should catch ResolveError (test fixture only).
2. **Envs, agent profile, config.** Item 2 (offline, agent into adapter, config, limits). Acceptance: both offline env files and the committed example config are gone; the fake-source demo still runs; lint refuses an offline env with a network entry and a config that raises a limit; the dead-code check reports no new findings.
3. **One feature shape.** Item 2 (feature). Acceptance: every mode builds from `features:`; a code-only feature has no playbook and passes lint; `bay catalog` is unchanged except for ordering; the dead-code check reports no new findings.
4. **CLI.** Item 2 (commands). Renames reach every file that names an old command, so the touches above list them; the fetch line is the stage-2 review follow-up. Acceptance: `bay --help` lists about 15 commands; an old command name is an unknown command; `.agentbay/COORDINATOR.md` uses the new names; the dead-code check reports no new findings.
5. **Finish 0006.** Item 3. Built in four parts A-D (HANDOFF part 15). Acceptance: the 0006 step 2 acceptance lines, with offline sync, describe and status output identical except the allowed output changes of item 3: the three describe deltas in (a), the generic base-column descriptions in describe, and the cost key `items` (instead of `posts`) in status and run cost output. A golden test asserts each of these exactly, and everything else stays byte for byte; the dead-code check reports no new findings.
6. **Improve as a mode.** Item 4. Acceptance: `bay/improve/` is gone; `bay call improve.scan` and `improve.audit` give the same findings on the fixture data; a backlog item cannot be approved without the user; the dead-code check reports no new findings. Built in parts A-H together with slice 7 (HANDOFF part 23). Also: the improve golden baseline taken in part A is unchanged; the guard-decision matrix from part A is unchanged except where D3, D4 and D7 change it on purpose (see slice 7); the folder move (part G) is a pure `git mv`.
7. **Workflows.** Item 5. Acceptance: one stage-syntax parser in `bay/`; the workflow tests pass; `cos.run` still starts a project workflow; the dead-code check reports no new findings. Built in parts A-H together with slice 6 (HANDOFF part 23). Also: the improve golden baseline taken in part A is unchanged; the guard-decision matrix from part A is unchanged except where D3, D4 and D7 change it on purpose (D3: the protected set grows from the four folders to those plus each protected instance path; D4: `decide` becomes `ownerOnly` and improve's mode rows go from deny to pass for authoring writers; D7: a project-workflow gate with `when:` is refused); the folder move (part G) is a pure `git mv`.
   - Also carries item 7, after the workflow change: framework-shipped modes, envs and connectors move to the top-level `modes/`, `envs/` and `connectors/`. Acceptance: `framework/` holds only roles, the agent profile, rules, interfaces and the component map; protected components are declared in `framework/components.yaml` and the guard and `bay boundary` read them from it; a user extension with a protected name is refused; a write to a protected path without `forge.extend` is denied; approval of a protected change passes from chat or from the terminal; `bay catalog` is unchanged except for paths.
8. **Agent run records.** Item 6 (the owner's addition). Acceptance: a subagent can run `bay plan` and no other `bay` command; plan events are scrubbed, size-limited and refused for another taskId; `step.started` carries inputs; `bay status` lists a dispatched agent even with the spawn hook off; a role-step submit without an outcome is refused; `bay show` prints outcome, to-do progress and inputs; `bay status --agents` groups runs by role, mode, model and tier from the ledger alone; a reviewer verdict cites outcome and to-do items; improve's weekly backlog reads the same figures. Stage 1 also built, beyond `bay plan`: `bay dispatched` (dispatches are logged even when spawn hooks are off); `bay review-record` (reviews run outside a framework step become visible to improve, but can never pass a gate); commit subjects in git episodes (to tell fix rounds from features); the transcripts fix (improve could read no sessions). Stage 1 carries slice 7a of 0006 (chat approvals, gates bound to recorded approvals), whose review fixes F-1..F-7 are included. The dead-code check reports no new findings.
9. **Docs and release.** README, `docs/DESIGN.md`, `docs/INTERFACES.md`, changelog, version, schema `apiVersion` bump to `agentbay/v3` with v2 documents refused (feature shape and env changed), a scratch-repo build and clean round trip. Acceptance: all checks green with output quoted; a newcomer can follow the README from clone to first result; the dead-code check reports no new findings.
   - Also (owner decisions, 2026-10-31; plan in HANDOFF): fixes for three defects: (1) a re-run after a failed review gets a scoped re-check; a failed must item still halts, and the next call's review brief carries the previous verdict and the fix commits, re-judging only the failed items; (2) the `approved $in.f` form is refused, not a crash; (3) improve's store checks a candidate's route, effort and impact.
   - Plan gate: for a large or security-sensitive change, forge.extend runs a planning step (the `lead` role, opus) before the approval gate; the gate shows the plan with the proposal and binds the approval to both; `approvals.plan` (large | always | never, default large) in agentbay.config.yaml.
   - Cleanups that only remove code: schemas 19 -> 15, one ledger reader, the dispatcher steps through `workflows.advance`, one proposal-path rule, obsolete and duplicate tests, and the improve golden no longer reads HANDOFF.md. Anything that adds code beyond the plan gate is deferred. A `bay check --base` against a base map without `protected:` fails.

## Decisions needed

1. **apiVersion (decided: bump, v2 refused).** Item 2 changes the mode, env and config schemas, and a breaking contract change needs a bump (R-2, DOD-11). So the version goes to `agentbay/v3`, and a v2 document is refused outright, with an error naming the fix. No v2 reader and no migration code: there are no installs, and the refusal makes a stale file fail loudly instead of half-working. Not bumping would break the rule and hide the change.
2. **Weekly improve run.** Proposed: a documented cron line, with the project workflow as an option. Say if you want only one.
3. **Order of slice 5.** It is the largest. Proposed: after slice 3 so features land in their final shape; it can move earlier if you prefer.
4. **Refusal strictness (item 6).** Proposed: a role step without a recorded outcome is refused at submit, with no warning period.
5. **Name.** Proposed: `bay plan`, as you suggested.
