# Proposal 0001a: design amendments (history)

Status: history. These are the "Approved amendment" sections of the former docs/DESIGN-v0.2.md, copied verbatim
from origin/main when that file was replaced by the current-state docs/DESIGN.md. They record what was decided and
when; docs/DESIGN.md describes the design as it is now and wins where the two differ.

Sections: "Approved amendments (2026-10-27)" (proposal 0001); "Approved amendment: the `improve` framework mode"
(proposal 0002); "Approved amendment: shared briefing layer" (proposal 0003); "Approved amendment: roles, agents and
environments" (proposal 0005 Part A).

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
- **Mode `improve`** (coordinator `lead`, worker `analyst` with the skills pattern-analysis and
  conformance-audit, framework `reviewer`; before 2026-10-28 improve-lead, improve-analyst and auditor):
  scan, audit, triage (review always), backlog (schedule weekly, declarative), implement (claim -> draft -> review
  (opus) -> approval gate -> handoff; review always), verify. Detectors are deterministic code in `bay/improve/`.
  improve never modifies artifacts: implement writes only a handoff file (forge.extend proposal draft or a task
  envelope) under its data folder. Approving an item (`bay improve decide <id> approve`) and passing the gate
  (`bay approve`) need an interactive terminal.
- **Conformance, single source:** `framework/rules/conformance.yaml` (`schemas/conformance.schema.json`, linted by
  `bay lint`). An endpoint's `review.rulesets: [conformance]` adds those rules to the reviewer's plan (forge.create
  and forge.extend use it); improve.audit runs every rule that has a `check` and hands the rest to the analyst.
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
  - workflows and coordinator are replaced; the `roles:` map merges entry by entry (2026-10-28);
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
    only wildcard and works only in from/to. It is matched by a linear glob (no regex, no backtracking),
    and a field with a `*` value is always matched locally, never sent to the source's search (validate
    warns when that makes the field local-only on a paid source).
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
  dispatcher passes the mode; a use-shim read belongs to the shim's unit, which fixes its mode and env
  (2026-10-28: the earlier limitation of one store-reading mode per role, and its validate error, are gone).
  The file is created 0600 before SQLite opens it, so -wal and -shm are 0600 too. WAL mode, `user_version`
  1. Its tables:
  - `items`;
  - `item_selectors`;
  - `items_fts` (FTS5 with its own content, kept by triggers).

  Internal state (cursors, coverage, budget, deleted ids, deletion-check times, and the selectors and
  sources last applied) lives next to it in `<mode>/state.json` (0600, written atomically), which the agents'
  read-only connection never opens. sync and prune hold an exclusive per-mode lock (`corpus.lock`) from
  reading state.json until they have saved it, so concurrent runs never lose each other's updates. Spend,
  deletions and check times are saved before the items commit (and again if the transaction fails), and
  cursors, coverage and the applied scope after it. A crash at any point can therefore only over-count
  spend (the next sync refetches from the old cursor), never lose it, and a cursor never covers items that
  were not committed.

  **Scope invariant.** corpus.db holds exactly the mode's scope: items of the sources bound to the mode's env
  that match at least one current selector. sync and prune enforce it on every run. They delete rows of
  sources no longer bound (a swap from the offline env to the real one included) and re-match every stored
  item without refetching, deleting those no selector matches. sync stores a fetched item only when it
  matches. The FTS triggers keep `items_fts` in step, and the v0.2 migration writes only in-scope items.
  Scope is therefore structural: the SQL sandbox does not filter, because there is nothing out of scope to
  reach. When the configured selectors or bound sources change, sync applies the new scope in its own
  transaction before any fetch, so a failing source cannot keep old items. Until a sync or prune has done
  that, every read endpoint refuses with the fix (run sync) and `status` reports `stale`. The dispatcher
  passes a use-shim read the mode's selectors and the sources bound in the mode's code-step env, because the
  read itself runs in the role's env.

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
  - **Secrets are scrubbed at ingest.** Every item string is secret-scrubbed when stored: identity fields
    (extId, with `id` rebuilt from the scrubbed parts), author, title, text, url, container, labels, threadId,
    and the keys and strings of kind fields. Scanning output alone is defeated by `upper()`/`hex()`. `item_row()` is the one row builder, used
    by both sync and `bay migrate`.
  - **Reads stay scanned.** Every read is still `vault.redact` + `secretscan`.
