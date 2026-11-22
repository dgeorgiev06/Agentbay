# proof

The mode `proof` implements `proof@1`. Its one action, `prove`, takes a slice and the commits it runs from and to, and gives each item of the slice's definition of done a verdict: passed, failed or inconclusive. It uses no model. Inconclusive means nothing is known, and it is never a pass: any part of an item that is inconclusive makes the item inconclusive, even beside a part that failed.

Proof reaches code only by copy, call, remove. It asks the worktrees interface for a throwaway copy of a commit, asks the toolchain to check, test or run a command in that copy, and asks the worktrees interface to remove the copy afterwards, on every path. It never gives a toolchain a slice's worktree or the project's folder.

## What it proves in this version

Each kind of proof is one file under `scripts/kinds/`, and `scripts/kinds.ts` is the table from each kind to its file.

### checks

Built. A copy of the head; the toolchain's `describe`, then `check` and `test` on the copy; the copy removed. Passed when every check passed and the test run passed. An item that gives `testsFrom` runs, in place of every test, only those of its files that the toolchain's `testFiles` patterns from `describe` hold, and its detail when passed says how many test files ran; none of them a test file, or no answer from `describe`, and no test runs and the item is inconclusive. The checks run whole either way. An item that gives `bayCheck` also runs the copy's own `./bay.sh check` after the checks: exit code 0 holds, 1 fails the item with the count of errors it printed, and anything else, or a run not known, makes it inconclusive; a passed detail ends `bay check on the head found no error.` A failed run of the chosen test files says that it was that run. A check the project is not set up for, a run stopped at its limit, and a copy that could not be made each make the item inconclusive, with the reason the toolchain or the worktrees interface gave. When the item fails and the test run failed, the verdict carries that run's failing cases (see below).

### fails-first

Built. A copy of the base with the item's test files laid over it as they are at the head, and those files run there; then a copy of the head, and the same files run there. Passed when the run on the base failed and the run on the head passed. A run on the base that passed fails the item, since the tests do not show the change. A test file that does not exist at the head fails the item. A run that could not start makes it inconclusive. When the item fails because the run on the head failed, the verdict carries that run's failing cases (see below); the base's are never carried.

### in-scope

Built. Proof adds it to every slice as the item `scope`. It asks the worktrees interface what changed between the base and the head, and matches each changed path against the slice's write scope with the toolbox's `pathMatch`; a move counts as its old path and its new path. It reads no copy. Passed when every path is in the scope. Each path outside fails the item and is named as the worktrees interface gave it, as many as fit in the detail, and the rest are counted. What changed not known, or a scope entry that is not a pattern, makes the item inconclusive; the request's schema already refuses such an entry. A changed path the matcher refuses as a path is outside the scope.

### as-declared

Built. Proof adds it to every slice as the item `declared`. It compares the files that changed, a move counting as its old path and its new path, with the files the builder declared, and the action names that changed with the names declared as gained, lost and changed. Action names are read from each changed `mode.yaml` and each changed interface `.yaml` file, in a copy of the base and a copy of the head, by the listed command `read-file` (`cat`, effect read; each read asked for what is left of the step, as a toolchain call is), and read as YAML with the toolbox's `readYaml`. An action is named `name.action`; it is changed when its block reads to another value at the head, so a change only to a comment or to quoting is not seen. Passed when both agree. Otherwise the detail gives counts only, never a declared path or name. What changed not known, a copy not made, or a file that could not be read or is not YAML makes the item inconclusive.

### bugs-caught

