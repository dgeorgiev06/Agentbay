# cos.status

## Purpose
Report where workflow runs stand, stage by stage, so "what is running?" is answered from state rather than
from the conversation.

## Inputs
- `runId` (optional): one run. Omit for every run, newest first.
- `open` (optional): only runs that have not ended.

## Steps
1. `show`: the dispatcher runs `workflow.run/v1.show` (code step, no agent, read-only).

## Definition of Done
- [DOD-1] (must) Each run reports its status and every stage's `state`, with the `callId` of each stage that ran.
- [DOD-2] (must) Per-stage endpoint output is not included; `bay show <callId>` is where that lives.
- [DOD-3] (must) Nothing is written.

## Outputs
`WfStatus`: `{runs: [{runId, workflow, status, startedAt, endedAt?, cursor, input, reason?, stages: [...]}]}`.

## Failure handling
- Unknown `runId`: the step fails and points at `cos.status` with no argument to list the runs there are.
