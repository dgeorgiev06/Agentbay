# agentbay design

agentbay compiles jobs described as data into a runtime (Claude Code today) and runs them through one
dispatcher. This document describes the system as it is; the contracts are in [INTERFACES.md](INTERFACES.md)
and the history of each decision is in [proposals/](proposals/).

## Concepts

| Concept | Is | Who writes it |
|---|---|---|
| **Role** | a generic job: prompt, `doneWhen`, rules, skills, default tier (fast, balanced, deep), access (read or write). Five ship: `lead`, `analyst`, `researcher`, `builder`, `reviewer` | framework (`framework/roles/`) |
| **Mode** | one logical job: purpose, endpoints (features), workflows, the roles it uses and the env each works in (`roles:`), the capabilities it needs, constraints, playbooks, skills, rules | you (`modes/`), or the framework |
| **Agent profile** | how one LLM product runs roles: runtime per kind of role (coordinator, worker), tier -> model, effort values. Selected once with `agent:` (default `claude-code`) | framework (`framework/agents/`) |
| **Environment** | what a role can touch: capability bindings, secrets (names and provider), network allowlist, filesystem paths, allowed tiers, effects, limits | you (`envs/`), or the framework |
| **Connector** | code implementing a capability interface; holds the secrets and network use | you (`connectors/`), or the framework |
| **Capability interface** | a versioned contract: named endpoints with JSON-schema in/out and declared effects (`read`, `write`, `network`, `spend`, `delete`) | `interfaces/`, `framework/interfaces/` |

Modes name capabilities, never connectors or tools. Adding a source is one connector plus one binding line in
an env; no mode, role or playbook changes. A user file under `roles/` or `agents/` is an error: a mode
customizes a role through its playbooks, skills and rules, and a new role is a `forge.extend` proposal.

A mode may `extends:` another. Inheritance is resolved when the kit loads (endpoints merge key by key,
workflows per workflow, `roles`/constraints/configDefaults entry by entry, needs are unioned, inherited paths
are rebased), so every later stage sees a complete mode. `abstract: true` marks a base that is linted but
never installed (`modes/briefing`).

## Features and workflows

An endpoint (feature) declares, in `mode.yaml`, its input and output types, effects, workflow, playbook,
rules and optional review block. A workflow is ordered steps:

- `run: <capability>/v<N>.<endpoint>`: deterministic code, run by the dispatcher in the coordinator's env;
- `role: <role>`: an agentic step, run by that role in the env the step, feature or mode `roles:` names;
- `gate: <text>`: an approval gate only you pass, with `bay approve` in a terminal (or from chat, if you opt in);
- `{review: here}`: where the review step goes (default: last).

`with:` substitutes `$in.x`, `$steps.<id>.x` and `$config.x` (with `a|b` fallbacks); `when:` skips a step
(`stale > 2h` or `$in.<field>`). A playbook has the sections Purpose, Inputs, Steps, Definition of Done
(`- [DOD-n] (must|should|must_not) ...`), Outputs and Failure handling. Rules reference DoD ids, may name a
deterministic `check` (`citations_resolve`, `no_secrets`, `lint_clean`, ...), and stack with mode
constraints, role rules and project `extraRules`; the strictest wins. Review is configured only in
`mode.yaml`: the reviewer gets the task, the DoD, the rules and the check results, and returns one verdict per
id (`review.verdict/v1`). A failed must item or a blocker makes the call `partial`.

## Compile: units

`bay validate` lints and then resolves every endpoint, failing with every gap at once, each naming the
concept and the fix: unknown names, unbound capabilities, effects the endpoint does not declare or the env
does not allow, tiers the env does not allow, connector needs (hosts, secrets, paths) beyond the env, and
steps that could write `framework/`, `bay/`, `schemas/` or `adapters/` outside `forge.extend`.

Each distinct (role, mode, env) a mode uses compiles to one **unit**, named `<role>--<mode>` (plus `--<env>`
when the mode runs that role in several envs). A unit is its own subagent, use shim, guard policy entry and
store access. Its grants come from the mode, not the role: the read-only connector endpoints of the mode's
`needs` that the env binds, plus the tools of tools-capabilities whose effects are read or network. Only
`access: write` roles get file-writing tools, CLIs beyond read-only version control, and the env's write paths. User
modes may put roles only in their own envs and the framework envs named in `bay/model.py`
`USER_FRAMEWORK_ENVS`; an env's `tiers` caps both step tiers and a role's default tier.

The claude-code adapter writes `.claude/agents/<unit>.md` for worker units, runs mode coordinators as
playbooks in the main thread (subagents cannot spawn subagents), and writes `.agentbay/COORDINATOR.md`, the
registry (`.agentbay/catalog.json`), the use shims, `.agentbay/guard.json` and the hooks. Builds are
idempotent, merge with your own `CLAUDE.md`, settings and MCP servers, and `clean` restores them.

## Dispatcher

