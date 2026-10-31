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
4. `deadcode`: a code step, `improve.detect/v1.change` against `origin/main`. The coordinator runs `git fetch origin` before extend (an unresolved or stale base is the usual cause of a false block). It audits the working tree and the tree at the merge-base of the base and HEAD and ends the call `blocked` when the change adds any unused code, unused constant, compatibility layer or complexity finding. Findings that already existed at the base do not count. Remove or wire up what it names, then re-run extend with `proposal` set.
5. `limits`: a code step, `improve.detect/v1.limits` against `origin/main` and the call's `proposal`. It ends the call `blocked` when a count is over its ceiling in `framework/limits.yaml` or a ceiling was raised without an `exceptions:` entry in the proposal. It writes nothing; the builder's `./bay.sh check --limits` writes the lowered ceilings.
6. `review`: one independent review by the reviewer (opus, high effort) of every DoD item and rule below. The reviewer gets the generated role file verbatim and the step plan; the coordinator adds scope, not opinions. Nits and should-fix items go to a list in the Result and are not a fix round. A second round runs only for a blocker or a security finding, and its fix result is the implement result: no confirmation pass. A review that runs out of budget is resumed, never re-run from the start; the coordinator logs the overrun with `.agentbay/bay note <callId> "review.overrun: items left <n>; budget used <turns, minutes>; time sinks <a few words>"` (the reviewer's Result lists its time sinks for this).
7. `release`: changelog entry, version bump in bay/__init__.py, schema apiVersion bump when contracts changed; all checks green.

## Definition of Done
- [DOD-1] (must) Design conformance: the change uses the fixed vocabulary (Chief of Staff, Mode, Role, Agent, Environment, Connector, capability interface) and keeps the layering mode -> role -> agent -> env -> connector.
- [DOD-2] (must) Boundaries: secrets never appear in prompts, logs, the ledger or output; agents cannot reach connectors or store files directly; effects are enforced at runtime; each mode owns its data.
- [DOD-3] (must) Deliverables: every item of the proposal's deliverable list is marked pass/fail with file references.
- [DOD-4] (must) Extensibility: adding a source is still one new connector plus one env binding line, with no mode, role or playbook edits.
- [DOD-5] (must) Evidence: the tests, `bay check` (with `--base` for the boundary), a scratch-repo `build` + `clean` round trip and the fake-source demo were actually re-run, with output quoted.
- [DOD-6] (must) External API compliance: official endpoints only, network allowlist enforced before requests, budget caps enforced, deletions honored.
- [DOD-7] (must) Scope: nothing beyond the approved proposal changed.
- [DOD-8] (should) Code quality: small single-purpose modules, clear names, type hints, no duplication, explicit actionable errors, no silent failures or bare excepts (except the never-block hook), deterministic offline tests, safe subprocess and file handling, minimal dependencies.
- [DOD-9] (should) Framework clarity: one job per concept; a newcomer can explain mode -> role -> agent -> env -> connector from the README; vocabulary is consistent across files, schemas and CLI; errors name the concept and the fix.
- [DOD-10] (should) Simplicity for users: few commands from clone to first result; few files and steps to add a feature, mode, role or connector; scaffolds generate the boilerplate; sensible defaults and minimal config; status and ledger make activity obvious; overengineering is flagged.
- [DOD-11] (must) Contracts: no breaking contract change without an apiVersion bump.
- [DOD-12] (must) Framework modes still pass `bay check` and their tests after the change.
- [DOD-13] (must) README, docs/INTERFACES.md and docs/DESIGN.md are updated in the same change.
- [DOD-14] (must) No new unused code or compatibility layers: the `deadcode` step reports no new finding.
- [DOD-15] (must) Limits: `./bay.sh check --limits --base origin/main --proposal <proposal>` passes, quoted in the evidence. No measure in `framework/limits.yaml` is over its ceiling and none is raised without an `exceptions:` entry in the proposal's front matter; a count under a ceiling is written back as the new ceiling in the same change. The test count does not grow: a change that adds a test removes or merges at least one the change made obsolete.

## Proposals and handoff
- `touches:` may name a folder (`path/`); a rename inside it needs no amendment.
- Amend a proposal only for a change of scope or design, never for a file a rename reached.
- `HANDOFF.md` keeps only the current work; history is in git.

## Outputs
A `Result`: proposal path, branch, changed files in `artifacts`, release notes in `summary`.

## Failure handling
- Proposal rejected at the gate: the call ends `blocked` with the user's reason; nothing is implemented.
- Review finds a failed must or a blocker: the call ends `partial` before release; fix and re-run extend with `proposal` set. If the proposal is unchanged since the owner approved it, the re-run's review is a scoped re-check (once): the brief's `recheck` names the failed ids, the fix commits and the items that passed; judge the failed ids again. A changed proposal, or a re-run after a re-check, gets a full review.
