# forge

The mode `forge` builds a piece of work in slices that run side by side. It runs no command and uses no model of its own. It is active only when the project is the kit itself.

## What it does today

The action `waves` reads a plan file and works out, by script, what the owner reads before work starts:

```
bay call forge.waves '{"plan":"docs/plans/0022-forge-in-waves.yaml"}'
```

- **The table of slices**: each slice's name, title, kind, write scope, and the slices it comes after with the reason.
- **The waves**: slices in one wave have no order between them and scopes that share no path. Each wave can use one builder per slice. A slice goes in the first wave after every slice it comes after, and later still when its scope shares a path with a slice already in that wave.
- **The longest chain**, by names. The plan takes at least that many waves.
- **Every problem**, each with its sentence: an after that names no slice; a cycle, with the names in it; two slices that nothing orders whose scopes share a path, with the pattern of each and an example path; two such slices where forge cannot tell, with both patterns; a scope that admits every private file of a kernel feature, as a warning; a plan in which every slice waits for the one before and gives no reason in `oneAfterAnotherBecause`.

A file that is not YAML, or not in the form of a plan, is refused with every reason, each with its line. A slice with no write scope is refused this way, since `proof@1`'s slice requires one.

## One slice, from a plan's slice to the merge card

The workflow `one-slice` builds one slice of a plan:

```
bay call --workflow forge:workflows/one-slice.yaml '{"planned":{"title":"...","slice":{...}},"base":"<commit>","bugs":[]}'
```

It draws the start card from the slice and waits for the owner. Rejected, the run fails and nothing is cut. Approved, `worktrees.cut` makes `.forge/worktrees/<slice>` on `forge/<slice>`; the skill `declare` states the files and action names the builder will change, and `scripts/declared-in-scope.ts` sends back any file outside the write scope; the skill `build` writes the slice in the worktree, or stops with what is missing as a name. `worktrees.set-aside` commits the work to `forge/wip/<slice>/<n>`, `proof.prove` judges that commit, and `draw` turns proof's answer into the merge card, by the pure function in `scripts/lib/cards.ts`. Every line of both cards is computed by script: none cites the build step or shows a builder's words, other than a path or a name. Merge is offered only when the builder built the slice and every must item, `scope` and `declared` passed; send-back and discard are withheld until slices F2 and WD1. Merge cuts `<slice>-merge` at the commit proof judged and merges it into the setting `into`, a branch nobody has checked out; keep leaves both branches. The build agent may write anywhere under `.forge/worktrees/`, not only in its own worktree: a write outside the slice is caught afterwards by proof's `scope` and `declared`, not stopped. Settings `into` and `practices` are the owner's to write.

## The plan's form

`schemas/plan.json`: a title, and a list of slices, each a title and a slice. The slice is `proof@1`'s slice, held by reference to `proof@1/prove-request.json#/$defs/slice`, so the two cannot drift. That is why forge requires `proof@1`, and why the kit's config binds `proof`.

Whether two scopes share a path is one pure function, `scripts/lib/scopes.ts`. It matches paths with the toolbox's `pathMatch`, the matching `proof@1`'s kind `in-scope` uses, and it confirms every example path with it. A pattern `pathMatch` refuses is never answered "share no path".

## Settings

`into`: the branch a merge goes into. `practices`: the practices files a builder reads, relative to the project.

`featureMap`: the project's map of features, such as `framework/features.yaml`. Forge reads each feature's private files from it for the warning on a whole feature. Left out, no scope is compared with a feature. The kit sets it.

## What it will become

Forge will send a slice back for a second round, carry out the merge into the checked-out branch, run the stages before the build, and then build a whole wave at once. Slices F2 to F4 of plan 0022 and the capabilities they wait for add those.
