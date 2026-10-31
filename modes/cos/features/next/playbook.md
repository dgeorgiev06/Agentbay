# cos.next

## Purpose
Record the stage call that just finished and return the next stage, the next gate, or the run's result.

## Inputs
- `runId` (required).
- `callId`, `status`, `output` (optional, but pass all three): the call the coordinator drove for the
  current stage, how it ended, and what it returned. Later stages read that output as `$steps.<id>.<field>`.

## Steps
1. `advance`: the dispatcher runs `workflow.run/v1.next` (code step, no agent). The runner records the
   finished stage, stores its output for later `$steps` references, moves the cursor past stages whose
   `when` is falsy, and returns the next stage that needs someone.

## Definition of Done
- [DOD-1] (must) The finished stage is recorded with its `callId` and `status` before the cursor moves.
- [DOD-2] (must) A stage call that ended `blocked` or `failed` ends the run with that state and a `reason` naming the stage.
- [DOD-3] (must) A later stage's `$steps.<id>.<field>` resolves to the output submitted for stage `<id>`.
- [DOD-4] (must) A gate is never passed here; the run stops with `awaiting-approval`.

## Outputs
`StageOut`, as for `cos.run`.

## Failure handling
- The run already ended, or waits at a gate: the step fails and says which, and what passes it.
- The workflow changed under a live run so a recorded stage no longer exists: the run fails with a reason
  telling the user to start a new one. Nothing already recorded is rewritten.
