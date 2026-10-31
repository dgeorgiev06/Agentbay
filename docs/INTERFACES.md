# agentbay interfaces

The contracts. Everything else is replaceable. Design and vocabulary: [DESIGN.md](DESIGN.md).

```
 modes/  envs/  connectors/  interfaces/       you (user space)
 framework/{roles,modes,envs,connectors,interfaces}/   the framework (roles only here; an agent profile is in adapters/<name>/adapter.yaml)
    │
    ├─> bay check ─> model.resolve() ─> System ──> Adapter.build ──> .claude/agents/<role>--<mode>.md, COORDINATOR.md, catalog
    │                  (exact gaps)                                  (claude-code now; headless / cloud next)
    │
 Chief of Staff ── bay call <mode>.<endpoint> ──> Dispatcher ──> code steps ──> Connector (secrets, allowlisted HTTP)
       ▲                                              │
       │      step plan (needs-agent / awaiting-approval)
       └── runs role as subagent (TaskEnvelope/v1 -> Result/v1) ── bay submit ──┘
                                                      │
                     LedgerEvent (dispatcher + hooks) ─> .agentbay/ledger/events.jsonl ─> bay status
```

| # | Contract | Schema / code | Changes when |
|---|---|---|---|
| 1 | **Mode** (features: in/out, effects, steps, optional playbook and rules, review) | `schemas/mode.schema.json` | you add or change a job |
| 2 | **Feature playbook + rules** | `bay/playbook.py`, `schemas/rules.schema.json` | you change a feature's definition of done |
| 3 | **Role / Agent profile / Environment** | `schemas/{role,environment}.schema.json`; the profile is `profile:` in `schemas/adapter.schema.json` | the framework adds a job or an LLM product; you add wiring |
| 4 | **Capability interface + Connector** | `schemas/{interface,connector}.schema.json`, `bay/connect.py` | you add a capability or a concrete tool |
| 5 | **Adapter + registry** (`.agentbay/catalog.json`) | `bay/adapter.py`, `bay/registry.py` | you add a runtime, or something a coordinator must discover |
| 6 | **Project workflow** (stages composing `<mode>.<endpoint>`) | `schemas/config.schema.json` `workflows`, `bay/workflows.py` | you compose modes differently |
| 7 | **Dispatcher** (`bay call/submit/use`) | `bay/dispatch.py` | rarely |
| 8 | **TaskEnvelope / Result** | `schemas/task.schema.json` | rarely; version-bump it |
| 9 | **LedgerEvent** | `schemas/event.schema.json` | rarely; version-bump it |
| 10 | **Session, artifact and finding interfaces** | `framework/interfaces/`, `schemas/data/improve.finding.v1.schema.json` | you add a detector source or finding field |
| 11 | **Briefing: items, selectors, corpus store, read-only SQL** | `framework/interfaces/items.*.yaml`, `schemas/data/`, `bay/selector.py`, `bay/sqlsandbox.py` | you add a source kind or a view |
| 12 | **Conformance rules** | `framework/rules/conformance.yaml`, `schemas/conformance.schema.json` | you change what "fits the framework" means |

## 1. Mode and features
`mode.yaml` declares each feature (`spec.features.<name>`, called as `<mode>.<name>`), everything about it in one place:
`in`/`out` (type names in `types/`), `effects`, `steps`, optional `playbook` and `rules` (a feature that runs no
role needs neither; one that runs a role needs a playbook), optional
`review: {role, when: always|never, tier?, effort?}`, optional `tier`/`effort` for its role steps and optional
`roles: {role: env}` overrides for its steps. There is no separate endpoint, workflow or feature file.
`steps` are ordered: `run: <capability>/v<N>.<endpoint>` (code), `role: <role>` (agentic; may set
`tier`, `effort` and `roles: {<its role>: <env>}`), `gate: <text>` (approval; never `when:`; `approves: $in.<field>`
records that file's path and sha256 with the approval, and a later call naming the same unchanged file skips
the gate), `{review: here}` (position of the injected review step).
`roles: {role: env}` lists the framework roles the mode uses and the env each works in (one env per step:
step > feature > mode). Modes name capabilities (`needs: [items.store/v1]`), never connectors or tools; the
read-only endpoints of those needs are what the mode's roles may read.
`configDefaults:` replaces config-schema defaults for this mode (a child never copies its parent's schema).

**Inheritance.** `extends: <mode>` is resolved when the kit is loaded (`bay/model.py` `merge_mode`), so the
resolver, lint, conformance, the detectors and adapters always see a complete mode.
- **Features** are replaced whole: a child's feature of the same name is the complete block (in/out, effects,
  playbook, rules, review, `uses:`, `skills:`, steps), never merged key by key with its parent's; a feature the child
  does not declare is inherited unchanged; `coordinator` is replaced. `bay show <mode> --resolved` prints the result
  with the mode.yaml each feature comes from.
