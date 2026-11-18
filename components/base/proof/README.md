# proof

The mode `proof` implements `proof@1`. Its one action, `prove`, takes a slice and the commits it runs from and to, and gives each item of the slice's definition of done a verdict: passed, failed or inconclusive. It uses no model. Inconclusive means nothing is known, and it is never a pass: any part of an item that is inconclusive makes the item inconclusive, even beside a part that failed.

Proof reaches code only by copy, call, remove. It asks the worktrees interface for a throwaway copy of a commit, asks the toolchain to check or test that copy, and asks the worktrees interface to remove the copy afterwards, on every path. It never gives a toolchain a slice's worktree or the project's folder.

## What it proves in this version

Each kind of proof is one file under `scripts/kinds/`, and `scripts/kinds.ts` is the table from each kind to its file. A kind that is not built yet answers inconclusive with a sentence that says so, never passed.

### checks

Built. A copy of the head; the toolchain's `describe`, then `check` and `test` on the copy; the copy removed. Passed when every check passed and the test run passed. A check the project is not set up for, a run stopped at its limit, and a copy that could not be made each make the item inconclusive, with the reason the toolchain or the worktrees interface gave.

### fails-first

Built. A copy of the base with the item's test files laid over it as they are at the head, and those files run there; then a copy of the head, and the same files run there. Passed when the run on the base failed and the run on the head passed. A run on the base that passed fails the item, since the tests do not show the change. A test file that does not exist at the head fails the item. A run that could not start makes it inconclusive.

### in-scope

Built. Proof adds it to every slice as the item `scope`. It asks the worktrees interface what changed between the base and the head, and matches each changed path against the slice's write scope with the toolbox's `pathMatch`; a move counts as its old path and its new path. It reads no copy. Passed when every path is in the scope. Each path outside fails the item and is named as the worktrees interface gave it, as many as fit in the detail, and the rest are counted. What changed not known, or a scope entry that is not a pattern, makes the item inconclusive; the request's schema already refuses such an entry. A changed path the matcher refuses as a path is outside the scope.

### as-declared

Built. Proof adds it to every slice as the item `declared`. It compares the files that changed, a move counting as its old path and its new path, with the files the builder declared, and the action names that changed with the names declared as gained, lost and changed. Action names are read from each changed `mode.yaml` and each changed interface `.yaml` file, in a copy of the base and a copy of the head, by the listed command `read-file` (`cat`, effect read; each read asked for what is left of the step, as a toolchain call is), and read as YAML with the toolbox's `readYaml`. An action is named `name.action`; it is changed when its block reads to another value at the head, so a change only to a comment or to quoting is not seen. Passed when both agree. Otherwise the detail gives counts only, never a declared path or name. What changed not known, a copy not made, or a file that could not be read or is not YAML makes the item inconclusive.

### bugs-caught

Built. For each bug of the request, one after another: a fresh copy of the head, the bug's patch applied with the worktrees interface's `apply`, the toolchain's `test` with only the bug's covering test files, and the copy removed. Passed when every run failed. A run that passed is a bug that survived: it fails the item, and the detail names it by the name the request gives it. No bugs, a patch that does not apply, a run that was stopped or could not start, and a copy that could not be made each make the item inconclusive; such a bug is never counted as caught. Each run is asked for what is left of the step, as every toolchain call is, and reports what it spent; so a dozen quick bugs each get the full 1,000 seconds, while a bug whose run hangs takes what it is given and the bugs after it get what remains, or are not run and are inconclusive.

### same-output

Built. Each command the project declares in proof's settings, under `sameOutput`, is run in a copy of the base and then in a copy of the head, by the listed command `bay` (`./bay.sh` at the copy's root, effects read and write; each run asked for what is left of the step, as a toolchain call is). What each printed to its standard output and its exit code are compared; its standard error is not. Passed when every command printed and ended the same at the base and the head, except those the item names in `differ`, which must not. A command that differs and is not named, or is named and does not differ, fails the item, and the detail names the command, never its output. A project that declares no commands, a name in `differ` the project does not declare, a run that was stopped, could not start or printed more than proof reads, and a copy that could not be made each make the item inconclusive.

### real-thing

Built. The item's runs are made one after another in one fresh copy of the head, by the listed command `bay`, as `same-output` makes them. Passed when each run printed exactly the expected text to its standard output and ended with the expected exit code. A run that printed other text or ended with another code fails the item; the detail says which run, by its number, and never what it printed. A run that was stopped, could not start or printed more than proof reads, and a copy that could not be made, make the item inconclusive.

### count

Not built.

## What every verdict comes with

- The items `scope` and `declared`, which proof adds to every slice after the slice's own items.
- The judgement items, the ones that name no kind of proof, exactly as the slice gives them. A person or a named model judges them.
- The size of each changed file: its lines at the base and at the head, counted with `wc -l` in two copies. No verdict rests on it.

## What it does not prove

Proof runs code a builder wrote. The toolchain's checks and tests run the head's own scripts, unconfined, as the toolchain always does. A throwaway copy limits where that code writes by convention only: nothing stops the code from writing elsewhere. A passed verdict says that the checks and tests the project has passed on a copy; it does not say the code is safe or correct.

A detail or a reason holds only sentences of proof's own, paths and check names as the toolchain and the worktrees interface gave them, and their reasons. No text a builder wrote, and no path the builder declared, is put into one.

## Time

`prove` is one script step of at most 1,800 seconds, the kernel's ceiling. The number of toolchain calls depends on the slice, so it cannot be one step per call. Each toolchain call is asked for what is left of the step by proof's own count, at most 1,000 seconds: 1,800 less 60 kept (30 for the toolchain to answer after its own limit, 30 for proof to remove its copies and answer), less what earlier calls reported or were asked, less 5 for each other call. A check call shares that time among the checks `describe` lists, since a time limit is asked per check; when `describe` does not answer, the whole time is asked per check, and the toolchain's own step bounds the call. A call with no time left is not made, and its part is inconclusive. `bay check` warns of the long step.

## How a reviewer calls it by hand

Write the slice in the form of `proof@1`'s request into a file, with the base, the head, the declaration and the bugs, then run it in the project:

```
./bay.sh call proof.prove "$(cat slice.json)"
```

The kit's `components/base/interfaces/proof/tests/tr2.json` is a slice in that form.
