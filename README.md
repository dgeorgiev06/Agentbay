# agentbay

Jobs for Claude Code, defined as data. You describe a **mode** (a job made of features): which of the
framework's **roles** do its steps, the **environment** each role works in, the capabilities it needs, and its
playbooks, skills and rules. **Connectors** do the deterministic work, and one **agent profile** says how an
LLM product runs the roles. agentbay checks the wiring, compiles it into Claude Code, and runs it through one
dispatcher that enforces schemas, effects, budgets and secrets, and logs every step.

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing (extends briefing), feature digest
        refresh   run: items.store/v1.sync   ─ code ─> Env local-feeds ─> corpus-store ─> x-api (api.x.com)
        gather    run: items.store/v1.query  ─ code
        themes    role: analyst    ─ subagent analyst--feed-briefing (balanced: sonnet) in Env local-feeds
        review    role: reviewer   ─ subagent reviewer--feed-briefing (deep: opus), from the feature's review block
```

The framework owns the five roles (`lead`, `analyst`, `researcher`, `builder`, `reviewer`) and the agent
profile (the `profile:` in `adapters/claude-code/adapter.yaml`, the only file that names models). You own modes, envs and
connectors. Modes name capabilities (`items.source/v1`), never tools; agents never see secrets or connectors.

Design: [docs/DESIGN.md](docs/DESIGN.md). Contracts: [docs/INTERFACES.md](docs/INTERFACES.md).

## Install

Python 3 and Claude Code. From a clone:

```bash
pip install -r requirements.txt        # pyyaml, jsonschema
./bay.sh check                         # lint + resolve everything
python3 tests/run.py                   # the test suite
```

## Quickstart (offline, 5 minutes)

```bash
./bay.sh build --project ~/code/my-repo   # writes a minimal agentbay.config.yaml when the project has none
# add `offline: true` to ~/code/my-repo/agentbay.config.yaml (fake sources, no network, no secrets), then:
./bay.sh build --project ~/code/my-repo
cd ~/code/my-repo && claude            # restart Claude Code after every build; accept the workspace trust prompt
```

Ask for a briefing, for example *"brief me on the last 3 days"*. The Chief of Staff calls the mode's digest
feature:

```bash
.agentbay/bay call feed-briefing.digest '{"since": "3d"}'
```

Code steps run in the dispatcher, agentic steps as subagents; the `reviewer` gives a verdict per Definition of
Done item. A change to the framework also passes a code step, `deadcode`, before review: `improve.detect/v1.change`
audits the tree and the tree at its merge-base with `origin/main`, and any new unused code or compatibility layer blocks the call. A second code step, `limits`, blocks a change that
pushes the framework past a ceiling in `framework/limits.yaml`; run `./bay.sh check --limits` by hand. A count below
its ceiling is a note (and may climb back to the base branch's value); `--write` (at release) writes it as the new ceiling; raising one needs an exception in the proposal.
Before the approval gate, a large or security-sensitive proposal also gets a plan (`docs/plans/<id>.md`, written by
the `lead` role); the gate binds the proposal and the plan. `approvals: { plan: large|always|never }` sets when (default `large`).

**Going live:** sign in as the source connector's `README.md` says, remove `offline: true` from
agentbay.config.yaml and rebuild. Budget caps stop a sync before it exceeds one.

## Settings

`bay config` prints every setting, with its type, default and description, from the schemas. `bay build`
writes a minimal `agentbay.config.yaml` when the project has none. Settings can only lower a cap: a value above
the env's `limits:` is refused by lint and at run time. Capabilities stay bound only in `envs/<env>.yaml`; an
env's `offline:` block names the stand-in sources that `offline: true` binds in their place.
A mode endpoint with a `schedule:` (daily, weekly) runs from cron: `bay check` prints the command to schedule.
For example, a weekly report on Mondays at 07:00:

```
0 7 * * 1  cd ~/code/my-repo && .agentbay/bay call improve.backlog '{}'
```

## Folder map

Each extension is a folder (an env is one file) with its own `README.md` and, if it takes settings, its own
`config.example.yaml`.

```
modes/           modes: yours, and the shipped cos, forge, improve, ...
envs/            envs, one file each (yours and the shipped ones)
connectors/      connectors (yours and the shipped ones)
content-types/   content types: fields, views and derived fields of a kind of item (post, email ship as examples)
interfaces/      your interfaces
adapters/        agent runtimes bay build compiles for, each with its agent profile
framework/       shipped with the kit, never edited by users:
  roles/           the five roles
  interfaces/      core interfaces
  rules/           conformance rules
  components.yaml  the component map: core paths, the contracts extensions implement, and a `protected:` block
                   naming what only forge.extend may change (folders, and the shipped modes, envs and connectors
                   that sit in modes/, envs/ and connectors/ among yours)
