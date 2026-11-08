# factory.slice

## Purpose
Cut the approved plan into vertical slices: each one delivers a user-visible outcome on its own, states what has to
be true for it to be done, names the contract at every edge it shares with another slice, and declares the only
paths it may touch. The slicing is what makes parallel work safe, so the boundaries matter more than the sizes.

## Inputs
- `runId` (required). The plan, the constraints and the language profile come from the `run` step.

## Steps
1. `run`: a code step; it returns the run, the approved plan's artifact, the constraints and the language profile.
2. `propose`: the analyst reads the plan and the code it lands in, and returns the slices.
3. `validate`: a code step, `factory.slices/v1.propose`. It refuses a slicing that breaks a constraint, names the
   slice and the rule, and stores nothing; the stage then has to be called again with the slicing fixed.
4. `record`: a code step; it records the stage.

## Definition of Done
- [DOD-1] (must) Every slice is vertical: its outcome is something a user or a caller can observe once that slice
  alone is integrated, not "the data layer" or "the tests".
- [DOD-2] (must) Every slice has acceptance criteria, each observable, with at least one `must`.
- [DOD-3] (must) Every slice declares the paths it may touch, and no two slices that can run at the same time
  declare the same path.
- [DOD-4] (must) Every edge between two slices is a named contract: the dependent declares it as `consumes` and the
  other declares the same name as `publishes`, with the shape and, where it helps, the stub to build against.
- [DOD-5] (must) Dependencies form no cycle, and a slice depends on no more than the run's `maxDeps` constraint.
- [DOD-6] (must) Together the slices cover every acceptance criterion of the spec; the summary says which slice
  covers which.
- [DOD-7] (must_not) No slice declares a path the constraints forbid.
- [DOD-8] (should) A slice is small enough that one builder finishes it in one session; prefer more slices with
  clear edges over fewer with shared files.

## Outputs
A `Slices`: `status`, `summary`, `slices` (id, title, outcome, acceptance, paths, interfaces, deps, notes).

## Failure handling
- The plan cannot be cut without two slices sharing a file: say so in the notes of both, put them in the same slice
  instead, and return `done` with the merged slice.
- `validate` rejects the slicing: the call ends blocked with the reasons. Do not store a workaround; fix the cut.