`bay call <mode>.<endpoint> '<json>'` is the only way to run an endpoint. It validates input and output
against the types, runs code steps with the connector runtime (secrets resolved from the env's provider,
HTTP checked against the env allowlist before every request), enforces budget caps, and returns an agentic
step as a step plan (`needs-agent`): the role unit, tier, model, task, playbook, rules and inputs. The
coordinator runs it and hands the output back with `bay submit`; the call continues until `done`, `partial`,
`blocked` or `failed`, or stops at a gate (`awaiting-approval`). Agents read connector data only through
their unit's use shim, `.agentbay/roles/<unit>/use <capability>/v<N>.<endpoint> '<json>'`, which fixes
role, mode and env and serves read-only endpoints. Secret values are redacted from everything returned or
logged.

## Run log

The run log (`events.jsonl` under `.agentbay/`) is append-only; state is a fold over it. The dispatcher writes `step.*` and
`call.completed` (mode, endpoint, step, role, agent, env, cost, optional `durationMs`/`tokens`/`costUsd`),
hooks write agent runs (`spawned`, `completed`, `failed`), the guard writes `permission.denied` (never the
command), shims write `data.read`, and `bay note` writes notes (an instruction change, a decision). Notes
attach to a run, task or call and never create a run. Every value is pattern-scanned for secrets and redacted
before it is written. `bay status` folds the run log into calls, steps, runs and cost.

## Safety model

**Hooks are defense in depth, not isolation.** The guard narrows what Claude Code subagents can ask to do; it
cannot contain code once something runs it. Hard isolation needs an OS sandbox.

- **Nothing that runs code is auto-approved.** The guard allows without a prompt only a role's own read-only
  use shim, run as `python3 -E <kit>/bay/use_shim.py`; when the kit is inside the project, even that prompts.
  Every other subagent command prompts you. The main thread is pre-approved only for
  `bay show|status|log|note|task|catalog`; `bay call` and `bay submit` run connector code and prompt, and
  `bay approve` prompts too. With `approvals: { chat: true }` (off by default), `bay approve --via chat --quote`
  passes a gate without a terminal; the ledger labels it `user@chat-via-cos`. This trusts the main thread to
  relay your words, so it is weaker than a terminal. Secrets and logins never leave the terminal.
- **What subagents cannot touch:** the guard hook runs on Bash and every file tool. It denies `.agentbay/`,
  `.claude/`, `.git`, `CLAUDE.md`, `.mcp.json`, `agentbay.config.yaml`, `.env*`, `.envrc`, `Makefile`,
  `bay.sh`, editor folders, `.github/workflows/` and the kit; writes outside the env's `fs.write`; inline
  interpreter code; and risky version-control flags. Paths are compared case-folded where the disk is case-insensitive
  and by inode (hard links are not detected). It fails closed.
- **Your terminal only:** approval gates, backlog approvals and `bay secret set` refuse a non-interactive
  stdin.
- `forge.extend`, which changes the framework and runs its tests, is installed only when the project is the
  agentbay checkout.

## Briefings: corpus store and read-only SQL

`modes/briefing` is an abstract base (sync, digest, ask, prune). Each child mode extends it for one kind of
source, in its own env with its own store, secrets and role units.
Sources implement `items.source/v1` and return `item/v1` items (`id` is `<source>:<extId>`; a content type
such as `post/v1` adds fields). A connector declares which selector fields its search handles; the store
fetches with that native part and re-applies the whole selector with one shared matcher (`bay/selector.py`),
so behaviour is the same on every source. A source that declares `changeFeed: true` is followed by cursor
instead of re-listed. A source whose login is missing or expired returns `blocked` with the one command to
run, `bay auth <connector>`; a digest or ask then goes on with the stored items and ends `partial`, the gap in
its coverage. Each connector's README says how it reads its source.

The `corpus-store` connector keeps one SQLite store per mode (`<env data>/<mode>/corpus.db`, owner-only,
with FTS5 when available) and its internal state (cursors, coverage, budget, deletions) in a separate
`state.json` agents never open. **Scope invariant:** the store holds exactly the items of the sources bound
to the mode's env that match a current selector. Every sync and prune enforces it without refetching; after
a change of selectors or sources every read except `status` is refused until a sync re-scopes. Billing
counts every item a source returns, and spend is saved before the items commit.

Agents query with `items.store/v1.sql`: one SELECT over the views (`v_items`, `v_posts`, `v_email`,
`v_threads`, `v_attachments`, `v_fts`, `v_attachment_fts`) and the store tables, on a read-only connection,
behind an authorizer with a function allowlist, a pre-pass that refuses FTS shadow tables, and time, heap,
row, byte and cell limits. Item text and attachment text are secret-scrubbed at ingest and every read is
redacted and scanned again.

## Project workflows

A project workflow is stages in `agentbay.config.yaml`, each a `call: <mode>.<endpoint>` or a `gate:`. The
root mode's endpoints, over `workflow.run/v1`, return the call to make; the coordinator makes it the ordinary
way, so every stage keeps its own grants, effects, budget, review and gates, and nothing recurses.
`bay validate` checks each stage's target and input and prints the union of stage effects.

## Framework modes and connectors

The framework ships instances of the same contracts: the root mode, the mode that builds agentbay itself
(scaffolds, and proposal-driven changes to the framework), and the mode that finds recurring failures, with
the connectors they use. Each is described in the README of its folder under `framework/modes/` or
`framework/connectors/`; `bay catalog` lists them.