schemas/         the contracts (apiVersion agentbay/v3; a v2 file is refused with the fix) and data schemas
bay/             resolver, lint, dispatcher, guard hook, run log, CLI
coordinator/     Chief of Staff slash commands
tests/           python3 tests/run.py (connector tests live next to each connector)
```

`bay build` writes subagents, skills, commands, settings, hooks and `.agentbay/` into the project, tracked in
`.agentbay/manifest.json`; `bay clean` removes exactly that.

## Commands

| command | does |
|---|---|
| `bay check [--base <ref> --proposal <file>] [--limits [--write]]` | lint and resolve everything; with `--base`, also check a change against core ownership; `--limits` checks the ceilings, `--write` records lower counts (release only) |
| `bay build` / `bay clean` | compile into a project / remove what was generated |
| `bay catalog [<name>] [--roles]`, `bay describe <name>` | what is installed, resolved; `--roles` lists the role units |
| `bay show <mode> --resolved` | a mode's features after `extends`, with the file each comes from |
| `bay call <mode>.<endpoint> '<json>'` | run a feature |
| `bay submit <callId> <step> '<json>'`, `bay show <callId>`, `bay show reclaim <runId>` | hand back a step's output; current state; mark a stuck run reclaimed |
| `bay approve <callId\|runId> [--reject]` | pass an approval gate (your terminal; or `--via chat --quote "<msg>" --sha <hex>` (the sha256 prefixes of what you saw, `<proposal>+<plan>` when a plan exists), relayed by the Chief of Staff, when `approvals: { chat: true }` is set) |
| `bay approve <F-id> [--defer\|--wontfix]` | decide a backlog item from the analysis mode (your terminal only, never from chat) |
| `bay status [--agents\|--log]`, `bay note <ref> "text"` | calls, steps, cost, agent runs (grouped by role, mode, model, tier); the raw run log; a note |
| `bay note task`, `bay note dispatch <taskId> --agent <name> --input <x>`, `bay note review <taskId> '<json>'`, `bay plan <taskId> [--done <n>]` | agent run records: a fresh taskId; the Chief of Staff logs each dispatch and outside review; a subagent first records its outcome and to-do (`bay plan` is its only `bay` command) |
| `bay new mode\|feature\|connector\|env <name>` | create an extension from a template |
| `bay secret set <NAME>` | store a secret (read from your terminal, never echoed) |
| `bay auth <connector>` | a connector's browser login |
| `bay config` | print every agentbay.config.yaml setting, from the schemas |

Run as `./bay.sh <command>` in the kit, or `.agentbay/bay <command>` in a built project; extensions may add
commands (see their `README.md`).

## Adding things

A source is one connector plus one binding line in an env; a feature is `bay new feature`. A framework change
starts from a proposal that lists every core path it touches. Recipes:
[docs/INTERFACES.md#extension-recipes](docs/INTERFACES.md#extension-recipes).

## Safety, in one paragraph

The guard hook narrows what subagents can ask to do; it is defense in depth, not isolation, and cannot contain
code once something runs it. Nothing that runs code is auto-approved except a role's own read-only data shim;
the main thread is pre-approved only for `bay show|status|note|catalog`. Approval gates, secrets,
browser logins and backlog approvals need your terminal; gates alone can be opened to chat (`approvals: { chat: true }`,
off by default, recorded as `user@chat-via-cos`).
Details: [docs/DESIGN.md#safety-model](docs/DESIGN.md#safety-model).
