# Brief S2: a shared test for `worktrees@1`

Mode slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `s2/worktrees-shared-test`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/briefs/S1-a-shared-test-for-toolchain.md`: this slice is the same work for another interface. Its Rules and constraints, its Tools and the form of its report apply here unchanged, with `s2` in place of `s1` in file names under `/tmp`, and "git-worktrees mode" in place of "typescript mode".
- The two shared tests that exist, as models: `components/base/interfaces/items-store/tests/shared.ts` and `components/base/interfaces/toolchain/tests/shared.ts`, with how each mode runs its own, and `tests/made-up-toolchains.test.ts` for how a made-up base mode was written by a test.
- `components/base/interfaces/worktrees.yaml` and its schemas; the git-worktrees mode (`components/base/git-worktrees/`), its README and its tests. Forge will call `worktrees@1` to give each slice a branch and a worktree, to make throwaway copies for proof, and to merge; a project that keeps its code in something other than git would be a second mode behind it.
- What an earlier builder proposed the shared test would state: `cut` makes a folder and a branch at the full commit, and `status` of it is clean with no commits; `changed` lists exactly the paths that differ; `copy` and `overlay` place and remove paths as they are at the commit, and `apply` reports the paths a patch changed; `merge` refuses a branch that does not merge cleanly and says when one is already merged; `set-aside` leaves the worktree clean; `remove` refuses a worktree whose branch is not merged. Treat this as a starting list, not the answer.

## Output

1. `components/base/interfaces/worktrees/tests/shared.ts`: what any mode that implements `worktrees@1` must do, through the interface's nine actions only, using only the test toolbox. It does not run git and does not look inside `.git`. What it cannot do through the interface is given to it by the mode's test: at least how to start a project that holds a repository with given files committed, how to commit given files in a worktree or on a branch (the interface has no action for a builder's own commits), how to read what a branch holds, and how to say which branch the owner has checked out. You choose the form of that argument and argue it in the report; a second implementer must be able to supply it without reading the git-worktrees mode. The shared test may read and write files in folders the actions return.
2. The statements it holds, each with literal expected values and each resting on a named place in the interface (a schema, a description, the mode's README where the interface points to it). At least: every statement in the starting list; that each action refuses a folder the mode did not make, and names and paths the schemas forbid; that a conflict leaves the target and the slice's branch as they were and names the conflicting paths; that the owner's checkout, its files and its uncommitted work are unchanged by every action (stated once, over all nine); that `set-aside` loses nothing that was changed or untracked and never reuses a branch name; that `copy` holds exactly the commit's files and a linked path is the project's own; that `apply` is all or nothing.
3. The git-worktrees mode runs the shared test from its own tests. Its tests that state the interface's meaning move into the shared test; tests of how this mode does it with git (the listed commands, hooks, filters, merge drivers, attributes, the root guard, the records table) stay in the mode. Nothing the mode's tests held is lost.
4. A made-up second implementation proves the shared test is about the interface, as far as that can honestly be done: the nearest thing is a small mode that keeps "commits" as folders of files and "branches" as names in its own database, written by a test. If that is too large to be honest work for this slice, say so, build the part that covers `cut`, `status`, `changed`, `copy`, `overlay` and `remove`, and list what is left unproved. A deliberately wrong one, whose `remove` deletes a worktree with changed files, fails the shared test.
5. A report, which also states plainly anything the interface leaves undefined that a second implementation would trip on, as questions for the owner. Do not change the interface.

## Definition of done

- [DOD-S2-1] (must) The shared test's cases listed, each with the place in the interface it rests on.
- [DOD-S2-2] (must) A table of the git-worktrees mode's tests: moved to the shared test, or stays and why. The mode's test count before and after, with nothing lost.
- [DOD-S2-3] (must) `bay check` on the kit passes: the mode imports its interface's shared test. In a throwaway copy with that import removed, the finding is pasted.
- [DOD-S2-4] (must) Output 4: what was built, what it passes, and the wrong one failing with the case that caught it, pasted.
- [DOD-S2-5] (must) Bug injection (P-18, P-31) in the git-worktrees mode's scripts, at least 12 bugs, one at a time, in a throwaway copy with time limits and results saved as you go, run against the shared test alone. Include: `remove` deletes a worktree with a changed file; `remove` deletes an unmerged branch; a conflicted merge leaves the target changed; the merge runs in the owner's checkout; `set-aside` loses an untracked file; `apply` half-applies a patch; `overlay` accepts a worktree; `copy` includes the repository's own data; `changed` reports a rename as an add; `status` lists commits newest first; `cut` reuses an existing branch. Each is caught by the shared test, or a case is added, or the report says why it belongs to the mode's own tests.
- [DOD-S2-6] (must) Write scope held: `git diff --stat` shows only `components/base/interfaces/worktrees/tests/`, `components/base/git-worktrees/tests/`, and the tests that prove Output 4. No file under `bay/`. The interface's signatures and schemas and the mode's scripts are unchanged.
- [DOD-S2-7] (must) Neither debt list grows; the copy-paste detector count does not rise above your starting measure. `npm run check` passes. The suite's time before and after is reported; if the shared test adds more than a minute, say where the time goes.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, both debt counts by rule, the detector count, and the git-worktrees mode's test count.
2. Read the interface, its schemas, the mode's README and its tests. Write in the progress note what the interface means, as a list of statements, and which existing test holds each. Decide the form of what a mode's test gives the shared test, and write it down before code (P-35).
3. The shared test, with the git-worktrees mode running it. Move the tests. A commit.
4. The made-up implementations. A commit.
5. Inject the bugs in a copy. `npm run check`. Commit. Report.

## Resources

`components/base/interfaces/worktrees.yaml` and `worktrees/`, `components/base/git-worktrees/` (read its scripts; change only its tests), the two existing shared tests, `tests/test-toolbox.ts`, `tests/made-up-modes.ts`, `tests/made-up-toolchains.ts` and their tests.

## Rules and constraints

- Everything under "Rules and constraints" in `docs/briefs/S1-a-shared-test-for-toolchain.md`, read for this interface and this mode.
- Your worktree is a linked worktree of a shared repository. Every repository a test uses is one the test builds in a temporary project; nothing is cut, merged or removed in your own worktree's repository.
- Three files now hold the same helpers for copying the kit into a temporary folder (`tests/new-mode-isolation.test.ts`, `tests/made-up-toolchains.test.ts`, and one in the typescript mode's tests). If Output 4 needs them a fourth time, put them in one place first, in its own commit, and name it at the top of the report (P-12).
- Another builder is working in a different worktree on `bay/broker/` and its tests. Do not edit those.
