# 0004 - Chief of Staff as a mode, a registry contract, and project workflows

- Status: approved 2026-10-28, implemented on branch feat/cos-workflows (all three phases). Decisions
  below taken with the user on 2026-10-28; deviations found during implementation are recorded under
  *Deviations found during implementation*.
- Design: docs/DESIGN.md, proposal 0001 (modes, roles, envs, connectors)
- Feature: forge.extend (framework change)

## Problem

Three things the current system implies but does not have.

1. **The Chief of Staff is not a mode.** It is `coordinator/chief-of-staff.md`, compiled into
   `.agentbay/COORDINATOR.md` by the claude-code adapter. It has no `mode.yaml`, no endpoints, no
   declared capabilities, and no entry in the registry. Every other job in the system is a Mode; the
   job of routing and composing is the exception.
2. **Nothing composes modes.** `mode.yaml spec.workflows` steps are `run:` (connector capability),
   `role:` (agentic), `gate:` and `review:` - all inside one mode. A sequence that syncs a feed, then
   digests it, then asks a question is today the coordinator improvising one `bay call` after another,
   with nothing in the ledger linking the calls into one unit of work and nothing to resume.
3. **Users cannot configure a workflow.** Workflows live in `mode.yaml`, which is author/kit-owned and
   read-only to users under `framework/`. `agentbay.config.yaml` is the user's file and its schema is
   `additionalProperties: false`, so there is no place to put one.

## Decisions (user, 2026-10-28)

- Composition is **cos-level only**. No cross-mode `call:` step inside `mode.yaml` workflows: that makes
  the dispatcher recursive, needs cycle detection, and forces a parent endpoint to declare the union of
  every descendant's effects, which defeats the per-endpoint effect and grant model.
- Project workflows are configured in **`agentbay.config.yaml`** under a new top-level `workflows:` key,
  next to `modes:` and `connectors:`.
- Spelling stays **`mode.endpoint`** (as in `bay call`, the catalog and lint), not `mode:endpoint`.
- **No off-the-shelf workflow engine** (see the section below).
- Phased: the registry contract and the cos mode land independently of workflows.

## Change

| concept | now | proposed |
|---|---|---|
| registry | `.agentbay/catalog.json`, written by the claude-code adapter, type *names* only | `bay/registry.py` (runtime-neutral), plus resolved in/out schemas, `needs` and constraints; read via `bay catalog` |
| Chief of Staff | prompt file + generated `COORDINATOR.md` | framework mode `cos` with a coordinator role; `COORDINATOR.md` generated from it |
| composing modes | coordinator improvises `bay call`s | `workflows:` in `agentbay.config.yaml`, stages are `call: <mode>.<endpoint>` |
| running a composition | - | `cos.run` / `cos.next` / `cos.status` over a `workflow.run/v1` capability, one `wfRunId` in the ledger |

## 1. Registry contract

Catalog writing moves from `bay/adapters/claude_code.py` to `bay/registry.py`. `adapters/base.py`
already declares writing the catalog an adapter duty; that is the wrong layer. The catalog is resolved
system truth, identical for every runtime, and a second runtime would otherwise reimplement it.

Added per endpoint, all additive:

- `inSchema` / `outSchema`: the **resolved** JSON Schema, not just the type name. Without this nothing
  downstream can build or validate an endpoint input without reading mode folders - which the
  coordinator is forbidden to do ("never read `.agentbay/data/`; go through `bay call`"), and which a
  workflow linter would otherwise have to duplicate.
- `needs`: the mode's capability interfaces, so a reader can see what an endpoint depends on.
- `constraints`: the mode's caps, already in the catalog per mode, surfaced per endpoint for routing.

New read-only command `bay catalog [<mode>[.<endpoint>]] [--json]`, added to `COORDINATOR_CMDS` in the
claude-code adapter so it is pre-approved alongside `show|status|log|note|task`. The coordinator then
queries the registry instead of `cat`-ing `.agentbay/catalog.json` (what `coordinator/commands/bay-team.md`
tells it to do today).

Path and existing keys are unchanged; `tests/test_adapter.py` and `tests/test_boundaries.py` keep reading
the same file.

## 2. `cos` as a framework mode

New `framework/modes/cos/`, next to `forge` and `improve`:

- `playbook.md` - today's `coordinator/chief-of-staff.md`, moved. The "Mode endpoints (generated)" and
  "Worker subagents (generated)" tables the adapter appends stay generated; only the hand-written prose
  moves.
- `mode.yaml` with `coordinator: chief-of-staff`, `needs: [workflow.run/v1, session.events/v1]`.
- New Role `framework/roles/chief-of-staff.yaml` on a new main-thread Agent `cos-main`
  (`runtime: claude-code-main`), env `framework/envs/cos-local.yaml`. Same shape as `improve-lead` on
  `improve-main` and `forge-lead` on `forge-main`. The role keeps the name `chief-of-staff` rather than
  the `<mode>-lead` convention, because that name is already user-facing in the prose and the slash
  commands; `cos-lead` is the alternative if consistency wins.

