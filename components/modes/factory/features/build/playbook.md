# factory.build

## Purpose
Implement one slice, in its own git worktree, to its acceptance criteria and against the contracts in its brief.
Nothing outside that worktree is touched, so the slices of a wave can be built at the same time.

## Inputs
- `runId`, `sliceId` (required). The worktree comes from the `tree` step, the slice and its criteria from `brief`.

## Steps
1. `tree`: a code step; it cuts (or returns) the slice's worktree and branch and names the path.
2. `brief`: a code step; it returns the slice, its acceptance criteria, the contracts at its edges, the paths it may
   touch, the practices of the language profile, the commands that check it and any finding still open.
3. `implement`: the builder works only inside `tree.path`: reads what it needs, implements the smallest change that
   meets every criterion, writes the tests that show it, runs the brief's commands, and commits in that worktree.
4. `standards`: a code step; it blocks the call on a new standards finding in the project tree.
5. `checks`: a code step; it runs the language profile's commands inside the worktree and blocks the call when one
   fails.
6. `record`: a code step; it records the stage for the slice.

## Definition of Done
- [DOD-1] (must) Every `must` and `must_not` acceptance criterion of the slice is met, and `met` lists their ids.
- [DOD-2] (must) Every criterion that can be tested has a test that fails without the change, and the result says
  which test covers which criterion.
- [DOD-3] (must) Nothing outside the slice's declared paths was written, and nothing outside the worktree at all.
- [DOD-4] (must) Every contract the slice publishes has exactly the shape the brief states; a contract it consumes
  is used as stated or, where the publisher is unfinished, through the stub the brief names.
- [DOD-5] (must) The brief's commands were run inside the worktree and their outcome is in `checks`.
- [DOD-6] (must) The work is committed on the slice's branch; `artifacts` lists every file written.
- [DOD-7] (must) Every practice of the language profile is followed, or the departure is named in `followups` with
  its reason.
- [DOD-8] (must_not) No criterion is reported met on the strength of a disabled, skipped or weakened test.
- [DOD-9] (should) Nothing beyond the slice's criteria was added: a good idea for later goes in `followups`.

## Outputs
A `Result`: `status`, `summary`, `artifacts`, `met`, `unmet`, `checks`, `followups`, `blockers`.

## Failure handling
- A contract the slice consumes does not exist yet: build against the brief's stub, note it in `followups`.
- A criterion cannot be met as written: implement the rest, list it in `unmet` with why, return `partial`.
- A command the brief names is not installed: return `partial`, name the command; do not substitute another.
- The brief's paths do not cover what the criteria need: return `blocked`; the slicing is wrong, not the code.
