# factory.plan

## Purpose
Turn the spec into a technical plan the owner can approve and a slicing can be cut from: the components, the
interface between them, the decisions taken, the risks and the order of work.

## Inputs
- `runId` (required). The spec, the goal and the language profile come from the `run` step.

## Steps
1. `run`: a code step; it returns the run, the spec's artifact and the language profile with its practices.
2. `draft`: the analyst reads the spec and the parts of the codebase the change touches, writes
   `docs/factory/<runId>/plan.md`, and returns the components with the contracts between them.
3. `record`: a code step; it records the stage and its artifact.

## Definition of Done
- [DOD-1] (must) Every acceptance criterion of the spec is served by at least one component of the plan.
- [DOD-2] (must) Every component states its responsibility and, where another component depends on it, the exact
  contract it publishes: the signature, the schema or the payload, enough to build against without reading its code.
- [DOD-3] (must) The plan says what it fits into: the existing modules, files and conventions it extends, read from
  the codebase, not assumed.
- [DOD-4] (must) Each decision names the alternative it rejects and why, in one sentence.
- [DOD-5] (must) The plan file exists at `docs/factory/<runId>/plan.md` and is listed in `artifacts`.
- [DOD-6] (must) `order` says what can be built at the same time and what has to wait, consistent with the
  dependencies between the components.
- [DOD-7] (should) Every risk has either a mitigation or an explicit decision to accept it.
- [DOD-8] (must_not) No component is bigger than the run's `maxAcceptance` constraint can describe; split it instead.

## Outputs
A `Plan`: `status`, `summary`, `artifacts` (the plan file), `components`, `decisions`, `risks`, `order`.

## Failure handling
- The spec has open questions that change the design: plan for the stated assumption, name the question in the
  plan and return `partial`.
- The codebase cannot be read where the plan needs it: return `blocked` with the paths.
