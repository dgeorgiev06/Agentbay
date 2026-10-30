# Changelog

Earlier versions: see docs/proposals/

## 0.6.0 - 2026-10-30

Contracts changed only additively (a new `improve.detect/v1` endpoint, a new `forge.extend` step); no schema changed, so the schema apiVersion stays `agentbay/v2`.

### Added

- A dead-code check for framework changes. `improve.detect/v1` has a new endpoint, `change {base}`: it audits the working tree and the tree at the merge-base of `base` and HEAD (exported as plain files, never run) and returns `{new, existing, warnings}` for unused code, unused constants, compatibility layers and complexity. `forge.extend` runs it as a `deadcode` step between implement and review, and any new finding blocks the call. The extend playbook gains DOD-14 (no new unused code or compatibility layers).
- A base that does not resolve is refused with `fetch origin (git fetch origin)`. The resolved merge-base is named in `warnings`.
- improve-detect connector 0.2.0.

### Changed

- The coordinator's dispatch decides which call a taskId belongs to; a later `spawned` record cannot stand in for it.
- A role step's submit closes every run dispatched to that call and step.
- `CHANGELOG.md` is owned by the kernel.
- B-7 scans connector code only (imports and the kernel's connector and adapter keys); prose, comments and playbooks are not scanned.
- Three over-complex functions are refactored with the same behaviour: `Guard._bash`, `ClaudeCodeAdapter._settings` and `ledger_verdicts`.

### Fixed

- `bay boundary` no longer fails a repo-root file that no component owns. Owned root files still need `touches:`.

### Known issues

- If the local `origin/main` is stale, the merge-base is the stale ref and the check can block on findings that are not new. The extend playbook says to run `git fetch origin` first; the forge coordinator playbook does not yet say so.

## 0.5.0 - 2026-10-30

Contracts changed only additively (optional fields, new event types); the schema apiVersion stays `agentbay/v2`.

### Added

- Approvals from chat, behind `approvals.chat` in `agentbay.config.yaml`. They are recorded as `user@chat-via-cos` with the user's quote, and are bound to the content shown with `bay approve --sha`.
- `bay plan`: a role records its outcome and to-do list, and ticks items with `--done <n>`.
- `bay dispatched`: the coordinator logs each agent dispatch (agent, call, step, model, tier, role, mode, inputs).
- `bay review-record`: records a review run outside a framework review step, as `review.verdict/v1`. It changes no call or gate.
- `bay show` lists the agents of a call.
- `bay status --agents` groups runs by role, mode, model and tier, with usage split among agents.
- `step.started` events carry the step's inputs.
- Review verdicts carry `cites` and `recordedPlans`.
- `improve.backlog` reports cost and duration figures.
- Git episodes include commit subjects.
- Lint flags `when: stale` on role steps.
- `permissions.ask` includes `bay approve`.

### Changed

- A gate passes only by a recorded approval of the proposal's exact content.
- `forge.extend` skips propose when the proposal already exists.
- A role-step submit is refused when no plan is recorded for it.
- The kit ignores its own build output.

### Fixed

- Guard de-quoting.
- A gate skip needs the state of the prior call.
- Ledger read fixes.
- The `claude-transcripts` root.

### Known issues

- A hook `spawned` record without a callId can stand in for a plan's dispatch (to be fixed in 0008 stage 2).
- The `./bay.sh` and `python3 -m bay.cli` spellings of `dispatched` and `review-record` prompt instead of deny for non-role subagents.
