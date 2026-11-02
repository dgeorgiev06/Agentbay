---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is moved before the gate. The file-by-file audit of all tracked files has run; its verdicts on the A-n decisions are in "Audit verdicts" and the decisions below already carry them. Standards components are split out to 0011 and the audit's cuts to 0012; both depend on this proposal.
id: "0010"
touches:
  - { path: components/, reason: "NEW top-level folder. Every mode, source connector, content type and the shared tools component move here; the move table lists each" }
  - { path: modes/, reason: "REMOVED. Its seven folders move to components/<name>/ (a rename of every file inside)" }
  - { path: modes/cos/features/run/, reason: "slice 0: its playbook and rules are never read (code-only feature) and go" }
  - { path: components/cos/features/run/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/cos/features/next/, reason: "slice 0: its playbook and rules are never read (code-only feature) and go" }
  - { path: components/cos/features/next/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/cos/features/status/, reason: "slice 0: its playbook and rules are never read (code-only feature) and go" }
  - { path: components/cos/features/status/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/backlog/, reason: "slice 0: its playbook and rules are never read (code-only feature) and go" }
  - { path: components/improve/features/backlog/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/verify/, reason: "slice 0: its playbook and rules are never read (code-only feature) and go" }
  - { path: components/improve/features/verify/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/forge/features/extend/, reason: "slice 0 b17: the playbook states each fact once; rules R-2, R-4, R-7 and R-9 go" }
  - { path: components/forge/features/extend/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/mail-briefing/features/digest/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/mail-briefing/features/digest/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/mail-briefing/features/ask/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/mail-briefing/features/ask/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/delivery/features/build/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/delivery/features/build/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/delivery/features/research/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/delivery/features/research/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/briefing/features/prune/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/briefing/features/prune/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/briefing/features/digest/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/briefing/features/digest/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/briefing/features/ask/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/briefing/features/ask/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/triage/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/improve/features/triage/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/implement/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/improve/features/implement/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/scan/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/improve/features/scan/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/improve/features/audit/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/improve/features/audit/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: modes/forge/features/create/, reason: "slice 1: apiVersion agentbay/v4 in its rules.yaml, then the move" }
  - { path: components/forge/features/create/, reason: "the same feature folder after the move (fixes and review rounds edit it here)" }
  - { path: connectors/, reason: "REMOVED. 3 source connectors become components; 10 become `connectors/` inside their owner" }
  - { path: content-types/, reason: "REMOVED. email and post become components/email/ and components/post/" }
  - { path: envs/, reason: "REMOVED. Each env moves into the component of the mode it binds (components/tools/ for the two shared ones)" }
  - { path: envs/framework-dev.yaml, reason: "its fs.write gains the paths the move needs (slice 1) and the paths its protected part is synced from (slice 2)" }
  - { path: connectors/improve-detect/, reason: "the deadcode change detector becomes rename-aware (slice 0), then the folder moves" }
  - { path: coordinator/, reason: "REMOVED. Its only reader is the claude-code adapter, so its commands move to adapters/claude-code/commands/" }
  - { path: framework/interfaces/, reason: "REMOVED. Each interface moves into the component that owns it" }
  - { path: framework/components.yaml, reason: "renamed framework/kernel.yaml; keeps only what the kernel owns; the protected: lists, the briefing entry and the unread keys go" }
  - { path: framework/kernel.yaml, reason: "the renamed component map (slice 1): owns, the interim contracts and and the 19 protected paths" }
  - { path: components/briefing/README.md, reason: "3c: the briefing detail INTERFACES no longer repeats (item envelope, content types, selectors, store layout, SQL sandbox); an owner-approved edit" }
  - { path: components/improve/tests/test_improve_golden.py, reason: "3c: named doc-size delta once INTERFACES is under its word budget; an owner-approved edit" }
  - { path: components/gmail-api/README.md, reason: "3c: its selector link points at the briefing README; an owner-approved edit" }
  - { path: framework/limits.yaml, reason: "top_level_folders 11 to 7, framework_folders 3 to 2, schemas 15 to 16" }
  - { path: framework/roles/, reason: "the golden rule reads `golden/` folders" }
  - { path: framework/rules/conformance.yaml, reason: "C-7 vocabulary (component, internal connector); component-folder rule" }
  - { path: schemas/, reason: "apiVersion v4 (slice 1 names the two that stay); NEW component.schema.json; `protected` field on mode, connector, environment, component" }
  - { path: bay/model.py, reason: "discovery by one glob per kind; lint's mode_envs folds in (slice 0)" }
  - { path: bay/lint.py, reason: "reference-resolves check and two T2 rules (slice 0; the refs-without-check rule is in 0012); component-folder checks, the old-folder refusal, framework-dev fs.write sync, internal-connector placement" }
  - { path: bay/connect.py, reason: "connector login moves in from bay/cli.py, dropping the copy of connect's limits (slice 0)" }
  - { path: bay/workflows.py, reason: "same-behaviour payer for bay_lines (slice 0): the grammar re-check the schemas already make goes, and the duplicate-id check folds into check_stages" }
  - { path: bay/templates/, reason: "NEW; the forge templates move here (decision 2)" }
  - { path: bay/contenttypes.py, reason: "FOLDER goes; the loader finds content types" }
  - { path: bay/conformance.py, reason: "reads the commands at adapters/claude-code/commands" }
  - { path: bay/config.py, reason: "path strings follow the move" }
  - { path: bay/rules.py, reason: "docstring paths follow the move" }
  - { path: bay/__init__.py, reason: "release step: version" }
  - { path: CHANGELOG.md, reason: "release step: entry" }
  - { path: bay/boundary.py, reason: "B-1 to B-3 at component-folder granularity; reads kernel.yaml" }
  - { path: bay/guard.py, reason: "messages name the new paths" }
  - { path: bay/scaffold.py, reason: "stays in bay/ because `bay new` imports it; scaffold targets under components/; templates move to bay/templates/" }
  - { path: bay/limits.py, reason: "count components/**; a count up to an approved exception passes without editing limits.yaml" }
  - { path: bay/graph.py, reason: "data schemas and skills under components/" }
  - { path: bay/cli.py, reason: "`bay build` writes skills as <component>--<skill>; connector login leaves for bay/connect.py; cmd_catalog's two identical branches become one (slice 0 payer); no new command" }
  - { path: adapters/claude-code/, reason: "generated paths, the skill namespace, commands from coordinator/, test_adapter.py" }
  - { path: tests/, reason: "9 test files and 3 golden files move out; layout.py goes; run.py discovers components/**/tests/ and adapters/*/tests/" }
  - { path: README.md, reason: "layout, vocabulary, how to add a component" }
  - { path: docs/INTERFACES.md, reason: "component manifest, where interfaces live; the briefing and improve.finding sections move into their components" }
  - { path: docs/DESIGN.md, reason: "one folder per component; what connector means; the B-1..B-12 table joins the safety model" }