- **`briefing` base mode** (user space, `modes/briefing`, abstract). It ships:
  - features sync, digest, ask and prune, each with a playbook, rules and an id'd DoD;
  - skills digest, grounded-qa and corpus-sql (query recipes; cite item ids);
  - roles `lead` (coordinator) and `analyst`, which reads the store's read-only endpoints (describe, sql,
    get, thread, facets, search, query, status) because the mode needs items.store/v1;
  - review: digest always (opus/high), prune always;
  - the C-6 spend exemption via `constraints.spendUsd`;
  - `ask` answers via SQL (status context step, then the analyst queries);
  - citations may be stored item ids or urls, both resolved by `citations_resolve` against corpus.db.

  It is user space, not a framework mode. Framework modes build and maintain agentbay itself, while briefing
  is domain content that users extend with forge.create. The security-relevant parts (matcher, sandbox,
  inheritance, corpus-store) live in `bay/` and `framework/`.
- **feed-briefing** is a thin child.
  - **Own settings:** purpose, constraints, `configDefaults` with the default selector `[{id: home}]` (no
    fields, so each source's default stream, the X home timeline, as in v0.2; 2026-10-28: no copy of the
    config schema), and its coordinator playbook.md.
  - **Unchanged sync input:** the `sync` input `maxPosts` (own SyncReq type, sync workflow and sync
    playbook).
  - **Sources:**
    - x-api: `from` (handle, user timeline), `in` (home | list:<id>, needs `list.read`) and `since` are
      native; text, has and not are local;
    - fake: from, in and since are native; the rest is local.
  - **Deprecated, not removed:** local-store and the roles feed-lead and feed-analyst (replaced by
    briefing-lead and briefing-analyst in 0.3, by lead and analyst in 0.4). Improve finding F-d70dbfd0
    (whole-store reads per query) closes with local-store.
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
    (author an object of strings, metrics whole numbers, times ISO-8601, no nesting deeper than JSON allows);
    `state.json` must have the v0.2 shape (cursors an object of objects, deleted a list of ids, ...). Bad lines
    or a damaged `state.json` are reported as file:line plus the fix, and nothing is migrated; a wrong shape
    never raises, and a conversion that fails anyway leaves no partial folder or file.
  - Times are normalized to UTC ISO-8601 (`...Z`), as sync stores them. Posts whose ids become equal once
    secrets are scrubbed are merged (the last wins) and counted in the diff.
  - Duplicates (same source:id) are merged, keeping the last line, and counted in the diff.
  - Rows go through the store's `item_row` and are scrubbed.
  - It resolves feed-briefing's env and selectors in the project and writes only the posts the store
    would keep (bound source, matching a selector; the diff counts the rest), so the new store already
    satisfies the scope invariant.
  - Cursors (newestId becomes the `<connector>|{}` cursor of the selectors with an empty native query),
    coverage, budget, deletions and check times are kept in `feed-briefing/state.json`.
  - Old files are renamed `*.v0.2.bak`.


## Approved amendment: roles, agents and environments (2026-10-28, proposal 0005 Part A)

