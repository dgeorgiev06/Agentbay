# Brief G3b: the worktrees mode, part two: merge, set-aside, apply

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `g3b/worktrees`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0015` (this finishes its slice G3), `docs/adr/0016`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/forge/C-seams.md` section 2.3.
- `docs/briefs/G3-worktrees-mode-part-one.md`: everything under its "Rules and constraints" applies here unchanged, and its "Tools" section too, with `g3b` in place of `g3` in file names under `/tmp`.
- Part one (merged): `components/base/git-worktrees/` with `cut`, `status`, `changed`, `copy`, `overlay`, `remove`, the protections that stop a repository's code from running, and the kernel's throwaway folders. Read the mode's scripts, `lib/` and tests before writing anything.
- From the review of part one:
  - Two listed commands, `restore` and `switch`, would change the owner's own checkout if a script ever ran them in the project root. Nothing tests that they never are.
  - The protection `core.fsmonitor=false` has no test of its own.
  - The walk left a record of a worktree the mode had refused to remove and the builder then removed by hand. A record can outlive its folder.

## Output

1. Three more actions on `worktrees@1` and the `git-worktrees` mode, each with a description, an input schema and an output schema:
   - `merge`: given a slice's worktree folder and a target branch, merge the slice's branch into the target with a merge commit, and return the merge commit. The merge happens in a worktree this mode made for the target, never in the owner's checkout. On a conflict the merge is undone, the target is as it was, the slice's branch is kept, and the answer is a refusal that names the conflicting paths. Refused when the slice's worktree has changed or untracked files.
   - `set-aside`: given a slice's worktree folder, commit everything changed and untracked there to a new branch `forge/wip/<slice>/<n>`, with `n` the next unused number, put the worktree back to its head with no changes, and return the branch. With nothing changed, it does nothing and says so.
   - `apply`: given a copy's folder and a patch as text, apply the patch to the copy and return the paths it changed. Never a worktree. A patch that does not apply cleanly changes nothing and is refused with git's reason. A patch that names a path outside the copy, or with `..`, is refused before git runs.
2. The identity on commits this mode makes is fixed and says what made them, since the kernel gives git no home folder and no configuration of the owner's is to be read for it.
3. A guard, in one place, that no command which changes files or the checked-out branch ever runs in the project root: the scripts refuse before running it, and a test shows that for each such command.
4. A test of its own for the `core.fsmonitor` protection, seen failing with the protection removed while the listed prefix still matches.
5. `status`, `overlay`, `remove`, `merge`, `set-aside` and `apply` each say plainly when a folder is recorded but no longer exists, and `remove` then forgets the record instead of failing.
6. A report.

Out of scope: anything remote; rebase; squash; forge; proof.

## Definition of done

- [DOD-G3b-1] (must) `bay check` on the kit passes. Its only new findings are one warning per command newly listed, and the test of the kit's own check lists them as literals. `bay actions git-worktrees` lists nine actions. The report pastes both.
- [DOD-G3b-2] (must) Tests of each action, each written first and seen failing, with literal expected values, against small repositories the test builds inside a temporary project. At least:
  - `merge`: a clean merge gives a merge commit with two parents on the target, and the owner's checkout and index are byte for byte as before; a conflict is refused with the paths named, the target's head is unchanged, no merge is left in progress, and the slice's branch still exists; a slice with a changed file is refused; a target that does not exist is refused; merging a slice already merged says so and makes no commit.
  - `set-aside`: a changed file and an untracked file both end up in the commit on `forge/wip/<slice>/1`, and the worktree is clean at its old head; a second call makes `/2`; with nothing changed, no branch is made; an ignored file is left where it is and is not committed.
  - `apply`: a patch that adds, changes and deletes a file changes exactly those; a patch that does not apply changes nothing; a patch naming `../x` or an absolute path is refused and git does not run; a worktree's folder is refused.
- [DOD-G3b-3] (must) Output 3: one test per guarded command, seen failing with the guard removed.
- [DOD-G3b-4] (must) Output 4.
- [DOD-G3b-5] (must) Output 5: a test per action for a recorded folder that is gone.
- [DOD-G3b-6] (must) No hook runs on `merge` or `set-aside`: a test with `pre-commit`, `commit-msg`, `pre-merge-commit` and `post-merge` hooks that each write a file, seen failing without the protection.
- [DOD-G3b-7] (must) `resources.commands` gains only what the new scripts run, each as narrow as git's argument order allows, none with a force flag. The report lists each new prefix and what it can do beyond its intended use.
- [DOD-G3b-8] (must) Boundaries and one place: neither debt list grows; the copy-paste detector count does not rise above your starting measure; the report lists what the new actions share with the old ones.
- [DOD-G3b-9] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy, with time limits and results saved as you go. Include: a conflicted merge leaves the target changed; a conflicted merge deletes the slice's branch; the merge runs in the owner's checkout; `set-aside` loses an untracked file; `set-aside` reuses a number and overwrites a branch; `apply` accepts a worktree; `apply` half-applies a patch; the root guard is dropped. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-G3b-10] (must) `npm run check` passes. The capture differs only where the mode and interface gained actions and warnings; the report names the files that differ and explains each. Size before and after is reported per file and never targeted (P-13).
- [DOD-G3b-11] (must) Proven on the real thing (P-19), through `./bay.sh call` in your worktree with the kit as the project: `cut` two slices named `g3b-walk-a` and `g3b-walk-b` from head; commit a different small file in each by hand; make a scratch target branch `g3b-walk-target` at head by hand; `merge` the first into it; change the same line in both slices so the second conflicts, `merge` it and paste the refusal; leave a changed file in a slice and `set-aside` it; `copy` head and `apply` a small patch to the copy. Then remove everything the walk made, by the mode where it allows and by hand otherwise, and paste `git worktree list`, `git branch --list 'forge/*'` and `git branch --list 'g3b-walk*'` showing nothing is left, and `git status --short` of your own worktree showing it clean.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. Find out by trying, with only `PATH` set and no shell: how to merge without the owner's checkout being touched; how a conflict is detected and undone; what identity git needs to commit and how to give it without a home folder; how to apply a patch all or nothing; which hooks each command would run. Write what you found in the progress note before writing mode code.
3. Outputs 3, 4 and 5 first, each test first. Commit after each.
4. Then `merge`, `set-aside`, `apply`, tests first, a commit each.
5. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. Walk the real thing. `npm run check`. Commit. Report.

## Resources

`components/base/git-worktrees/` (everything), `components/base/interfaces/worktrees.yaml` and its schema folder, `bay/sdk.ts`, `tests/broker-throwaway.test.ts`, `tests/kit-check.test.ts`, `tests/mode-harness.ts`, `framework/features.yaml`.

## Rules and constraints

- Everything under "Rules and constraints" in the part-one brief.
- Your worktree is a linked worktree of the shared repository. Tests build their own repositories. For the walk, every branch and worktree is named as DOD-G3b-11 says, and all are gone at the end.
- The owner's checkout, index and uncommitted work are never changed by this mode. If the only way to do something would change them, do not do it: say so at the top of the report.
- A merge is never forced and never rewrites a branch. A branch is never overwritten.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; each DOD item with pasted command output as evidence; the interface file and the mode's manifest in full; every existing test file edited and why; the bug-injection table; ways this mode could still lose work or run code; what you did not do; what you did not verify.