exceptions:
  - { measure: schemas, to: 16, reason: "component.schema.json is added; task.schema.json goes in 0012 slice 1, which returns the ceiling to 15" }
  - { measure: tests, to: 540, reason: "new tests for the slice 0 lint rules (the reference check and the T2 rules), and the rename-aware deadcode test, minus the tests that slices 0 and 1 remove; 0011 and 0012 move the count further, and the release lowers the ceiling to the real count" }
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

Improve, mail-briefing and cos match. The others differ and I could not reproduce them with any single rule, so the table states its rule. Two other points differ from the problem statement. Connector tests are already beside their connector (8 test files under `connectors/*/tests/`); what sits in the shared `tests/` is the mode tests. And the "12 to 26 files" that test a mode are mostly kernel tests (resolver, lint, guard, dispatch, protection) that use a shipped mode as a fixture; only 9 test files dedicated to one component sit in `tests/`.

0006 said components own their contracts. The layout works against it: an interface sits in `framework/interfaces/` away from the connectors that implement it, an env sits away from its mode, and `framework/components.yaml` is a second, hand-kept description of what the folders already say.

The audit found a second problem that the move would make worse. `bay check` does not verify that what a manifest or an adapter points at exists, so a rename can leave check green and break the system at run time. Slice 0 fixes that first.

