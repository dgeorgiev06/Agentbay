# Proposal 0002: `improve` framework mode

Status: implemented on branch feat/improve (2026-10-27). Approved in principle by the user on 2026-10-27.
Open points decided at implementation: redaction keeps structure and metadata only (text only with
`keepText`, after a secret scan); retention default 90d for verified/wontfix findings (config `retention`).

## Problem
Failures and waste repeat across sessions: review churn, blockers found late, mid-run spec drift, unapproved scope, slow steps, permission friction. The code and modes also accumulate slop, unused implementation and inefficiency, and can drift from the framework's intent while still passing lint. Nothing collects these with evidence or routes them to a fix.

## Decisions (user, 2026-10-27)
- `scan` reads raw Claude Code session transcripts in addition to the agentbay ledger and git. Transcripts are redacted on read.
- Approved findings go to a **weekly backlog**. A human reviews it, and items are implemented **on demand**: nothing is dispatched automatically.

## Mode
Framework mode `improve`, shipped next to `forge`. It never edits artifacts. Fixes are made through `forge.extend` (framework) or `forge.create`/mode edits (user modes).

### Sources (capability interfaces, read-only connectors)
- `session.events/v1`: `ledger`, `claude-transcripts`, `git`
- `review.verdicts/v1`: `ledger`
- `artifacts.read/v1`: kit and project files (code, modes, roles, envs, connectors, prompts, docs)

### Features

| Feature | Lens | Does | Effects | Review |
|---|---|---|---|---|
| scan | sessions | turns sessions in a window into episodes; runs detectors, then analyst pattern finding | read, write (own store) | off |
| audit | artifacts | finds slop, unused implementation, inefficiency and conformance violations | read, write (own store) | off |
| triage | both | dedups, merges evidence across lenses, finds root causes, scores (impact × frequency ÷ effort), proposes a fix and a route | read, write | on (reviewer checks evidence and root cause) |
| backlog | both | produces the weekly backlog report; records human decisions: approve, defer, wontfix | read, write | off |
| implement | both | on demand, for one human-approved item: creates a forge.extend proposal or a mode-fix task | write, external-write | on, with an approval gate (`bay approve`) |
| verify | both | re-runs the detector after a fix ships; closes the item only if the pattern is gone | read, write | off |

### Detectors
- **Sessions:**
  - review rounds above 1, and the same rule failing repeatedly
  - blockers that a lint or test could have caught
  - mid-run requirement changes, and rework
  - out-of-scope additions
  - long or costly steps, retries, repeated identical tool calls
  - permission prompts, denials, interrupts, repeated "status?" questions
  - environment gaps
  - regressions and reverts
- **Slop:**
  - filler or generic text in playbooks, prompts, rules and docs
  - duplicate or restated rules
  - comments that restate the code
  - padded error messages
  - Evidence: the exact text plus a tightened rewrite.
- **Unused:**
  - dead functions and modules
  - schemas, interfaces, connectors, roles, skills and endpoints that are never referenced or called
  - config keys nothing reads
  - Evidence: zero references in the code graph AND zero ledger uses over the window.
- **Inefficient:**
  - re-reading the whole store per query, repeated subprocesses or API calls, quadratic work
  - oversized per-role prompt context
  - slow or costly steps (linked to ledger timings)
  - Evidence: a measurement plus the expected gain.
- **Conformance** (semantic, beyond lint):
  - playbook steps don't match the workflow
  - DoD items can't be checked, rules can't be tested
  - a mode names a concrete tool
  - declared effects don't match the code
  - a write/spend/delete feature has no reviewer
  - vocabulary drift
  - Evidence: the id of the framework rule broken.

### Single source of conformance
`framework/rules/conformance.yaml` is read by forge.create's reviewer, forge.extend's reviewer and improve.audit.

### Roles
improve-lead (coordinator), improve-analyst (sessions), auditor (artifacts), reviewer (framework role).

### Finding contract `improve.finding/v1`
id, lens, kind, title, pattern, evidence[] (episode ids, file:line, measurements), scope (mode, feature, role, env or framework file), cost estimate, root cause, proposed fix, route, priority, status (open | approved | deferred | wontfix | in-progress | fixed | verified), history.

### Rules (excerpt)
- (must) Every finding cites evidence that resolves.
- (must) A recurring pattern needs ≥2 episodes, unless it is marked severe.
- (must) Unused means both unreferenced and never called.
- (should) Prefer preventive fixes (a new lint or conformance rule, a test). A recurring category produces a rule proposal.
- (must_not) Modify artifacts. Implement an item without human approval. Store secrets or personal content from transcripts; excerpts are minimal and redacted.

### Environment `improve-local`
- **Reads:** project, kit, ledger, `~/.claude/projects` transcripts.
- **Writes:** only `.agentbay/data/improve/`.
- **Network:** none.

### Runtime
- Weekly scheduled run: scan + audit + triage, then the backlog report goes to the user.
- `bay call improve.audit` on demand, and optionally on each PR.

### Prerequisite
Richer ledger events: duration, tokens and cost per step; permission prompts and denials; instruction changes.

### Open (decide at implementation)
- Redaction rules for transcripts.
- The retention window for the improve store.
