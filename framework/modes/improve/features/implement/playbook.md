# improve.implement

## Purpose
On demand, turn one user-approved finding into a reviewed fix request for forge: a forge.extend proposal draft (framework) or a mode-fix task envelope (user mode). improve never edits code.

## Inputs
- `id` (required): the finding id. Its status must be `approved` by the user (`bay improve decide <id> approve` in a terminal).

## Steps
1. `claim`: the dispatcher runs `improve.findings/v1.claim` (code). An item that is not approved by the user stops the call as `blocked`.
2. `draft`: the analyst (pattern-analysis skill) writes the `Draft`: route, title, problem, evidence, change, compatibility and tests (forge.extend), or a task envelope goal, deliverable and constraints (mode-fix). No code.
3. `review`: the reviewer (opus, high effort) checks the draft against the finding's evidence and the DoD and rules below.
4. `approve`: approval gate. The call stops with `awaiting-approval`; only the user passes it, with `bay approve <callId>` in an interactive terminal.
5. `handoff`: the dispatcher runs `improve.findings/v1.handoff` (code): it writes the draft under `.agentbay/data/improve/handoffs/`, marks the finding `in-progress`, and returns `next`: the `forge.extend` call (its propose step writes docs/proposals/<id>.md behind its own approval gate) or the task envelope.

## Definition of Done
- [DOD-1] (must) The finding was approved by the user before the call (history shows `approved` by user@tty).
- [DOD-2] (must) The draft's problem and evidence match the finding's evidence; nothing is claimed without a ref.
- [DOD-3] (must) The change is the smallest that removes the pattern and says how verify will show it is gone.
- [DOD-4] (must_not) No code, mode, role, env or doc is edited by this call; only the handoff file under .agentbay/data/improve/ is written.
- [DOD-5] (should) A framework fix names the tests that would have caught the problem.

## Outputs
`ImplementOut`: `{id, route, draft, next}`; `next` is `{call: forge.extend, input}` or `{envelope, how}`.

## Failure handling
- Not approved: status `blocked` with the reason; nothing is written.
- Review fails a must item or finds a blocker: the call ends `partial` before the gate; fix the draft by re-running implement.
- The user rejects the gate: status `blocked`; the finding stays `approved`.
