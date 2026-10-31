---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is moved before the gate, and a file-by-file audit (Opus, all tracked files, after PR #18 merges) confirms or overturns the decisions marked [A-n] before implementation starts.
touches:
  - { path: components/, reason: "NEW top-level folder. Every mode, source connector, content type and the shared tools component move here; the move table lists each" }
  - { path: modes/, reason: "REMOVED. Its seven folders move to components/<name>/ (a rename of every file inside)" }
  - { path: connectors/, reason: "REMOVED. 3 source connectors become components; 10 become `connectors/` inside their owner" }
  - { path: content-types/, reason: "REMOVED. email and post become components/email/ and components/post/" }
  - { path: envs/, reason: "REMOVED. Each env moves into the component of the mode it binds (components/tools/ for the two shared ones)" }
  - { path: framework/interfaces/, reason: "REMOVED. Each interface moves into the component that owns it" }
  - { path: framework/components.yaml, reason: "renamed framework/kernel.yaml; keeps only what the kernel owns; the protected: lists and the briefing entry go (derived from manifests)" }
  - { path: framework/limits.yaml, reason: "top_level_folders 11 to 8, framework_folders 3 to 2, new measure component_spread" }
  - { path: framework/roles/, reason: "builder and reviewer load standards skills; the golden/ rule reads `golden/` folders, not tests/golden/ only" }
  - { path: framework/rules/conformance.yaml, reason: "C-7 vocabulary (component, internal connector); component-folder rule" }
  - { path: schemas/, reason: "apiVersion v4 in every kind; NEW component.schema.json; `protected` field on mode, connector, environment, component" }
  - { path: bay/model.py, reason: "discovery: one glob over components/ per kind; protection read from manifests; nested connectors/ and envs/ and interfaces/" }
  - { path: bay/lint.py, reason: "component-folder checks, the old-folder refusal, framework-dev fs.write sync from manifests, internal-connector placement" }
  - { path: bay/boundary.py, reason: "B-1 to B-3 at component-folder granularity; reads kernel.yaml" }
  - { path: bay/guard.py, reason: "protected paths from manifests" }
  - { path: bay/scaffold.py, reason: "scaffold targets under components/; TEMPLATES path" }
  - { path: bay/limits.py, reason: "count components/; component_spread; a base ceilings file with fewer measures" }
  - { path: bay/graph.py, reason: "data schemas and skills under components/" }
  - { path: bay/dispatch.py, reason: "a code step runs every provider bound to a list interface; `standards:*` skill group (slice 4)" }
  - { path: bay/cli.py, reason: "`bay build` writes skills as <component>--<skill>; no new command" }
  - { path: adapters/claude-code/, reason: "generated paths and the skill namespace" }
  - { path: tests/, reason: "9 test files and 3 golden files move out; layout.py goes; run.py discovers components/**/tests/" }
  - { path: README.md, reason: "layout, vocabulary, how to add a component" }
  - { path: docs/INTERFACES.md, reason: "component manifest, where interfaces live, standards.check/v1" }
  - { path: docs/DESIGN.md, reason: "one folder per component; what connector means" }
  - { path: requirements-dev.txt, reason: "NEW. ruff, mypy and stub packages, pinned; dev only" }
  - { path: HANDOFF.md, reason: "current work only" }
exceptions:
  - { measure: kit_python_lines, to: 6950, reason: "the python checker and the prose checker are new kit Python (about 350 lines); no existing line is added by the move" }
  - { measure: schemas, to: 16, reason: "schemas/component.schema.json for the one new manifest kind" }
  - { measure: tests, to: 556, reason: "slices 4 to 7 add about 20 tests for the check mechanism and two checkers; slices 1 to 3 remove the tests the move makes obsolete (tests/layout.py users, protected-list sync); the release step lowers the ceiling to the real count" }
---

# 0010: One folder per component

## Problem

The repo is laid out by kind (`modes/`, `envs/`, `connectors/`, `content-types/`, `framework/interfaces/`, `tests/`), so one component is spread over several top-level folders. I measured the places each mode needs, on the current tree, counting its own folder, its `extends` parent, the env files its roles name, the connector folders those envs bind, the interface files in its `needs:`, and the content-type folders in its `reads:`:

| Mode | Places (this count) | Top-level folders | Owner's figure |
|---|---|---|---|
| forge | 13 | 4 | 18 in 4 |
| improve | 16 | 4 | 16 in 4 |
| delivery | 7 | 3 | 8 in 4 |
| mail-briefing | 8 | 5 | 8 in 5 |
| briefing | 6 | 4 | 7 in 4 |
| cos | 4 | 4 | 4 in 4 |
| feed-briefing | 8 | 5 | 2 in 2 |

Improve, mail-briefing and cos match. Forge, delivery, briefing and feed-briefing differ; I could not reproduce them with any single rule, so the table above states its rule and the audit may re-run it [A-1]. Two other points differ from the problem statement. Connector tests are already beside their connector (8 test files under `connectors/*/tests/`); what sits in the shared `tests/` is the mode tests. And the "12 to 26 files" that test a mode are mostly kernel tests (resolver, lint, guard, dispatch, protection) that use a shipped mode as a fixture; only 9 test files dedicated to one component sit in `tests/`.

0006 said components own their contracts. The layout works against it: an interface sits in `framework/interfaces/` away from the connectors that implement it, an env sits away from its mode, and `framework/components.yaml` is a second, hand-kept description of what the folders already say.

## Decisions

Each decision is marked [A-n] where the audit should try to overturn it.

### 1. Component folder and manifest [A-2]

The repo gets one folder, `components/`, and every component is `components/<name>/`. Names are unique across kinds. The folder holds exactly one manifest, and its kind says what the component is:

| Manifest | Kind | For |
|---|---|---|
| `mode.yaml` | Mode | a mode (the file keeps its present shape) |
| `connector.yaml` | Connector | a connector that reaches outside (decision 7) |
| `content-type.yaml` | ContentType | a content type |
| `component.yaml` | Component (NEW) | everything else: `tools`, `python`, `unslop`, later languages. It has `name`, `version`, `description`, `needs`, `protected`. |

Everything a component provides is found by folder convention, not listed, because a list of what a folder contains repeats the folder and drifts (the lesson of 0006): `interfaces/*.yaml` (interfaces it owns), `envs/*.yaml`, `skills/*/SKILL.md`, `types/`, `data/`, `connectors/<name>/` (decision 7), `features/`, `templates/`, `tests/`. What it needs stays in the manifest as today: `needs:` (interfaces), `reads:` (content types), `extends:`. `bay ls` and the catalog list what a folder provides by reading it. Alternative rejected: one new `component.yaml` for every component with the old files as bodies; it doubles the files to add a connector (DOD-10) and wraps what already declares needs and produces.

`extends: briefing` still names a component. The parent must be a Mode component. A child gets the parent's features, skills, types, data and config schema by whole-feature override as in 0006 Part E, and nothing else: not its envs, interfaces or tests. Other components use a component only through what it provides: an interface name in `needs:`, a content type in `reads:`, a parent in `extends:`, an env or connector name in a binding. Lint refuses a path from one component's files into another's folder.

Skills are namespaced `<component>--<skill>` (was `<mode>--<skill>`). A feature may name a skill another component provides as `<component>:<skill>`, or `standards:*` (decision 8).

### 2. What stays shared [A-3]

`bay/`, `schemas/`, `adapters/`, `coordinator/`, `docs/`, `tests/` (kernel and cross-component tests, plus `helpers.py`, `golden_util.py`, `improve_fixtures.py`, which six connector tests import), and `framework/` with `roles/`, `rules/`, `kernel.yaml` and `limits.yaml`. Nothing else. `bay/selector.py`, `bay/sqlsandbox.py` and `bay/contenttypes.py` stay in `bay/`: the kernel imports them, so moving them under `components/briefing/` would make the kernel import a component. Their tests stay in `tests/`. Roles stay in `framework/roles/`; a component providing a role is allowed by the folder convention but none does yet.

The top-level folders become `adapters`, `bay`, `components`, `coordinator`, `docs`, `framework`, `schemas`, `tests`: 8, down from 11. Folders under `framework/` become `roles` and `rules`: 2, down from 3.

### 3. Envs [A-4]

An env lives in `envs/` of the component of the mode whose roles run in it. Shared envs live in `components/tools/envs/`. Placed:

- `cos-local` in cos; `improve-local` in improve; `framework-dev` and `local-authoring` in forge; `local-feeds` in briefing (feed-briefing inherits it); `local-mail` in mail-briefing.
- `workspace` and `research` in `tools`, which also owns the four tool-bound interfaces (`workspace.read`, `workspace.write`, `git.read`, `web.research`) and the new `standards.check/v1`.

Reason: an env is the first place a mode reaches a connector, so it belongs beside the mode, and that makes each mode's closure one top-level folder. Alternatives rejected: in the connector (a connector would name modes, which B-7 forbids, and one env binds several connectors); project-level `envs/` (leaves two shipped modes with a second top-level folder, so the target of 1 fails, and `envs/` mixes kit and user files).

Cost, stated plainly: adding a source is still one new component plus one binding line, with no `mode.yaml`, role or playbook edit (DOD-4 keeps its words), but the line is in an env file inside the mode's folder. A framework change that adds a shipped source names that env file in `touches:` instead of `touches: []`. DOD-4 in the playbook is reworded to "one new component folder plus one binding line in an env". The lint that keeps modes from naming connectors reads Environment files differently from `mode.yaml` and playbooks (kind decides, not folder).

### 4. Discovery [A-5]

The loader (`bay/model.py`) has one table: kind to manifest filename, found with `components/*/<manifest>`, plus the convention folders. `bay build`, `bay check`, the catalog, lint, `bay boundary`, the guard and scaffold all go through the loader, so none has a path list of its own.

`framework/components.yaml` is no longer a map of components; they are derived from the folders. It is renamed `framework/kernel.yaml` and keeps the kernel's `owns:` (the paths the boundary check treats as core) and nothing else. Two things go: the `briefing` entry (its folder is its ownership), and the `contracts:` block, which repeats the loader table and names three contract test files that do not exist (`tests/contracts/mode.py`, `connector.py`, `items_source.py`; only `content_type.py` does). Contract tests move to the loader: each discovered instance of a kind runs the kind's contract test.

`protected:` moves into manifests. A manifest says `protected: true` (modes, connectors, components), and an env says `protected: {}` or `protected: { modes: [improve] }` for the modes allowed to put roles there (`*` for `workspace`, `research`). The guard and `bay boundary` read it from the loader. Protected names stay reserved because component names are unique. Fail closed: a file whose manifest cannot be read is protected. A change to a `protected` field is a write to a protected path, so only `forge.extend` can lower a protection. `framework-dev`'s `fs.write` still names each protected path (D9 of 0008 is unchanged, no new syntax); lint now computes that list from the manifests and fails when they differ.

### 5. The move

The unit is a folder. Every file under a moved folder keeps its relative path, so a row stands for all of them; rows that change shape are listed one by one. Sources are the current tree.

| From | To |
|---|---|
| `modes/cos/` | `components/cos/` |
| `modes/forge/` (includes `templates/`, `types/`, `features/`) | `components/forge/` |
| `modes/improve/` (includes `data/`, `skills/`) | `components/improve/` |
| `modes/delivery/` | `components/delivery/` |
| `modes/briefing/` (includes `data/selector.v1.schema.json`) | `components/briefing/` |
| `modes/feed-briefing/` | `components/feed-briefing/` |
| `modes/mail-briefing/` | `components/mail-briefing/` |
| `connectors/gmail-api/` | `components/gmail-api/` |
| `connectors/x-api/` | `components/x-api/` |
| `connectors/claude-transcripts/` | `components/claude-transcripts/` |
| `connectors/corpus-store/` | `components/briefing/connectors/corpus-store/` |
| `connectors/improve-detect/` | `components/improve/connectors/improve-detect/` |
| `connectors/improve-store/` | `components/improve/connectors/improve-store/` |
| `connectors/ledger/` | `components/improve/connectors/ledger/` |
| `connectors/git/` | `components/improve/connectors/git/` |
| `connectors/artifact-graph/` | `components/improve/connectors/artifact-graph/` |
| `connectors/scaffold/` | `components/forge/connectors/scaffold/` |
| `connectors/workflow-runner/` | `components/cos/connectors/workflow-runner/` |
| `connectors/fake-mail/` | `components/email/connectors/fake-mail/` |
| `connectors/fake/` | `components/post/connectors/fake/` |
| `content-types/email/` | `components/email/` |
| `content-types/post/` | `components/post/` |
| `envs/cos-local.yaml` | `components/cos/envs/cos-local.yaml` |
| `envs/improve-local.yaml` | `components/improve/envs/improve-local.yaml` |
| `envs/framework-dev.yaml` | `components/forge/envs/framework-dev.yaml` |
| `envs/local-authoring.yaml` | `components/forge/envs/local-authoring.yaml` |
| `envs/local-feeds.yaml` | `components/briefing/envs/local-feeds.yaml` |
| `envs/local-mail.yaml` | `components/mail-briefing/envs/local-mail.yaml` |
| `envs/workspace.yaml` | `components/tools/envs/workspace.yaml` |
| `envs/research.yaml` | `components/tools/envs/research.yaml` |
| `framework/interfaces/items.source.v1.yaml`, `items.store.v1.yaml` | `components/briefing/interfaces/` |
| `framework/interfaces/improve.findings.v1.yaml`, `improve.detect.v1.yaml`, `session.events.v1.yaml`, `review.verdicts.v1.yaml`, `artifacts.read.v1.yaml` | `components/improve/interfaces/` |
| `framework/interfaces/forge.scaffold.v1.yaml` | `components/forge/interfaces/` |
| `framework/interfaces/workflow.run.v1.yaml` | `components/cos/interfaces/` |
| `framework/interfaces/workspace.read.v1.yaml`, `workspace.write.v1.yaml`, `git.read.v1.yaml`, `web.research.v1.yaml` | `components/tools/interfaces/` |
| `framework/components.yaml` | `framework/kernel.yaml` |
| `tests/test_improve.py`, `tests/test_improve_golden.py`, `tests/golden/improve.json` | `components/improve/tests/` (golden at `tests/golden/improve.json` inside it) |
| `tests/test_improve_detectors.py`, `tests/test_deadcode_check.py` | `components/improve/connectors/improve-detect/tests/` |
| `tests/test_forge.py`, `tests/test_review7a.py` | `components/forge/tests/` |
| `tests/test_workflows.py` | `components/cos/tests/` |
| `tests/test_mail_briefing.py` | `components/mail-briefing/tests/` |
| `tests/test_offline_golden.py`, `tests/golden/feed-briefing.json`, `tests/golden/mail-briefing.json` | `components/briefing/tests/` (goldens in its `tests/golden/`) |
| `connectors/*/tests/` (gmail-api, x-api, artifact-graph, claude-transcripts, corpus-store, git, improve-detect, improve-store, ledger) | `tests/` inside each connector's new folder |

New: `components/tools/component.yaml` (with `interfaces/` and `envs/` above), `components/python/`, `components/unslop/`. Removed: `tests/layout.py` (a hand list of protected paths that the manifests now give), the empty `modes/`, `envs/`, `connectors/`, `content-types/`, `framework/interfaces/`.

Stays in `tests/`: every other test file and `tests/golden/guard-matrix*.json` and `stages.json`, because they test `bay/` or run across components. 536 tests stay 536 through slices 1 to 3. Only the "never edit a file in tests/golden/ by hand" rule changes wording: it covers any `golden/` folder. `test_stage_syntax.py` and the guard matrix stay because they test kernel behaviour, not cos.

Before and after, same rule as above, with the unit after the move being a component folder (a component folder now carries its envs and interfaces, so the count of files would not change, the count of folders does):

| Mode | Places before | Top-level folders before | Component folders after | Top-level folders after |
|---|---|---|---|---|
| cos | 4 | 4 | 1 (cos) | 1 |
| forge | 13 | 4 | 3 (forge, tools, improve) | 1 |
| improve | 16 | 4 | 3 (improve, tools, claude-transcripts) | 1 |
| delivery | 7 | 3 | 2 (delivery, tools) | 1 |
| briefing | 6 | 4 | 2 (briefing, x-api) | 1 |
| feed-briefing | 8 | 5 | 4 (feed-briefing, briefing, x-api, post) | 1 |
| mail-briefing | 8 | 5 | 4 (mail-briefing, briefing, gmail-api, email) | 1 |

Forge reaches improve because it needs `improve.detect/v1`, which improve owns. Forge's `local-authoring` also binds `session.events`, `review.verdicts` and `artifacts.read`, which its `needs:` does not name; the audit should check whether those three bindings are dead and, if so, slice 1 drops them [A-6].

Interfaces live with the component whose mode needs them (as 0006 D3 did for `items.*` and `workflow.run`), except interfaces several modes use, which live in `tools`. A connector that implements an interface depends on the owner's folder through the interface name, never the reverse.

### 6. Limits [A-7]

- `top_level_folders` 11 to 8 and `framework_folders` 3 to 2: lower, no exception.
- NEW `component_spread`: the largest number of top-level folders a mode reaches by the rule of the measurement above (its folder, parent, env files, bound connectors, interface owners, content types). Target and ceiling 1 once slice 3 lands. It can only tighten: it goes 5 to 1, and a mode that reaches a second top-level folder fails. It needs `bay/limits.py` to read a base `limits.yaml` that lacks the measure (a missing base value means the new measure sets its own).
- `kit_python_lines` counts `components/` (replacing `connectors` and `content-types`, adding no lines by the move) and excludes `tests/` folders as now. `tests` counts `components/**/tests/test_*.py` by the same pattern.
- Exceptions (front matter): `kit_python_lines` to 6950, `schemas` to 16, `tests` to 556. `bay_lines` is not raised. Derived protection deletes the protected-list code and its sync lints, which should pay for the discovery changes and the spread measure; if the plan step shows otherwise, a builder trims and the proposal is not amended for it.

### 7. What "connector" means [A-8]

Of the 13 connectors, 2 reach an outside system over the network (`gmail-api`, `x-api`), 1 reads session files outside the project (`claude-transcripts`, `fs.read: ~/.claude/projects`), 2 are test doubles (`fake`, `fake-mail`), and 8 are the framework's own code behind an interface. The owner asked whether "scripts" is a better name. It is not, and the word stays; what changes is where a connector lives.

A connector is a manifest (interface it implements, content types it produces, secrets, network, cost, selectors, config) plus code the kit runs in its own process, with effects, network allowlist, secrets and budget enforced by the dispatcher, and agents unable to reach it directly. A plain script has none of these guarantees. The internal ones need exactly that enforcement (`ledger` reads the ledger, `improve-store` writes findings, `scaffold` writes the tree), so they are not scripts either. "Connector" is also fixed vocabulary (DOD-1, C-7); renaming it would touch every schema, rule and doc and add no guarantee. Rename rejected.

The rule, checkable by lint from the manifest: a connector that declares `network`, `secrets` or an `fs` path outside the project (`~` or absolute) is a source connector and is a top-level component, because it is the replaceable, user-addable part (adding one is one folder). Any other connector is internal code of the component that owns it and lives in that component's `connectors/<name>/`, with its tests beside it; lint says "move it into the component that owns it". Owners: `corpus-store` in briefing, `improve-detect` and `improve-store` in improve, `scaffold` in forge, `workflow-runner` in cos. `ledger`, `git` and `artifact-graph` go to improve: they implement `session.events`, `review.verdicts` and `artifacts.read`, which improve owns, and improve is their only consumer; forge binds them by name in its env only through the interface improve provides. An env may name a connector in another component's `connectors/` only for an interface that component provides.

Fakes live in the content-type component they imitate: `fake-mail` in `email`, `fake` in `post`. They emit that type's fixtures, one fake serves every real source of the type (IMAP later), the offline demo of DOD-5 needs them in the shipped tree, and they depend only on the type and `items.source/v1`. Next to `gmail-api` or `x-api` was rejected (a fake would then follow one real source); in `tests/` was rejected (offline mode runs them outside tests).

### 8. Standards as the first new components [A-9]

No standards mode. A new interface `standards.check/v1` (owned by `tools`) has one operation, `change { base }`, with the same result shape as `improve.detect/v1.change`: `new`, `existing`, `stopped`. It compares findings in the working tree with the tree at the merge-base of `base`, keyed by file, rule and message, so the 2279 ruff findings, 638 mypy errors and 63 unformatted files in the current tree (lint baseline) are `existing` and block nothing. No repository-wide reformat is proposed (rejected: a diff of 63 files that breaks every open branch and 0009's review budget; a tolerated-findings file was rejected because it rots).

A binding is a list, like `items.source`: `standards.check/v1: [python, unslop]` in `local-authoring` (forge) and `workspace` (delivery). A code step runs every bound provider and merges the results; one new finding blocks. Each provider filters by the file globs in its own config, so `python` sees `*.py` and `unslop` sees `docs/**` and `**/playbook.md`.

`components/python/` (`component.yaml`): `connectors/check/` (runs ruff and mypy as subprocesses, list arguments, no shell, with a timeout), `ruff.toml` and `mypy.ini` (from the proposed config: line length 120, the brief's rule selection, `mypy --strict`; passed to the tools with `--config`, so the repo root gets no tool config), `skills/python/SKILL.md` (the brief's checkable rules, with the ones only a review can see). Tool versions are pinned in the new dev-only `requirements-dev.txt` (ruff 0.16.9, mypy 2.3.1, `types-PyYAML`, `types-jsonschema`); runtime dependencies are unchanged. If a tool is missing the step ends blocked and names the pip command. The brief marks many rules `[U]` (not re-read against their primary source); slice 5 confirms each rule code with `ruff rule` before it is enabled.

`components/unslop/` (`component.yaml`): `skills/unslop/SKILL.md` kept as published, `LICENSE` with the MIT notice and `Copyright (c) 2026 Lauren Tan`, and a README naming the source as the `pstack/skills/unslop` folder of the `cursor/plugins` repository on GitHub (no URL is written, so no company domain enters the repo). `connectors/check/` scans for the mechanical patterns of the skill: em dashes, curly quotes, decorative emojis, the listed AI vocabulary, "serves as"-type phrases. The skill's judgement rules stay with the reviewer. The skill file is third-party text: never executed, never edited.

Features choose skills by `skills: [standards:*]` (every skill of the components bound to `standards.check/v1` in the step's env), `[python:python]` (one), or none. forge.extend loads `standards:*` for builder and reviewer; delivery.build loads `python:python` for the builder and the checks run on `standards:*`. Another language later is one folder (`components/go/`) plus its name in the two binding lists. No checker is split across an interface, a connector and a mode: the interface is `tools`', and each checker with its config and skill is one folder.

forge.extend gets a `standards` code step after `limits` and a DoD item "the standards check reports no new finding" (DOD-16); delivery.build gets the same step. Both are described in slice 7.

### 9. Slices

Each ends with the tests green and `bay check` clean. No old path keeps working: slice 1 moves and switches the loader in one commit, because a half-moved tree cannot load without a compatibility layer.

1. **Move.** The table of decision 5, the loader table, scaffold and adapter paths, `apiVersion: agentbay/v4` in every manifest and schema (the layout is a breaking change to where extensions live), the 9 test files and 3 golden files, docs paths. `lint` refuses a leftover `modes/`, `envs/`, `connectors/` or `content-types/` folder with "move it to components/<name>/"; it is a refusal, not support. Protection still read from `kernel.yaml` with its old lists, paths rewritten.
2. **Derived protection.** `protected` in manifests, the lists deleted, `framework-dev` `fs.write` synced by lint, `tests/layout.py` removed.
3. **Boundary, limits, docs.** Component-granularity B-1 to B-3, `component_spread`, the internal-connector placement lint, README, DESIGN, INTERFACES, C-7 vocabulary.
4. **Standards mechanism.** `standards.check/v1`, list-bound code step, `standards:*` skills, with a fixture provider in its test.
5. **`python`.** Checker, config, skill, requirements-dev, the new-versus-base test.
6. **`unslop`.** Skill, notice, prose checker, tests.
7. **Wire.** Bind both in the two envs, `standards` step and DOD-16 in forge.extend, the same step in delivery.build, roles load the skills.

The move is mechanical and its review is the table plus the loader diff; slices 4 to 7 are the only ones that add behaviour.

## Compatibility impact

Breaking, and no code keeps the old layout working. Every manifest and schema goes to `agentbay/v4`. A user's own `modes/`, `envs/`, `connectors/` and `content-types/` must move to `components/` (an env goes to `components/<mode>/envs/`; a mode's internal connector to its `connectors/`). `bay build` regenerates `.claude/`; skills become `<component>--<skill>`. `forge.create` scaffolds under `components/`. Config files and the ledger do not change. There is no new CLI command; `cli_commands` stays 16. Secrets, the guard's protected set (same 17 instances, now read from manifests), approvals and the network allowlist are unchanged, and the tests that pin the guard decisions (`tests/golden/guard-matrix.json`) keep their rows with new physical paths.

## Safety impact

Protection moves from one central list to manifests; it fails closed and a protection change is itself a protected write (decision 4). The new checkers run local tools on project files with list arguments and a timeout, and read nothing outside the project. The unslop skill is data, never run.

## Audit list

The file-by-file audit should try to overturn: A-1 the measurement rule and the figures that differ; A-2 one folder, four manifest kinds, provides found by convention; A-3 the shared set, in particular leaving `bay/selector.py`, `sqlsandbox.py`, `contenttypes.py` in `bay/`; A-4 envs beside their mode, with the DOD-4 cost; A-5 `kernel.yaml` and manifest-derived protection; A-6 forge's three unneeded bindings; A-7 `component_spread` and the three exceptions; A-8 connector placement, the name kept, fakes in content-type components; A-9 change-based standards checks, `standards:*`, and the pinned tool versions.