## Audit verdicts

| Decision | Verdict |
|---|---|
| A-1 measurement rule | Confirmed by default: no batch re-ran it. |
| A-2 one folder, four manifest kinds, provides by convention | Confirmed. Convention means nothing lists what a component needs, so the reference check becomes the only guard: slice 0. |
| A-3 shared set | Amended: `bay/selector.py`, `sqlsandbox.py` and `contenttypes.py` stay in `bay/` (the kernel and four source connectors import them). `coordinator/` moves into the adapter, so top-level folders become 7. `bay new` imports `bay/scaffold.py`, so scaffold and its templates stay kernel-owned. |
| A-4 envs beside their mode | Confirmed. |
| A-5 `kernel.yaml`, protection from manifests | Amended by the owner: protection stays one list in `kernel.yaml`. |
| A-6 forge's three bindings | Overturned. They are the declared needs of improve-detect, an unbound need is a resolution gap, and `change` reads ledger episodes. They stay; decision 7 says when they may go. |
| A-7 limits | Amended: the numbers are in decision 6. |
| A-8 connector meaning and placement | Confirmed with three corrections in decision 7. |
| A-9 standards components | Confirmed in shape; carried by 0011. The comments rule becomes a third checker, `comments`. The pinned tool versions could not be checked offline; 0011 slice 3 confirms them. |

## Decisions

### 1. Component folder and manifest

The repo gets one folder, `components/`, and every component is `components/<name>/`. Names are unique across kinds. The folder holds exactly one manifest, and its kind says what the component is:

| Manifest | Kind | For |
|---|---|---|
| `mode.yaml` | Mode | a mode (the file keeps its present shape) |
| `connector.yaml` | Connector | a connector that reaches outside (decision 7) |
| `content-type.yaml` | ContentType | a content type |
| `component.yaml` | Component (NEW) | everything else: `tools`, then `python`, `unslop`, `comments` (0011) and later languages. It has `name`, `version`, `description`, `needs`. |

Everything a component provides is found by folder convention, not listed, because a list of what a folder contains repeats the folder and drifts (the lesson of 0006): `interfaces/*.yaml` (interfaces it owns), `envs/*.yaml`, `skills/*/SKILL.md`, `types/`, `data/`, `connectors/<name>/` (decision 7), `features/`, `templates/`, `tests/`. What it needs stays in the manifest as today: `needs:` (interfaces), `reads:` (content types), `extends:`. `bay ls` and the catalog list what a folder provides by reading it. Alternative rejected: one new `component.yaml` for every component with the old files as bodies; it doubles the files to add a connector (DOD-10) and wraps what already declares needs and produces.

`extends: briefing` still names a component. The parent must be a Mode component. A child gets the parent's features, skills, types, data and config schema by whole-feature override as in 0006 Part E, and, after 0012 slice 2, the parent's feature playbook and rules unless it overrides them. It gets nothing else: not its envs, interfaces or tests. Other components use a component only through what it provides: an interface name in `needs:`, a content type in `reads:`, a parent in `extends:`, an env or connector name in a binding. Lint refuses a path from one component's files into another's folder.

Skills are namespaced `<component>--<skill>` (was `<mode>--<skill>`). A feature may name a skill another component provides as `<component>:<skill>`, or `standards:*` (0011).

### 2. What stays shared

`bay/` (with `bay/templates/`), `schemas/`, `adapters/`, `docs/`, `tests/` (kernel and cross-component tests, plus `helpers.py`, `golden_util.py` and `improve_fixtures.py`, which connector tests import), and `framework/` with `roles/`, `rules/`, `kernel.yaml` and `limits.yaml`. Nothing else. `bay/selector.py`, `bay/sqlsandbox.py` and `bay/contenttypes.py` stay in `bay/` because the kernel imports them; moving them under `components/briefing/` would make the kernel import a component. Roles stay in `framework/roles/`; a component providing a role is allowed by the folder convention but none does yet. `bay/scaffold.py` stays because `bay new` calls it, and so do the templates it writes; forge's scaffold connector keeps calling it.

