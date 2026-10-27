# agentbay

Container-style agents for Claude Code. Define agents as specs composed from
layers, compile them into a runtime, and run a **chief-of-staff coordinator**
that delegates to workers and tracks everything in a ledger.

Today's runtime: interactive Claude Code on your desktop. The specs, protocol,
and ledger are runtime-agnostic, so a Managed Agents or Agent SDK adapter can be
added later without rewriting agents. See [docs/INTERFACES.md](docs/INTERFACES.md).

## Quickstart (5 minutes)

```bash
pip install pyyaml jsonschema          # jsonschema optional but recommended
cd agentbay
./bay.sh validate                      # check specs + layers
./bay.sh --project ~/code/my-repo build   # compile into a repo (or omit --project for cwd)
cd ~/code/my-repo && claude            # start Claude Code; your session is now the Chief of Staff
```

Inside Claude Code:

- `/bay-team` – list workers and what they're for
- `/bay-delegate <request>` – plan and dispatch work
- `/bay-status` – what's running, finished, blocked
- `/agents` – Claude Code's own view of the generated subagents

Try: `/bay-delegate research the top 3 open-source agent sandbox runtimes, then draft a one-page comparison in docs/sandboxes.md and have it reviewed`

## What you get

```
agentbay/
  schemas/          the contracts (JSON Schema)
  layers/           reusable capability bundles
    base/           read-only workspace (infrastructure)
    research/       web search + research-brief skill
    code/           edit/write/bash + narrow git permissions
    review/         read-only git + review-checklist skill
    github/         EXAMPLE MCP layer (unused by default)
  specs/            agents = layers + model + prompt
    chief-of-staff  coordinator (your main session)
    researcher      sonnet, read-only, web
    builder         sonnet, edits code, worktree isolation
    reviewer        opus, independent read-only review
  coordinator/commands/   slash commands installed into the project
  bay/              resolver, adapters, protocol, ledger, hook, CLI
  tests/            contract tests (python3 tests/test_contracts.py)
```

Generated in the target project (all tracked in `.agentbay/manifest.json`,
removable with `./bay.sh --project <repo> clean`):

| file | from |
|---|---|
| `.claude/agents/<worker>.md` | each worker spec |
| `.claude/skills/<skill>/` | layer skills |
| `.claude/commands/bay-*.md` | coordinator commands |
| `.claude/settings.json` | merged: CLI permissions + ledger hooks |
| `.mcp.json` | merged: layer MCP servers |
| `CLAUDE.md` | one marked import line → `.agentbay/COORDINATOR.md` |
| `.agentbay/catalog.json` | worker catalog for the coordinator |
| `.agentbay/bay` | project-local control plane shim |
| `.agentbay/ledger/events.jsonl` | runtime events (gitignored) |

Your existing `CLAUDE.md`, settings, and MCP servers are preserved.

## How it maps to the "container" idea

| container world | agentbay |
|---|---|
| image / Dockerfile | AgentSpec |
| image layers | Layers (infrastructure → domain → product) |
| runtime (docker, containerd) | Adapter (claude-code now) |
| `docker ps` / events | `bay status` / ledger |
| `docker stop` | `bay reclaim` (workers also free their context when they return) |
| orchestrator | chief-of-staff coordinator |

## Honest limits of the Claude Code runtime

- Skills, MCP servers and CLI permissions are project-wide in Claude Code.
  Per-agent scope is enforced by each subagent's `tools` allowlist (MCP tools are
  granted by name, e.g. `mcp__github__get_issue`).
- Subagents cannot spawn subagents, so there is one coordinator: the main session.
- New or changed agents load when Claude Code starts; restart after `build`.
- Spawns and completions are captured by hooks on the `Task|Agent` tool. If your
  Claude Code version's hook payload differs, the hook logs to
  `.agentbay/ledger/hook-errors.log` and never blocks the session.
- The kit path is baked into hooks; rebuild if you move the kit folder.

## Roadmap to the strategic version

1. `managed-agents` adapter: same specs → cloud sessions (and self-hosted sandboxes).
2. Ledger → SQLite/Postgres behind the same `ledger` API; add cost per run.
3. Spec versioning + a registry of published layers.
4. MCP gateway layer for per-agent credentials, egress policy and audit.
