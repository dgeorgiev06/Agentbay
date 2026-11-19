# forge

The mode `forge` builds a piece of work in slices that run side by side. It runs no command and uses no model of its own. It keeps a slice's tests in a database partition of its own while a builder works. It is active only when the project is the kit itself.

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

It draws the start card from the slice and waits for the owner. The card shows every item of the slice's definition of done: its id, must or should, how it is held, its sentence whole, and what will be run or counted; then the names of the bugs to inject. Forge wraps each line to 35 columns, so it prints in 44 after its mark; a long word is broken, never dropped, and a long card is never cut. Rejected, the run fails and nothing is cut. Approved, `worktrees.cut` makes `.forge/worktrees/<slice>` on `forge/<slice>`; the skill `declare` states the files and action names the builder will change, and `scripts/declared-in-scope.ts` sends back any file outside the write scope; the skill `build` writes the slice in the worktree, or stops with what is missing as a name. `worktrees.set-aside` commits the work to `forge/wip/<slice>/<n>`, `proof.prove` judges that commit, and `draw` turns proof's answer into the merge card, by the pure function in `scripts/lib/cards.ts`. Every line of both cards is computed by script: none cites the build step or shows a builder's words, other than a path or a name. Merge is offered only when the builder built the slice and every must item, `scope` and `declared` passed; send-back and discard are withheld until slices F2 and WD1. Merge cuts `<slice>-merge` at the commit proof judged and merges it into the setting `into`, a branch nobody has checked out; keep leaves both branches. The build agent may write anywhere under `.forge/worktrees/`, not only in its own worktree: a write outside the slice is caught afterwards by proof's `scope` and `declared`, not stopped. Settings `into` and `practices` are the owner's to write.

## One round, a test writer and a builder who never has the tests

The workflow `one-round` builds one slice under ADR 24, in one round:

```
bay call --workflow forge:workflows/one-round.yaml '{"planned":{"title":"...","slice":{...}},"base":"<commit>","bugs":[],"interface":["<path>"]}'
```

`interface` names the files the slice builds against, such as schema files; it may be left out. The steps:

1. `slice` draws the start card, the same as `one-slice`'s, and names the files the builder may not change: every test file the slice's `fails-first` items name.
2. The owner approves the start card. Rejected, the run fails and nothing is cut.
3. `worktrees.cut` makes `.forge/worktrees/<slice>` on `forge/<slice>`.
4. The skill `declare` states the builder's files. Its check sends back a file outside the write scope, and a test file the slice names.
5. The script `round` calls the skill `write-tests` (tier balanced). Its task holds the slice's conditions, the interface files' paths, the slice's worktree at its base and the practices; its resource is `skills/write-tests/reviewing-tests.md`. Its agent has no tool that writes a file. It hands in its tests as data: a list of paths and texts. Its check, `scripts/tests-handed-in.ts`, sends back a path outside the scope, a path no `fails-first` item names, a path given twice, a named file left out, an empty text, and a text where no line starts a call of `test` or `it`.
6. `round` keeps the tests in forge's database partition `kept-tests`, in the file `.agentbay/data/forge--kept-tests.db`: each test gzipped and written in base64, one row per path. What the file holds of a test is only letters, digits, `+`, `/` and `=`. So it holds no line of a test that has another character, such as a space, a bracket or a quote; a line of letters and digits alone could appear in it by chance.
7. `round` calls the skill `build-without-tests` (tier balanced). Its task holds the slice, the interface files' paths, the test files' paths and the declaration, and no line of a test.
8. When the builder has answered, its step is closed. Only then `round` commits the builder's work with `worktrees.commit` to `forge/<slice>`, cuts `.forge/worktrees/<slice>-tests` on `forge/<slice>-tests` at that commit, writes the tests there as files from the partition, commits them with `worktrees.commit`, and deletes the slice's rows from the partition. That commit holds the builder's work and the tests, and it is the head proof judges. Forge never writes a test into the builder's worktree.
9. `proof.prove` judges the base and that head, with the builder's declaration and the test files added to it. `draw` draws the merge card, and `carry-out` does the owner's choice, as in `one-slice`. Send-back and discard are withheld.

A failed item on the merge card gives its reason: proof's own sentence in plain words when it is one proof writes, such as "the named tests fail on the head", and otherwise a sentence for its kind of proof. The card never shows a verdict's text that proof did not write.

What forge holds, with the hook or without it:

- No test is a file while a builder works. Under `.forge/` none is, and the builder's task holds none.
- The builder has no tool that runs a command: forge lists no command.
- The builder's declaration may not name a test file, and the tests written after it replace any file the builder wrote at their paths.

What forge does not hold:

- The kernel keeps a record of every step's output in `.agentbay/kernel.db`, the test writer's too, as plain JSON. While the builder works, that file holds the tests' text. With the agentbay hook on, a builder cannot read it, since forge's skills read only forge's folder, `docs/plans/`, `framework/features.yaml` and `.forge/worktrees/`. Without the hook, nothing stops a builder from reading it, and nothing in this round finds that it did.
- A write outside the declared files is not stopped. Proof's items `scope` and `declared` find it afterwards.

The worktrees `<slice>` and `<slice>-tests` and their branches stay after the run, as `one-slice`'s do: the worktrees interface removes a worktree only once its branch is merged into the branch the project has checked out. The partition holds no row of the slice once the tests are committed. A run that fails inside the round, before the tests are committed, leaves its rows there.

## The plan's form

`schemas/plan.json`: a title, and a list of slices, each a title and a slice. The slice is `proof@1`'s slice, held by reference to `proof@1/prove-request.json#/$defs/slice`, so the two cannot drift. That is why forge requires `proof@1`, and why the kit's config binds `proof`.

Whether two scopes share a path is one pure function, `scripts/lib/scopes.ts`. It matches paths with the toolbox's `pathMatch`, the matching `proof@1`'s kind `in-scope` uses, and it confirms every example path with it. A pattern `pathMatch` refuses is never answered "share no path".

## Settings

`into`: the branch a merge goes into. `practices`: the practices files a builder reads, relative to the project.

`featureMap`: the project's map of features, such as `framework/features.yaml`. Forge reads each feature's private files from it for the warning on a whole feature. Left out, no scope is compared with a feature. The kit sets it.

## What it will become

Forge will send a slice back for a second round, carry out the merge into the checked-out branch, run the stages before the build, and then build a whole wave at once. Slices F2 to F4 of plan 0022 and the capabilities they wait for add those.
