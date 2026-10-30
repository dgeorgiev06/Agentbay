---
# Not approved. The owner approves at the forge.extend gate (`bay approve`). Direction agreed 2026-10-29: keep every feature and safety guarantee.
touches:
  # slice 1: boundary and lint
  - { path: bay/boundary.py, reason: "root files allowed; fewer named rules; one command", slice: 1 }
  - { path: bay/lint.py, reason: "B-7 scans imports and module keys only; rules named by plain reason", slice: 1 }
  - { path: framework/components.yaml, reason: "root-file allowance (OTHER set moves here)", slice: 1 }
  - { path: framework/rules/conformance.yaml, reason: "C-4, C-8 wording follows the B-7 change", slice: 1 }
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
  # slice 3: one feature shape
  - { path: bay/model.py, reason: "feature = interface + inline steps + optional playbook and rules; substitution code removed", slice: 3 }
  - { path: bay/dispatch.py, reason: "runs inline steps", slice: 3 }
  - { path: schemas/mode.schema.json, reason: "`endpoints` + `workflows` become `features` with `steps`", slice: 3 }
  - { path: bay/scaffold.py, reason: "scaffolds the single shape", slice: 3 }
  - { path: "framework/modes/forge/templates/", reason: "one feature template", slice: 3 }
  - { path: "modes/*/mode.yaml", reason: "migrated to features", slice: 3 }
  - { path: "framework/modes/*/mode.yaml", reason: "migrated to features", slice: 3 }
  # slice 4: CLI
  - { path: bay/cli.py, reason: "25 commands to about 15; `bay improve` removed", slice: 4 }
  - { path: bay/guard.py, reason: "command names", slice: 4 }
  - { path: bay.sh, reason: "command names", slice: 4 }
  # slice 5: 0006 step 2 and slice 4
  - { path: "content-types/", reason: "post and email content types (0006 step 2)", slice: 5 }
  - { path: "modes/*/features/*/", reason: "feature.yaml folds into the feature (0006 slice 4)", slice: 5 }
  - { path: bay/use_shim.py, reason: "per-feature `uses:` (0006 B-9)", slice: 5 }
  # slice 6: improve as a mode
  - { path: bay/improve/, reason: "moved out of core", slice: 6 }
  - { path: framework/modes/improve/, reason: "receives the code; `decide` and `weekly` become features", slice: 6 }
  - { path: "framework/connectors/improve-*/", reason: "receive the moved code", slice: 6 }
  # slice 7: workflows
  - { path: bay/workflows.py, reason: "one stage syntax and validator", slice: 7 }
  - { path: framework/connectors/workflow-runner/, reason: "uses the shared implementation", slice: 7 }
  - { path: framework/modes/cos/, reason: "stays a mode, on the shared implementation", slice: 7 }
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
---
# 0008 - Simplify without losing features

- Status: draft, for the owner's approval. Nothing is implemented.
- Decided by the owner: keep every feature and every safety guarantee; `improve` becomes a plain mode; boundaries stay enforced and their misfires are fixed; workflows get one implementation and the Chief of Staff stays a mode.
- No new features, with one exception: item 6 (every agent run records its outcome, its to-do list and its inputs) was added at the owner's request on 2026-10-29. It is the only addition. Items 1 to 5 each remove a duplicate way of doing one thing.

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

### 4. `improve` becomes a plain mode

- **Removed:** `bay/improve/` from core (3,281 lines in 10 files) and the hard-wired `bay improve` command (`decide`, `weekly`).
- **Kept:** all six features (`scan`, `audit`, `triage`, `backlog`, `implement`, `verify`), the detectors, the rule that improve never edits what it inspects, the user-only approval of backlog items, and the reviewed hand-off to forge.
- **Change:** the code moves into `framework/modes/improve/` and the connectors it already uses (`improve-store`, `improve-detect`, `artifact-graph`, `claude-transcripts`). It is called with `bay call improve.<feature>`. The weekly run is a cron line or a project workflow. `decide` becomes a feature with an approval gate. The hand-off to forge is a declared call. If something cannot be built this way, the builder stops and names the missing mode contract in the proposal's follow-up; it does not add a back door to core.
- **Benefit:** core shrinks by about a third, and improve is an example of how to write a mode.
- **Safety impact:** none if user-only approval stays a gate (`tests/test_improve.py`, `tests/test_improve_detectors.py`, `tests/test_boundaries.py`).
- **Effort:** large.

### 5. One workflow implementation

