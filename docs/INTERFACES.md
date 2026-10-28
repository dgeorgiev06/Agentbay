# agentbay interfaces (v0.3)

The contracts. Everything else is replaceable. Design and vocabulary: [DESIGN-v0.2.md](DESIGN-v0.2.md).

```
 modes/  roles/  agents/  envs/  connectors/  interfaces/      (+ framework/ with the same layout)
    │
    ├─> bay lint ─> model.resolve() ─> System ──> Adapter.build ──> .claude/agents/<role>.md, COORDINATOR.md, catalog
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
| 1 | **Mode** (features: in/out, effects, workflow, playbook, rules, review) | `schemas/mode.schema.json` | you add or change a job |
| 2 | **Feature playbook + rules** | `bay/playbook.py`, `schemas/rules.schema.json` | you change a feature's definition of done |
| 3 | **Role / Agent / Environment** | `schemas/{role,agent,environment}.schema.json` | you add a responsibility, executor or wiring |
| 4 | **Capability interface + Connector** | `schemas/{interface,connector}.schema.json`, `bay/connect.py` | you add a capability or a concrete tool |
| 5 | **Adapter** | `bay/adapters/base.py` | you add a runtime |
| 6 | **Dispatcher** (`bay call/submit/use`) | `bay/dispatch.py` | rarely |
| 7 | **TaskEnvelope / Result** | `schemas/task.schema.json` | rarely; version-bump it |
| 8 | **LedgerEvent** | `schemas/event.schema.json` | rarely; version-bump it |
| 9 | **Data**: item/v1 (+ kind extension post/v1), selector/v1, items.coverage/v1, review.verdict/v1, session.episode/v1, improve.finding/v1 | `schemas/data/` | version-bump it |
| 11 | **Briefing sources and corpus store**: items.source/v1, items.store/v1, selectors, read-only SQL | `interfaces/items.*.yaml`, `bay/selector.py`, `bay/sqlsandbox.py` | you add a source kind or a view |
| 10 | **Conformance rules** | `framework/rules/conformance.yaml`, `schemas/conformance.schema.json` | you change what "fits the framework" means |

## 1. Mode and features
`mode.yaml` declares, per endpoint (= feature), everything about it in one place:
`in`/`out` (type names in `types/`), `effects`, `workflow`, `playbook`, `rules`, optional
`review: {role, when: always|never, model?, effort?}` and optional `agents: {role: agent}` placement.
Workflows are ordered steps: `run: <capability>/v<N>.<endpoint>` (code), `role: <role>` (agentic),
`gate: <text>` (approval), `{review: here}` (position of the injected review step).
Modes name capabilities (`needs: [items.store/v1]`), never connectors or tools.

**Inheritance.** `extends: <mode>` is resolved when the kit is loaded (`bay/model.py` `merge_mode`), so the
resolver, lint, conformance, improve and adapters always see a complete mode.
- **Endpoints** merge key by key, so a child can override one feature's review, in/out, playbook or rules.
- **Workflows** are replaced per workflow; `roles` and `coordinator` are replaced.
- **Constraints and inference** merge; `needs` are unioned.
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
The reviewer returns `review.verdict/v1`: per id `pass|fail|n/a`, evidence, severity.

## 3. Role / Agent / Environment
- Role: `prompt`, `doneWhen`, `uses` (`<iface>/v<N>[.<endpoint>]`), default `agent`, optional `inference`, `rules`, `skills`.
- Agent: `runtime` (`claude-code-main` for coordinators, `claude-code-subagent` for workers), `model`, `effort`, `env`.
- Environment: `bind` (interface -> connector(s) or `{tools, clis, mcpServers}`), `secrets {provider, allow}`,
  `network.allow`, `fs {read, write}` (paths relative to the project root), `models`, `effects`, `limits`.
  Envs are the only place capabilities are bound; `agentbay.config.yaml` cannot rebind them. It can select an
  env that declares `substitutes: <env>` (`envs: { local-feeds: local-feeds-offline }`).

Resolution rules (`bay/model.py`) - every gap is reported at once:
unknown role/agent/env/connector/interface/endpoint; unbound capability; effect not declared by the
endpoint or not allowed by the env; model not allowed; connector needs (hosts, secrets, fs, capabilities)
exceed the env; coordinator not on a main-thread runtime; agents granted non-read connector endpoints;
steps that could write `framework/`, `bay/` or `schemas/` outside `forge.extend`.

## 4. Interface + Connector
Interfaces: named endpoints with JSON-schema `in`/`out` and `effects` (`read|write|network|spend|delete`);
`binding: connector` (code) or `tools` (runtime tools). A connector is `connector.yaml` + `entry` exposing
`create(ctx)`; `ctx` gives `config`, `secrets.get/store` (names allowed by env AND connector only),
`http.request` (env allowlist enforced before every request, HTTPS only), `data_dir`, `caps`, `settings`,
`sources` (connectors for capabilities it `needs`), `clock`, and for items.source connectors `source_id`,
`window`, `cost_per_post` and `selectors` (the capability table).

## 5. Adapter
```python
class Adapter(Protocol):
    name: str
    def build(self, system: System, project: Path, kit: Path) -> BuildReport: ...
    def clean(self, project: Path) -> BuildReport: ...