The top-level folders become `adapters`, `bay`, `components`, `docs`, `framework`, `schemas`, `tests`: 7, down from 11. Folders under `framework/` become `roles` and `rules`: 2, down from 3. Tests are found by one pattern, `components/**/tests` plus `adapters/*/tests` and `tests/`; `tests/run.py` and the pattern in `bay/limits.py` change together.

### 3. Envs

An env lives in `envs/` of the component of the mode whose roles run in it. Shared envs live in `components/tools/envs/`. Placed:

- `cos-local` in cos; `improve-local` in improve; `framework-dev` and `local-authoring` in forge; `local-feeds` in briefing (feed-briefing inherits it); `local-mail` in mail-briefing.
- `workspace` and `research` in `tools`, which also owns the four tool-bound interfaces (`workspace.read`, `workspace.write`, `git.read`, `web.research`); 0011 adds `standards.check/v1` to them.

Reason: an env is the first place a mode reaches a connector, so it belongs beside the mode, and that makes each mode's closure one top-level folder. Alternatives rejected: in the connector (a connector would name modes, which B-7 forbids, and one env binds several connectors); project-level `envs/` (leaves two shipped modes with a second top-level folder, and mixes kit and user files).

Cost, stated plainly: adding a source is still one new component plus one binding line, with no `mode.yaml`, role or playbook edit (DOD-4 keeps its words), but the line is in an env file inside the mode's folder. A framework change that adds a shipped source names that env file in `touches:` instead of `touches: []`. DOD-4 in the playbook is reworded to "one new component folder plus one binding line in an env". The lint that keeps modes from naming connectors reads Environment files differently from `mode.yaml` and playbooks (kind decides, not folder).

### 4. Discovery and protection

The loader (`bay/model.py`) has one table: kind to manifest filename, found with `components/*/<manifest>`, plus the convention folders. `bay build`, `bay check`, the catalog, lint, `bay boundary`, the guard and scaffold all go through the loader, so none has a path list of its own.

`framework/components.yaml` is no longer a map of components; they are derived from the folders. It is renamed `framework/kernel.yaml` and keeps two things: the kernel's `owns:` (the paths the boundary check treats as core, including the three briefing files that stay in `bay/`) and `protected:`. The `briefing` entry goes (its folder is its ownership), and so does the `contracts:` block, which repeats the loader table and names three contract test files that do not exist. Contract tests move to the loader: each discovered instance of a kind runs the kind's contract test. The schema, tests, protocol, implements and source keys that no code reads go too.

`protected:` stays one list in `framework/kernel.yaml` (owner, 2026-11-01): the one place that says what only `forge.extend` may write. Its header says what belongs there: the rules that bind agents (guard, gates, secrets, ledger, boundary) and the framework's own components; protected names are reserved; an unreadable file protects everything. Slice 1 rewrote its paths for the new layout, including the `interfaces/` folders of briefing, improve and tools, so the interfaces keep the protection they have under `framework/` today (`improve.findings/v1` makes backlog approval owner-only). `framework-dev`'s `fs.write` names each protected path, as today (D9 of 0008 unchanged). Moving the briefing files into `components/briefing/` and deriving the reserved names from `paths` are left to 0012.

### 5. The move

The unit is a folder. Every file under a moved folder keeps its relative path, so a row stands for all of them; rows that change shape are listed one by one. Sources are the current tree.

