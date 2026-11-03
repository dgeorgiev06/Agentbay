# agentbay design

agentbay compiles jobs described as data into a runtime (Claude Code today) and runs them through one dispatcher.
This document describes the system as it is. The contracts are in [INTERFACES.md](INTERFACES.md), and the
reasoning behind each decision is in [proposals/](proposals/).

## Concepts

| Concept | Is | Who writes it |
|---|---|---|
| **Role** | a generic job: prompt, `doneWhen`, rules, skills, default tier (fast, balanced or deep) and access (read or write). Five ship: `lead`, `analyst`, `researcher`, `builder`, `reviewer` | the framework |
| **Mode** | one job: purpose, features (input and output types, effects, steps), the roles it uses and the env each works in, the capabilities it needs, constraints, playbooks, skills and rules | you, or the framework |
| **Agent profile** | how one LLM product runs roles: the runtime for each kind of role, the model for each tier, and the effort values. `agent:` selects it (default `claude-code`) | the runtime adapter, in the `profile:` of its `adapter.yaml` |
| **Environment** | what a role can touch: capability bindings, secrets, network allowlist, filesystem paths, allowed tiers, effects and limits | you, or the framework |
| **Connector** | code that implements a capability interface and holds the secrets and the network use | you, or the framework |
| **Capability interface** | a versioned contract: named endpoints with JSON-schema input and output and declared effects (`read`, `write`, `network`, `spend`, `delete`) | the component that owns it |
| **Component** | a folder that holds one mode, source connector, content type or shared set. It is the unit you add, move or remove | you, or the framework |

A mode names capabilities, never a connector or tool. Adding a source is one component plus one binding line in
an env, and no mode, role or playbook changes. A role file outside the framework is an error. A mode customizes a
role through its playbooks, skills and rules, and a new role is a `forge.extend` proposal.

A mode may `extends:` one abstract mode that extends nothing, so inheritance is one level deep. The kit resolves it at load. A child's feature replaces its parent's feature of that name whole, never key by key, except that a feature with no `playbook` or `rules` inherits the parent's. Roles, constraints
and config defaults merge entry by entry, `needs` are unioned, and inherited paths are rebased to the child's
folder. `abstract: true` marks a base that is linted but never installed or called.

## Components

A component is one folder in `components/` with one manifest, whose name says its kind.

| Manifest | Kind | For |
|---|---|---|
| `mode.yaml` | mode | one job |
| `connector.yaml` | source connector | code that reaches a system outside the project |
| `content-type.yaml` | content type | the fields and views of one kind of item |
| `component.yaml` | shared component | interfaces and envs that several modes use |

A mode also holds what only it needs (envs, interfaces, skills, types, data, tests, internal connectors).
A component uses another only through what the other provides: an interface name in `needs:`, a content type in
`reads:`, a parent in `extends:`, or an env or connector name in a binding.

A connector that declares network access, secrets or a file path outside the project is a source connector and a
component of its own. Every other connector is internal and lives in `connectors/<name>/` inside its owner.

The kernel is not a component. `bay/`, `schemas/`, `framework/` and `adapters/` hold the loader, dispatcher,
contracts, roles and runtime adapters. `framework/kernel.yaml` holds only `owns:` and `protected:`.

## Features

A feature is one block under `features:` in `mode.yaml`. It has input and output types, effects, ordered `steps`,
an optional review block, and a playbook and rules file when it needs them. A feature that runs no role needs
neither; one that does needs a playbook. It is called as `<mode>.<feature>`. The steps are:

- `run: <capability>/v<N>.<endpoint>` is deterministic code, which the dispatcher runs in the coordinator's env.
- `role: <role>` is an agentic step. That role runs it in the env that the step, the feature or the mode `roles:` names.
- `gate: <text>` is an approval gate that only you pass, with `bay approve` in a terminal (or from chat, if `approve.from` allows it). `approves: $in.<f>` ties the gate to the exact content of a file, so a later call on the unchanged file skips it.
- `{review: here}` marks where review goes (default last).

