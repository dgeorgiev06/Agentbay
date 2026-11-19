# forge

The mode `forge` builds a piece of work in slices that run side by side. It runs no command and uses no model of its own. It keeps a slice's tests in a database partition of its own while a builder works. It may be active in any project: a project that lists forge gets proof and git-worktrees with it, bound, and the toolchain is the project's own.

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

It draws the start card from the slice and waits for the owner. The card shows every item of the slice's definition of done: its id, must or should, how it is held, its sentence whole, and what will be run or counted; then the names of the bugs to inject. Forge wraps each line to 35 columns, so it prints in 44 after its mark; a long word is broken, never dropped, and a long card is never cut. Rejected, the run fails and nothing is cut. Approved, `worktrees.cut` makes `.forge/worktrees/<slice>` on `forge/<slice>`; the skill `declare` states the files and action names the builder will change, and `scripts/declared-in-scope.ts` sends back any file outside the write scope; the skill `build` writes the slice in the worktree, or stops with what is missing as a name. `worktrees.set-aside` commits the work to `forge/wip/<slice>/<n>`, `proof.prove` judges that commit, and `draw` turns proof's answer into the merge card, by the pure function in `scripts/lib/cards.ts`. Every line of both cards is computed by script: none cites the build step or shows a builder's words, other than a path or a name. Merge is offered only when the builder built the slice and every must item, `scope` and `declared` passed; send-back is withheld, since no round runs after the card, and discard until slice WD1. Merge cuts `<slice>-merge` at the commit proof judged and merges it into the setting `into`, a branch nobody has checked out; keep leaves both branches. The build agent may write anywhere under `.forge/worktrees/`, not only in its own worktree: a write outside the slice is caught afterwards by proof's `scope` and `declared`, not stopped. Settings `into` and `practices` are the owner's to write.

## Rounds: a test writer, a builder who never has the tests, proof and a reviewer

The workflow `rounds` builds one slice under ADR 24, in at most three rounds:

```
bay call --workflow forge:workflows/rounds.yaml '{"planned":{"title":"...","slice":{...}},"base":"<commit>","bugs":[],"interface":["<path>"]}'
```

`interface` names the files the slice builds against, such as schema files; it may be left out. The steps are written out: `slice`, `start`, `cut`, `declare`, then `round-1`, `review-1`, `round-2`, `review-2`, `round-3`, `review-3`, then `prove`, `draw`, `card` and `carry-out`. There is no loop. A round or a review with nothing to do passes on what it was given.

1. `slice` draws the start card and names the files the builder may not change: every test file the slice's `fails-first` items name. Rejected, the run fails and nothing is cut.
2. `worktrees.cut` makes `.forge/worktrees/<slice>` on `forge/<slice>`. The skill `declare` states the builder's files; its check sends back a file outside the write scope, and a test file the slice names.
3. `round-1`, the script `round`: the skill `write-tests` (tier balanced, kept packed) writes the tests from the conditions and the interface, in the builder's worktree at its base, before any builder works. Its agent has no tool that writes a file; it hands its tests in as data, and `scripts/tests-handed-in.ts` checks them. Forge keeps them in its partition `kept-tests`, gzipped and in base64. The skill `build-without-tests` (tier balanced) writes the code; its task holds the slice, the interface's paths, the test files' paths and the declaration, never a line of a test. Forge commits the work, removes the builder's worktree and keeps its branch, cuts `<slice>-tests-1` at the builder's commit, writes the tests there and commits them. That commit is the round's head. `proof.prove` judges it, with the slice less its `checks` items and no bugs.
4. `review-n`, the script `review-round`, decides what follows a round:
   - The builder stopped: the rounds end.
   - A `must` item failed and this is round 1 or 2: no model. The builder's next round gets the failing cases, as below.
   - Otherwise the skill `review` (tier deep, kept packed, no tool that writes a file) judges the round. Its task holds the slice, the tests' text from the kept store, the builder's changed files as text, proof's verdicts, what the builder is told of the failing cases, the practices that review holds, and `skills/review/reviewing-tests.md`. It answers, for each condition, held by which cases or not held and why, and findings, each for the test writer or the builder, with the case's name, the question it fails and one sentence on the fix. Its check, `scripts/no-test-text.ts`, sends back a finding with no addressee, a field beyond the bounded ones, a fix or reason that is not one sentence, a finding for the builder or a reason that shares a run of 20 characters with a test, and a finding for the builder that names a case the tests do not name. The feedback quotes nothing of the tests.
   - Findings for the builder go into the review's output. Findings for the test writer may quote the tests, so forge keeps them packed in its partition, and the output holds only their count. No finding, or round 3 reviewed, and the rounds end.
