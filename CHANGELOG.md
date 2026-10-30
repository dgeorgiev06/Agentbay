# Changelog

Earlier versions: see docs/proposals/

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