`with:` substitutes `$in.x`, `$steps.<id>.x` and `$config.x`, with `a|b` fallbacks; a `*` path part maps the rest over a list (`$steps.get.items.*.id`), in project workflows too. `when:` skips a step
(`stale > 2h`, `$in.<field>` or `$steps.<id>.<field>`; `!` negates). A playbook has the sections Purpose, Inputs,
Steps, Definition of Done (`- [DOD-n] (must|should|must_not) ...`), Outputs and Failure handling. Rules refer to
Definition of Done ids and can name a deterministic `check` (`citations_resolve`, `no_secrets`, `lint_clean`).
Rules stack with mode constraints, role rules and project `extraRules`; the strictest wins.

Review is configured only in `mode.yaml`. The reviewer gets the task, the Definition of Done, the rules and the
check results, and returns one verdict for each id (`review.verdict/v1`). A failed must or must_not item, or any
item rated blocker, makes the call `partial` and halts it before release.
After a halt, the next run is a scoped re-check when the approved proposal is unchanged. The review brief then
carries `recheck`: the failed ids, the commits made since, and the items that passed. The reviewer judges the
failed ids against those commits; a passed item stands unless new evidence fails it. The verdict must still cover
every id. A changed proposal, or a review after a passed review or a re-check, is a full review.

## Compile: units

`bay check` lints and then resolves every endpoint. It fails with every gap at once, each naming the concept and
the fix. The gaps include unknown names, unbound capabilities, effects the endpoint does not declare or the
env forbids, tiers the env forbids, connector needs (hosts, secrets, paths) beyond the env, steps
that could write `framework/`, `bay/`, `schemas/` or `adapters/` outside `forge.extend`, and a coordinator that is not on a main-thread runtime.

Each distinct (role, mode, env) that a mode uses compiles to one **unit**, named `<role>--<mode>`, plus `--<env>`
when the mode runs that role in several envs. A unit is its own subagent, use shim, guard policy entry and store
access. Its grants come from the mode, not the role. They are the read-only connector endpoints of the mode's
`needs` that the env binds, plus the capabilities that the env binds to the runtime itself (such as web research)
when their effects are read or network. Only `access: write` roles get the file-editing abilities (Edit, Write,
MultiEdit, NotebookEdit), CLIs beyond read-only version control, and the env's write paths. An env's `tiers` caps
both the tiers of steps and a role's default tier.

The claude-code adapter writes `.claude/agents/<unit>.md` for worker units and runs mode coordinators as playbooks
in the main thread, because subagents cannot spawn subagents. It also writes `.agentbay/COORDINATOR.md`, the
registry, the use shims, `.agentbay/guard.json` and the hooks. Builds merge with your `CLAUDE.md`, settings and
MCP servers; `clean` restores them.

## Dispatcher

`bay call <mode>.<endpoint> '<json>'` is the only way to run an endpoint. It validates input and output against
the types, runs code steps with the connector runtime, and enforces budget caps. The runtime resolves secrets from
the env's provider and checks every HTTP request against the env allowlist. An agentic step comes back as a step
plan with the status `needs-agent`: the role unit, tier, model, task, playbook, rules and inputs. The coordinator
runs the plan and returns the output with `bay submit`. The call continues until it is `done`, `partial`,
`blocked` or `failed`, or stops at a gate. Agents read connector data only through their
unit's use shim, which fixes the role, mode and env and serves read-only endpoints. Secret values are scanned for and
redacted from everything returned or logged.

## Run log