- **Removed:** the second implementation. Today the mode workflow is checked in `bay/model.py` (around lines 1105-1180) and run in `bay/dispatch.py`, while project workflows have their own validator (`bay/workflows.py`, 235 lines) and runner (`framework/connectors/workflow-runner/`, 159 lines), each re-reading `$in`, `$steps` and `when:`.
- **Kept:** project workflows in `agentbay.config.yaml`, gates, `when:` and `$steps` references. The Chief of Staff stays a mode (`cos.run`, `cos.next`, `cos.status`).
- **Change:** one stage syntax, one validator, one step runner; a project workflow is a feature whose steps are calls.
- **Benefit:** a fix to `when:` or `$steps` works everywhere.
- **Safety impact:** none; `tests/test_workflows.py` and `tests/test_dispatch.py` must pass with only name changes.
- **Effort:** medium.

### 6. Every agent run records its outcome, its to-do list and its inputs (added by the owner)

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
- **How it is kept simple:**
  - no new store: the plan is ledger events, folded by the existing `fold` (line 71);
  - no second input log: the inputs ride on `step.started`;
  - `bay note` absorbs `task new` and takes the dispatch record, so the command count rises by one (`plan`) to about 16, not more.
- **Benefit:** a reviewer and the owner can see what each agent was meant to do, what it did and what it was given, and a missing item shows up as unfinished instead of vanishing.
- **Safety impact:** `bay plan` is write-only and append-only: it cannot read state, cannot edit or delete an event, cannot change a call, approval or config, and rejects a taskId that is not the caller's. Tests must show: a secret in plan text is scrubbed; an oversize plan is cut or refused; another agent's taskId is refused; `bay plan` is the only `bay` command a subagent may run (`tests/test_boundaries.py`, `tests/test_ledger.py`, `tests/test_dispatch.py`).
- **Effort:** medium.

## Steps

Each slice is sized for one builder (about 40 tool calls) and ends with `python3 tests/run.py` green and `./bay.sh lint` clean.

1. **Boundary and lint.** Item 1. Acceptance: a `TODO.md` at the root and a prose mention of a connector in a playbook both pass; a cross-connector import and an unlisted core edit both fail.
2. **Envs, agent profile, config.** Item 2 (offline, agent into adapter, config, limits). Acceptance: both offline env files and the committed example config are gone; the fake-source demo still runs; lint refuses an offline env with a network entry and a config that raises a limit.
3. **One feature shape.** Item 2 (feature). Acceptance: every mode builds from `features:`; a code-only feature has no playbook and passes lint; `bay catalog` is unchanged except for ordering.
4. **CLI.** Item 2 (commands). Acceptance: `bay --help` lists about 15 commands; an old command name is an unknown command; `.agentbay/COORDINATOR.md` uses the new names.
5. **Finish 0006.** Item 3. Acceptance: the 0006 step 2 acceptance lines.
6. **Improve as a mode.** Item 4. Acceptance: `bay/improve/` is gone; `bay call improve.scan` and `improve.audit` give the same findings on the fixture data; a backlog item cannot be approved without the user.
7. **Workflows.** Item 5. Acceptance: one stage-syntax parser in `bay/`; the workflow tests pass; `cos.run` still starts a project workflow.
8. **Agent run records.** Item 6 (the owner's addition). Acceptance: a subagent can run `bay plan` and no other `bay` command; plan events are scrubbed, size-limited and refused for another taskId; `step.started` carries inputs; `bay status` lists a dispatched agent even with the spawn hook off; a role-step submit without an outcome is refused; `bay show` prints outcome, to-do progress and inputs; `bay status --agents` groups runs by role, mode, model and tier from the ledger alone; a reviewer verdict cites outcome and to-do items; improve's weekly backlog reads the same figures.
9. **Docs and release.** README, `docs/DESIGN.md`, `docs/INTERFACES.md`, changelog, version, schema `apiVersion` bump to `agentbay/v3` with v2 documents refused (feature shape and env changed), a scratch-repo build and clean round trip. Acceptance: all checks green with output quoted; a newcomer can follow the README from clone to first result.

## Decisions needed

1. **apiVersion (decided: bump, v2 refused).** Item 2 changes the mode, env and config schemas, and a breaking contract change needs a bump (R-2, DOD-11). So the version goes to `agentbay/v3`, and a v2 document is refused outright, with an error naming the fix. No v2 reader and no migration code: there are no installs, and the refusal makes a stale file fail loudly instead of half-working. Not bumping would break the rule and hide the change.
2. **Weekly improve run.** Proposed: a documented cron line, with the project workflow as an option. Say if you want only one.
3. **Order of slice 5.** It is the largest. Proposed: after slice 3 so features land in their final shape; it can move earlier if you prefer.
4. **Refusal strictness (item 6).** Proposed: a role step without a recorded outcome is refused at submit, with no warning period.
5. **Name.** Proposed: `bay plan`, as you suggested.