- **`uses:` and `skills:`** (per feature) scope what its role steps get. `uses` lists the read endpoints
  (`items.store/v1.sql`) they may call through the use shim, each granted to a role of the feature; it is required
  when a role is granted any (`[]` for none). While a call of the feature waits on a role unit, that unit's shim
  reaches only the `uses` (with no such open call the role-level grant applies). `skills` lists the mode's skills
  the step plan hands them (absent: all); a playbook may name only those.
- **`roles`, constraints and configDefaults** merge entry by entry; `needs` are unioned.
- **Inherited paths** (playbook, rules, config) are rebased to the child's folder. Types, skills and the
  coordinator `playbook.md` are looked up in the child first, then its ancestors.
- **Validation.** A child file may be partial; the merged result is validated against the full schema.
- **Errors.** Inheritance cycles and missing parents are reported with the file to fix.
- **`abstract: true`** marks a base that is linted but never resolved, installed or called. It is not inherited.

## 2. Playbook + rules
Playbook H2 sections in order: Purpose, Inputs, Steps (numbered), Definition of Done
(`- [DOD-n] (must|should|must_not) ...`), Outputs, Failure handling.
Rules: `{id: R-n, level, statement, appliesTo: executor|reviewer|both, check?, refs?, when?: {kind}}`.
Endpoint `schedule` is declarative only (lint warns); run it from cron.
Deterministic checks (`bay/checks.py`): `citations_resolve`, `citations_min:<n>`, `no_secrets`, `lint_clean`.
The reviewer returns `review.verdict/v1`: per id `pass|fail|n/a`, evidence, severity, and optionally `cites`
`{taskId, outcome, todo[]}` (the recorded outcome and to-do items the verdict rests on). The review brief
carries `review.recordedPlans` (taskId -> step, outcome, to-do progress) of the agents it judges.

## 3. Role / Agent profile / Environment
Ownership: the framework owns roles; the agent profile is part of a runtime adapter; the user owns modes, envs
and connectors. A user role file is an error.
- Role (`framework/roles/`: lead, analyst, researcher, builder, reviewer): `prompt`, `doneWhen`, `rules`,
  `skills`, default `tier` (fast | balanced | deep), optional `effort`, `access` (read | write). No agent, env or
  data access of its own.
- Agent profile (`profile:` in `adapters/<name>/adapter.yaml`, `agent:` in agentbay.config.yaml): `runtime`
  `{coordinator: claude-code-main, worker: claude-code-subagent}`, `tiers {fast, balanced, deep} -> model`,
  `effort` mapping, optional `tools` name mapping. The only place a model name appears.
- Environment: `bind` (interface -> connector(s) or `{tools, clis, mcpServers}`), `secrets {provider, allow}`,
  `network.allow`, `fs {read, write}` (paths relative to the project root), optional `tiers` cap, `effects`,
  `limits` (the ceiling for every cap), optional `offline {bind, network, secrets}`: with `offline: true` in
  agentbay.config.yaml the env binds `offline.bind` over its own bindings and has no network and no secrets
  (`bay check` refuses an `offline` block that lists a host or a secret).
- Grants of a unit (role, mode, env): the read-only connector endpoints of the mode's `needs` that the env binds
  (never an interface marked `dispatcherOnly`), plus the tools of the mode's tools capabilities whose effects
  are read or network (any, with `access: write`). Only `access: write` roles get file-writing tools (Edit,
  Write, MultiEdit, NotebookEdit), CLIs beyond read-only version control, and the env's `fs.write` paths in their guard
  entry. `bay check` rejects a tools binding that lists file-writing tools or such CLIs under a capability without
  the `write` effect.