The run log is the append-only file `events.jsonl` under `.agentbay/`, and `bay status` folds it into calls,
steps, runs and cost. A subagent
records its plan with `bay plan`, the only `bay` command it may run. `bay status` lists unfinished work with no event for 24 hours under `STALE?`; it closes nothing. With no hook events it says the
hooks are not loaded; start Claude Code inside the project.
[INTERFACES.md section 9](INTERFACES.md#9-ledgerevent) lists the event types.

## Safety model

**Threat model.** agentbay protects the rules that bind agents (guard, dispatcher, gates, secrets, run log, boundary
check), your authority (the framework changes only through `forge.extend`, with approval and review) and your
secrets. It defends against agent mistakes and overreach, prompt injection through data agents read, and extensions
that overreach, not against you. The guard narrows what subagents can ask to do; these are guardrails, not a hard
boundary, and hard isolation needs an OS sandbox. One bypass is known: code a builder runs, such as a test, runs outside
the guard. Around it stand the gate, plan approval, the whole-diff review, the boundary check, `deadcode` and `limits`.

- **Nothing that runs code is auto-approved.** The guard allows without a prompt only a role's own read-only use
  shim (`python3 -E <kit>/bay/use_shim.py`; with the kit inside the project, even that prompts). Every other subagent
  command prompts. The main thread is pre-approved only for `bay show|status|note|catalog`. `show reclaim`,
  `show close`, `note dispatch`, `note review`, `call`, `submit`, `approve` and `auth` ask.
- **Approval follows `approve.from`.** `approve: { from: [terminal, chat] }` in agentbay.config.yaml says where you
  decide (default `[terminal]`). Gates and backlog items (`bay approve <F-id>`) share it. A terminal approval
  needs an interactive stdin. From chat, `bay approve <id> --via chat --quote "<your message>" --sha <hex>` passes a
  gate: the Chief of Staff relays your exact words, the sha is the sha256 prefix (8+ hex digits) of what you saw, and
  a changed file is refused. A backlog item takes no sha. The ledger records `user@chat-via-cos` and the quote. Chat
  is weaker than a terminal: it trusts the main thread.
- **A gate binds content.** A gate with `approves:` records the path and sha256 of its file (a workflow gate takes
  its `W-...` run id). If the file changes after the gate passed, the next submit returns the call to the gate. The
  result submitted with the unseen edit is kept; once re-approved the call resumes after it (reject discards). `bay
  show` says who approved.
- **Secrets and logins.** `bay secret set` needs an interactive stdin whatever `from` says. `bay auth` needs the
  browser on the machine running bay, not a terminal.
- **Plan approval.** `approve.plans` lists role steps (`<mode>.<endpoint>` or `<mode>.<endpoint>.<step>`). Each
  runs a planner first (env `plan-writer`: it writes only under `docs/plans/` and runs only `bay plan`), then a gate on that file (`docs/plans/<callId>-<step>.md`), then the step as a fresh agent given the plan. A
  step with `when:` cannot be listed by name (the endpoint form skips it), and an unmatched entry fails
  `bay check`.
- **What subagents cannot touch.** The guard hook runs on Bash and on every file tool. It denies `.agentbay/`,
  `.claude/`, `.git`, `CLAUDE.md`, `.mcp.json`, `agentbay.config.yaml`, `.env*`, `.envrc`, `Makefile`, `bay.sh`,
  editor folders, `.github/workflows/` and the kit. It also denies writes outside the env's `fs.write`, inline
  interpreter code and risky version-control flags. Paths are compared case-folded where the disk is
  case-insensitive, and by inode (hard links are not detected). The guard fails closed.

**What only `forge.extend` may write.** `framework/kernel.yaml` lists it under `protected:` (INTERFACES.md gives the
format, the fail-closed rule and which modes may place roles in a protected env). Protected names are reserved. The
guard keeps agents out of these paths, and `bay check --base` rejects a change to one unless the proposal lists it.

**`forge.extend`** changes the framework and runs its tests. It is installed only when the project is the agentbay
checkout. Its steps are: draft a proposal (unless one is named), a `plan` step, the approval gate, implement,
`deadcode`, `limits`, review and release.

- **Plan.** The `plan` step runs the `lead` role as a deep subagent and writes `docs/plans/<id>.md`, named like the
  proposal, when the proposal is large (10 or more touches, any `exceptions:`, no readable `touches:`) or touches a
  security-sensitive path. It is skipped when the plan file exists.
- **Gate.** The gate always runs. It approves the proposal and, when a plan exists, the plan too; a chat `--sha` is
  then both prefixes joined by `+`, proposal first (one prefix, or the wrong order, is refused).
- **Dead code.** The `deadcode` step (`improve.detect/v1.change`) blocks the call when the change adds unused code,
  an unused constant, a compatibility layer or a complexity finding that the merge-base with `origin/main` did not
  have.
- **Size.** The `limits` step (`improve.detect/v1.limits`) keeps the framework from growing: no measure in
  `framework/limits.yaml` (code lines, CLI commands, folders, schemas, tests) may exceed its ceiling, or the base branch's if higher. Code and test counts cover framework code only: `adapters/` and the `kernel.yaml` protected paths. A raise needs an `exceptions:` entry in the proposal's front
  matter, approved with it; a count up to it passes without editing `limits.yaml`. A lower count is a note. At release,
  `bay check --limits --write` records the count as the new ceiling, so ceilings only fall.

The boundary checks keep the framework's parts independent. Code cites these ids, and `bay check` runs them.

| Id | Rule | Enforced by |
|---|---|---|
| B-1 | A change touches a kernel path only when its proposal lists it. | `bay check --base` |
| B-2 | A change edits only the component folders it creates or its proposal lists. | `bay check --base` |
| B-3 | In an existing component, a feature folder or a component-wide file changes only when the proposal lists it. | `bay check --base` |
| B-4 | Every tracked file is under a kernel path or in a component folder, apart from docs, tests, records and repo-root files. | lint |
| B-5 | Contracts are honoured: schemas check their shape, and contract tests check each instance. | lint, tests |
| B-6 | Contracts are versioned: `needs:`, `implements:`, `reads:` and `produces:` name `<name>/v<N>` and agree. | lint |
| B-7 | No connector loads another connector's code. Lint scans the code and the files its manifest names; READMEs and top-level tests are exempt, and review covers names built at run time. | lint |
| B-8 | Skills stay in the component that owns them. The build writes them as `<owner>--<skill>`, and lint rejects a clash or an undeclared reference. | build, lint |
| B-9 | A role step reaches only the endpoints in its feature's `uses:`. | the use shim at run time |
| B-10 | Agent SQL runs only over fixed views with functions from a fixed list. | the SQL sandbox |
| B-11 | The core docs name no component outside a fenced block. | `bay check --docs` |
| B-12 | The code has no compatibility layer. | the `deadcode` step |

## The corpus store

`store` is the abstract base of every mode that keeps items. Its features are `add`, `update`, `delete`, `query`, `get` and `ask`. Each
child extends it for one kind of source and declares its own `sync`, `digest` and `prune`, with its own env, store, secrets and role units. The base env is store-local.

`delete` runs four steps: preview, your gate, removal, reviewer (always on: rule C-6 never exempts delete effects). A deleted synced item is remembered in `state.json` and never stored again; the source is untouched. `add` and `update` refuse the kinds that sources produce, and fail closed when the kinds are unknown.

Sources implement `items.source/v1` and return `item/v1` items whose `id` is `<source>:<extId>`. A content type
adds the fields of one kind of item and the views that agents query. A connector declares which selector fields
its search handles. The store fetches with that native part and applies the whole selector again with one shared
matcher, `bay/selector.py`, so every source behaves the same way. A source whose login is missing or expired
returns `blocked` with the command to run, `bay auth <connector>`. A digest or an ask then continues on the stored
items and ends `partial`, and the gap appears in its coverage. The README of the component that owns the base mode
describes the item envelope, selectors, store layout and SQL limits.

The store connector keeps one SQLite store for each mode. Its internal state (cursors, coverage, budget,
deletions) is in a separate `state.json` that agents never open.

**Scope invariant.** The store holds exactly the items of the sources bound to the mode's env that match a
current selector, plus the local items (source `local`), which prune and scope cleanup keep. Every sync and prune enforces this without fetching again. After a change of selectors or
sources, every read except `status` is refused until a sync re-scopes the store. Billing counts every item a
source returns, and the spend is saved before the items are committed.

Agents query with `items.store/v2.sql`: one SELECT over fixed views, on a read-only connection, with limits on
time, memory, rows, bytes and cell length. The store scrubs item text for secrets when it ingests it, and every
read is redacted and scanned again.

## Composing modes

A mode's steps call capability interfaces, never another mode's endpoints, and a feature's `uses:` grants only
interface read endpoints. Modes compose from outside in two ways. A project workflow is a list of stages in
`agentbay.config.yaml` that the Chief of Staff runs through the root mode's `run` and `next` endpoints. A handoff is
an endpoint that returns a `next` call for the Chief of Staff to run: the findings mode hands an approved fix to
the framework-change mode this way. Each call goes through the dispatcher on its own, so it keeps its own grants,
effects, budget, review and gates.