| From | To |
|---|---|
| `modes/cos/` | `components/cos/` |
| `modes/forge/` (includes `types/`, `features/`) | `components/forge/` |
| `modes/forge/templates/` | `bay/templates/` |
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
| `coordinator/commands/` | `adapters/claude-code/commands/` |
| `tests/test_adapter.py` | `adapters/claude-code/tests/` |
| `tests/test_improve.py`, `tests/test_improve_golden.py`, `tests/golden/improve.json` | `components/improve/tests/` (golden at `tests/golden/improve.json` inside it) |
| `tests/test_improve_detectors.py`, `tests/test_deadcode_check.py` | `components/improve/connectors/improve-detect/tests/` |
| `tests/test_forge.py`, `tests/test_review7a.py` | `components/forge/tests/` |
| `tests/test_workflows.py` | `components/cos/tests/` |
| `tests/test_mail_briefing.py` | `components/mail-briefing/tests/` |
| `tests/test_offline_golden.py`, `tests/golden/feed-briefing.json`, `tests/golden/mail-briefing.json` | `components/briefing/tests/` (goldens in its `tests/golden/`) |
| `connectors/*/tests/` (gmail-api, x-api, artifact-graph, claude-transcripts, corpus-store, git, improve-detect, improve-store, ledger) | `tests/` inside each connector's new folder |

New: `components/tools/component.yaml` (with `interfaces/` and `envs/` above); 0011 adds the standards components. Removed: `tests/layout.py` (a hand list of the protected paths that `kernel.yaml` gives), the empty `modes/`, `envs/`, `connectors/`, `content-types/`, `coordinator/`, `framework/interfaces/`.

Stays in `tests/`: every other test file and `tests/golden/guard-matrix*.json` and `stages.json`, because they test `bay/` or run across components. The move adds or removes no test except those that depended on `layout.py`. The "never edit a file in tests/golden/ by hand" rule covers any `golden/` folder.

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

Forge reaches improve because it needs `improve.detect/v1`, which improve owns, and its `local-authoring` env also binds `session.events`, `review.verdicts` and `artifacts.read`. The audit showed those three bindings are improve-detect's declared needs, so they stay through the move.

Interfaces live with the component whose mode needs them (as 0006 D3 did for `items.*` and `workflow.run`), except interfaces several modes use, which live in `tools`. A connector that implements an interface depends on the owner's folder through the interface name, never the reverse.

### 6. Limits

- `top_level_folders` 11 to 7 and `framework_folders` 3 to 2: lower, no exception. `schemas` rises from 15 to 16 for this proposal: `component.schema.json` is added. 0012 slice 1 removes `task.schema.json` and the ceiling returns to 15 (exception below).
- `component_spread` was planned here and dropped by the owner (3b): after the move the loader reads only `components/*`, so the measure could only be 1. The layout is held by the loader, lint's refusal of leftover old folders, the placement rule and `top_level_folders`, which only falls.
- `kit_python_lines` counts `components/` (replacing `connectors` and `content-types`) and excludes `tests/` folders as now. `tests` counts `components/**/tests/test_*.py` by the same pattern. The move adds no kit Python, so this proposal needs no `kit_python_lines` exception. 0011 raises that ceiling for the new checkers and adds the `comment_lines` measure; 0012 lowers `tests` and `comment_lines` further.
- Exceptions are in the front matter: `schemas` to 16 and `tests` to 540, each with its reason. `bay_lines` has no exception: 0010 adds about 50 lines net and pays for them in slice 0 with same-behaviour cuts pulled forward from 0012.

### 7. What "connector" means

Of the 13 connectors, 2 reach an outside system over the network (`gmail-api`, `x-api`), 1 reads session files outside the project (`claude-transcripts`, `fs.read: ~/.claude/projects`), 2 are test doubles (`fake`, `fake-mail`), and 8 are the framework's own code behind an interface. The owner asked whether "scripts" is a better name. It is not, and the word stays; what changes is where a connector lives.

A connector is a manifest (interface it implements, content types it produces, secrets, network, cost, selectors, config) plus code the kit runs in its own process, with effects, network allowlist, secrets and budget enforced by the dispatcher, and agents unable to reach it directly. A plain script has none of these guarantees. The internal ones need exactly that enforcement (`ledger` reads the ledger, `improve-store` writes findings, `scaffold` writes the tree), so they are not scripts either. "Connector" is also fixed vocabulary (DOD-1, C-7); renaming it would touch every schema, rule and doc and add no guarantee.

