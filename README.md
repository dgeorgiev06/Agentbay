# agentbay

agentbay is a framework for extending AI agents with **modes**. You write a mode as configuration files, YAML
plus Markdown playbooks, not code: what it does, which role does each step, and what each step may touch. agentbay
checks that the pieces fit, turns them into agents for your runtime, and runs every step through one dispatcher.
The dispatcher lets an agent touch only what its environment allows, keeps secrets out of the agent's reach, stops
at the approvals you require, and logs every step. Claude Code is the supported runtime today; another LLM product
needs one new adapter, not new modes.

- **Chief of Staff**: your main agent session (in Claude Code today). You talk to it; it routes each request to a
  mode and runs the steps.
- **Mode**: an extension that adds a capability to agentbay, such as a daily digest of your inbox. It exposes
  **features**, the endpoints you call (`mail-briefing.digest`). Each feature is a list of steps with a
  definition of done and rules.
- **Role**: who does a step: `lead`, `analyst`, `researcher`, `builder` or `reviewer`. The framework owns the
  roles; a step names one.
- **Adapter and agent profile**: an adapter compiles agentbay for one LLM product, and its agent profile maps each
  tier to that product's models. `adapters/claude-code/` is the one adapter today and the only place models are named.
- **Environment (env)**: what a step may touch: which files, commands, network hosts and secrets.
- **Connector**: deterministic code that does the work agents must not do directly, such as reading Gmail or
  storing items. Agents never see a connector or a secret; they call it through an interface.
- **Capability interface**: a versioned contract, such as `items.source/v1`, between a mode and the
  connectors that serve it. A mode names interfaces, never connectors, so a source can be swapped.
- **Component**: one folder under `components/` with one manifest. It holds a mode, a source connector, a
  content type or shared parts, together with its envs, internal connectors, interfaces and tests.
- **Kernel**: the framework itself (`bay/`, `schemas/`, `framework/`, `adapters/`). Only the framework's
  change process may edit it.

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing (extends store), feature digest
        refresh   run: items.store/v2.sync   ─ code ─> Env local-feeds ─> corpus-store ─> x-api (api.x.com)
        gather    run: items.store/v2.query  ─ code
        themes    role: analyst    ─ subagent analyst--feed-briefing (balanced: sonnet) in Env local-feeds
        review    role: reviewer   ─ subagent reviewer--feed-briefing (deep: opus), from the feature's review block
```

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

Ask for a digest, for example *"brief me on the last 3 days"*. The Chief of Staff calls the digest feature of the
mode:

```bash
.agentbay/bay call feed-briefing.digest '{"since": "3d"}'
```

Code steps run in the dispatcher, and agentic steps run as subagents. The `reviewer` gives a verdict for each
Definition of Done item. A change to the framework also passes checks for new unused code and for growth past the
size ceilings in `framework/limits.yaml`, and a large proposal gets a written plan before you approve it. The
[safety model](docs/DESIGN.md#safety-model) describes each of these. `./bay.sh check --limits` runs the size check
by hand.

**Going live:** sign in as the source connector's `README.md` says, remove `offline: true` from
agentbay.config.yaml and rebuild. Budget caps stop a sync before it exceeds one.

## Settings

`bay config` prints every setting, with its type, default and description, from the schemas. `bay build`
writes a minimal `agentbay.config.yaml` when the project has none. Settings can only lower a cap: a value above
the env's `limits:` is refused by lint and at run time. Capabilities stay bound only in an env manifest
(`components/<name>/envs/<env>.yaml`). An env's `offline:` block names the stand-in sources that `offline: true`
binds in their place.
A mode endpoint with a `schedule:` (daily, weekly) runs from cron: `bay check` prints the command to schedule.
For example, a weekly report on Mondays at 07:00:

```
0 7 * * 1  cd ~/code/my-repo && .agentbay/bay call improve.backlog '{}'
```

## Folder map

Each component is a folder with its own `README.md` and, if it takes settings, its own `config.example.yaml`.
An env is one file inside the folder of the component it belongs to.

```
components/      one folder for each mode, source connector, content type or shared set (yours and the shipped ones)
adapters/        agent runtimes that bay build compiles for, each with its agent profile and slash commands
framework/       shipped with the kit, never edited by users:
  roles/           the five roles
  rules/           conformance rules
  kernel.yaml      the paths the kernel owns, and a `protected:` block naming what only forge.extend may change
  limits.yaml      the size ceilings
