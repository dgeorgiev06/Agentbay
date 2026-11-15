---
# Approval is recorded by the owner in chat for this proposal, because the gate and the guard are themselves being replaced. Design only: nothing is changed before approval. Owner decisions of 2026-11-14, followed here as given: everything in TypeScript; nothing has to stay compatible and anything may change; every existing mode exists in the first release; the safety model is redesigned as declared permissions per mode; mode code uses only an official toolbox; no build step; Opus builders started from chat, reviewed by Fable. Counts were read on main at a7a425d (4.0.0). Where the plan and this proposal differ, the plan wins.
id: "0022"
status: draft
touches:
  - { path: bay/, reason: "replaced whole: the Python kernel is deleted at cutover and a TypeScript kernel takes the folder" }
  - { path: bay.sh, reason: "launches `node bay/cli.ts`" }
  - { path: adapters/, reason: "claude-code is rewritten against the new adapter interface; codex is added in 5.1" }
  - { path: components/, reason: "every mode is rewritten to the new mode contract; connectors become small capability modes; components/base/python is replaced by components/base/typescript" }
  - { path: schemas/, reason: "replaced: schemas for the new manifest, interface, skill front matter, workflow and config" }
  - { path: framework/, reason: "kernel.yaml and limits.yaml are rewritten for the new layout; roles/ is removed (a role becomes a skill step)" }
  - { path: tests/, reason: "replaced: new tests on the node test runner; the Python tests and goldens are deleted at cutover" }
  - { path: package.json, reason: "NEW, with package-lock.json and tsconfig.json" }
  - { path: requirements.txt, reason: "deleted at cutover, with requirements-dev.txt and conftest.py" }
  - { path: README.md, reason: "rewritten" }
  - { path: docs/DESIGN.md, reason: "rewritten for the new design" }
  - { path: docs/INTERFACES.md, reason: "rewritten: the mode, skill, interface, workflow and adapter contracts" }
  - { path: CHANGELOG.md, reason: "5.0.0 entry with an Upgrading section" }
exceptions:
  - { measure: all, to: "new ceilings written at cutover", reason: "every measure is redefined for the new kernel (see Limits); the kernel budget is 4,000 lines against 9,703 today" }
---

# 0022: agentbay 5, a smaller kernel in TypeScript

## Summary

agentbay 4 is a Python kernel of 9,703 lines with 6,415 lines of Python connectors, seven concepts a mode author must learn (role, mode, agent profile, environment, connector, capability interface, component) and a guard that parses shell commands. This proposal replaces it with a TypeScript kernel of at most 4,000 lines built around one unit, the mode, and rebuilds every existing mode on it.

It is a redesign, not a port. Nothing reads agentbay 4 manifests, state or data, with one exception: a one-time importer for your own to-dos and other local items, which no source can re-create.

What you get:

- **One unit.** A mode is a folder with a manifest, typed actions, skills, scripts, workflows and migrations. A connector is no longer a separate thing: Gmail is a small mode that implements an interface, and the mail briefing composes it.
- **Composition like contracts.** Modes call each other only through interfaces, the callee's permissions apply, and a binding in the project config says which mode serves each interface.
- **Skills with a fixed structure.** Seven sections, checked by `bay check`.
- **Runs that survive.** Every step is saved before the next starts; a run resumes after a crash, waits days for an approval, has a budget, and can undo finished steps when it fails.
- **Permissions declared, not parsed.** A mode gets only the tables, paths, secrets, hosts and commands its manifest names. Agents do not get a general shell.
- **All of today's modes:** Chief of Staff, forge, store, the mail and feed briefings with Gmail and X, todo, improve and delivery.

What it costs, stated plainly:

- Everything is rewritten: kernel, modes and tests. The 576 existing tests and the golden guard matrix cannot be reused, so the safety net of comparing old and new behaviour is gone. In its place, each builder reads the old tests of what it rebuilds and lists every behaviour as kept or dropped, and the reviewer checks that list.
- The new safety model is younger than the one it replaces. It is simpler and narrows the known bypass (code an agent runs outside the guard), but it has not been attacked yet, and the per-step hook has been tested only with sample inputs, not inside a live Claude Code session. Main stays on 4.0.0 until cutover, and a `v4` branch remains after it.
- The kernel budget of 4,000 lines is a target, not a measurement, and it never outranks code quality or readability. If the engine stage shows it cannot hold with clear code, the budget is what gives, and that comes back to you before the modes are built.