Modes already support a coordinator role whose playbook runs in the main thread, so this needs no new
runtime concept - it makes an existing exception conform.

One wrinkle to keep explicit: there is one main thread, and `cos` is its **root** coordinator while
`improve-lead`, `forge-lead` and `briefing-lead` are nested under it ("from the Chief of Staff's main
thread", as their prompts say). The adapter already composes this by concatenation - CoS prose first, then
each mode's coordinator playbook as a section - so cos becoming a mode does not change the layout. What it
does change is that cos's own prose now arrives through the same path as every other mode's, and
`system.modes` includes a mode whose coordinator is the root. `_coordinator()` must therefore render cos's
playbook as the preamble and exclude it from the per-mode playbook sections, or the prose is emitted
twice.

The adapter keeps emitting `.agentbay/COORDINATOR.md` (CLAUDE.md includes it) but sources the prose from
the cos mode's playbook instead of `coordinator/chief-of-staff.md`. `coordinator/commands/*.md` stay as
slash commands.

Endpoints (phase 3):

| endpoint | in -> out | effects | does |
|---|---|---|---|
| `cos.run` | `RunReq` -> `StageOut` | read, write | start a project workflow; returns `wfRunId` and the first stage's call |
| `cos.next` | `NextReq` -> `StageOut` | read, write | record the finished stage, return the next one |
| `cos.status` | `StatusReq` -> `WfStatus` | read | state of a workflow run, or the open ones |

## 3. Project workflows

```yaml
workflows:
  morning:
    description: refresh feeds, then digest, then answer open questions
    steps:
      - id: sync
        call: feed-briefing.sync
        with: { lookback: 1d }
      - id: digest
        call: briefing.digest
        with: { since: "$steps.sync.until" }
        when: $steps.sync.added
      - id: ship
        gate: "send the digest?"
```

`call:` is the only new stage kind. `with:`, `when:`, `$in.<field>` and `$steps.<id>.<field>` reuse the
grammar and the substitution rules already defined for `mode.yaml` workflows (`schemas/mode.schema.json`
`spec.workflows`), so there is one language, not two. `gate:` keeps its existing meaning: the run stops
and only `bay approve` passes it.

Two different things are now called a workflow: `mode.yaml spec.workflows` (steps inside one mode, author-
owned) and `agentbay.config.yaml workflows` (stages across modes, user-owned). Lint messages and docs say
**mode workflow** and **project workflow** explicitly; the stage kind (`run:`/`role:` vs `call:`) is the
discriminator in the files themselves.

### Validation (`bay lint`)

- every `call:` target resolves to an installed endpoint (registry), and is not abstract
- `with:`, after substitution of literals, validates against the target's `inSchema` where statically
  checkable; `$steps`/`$in` references are checked for existence, not type
- `$steps.<id>` refers to an earlier stage; no duplicate stage ids; `when:` matches the existing grammar
- the **union of effects** across stages is reported, so a user sees what a workflow may do before
  running it
- a `call:` whose endpoint carries `review: always` or whose effects include `delete` is noted in that
  report rather than rewritten - the endpoint's own review and gates still apply

### Execution

`workflow.run/v1` capability (`start`, `next`, `show`) with a built-in connector, so cos's endpoints are
ordinary code steps against a capability and modes keep naming capabilities rather than tools.

**The dispatcher does not recurse.** A stage does not run inside `bay call`; it is returned as work:

1. `bay call cos.run '{"workflow": "morning"}'` -> `{wfRunId, stage: "sync", nextCall: {target, input}}`
2. the coordinator runs `bay call feed-briefing.sync '<input>'` and drives it to a terminal status exactly
   as it does today, including role steps as subagents and `bay submit`
3. `bay call cos.next '{"wfRunId": ..., "callId": ...}'` -> the next stage, or the run's result

So agents stay in the coordinator, connectors stay out of agent reach, each stage keeps its own grants,
effects, budget, review and approval gates, and the existing call loop is unchanged. The only new state is
the stage cursor.

Durability reuses what exists: `.agentbay/calls/<id>.json` for stage calls, and the append-only ledger
(`bay/ledger.py`, "system state = fold(events)") for the run. New event types `wf.started`,
`wf.stage.completed`, `wf.completed` are added to `ledger.TYPES`, each carrying `wfRunId`, so `bay status`
can show a workflow instead of orphan calls, and `improve` can read stage cost and duration the way it
reads step cost today.

## Why not an off-the-shelf workflow engine

Considered and rejected for the core: Temporal, Airflow, Prefect, Dagster, Argo, n8n.

- **The engine's main job is already built.** `.agentbay/calls/<id>.json` plus the fold-the-ledger event
  log is durable resumable execution. `dispatch.py` has the cursor, step statuses, output validation,
  effect checks and secret redaction. Project workflows are a stage cursor over that - a few hundred
  lines. Adopting an engine rewrites the part that works.
- **The dominant step kind does not fit.** Most steps stop and hand a prompt plan to an LLM in a terminal,
  resumed by `bay submit`: unbounded latency, human in the loop, work performed outside the engine.
  Airflow and Dagster are batch/data-pipeline schedulers. Temporal can express it with signals, but then
  the engine is a durable queue coordinating handoffs the coordinator already coordinates, and it needs a
  server plus a long-lived worker.
- **The invariants stay ours either way.** Effects, grants, per-mode budgets, read-only `use` shims, and
  approval gates that must be interactive-terminal-only and never pre-approved are enforced in `guard.py`
  and `dispatch.py`. No external engine knows about them, so adopting one means running both systems.
- **Cost.** The project is `pyyaml` + `jsonschema`, clone-and-run. An engine makes "run a server" a
  prerequisite for `bay call`.

Where open source stays the answer: **scheduling** is cron/systemd/launchd, already the stance
(`lint.py` warns that `schedule:` has no runtime and says to run it from cron); **state storage** moves
to SQLite behind `ledger.py` if `bay status` and `improve` queries get slow (`sqlsandbox.py` means SQLite
is already in-tree); **validation** is `jsonschema`, already used.

This flips if agentbay stops being a single-user local tool - hosted, multi-user, parallel fan-out, runs
that must survive a machine going away. Temporal is the candidate then, not Airflow. Keeping project
workflows **declarative YAML validated by lint**, with a thin interpreter, is what keeps that migration a
compile step rather than a rewrite: execution semantics must not live only in imperative Python.

## Deviations found during implementation

- **Phases 2 and 3 could not be separated.** `schemas/mode.schema.json` requires `endpoints` (minProperties 1)
  and `workflows` for any non-abstract mode, so `cos` cannot exist as a mode without its endpoints, and its
  endpoints need `workflow.run/v1`. Phase 2 shipped with phase 3 rather than before it.
- **No new ledger event types.** The proposal added `wf.started`, `wf.stage.completed` and `wf.completed` to
  `ledger.TYPES`. Implementing that honestly turned out to need one of two bad things: the `workflow-runner`
  connector writing to `.agentbay/ledger/` although its env grants it only `.agentbay/data/workflows`, or the
  dispatcher special-casing cos targets although it is mode-agnostic. Neither is worth it, because the linkage
  already exists: every stage is an ordinary call with its own `step.*` and `call.completed` events, and
  `cos.run`/`cos.next` are themselves calls carrying the `runId`. Stage-by-stage state is the runner's own
  record, read through `cos.status`. `improve` therefore reads stage cost and duration unchanged.
- **`bay status` was left alone** for the same reason it is pre-approved: it must stay a pure ledger read. Making
  it show workflow runs would have meant running connector code inside a command that never asks the user.
  Workflow state is reached with `bay call cos.status`, which asks like any other call.
- **`bay approve` also takes a `W-...` run id**, routed to `workflow.run/v1.approve`. The proposal implied gates
  would work but did not say how a workflow-run gate is passed; a call id was not enough.

## Compatibility impact

Breaking: none. `agentbay.config.yaml` without `workflows:` is unchanged; `.agentbay/catalog.json` gains
keys and loses none; `.agentbay/COORDINATOR.md` keeps its path and structure.

Moved: `coordinator/chief-of-staff.md` -> `framework/modes/cos/playbook.md`. A project that edited the
Chief of Staff prose in place will see it ignored; `bay lint` reports the stale file with the new path.

Unchanged: TaskEnvelope/Result protocol, `bay call`/`submit`/`show`/`approve` semantics, guard hook
behaviour, adapter guarantees (merge, manifest, idempotent, clean restores originals).

## Phases

1. **Registry contract** (shipped) - `bay/registry.py`, resolved `inSchema`/`outSchema`, `needs` and
   `constraints` in the catalog, `bay catalog [<name>] [--json]`, added to the pre-approved coordinator
   commands; the adapter delegates and supplies only its `runtime` name.
2. **cos as a mode** (shipped) - `framework/modes/cos/` (playbook moved from `coordinator/`, three endpoints,
   feature playbooks and rules), role `chief-of-staff` on agent `cos-main` in env `cos-local`; the adapter
   renders the cos playbook as the preamble of `COORDINATOR.md` and excludes it from the per-mode sections.
3. **Project workflows** (shipped) - `workflows:` in `schemas/config.schema.json`, `bay/workflows.py`,
   `framework/interfaces/workflow.run.v1.yaml`, the `workflow-runner` connector, structural checks in
   `bay lint` and target/`with` checks in `bay validate`, `bay approve <runId>`, `tests/test_workflows.py`,
   README, `docs/INTERFACES.md` and `agentbay.config.example.yaml`.

## Deferred

- Parallel stages (`needs:` between stages, fan-out). Sequential only for now; the grammar leaves room.
- Retry and backoff policy per stage. A failed stage stops the run; the user reruns it.
- Cross-mode `call:` inside mode workflows (decided against above, not merely postponed).
- A `schedule:` on a project workflow. Endpoints already have one and nothing acts on it; cron runs
  `bay call cos.run` the same way.
- Passing data between stages by anything richer than `$steps.<id>.<field>` (no expressions, no mapping
  functions).
