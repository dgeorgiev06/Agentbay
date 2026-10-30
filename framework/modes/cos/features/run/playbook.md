# cos.run

## Purpose
Start a run of a project workflow and return its first stage. The stage is returned as work for the
coordinator, never executed here.

## Inputs
- `workflow` (required): a name under `workflows:` in `agentbay.config.yaml`.
- `input` (optional): the run's own input. Stages read it as `$in.<field>`.

## Steps
1. `start`: the dispatcher runs `workflow.run/v1.start` (code step, no agent). The runner reads the
   workflow, writes the run's state under `.agentbay/data/workflows/`, skips leading stages whose
   `when` is falsy, and returns the first stage that needs someone.

## Definition of Done
- [DOD-1] (must) The run has an id, and its state on disk names every stage with `state: pending` except those already skipped or running.
- [DOD-2] (must) `status` is `stage-ready` with a `nextCall` the coordinator can run verbatim, `awaiting-approval` with the gate text, or `done` when every stage was skipped.
- [DOD-3] (must) `nextCall.input` contains only values substituted from `$in` and the stage's literals; a missing reference drops its key rather than passing null.
- [DOD-4] (must) No endpoint is called and no agent is spawned by this endpoint.

## Outputs
`StageOut`: `{runId, workflow, status, stage?, nextCall?, gate?, skipped?, reason?, results?}`.

## Failure handling
- Unknown workflow: the step fails and names the workflows the config defines.
- A `call` target that no longer resolves is caught by `bay check`, not here; the stage's own `bay call` reports it.
