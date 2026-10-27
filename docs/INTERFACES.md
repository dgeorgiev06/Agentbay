# agentbay interfaces (v0.2)

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
| 9 | **Data**: feed.post/v1, feed.coverage/v1, review.verdict/v1 | `schemas/data/` | version-bump it |

## 1. Mode and features
`mode.yaml` declares, per endpoint (= feature), everything about it in one place:
`in`/`out` (type names in `types/`), `effects`, `workflow`, `playbook`, `rules`, optional
`review: {role, when: always|never, model?, effort?}` and optional `agents: {role: agent}` placement.
Workflows are ordered steps: `run: <capability>/v<N>.<endpoint>` (code), `role: <role>` (agentic),
`gate: <text>` (approval), `{review: here}` (position of the injected review step).
Modes name capabilities (`needs: [feed.store/v1]`), never connectors or tools.

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
  Envs are the only place capabilities are bound; `agentbay.config.yaml` cannot rebind them.

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
`sources` (connectors for capabilities it `needs`), `clock`.

## 5. Adapter
```python
class Adapter(Protocol):
    name: str
    def build(self, system: System, project: Path, kit: Path) -> BuildReport: ...
    def clean(self, project: Path) -> BuildReport: ...
```
Obligations: idempotent; touches only files recorded in `.agentbay/manifest.json`; merges with
user-authored CLAUDE.md, `.claude/settings.json`, `.mcp.json`, never clobbers; `clean` restores them;
writes `.agentbay/catalog.json` (modes, endpoints, roles). Register in `bay/adapters/__init__.py`.

## 6. Dispatcher
`bay call <mode>.<endpoint> '<json>'` -> `{callId, status, output | next, checks, review, cost}`.
Status: `done | partial | blocked | failed | needs-agent | awaiting-approval`.
`bay submit <callId> <stepId> '<json>'` resumes. A role's generated shim
`.agentbay/roles/<role>/use <iface>/v<N>.<ep> '<json>'` (role fixed inside, read-only endpoints in the role's `uses`)
is the only way an agent reads connector data; the guard hook stops subagents from running anything else. Secret values are redacted from everything it returns or logs.

## 7. TaskEnvelope/v1 -> Result/v1
Plain fenced YAML blocks (```` ```task ```` / ```` ```result ````). One deliverable per envelope.

## 8. LedgerEvent
Append-only JSONL. Agent runs: `spawned`, `completed`, `failed`, `reclaimed`, `note` (hooks/coordinator).
Dispatcher: `step.started`, `step.completed`, `step.failed`, `step.skipped`, `step.planned`, `call.completed`
with `mode, endpoint, step, role, agent, env, cost`.

## Extension recipes
- **New source** -> `bay connector new bsky --implements feed.source/v1` (template sets `source` and
  `window`, which lint requires), implement `fetch`, then in the env add `bsky` to the `feed.source/v1`
  binding and its host/secret names to `network.allow`/`secrets.allow`. Modes, roles and playbooks are untouched.
- **New feature** -> `bay feature new weekly --mode feed-briefing --effects read`, fill the playbook and rules, `bay lint`.
- **New mode / role / env** -> `bay mode new <name>` / `bay role new <name>` / `bay env new <name>`, or `bay call forge.create`.
- **New runtime** -> implement `Adapter`, register it, `./bay.sh build --runtime <name>`. Modes do not change.
- **Change the framework** -> `bay call forge.extend '{"goal": "..."}'` (proposal, approval, review mandatory).
