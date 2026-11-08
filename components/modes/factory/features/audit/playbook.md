# factory.audit

## Purpose
Review one slice through one lens and return a verdict, with evidence, for every acceptance criterion of the slice
and every check of the lens. One call is one lens, so the lenses run at the same time and none of them hides
another's findings. The reviewer judges; it never fixes.

## Inputs
- `runId`, `sliceId`, `lens` (required). The lens's focus, what it leaves to other lenses and its checks come from
  the `brief` step, with the slice, its criteria, its contracts and the worktree it was built in.

## Steps
1. `brief`: a code step; it returns the slice, its acceptance criteria, the contracts, the paths, the practices, the
   check commands and the lens.
2. `judge`: the reviewer reads the slice's diff and code in its worktree, runs read-only checks where they are
   evidence, and returns one verdict per id.
3. `findings`: a code step; it refuses a verdict set that misses an id, and otherwise records every fail as a
   finding against the slice. A fail on a `must` or `must_not`, or anything rated `blocker`, keeps the slice out of
   integration until a fix round clears it.
4. `record`: a code step; it records the stage for this slice and lens.

## Definition of Done
- [DOD-1] (must) There is one verdict (`pass`, `fail` or `n/a`) for every acceptance criterion id of the slice and
  every check id of the lens, and no id that belongs to neither.
- [DOD-2] (must) Every verdict carries concrete evidence: a file and line, a command and its output, or quoted
  code. A `pass` without evidence is not a pass.
- [DOD-3] (must) Every `n/a` says why it does not apply to this slice.
- [DOD-4] (must) Every `fail` has a severity (`blocker`, `should-fix` or `nit`) and a suggestion a builder can act
  on without asking a question.
- [DOD-5] (must_not) Nothing was edited, fixed or committed: the review is read-only.
- [DOD-6] (must_not) No finding outside this lens's focus, where the lens says another lens owns it.
- [DOD-7] (should) The summary names what the review cost most time on, so slow reviews can be fixed.

## Outputs
A `Verdicts`: `status`, `summary`, `items` (id, verdict, evidence, severity, suggestion, reason).

## Failure handling
- The worktree or the diff cannot be read: return `blocked` with the path; do not guess from the plan.
- A criterion cannot be judged because the brief lacks what it refers to: `n/a` with that as the reason, and name it
  in the summary.
