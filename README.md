# agentbay

Jobs for Claude Code, defined as data. You describe a **mode** (a job with
endpoints), the **roles** that do its steps, the **agents** that run those roles,
the **environment** each agent may touch, and the **connectors** that do the
deterministic work. agentbay checks that it all wires up, compiles it into
Claude Code, and runs it through one dispatcher that enforces schemas, effects,
budgets and secrets, and logs every step.

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing, feature digest
        refresh   run: feed.store.sync   ─ code ─> Env local-feeds ─> Connector local-store ─> Connector x-api (api.x.com)
        gather    run: feed.store.query  ─ code
        themes    role: feed-analyst     ─ Agent analyst (subagent, sonnet) in Env local-feeds
        review    role: reviewer         ─ Agent critic (subagent, opus), from the feature's review block
```

Read it top to bottom: **mode -> role -> agent -> env -> connector**. Modes name
capabilities (`feed.source/v1`), never tools. Agents never see secrets or connectors.
Design: [docs/DESIGN-v0.2.md](docs/DESIGN-v0.2.md). Contracts: [docs/INTERFACES.md](docs/INTERFACES.md).

## Quickstart (5 minutes, offline)

```bash
pip install pyyaml jsonschema
./bay.sh validate                                   # lint + resolve everything
cp agentbay.config.example.yaml ~/code/my-repo/agentbay.config.yaml   # binds the fake source
./bay.sh --project ~/code/my-repo build             # compile into a repo
cd ~/code/my-repo
.agentbay/bay call feed-briefing.sync '{}'          # pulls sample posts into .agentbay/data/feeds
.agentbay/bay call feed-briefing.ask '{"question": "what is new in staking?"}'
claude                                              # your session is now the Chief of Staff
```

`ask` returns `needs-agent` with a step plan; inside Claude Code the Chief of Staff
runs it as the `feed-analyst` subagent and submits the answer with `bay submit`.
Try `/bay-team`, `/bay-delegate brief me on this week`, `/bay-status`.

### Real X timeline

1. Create an X app with OAuth 2.0 (scopes `tweet.read users.read offline.access`) and authorize your account.
2. Store the secrets (macOS keychain; values are read from stdin, never echoed):
   `./bay.sh secret set X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`.
   On Linux set `secrets: {provider: env}` and export them instead.
3. In `agentbay.config.yaml` set `bindings.local-feeds.feed.source/v1: [x-api]` and `connectors.x-api.userId`.
4. Caps: `maxPostsPerRun`, `monthlyPosts`, `spendUsd` (at `costPerPostUsd`, default $0.005). Sync stops and
   says which cap stopped it before exceeding one.

## What ships

```
schemas/               the contracts (agentbay/v2) + data schemas
interfaces/            feed.source/v1, feed.store/v1
modes/feed-briefing/   sync, digest, ask, prune (features/<f>/playbook.md + rules.yaml)
modes/delivery/        research, build (+review): the v0.1 behaviour
roles/  agents/  envs/ feed-lead, feed-analyst / analyst, lead / local-feeds
connectors/            x-api (official X API v2), local-store (JSONL store), fake (offline)
framework/             shipped with the kit, never edited by users:
  modes/forge/         create | extend | migrate - agentbay building agentbay
  roles/               researcher, builder, reviewer, forge-lead
  agents/ envs/        worker, critic, author, framework-builder / workspace, local-authoring, framework-dev
coordinator/           Chief of Staff prompt + slash commands
bay/                   resolver, lint, dispatcher, connectors runtime, adapter, ledger, hook, CLI
tests/                 python3 tests/run.py
```

## Everyday commands

| command | does |
|---|---|
| `bay validate` / `bay lint` | check everything / just structure (file:line errors) |
| `bay build` / `bay clean` | compile into a project / remove exactly what was generated |
| `bay ls`, `bay describe <mode\|role>` | what exists, fully resolved |
| `bay call <mode>.<endpoint> '<json>'` | run a feature |
| `bay submit <callId> <step> '<json>'` | hand back a step's output or approve a gate |
| `bay status`, `bay log` | calls, steps, agent runs, cost |
| `bay mode\|feature\|role\|connector\|env new <name>` | scaffold (same templates as `forge.create`) |
| `bay migrate [--confirm]` | migrate your content to this version (dry run by default) |

## Adding things

- **A source** (e.g. Bluesky): `bay connector new bsky --implements feed.source/v1`, implement `fetch`,
  add `bsky` to `feed.source/v1` in `envs/local-feeds.yaml`. Nothing else changes.
- **A feature**: `bay feature new weekly --mode feed-briefing --role feed-analyst --effects read`; fill the
  playbook's Definition of Done and the rules; `bay lint`. Review is on by default for write/spend/delete features.
- **Your own rules** on a shipped feature: `modes.<mode>.features.<feature>.extraRules: <rules.yaml>` in
  `agentbay.config.yaml` (strictest wins).

## Generated in the target project

All tracked in `.agentbay/manifest.json` and removed by `clean`; your CLAUDE.md, settings and MCP servers are preserved.

| file | from |
|---|---|
| `.claude/agents/<role>.md` | each worker role placement (`<role>--<agent>.md` when a feature re-places it) |
| `.claude/skills/<skill>/` | role and mode skills |
| `.claude/commands/bay-*.md` | coordinator commands |
| `.claude/settings.json` | merged: narrow `Bash(<prefix>:*)` permissions + ledger hooks |
| `CLAUDE.md` | one marked import line -> `.agentbay/COORDINATOR.md` (Chief of Staff + mode coordinator playbooks) |
| `.agentbay/catalog.json`, `.agentbay/bay` | modes/endpoints/roles catalog; project control-plane shim |
| `.agentbay/{ledger,calls,data}/` | runtime state (gitignored) |

## Honest limits of the Claude Code runtime

- Skills and CLI permissions are project-wide in Claude Code. Per-role scope is the subagent `tools`
  allowlist plus the dispatcher (`bay use` checks each role's grants; connectors only run in `bay call`).
- Subagents cannot spawn subagents, so mode coordinators run as playbooks in the main thread. A future
  `headless` runtime makes them separate agents without changing mode files.
- New or changed roles load when Claude Code starts; restart after `build`.
- Hooks never block the session; failures go to `.agentbay/ledger/hook-errors.log`.

## Roadmap

1. `headless` (`claude -p`) and cloud runtimes behind the same Agent/runtime field.
2. Ledger -> SQLite behind the same API; per-call cost dashboards.
3. More sources as connectors (Bluesky, RSS) - one binding line each.