The rule, checkable by lint from the manifest: a connector that declares `network`, `secrets` or an `fs` path outside the project (`~` or absolute) is a source connector and is a top-level component, because it is the replaceable, user-addable part (adding one is one folder). Any other connector is internal code of the component that owns it and lives in that component's `connectors/<name>/`, with its tests beside it; lint says "move it into the component that owns it". Owners: `corpus-store` in briefing, `improve-detect` and `improve-store` in improve, `scaffold` in forge, `workflow-runner` in cos. `ledger`, `git` and `artifact-graph` go to improve: they implement `session.events`, `review.verdicts` and `artifacts.read`, which improve owns, and improve is their only consumer. `git` reads only `.git` inside the project, so it is internal.

Fakes live in the content-type component they imitate: `fake-mail` in `email`, `fake` in `post`. They emit that type's fixtures, one fake serves every real source of the type (IMAP later), the offline demo of DOD-5 needs them in the shipped tree, and they depend only on the type and `items.source/v1`.

The audit made three corrections.

- **improve-detect splits (0011 slice 2).** Five of its seven endpoints serve improve. `limits` only wraps `bay/limits.py` and moves to `forge.scaffold/v1`. `change` has the same result shape as `standards.check/v1`, so it moves into a `deadcode` connector in forge that provides that interface, and forge.extend's `deadcode` step merges into its `standards` step (0011 slice 6). Only after the split may `local-authoring` drop its three bindings, and only if the new connector's `needs` do not name them; until then they stay.
- **Six internal-connector READMEs go** (artifact-graph, git, improve-detect, improve-store, ledger, workflow-runner). `claude-transcripts` keeps its README, being a source connector.
- **Lint requires no README for an internal connector.** It already does not, and the proposal states it so it stays true.

### 8. Standards components

Standards components follow in 0011.

### 9. Slices

Each ends with the tests green and `bay check` clean. No old path keeps working: slice 1 moves and switches the loader in one commit, because a half-moved tree cannot load without a compatibility layer. "Rows" are the cut-list rows of the appendix.

