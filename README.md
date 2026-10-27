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
        refresh   run: feed.store/v1.sync   ─ code ─> Env local-feeds ─> Connector local-store ─> Connector x-api (api.x.com)
        gather    run: feed.store/v1.query  ─ code
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
cp agentbay.config.example.yaml ~/code/my-repo/agentbay.config.yaml   # selects the offline env (fake source)
./bay.sh build --project ~/code/my-repo             # compile into a repo
cd ~/code/my-repo
claude                                              # (re)start Claude Code after every build; accept the
                                                    # workspace trust prompt so agentbay's hooks run
```

Then ask: *"brief me on the last 3 days"*. The Chief of Staff runs the digest:

1. `.agentbay/bay call feed-briefing.digest '{"since": "3d"}'` - the dispatcher syncs the store from the
   source (code, no agent), gathers stored posts and returns `needs-agent` for step `themes`.
2. It runs the `feed-analyst` subagent with the plan (playbook, rules, Definition of Done, posts) and
   submits its Digest: `.agentbay/bay submit <callId> themes '<digest json>'`.
3. Deterministic checks run (every citation is a stored post), then `needs-agent` for step `review`:
   the `reviewer` subagent (opus) returns one verdict per DoD/rule id; `.agentbay/bay submit <callId> review '<verdict>'`.
4. The call ends `done` (or `partial` if a must item failed) with the digest, check results and cost.
   `.agentbay/bay status` shows the call, its steps and posts/USD used.

You can drive the same steps by hand from a shell; `feed-briefing.sync` and `feed-briefing.prune`
are pure code and finish in one call.

### Real X timeline

1. Create an X app with OAuth 2.0 (scopes `tweet.read users.read offline.access`) and authorize your account.
2. Store the secrets (macOS keychain; values are read from stdin, never echoed):
   `./bay.sh secret set X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`.
   On Linux set `secrets: {provider: env}` and export them instead.
3. In `agentbay.config.yaml` delete the `envs: { local-feeds: local-feeds-offline }` line (the one offline
   switch), set `connectors.x-api.userId`, and rebuild. `envs/local-feeds.yaml` already binds `x-api`; envs are
   the only place capabilities are bound.
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
| `bay call <mode>.<endpoint> '<json>'` | run a feature (cron it for features with `schedule:`; nothing runs schedules for you) |
| `bay submit <callId> <step> '<json>'` | hand back a step's output or approve a gate |
| `bay status`, `bay log` | calls, steps, agent runs, cost |
| `bay mode\|feature\|role\|connector\|env new <name>` | scaffold (same templates as `forge.create`) |
| `bay migrate [--confirm]` | migrate your content to this version (dry run by default) |

## Adding things

- **A source** (e.g. Bluesky): `bay connector new bsky --implements feed.source/v1`, implement `fetch`,
  then in `envs/local-feeds.yaml` add `bsky` to the `feed.source/v1` binding and add its API host to
  `network.allow` and its secret names to `secrets.allow`. Modes, roles and playbooks do not change.
- **A feature**: `bay feature new weekly --mode feed-briefing --effects read` (role defaults to the mode's
  first worker role); fill the
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
| `.agentbay/roles/<role>/use`, `.agentbay/guard.json` | per-role read-only data shim; per-subagent Bash policy for the guard hook |
| `.agentbay/{ledger,calls,data}/` | runtime state (gitignored) |

## Safety model

**The guard is defense in depth, not isolation.** agentbay narrows what Claude Code subagents can ask to do;
it cannot contain code once something runs it. Hard isolation needs an OS sandbox (next release).

- **Nothing that runs code is auto-approved.** The only thing agentbay lets run without a prompt is a role's own
  read-only data shim (`.agentbay/roles/<role>/use`), which runs only kit code (an isolated script with
  `python3 -E`, so files in your project can't be imported); in the agentbay checkout itself, where roles can
  edit the connectors it runs, even the shim prompts. Every other subagent command (git, `./bay.sh`, test runners,
  interpreters) prompts you. In the main thread only `bay show|status|log|note|task` are pre-approved;
  `bay call` and `bay submit` run connector code, so Claude Code asks each time.
- **Approval gates are yours:** `bay approve <callId>` works only in your own terminal.
- **What subagents cannot touch** (guard hook on Bash and every file tool, plus `Edit` deny rules in
  settings.json): `.agentbay/` (control plane, store, call state), `.claude/`, `.git`, `CLAUDE.md`, `.mcp.json`,
  `agentbay.config.yaml`, `.env*`, `.envrc`, `Makefile`, `bay.sh`, `.vscode/`, `.idea/`, `.github/workflows/`,
  and the kit. Paths are compared case-insensitively where the disk is, and by inode for symlink aliases (hard links are not detected; that needs the OS sandbox). A role writes only inside
  its env's `fs.write`, and roles without write tools write nothing.
- **Fail closed:** a crashing or timed-out guard blocks the call (`onFailure: block`, Claude Code >= 2.1.295).
- **forge.extend** (changes the framework and runs its tests) is installed only when you build agentbay into
  its own checkout.
- Hooks run after you accept the workspace trust prompt and need a Claude Code version that sends
  `agent_type`/`agent_id` in hook input.

## Other limits of the Claude Code runtime

- Subagents cannot spawn subagents, so mode coordinators run as playbooks in the main thread. A future
  `headless` runtime makes them separate agents without changing mode files.
- New or changed roles load when Claude Code starts; restart after every `build`.
- Builders work in the project checkout, not separate worktrees (the guard cannot identify a subagent's worktree).
- Ledger hooks never block the session; failures go to `.agentbay/ledger/hook-errors.log`.

## Roadmap

1. `headless` (`claude -p`) and cloud runtimes behind the same Agent/runtime field.
2. Ledger -> SQLite behind the same API; per-call cost dashboards.
3. More sources as connectors (Bluesky, RSS) - one binding line each.