- Tier: step (a review: its review block) > feature > role default; the profile maps it to a model; the env's
  `tiers` cap it. The env also caps the role's default tier, which is the model its unit is compiled with.
  Envs are the only place capabilities are bound; `agentbay.config.yaml` cannot rebind them. It can switch every
  env's `offline:` block on (`offline: true`), and can lower a cap but never raise the env's `limits`.
- User modes may put roles only in their own envs (`envs/`) and the protected envs the component map opens to
  them (`framework/components.yaml` `protected:`, each env's `modes:`).
- Code steps (`run:`) run in the coordinator's env for that feature; `bay check` warns when a store-reading
  mode puts a role in an env whose `items.store`/`items.source` bindings differ from it.

Resolution rules (`bay/model.py`) - every gap is reported at once:
unknown role/agent profile/env/connector/interface/endpoint; unbound capability; effect not declared by the
endpoint or not allowed by the env; tier not allowed by the env (naming mode, feature, step, role, env, tier); connector needs (hosts, secrets, fs, capabilities)
exceed the env; coordinator not on a main-thread runtime; agents granted non-read connector endpoints;
steps that could write `framework/`, `bay/`, `schemas/` or `adapters/` outside `forge.extend`.

## 4. Interface + Connector
Interfaces: named endpoints with JSON-schema `in`/`out` and `effects` (`read|write|network|spend|delete`);
`binding: connector` (code) or `tools` (runtime tools). A connector is `connector.yaml` + `entry` exposing
`create(ctx)`; `ctx` gives `config`, `secrets.get/store` (names allowed by env AND connector only),
`http.request` (env allowlist enforced before every request, HTTPS only), `data_dir`, `caps`, `settings`,
`sources` (connectors for capabilities it `needs`), `clock`, and for items.source connectors `source_id`,
`window`, `cost_per_item` and `selectors` (the capability table).

A connector that needs an interactive login (e.g. an OAuth browser flow that stores a refresh token) names a
function of its `entry` in `login:`. `bay auth <connector> [--env <env>]` runs it, from an interactive terminal
only (an agent can neither start a login nor replace a token). The env is `--env`, which must bind the
connector, or else the one env that binds it. The function gets a context with the same secret access a sync
through that env gets: `secret(name)` and `store_secret(name, value)` for names both in the env's
`secrets.allow` and the connector's `needs.secrets`; `http` limited to the connector's declared hosts that the
env allows; `open_browser(url)` and `say(text)`. The entry runs in-process, so this limits the API it is
handed, not what the process can do. `bay check` refuses a `login:` whose `needs.secrets` no env that binds
the connector allows.

No connector loads another: `bay check` (B-7) scans a connector's code and the files its manifest references for
imports of another connector's module and for the kernel's `agentbay_connector_*`/`agentbay_adapter_*` module
keys. Prose, comments and names in playbooks are not scanned; a mode names a connector nowhere in `mode.yaml`.
README.md and the extension's top-level `tests/` are exempt. A static scan cannot be complete (a name can be
computed at run time); review covers the rest. Files in the repository root that no component owns (a TODO.md)
are not framework code and pass `bay check --base`; `CHANGELOG.md` is owned by the kernel.

## 5. Adapter and registry
```python
class Adapter(Protocol):
    name: str
    def build(self, system: System, project: Path, kit: Path) -> BuildReport: ...
    def clean(self, project: Path) -> BuildReport: ...
```
Obligations: idempotent; touches only files recorded in `.agentbay/manifest.json`; merges with
user-authored CLAUDE.md, `.claude/settings.json`, `.mcp.json`, never clobbers; `clean` restores them;
writes the registry via `bay.registry.write`. The catalog's content is runtime-neutral system truth - an adapter
supplies only its own `runtime` name - so a second runtime discovers the same modes, endpoints (with resolved
input/output schemas), roles and project workflows. The claude-code adapter also writes per-unit use
shims (one per unit `<role>--<mode>[--<env>]`), `.agentbay/guard.json` (one entry per unit) and the PreToolUse guard hook (Bash and every file tool), plus `Edit` deny rules on
`.agentbay/**`, `.claude/**` and the kit. A runtime is a folder `adapters/<name>/` with `adapter.yaml` (name = folder, module inside the folder, class), discovered by folder; lint checks it, and a malformed entry is reported, never imported.

