# agentbay

Jobs for Claude Code, defined as data. You describe a **mode** (a job with
endpoints): which of the framework's **roles** do its steps, the **environment**
each role works in, the capabilities it needs, and its playbooks, skills and rules.
**Connectors** do the deterministic work, and one **agent profile** says how an LLM
product runs the roles. agentbay checks that it all wires up, compiles it into
Claude Code, and runs it through one dispatcher that enforces schemas, effects,
budgets and secrets, and logs every step.

**Who owns what.** The framework owns the roles (five generic jobs: `lead`, `analyst`, `researcher`,
`builder`, `reviewer`) and the agent profile (`framework/agents/claude-code.yaml`, the only file that names
models). You own modes, envs and connectors: a mode customizes the roles with its playbooks, skills and rules,
and its `roles:` map says where each one works.

| Concept | Answers | You write it? |
|---|---|---|
| Role | what the job is (prompt, doneWhen, default tier: fast, balanced or deep) | no: framework |
| Mode | what this assignment is, and which env each role works in (`roles:`) | yes |
| Agent profile | how one LLM product runs roles (tier -> model) | no: framework; pick it with `agent:` |
| Env | what a role can touch (bindings, secrets, network, files, allowed tiers) | yes |

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing (extends briefing), feature digest
        refresh   run: items.store/v1.sync   ─ code ─> Env local-feeds ─> Connector corpus-store ─> Connector x-api (api.x.com)
        gather    run: items.store/v1.query  ─ code
        themes    role: analyst    ─ subagent analyst--feed-briefing (balanced: sonnet) in Env local-feeds
        review    role: reviewer   ─ subagent reviewer--feed-briefing (deep: opus), from the feature's review block
```

Read it top to bottom: **mode -> role (in the env the mode's `roles:` names) -> connector**. Modes name
capabilities (`items.source/v1`), never tools; a role may read the read-only endpoints of the capabilities its
mode needs, through its env. Agents never see secrets or connectors.

```yaml
# modes/briefing/mode.yaml (excerpt)
coordinator: lead
roles: { lead: local-feeds, analyst: local-feeds, reviewer: local-feeds }   # role -> env
needs: [items.store/v1, items.source/v1]
```

A feature (`endpoints.<f>.roles`) or a workflow step (`roles:` on the step) can put a role in another env for
just that feature or step; a child mode inherits the map and overrides entries. A step or feature may set
`tier:`/`effort:`; otherwise the role's default applies, and an env may cap the tiers it allows.
Code steps (e.g. `sync`, `prune`) run in the coordinator's (lead's) env, so the store a mode fills is the one
bound there. To move a store-reading mode to another env, move the lead together with its other roles; `bay lint`
warns when a partial `roles:` override puts a role in an env with different `items.store`/`items.source`
bindings.
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

1. `.agentbay/bay call feed-briefing.digest '{"since": "3d"}'` - the dispatcher syncs the corpus store from
   the source (code, no agent), gathers stored posts and returns `needs-agent` for step `themes`.
2. It runs the `analyst--feed-briefing` subagent (role analyst in mode feed-briefing) with the plan (playbook, rules, Definition of Done, posts) and
   submits its Digest: `.agentbay/bay submit <callId> themes '<digest json>'`.
3. Deterministic checks run (every citation is a stored item's url or id), then `needs-agent` for step `review`:
   the `reviewer` subagent (opus) returns one verdict per DoD/rule id; `.agentbay/bay submit <callId> review '<verdict>'`.
4. The call ends `done` (or `partial` if a must item failed) with the digest, check results and cost.
   `.agentbay/bay status` shows the call, its steps and posts/USD used.

Questions work the same way: *"what did people say about Solana custody?"* runs `feed-briefing.ask`. The
analyst answers through read-only SQL: it runs `items.store/v1.describe`, narrows with `items.store/v1.sql`,
whose input is `{"sql": "<one SELECT>", "limit": <optional rows>}`, for example
`.agentbay/roles/analyst--feed-briefing/use items.store/v1.sql '{"sql": "SELECT id, url FROM v_posts WHERE text LIKE '\''%custody%'\''"}'`
or full text with `SELECT id, url, snippet FROM v_fts WHERE fts MATCH 'solana AND custody' ORDER BY rank`, then
reads the few posts it relies on with `items.store/v1.get`,
and cites item ids (`x:1849...`). The Chief of Staff turns the ids into links when it delivers the answer.

You can drive the same steps by hand from a shell; `feed-briefing.sync` and `feed-briefing.prune`
are pure code and finish in one call.

### Selectors: what to keep

`modes.feed-briefing.selectors` in agentbay.config.yaml says which posts are kept. The default `[{id: home}]`
keeps the home timeline, as in v0.2:

