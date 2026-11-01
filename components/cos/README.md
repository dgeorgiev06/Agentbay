# cos (framework mode)

The root mode. Its playbook is the Chief of Staff's preamble of the generated `.agentbay/COORDINATOR.md`, and
its coordinator is the `lead` role in env `cos-local`. It routes a request to the right mode endpoint and runs
the project workflows that compose several.

Its endpoints run over `workflow.run/v1` (bound to `workflow-runner`):
- `cos.run {workflow, input}` starts a project workflow and returns its first stage as `nextCall`;
- `cos.next {runId, callId, status, output}` records the stage call that just finished and returns the next
  stage, a gate, or the run's result;
- `cos.status {open?}` says where workflow runs stand, stage by stage (read-only).

The coordinator makes each `nextCall` the ordinary way, so every stage keeps its own grants, effects, budget,
review and gates, and nothing recurses. A workflow gate passes only with `bay approve <W-runId>`.