schemas/         the contracts (apiVersion agentbay/v4; a file with another version is refused with the fix) and data schemas
bay/             resolver, lint, dispatcher, guard hook, run log, CLI and the templates `bay new` writes from
docs/            DESIGN.md, INTERFACES.md and the proposals
tests/           python3 tests/run.py (the tests of a component live in its own tests/ folder)
```

`bay build` writes subagents, skills, commands, settings, hooks and `.agentbay/` into the project, tracked in
`.agentbay/manifest.json`. `bay clean` removes exactly that.

## Commands

| command | does |
|---|---|
| `bay check [--base <ref> --proposal <file>] [--limits [--write]]` | lint and resolve everything; with `--base`, also check a change against core ownership; `--limits` checks the ceilings, `--write` records lower counts (release only) |
| `bay build` / `bay clean` | compile into a project / remove what was generated |
| `bay catalog [<name>] [--roles]`, `bay describe <name>` | what is installed, resolved; `--roles` lists the role units |
| `bay show <mode> --resolved` | a mode's features after `extends`, with the file each comes from |
| `bay call <mode>.<endpoint> '<json>'` | run a feature |
| `bay submit <callId> <step> '<json>'`, `bay show <callId>`, `bay show reclaim <runId>`, `bay show close <callId> --reason <text>` | hand back a step's output; current state; mark a stuck run reclaimed; end an open call as abandoned |
| `bay approve <callId\|runId> [--reject]` | pass an approval gate in your terminal, or from chat when `approve.from` lists chat |
| `bay approve <F-id> [--defer\|--wontfix]` | decide a backlog item from the analysis mode (follows `approve.from`, like a gate) |
| `bay status [--agents\|--log]`, `bay note <ref> "text"` | calls, steps, cost, agent runs (grouped by role, mode, model, tier); the raw run log; a note |
| `bay note task`, `bay note dispatch <taskId> --agent <name> --input <x> [--unguarded <reason>]`, `bay note done <taskId>`, `bay note review <taskId> '<json>'`, `bay plan <taskId> [--done <n>]` | agent run records: a fresh taskId; the Chief of Staff logs each dispatch, its finish and outside review; a subagent first records its outcome and to-do (`bay plan` is its only `bay` command) |
| `bay new mode <name>`, `bay new feature <name> --mode <mode>`, `bay new connector <name> --implements <interface>`, `bay new env <name> --mode <mode>` | create a component, a feature, a source connector or an env from a template |
| `bay secret set <NAME>` | store a secret (read from your terminal, never echoed) |
| `bay auth <connector>` | a connector's browser login (Claude Code asks first; needs the browser on this machine) |
| `bay config` | print every agentbay.config.yaml setting, from the schemas |

Run as `./bay.sh <command>` in the kit, or `.agentbay/bay <command>` in a built project. A component's `README.md`
lists any commands it adds.

## Adding things

A source is one component plus one binding line in the mode's env. A feature is `bay new feature`. A framework
change starts from a proposal that lists every core path it touches. For example, a new source starts with
`bay new connector <name> --implements items.source/v1`, which creates the folder `components/<name>/`. Recipes:
[docs/INTERFACES.md#extension-recipes](docs/INTERFACES.md#extension-recipes).

**Chain modes.** A project workflow in `agentbay.config.yaml` runs one mode's endpoint, then an approval gate, then
another mode's endpoint:

```yaml
workflows:
  morning:
    description: Digest my mail, then draft replies I approve
    steps:
      - { id: digest, call: mail-briefing.digest, with: { since: "1d" } }
      - { id: ok, gate: "Draft replies for the threads that need one?" }
      - { id: drafts, call: delivery.build, with: { goal: "Draft replies to the threads in the digest that need one", deliverable: "drafts/<date>.md with one draft per thread; nothing is sent" } }
```

You start it by asking the Chief of Staff, and the drafting step never sends mail; it only drafts. A `with` value is
substituted only when the whole value is one reference such as `$steps.digest.notes`, and `delivery.build` takes
text for its `goal` and `deliverable`, so the example states them in words.

## Safety, in one paragraph

The guard hook narrows what subagents can ask to do; it is defense in depth, not isolation, and cannot contain
code once something runs it. Nothing that runs code is auto-approved except a role's own read-only data shim;
the main thread is pre-approved only for `bay show|status|note|catalog`. `bay secret set`
needs your terminal. Approval gates and backlog approvals follow `approve.from` in agentbay.config.yaml (default
`[terminal]`; chat is recorded as `user@chat-via-cos`). `approve.plans` makes a listed step show its plan for your
approval before it runs. `bay auth` asks first in Claude Code.
Details: [docs/DESIGN.md#safety-model](docs/DESIGN.md#safety-model).
