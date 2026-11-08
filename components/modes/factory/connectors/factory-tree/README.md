# factory-tree

Implements `factory.tree/v1`: the subtree each slice is built in.

- `open` cuts the run's integration branch (`<branchPrefix><runId>`) from HEAD the first time it is called, puts a
  worktree for it under `<worktreeRoot>/<runId>/_integration`, then cuts the slice's branch
  (`<branchPrefix><runId>/<sliceId>`) from it and puts a worktree at `<worktreeRoot>/<runId>/<sliceId>`. Calling it
  again returns the same tree. The folder that holds the worktrees gets a `.gitignore` of `*`, so the trees never
  show up in the project's own status.
- `checks` runs the commands of the run's language profile inside one tree and returns each command's exit code and
  the tail of its output. A failure sets `stopped`, which ends the step blocked.
- `integrate` merges a slice's branch into the integration branch inside the integration worktree, then runs the
  profile's commands there. A conflict is aborted and reported with the files; a check that fails after a clean
  merge is rolled back with `reset --hard`. Either way the branch is left exactly as it was.
- `trees` reports the run's worktrees.

## Why worktrees

Two builders in one checkout would overwrite each other, and a half-finished slice in the project's working tree
would break the owner's own work. A worktree per slice gives each builder a real checkout on its own branch, and the
build env can write nothing outside `<worktreeRoot>`, so a slice's blast radius is its own tree.

## What it does not do

It never pushes, never touches a branch outside the run's prefix, never commits in the project's own worktree, and
never removes a worktree: `git worktree remove <path>` is the owner's, once the run's branch is merged or dropped.
The commands it runs come only from the language profiles in the factory component, never from a call's input, so no
agent can choose the checks it is held to.
