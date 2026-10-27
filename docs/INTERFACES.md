# agentbay interfaces

Five contracts. Everything else is replaceable.

```
 specs/*.yaml ─┐                       ┌─> .claude/agents/*.md      (claude-code)
               ├─> resolve() ─> ResolvedAgent[] ─> Adapter.build ─┼─> managed agents   (next)
 layers/*/  ───┘   (model.py)                     (adapters/)     └─> agent SDK         (next)

 coordinator ──TaskEnvelope/v1──> worker ──Result/v1──> coordinator
       │                            │
       └──── LedgerEvent (hooks + CLI) ───> .agentbay/ledger/events.jsonl ──> bay status
```

| # | Contract | Schema | Owner | Changes when |
|---|----------|--------|-------|--------------|
| 1 | **AgentSpec** – the "image" | `schemas/agentspec.schema.json` | you | you add/tune an agent |
| 2 | **Layer** – reusable capability | `schemas/layer.schema.json` | you | you add tools, MCP, skills, CLIs |
| 3 | **Adapter** – spec → runtime | `bay/adapters/base.py` | kit | you add a runtime |
| 4 | **TaskEnvelope / Result** – work protocol | `schemas/task.schema.json` | kit | rarely; version-bump it |
| 5 | **LedgerEvent** – system state | `schemas/event.schema.json` | kit | rarely; version-bump it |

## 1. AgentSpec
Identity (`metadata.name`, `description` written *for the coordinator*), `model`,
ordered `layers`, extra `tools`/`skills`/`clis`, `denyTools` (deny always wins),
`isolation` (`none`|`worktree`), `budget`, and `prompt`. `role: coordinator`
marks the chief of staff; everything else is a worker.

## 2. Layer
`requires` (other layers), `tools`, `mcpServers`, `skills` (folders in
`layers/<name>/skills/`), `clis` (narrow command prefixes), `prompt` fragment,
and a `tier` (`infrastructure` → `domain` → `product`).

Resolution rules (in `bay/model.py`):
- dependencies expand depth-first, each layer once, cycles are errors
- tools: ordered union of layers, then spec, then minus `denyTools`
- MCP servers: union; the same name defined two different ways is an error
- prompt: layer fragments in order, then the agent's own prompt
- declaring `clis` without `Bash` is an error

## 3. Adapter
```python
class Adapter(Protocol):
    name: str
    def build(self, agents: list[ResolvedAgent], project: Path, kit: Path) -> BuildReport: ...
    def clean(self, project: Path) -> BuildReport: ...
```
Obligations: idempotent; touches only files it records in
`.agentbay/manifest.json`; merges with user-authored config, never clobbers;
writes `.agentbay/catalog.json`. Register in `bay/adapters/__init__.py`.

## 4. TaskEnvelope/v1 → Result/v1
Plain fenced YAML blocks (```` ```task ```` / ```` ```result ````) so the protocol
rides on any runtime that passes text. One deliverable per envelope. Result
`status` is `done | partial | blocked | failed`.

## 5. LedgerEvent
Append-only JSONL. Types: `spawned`, `completed`, `failed`, `reclaimed`, `note`.
State is `ledger.fold(events)`. Hooks write spawn/complete automatically; the
coordinator writes notes; humans can reclaim.

## Extension recipes
- **New capability** → `./bay.sh new layer <name>`, fill it, add to an agent's `layers`.
- **New worker** → `./bay.sh new agent <name> --layers a,b`, `./bay.sh build`, restart Claude Code.
- **New runtime** → implement `Adapter` in `bay/adapters/<runtime>.py`, register, `./bay.sh build --runtime <runtime>`.
  Specs, layers, protocol and ledger do not change.