```
Obligations: idempotent; touches only files recorded in `.agentbay/manifest.json`; merges with
user-authored CLAUDE.md, `.claude/settings.json`, `.mcp.json`, never clobbers; `clean` restores them;
writes `.agentbay/catalog.json` (modes, endpoints, roles). The claude-code adapter also writes per-role use
shims, `.agentbay/guard.json` and the PreToolUse guard hook (Bash and every file tool), plus `Edit` deny rules on
`.agentbay/**`, `.claude/**` and the kit. Register in `bay/adapters/__init__.py`.

## 6. Dispatcher
`bay call <mode>.<endpoint> '<json>'` -> `{callId, status, output | next, checks, review, cost}`.
Status: `done | partial | blocked | failed | needs-agent | awaiting-approval`.
`bay submit <callId> <stepId> '<json>' [--usage '{"tokens": N, "costUsd": X, "durationMs": N}']` resumes an agentic step (usage goes to the step's ledger event); `bay show <callId>` prints the current state; approval gates pass only with `bay approve <callId>` in an interactive terminal. A role's generated shim
`.agentbay/roles/<role>/use <iface>/v<N>.<ep> '<json>'` (role fixed inside, read-only endpoints in the role's `uses`)
is the only way an agent reads connector data; the guard hook stops subagents from running anything else. Secret values are redacted from everything it returns or logs.

## 7. TaskEnvelope/v1 -> Result/v1
Plain fenced YAML blocks (```` ```task ```` / ```` ```result ````). One deliverable per envelope.

## 8. LedgerEvent
Append-only JSONL. Agent runs: `spawned`, `completed`, `failed`, `reclaimed`, `note` (hooks/coordinator; a note
attaches to a run by runId/taskId or stays standalone, never creating a run; `data.kind` is `note`,
`instruction-change` or `decision`).
Guard: `permission.denied` (tool, agent, reason; never the command).
Optional on any event: `durationMs`, `tokens {input, output, cacheRead, cacheCreation, total}`, `costUsd`.
Every value is secret-scanned (`bay/secretscan.py`) and redacted (`vault.redact`) before it is written.
Data: `data.read` (a role read connector data through its use shim; role, env, endpoint, item count).
Dispatcher: `step.started`, `step.completed`, `step.failed`, `step.skipped`, `step.planned`, `call.completed`
with `mode, endpoint, step, role, agent, env, cost`.

## 9. improve capability interfaces (framework)
| interface | endpoints | connector(s) in `improve-local` |
|---|---|---|
| `session.events/v1` | `episodes {since, until}` -> `session.episode/v1[]` + stats (read-only) | `ledger`, `claude-transcripts`, `git` |
| `review.verdicts/v1` | `verdicts {since, until}` -> verdicts with round and subject | `ledger` |
| `artifacts.read/v1` | `files`, `graph` (nodes with refs, edges), `text` (refuses .agentbay/.claude/.git/.env) | `artifact-graph` |
| `improve.detect/v1` | `sessions`, `artifacts`, `resolve`, `recheck` (read-only: candidates, never writes) | `improve-detect` |
| `improve.findings/v1` | `upsert`, `annotate`, `query`, `get`, `triage`, `decide`, `backlog`, `claim`, `handoff`, `verify` (storage) | `improve-store` |

`improve.finding/v1`: `id, fingerprint, lens, kind, title, pattern, evidence[] {kind: episode|file|measurement|rule|commit,
ref, detail?, rewrite?, value?}, scope, severity, measure?, costEstimate?, rootCause?, proposedFix?, route, impact?,
effort?, occurrences, priority (impact x frequency / effort), status (open|approved|deferred|wontfix|in-progress|fixed|
verified), history[], detector, links[]`. Dedup key: fingerprint = hash(kind, detector key).
An endpoint review block may name framework rule sets: `review: { ..., rulesets: [conformance] }`.

## 10. Briefing: items, selectors and the corpus store
- **`item/v1`** is the envelope:
  - `id` (`<source>:<extId>`, unique, what agents cite), `extId`, `source`, `kind`;
  - `author {handle?, name?, email?}`, `title`, `text`, `url`, `createdAt`, `fetchedAt`;
  - `container`, `labels[]`, `threadId`;
  - `matched[]`, set by the store.

  Kind extensions add fields. `post/v1` adds `lang` and `metrics`, using `allOf` item/v1 and
  `unevaluatedProperties: false`. The store validates each item against `<kind>/v1` when that schema exists.
- **`selector/v1`**: `{id, from?, to?, subject?, text?, in?, has?, since?, not?}`.
  - Every field takes one value or a list (any value matches). Matching is case-insensitive (casefold); `has` is
    `link` or `attachment`; `*` is the only wildcard and works only in `from`/`to`.
  - Fields within a selector are ANDed, selectors are ORed, and `not` excludes when any of its fields matches.
  - The matcher is `bay/selector.py` `matches()`. It is the only place that decides which items are kept.
- **Connector capability table**: `spec.selectors: {<field>: native|local | {mode, as}}`.
  - `split()` turns a selector into a native query and a local filter.
  - Selectors with the same native query share one fetch and one cursor.
  - A field the source does not list cannot be expressed: `bay validate` errors.
  - A `local` field on a paid source (`costPerPostUsd` > 0) gets a validate warning.
- **`items.source/v1.fetch {query, since | cursor, maxItems, checkIds}`** returns
  `{items, cursor, truncated, billed, checked?, deleted?, requests?, warnings?}`. It makes one call per
  distinct native query and is never billed beyond `maxItems`.
- **`items.store/v1`**: sync and prune run as dispatcher code steps, with effects network, spend, write /
  write, delete. The read endpoints, which agents reach through use shims, are:
  - `describe`: views, columns, row counts, samples, FTS and limits;
  - `sql {sql, limit?}`;
  - `get {ids}`, `thread {id}`;
  - `facets {field}`, `search {text}`, `query {since, until, author, text, selector, ids}`;
  - `status {since?}`: coverage, budget, per-selector counts, engine, and `stale` when the selectors or the
    bound sources changed.

  The store holds exactly the mode's scope: items of the sources bound to the mode's env that match at least
  one current selector. `sync` and `prune` enforce it on every run without refetching (`outOfScope`,
  `unbound`, `unmatched` in their output); a new selector backfills its lookback.
- **corpus-store** (framework connector) keeps one store per mode, `<env data folder>/<mode>/corpus.db`
  (settings.mode from the dispatcher; use-shim reads resolve the role's one mode). The file, -wal and -shm
  are 0600; WAL mode, `user_version` = 1:
  - `items` (unique source + ext_id);
  - `item_selectors`;
  - `items_fts` (FTS5 over title, body and author, own content, kept by triggers).

  Internal state is `<mode>/state.json` (0600, never opened by agents): cursors per
  `<connector>|<native query>`, coverage, budget, deleted, checked, and the selectors and sources last applied.

  Without FTS5 the store falls back to LIKE matching, and `bay validate` warns.
- **Agent SQL** (`bay/sqlsandbox.py`):
  - temp views `v_items`, `v_posts` and `v_fts` over the store, which holds only the mode's scope. `v_fts` is
    the documented full-text path: `WHERE fts MATCH '...' ORDER BY rank`, plus a `snippet` column;
  - `mode=ro` + `query_only`;
  - a strict pre-pass (`EXPLAIN <sql>`) that refuses the FTS shadow tables, then the run, with FTS5's own
    internal reads allowed;
  - an authorizer: SELECT/READ on those views and on `items`, `item_selectors` and `items_fts`, json_each
    and CTEs, and a function allowlist; everything else is denied, reads of no column (`count(*)`) included;
  - no WITH clause named like a view or store table;
  - a 2 s progress-handler limit, a 1 MB value limit, a 256 MB heap cap (temp_store=FILE), 200/1000 rows, 200 kB per result and 4,000 characters
    per cell.

  Errors are returned as `error`, saying what to change. Every item string but its identity is secret-scrubbed at ingest (`item_row`, shared with the migration), and every
  read is redacted and scanned.
- **Migration**: `bay migrate --project <repo>` (the user; forge.migrate migrates kit content only) converts
  a v0.2 `posts.jsonl` + `state.json` into `<dir>/feed-briefing/corpus.db` + `state.json`, writing only the
  posts in feed-briefing's scope. It shows a dry-run diff first, and `--confirm` applies it. Bad lines and
  state are reported as file:line with the fix.
- **Deprecated v0.2 names** (0.3.x only, `bay/aliases.py`): feed.source/v1, feed.store/v1, feed.post/v1,
  feed.coverage/v1, feed-analyst, feed-lead and local-store resolve to the v0.3 names with a lint warning.
  `bay migrate` rewrites them. Old connector code is a load error asking for a hand port.

## Extension recipes
- **New source** -> `bay connector new bsky --implements items.source/v1` (template sets `source`, `window` and a
  `selectors` table, which lint requires), implement `fetch`, then in the env add `bsky` to the `items.source/v1`
  binding and its host/secret names to `network.allow`/`secrets.allow`. Modes, roles and playbooks are untouched.
- **New kind of briefing** -> a mode with `extends: briefing` (purpose, constraints, config defaults, overrides).
- **New feature** -> `bay feature new weekly --mode feed-briefing --effects read`, fill the playbook and rules, `bay lint`.
- **New mode / role / env** -> `bay mode new <name>` / `bay role new <name>` / `bay env new <name>`, or `bay call forge.create`.
- **New runtime** -> implement `Adapter`, register it, `./bay.sh build --runtime <name>`. Modes do not change.
- **Change the framework** -> `bay call forge.extend '{"goal": "..."}'` (proposal, approval, review mandatory).