```yaml
modes:
  feed-briefing:
    selectors:
      - { id: home }                                     # the home timeline (default)
      - { id: staking, in: list:1585430245762441216 }    # an X List (needs scope list.read)
      - { id: vitalik, from: vitalik, not: { text: giveaway } }
```

Fields: `from`, `to`, `subject`, `text`, `in` (folder, label, list, channel), `has` (`link` or `attachment`),
`since`, `not`. Fields within a selector are ANDed, selectors are ORed, and `not` excludes. Matching is
case-insensitive. `*` is the only wildcard, and only in `from`/`to` (`*@bank.example`); such a field is matched
locally, after the fetch. Each source connector declares which
fields its own search handles (`spec.selectors` in connector.yaml). The store fetches with that native part
and then re-applies the whole selector with one shared matcher, so behaviour is the same on every source.

Every item records `matched: [selector ids]`, so a digest or question can be scoped with `{"selector": "staking"}`.

- Change a selector and the next sync re-matches stored posts without refetching them.
- Add one and it backfills its lookback window.
- Remove one and the next sync or prune deletes the posts only it matched (digest and ask sync first when
  the selectors changed).

The store only ever holds what the mode's selectors match from the sources bound to its env: switching from
the offline env to the real one, or unbinding a source, removes that source's items on the next sync, even
if the fetch itself then fails. Until then every read is refused with a message saying to run
`feed-briefing.sync`, so posts outside the new scope never show up in an answer.

`bay validate` errors on a field a source cannot express. It warns when a field is matched only locally on
a paid source (for example `text` on X, where every post the native query returns is billed).

### Upgrading a v0.2 store

v0.2 kept posts in `.agentbay/data/feeds/posts.jsonl` + `state.json`; v0.3 uses one SQLite file per mode
(`.agentbay/data/feeds/feed-briefing/corpus.db`, owner-only). Convert it once, yourself (agents never write
`.agentbay/`): `./bay.sh migrate --project ~/code/my-repo` shows a dry-run diff; add `--confirm` to apply.
Bad lines or a damaged `state.json` are reported as file:line with the fix, and nothing is converted until
they are fixed. Cursors, coverage, monthly budget, deletions and deletion-check times are kept, so the
next sync is incremental and posts deleted at the source never come back. The old files are renamed
`*.v0.2.bak`, not deleted.

Your own v0.2 modes, envs and connectors keep working in 0.4.x. Their old names resolve to the new
ones: `feed.source/v1` and `feed.store/v1` become `items.*`, `feed-analyst` and `feed-lead` become
`analyst` and `lead`, and `local-store` becomes `corpus-store`. `bay lint` warns about each such file. `./bay.sh migrate`
(then `--confirm`) rewrites those files. A connector you wrote against the old `fetch(sinceId, startTime,
maxPosts, checkIds)` cannot be rewritten automatically. If an env binds it, `bay lint`, `validate` and `build`
fail and say how to port it. If no env binds it, it is only a warning: the connector is skipped and the rest
of the kit builds.

### Upgrading 0.3 content (roles, agents, envs)

0.4 keeps the 0.3 shape working for one release, with a `bay lint` warning per file, and
`./bay.sh migrate` (dry run; `--confirm` applies) rewrites it:

- `roles: [a, b]` and an endpoint's `agents: {role: agent}` become the `roles:` map (the env of each role's
  0.3 agent), plus the `needs` those roles used (access now comes from the mode);
- `inference` and a review's `model` become `tier`/`effort` where they changed the outcome; an env's
  `models` becomes `tiers`;
- your per-role agent files are folded away (one framework profile runs every role);
- the old role names become `analyst` (briefing-analyst, improve-analyst, auditor) and `lead`
  (briefing-lead, improve-lead, forge-lead);
- a role file of your own is an error (roles are framework-level); migrate turns it into a skill of the mode
  that uses it, run by the closest framework role, or tells you what to do by hand;
- the caps `maxPostsPerRun` and `monthlyPosts` are now `maxItemsPerRun` and `monthlyItems` (also in your
  agentbay.config.yaml with `--project`).

### Real X timeline

1. Create an X app with OAuth 2.0 (scopes `tweet.read users.read offline.access`, plus `list.read` if you
   use `in: list:<id>` selectors) and authorize your account.
2. Store the secrets (macOS keychain; values are read from stdin, never echoed):
   `./bay.sh secret set X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN`.
   On Linux set `secrets: {provider: env}` and export them instead.
3. In `agentbay.config.yaml` delete the `envs: { local-feeds: local-feeds-offline }` line (the one offline
   switch), set `connectors.x-api.userId`, and rebuild. `envs/local-feeds.yaml` already binds `x-api`; envs are
   the only place capabilities are bound.