Release 5.0.0 is the cutover. 5.1 is the always-on cloud version, because the owner works from a phone; the Codex adapter follows as 5.2 (owner decision, 2026-11-14).

## Concepts: seven become three

| agentbay 4 | agentbay 5 |
|---|---|
| Mode with features and steps | **Mode** with actions; an action's `run` is an ordered list of skill steps and script steps |
| Connector, capability interface | A small **mode** that `implements` an **interface**; the interface is a set of action signatures with no code |
| Environment (bindings, secrets, hosts, paths, tiers) | The mode's own `resources:` block, plus `bindings:` in the project config |
| Role (lead, analyst, builder, reviewer, researcher) | A **skill** step with a tier (`fast`, `balanced`, `deep`) and an allow-list; review is a skill like any other |
| Playbook and rules file | The skill's Instructions, Definition of done and Rules sections |
| Agent profile | The adapter's tier-to-model table |
| Component, content type | A mode folder; a content type is a schema and views inside the mode that owns the data |
| `extends:` inheritance | Removed. The briefings and todo compose the store through its interface |
| Gate, plan approval | The `approval` workflow step, bound to the content it approves |
| Ledger, call state files | The `runs` and `events` tables in the kernel database |
| Guard, protected paths, use shims | Declared permissions enforced by the broker and the adapter (see Safety) |

## The kernel

Five parts, in `bay/`, with a line budget of 4,000 excluding generated types.

| Part | Does |
|---|---|
| Registry | Finds mode folders, loads and validates manifests, resolves interfaces to bound modes |
| Broker | Hands a run the resources its mode declared and nothing else: database, files, secrets, HTTP, events |
| Engine | Runs actions and workflows step by step, saving each step; approvals, waits, budgets, undo, resume |
| Policy | Turns a mode's `resources:` into the permission set of a run, for the broker and for the adapter |
| Check | `bay check`: validates manifests, schemas, skills, workflows, imports, dependency cycles and limits |

Around it: `bay/sdk.ts`, the only kernel file mode code may import; `bay/cli.ts`; and `bay/mcp.ts`, which serves the broker's resources and the callable actions to an agent as tools.

The layout:

```
bay/               kernel (budgeted), sdk.ts, cli.ts, mcp.ts
adapters/          claude-code/   codex/ (5.1)
schemas/           manifest, interface, skill, workflow, config
components/
  base/            interfaces/  store/  cos/  forge/  improve/  delivery/  typescript/
  modes/           gmail/  x/  mail-briefing/  feed-briefing/  todo/
tests/             kernel tests; each mode keeps its own tests/
```

A mode folder:

```
<mode>/
  mode.yaml          manifest
  skills/<name>/SKILL.md
  scripts/*.ts       deterministic code; imports only bay/sdk.ts
  workflows/*.yaml
  schemas/*.json     input and output types
  migrations/*.sql   its own tables and views
  tests/             example inputs and expected outputs per action
```

## The mode contract

```yaml
name: mail-briefing
version: 5.0.0
description: Syncs mail into the store and writes a daily digest

requires:
  interfaces: [items-source@1, items-store@1]

resources:
  db:      { migrations: migrations/ }
  files:   { write: [out/digests/] }
  secrets: []
  network: []
  commands: []

actions:
  sync:
    input:  schemas/sync-req.json
    output: schemas/sync-result.json
    effects: [read, write, network, spend]
    run:
      - call: items-source.fetch
      - call: items-store.put
  digest:
    input:  schemas/digest-req.json
    output: schemas/digest.json
    effects: [read]
    run:
      - script: scripts/select.ts
      - skill:  skills/digest
        tier:   balanced
      - script: scripts/check-citations.ts

workflows: [workflows/daily.yaml]
```

- A step is `script`, `skill` or `call` (an action of an interface the mode requires). Callers see only input and output.
- `effects` is declared and checked: a `call` may not have an effect its caller lacks.
- An action may name `undo: <action>`.
- A mode that serves an interface says `implements: [items-source@1]` and the project config binds it: `bindings: { items-source: gmail }`. The mail briefing never sees the Gmail token.

## The skill contract

A `SKILL.md` is a standard Agent Skill whose body has seven sections in this order. `bay check` rejects a skill that lacks one.