5. `round-2` and `round-3` run only when the review before asks for them. With findings for the test writer, forge cuts `<slice>-writer-n` at the base, which holds no builder's work; `write-tests` gets its earlier tests and its findings, and forge removes that worktree and its branch once the tests are handed in. With findings for the builder, or failing cases, forge cuts `<slice>-n` at the builder's last commit; `build-without-tests` gets its findings and the failing cases there. Then a new head, `<slice>-tests-n`, and proof, as in round 1.
6. `prove` judges the last head with the slice whole and the bugs. `draw` draws the merge card; only a `must` item's verdict and a stopped builder withhold merge. The card adds the rounds count, and the reviewer's verdicts and the findings that remain, at most three named, as judged lines that cite the review step under which the reviewer last ran; the kernel adds its skill and tier. Send-back and discard are withheld: no round runs after the card.

What a failing case tells the builder (ADR 24, item 5, which allows names and messages):

- The failed `must` items' ids.
- Each failing case's name as the test runner gives it, control characters shown as spaces, cut at 200 characters. A name is the test writer's sentence for the case; its skill says that a name and an assertion's message hold no value of the test.
- The case's file only when it is one of the slice's named test files. Its path is already in the builder's task as `fixed`, so it tells nothing more.
- The message only when it shares no run of 20 characters with any of the slice's tests, compared with the tests' text, character by character. Otherwise the name alone, and a count of messages withheld.
- A test file that did not load: its path, when the slice names it, and nothing of its content.

Who can read what, in every round:

| While | On disk under `.forge/worktrees/` | In the step's task |
|---|---|---|
| the test writer, round 1 | the builder's worktree at the base, no work yet | conditions, interface, folder |
| the test writer, rounds 2 and 3 | its own worktree at the base only | its earlier tests, conditions, interface, its findings |
| the builder, any round | its own worktree, its own work; no test file | conditions, interface, test paths, its findings, the filtered failing cases |
| proof | the round's tests worktree: work and tests | |
| the reviewer | the round's tests worktree: work and tests | tests, code, verdicts, failing cases, practices |

The kernel keeps the test writer's and the reviewer's tasks and answers packed in `.agentbay/kernel.db`. Forge's partition holds the tests packed until the rounds end, then deletes them: the worktrees interface cannot read a file at a commit without a worktree on disk while a builder works.

What forge holds, with the hook or without it: no test is a file while a builder's step is open; the builder's task holds no line of a test; the test writer's task and its folder hold no line of the builder's code; the builder has no tool that runs a command, and the test writer and the reviewer none that writes a file.

What forge does not hold:

- Proof's answer is kept as text in `.agentbay/kernel.db`, failing cases' messages and all, since forge calls proof from a script and only a skill's output is kept packed. While a later builder works, that file can hold a message that quotes a test. With the agentbay hook on, a builder cannot read it; without the hook nothing stops a read.
- The card does not say whether skill steps ran with the hook: a script cannot read the run's events.
- A write outside the declared files is not stopped. Proof's items `scope` and `declared` find it afterwards.
- The round script has the kernel's limit of 480 seconds, and proof's run is inside it. A slice whose named tests take longer to run on the base and the head fails the run. A longer limit adds a warning to `bay check`, which the kit's tests pin; that is the owner's call.
- A run that fails between the first test writer and the last review leaves the slice's rows in the partition.

After a run the branches `forge/<slice>`, `forge/<slice>-n` and `forge/<slice>-tests-n` stay, and no worktree of the rounds is on disk.

## The plan's form

`schemas/plan.json`: a title, and a list of slices, each a title and a slice. The slice is `proof@1`'s slice, held by reference to `proof@1/prove-request.json#/$defs/slice`, so the two cannot drift. That is why forge requires `proof@1`, and why the kit's config binds `proof`.

Whether two scopes share a path is one pure function, `scripts/lib/scopes.ts`. It matches paths with the toolbox's `pathMatch`, the matching `proof@1`'s kind `in-scope` uses, and it confirms every example path with it. A pattern `pathMatch` refuses is never answered "share no path".

## Settings

`into`: the branch a merge goes into. `practices`: the practices files a builder reads, relative to the project.

`featureMap`: the project's map of features, such as `framework/features.yaml`. Forge reads each feature's private files from it for the warning on a whole feature. Left out, no scope is compared with a feature. The kit sets it.

## What it will become

Forge will carry out the merge into the checked-out branch, run the stages before the build, and then build a whole wave at once. Slices F2 to F4 of plan 0022 and the capabilities they wait for add those.