4. Caps: `maxItemsPerRun`, `monthlyItems`, `spendUsd` (at `costPerPostUsd`, default $0.005). Sync stops and
   says which cap stopped it before exceeding one.

## What ships

```
schemas/               the contracts (agentbay/v2) + data schemas
interfaces/            items.source/v1, items.store/v1
modes/briefing/        abstract base: sync, digest, ask, prune (features/<f>/playbook.md + rules.yaml),
                       skills digest, grounded-qa, corpus-sql
modes/feed-briefing/   extends briefing: X posts (own purpose, caps, configDefaults, sync input)
modes/delivery/        research, build (+review): the v0.1 behaviour
envs/                  local-feeds, local-feeds-offline
connectors/            x-api (official X API v2: home timeline, Lists, user timelines), fake (offline)
framework/             shipped with the kit, never edited by users:
  modes/forge/         create | extend | migrate - agentbay building agentbay
  modes/improve/       scan | audit | triage | backlog | implement | verify - evidence-backed improvement backlog
  rules/conformance.yaml  semantic framework rules (forge reviewers + improve.audit)
  roles/               lead, analyst, researcher, builder, reviewer (generic jobs; modes customize them)
  agents/              claude-code (the agent profile: runtime per kind, tier -> model)
  envs/                workspace, research, local-authoring, framework-dev, improve-local
  interfaces/ connectors/  session.events, review.verdicts, artifacts.read, improve.detect, improve.findings /
                       corpus-store (SQLite items store + SQL sandbox), ledger, git, claude-transcripts,
                       artifact-graph, improve-detect, improve-store, migrator, scaffold
coordinator/           Chief of Staff prompt + slash commands
bay/                   resolver (incl. mode `extends`), lint, dispatcher, connectors runtime, adapter, ledger,
                       hook, CLI, selector.py (shared matcher), sqlsandbox.py (read-only agent SQL);
                       bay/improve/ (transcript parser, detectors, conformance checks, findings store)
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
| `bay mode\|feature\|connector\|env new <name>` | scaffold (same templates as `forge.create`; roles are framework-level) |
| `bay migrate [--confirm] [--project <repo>]` | migrate your content (and that project's v0.2 store) to this version (dry run by default) |
| `bay note <ref> "text" [--instruction]` | record a note (or a mid-run instruction change) on a run, task or call; never creates a run |
| `bay improve weekly` / `bay improve decide <id> approve\|defer\|wontfix` | weekly improve pass / your decision on a backlog item (approve: your terminal only) |

## Improving agentbay and your modes (`improve`)

`improve` is a framework mode that finds what keeps going wrong, with evidence, and never edits anything itself.

- **scan** (sessions): turns the ledger, git history and your Claude Code transcripts (`~/.claude/projects`) into
  redacted episodes and runs detectors: review rounds above 1, the same rule failing repeatedly, blockers a check
  could catch, mid-run instruction changes (`bay note <ref> "..." --instruction`), out-of-scope additions, slow or
  costly steps, repeated identical tool calls, permission prompts/denials, interrupts, repeated status questions,
  environment gaps (missing commands/modules, blocked network, sandbox denials), reverts and churn.
  Transcripts are parsed defensively and **always redacted**: only structure and metadata (counts, tool names,
  input hashes, durations, tokens, cost) are kept, never conversation text. Symlinks are not followed.
- **audit** (code and content): slop (filler phrases, duplicate rules, comments that restate code, padded
  messages), unused code and concepts (no reference AND no ledger use), inefficiency (whole-store reads per query,
  calls in loops, oversized role context) and the semantic rules in `framework/rules/conformance.yaml`.
- **triage** ranks findings (impact x frequency / effort), links them across lenses and has the analyst explain the
  root cause and propose a fix; a reviewer checks the evidence. **backlog** writes
  `.agentbay/data/improve/reports/<isoweek>.md`.
- **You decide** each item in your own terminal: `.agentbay/bay improve decide <id> approve|defer|wontfix`.
  **implement** runs only on demand for an approved item, behind an approval gate, and produces a forge.extend
  proposal draft or a mode-fix task envelope. **verify** re-runs the detector after the fix ships.

Weekly run from cron:

```cron
17 8 * * 1  cd ~/code/my-repo && .agentbay/bay improve weekly >> .agentbay/data/improve/weekly.log 2>&1
```

`bay improve weekly` runs scan, audit and triage. Their analysis steps need agents, so it usually stops with
`"status": "pending"` and lists the pending calls. In your next Claude Code session ask the Chief of Staff to finish
them (it runs each step plan from `.agentbay/bay show <callId>`), then write the report with
`.agentbay/bay call improve.backlog '{}'`. If nothing is pending, weekly writes the report itself.

Everything improve writes stays in `.agentbay/data/improve/` (env `improve-local`: no network, no secrets). Its
roles read findings only through their use shims; transcript files are read only by the dispatcher.

## Adding things

- **A source** (e.g. Bluesky): `bay connector new bsky --implements items.source/v1`, implement `fetch`
  (return item/v1 items, e.g. post/v1) and fill `spec.selectors` (which selector fields its API handles),
  then in `envs/local-feeds.yaml` add `bsky` to the `items.source/v1` binding and add its API host to
  `network.allow` and its secret names to `secrets.allow`. Modes, roles and playbooks do not change.
- **A briefing for another kind of source**: a mode with `extends: briefing` that sets its purpose, constraints
  and `configDefaults` (e.g. its default selectors), points its roles at its own env
  (`roles: { lead: local-mail, analyst: local-mail, reviewer: local-mail }`) and overrides only what differs
  (an endpoint's review, a workflow, a playbook, a skill). Everything else is inherited at build time. The
  analyst of each mode compiles separately (`analyst--feed-briefing`, `analyst--mail-briefing`): its own
  subagent, shim, guard policy and store.
- **Behaviour for a role in your mode**: a skill (`modes/<mode>/skills/<name>/SKILL.md`), the feature's
  playbook or rules. A new kind of job for the framework is a `forge.extend` proposal.
- **A feature**: `bay feature new weekly --mode feed-briefing --effects read` (role defaults to the mode's
  first worker role); fill the
  playbook's Definition of Done and the rules; `bay lint`. Review is on by default for write/spend/delete features.
- **Your own rules** on a shipped feature: `modes.<mode>.features.<feature>.extraRules: <rules.yaml>` in
  `agentbay.config.yaml` (strictest wins).

## Generated in the target project

All tracked in `.agentbay/manifest.json` and removed by `clean`; your CLAUDE.md, settings and MCP servers are preserved.

| file | from |
|---|---|
| `.claude/agents/<role>--<mode>.md` | each worker role in each mode (plus `--<env>` when the mode runs it in several envs) |
| `.claude/skills/<skill>/` | role and mode skills |
| `.claude/commands/bay-*.md` | coordinator commands |
| `.claude/settings.json` | merged: narrow `Bash(<prefix>:*)` permissions + ledger hooks |
| `CLAUDE.md` | one marked import line -> `.agentbay/COORDINATOR.md` (Chief of Staff + mode coordinator playbooks) |
| `.agentbay/catalog.json`, `.agentbay/bay` | modes/endpoints/roles catalog; project control-plane shim |
| `.agentbay/roles/<role>--<mode>/use`, `.agentbay/guard.json` | per-unit read-only data shim (its mode's data, its env); per-subagent policy for the guard hook |
| `.agentbay/{ledger,calls,data}/` | runtime state (gitignored) |

## Safety model

**The guard is defense in depth, not isolation.** agentbay narrows what Claude Code subagents can ask to do;
it cannot contain code once something runs it. Hard isolation needs an OS sandbox (next release).

- **Nothing that runs code is auto-approved.** The only thing agentbay lets run without a prompt is a role's own
  read-only data shim (`.agentbay/roles/<role>--<mode>/use`), which runs only kit code (an isolated script with
  `python3 -E`, so files in your project can't be imported); when the kit is your project or sits inside it,
  where roles might edit the code it runs, even the shim prompts. Every other subagent command (git, `./bay.sh`, test runners,
  interpreters) prompts you. In the main thread only `bay show|status|log|note|task` are pre-approved;
  `bay call` and `bay submit` run connector code, so Claude Code asks each time.
- **Approval gates are yours:** `bay approve <callId>` works only in your own terminal.
- **Agent SQL is sandboxed.** `items.store/v1.sql` is defended in layers:
  - the connection opens read-only (`mode=ro`, `query_only`);
  - the store file holds only the mode's scope (sync and prune delete everything else, from the full-text
    index too), and cursors, budget and deletions live in a separate `state.json` the connection never opens,
    so no query can reach anything out of scope;
  - an authorizer allows only SELECT over the views `v_items`, `v_posts` and `v_fts` and the tables `items`,
    `item_selectors` and `items_fts`, plus an allowlist of functions; the FTS shadow tables and the schema
    table are refused;
  - WITH clauses may not reuse a view or table name;
  - a time limit, a 256 MB heap cap (sorts spill to disk), and row, byte and value-size caps.

  Every stored item string is secret-scrubbed when it is stored, and every read is redacted and scanned again.
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

1. `headless` (`claude -p`) and cloud runtimes as agent profiles: modes, roles and envs do not change.
2. Ledger -> SQLite behind the same API; per-call cost dashboards.
3. More sources as connectors (Bluesky, RSS) - one binding line each.