| Section | Holds | Checked |
|---|---|---|
| Input | What it receives, with its schema | The schema exists and matches the step before it |
| Output | What it returns, with its schema | The result is validated at run time |
| Definition of done | `- [DOD-n] (must\|should\|must_not) ...`; an item may name a script check | Script checks run after the skill; a failed must item sends it back, three rounds at most |
| Instructions | The steps | A length cap |
| Tools | The actions and resources it may call | A subset of the mode's manifest |
| Resources | Files, templates, tables and paths it may read or write | A subset of the mode's manifest |
| Rules and constraints | What it must never do | Present and not empty |

`bay new skill` writes the file with all seven headings.

## Workflows and runs

A workflow is a YAML list of steps of four kinds: `action`, `approval`, `wait`, `foreach`. Anything more belongs in a script.

- **Saved every step.** Input and output of each step go to the `runs` table before the next starts. `bay resume <run>` continues from the last finished step. A step with only `read` effects is run again without asking; any other unfinished step stops and asks you.
- **Approval binds content.** An `approval` step records the hash of what it showed. If that changes, the run returns to the approval.
- **Budget.** A workflow or action sets limits for items, dollars, tokens and minutes. Every nested call draws from the same budget. At the limit the run waits and asks whether to extend or stop.
- **Undo.** When a run fails for good, the engine runs the `undo` action of each finished step in reverse order and lists the steps that had none. `delete` effects are never undone automatically.
- **Skill steps wait.** A skill step puts the run in `waiting` with the task, tier, tools and schemas. The adapter decides who picks it up: the Claude Code session that made the call runs it as a subagent and submits the result, as today, or a headless process does. The engine does not know the difference, which is what lets the same kernel run always-on later.

## Safety

The threat model is unchanged: agent mistakes and overreach, prompt injection through data agents read, and modes that overreach. Not you.

What changes is where the rules live. Today they live in a hook that parses every shell command. In agentbay 5 they live in the mode's manifest, and three things enforce it:

1. **The broker.** Every database, file, secret, HTTP and action request from a skill or a script goes through the broker with the run's permission set. Not declared means denied. HTTP is checked against the mode's hosts. Secrets are fetched by name, never listed, and every value seen is redacted from output and logs.
2. **No shell for agents by default.** A skill step gets the kernel's tools and the harness's file tools limited to its declared paths. Tests and checks are script steps that the engine runs; their failures go back to the skill. A mode may list exact command prefixes under `commands:`; in 5.0.0 only `forge` does (for example `node --test`), so its builders can test as they work. The adapter writes one agent file per skill step and one hook that denies anything outside the step's tools, paths and commands. The hook compares against a list and allows only plain argument characters after a prefix; it does not parse shell. A listed command that runs code can run whatever the agent wrote, so `bay check` warns on every `commands:` entry and refuses one outside `components/base/`.
3. **Scripts run with a seat belt.** A script step runs in a child Node process started with a clean environment and the permission model on: file access limited to the mode's paths, no child processes, no workers. A preload refuses the network and SQLite modules, so a script reaches both only through the broker. Spike C showed what this is and is not: it stops mistakes, and it keeps secrets out of reach because none are in the environment or in a readable folder, but Node documents the permission model as a guard for trusted code, and on Node 22 it does not block the network. It narrows the bypass DESIGN.md names today; it does not close it.

The safety level rises with the audience, and each step is a gate before the next audience is let in:

| Audience | Added before it |
|---|---|
| The owner alone (5.0.0) | Everything above |
| A team | `commands:` removed from forge, so no agent has a shell; a per-run budget on every mode; a review of every installed mode's manifest |
| The public | One container per run with no network except through the broker; signed modes in the index; an outside security review |

Kept from today, by other means:

- **The kernel changes only through forge.** `bay/`, `schemas/`, `adapters/`, `framework/` and `components/base/` are writable only by forge's `extend` action, behind an approval. `bay check --base` rejects a change to them that no approved proposal lists.
- **Agent SQL is read-only and bounded.** Each mode has its own SQLite file. An agent query runs in a child process on a read-only connection to that file, wrapped so that only one SELECT can run, with a row limit and a time limit enforced by killing the process. Spike A showed this works on Node's own SQLite, that a worker cannot stop a runaway query, and that `attach` must be kept out by the wrapper because a read-only connection allows it.
- **Nothing an agent submits is trusted.** Outputs are validated against the schema and scanned for secrets before they are stored.

What is deliberately dropped: shell-command parsing, case-folded and inode path comparison in a hook, the use shims, per-role units, and the `agentbay/v4` kinds. Each is replaced above or no longer needed.

## Code standards