Skills are namespaced when built: a mode's `skills/<skill>/` becomes `.claude/skills/<mode>--<skill>/` and a
role's becomes `<role>--<skill>` (the same `--` separator as units; Claude Code skill names allow lowercase
letters, digits and hyphens, at most 64). The build rewrites the `name:` in the copied SKILL.md front matter to
the namespaced name. Playbooks and role prompts keep naming the short name ("the `<skill>` skill"); lint checks
each such reference against the skills of the mode's chain (or the role's own).

## 6. Project workflows and the root coordinator
The root mode (a framework mode; its README names its endpoints) supplies the preamble of the generated
`.agentbay/COORDINATOR.md` and runs project workflows over `workflow.run/v1`.

A project workflow is `workflows.<name>` in `agentbay.config.yaml`: `description`, `in` (JSON schema) and
`steps`, each `{id, call: <mode>.<endpoint>, with?, when?}` or `{id, gate: <text>}`, with the same `$in` /
`$steps.<id>` substitution as a feature's steps. The root mode's endpoints return `nextCall`; the coordinator
makes that call the ordinary way (the dispatcher never recurses). A workflow gate passes only with
`bay approve <W-runId>`. `bay check` checks structure (ids, `$steps` order, gate references), then
targets against the registry and each `with` against the endpoint's input schema, and prints the union
of stage effects. Run state is in `.agentbay/data/workflows/`, written only by the connector bound to `workflow.run/v1`.