Proposal 0005 Part A was approved by the user on 2026-10-28, with two decisions the same day: no separate key
for where a role works (a mode's `roles:` becomes a map), and roles are framework-level (five generic roles;
access comes from the mode's needs). Each concept answers one question, and only the agent profile knows the
LLM product.

**Ownership.** The framework owns the roles and the agent profile. The user owns modes, envs and connectors
(and interfaces, if any). A role file or agent profile in user space is an error that names the fix:
customize behaviour in the mode's playbooks, skills or rules, or propose a framework role through
forge.extend.

- **Roles** (`framework/roles/`): `lead` (runs a mode's workflow as its coordinator), `analyst` (analyzes the
  data its mode gives it and cites evidence), `researcher`, `builder`, `reviewer`. A role is the job only:
  prompt, doneWhen, rules, skills, a default `tier` (fast | balanced | deep), optional `effort`, and `access`
  (`read`, or `write` for builder). It names no agent, env or data. What was mode-specific in the 0.3 roles
  now lives in the modes: briefing's playbooks and rules (SQL first, read through the shim, cite stored ids),
  improve's coordinator playbook and its skills `pattern-analysis` and `conformance-audit`, and forge's
  coordinator playbook (sequencing).
- **Modes place roles in envs** with `roles: { analyst: local-feeds, ... }`. A feature's `roles:` overrides
  entries for that feature's steps and a workflow step's `roles:` for that step only (forge: `extend` has
  `roles: { builder: framework-dev }`; `create` uses the mode's `local-authoring`). One env per step. `extends`
  inherits the map; a child overrides it entry by entry. Code steps run in the env of the mode's coordinator.
- **Access comes from the mode.** A role in a mode may read the read-only endpoints of the capabilities the mode
  declares in `needs:` that its env binds, through its use shim, and gets the tools of the mode's tools
  capabilities whose effects are read or network (all of them with `access: write`). An interface marked
  `dispatcherOnly` (improve.detect, forge.migrate, forge.scaffold) is used by code steps only. Agents still never
  reach write, spend or delete endpoints: those are code steps.
- **Agent profile** (`framework/agents/claude-code.yaml`): runtime per kind (`coordinator: claude-code-main`,
  `worker: claude-code-subagent`), `tiers: { fast: haiku, balanced: sonnet, deep: opus }`, an effort mapping
  and an optional tool-name mapping. `agent:` in agentbay.config.yaml selects it (default `claude-code`).
- **Model resolution:** tier = the step's (a review step: its review block), else the feature's, else the role's
  default; the profile maps it to a model; an env may cap tiers (`tiers: [...]`). Errors name the mode, feature,
  step, role, env and tier.
- **Compilation:** each distinct (role, mode, env) is a unit named `<role>--<mode>`, plus `--<env>` when one
  mode runs that role in several envs (e.g. `analyst--feed-briefing`, `lead--improve`). Each unit has its own
  subagent, use shim, guard policy entry and mode-scoped store access, so one role works in several modes and
  envs with separate credentials and stores.
- **Lint** names the mode, feature and step for: a role that is not a framework role, a step's role missing
  from the mode, a role with no env, two envs for one step, a feature override of a role the mode does not
  list, and `roles:` on a code or gate step.
- **Carried over from 0003:** a child sets `configDefaults:` instead of copying its parent's config schema; the
  caps are `maxItemsPerRun` and `monthlyItems`; validate warns when X `from` and `in` are combined on a paid
  source (capability `localWith`).
- **Compatibility (one release, 0.4.x)**, `bay/aliases.py`, with a lint warning per file: the old role names
  (briefing-analyst, improve-analyst, auditor -> analyst; briefing-lead, improve-lead, forge-lead -> lead),
  list-form `roles: [..]` (envs from the 0.3 agents, needs from the 0.3 roles' uses), endpoint `agents:`,
  `inference` and review `model` (-> tiers), env `models` (-> tiers), user per-role agent files, a role's
  `uses` (ignored), and the `*Posts` caps. `bay migrate` 0.4.0 (dry run first, `--confirm`) rewrites all of them;
  a user role file becomes a skill of the mode that uses it, run by the closest framework role, or is reported
  for manual handling.