Built. For each bug of the request, one after another: a fresh copy of the head, the bug's patch applied with the worktrees interface's `apply`, the toolchain's `test` with only the bug's covering test files, and the copy removed. Passed when every run failed. A run that passed is a bug that survived: it fails the item, and the detail names it by the name the request gives it. No bugs, a patch that does not apply, a run that was stopped or could not start, and a copy that could not be made each make the item inconclusive; such a bug is never counted as caught. A bug that names a test file missing at the head is inconclusive, since the run prints no summary of tests. A run that failed only because test files did not load, with no failing case listed or counted and at least one file in the toolchain's `notLoaded`, is inconclusive too: the bug's tests did not run, and the reason says so with a count of the files. A run with a failing case is caught, also when another of its files did not load. When the toolchain's answer has no `notLoaded`, as from an older toolchain, a failed run counts as caught for any reason, as before: a patch that stops a test file from loading then reads as one failed test. Tests that already fail at the head without the bug are shown by the item `checks` failing, not here. Each run is asked for what is left of the step, as every toolchain call is, and reports what it spent; so each of a dozen bugs may ask up to the longest call but never more than is left, a run that hangs leaves less for the bugs after it, and a bug with no time left is not run and is inconclusive.

### Two ways to run a command

`same-output` and `real-thing` run commands in a copy. A command is written one of two ways, and each run is made its own way:

- `bay`: the words given to the copy's own `./bay.sh`, by the listed command `bay` (`./bay.sh` at the copy's root, effects read and write). This is for the kit and projects built on agentbay. A request or a setting written this way means what it meant before `run` was added.
- `run`: the name of one of the project's own commands, with `arguments` if it needs words, made through the toolchain's action `run` in the copy. For the typescript mode it is a script of the copy's `package.json`, by its name; never a command line. Proof runs no command of its own for it. Each word reaches the command as one argument, as written.

Each run is asked for what is left of the step, as every toolchain call is. A run through the toolchain that the toolchain did not answer, answered as not set up or not started, stopped at its limit or by a signal, or answered with output it cut, is not known; so is a `bay` run that could not start, was stopped, or printed more than proof reads. A run not known makes the item inconclusive, never passed.

The command a run makes is the project's own code. It runs unconfined inside the copy, exactly as the project's tests do: the copy limits where it writes by convention only.

### same-output

Built. Each command the project declares in proof's settings, under `sameOutput`, is run in a copy of the base and then in a copy of the head, with `bay` or with `run` as it is declared. What each printed to its standard output and its exit code are compared; its standard error is not. Passed when every command printed and ended the same at the base and the head, except those the item names in `differ`, which must not. A command that differs and is not named, or is named and does not differ, fails the item, and the detail names the command, never its output. A project that declares no commands, a name in `differ` the project does not declare, a run that is not known, and a copy that could not be made each make the item inconclusive.

### real-thing

Built. The item's runs are made one after another in one fresh copy of the head, each with `bay` or with `run` as it is written, as `same-output` makes them. Passed when each run printed exactly the expected text to its standard output and ended with the expected exit code. A run that printed other text or ended with another code fails the item; the detail says which run, by its number, and never what it printed. A run that is not known, and a copy that could not be made, make the item inconclusive.

### printed

Built. The item's runs are made one after another in one fresh copy of the head, each with `bay` or with `run`, as `real-thing` makes them. Proof compares nothing: a passed verdict hands back, in `printed`, the last run's exit code and what it printed to its standard output, whole, for the caller to judge; the earlier runs only have to end. Passed when every run ended and the last printed at most 20,000 characters, so a hundred such items stay well inside a script's output limit. A run that is not known, and a copy that could not be made, make the item inconclusive, and an inconclusive verdict hands back nothing printed. This is the kind forge uses to try a design's worked examples against a built mode, one item, and so one copy, per example. What `printed` holds is the head's own code's output, never a sentence of proof's; no detail or reason holds any of it.

### count

Built. Counts the lines that hold the item's text under its paths, in a copy of the head, by the listed command `count-matches` (`grep -r -c -h -F -e`, effect read; asked for what is left of the step, as a toolchain call is). The text is matched as written, not as a pattern, and a folder counts every file under it. With `most`, passed when the head has at most that many lines. A count that may not rise, given in the item with `noRise` or named with `use` from proof's settings under `noRise`, is counted in a copy of the base too, by the same code, and passed when the head has no more than the base. The detail gives the numbers, never the text. A path that does not exist, a count that was stopped or printed more than proof reads, a copy that could not be made, and a name the settings do not declare make the item inconclusive.