TypeScript publishes no official style guide. What is official is the compiler's options, the `erasableSyntaxOnly` rule set and the handbook's "Do's and Don'ts"; the rules start there. `components/base/typescript/` holds the configs, and forge's checks run them.

| Area | Rule | Enforced by |
|---|---|---|
| Compiler | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax` | `tsc --noEmit` |
| Modules | ES modules, named exports only, no file that only re-exports, no import cycle | eslint |
| Modules | Kernel core never imports `cli`, `mcp` or an adapter; mode code imports only `bay/sdk.ts` | eslint, `bay check` |
| Functions | Exported functions state parameter and return types; `unknown`, never `any` | typescript-eslint strict set |
| Functions | At most three positional parameters, then an options object; a complexity cap; unions instead of overloads | eslint |
| Classes | Only for something with state and a lifecycle (engine, broker, store). No inheritance. Fields `readonly` unless reassigned, private state as `#name` | eslint, review |
| Types | No `enum`; closed sets are discriminated unions and every `switch` over one is exhaustive; no `as` except `as const`; no `!` | eslint |
| Types | Manifest types are generated from `schemas/` and committed; a stale file fails the check | script |
| Effects | Files, git, processes, HTTP and the clock go through `bay/ports.ts`; core logic takes them as arguments | eslint, review |
| Errors | Problems a user can fix are returned as values, all at once; exceptions are for bugs | review |
| Readability | Prettier, width 120, no nested ternary, full words in names, no comment lines in kit code, no line packed to meet a limit | prettier, checks, review |
| Dead code | No unused file, export or dependency | knip |

Dependencies: `yaml`, `ajv` and the MCP SDK at run time; SQLite from Node itself unless spike A says otherwise. TypeScript, eslint, knip and prettier for development. Tests use Node's runner. Node runs the `.ts` files directly; there is no build folder.

## Limits

| Measure | Counts | Ceiling |
|---|---|---|
| `kernel_lines` | lines in `bay/*.ts`, generated types excluded | 4,000 |
| `adapter_lines` | lines per adapter | 800 |
| `sdk_exports` | names exported by `bay/sdk.ts` | written at cutover |
| `concepts` | manifest kinds in `schemas/` | 5 |
| `cli_commands` | entries in the command table | 12 |
| `top_level_folders` | as today | 7 |
| `long_lines`, `comment_lines` | as today, on `.ts` | 0 for comments; long lines written at cutover |

Ceilings only fall after cutover, as today.

## The modes

| Mode | In agentbay 5 |
|---|---|
| `store` | Implements `items-store`: put, update, delete, query, get, and bounded SQL over views. One SQLite file per composing mode. Keeps the scope rule and the remembered deletions |
| `gmail`, `x` | Implement `items-source`; hold their own secrets and hosts; each ships a fake for tests |
| `mail-briefing`, `feed-briefing` | Compose a source and the store: sync, digest, ask, prune |
| `todo` | Composes the store; agenda, complete, reopen, drop, delegate, track; rules as scripts |
| `cos` | The root mode: takes your request, calls actions and workflows of other modes, relays approvals |
| `forge` | `create` (scaffold a mode) and `extend` (proposal, plan, approval, implement, checks, review, release) as a workflow |
| `improve` | Scan, audit, triage, backlog, implement, verify, reading the `runs` and `events` tables and session transcripts |
| `delivery` | Research and build |

## Upgrading

- Install a recent Node; the spike fixes the minimum version.
- agentbay 4 projects are not read. Config is rewritten by hand from the new template.
- Synced items are fetched again from Gmail and X.
- `bay import-v4` copies local items (your to-dos and anything you added by hand) from the old store once. It is removed in 5.1.
- Run history in `events.jsonl` is not migrated; the file is left where it is.

## Out of scope for 5.0.0

The always-on cloud version with its daemon, schedules, events and a chat channel (5.1), the Codex adapter (5.2), a mode index with `bay install`, agent-to-agent protocols. The design leaves room for each and builds none.

## Measured and estimated

Measured on main a7a425d: 576 tests pass; 9,703 lines in `bay/`; 6,415 lines of Python under `components/`; 8 modes; 15 interface files; Node 22.23.4 runs `.ts` directly and its SQLite has no authorizer.

Estimated: the 4,000-line kernel; that Node's permission model can confine scripts as described; that Claude Code's permission settings can express a per-step allow-list; the minimum Node version. Spikes answer the last three before anything depends on them.
