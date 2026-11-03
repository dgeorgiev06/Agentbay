# agentbay interfaces

The contracts. Everything else is replaceable. Design and vocabulary: [DESIGN.md](DESIGN.md).

```
 components/  adapters/                      you and the shipped set: modes, source connectors, content types, shared components
 framework/{roles,rules}/  schemas/  bay/    the kernel (an agent profile is in adapters/<name>/adapter.yaml)
    │
    ├─> bay check ─> model.resolve() ─> System ──> Adapter.build ──> .claude/agents/<role>--<mode>.md, COORDINATOR.md, catalog
    │                  (exact gaps)                                  (claude-code today)
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
| 0 | **Component** (a folder with one manifest) | `schemas/component.schema.json` and the schema of each manifest kind, `bay/model.py` | you add or remove a mode, source connector, content type or shared component |
| 1 | **Mode** (features: in/out, effects, steps, optional playbook and rules, review) | `schemas/mode.schema.json` | you add or change a job |
| 2 | **Feature playbook + rules** | `bay/playbook.py`, `schemas/rules.schema.json` | you change a feature's definition of done |
| 3 | **Role / Agent profile / Environment** | `schemas/{role,environment}.schema.json`; the profile is `profile:` in `schemas/adapter.schema.json` | the framework adds a job or an LLM product; you add wiring |
| 4 | **Capability interface + Connector** | `schemas/{interface,connector}.schema.json`, `bay/connect.py` | you add a capability or a concrete connector |
| 5 | **Adapter + registry** (`.agentbay/catalog.json`) | `bay/adapter.py`, `bay/registry.py` | you add a runtime, or something a coordinator must discover |
| 6 | **Project workflow** (stages composing `<mode>.<endpoint>`) | `schemas/config.schema.json` `workflows`, `bay/workflows.py` | you compose modes differently |
| 7 | **Dispatcher** (`bay call/submit/use`) | `bay/dispatch.py` | rarely |
| 8 | **TaskEnvelope / Result** | `schemas/task.schema.json` | rarely; version-bump it |
| 9 | **LedgerEvent** | `schemas/event.schema.json` | rarely; version-bump it |
| 10 | **Session, artifact and finding interfaces** | the interface files of the component that owns them, and its `data/` folder | you add a detector source or finding field |
| 11 | **Items, selectors, corpus store, read-only SQL** | the interface files `items.*.yaml`, `schemas/data/` (item, coverage, verdict), the `data/` folder of the component that owns a schema, `bay/selector.py`, `bay/sqlsandbox.py` | you add a source kind or a view |
| 12 | **Conformance rules** | `framework/rules/conformance.yaml`, `schemas/rules.schema.json` | you change what "fits the framework" means |

Every contract document starts with `apiVersion: agentbay/v4`, and the `$id` of each schema carries it. Config and
ledger events stay at `agentbay/v3`. A file with any other version is refused by `bay check` and at run time with
the line to change; there is no reader or migration for it.

## Components

A component is a folder `components/<name>/` with one manifest. The manifest decides its kind; names are
unique across kinds.

| Manifest | Kind | Schema |
|---|---|---|
| `mode.yaml` | Mode | `schemas/mode.schema.json` |
| `connector.yaml` | Connector | `schemas/connector.schema.json` |
| `content-type.yaml` | ContentType | `schemas/content-type.schema.json` |
| `component.yaml` | Component | `schemas/component.schema.json` |

The folder name finds what a component provides; the manifest lists none of it. The folders are
`interfaces/` (one `<name>.v<N>.yaml` per interface), `envs/` (one file per env), `skills/<skill>/SKILL.md`,
`types/`, `data/`, `connectors/<name>/` (internal connectors), `features/` and `tests/`. The loader in
`bay/model.py` maps kind to manifest file name and finds every instance with
`components/*/<manifest>`. What a component needs stays in its manifest: `needs:` (interfaces), `reads:` (content
types) and `extends:` (a parent mode).

The placement rule decides where a connector sits. A connector that declares `needs.network`, `needs.secrets` or an
`fs` path under `~` or `/` is a source connector at `components/<name>/`. Any other connector sits at
`components/<owner>/connectors/<name>/`, in the component that owns it.

`bay check` refuses a connector in the wrong place (the message names the folder to move it to), a component folder
without a manifest, and a leftover `modes/`, `envs/`, `connectors/`, `content-types/`, `coordinator/` or
`interfaces/` folder at the top level, or an `interfaces/` folder under `framework/`, with "move it to components/<name>/".

## 1. Mode and features
`mode.yaml` declares each feature (`spec.features.<name>`, called as `<mode>.<name>`): `in` and `out`
(type names in `types/`), `effects`, `steps`, an optional `playbook` and `rules`, an optional
`review: {role, when: always|never, tier?, effort?}`, optional `tier` and `effort` for its role steps, and optional
`roles: {role: env}` overrides. There is no separate endpoint, workflow or feature file.

Steps are ordered. A step is `run: <capability>/v<N>.<endpoint>` (code), `role: <role>` (agentic; may set `tier`,
`effort` and `roles: {<its role>: <env>}`), `gate: <text>` (approval; never with `when:`; `approves: $in.<field>`
records that file's path and sha256) or `{review: here}` (where the injected review step goes). A mode's
`roles: {role: env}` lists the framework roles it uses and the env each works in. A step runs in the env it
names, else the feature's, else the mode's. A mode `needs: [items.store/v1]`, and the read-only endpoints of its
`needs` are what its roles may read. `configDefaults:` replaces config-schema defaults for this mode (a child never
copies its parent's schema).

**Inheritance.** `extends: <mode>` is resolved when the kit is loaded (`bay/model.py` `merge_mode`), so every
reader sees a complete mode. DESIGN says what a child replaces and what it merges.
- `bay show <mode> --resolved` prints the result with the mode.yaml each feature comes from. A child's
  `coordinator` replaces its parent's.
- **`uses:` and `skills:`** (per feature) scope what its role steps get. `uses` lists the read endpoints
  (`items.store/v1.sql`) they may call through the use shim, each granted to a role of the feature; it is required
  when a role is granted any (`[]` for none). While a call of the feature waits on a role unit, that unit's shim
  reaches only the `uses` (with no such open call the role-level grant applies). `skills` lists the mode's skills
  the step plan hands them (absent: all); a playbook may name only those.
- Types, skills and the coordinator `playbook.md` are looked up in the child first, then its ancestors.
- A child file may be partial; the merged result is validated against the full schema. Inheritance cycles and
  missing parents are reported with the file to fix.
- `abstract: true` marks a base that is linted but never resolved, installed or called. It is not inherited.

## 2. Playbook + rules
Playbook H2 sections follow the order in [DESIGN.md](DESIGN.md#features); Steps are numbered.
Rules: `{id: R-n, level, statement, appliesTo: executor|reviewer|both, check?, refs?, when?: {kind}}`.
Endpoint `schedule` is declarative only (lint warns); run it from cron.
Deterministic checks (`bay/checks.py`): `citations_resolve`, `citations_min:<n>`, `no_secrets`, `lint_clean`.
The reviewer returns `review.verdict/v1`: per id `pass|fail|n/a`, evidence, severity, and optionally `cites`
`{taskId, outcome, todo[]}` (the recorded outcome and to-do items the verdict rests on). The review brief
carries `review.recordedPlans` (taskId -> step, outcome, to-do progress) of the agents it judges, and `recheck`
when a halted review is run again. The rules for halting and for the re-check are in
[DESIGN.md](DESIGN.md#features).

## 3. Role / Agent profile / Environment
- Role (`framework/roles/`): `prompt`, `doneWhen`, `rules`, `skills`, default `tier` (fast | balanced | deep),
  optional `effort`, `access` (read | write). No agent, env or data access of its own.
- Agent profile (`profile:` in `adapters/<name>/adapter.yaml`, `agent:` in agentbay.config.yaml): `runtime`
  `{coordinator: claude-code-main, worker: claude-code-subagent}`, `tiers {fast, balanced, deep} -> model`, an
  `effort` mapping and an optional mapping of capability names to the runtime's. It is the only place a model name
  appears.
- Environment: `bind` (interface -> connector names, or the runtime's own capabilities; example below),
  `secrets {provider, allow}`, `network.allow`, `fs {read, write}` (paths relative to the project root), optional
  `tiers` cap, `effects`, `limits` (the ceiling for every cap), and an optional `offline {bind, network, secrets}`.
  With `offline: true` in agentbay.config.yaml the env binds `offline.bind` over its own bindings and has no
  network and no secrets (`bay check` refuses an `offline` block that lists a host or a secret).

```yaml
bind:
  items.source/v1: [gmail-api]                        # connector names
  web.research/v1: { tools: [WebSearch, WebFetch] }   # the runtime's own capabilities (also clis, mcpServers)
```

- Grants of a unit (role, mode, env) are described in DESIGN under Compile. An interface marked `dispatcherOnly`
  is never granted to an agent. `bay check` rejects a runtime binding that lists file-writing abilities or CLIs
  beyond read-only version control under a capability without the `write` effect.
- Tier: step (a review: its review block) > feature > role default. The profile maps a tier to a model, and the
  env's `tiers` cap both step tiers and the role's default tier.
  Envs are the only place capabilities are bound. `agentbay.config.yaml` can switch every env's `offline:` block on
  and can lower a cap, never raise it.
- User modes may put roles only in their own envs (`components/<name>/envs/`) and the protected envs that
  `framework/kernel.yaml` opens to them (`protected:`, each env's `modes:`).
- Code steps (`run:`) run in the coordinator's env for that feature; `bay check` warns when a store-reading
  mode puts a role in an env whose `items.store`/`items.source` bindings differ from it.

`bay/model.py` resolves all of this and reports every gap at once (DESIGN, Compile).

## 4. Interface + Connector
An interface lives in `interfaces/` of the component that owns it, which is the component whose mode needs it.
Interfaces that several modes use live in the shared component. An interface has named endpoints with JSON-schema
`in`/`out` and `effects` (`read|write|network|spend|delete`), and a `binding`:

```yaml
binding: connector     # code the dispatcher runs; the other value, tools, binds the runtime's own capabilities
```

`ownerOnly: true` on an endpoint: no step of any mode may run it (resolver and lint refuse it); only the owner's
own command reaches it (`improve.findings/v1.decide`, via `bay approve <F-id>`).

`framework/kernel.yaml` has two keys. `owns:` lists the paths the boundary check treats as core (globs; a trailing
`/` owns everything below). `protected:` lists what only `forge.extend` may change and has four required keys.
`paths` lists folders. `mode`, `env` and `connector` list names, wherever their folders sit. An `env` entry can be
`{modes: [...]}`, the unprotected modes that may place roles there (`*` is every mode). A bad block fails closed: every name is reserved.

A connector is `connector.yaml` + `entry` exposing `create(ctx)`; `ctx` gives `config`, `secrets.get/store` (names
allowed by env AND connector only), `http.request` (env allowlist enforced before every request, HTTPS only),
`data_dir`, `caps`, `settings`, `sources` (connectors for capabilities it `needs`), `clock`, and for items.source
connectors `source_id`, `window`, `cost_per_item` and `selectors` (the capability table).

A connector that needs an interactive login (for example an OAuth browser flow that stores a refresh token) names a
function of its `entry` in `login:`. `bay auth <connector> [--env <env>]` runs it; Claude Code always asks first. The function gets `secret(name)` and
`store_secret(name, value)` for names in both the env's `secrets.allow` and the connector's `needs.secrets`, `http`
limited to the connector's declared hosts that the env allows, `open_browser(url)` and `say(text)`. The entry runs
in-process, so this limits the API it is handed, not what the process can do. `bay check` refuses a `login:` whose
`needs.secrets` no env that binds the connector allows.

## 5. Adapter and registry
```python
class Adapter(Protocol):
    name: str
    def build(self, system: System, project: Path, kit: Path) -> BuildReport: ...
    def clean(self, project: Path) -> BuildReport: ...
```
Obligations: idempotent; touches only files recorded in `.agentbay/manifest.json`; merges with
user-authored CLAUDE.md, `.claude/settings.json`, `.mcp.json`, never clobbers; `clean` restores them;
writes the registry via `bay.registry.write`. The catalog is the same for every runtime, and an adapter supplies
only its own `runtime` name, so a second runtime discovers the same modes, endpoints (with resolved input and
output schemas), roles and project workflows. The claude-code adapter also writes `Edit` deny rules on
`.agentbay/**`, `.claude/**` and the kit. A runtime is a folder `adapters/<name>/` with `adapter.yaml` (name =
folder, module inside the folder, class). Lint finds it by folder and checks it, and reports a malformed entry
without importing it.

The build names a component's skill `.claude/skills/<component>--<skill>/` and a role's skill `<role>--<skill>`
(lowercase letters, digits and hyphens, at most 64), and rewrites the `name:` in the copied SKILL.md to match.
Playbooks and role prompts keep the short name.

## 6. Project workflows and the root coordinator
The root mode (a framework mode; its README names its endpoints) supplies the preamble of the generated
`.agentbay/COORDINATOR.md` and runs project workflows over `workflow.run/v1`. A project workflow is
`workflows.<name>` in `agentbay.config.yaml` with `description`, `in` (JSON schema) and `steps`, each
`{id, call: <mode>.<endpoint>, with?, when?}` or `{id, gate: <text>}`, using the same `$in` and `$steps.<id>`
substitution as a feature's steps. `bay check` checks structure (ids, `$steps` order, gate references), then
targets against the registry and each `with` against the endpoint's input schema. Run state is in
`.agentbay/data/workflows/`, written only by the connector bound to `workflow.run/v1`. A report the run cannot take fails `cos.run` or `cos.next`; `approve` returns it.

## 7. Dispatcher
`bay call <mode>.<endpoint> '<json>'` -> `{callId, status, output | next, checks, review, cost}`.
Status: `done | partial | blocked | failed | needs-agent | awaiting-approval | abandoned`. `abandoned` means a person ended the call .
`bay submit <callId> <stepId> '<json>' [--usage '{"tokens": N, "costUsd": X, "durationMs": N}']` resumes an agentic
step (usage goes to the step's event); `bay show <callId>` prints the current state (`bay show reclaim <runId>`
marks a stuck run reclaimed; `bay show close <callId> --reason <text>` ends an open call as abandoned, with the reason in the ledger).
An input type that declares `replaces: <callId>` (`forge.extend` does) closes that open call as abandoned. Gates pass with `bay approve` ([safety model](DESIGN.md#safety-model)); a changed file returns the call to its passed gate at the next submit. `approve.plans` lists role steps (`<mode>.<endpoint>[.<step>]`) that get a plan step and a gate first; `approve.planner` sets their tier and effort. A role's generated shim
`.agentbay/roles/<role>--<mode>/use <iface>/v<N>.<ep> '<json>'` is its only way to read connector data, and the
guard hook stops subagents from running anything else.

## 8. TaskEnvelope/v1 -> Result/v1
Plain fenced YAML blocks (```` ```task ```` / ```` ```result ````). One deliverable per envelope.

## 9. LedgerEvent
Append-only JSONL. Every value is secret-scanned (`bay/secretscan.py`) and redacted (`vault.redact`) before it is
written. Any event may carry `durationMs`, `tokens {input, output, cacheRead, cacheCreation, total}` and `costUsd`.
- Dispatcher: `step.started`, `step.completed`, `step.failed`, `step.skipped`, `step.planned` and `call.completed`,
  with `mode, endpoint, step, role, agent, env, cost`. `step.started` carries a step's inputs in `data.inputs` (the
  value, or its sha256 plus a scrubbed preview).
- Agent runs, from hooks and the coordinator: `spawned`, `completed`, `failed`, `reclaimed` and `note`. `bay note done <taskId>`
  appends `completed` for a dispatched agent when no hook records it. A reclaimed or completed run stays so, even
  if known only from its `agent.dispatch`. A note attaches to a run by runId or taskId, or stands alone, and never creates a run. `data.kind` is `note`,
  `instruction-change` or `decision`.
- Guard: `permission.denied` (tool, agent, reason; never the command). Use shims: `data.read` (role, env,
  endpoint, item count).
- `agent.dispatch`: `bay note dispatch <taskId> --agent <name> [--call --step --model --tier --role --mode --input ...]`,
  run by the coordinator before every dispatch.
- `agent.plan` and `agent.plan.done`: `bay plan <taskId> '{"outcome", "todo": [{"text", "serves"}]}'`, then
  `bay plan <taskId> --done <n>`. One plan per dispatched taskId, written only by the agent it was dispatched to. A
  role-step `bay submit` is refused when its taskId has no plan.
- `review.recorded`: `bay note review <taskId> '<review.verdict/v1>'`, for a review run outside a framework review
  step. It changes no call, gate or approval.

`bay status --agents` groups runs by role, mode, model and tier from these events alone, and `bay show` prints
outcome, to-do progress and inputs. `bay status` lists work with no event for 24 hours under `STALE?` (`--json`: a
`stale` list), and says when a hook is not loaded.

## 10. Session, artifact and finding interfaces
These interfaces are files in `interfaces/` of the component that owns them, and the finding and episode schemas
are in its `data/` folder. Read the endpoints and fields there. A finding's dedup key is its `fingerprint`, the
hash of its kind and its detector key.

## 11. Items, selectors and the corpus store
The item envelope, content types, selectors, the store layout and the SQL sandbox are described in the README of the
component that owns the base source mode. The endpoints are in the interface files `items.source.v1.yaml` and
`items.store.v1.yaml`.

## 12. Conformance rules
`framework/rules/conformance.yaml` (`schemas/rules.schema.json`, linted by `bay check`): rules with an id,
level, statement and optional deterministic `check`. A feature's
`review.rulesets: [conformance]` adds them to the reviewer's plan; the framework's audit feature runs every rule
that has a check and hands the rest to the analyst.

## Extension recipes
- **New source** -> `bay new connector bsky --implements items.source/v1` creates the folder `components/<name>/`
  with a template that sets `source`, `window` and a `selectors` table (lint requires them). Implement `fetch`. Then
  in the env of the mode that uses the source, add `bsky` to the `items.source/v1` binding and its host and secret
  names to `network.allow` and `secrets.allow`. Modes, roles and playbooks are untouched. A source that produces a
  new kind of item also needs a content type component.
- **New kind of digest** -> a mode component that extends the base source mode, with its own purpose, constraints,
  `configDefaults` and env. Its analyst compiles to its own unit (`analyst--<mode>`) with its own store.

  ```yaml
  spec:
    extends: briefing          # sync, digest, ask and prune come from the base
    reads: [post/v1]           # the item kinds its features read
  ```
- **New feature** -> `bay new feature weekly --mode <mode> --effects read`, fill the playbook and rules, `bay check`.
- **New mode or env** -> `bay new mode <name>` or `bay new env <name> --mode <mode>` (the env goes in that mode's
  folder), or `bay call forge.create`. Behaviour for a role in your mode goes in its playbooks, skills and rules; a
  new framework role is a `forge.extend` proposal.
- **New LLM product** -> a new adapter with its `profile:` (`forge.extend`); select it with `agent:`. Modes, roles and envs
  do not change.
- **New runtime** -> implement `Adapter`, register it, `./bay.sh build --runtime <name>`. Modes do not change.
- **Change the framework** -> `bay call forge.extend '{"goal": "..."}'` (proposal, approval, review mandatory).
