# forge

The mode `forge` builds a piece of work in slices that run side by side. It runs no command and uses no model of its own. It is active only when the project is the kit itself.

## What it does today

One action, `waves`. It reads a plan file and works out, by script, what the owner reads before work starts:

```
bay call forge.waves '{"plan":"docs/plans/0022-forge-in-waves.yaml"}'
```

- **The table of slices**: each slice's name, title, kind, write scope, and the slices it comes after with the reason.
- **The waves**: slices in one wave have no order between them and scopes that share no path. Each wave can use one builder per slice. A slice goes in the first wave after every slice it comes after, and later still when its scope shares a path with a slice already in that wave.
- **The longest chain**, by names. The plan takes at least that many waves.
- **Every problem**, each with its sentence: an after that names no slice; a cycle, with the names in it; two slices that nothing orders whose scopes share a path, with the pattern of each and an example path; two such slices where forge cannot tell, with both patterns; a scope that admits every private file of a kernel feature, as a warning; a plan in which every slice waits for the one before and gives no reason in `oneAfterAnotherBecause`.

A file that is not YAML, or not in the form of a plan, is refused with every reason, each with its line. A slice with no write scope is refused this way, since `proof@1`'s slice requires one.

## The plan's form

`schemas/plan.json`: a title, and a list of slices, each a title and a slice. The slice is `proof@1`'s slice, held by reference to `proof@1/prove-request.json#/$defs/slice`, so the two cannot drift. That is why forge requires `proof@1`, and why the kit's config binds `proof`.

Whether two scopes share a path is one pure function, `scripts/lib/scopes.ts`. It matches paths with the toolbox's `pathMatch`, the matching `proof@1`'s kind `in-scope` uses, and it confirms every example path with it. A pattern `pathMatch` refuses is never answered "share no path".

## Settings

`featureMap`: the project's map of features, such as `framework/features.yaml`. Forge reads each feature's private files from it for the warning on a whole feature. Left out, no scope is compared with a feature. The kit sets it.

## What it will become

Forge carries a slice from an approved plan through a builder in a worktree, proof, the merge card and the merge; then the stages before the build; then a whole wave at once. Slices F1 to F4 of plan 0022 add those as workflows, skills and scripts in this folder.