## 7. Dispatcher
`bay call <mode>.<endpoint> '<json>'` -> `{callId, status, output | next, checks, review, cost}`.
Status: `done | partial | blocked | failed | needs-agent | awaiting-approval`.
`bay submit <callId> <stepId> '<json>' [--usage '{"tokens": N, "costUsd": X, "durationMs": N}']` resumes an agentic step (usage goes to the step's event); `bay show <callId>` prints the current state (`bay show reclaim <runId>` marks a stuck run reclaimed); approval gates pass only with `bay approve <callId>` in an interactive terminal (a project workflow's gate the same way, with its `W-...` run id), or with `bay approve <id> --via chat --quote "<the owner's message>" --sha <8+ hex>` (the sha256 prefix of the content the owner saw; refused if the file changed) when agentbay.config.yaml sets `approvals: { chat: true }` (recorded as `by: user@chat-via-cos` with the quote). A role's generated shim
`.agentbay/roles/<role>--<mode>/use <iface>/v<N>.<ep> '<json>'` (unit fixed inside: role, mode and env; read-only endpoints of the mode's needs)
is the only way an agent reads connector data; the guard hook stops subagents from running anything else. Secret values are redacted from everything it returns or logs.


## 8. TaskEnvelope/v1 -> Result/v1
Plain fenced YAML blocks (```` ```task ```` / ```` ```result ````). One deliverable per envelope.

## 9. LedgerEvent
Append-only JSONL. Agent runs: `spawned`, `completed`, `failed`, `reclaimed`, `note` (hooks/coordinator; a note
attaches to a run by runId/taskId or stays standalone, never creating a run; `data.kind` is `note`,
`instruction-change` or `decision`).
Guard: `permission.denied` (tool, agent, reason; never the command).
Optional on any event: `durationMs`, `tokens {input, output, cacheRead, cacheCreation, total}`, `costUsd`.
Every value is secret-scanned (`bay/secretscan.py`) and redacted (`vault.redact`) before it is written.
Data: `data.read` (a role read connector data through its use shim; role, env, endpoint, item count).
Agent records (append-only; written by the coordinator and the agent, never edited):
- `agent.dispatch`: `bay note dispatch <taskId> --agent <name> [--call --step --model --tier --role --mode --input ...]`,
  run by the coordinator before every agent dispatch, so `bay status` lists the run even with the spawn hook off.
  `--input` (repeatable) names the inputs; the dispatcher also copies a step's inputs into `step.started`
  (`data.inputs`: the value, or its sha256 plus a scrubbed preview).
- `agent.plan`, `agent.plan.done`: `bay plan <taskId> '{"outcome", "todo": [{"text", "serves"}]}'`, then
  `bay plan <taskId> --done <n>`. One plan per taskId, only for a dispatched taskId and only by the agent it
  was dispatched to; text is scrubbed and size-limited. It is the only `bay` command a subagent may run. A
  role-step `bay submit` is refused when its taskId has no plan.
- `review.recorded`: `bay note review <taskId> '<review.verdict/v1>'`, for a review run outside a framework
  review step. It changes no call, gate or approval; the analysis mode that reads verdicts counts it.
`bay status --agents` groups runs by role, mode, model and tier from these events alone (a step's submitted usage is
split evenly among the agents dispatched to that call and step); `bay show` prints
outcome, to-do progress and inputs.
Dispatcher: `step.started`, `step.completed`, `step.failed`, `step.skipped`, `step.planned`, `call.completed`
with `mode, endpoint, step, role, agent, env, cost`.

## 10. Session, artifact and finding interfaces (framework)
| interface | endpoints |
|---|---|
| `session.events/v1` | `episodes {since, until}` -> `session.episode/v1[]` + stats (read-only); a commit in an episode carries its scrubbed subject (200 characters) |
| `review.verdicts/v1` | `verdicts {since, until}` -> verdicts with round and subject |
| `artifacts.read/v1` | `files`, `graph` (nodes with refs, edges), `text` (refuses .agentbay/.claude/.git/.env) |
| `improve.detect/v1` | `sessions`, `artifacts`, `resolve`, `recheck`, `change {base}` (read-only: candidates; `change` writes only a temporary export, removed on return). `change` audits the working tree and the tree at the merge-base of `base` and HEAD (exported from that revision's history; never run) and returns `{new, existing}`: the unused, unused-constant, compat-layer and complexity findings whose fingerprint is absent at the merge-base, and how many already existed. `forge.extend` runs it as its `deadcode` step between `implement` and `review`; any new finding (`stopped`) ends the call `blocked` (DOD-14) |
| `improve.findings/v1` | `upsert`, `annotate`, `query`, `get`, `triage`, `decide`, `backlog`, `claim`, `handoff`, `verify` (storage) |

The framework connectors that implement them are bound in the framework env of the mode that uses them; each
connector's README says what it reads.

`improve.finding/v1`: `id, fingerprint, lens, kind, title, pattern, evidence[] {kind: episode|file|measurement|rule|commit,
ref, detail?, rewrite?, value?}, scope, severity, measure?, costEstimate?, rootCause?, proposedFix?, route, impact?,
effort?, occurrences, priority (impact x frequency / effort), status (open|approved|deferred|wontfix|in-progress|fixed|
verified), history[], detector, links[]`. Dedup key: fingerprint = hash(kind, detector key).

## 11. Briefing: items, selectors and the corpus store
- **`item/v1`** is the envelope:
  - `id` (`<source>:<extId>`, unique, what agents cite), `extId`, `source`, `kind`;
  - `author` (an object with three optional fields, shown in the example below), `title`, `text`, `url`, `createdAt`, `fetchedAt`;
  - `container`, `labels[]`, `threadId`;
  - `matched[]`, set by the store.

```yaml
author: {handle?: string, name?: string, email?: string}   # email is the author's address, e.g. a sender
```

  Kind extensions add fields, using `allOf` item/v1 and `unevaluatedProperties: false`. A content type
  (`content-types/<name>/`: `content-type.yaml`, `fields.schema.json`, `views.sql`, and `derive.py` when it
  derives fields) holds the fields of a kind, its version, its views, its child tables and its derived fields:
  - `tables`: one child table per list field of the item (columns, the element fields moved out of the stored
    item, an optional FTS5 index `<table>_fts`); rows are written with the item and deleted with it;
  - `derived` and `deriveVersion`: `derive(item, version)` in `derive.py` (standard library only) computes
    fields once, when the store writes the item; they are stored in `items.derived`, the views read them, and a
    changed `deriveVersion` makes the next sync or prune recompute them from the stored items (nothing is
    fetched).

  The store records the types it was made with (the ones its mode `reads:`) and refuses another version. The
  type's folder documents its own fields. The store validates each item against `<kind>/v<N>` when that schema
  exists.
- **`selector/v1`**: `{id, from?, to?, subject?, text?, in?, has?, since?, not?}`.
  - Every field takes one value or a list (any value matches). Matching is case-insensitive (casefold); `has` is
    `link` or `attachment`; `*` is the only wildcard and works only in `from`/`to`; a field with a `*` value is matched locally, never sent to the source's search. `in` ignores a `label:` or `in:` prefix (`label:Work` matches the label `Work`).
  - Fields within a selector are ANDed, selectors are ORed, and `not` excludes when any of its fields matches.
  - The matcher is `bay/selector.py` `matches()`. It is the only place that decides which items are kept.
- **Connector capability table**: `spec.selectors: {<field>: native|local | {mode, as}}`.
  - `split()` turns a selector into a native query and a local filter. A source may return more than the local
    matcher keeps, never less, so a field is `native` only where the source's search is at least as broad:
    `not` and `*` values are always local, and Gmail keeps `subject` and `text` local too (its search matches
    whole words, and its negation also matches display names).
  - Selectors with the same native query share one fetch and one cursor.
  - A field the source does not list cannot be expressed: `bay check` errors.
  - A `local` field on a paid source (`costPerItemUsd` > 0) gets a validate warning.
- **`items.source/v1.fetch {query, since [until] | cursor, maxItems, checkIds, storedIds, localIn}`** returns
  `{items, cursor, truncated, billed, checked?, deleted?, removed?, oldest?, cursorExpired?, blocked?,
  requests?, warnings?}`. It makes one call per distinct native query and is never billed beyond `maxItems`; `checked`
  lists only ids actually read.
  - A connector that declares `changeFeed: true` is followed: once a query has a
    cursor every sync replays the changes since it, with no deletion checks, and gets `storedIds` (changes to
    them are always read, whatever their age). While the query's coverage starts after the window start, a
    second fetch `{since: window start, until: start of coverage}` backfills older items and skips
    `storedIds`, so a first sync cut by `maxItemsPerRun` completes over later syncs and each item is read once.
    `cursorExpired` (Gmail keeps about a week of history) makes the store drop the cursor and re-list the
    window with deletion checks; stored ids that re-list did not read go into state.json `recheck`, re-read by
    later syncs within the deletion-check share, and status is `stale` until it is empty (and while a replay
    is behind). A selector joining a followed query replays the feed first, then re-lists for it without
    moving the cursor. `localIn` carries the selectors' local (wildcard) `in` values, so a label added to a
    message not stored is read when one matches. A new item older than the source's window is not stored.
  - `oldest`: the oldest message a listing read, kept or not; a truncated fetch's coverage moves from it, so
    a non-item never stalls a backfill.
  - `deleted`: gone at the source; the store deletes them and never stores them again.
  - `removed`: left the source's scope but may come back (Gmail trash, spam); deleted, not remembered.
  - `blocked`: nothing could be read (an expired login), with the command that fixes it. The store keeps that
    source's cursors and items, records it in state.json, reports it as `stopped` and in sync's `blocked`, and
    `status` reports `stale` and `blocked` with the gap in the coverage note. In the dispatcher a sync endpoint
    that read nothing ends `blocked`; a refresh step (`when: stale > ...`) that is blocked lets the call go on
    with the stored items (when there are any) and the call ends `partial`.
  - A connector that declares `exactLabels: true` sends each item's complete label set, so the store replaces
    the stored labels instead of adding to them.
- **`items.store/v1`**: sync and prune run as dispatcher code steps, with effects network, spend, write /
  write, delete. The read endpoints, which agents reach through use shims, are:
  - `describe`: views, columns, row counts, samples, FTS and limits;
  - `sql {sql, limit?}`;
  - `get {ids}`, `thread {id}`, `threads {since, until, selector, important, limit}` (rows active in the
    window from the view the mode's `views.yaml` names under `threads`, with the details it asks for per row and
    `important` when a sender matches one of the patterns; a mode with no such view gets an error);
  - `facets {field}`, `search {text}`, `query {since, until, author, text, selector, ids}`;
  - `status {since?}`: coverage, budget, per-selector counts, engine, and `stale` when the selectors or the
    bound sources changed.

  The store holds exactly the mode's scope: items of the sources bound to the mode's env that match at least
  one current selector. `sync` and `prune` enforce it on every run without refetching (`outOfScope`,
  `unbound`, `unmatched` in their output); a new selector backfills its lookback. After a change of
  selectors or bound sources, sync re-scopes in its own transaction before fetching, and until a sync or
  prune has run every read endpoint except `status` refuses with an error saying to run sync. sync and
  prune of one mode never run at once (a per-mode lock), and spend is saved before the items commit.
- **The store connector** (the framework connector that implements this interface) keeps one store per mode, `<env data folder>/<mode>/corpus.db`
  (settings.mode from the dispatcher; a use-shim read uses its unit's mode and env). The file, -wal and -shm
  are 0600; WAL mode, `user_version` = 3 (`store_meta` records the content types and their versions). A store of any other version is refused (move the folder aside and sync
  again); stores are never converted:
  - `items` (unique source + ext_id; kind fields in `ext`, derived fields in `derived`);
  - `item_selectors`;
  - `store_meta` (the content types, `type:<name>`, and their derive versions, `derive:<name>`);
  - the child tables of the content types the mode reads, each deleted with its item by a trigger;
  - `items_fts` (FTS5 over title, body and author, own content, kept by triggers);
  - the `<table>_fts` tables of the child tables that declare `fullText` (kept by triggers).

  Internal state is `<mode>/state.json` (0600, never opened by agents): cursors per
  `<connector>|<native query>` (`from` is what was fetched; `covers` is what coverage reports, the window
  start when every selector of the query has its own `since`), coverage, budget, deleted, checked, and the selectors and sources last applied.

  Without FTS5 the store falls back to LIKE matching, and `bay check` warns.
- **Agent SQL** (`bay/sqlsandbox.py`):
  - temp views over the store, which holds only the mode's scope: `v_items`, the views of the store's content
    types (`views.sql`; `describe` documents their columns from `content-type.yaml`), `v_fts`, and the types'
    full-text views (`WHERE fts MATCH '...' ORDER BY rank`, plus a `snippet` column); a store holds the types its
    mode reads, so a mode sees only those views;
  - `mode=ro` + `query_only`;
  - a strict pre-pass (`EXPLAIN <sql>`) that refuses the FTS shadow tables, then the run, with FTS5's own
    internal reads allowed;
  - an authorizer: SELECT/READ on those views and on `items`, `item_selectors`, `items_fts`, the types' child
    tables and their FTS5 tables, json_each
    and CTEs, and a function allowlist; everything else is denied, reads of no column (`count(*)`) included;
  - no WITH clause named like a view or store table;
  - a 2 s progress-handler limit, a 1 MB value limit, a 256 MB heap cap (temp_store=FILE), 200/1000 rows, 200 kB per result and 4,000 characters
    per cell.

  Errors are returned as `error`, saying what to change. Every item string, extId and dict keys in kind fields included, is secret-scrubbed at ingest (`scrub_item`), and every
  read is redacted and scanned.

## 12. Conformance rules
`framework/rules/conformance.yaml` (`schemas/conformance.schema.json`, linted by `bay check`): rules with an id,
level, statement and optional deterministic `check`. A feature's
`review.rulesets: [conformance]` adds them to the reviewer's plan; the framework's audit feature runs every rule
that has a check and hands the rest to the analyst.

## Extension recipes
- **New source** -> `bay new connector bsky --implements items.source/v1` (template sets `source`, `window` and a
  `selectors` table, which lint requires), implement `fetch`, then in the env add `bsky` to the `items.source/v1`
  binding and its host/secret names to `network.allow`/`secrets.allow`. Modes, roles and playbooks are untouched.
- **New kind of briefing** -> a mode with `extends: briefing` (purpose, constraints, `configDefaults`, its own
  env in `roles:`, overrides). Its analyst compiles to its own unit (`analyst--<mode>`) with its own store.
- **New feature** -> `bay new feature weekly --mode <mode> --effects read`, fill the playbook and rules, `bay check`.
- **New mode / env** -> `bay new mode <name>` / `bay new env <name>`, or `bay call forge.create`. Behaviour for a role
  in your mode goes in its playbooks, skills and rules; a new framework role is a `forge.extend` proposal.
- **New LLM product** -> a new adapter with its `profile:` (forge.extend); select it with `agent:`. Modes, roles and envs
  do not change.
- **New runtime** -> implement `Adapter`, register it, `./bay.sh build --runtime <name>`. Modes do not change.
- **Change the framework** -> `bay call forge.extend '{"goal": "..."}'` (proposal, approval, review mandatory).
