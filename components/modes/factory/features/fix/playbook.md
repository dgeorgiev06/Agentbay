# factory.fix

## Purpose
Clear the findings open against one slice, in that slice's own worktree, and nothing else. A fix round is narrow on
purpose: the lenses judge the slice again afterwards, and a round that widens the change makes that judgement
worthless.

## Inputs
- `runId`, `sliceId` (required). The open findings, with the suggestion each reviewer gave, come from the `brief`
  step.

## Steps
1. `tree`: a code step; it returns the slice's worktree and branch.
2. `brief`: a code step; it returns the slice, its criteria, the open findings and the round this is.
3. `fix`: the builder clears each finding in the worktree, runs the brief's commands and commits.
4. `standards`: a code step; it blocks the call on a new standards finding in the project tree.
5. `checks`: a code step; it runs the language profile's commands inside the worktree.
6. `record`: a code step; it records the round for the slice.

## Definition of Done
- [DOD-1] (must) Every finding in the brief is either fixed, or answered in `followups` with the reason it is not a
  defect, in enough detail for the reviewer to judge that claim.
- [DOD-2] (must) The acceptance criteria that passed before still pass: the brief's commands were run and their
  outcome is in `checks`.
- [DOD-3] (must) Nothing was changed that no finding asked for; `summary` maps each change to the finding it serves.
- [DOD-4] (must) The work is committed on the slice's branch and `artifacts` lists every file written.
- [DOD-5] (must_not) No test was disabled, skipped or weakened, and no check lowered, to clear a finding.
- [DOD-6] (must_not) Nothing outside the slice's declared paths was written.

## Outputs
A `Result`: `status`, `summary`, `artifacts`, `met`, `unmet`, `checks`, `followups`, `blockers`.

## Failure handling
- A finding is wrong: do not change the code; answer it in `followups` with evidence and return `done`. The next
  review round decides.
- Two findings contradict each other: fix neither, name both in `blockers`, return `partial`.
- A finding needs a change outside the slice's paths: return `blocked`; that is a slicing or plan decision.
