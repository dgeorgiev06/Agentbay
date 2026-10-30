# agentbay

Jobs for Claude Code, defined as data. You describe a **mode** (a job with endpoints): which of the
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
profile (`framework/agents/claude-code.yaml`, the only file that names models). You own modes, envs and
connectors. Modes name capabilities (`items.source/v1`), never tools; agents never see secrets or connectors.

Design: [docs/DESIGN.md](docs/DESIGN.md). Contracts: [docs/INTERFACES.md](docs/INTERFACES.md).

## Install

Python 3 and Claude Code. From a clone:

```bash
pip install -r requirements.txt        # pyyaml, jsonschema
./bay.sh validate                      # lint + resolve everything
python3 tests/run.py                   # the test suite (stdlib runner; pytest works too)
```

## Quickstart (offline, 5 minutes)

```bash
cp agentbay.config.example.yaml ~/code/my-repo/agentbay.config.yaml   # selects the offline envs (fake sources)
./bay.sh build --project ~/code/my-repo
cd ~/code/my-repo && claude            # restart Claude Code after every build; accept the workspace trust prompt
```

Ask for a briefing, for example *"brief me on the last 3 days"*. The Chief of Staff calls the mode's digest
feature:

```bash
.agentbay/bay call feed-briefing.digest '{"since": "3d"}'
```

Code steps run in the dispatcher; agentic steps run as subagents, and the `reviewer` gives one verdict per
Definition of Done item. `bay status` shows calls, steps and cost.

**Going live:** sign in as the source connector's `README.md` says, delete that env's entry from the `envs:`
offline switch in agentbay.config.yaml and rebuild. Budget caps stop a sync before it exceeds one.

## Settings

`agentbay.config.example.yaml` lists the settings of every installed extension. It is generated:
`bay config example` assembles it from each extension's `config.example.yaml`, and lint fails when it is
stale. Settings can only tighten limits; capabilities stay bound only in `envs/<env>.yaml`.

## Folder map

Each extension is a folder (an env is one file) with its own `README.md` and, if it takes settings, its own
`config.example.yaml`. `bay ls` and `bay catalog` list what is installed.

```
modes/           your modes
envs/            your envs (one file each)
connectors/      your connectors
interfaces/      your interfaces
adapters/        agent runtimes bay build compiles for
framework/       shipped with the kit, never edited by users:
  roles/ agents/   the five roles and the agent profile
  modes/ envs/ connectors/   framework extensions (cos, forge, improve, ...)
  interfaces/      core interfaces
  rules/           conformance rules
  components.yaml  core paths and the contracts extensions implement
schemas/         the contracts (apiVersion agentbay/v2) and data schemas
bay/             resolver, lint, dispatcher, guard hook, run log, CLI
coordinator/     Chief of Staff slash commands
tests/           python3 tests/run.py (connector tests live next to each connector)
```

`bay build` writes subagents, skills, commands, settings, hooks and `.agentbay/` into the project, tracked in
`.agentbay/manifest.json`; `bay clean` removes exactly that.

## Commands

| command | does |
|---|---|
| `bay validate` / `bay lint` | check everything / just structure |
| `bay build` / `bay clean` | compile into a project / remove what was generated |
| `bay ls`, `bay describe <name>`, `bay catalog` | what is installed, resolved |
| `bay call <mode>.<endpoint> '<json>'` | run a feature (schedules: from your cron) |
| `bay submit <callId> <step> '<json>'`, `bay show <callId>` | hand back a step's output; current state |
| `bay approve <callId\|runId> [--reject]` | pass an approval gate (your terminal; or `--via chat --quote "<msg>"`, relayed by the Chief of Staff, when `approvals: { chat: true }` is set) |
| `bay status`, `bay log`, `bay note <ref> "text"` | calls and cost; the run log; a note |
| `bay mode\|feature\|connector\|env new <name>` | create an extension from a template |
| `bay secret set <NAME>` | store a secret (read from your terminal, never echoed) |
| `bay auth <connector>` | a connector's browser login (again when a sync says it expired) |
| `bay config example` | regenerate agentbay.config.example.yaml |
| `bay boundary --base <ref> --proposal <file>` | check a change against core ownership |

Run them as `./bay.sh <command>` in the kit, or `.agentbay/bay <command>` in a built project. Framework
extensions may add commands of their own; their `README.md` lists them.

## Adding things

A source is one connector plus one binding line in an env; a feature is `bay feature new`. A framework change
starts from a proposal that lists every core path it touches. Recipes:
[docs/INTERFACES.md#extension-recipes](docs/INTERFACES.md#extension-recipes).

## Safety, in one paragraph

The guard hook is defense in depth, not isolation: it narrows what subagents can ask to do, but cannot contain
code once something runs it. Nothing that runs code is auto-approved except a role's own read-only data shim;
the main thread is pre-approved only for `bay show|status|log|note|task|catalog`. Approval gates, secrets,
browser logins and backlog approvals need your terminal; gates alone can be opened to chat (`approvals: { chat: true }`,
off by default, recorded as `user@chat-via-cos`).
Details: [docs/DESIGN.md#safety-model](docs/DESIGN.md#safety-model).