0. **Every reference resolves, and the T2 lint rules.** Lint already reports a declared feature playbook or rules file that does not exist (`bay/lint.py:101-103`). The gap is files found by convention or named from code: the adapter-run scripts (`bay/hook.py`, `bay/guard.py`, `bay/use_shim.py`, `bay/graph.py`), a mode's coordinator playbook (`bay/model.py:1023` reads a missing one as empty), data schemas found by name, and feature types. The check refuses each missing one, so the move and the cuts after it (0012) cannot leave check green over a broken system. Lint also refuses agent-facing text (playbook, rules) on a feature with no role or review step, and a manifest key no code reads. The offenders go in the same slice, removed before the rules switch on: the unreachable playbooks and rules (briefing sync, the three cos features, improve backlog and verify: 12 files; briefing prune keeps its files because its review reads them; feed-briefing), the unread `policies:` keys, the extend playbook's repeated facts (about 400 words), and the six READMEs. The doc-stale detector also skips `docs/plans/`, as it skips `docs/proposals/` (`connectors/improve-detect/detect_artifacts.py:26`): a plan names paths that exist only after it is implemented, and this plan made the improve golden fail. Rows a10, a12-a16, a19, a20, a24, a25, b17.

   Two more items belong here. The deadcode change detector (`improve-detect`'s `change`) becomes rename-aware: it matches findings across git renames (base path to head path), so a finding that existed at the base in a moved file is not new. Its test is `tests/test_deadcode_check.py::test_a_finding_in_a_renamed_file_is_not_new`. And the `bay_lines` payers (decision 6): connector login moves from `bay/cli.py` into `bay/connect.py`, removing the copy of connect's limits, and lint's `mode_envs` folds into `bay/model.py`. Both moved here from 0012 slice 3.
1. **Move.** The table of decision 5, the loader table, scaffold and adapter paths, test discovery, `apiVersion: agentbay/v4` in every manifest and every extension schema (the layout is a breaking change to where extensions live; `config.schema.json` and `event.schema.json` stay at v3, because config files and the ledger do not change), the 9 test files and 3 golden files, docs paths. `lint` refuses a leftover `modes/`, `envs/`, `connectors/`, `content-types/` or `coordinator/` folder with "move it to components/<name>/"; it is a refusal, not support. Protection still read from `kernel.yaml` with its old lists, paths rewritten. Builders work with the guard on: `framework-dev`'s `fs.write` gains the paths the move needs, namely the unprotected component folders, `README.md` and the mode files slice 0 edits. Slice 2 derives the protected part of that list from the manifests; the owner answers each prompted `git mv` or `git rm`.
2. **Close the move window.** `framework-dev`'s `fs.write` goes back to the protected paths plus docs, tests and README.md (D9 holds again); the temporary guard deltas go; `kernel.yaml`'s comment becomes a three-line header; `tests/layout.py` is removed and its importers read the list from `kernel.yaml`.
3. **Boundary, limits, docs.** Component-granularity B-1 to B-3, a count up to an approved exception passes without editing limits.yaml, the internal-connector placement lint, README, DESIGN, INTERFACES, C-7 vocabulary. The B-1..B-12 table of 0006 Part F moves into DESIGN's safety model, because code cites those ids; DESIGN keeps its link to `proposals/`. Row b18.

The move is mechanical and its review is the table plus the loader diff. Slice 0 comes first so that every later slice, the move included, is checked against the reference check.

## Prevention

A rule that code can check is a check, never prose: the audit found prose rules that had drifted or that no agent reads. Each root cause of the audit gets the check that blocks it, in the slice that fixes it. 0011 and 0012 carry the rows for their slices.

| Root cause | Check that blocks it | Slice |
|---|---|---|
| A referenced file is missing and check stays green | every reference resolves | 0 |
| Agent text on a code-only feature, unread manifest keys | the T2 lint rules | 0 |
| A component spread over folders | the loader reads only `components/*`; lint refuses old folders and misplaced connectors; `top_level_folders` only falls | 1, 3 |

Each rule in `framework/rules/conformance.yaml` (moving to the kernel) names its `check:`. A rule without one is a judgement call, and stays one line in a role or a standards skill, which the reviewer checks.

## Compatibility impact

Breaking, and no code keeps the old layout working. Every manifest and extension schema goes to `agentbay/v4`. A user's own `modes/`, `envs/`, `connectors/` and `content-types/` must move to `components/` (an env goes to `components/<mode>/envs/`; a mode's internal connector to its `connectors/`). `bay build` regenerates `.claude/`; skills become `<component>--<skill>`. `forge.create` scaffolds under `components/`. Config files and the ledger do not change. There is no new CLI command; `cli_commands` stays 16. Secrets, approvals and the network allowlist are unchanged. The guard's protected set is the 17 instances at their new paths in `kernel.yaml`, plus the `interfaces/` folders of briefing, improve and tools (those of cos and forge nest inside protected folders), so every interface keeps the protection it has today. The guard decisions that `tests/golden/guard-matrix.json` pins are re-pinned only by 0012 slice 8, after review.

## Safety impact

Protection stays one central list in `kernel.yaml`, with its paths moved to the new layout; it fails closed, and a change to it is itself a protected write (decision 4).

## Appendix: cut-list rows

Rows cite cross.md section 4 by table and position: `a` is its removes-and-merges table and `b` its simplify table, each numbered in order. Estimated line counts stay in cross.md.

| Rows | Path (cross.md section 4) | Slice |
|---|---|---|
| a10, a12-a16 | READMEs of artifact-graph, git, improve-detect, improve-store, ledger, workflow-runner | 0 |
| a19 | feed-briefing playbook.md | 0 |
| a20 | cos features run, next, status playbooks | 0 |
| a24, a25 | improve backlog playbook; verify playbook and rules | 0 |
| b17 | forge extend playbook and rules | 0 |
| b18 | docs/INTERFACES.md sections | 3 |
| a11 | claude-transcripts README | dropped: overturned, kept |

Rows a1-a9 and a18 are not cut by this proposal; 0012 lists them, and its slices carry every other row.