## The failing cases a verdict carries

A failed verdict of the kind `checks` or `fails-first` whose test run on the head failed holds `cases`: what the toolchain's failed answer named, copied as it gave it. `failures` is each failing case, with its name, its file, the first line of its message and how many characters of that line were cut; `failuresNotListed` is how many more failing cases the toolchain counted; `notLoaded` is the test files that failed as a whole. A field the toolchain's answer left out is left out here, so an older toolchain that names no cases gives an empty `cases`. No other verdict holds `cases`: not a passed one, even when the run on the base failed, and not an inconclusive one.

Proof filters nothing in them. They are data beside the verdict for the caller, such as forge, to filter before a builder sees any of it, since a message can hold a test's text. Nothing of a case reaches a detail or a reason: those stay counts and proof's own sentences.

## What every verdict comes with

- The items `scope` and `declared`, which proof adds to every slice after the slice's own items.
- The judgement items, the ones that name no kind of proof, exactly as the slice gives them. A person or a named model judges them.
- The size of each changed file: its lines at the base and at the head, counted with `wc -l` in two copies. No verdict rests on it.

## What it does not prove

Proof runs code a builder wrote. The toolchain's checks, tests and runs run the head's own scripts, unconfined, as the toolchain always does; so does `./bay.sh` in a copy. A throwaway copy limits where that code writes by convention only: nothing stops the code from writing elsewhere. A passed verdict says that the checks and tests the project has passed on a copy; it does not say the code is safe or correct.

A detail or a reason holds only sentences of proof's own, paths and check names as the toolchain and the worktrees interface gave them, and their reasons. No text a builder wrote, and no path the builder declared, is put into one.

## Time

`prove` is one script step. The number of toolchain calls depends on the slice, so it cannot be one step per call. Proof counts the step's time itself, by two settings under `settings.proof` in `agentbay.config.yaml`:

| Setting              | Left out | Bounds       | What it is                                                                                                                                                                                                                                         |
| -------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepSeconds`        | 1,800    | 120 to 7,200 | The seconds proof counts for one call of `prove`, every call in it together. Its most is the `scriptTimeLimitSeconds: 7200` that `mode.yaml` declares for `prove`, the kernel's ceiling, at which the kernel stops the step whatever proof counts. |
| `longestCallSeconds` | 1,000    | 1 to 3,600   | The most proof asks for one toolchain call, such as one whole test run, or one command it runs. Its most is the most `toolchain@1` lets a call ask.                                                                                                |

Each toolchain call is asked for what is left of the step by proof's own count, at most `longestCallSeconds`: `stepSeconds` less 60 kept (30 for the toolchain to answer after its own limit, 30 for proof to remove its copies and answer), less what earlier calls reported or were asked, less 5 for each other call. A check call shares that time among the checks `describe` lists, since a time limit is asked per check; when `describe` does not answer, the whole time is asked per check, and the toolchain's own step bounds the call. A call with no time left is not made, and its part is inconclusive; its reason says how long the step was and that `settings.proof.stepSeconds` raises it. A test run, a check or a command that took all the time proof asked for, and so was stopped at its limit, keeps the toolchain's reason and adds what proof asked for and which setting raises it: `longestCallSeconds` when proof asked for its longest call, `stepSeconds` when the step had less left. `bay check` warns of the long step.

A project whose whole test run takes longer than 1,000 seconds in a throwaway copy sets both. The kit sets `longestCallSeconds: 3400` and `stepSeconds: 4200`: its own whole run took 2,292 seconds in proof's copy beside other builders' runs, and 1,610 beside a few test files; 3,400 is the first times 1.5, and the step adds the checks, which took 75 seconds, and the runs of named test files after them.

## How a reviewer calls it by hand

Write the slice in the form of `proof@1`'s request into a file, with the base, the head, the declaration and the bugs, then run it in the project:

```
./bay.sh call proof.prove "$(cat slice.json)"
```

The kit's `components/base/interfaces/proof/tests/tr2.json` is a slice in that form.
