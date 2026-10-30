# forge.extend

## Purpose
Change the agentbay framework itself (concepts, schemas, CLI, runtime, framework modes) through a reviewed, approved proposal.

## Inputs
- `goal` (required): the change wanted.
- `proposal` (optional): an existing docs/proposals/<id>.md to implement; `context` (optional).

## Steps
Two rules skip work. When `proposal` names an existing file, `propose` is skipped (there is nothing to draft) and the call stops at `approve`. The gate is skipped only when the ledger holds the user's `bay approve` (terminal or chat) of that proposal path with the sha256 of its current content, recorded by the same gate step and still held in that call's state; a later decision on the path supersedes an earlier one, and any edit since the approval makes the gate run again. The front-matter `status:` grants nothing. A proposal the `propose` step writes is bound to its approval through that step's `artifacts` (list its docs/proposals/<id>.md path). A chat approval carries `--sha <prefix>` of the content shown. The step plan and `bay show <callId>` say why the gate ran or was skipped, and name the chat path when `approvals.chat` is on.
1. `propose`: the builder, in env framework-dev, writes docs/proposals/<id>.md: problem, change to concepts/schemas/CLI, compatibility impact.
2. `approve`: approval gate. The call stops with `awaiting-approval`; only the user passes it, with `bay approve <callId>` in an interactive terminal (or from chat, when they turned `approvals.chat` on). The approval covers the proposal's exact content (path and sha256, shown with the gate).
3. `implement`: the builder implements the approved proposal on a branch: code, schemas, framework modes, docs and tests.
4. `review`: the reviewer (opus, high effort) checks every DoD item and rule below.
5. `release`: changelog entry, version bump in bay/__init__.py, schema apiVersion bump when contracts changed; all checks green.

## Definition of Done
- [DOD-1] (must) Design conformance: the change uses the fixed vocabulary (Chief of Staff, Mode, Role, Agent, Environment, Connector, capability interface) and keeps the layering mode -> role -> agent -> env -> connector.
- [DOD-2] (must) Boundaries: secrets never appear in prompts, logs, the ledger or output; agents cannot reach connectors or store files directly; effects are enforced at runtime; each mode owns its data.
- [DOD-3] (must) Deliverables: every item of the proposal's deliverable list is marked pass/fail with file references.
- [DOD-4] (must) Extensibility: adding a source is still one new connector plus one env binding line, with no mode, role or playbook edits.
- [DOD-5] (must) Evidence: the tests, `bay lint`, `bay validate`, a scratch-repo `build` + `clean` round trip and the fake-source demo were actually re-run, with output quoted.
- [DOD-6] (must) External API compliance: official endpoints only, network allowlist enforced before requests, budget caps enforced, deletions honored.
- [DOD-7] (must) Scope: nothing beyond the approved proposal changed.
- [DOD-8] (should) Code quality: small single-purpose modules, clear names, type hints, no duplication, explicit actionable errors, no silent failures or bare excepts (except the never-block hook), deterministic offline tests, safe subprocess and file handling, minimal dependencies.
- [DOD-9] (should) Framework clarity: one job per concept; a newcomer can explain mode -> role -> agent -> env -> connector from the README; vocabulary is consistent across files, schemas and CLI; errors name the concept and the fix.
- [DOD-10] (should) Simplicity for users: few commands from clone to first result; few files and steps to add a feature, mode, role or connector; scaffolds generate the boilerplate; sensible defaults and minimal config; status and ledger make activity obvious; overengineering is flagged.
- [DOD-11] (must) Contracts: no breaking contract change without an apiVersion bump.
- [DOD-12] (must) Framework modes still pass `bay lint` and their tests after the change.
- [DOD-13] (must) README, docs/INTERFACES.md and docs/DESIGN.md are updated in the same change.

## Outputs
A `Result`: proposal path, branch, changed files in `artifacts`, release notes in `summary`.

## Failure handling
- Proposal rejected at the gate: the call ends `blocked` with the user's reason; nothing is implemented.
- Review finds a failed must or a blocker: the call ends `partial` before release; fix and re-run extend with `proposal` set.
