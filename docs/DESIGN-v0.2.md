# agentbay v0.2 design (approved 2026-10-26; amended 2026-10-27)

Amendments approved 2026-10-27 are folded in below: features (per-endpoint playbook,
rules, optional review declared only in mode.yaml), `bay lint`, framework vs user
content, and the `forge` framework mode. Recorded as docs/proposals/0001-v0.2-modes.md.

Replaces v0.1's AgentSpec + Layer model. Vocabulary is fixed; do not rename.

## Concepts (top to bottom)

| Concept | Is | Owns |
|---|---|---|
| **Chief of Staff** | system coordinator (the main Claude Code session) | routing user intent to mode endpoints, global status, the ledger |
| **Mode** | a job playbook: one logical job | purpose, endpoints (= features), workflows, optional coordinator role, roles used, inference settings, constraints, needed capabilities, playbook.md |
| **Feature** | one mode endpoint | in/out schemas, effects, workflow, playbook (with id'd Definition of Done), rules, optional review - all declared in mode.yaml |
| **Role** | a responsibility inside mode workflows; reusable across modes | prompt, definition of done (`doneWhen`), capabilities it uses, default agent |
| **Agent** | executor abstraction over Claude agents | runtime, default model/effort, bound environment |
| **Environment** | wiring + hard limits | capability → connector/tool bindings, secrets (names + provider), network allowlist, filesystem read/write paths, allowed models, limits |
| **Connector** | concrete tool implementing a capability interface | code, its own secrets/network usage |
| **Capability interface** | versioned contract: named endpoints with in/out JSON schemas and declared effects | — |

Agents never see connectors' secrets. Modes never name concrete tools, only capabilities.
Adding a source (e.g. Bluesky) = new connector + one binding line in an environment;
mode, roles and playbook untouched.

## Files

```
interfaces/<name>.v<N>.yaml     capability interfaces (endpoints, schemas, effects)
modes/<name>/mode.yaml          + playbook.md (coordinator), types/, skills/, config.schema.json
modes/<name>/features/<feature>/{playbook.md, rules.yaml}
roles/<name>.yaml
agents/<name>.yaml
envs/<name>.yaml
connectors/<name>/connector.yaml + code + tests/
agentbay.config.yaml            per-project user settings (validated against mode config schemas);
                                never binds capabilities - envs/ are the only place bindings live

framework/{interfaces,modes,roles,agents,envs,connectors}/   same layout, shipped and versioned with
                                the kit; users never edit it. A user name that collides with a
                                framework name is a lint error. Users add project rules via
                                agentbay.config.yaml modes.<mode>.features.<feature>.extraRules.
```

## Mode

```yaml
apiVersion: agentbay/v2
kind: Mode
metadata: { name: feed-briefing, version: 0.1.0 }
spec:
  purpose: Keep me briefed on what people I follow say; answer questions about it.
  endpoints:                     # features; interface, playbook, rules and review declared together
    sync:   { workflow: sync, in: SyncReq, effects: [network, spend, write],
              playbook: features/sync/playbook.md, rules: features/sync/rules.yaml }
    digest: { workflow: digest, in: DigestReq, out: Digest, effects: [read, network, spend, write],
              playbook: features/digest/playbook.md, rules: features/digest/rules.yaml,
              review: { role: reviewer, when: always, model: opus, effort: high } }
    ask:    { workflow: ask, in: Question, out: Answer, ... }
    prune:  { workflow: prune, schedule: daily, ... }
  coordinator: feed-lead         # optional role
  roles: [feed-lead, feed-analyst, reviewer]
  workflows:
    digest:
      - { id: refresh, run: feed.store/v1.sync, when: "stale > 2h" }   # code step, no agent
      - { id: gather,  run: feed.store/v1.query, with: { since: "$in.since|$config.lookback" } }
      - { id: themes,  role: feed-analyst, out: Digest }
      # review is injected from endpoints.digest.review (after the last step, or at `{ review: here }`)
  inference:
    default: { model: sonnet, effort: medium }
    steps: { check: { model: opus, effort: high } }
  constraints:
    lookbackMax: 30d
    monthlyPosts: 3000
    spendUsd: 5
    policies: [cite-sources, no-scraping, honor-deletions]
  needs: [feed.store/v1, feed.source/v1]
  config: config.schema.json     # what agentbay.config.yaml may set (lookback, retention, caps)
```

Step kinds: `run: <capability>/v<N>.<endpoint>` (deterministic code, no agent), `role: <role>` (agentic),
`gate: <text>` (approval: the call stops with `awaiting-approval`; only the user passes it with
`bay approve <callId>` in an interactive terminal),
and the review step injected from the endpoint's `review` block. `when: "stale > 2h"` or `when: "$in.<field>"`
skips a step. `with:` substitutes `$in.x`, `$steps.<id>.x`, `$config.x`, with `a|b` fallbacks.
An endpoint may re-place a role on another agent: `agents: { builder: author }`.

## Features: playbook, rules, review

- **Playbook** (`features/<f>/playbook.md`): H2 sections in this order: Purpose, Inputs, Steps,
  Definition of Done, Outputs, Failure handling. Steps is a numbered list. Every DoD item has a stable
  id and level: `- [DOD-1] (must) Every theme cites at least 2 stored posts by url`.
- **Rules** (`features/<f>/rules.yaml`, schema `schemas/rules.schema.json`): `{id: R-n, level: must|should|must_not,
  statement, appliesTo: executor|reviewer|both, check?: <deterministic check>, refs?: [DOD ids], when?: {kind: ...}}`.
  Mode constraints, role rules, feature rules and project extraRules stack; strictest wins.
- **Review** is configured ONLY in mode.yaml: `review: { role, when: always|never, model?, effort? }`.
  Omitted or `never` = no review step. Playbooks, rules, roles, agents and envs must not contain review settings.
- **Use:** the executing role's step plan carries the playbook and the rules with appliesTo executor|both.
  Deterministic `check`s run in code before review. The reviewer gets the original task, the DoD, the rules
  with appliesTo reviewer|both and the check results, and reports per id `pass|fail|n/a` with evidence and
  severity `blocker|should-fix|nit` (`review.verdict/v1`). A failed must/must_not or any blocker => `partial`,
  and the workflow stops there.
- The framework ships one generic `reviewer` role: HOW to review. WHAT to check always comes from the
  feature's DoD and rules. Modes may define their own reviewer roles.
- **`bay lint`** (also run by `bay validate`): section presence/order, numbered steps, DoD format and unique ids,
  rules schema, unique rule ids, refs to existing DoD ids, known checks, `when.kind` values, review role exists,
  is in the mode and is placeable (agent/env/model), review settings only in mode.yaml, both files per feature,
  orphan workflows/feature folders, modes naming connectors or tools, framework/user name collisions,
  mandatory review on `forge.extend`. Errors are `file:line: message`.

## Role / Agent / Environment / Connector (shapes)

```yaml
kind: Role
spec: { prompt: ..., doneWhen: [...], uses: [feed.store/v1.query], agent: analyst }

kind: Agent
spec: { runtime: claude-code-subagent, model: sonnet, effort: medium, env: local-feeds }

kind: Environment
spec:
  bind:
    feed.source/v1: [x-api]          # connectors implementing the interface
    feed.store/v1: local-store
  secrets: { provider: keychain, allow: [X_CLIENT_ID, X_CLIENT_SECRET, X_REFRESH_TOKEN] }
  network: { allow: [api.x.com] }
  fs: { read: ["."], write: [".agentbay/data/feeds"] }
  models: [haiku, sonnet, opus]
  limits: { maxTurns: 40, maxMinutes: 20 }

kind: Connector
spec: { implements: feed.source/v1, entry: connector.py, needs: { secrets: [X_*], network: [api.x.com] } }
```

## Resolution (build time) - fail loudly with the exact gap

For every mode endpoint → workflow step:
- code step: capability bound in the environment of the mode's coordinator/agent set; connector's needs ⊆ env allows
- role step: role exists; role → agent → env; every capability the role `uses` is bound in that env; step model ∈ env.models
- effects of every endpoint used ⊆ env allows (network hosts, write paths, spend, delete)
- inference precedence: mode step > mode default > role default > agent default; env caps
- constraints stack: mode policies + role rules + feature rules + project extraRules + env hard limits; strictest wins
- review steps resolve like role steps (role exists, listed in the mode, agent -> env, model allowed)
- framework boundary: any step whose env can write the kit's `framework/`, `bay/` or `schemas/` is only
  allowed in `forge.extend`
- agents may `use` only read-only connector endpoints (via their role's use shim, which fixes the role and checks its grants);
  everything else runs as a code step in the dispatcher

## Runtime

- `bay call <mode>.<endpoint> '<json>'` is the only way to invoke endpoints. It validates input/output
  schemas, checks grants and env, runs code steps, returns agentic steps as a step plan for the coordinator,
  enforces budget, and writes ledger events (`step.started`, `step.completed` with mode, endpoint, step, role, agent, env, cost).
- Agents reach connectors only through read-only store endpoints via their role's use shim
  (`.agentbay/roles/<role>/use`); feed sources are called only by `feed.store/v1.sync`, which the dispatcher
  runs as a code step. Secrets are resolved by the dispatcher from the env's provider (keychain via
  `security find-generic-password` on macOS, env vars as fallback provider `env`), never printed or logged.
- Endpoint `schedule` is declarative only in v0.2: no runtime acts on it. Run scheduled endpoints from cron
  or a scheduler, e.g. `0 4 * * * <project>/.agentbay/bay call feed-briefing.prune '{}'`; `bay lint` warns.
- Claude Code runtime: subagents cannot spawn subagents, so a mode coordinator runs as a playbook in the
  Chief of Staff's main thread; worker roles run as generated subagents (`.claude/agents/<role>.md`).
  A future `headless` runtime (`claude -p` workers) or cloud runtime makes the coordinator a separate agent
  without changing mode files.

## Framework mode: forge

One framework mode builds agentbay itself (`framework/modes/forge/`), coordinator `forge-lead`, workers
`builder` and `reviewer`.

| endpoint | does | placement | review |
|---|---|---|---|
| `create` | `kind: mode/feature/role/connector/env` + intent: scaffold (the same templates as `bay <kind> new`), then fill; kind-scoped rules via `when: {kind}` | builder on agent `author`, env `local-authoring` (writes modes/, roles/, agents/, envs/, connectors/ only) | always (sonnet/medium) |
| `extend` | propose (docs/proposals/<id>.md) -> approval gate -> implement -> review -> release; DoD/rules hold the full code-review criteria | builder on agent `framework-builder`, env `framework-dev` (writes framework/, bay/, schemas/, docs/, tests/) | always, opus/high; lint forbids disabling it |
| `migrate` | `bay migrate` plan (dry-run diff) and apply only with `confirm: true` | code steps in `local-authoring` | always |

## Data contract

(Superseded for briefings by the 0003 amendment below: item/v1 + post/v1 in a SQLite corpus store. Kept for history.)

`feed.post/v1`: `{id, source, author: {handle, name}, text, url, createdAt, fetchedAt, lang?, metrics?}`.
Store: `.agentbay/data/feeds/posts.jsonl` (dedup by `source:id`), cursor state per connector,
budget usage per UTC month. Lookback: configurable (`3d`, `12h`); API covers about 7 days, the rest comes from the
store; if the request exceeds store coverage, say so.

## Approved amendments (2026-10-27)

The kept items and removals were decided by the user after the independent review of the first
implementation. The fix-round items below are fixes from the two review rounds, not user decisions.

**Kept (approved as designed):**
- Role data access through per-role `use` shims: build generates `.agentbay/roles/<role>/use` for every role
  whose `uses` include read-only connector endpoints. The role is fixed inside the shim; it serves only those
  endpoints. There is no generic, caller-chosen `--role` entry point.
- Budget caps `maxPostsPerRun` and `costPerPostUsd` (default $0.005 per post), alongside `monthlyPosts` and
  `spendUsd`; strictest of mode constraint, project config and env limit wins.
- Agent `model: inherit` (used by main-thread coordinator agents).

- `envs: { local-feeds: local-feeds-offline }` in agentbay.config.yaml (user decision, 2026-10-27): selects the
  shipped offline env. Only envs that declare `substitutes: <env>` can be swapped in; capabilities stay bound only
  in envs/.

**Removed:**
- The config-level `bindings` override. `envs/<env>.yaml` is the only place capabilities are bound; an
  `agentbay.config.yaml` containing `bindings` is rejected with a message pointing to the env. To run offline,
  select the shipped offline env with `envs: { local-feeds: local-feeds-offline }` (approved above).
- Env `fs.base`. fs paths are always relative to the project root (the repo agents work in); an env with
  `fs.base` is rejected. The forge envs (`local-authoring`, `framework-dev`) keep the same paths (`modes`, `roles`,
  ..., `framework`, `bay`, `schemas`, ...) and resolve exactly as before because forge's project is the agentbay
  checkout itself: build the kit into itself (`./bay.sh build --project .`). The forge scaffold and migrate
  connectors refuse to run when the project is not the kit. The framework boundary check flags env write paths
  that name `framework/`, `bay/` or `schemas/` outside `forge.extend`.

**Fix-round changes (review fixes, rounds 1 and 2):**
- Guard hook: Claude Code permission rules are session-wide and subagent `tools` take bare tool names, so a
  `PreToolUse(Bash)` hook (`bay/guard.py`, policy `.agentbay/guard.json`) scopes each generated subagent to one
  simple command at a time: its own use shim or its env's narrow command prefixes. It fails closed for subagents.
  `settings.json` carries no wildcard (round 3 narrowed main-thread pre-approval to `bay show|status|log|note|task`).
  `bay secret set` requires a terminal; keychain values never appear in argv.
- Deletion re-checks: each sync spends up to half its read budget re-checking stored posts inside the source API
  window (x-api: official `GET /2/tweets?ids=`, batches of 100); posts the source no longer returns are removed
  and never re-stored.
- Billing on posts returned: budget usage counts every post the source returns (timeline pages and deletion
  lookups), not only posts kept; a call never requests more than its remaining read budget.
- One spelling for capability endpoints (`feed.store/v1.sync`) in run steps and role `uses`; feed.source
  connectors must declare `source` and `window`; `schedule` is declarative only (lint warns; run it from cron).
- Round 2 - containment covers file tools: the guard hook matches
  `Bash|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep`. For agentbay subagents it denies any access under
  `.agentbay/` (except running the role's own shim), writes outside the env's `fs.write` or under `.agentbay/`,
  `.claude/`, `.git/` or the kit, reads outside `fs.read`, and git `--output/--ext-diff/--textconv/--no-index/...`;
  paths are normalized (`..`, symlinks) first. settings.json adds a session-wide floor: `Edit(/.agentbay/**)`,
  `Edit(/.claude/**)`, `Edit(//<kit>/**)` when the kit is outside the project, `Read(/.agentbay/data/**)`,
  `Read(/.agentbay/calls/**)` (`Edit` rules cover every editing tool; `Write(...)`/`NotebookEdit(...)` path
  rules never match in Claude Code). Callers: `agent_type` naming a generated role = that role; otherwise
  `agent_id` present = unknown subagent; neither (or `agent_type` without `agent_id`, i.e. a `--agent` main
  session) = main thread, where settings.json applies. For unknown subagents the guard enforces exactly: file
  tools may not touch a path under `.agentbay/` (by path, case-folded on case-insensitive disks, or inode of symlink aliases; hard links are not detected
  identity), file writes may not touch the never-write list (below); Glob/Grep patterns that match
  `.agentbay/` or `.claude/` probe paths are denied; Bash words that resolve under `.agentbay/` or `.claude/`
  or to the kit CLI, shell globs that match those probes, and inline interpreter code (`sh/bash/zsh -c`,
  `python* -c`, `node -e`, ...) are denied; commands that cannot be parsed are denied only if they mention
  `.agentbay` or `.claude`. Everything else from unknown subagents falls through to Claude Code's prompts.
  Requires a Claude Code version that sends `agent_type`/`agent_id` in hook input.
- Round 2 - when the project is the agentbay checkout, env write paths such as `.` reach `framework/`, `bay/`,
  `schemas/`: lint warns and the guard denies those writes unless the env names them (framework-dev only).
  `local-authoring` no longer runs the test suite (writing and running code escapes any hook);
  framework-dev does, by design, behind the approval gate and mandatory review.
- Round 2 - approval gates are passed only with `bay approve <callId>` in an interactive terminal (never
  pre-approved for Claude Code); `bay submit` refuses gate steps; `bay show <callId>` resumes the coordinator.
- Round 2 - offline: `envs/local-feeds-offline.yaml` (fake source, no network, declares
  `substitutes: local-feeds`) is selected with `envs: { local-feeds: local-feeds-offline }` in
  agentbay.config.yaml. This chooses between tracked envs; capabilities are still bound only in envs/. Store
  queries return only posts from currently bound sources, so offline posts never mix into real digests. A
  connector may declare `costPerPostUsd` (fake: 0).
- Round 2 - the deletion-check share of the read budget is reserved before the timeline runs; only ids the
  source reports in `checked` are marked. Shim reads are logged as `data.read` ledger events. Mode config
  schema `default`s are the single source of default settings.

## Safety model (round 3, user-approved option B)

The guard hook is **defense in depth, not isolation**. It narrows what Claude Code subagents ask to do; it cannot
contain code once code runs. Real isolation needs an OS sandbox, planned for the next PR.

- **Nothing that runs code is auto-approved.** The guard emits `allow` only for a role's own read-only data shim
  (`.agentbay/roles/<role>/use`). Every env command prefix (git, `./bay.sh`, test runners, interpreters, scripts)
  gets no decision from the guard, so Claude Code asks the user. The main thread is pre-approved only for the
  read-only `bay show|status|log|note|task`; `bay call` and `bay submit` run connector code and prompt every time.
- **Fail closed:** the guard hook entries set `"onFailure": "block"` (Claude Code >= 2.1.295), and the guard
  denies on any internal error for subagent calls.
- **Path identity:** protected locations (`.agentbay/`, `.claude/`, `.git`, the kit) are compared by path,
  case-folded on case-insensitive filesystems (detected once per run), and by `os.stat` (st_dev, st_ino) of the
  path and every existing ancestor.
- **Never written by any subagent:** `.agentbay/`, `.claude/`, any `.git`, `.vscode/`, `.idea/` segment at any
  depth, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`, `agentbay.config.yaml`, `.envrc`, `.env*`, `Makefile`,
  `bay.sh`, `.github/workflows/`, and the kit when it is outside the project. Roles without file-writing tools have
  no writable paths.
- **git:** `--output`, `--ext-diff`, `--textconv`, `--no-index`, `--exec*`, `--upload-pack`, `--receive-pack`,
  `--config*`, `--git-dir`, `--work-tree`, `--open-files-in-pager`, `--pathspec-from-file`, `-O` are refused;
  `--flag=value` values are path-checked; `git worktree add` takes only relative in-project paths.
- **forge.extend** (framework-dev, runs the test suite on code it writes) is installed only when the project is the
  agentbay checkout. Elsewhere it does not exist (no agents, no catalog entry, `bay call` refuses it).
- **No worktree isolation for builders:** the hook payload does not identify a subagent's worktree, and trusting
  `cwd` would let an agent `cd` into a protected directory, so `isolation: worktree` was removed from the builder.


## Approved amendment: the `improve` framework mode (2026-10-27, proposal 0002)

Proposal 0002 was approved by the user on 2026-10-27, with these decisions: scan reads raw Claude Code transcripts
(redacted on read); approved findings go to a weekly backlog; implementation runs only on demand after human approval.

- **Richer ledger events (prerequisite).** `step.*`/`call.completed` carry `durationMs`, `costUsd` and `tokens` when
  known (code steps are timed; agentic steps from planned to submitted, or as reported with `bay submit --usage`;
  the Agent hook records the runtime's duration and tokens; step plans show `--usage` on the submit command).
  The guard writes `permission.denied` with tool and reason, never the command; permission prompts are counted from
  Claude Code transcripts. `bay note <ref> --instruction` records a mid-run instruction change (`data.kind`). Notes never create
  runs: they attach to a run by runId or taskId, or stay standalone. All new fields are optional (`v` stays 1).
  Every ledger value passes a pattern secret scan (`bay/secretscan.py`) in addition to `vault.redact`.
- **Capability interfaces:** `session.events/v1` (read-only episodes, data schema `session.episode/v1`),
  `review.verdicts/v1`, `artifacts.read/v1` (files, text, reference graph), `improve.detect/v1` (read-only:
  detectors, evidence resolution, re-checks) and `improve.findings/v1` (storage only: upsert, annotate, query, get,
  triage, decide, backlog, claim/handoff, verify); data schema `improve.finding/v1`.
- **Connectors** (framework): `ledger`, `git`, `claude-transcripts`, `artifact-graph`, `improve-detect`,
  `improve-store`. Only the dispatcher runs them; roles reach findings, episodes and artifacts through read-only
  use shims. When several connectors serve one read endpoint (session.events/v1), a shim call merges their lists.
- **Transcripts:** structure and metadata only, always (no opt-in for text); never follows symlinks; files older
  than the window are skipped by mtime; every malformed, too deep or too long line is counted, never fatal.
- **Env `improve-local`:** reads the project, the kit, the ledger and call state, git and `~/.claude/projects`
  (connectors only: `~`/absolute read paths never reach a role's guard policy); writes only
  `.agentbay/data/improve/`; no network, no secrets; effects read and write.
- **Mode `improve`** (coordinator `improve-lead`, workers `improve-analyst`, `auditor`, framework `reviewer`):
  scan, audit, triage (review always), backlog (schedule weekly, declarative), implement (claim -> draft -> review
  (opus) -> approval gate -> handoff; review always), verify. Detectors are deterministic code in `bay/improve/`.
  improve never modifies artifacts: implement writes only a handoff file (forge.extend proposal draft or a task
  envelope) under its data folder. Approving an item (`bay improve decide <id> approve`) and passing the gate
  (`bay approve`) need an interactive terminal.
- **Conformance, single source:** `framework/rules/conformance.yaml` (`schemas/conformance.schema.json`, linted by
  `bay lint`). An endpoint's `review.rulesets: [conformance]` adds those rules to the reviewer's plan (forge.create
  and forge.extend use it); improve.audit runs every rule that has a `check` and hands the rest to the auditor.
- **Scheduling:** `bay improve weekly` runs scan + audit + triage and writes the backlog report only when no agent
  step is pending; otherwise it lists the pending steps and stops (the coordinator finishes them, then runs
  improve.backlog). Run it from cron (README); lint's schedule warning for improve.backlog points to it.


## Approved amendment: shared briefing layer (2026-10-27, proposal 0003, steps 1-2)

Proposal 0003 was approved by the user on 2026-10-27. These are the user's decisions:
- read-only SQL for analyst roles, on by default and sandboxed;
- Gmail API only;
- attachment text in step 3;
- order: feed-briefing first, then mail-briefing, then forge.connect.

Steps 1 (the shared layer) and 2 (feed-briefing on it) are implemented. Mail, forge.connect and attachments
are not part of this amendment.

- **Mode inheritance.** `extends: <mode>` is merged into the child when the kit loads (`bay/model.py`
  `merge_mode`):
  - endpoints merge key by key;
  - workflows, roles and coordinator are replaced;
  - constraints and inference merge; needs are unioned;
  - inherited playbook, rules and config paths are rebased to the child's folder;
  - types, skills and the coordinator playbook are looked up child first, then ancestors.

  The resolver, lint, conformance, improve and the adapter therefore only ever see complete modes. Cycles and
  missing parents are load errors. A child file is validated with endpoint `workflow`/`effects` optional, and
  the merged mode against the full schema. `abstract: true` (not inherited) marks a base that is linted but
  never resolved, installed or called. In a child, a feature folder may hold only the file it overrides.
- **Contracts** (`feed.source/v1`, `feed.store/v1` and `feed.post/v1` are deprecated; see Compatibility below):
  - data `item/v1`, a shared envelope with `id = <source>:<extId>`;
  - kind extension `post/v1`;
  - `selector/v1` and `items.coverage/v1` (renamed from feed.coverage/v1);
  - interfaces `items.source/v1` (one `fetch` per native query) and `items.store/v1` (sync, prune,
    describe, sql, get, thread, facets, search, query, status).
- **Selectors** (`bay/selector.py`): the vocabulary is from, to, subject, text, in, has (link | attachment),
  since, not.
  - Fields are ANDed, selectors ORed, and `not` excludes. Matching is case-insensitive (casefold); `*` is the
    only wildcard and works only in from/to.
  - Each source declares its capability table in `connector.yaml spec.selectors`.
  - The store splits each selector into a native query and a local filter, and always re-applies the full
    selector with the one shared matcher. Items carry `matched`.
  - A selector change re-matches without refetching. A new selector, including one joining an existing native
    query, backfills its lookback.
  - A removed selector's items are deleted by the next sync or prune (the store invariant below).
  - Validate errors on fields a source cannot express. It warns on local-only fields when a source is paid.
  - The `stale > 2h` refresh also runs when the configured selectors or bound sources differ from the
    applied ones.
- **corpus-store** (framework connector, so every briefing mode shares it): one store per mode,
  `<env data folder>/<mode>/corpus.db`, so two briefing modes on one env never share selector tags. The
  dispatcher passes the mode; a role's use-shim read resolves the one mode of that role that needs the store.
  The file is created 0600 before SQLite opens it, so -wal and -shm are 0600 too. WAL mode, `user_version`
  1. Its tables:
  - `items`;
  - `item_selectors`;
  - `items_fts` (FTS5 with its own content, kept by triggers).

  Internal state (cursors, coverage, budget, deleted ids, deletion-check times, and the selectors and
  sources last applied) lives next to it in `<mode>/state.json` (0600, written atomically after the items
  commit), which the agents' read-only connection never opens.

  **Scope invariant.** corpus.db holds exactly the mode's scope: items of the sources bound to the mode's env
  that match at least one current selector. sync and prune enforce it on every run. They delete rows of
  sources no longer bound (a swap from the offline env to the real one included) and re-match every stored
  item without refetching, deleting those no selector matches. sync stores a fetched item only when it
  matches. The FTS triggers keep `items_fts` in step, and the v0.2 migration writes only in-scope items.
  Scope is therefore structural: the SQL sandbox does not filter, because there is nothing out of scope to
  reach.

  Sync is one transaction. Budget, deletion re-checks, coverage and caps behave as in v0.2; the cap names
  `maxPostsPerRun`, `monthlyPosts` and `costPerPostUsd` are kept and count items. Without FTS5, search
  falls back to LIKE and `bay validate` warns.
- **Read-only SQL sandbox** (`bay/sqlsandbox.py`):
  - plain temp views `v_items`, `v_posts` (built from `items`) and `v_fts` (`v_items` joined to
    `items_fts`, with columns `fts` for MATCH, `rank` and `snippet`: the documented full-text path);
  - `mode=ro` + `query_only`;
  - an authorizer: SELECT and READ on those views and the store tables `items`, `item_selectors` and
    `items_fts`, json_each and CTEs, and a function allowlist. It denies the FTS shadow tables, any other
    table, sqlite_schema/sqlite_master, writes, DDL, ATTACH, PRAGMA and load_extension. A read of no column
    (`count(*)`) reaches the authorizer without a database name and meets the same allowlist;
  - **strict pre-pass.** Each query is first prepared as `EXPLAIN <sql>` under the authorizer and only then
    runs. During the run, FTS5's own unattributed reads of its shadow tables are allowed, so a query can
    never name them itself. FTS5 is connected before the authorizer is on, so its config read never trips
    the pre-pass;
  - a lexical check forbids WITH clauses named like any view or table in the store, so a name always means
    the stored object;
  - a 2 s progress-handler limit, a 1 MB SQLITE_LIMIT_LENGTH, `PRAGMA hard_heap_limit` 256 MB (process-wide,
    only ever lowered) with `temp_store=FILE`, and row, byte and cell caps;
  - fixable error messages.

  Two decisions came out of the adversarial tests:
  - **Secrets are scrubbed at ingest.** Every item string except its identity and timestamps is
    secret-scrubbed when stored: author, title, text, url, container, labels, threadId and the strings in kind
    fields. Scanning output alone is defeated by `upper()`/`hex()`. `item_row()` is the one row builder, used
    by both sync and `bay migrate`.
  - **Reads stay scanned.** Every read is still `vault.redact` + `secretscan`.
- **`briefing` base mode** (user space, `modes/briefing`, abstract). It ships:
  - features sync, digest, ask and prune, each with a playbook, rules and an id'd DoD;
  - skills digest, grounded-qa and corpus-sql (query recipes; cite item ids);
  - roles `briefing-lead` (coordinator) and `briefing-analyst` (describe, sql, get, thread, facets, search,
    query, status);
  - review: digest always (opus/high), prune always;
  - the C-6 spend exemption via `constraints.spendUsd`;
  - `ask` answers via SQL (status context step, then the analyst queries);
  - citations may be stored item ids or urls, both resolved by `citations_resolve` against corpus.db.

  It is user space, not a framework mode. Framework modes build and maintain agentbay itself, while briefing
  is domain content that users extend with forge.create. The security-relevant parts (matcher, sandbox,
  inheritance, corpus-store) live in `bay/` and `framework/`.
- **feed-briefing** is a thin child.
  - **Own settings:** purpose, constraints, a config schema with the default selector `[{id: home}]` (no
    fields, so each source's default stream, the X home timeline, as in v0.2), and its coordinator
    playbook.md.
  - **Unchanged sync input:** the `sync` input `maxPosts` (own SyncReq type, sync workflow and sync
    playbook).
  - **Sources:**
    - x-api: `from` (handle, user timeline), `in` (home | list:<id>, needs `list.read`) and `since` are
      native; text, has and not are local;
    - fake: from, in and since are native; the rest is local.
  - **Deprecated, not removed:** local-store and the roles feed-lead and feed-analyst (replaced by
    briefing-lead and briefing-analyst). Improve finding F-d70dbfd0 (whole-store reads per query) closes with
    local-store.
- **Compatibility (one release, 0.3.x).** `bay/aliases.py` is the single table. When the kit loads, user
  modes, roles, envs and connectors resolve the v0.2 names:
  - `feed.source/v1` becomes items.source/v1, and `feed.store/v1[.ep]` becomes items.store/v1 (sync `with
    maxPosts` becomes maxItems);
  - `feed-analyst` and `feed-lead` become `briefing-*`, and `local-store` becomes `corpus-store` (only when
    the user defines no role or connector with that name);
  - data refs `feed.post/v1` becomes post/v1, and `feed.coverage/v1` becomes items.coverage/v1.

  `bay lint` and `bay validate` warn on each file ("deprecated ...; run `bay migrate`"). A mode that needs
  items.source/v1 without a selectors setting keeps each source's default stream (`[{id: home}]`).
  `bay migrate` 0.3.0 (`_v02_names`) rewrites the YAML/JSON/Markdown user files with the same table: dry run
  first, `--confirm` to apply. A user connector still implementing a feed interface names its old fetch
  signature and the new contract: code is ported by hand, never rewritten. It is a load error when an env
  binds it and a warning when none does (the connector is skipped), so one leftover file never stops the kit.
- **Data migration** (bay/migrate.py `DATA_MIGRATIONS`, version 0.3.0): `bay migrate --project <repo>`,
  run by the user, converts a v0.2 `posts.jsonl` + `state.json` to `<dir>/feed-briefing/corpus.db`. It is the
  only path for user data: forge.migrate migrates kit content only, and neither the migrator connector nor
  env local-authoring writes `.agentbay/`.
  - It shows a dry-run summary diff first; `--confirm` applies it.
  - Each line must be UTF-8 JSON with id, source, url and createdAt, and every field of the expected type
    (author an object, times ISO-8601); `state.json` must have the v0.2 shape (cursors an object of objects,
    deleted a list of ids, ...). Bad lines or a damaged `state.json` are reported as file:line plus the fix,
    and nothing is migrated; a wrong shape never raises.
  - Duplicates (same source:id) are merged, keeping the last line, and counted in the diff.
  - Rows go through the store's `item_row` and are scrubbed.
  - It resolves feed-briefing's env and selectors in the project and writes only the posts the store
    would keep (bound source, matching a selector; the diff counts the rest), so the new store already
    satisfies the scope invariant.
  - Cursors (newestId becomes the `<connector>|{}` cursor of the selectors with an empty native query),
    coverage, budget, deletions and check times are kept in `feed-briefing/state.json`.
  - Old files are renamed `*.v0.2.bak`.
