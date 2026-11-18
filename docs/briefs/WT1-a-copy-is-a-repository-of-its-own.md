# Brief WT1: a throwaway copy is a repository of its own, so tools and the kit's own tests see its files

A mode slice with its interface (P-34). For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `wt1/copy-is-a-repository`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020` (item 2: checks run in a throwaway copy), `0022`, `0023`, `docs/designs/forge/calling-a-toolchain.md`, `worktrees-open-questions.md`, the report of slice KL1 as recorded in `docs/designs/forge/toolchain-open-questions.md` and below.
- What KL1 found, running the kit's own suite through its toolchain for the first time: `git-worktrees.copy` puts a commit's files under `.forge/copies/<name>`, which is not a git repository. Inside it, git sees the enclosing project, where `.forge/` is ignored, so `git ls-files` lists no files. The kernel lists a project's files with exactly that command (`bay/node-ports.ts`, the listing port), and so do the kit's tests (`tests/kit-copy.ts`). So in a copy: `./bay.sh` with the copy as its project sees an empty project, and 34 of the kit's tests fail. Proof's kinds for the checks, for the same output and for the real thing all run inside a copy.
- A second fact from that run: a git commit failed once because the machine's commit signing service was down. Nothing a mode runs in a copy may depend on the owner's signing, hooks or identity.
- `components/base/git-worktrees/` (22 listed commands with their true effects; every command starts with hooks off, the file watcher off and submodule recursion off, and a test holds that), `components/base/interfaces/worktrees/` and its shared test with the made-up `shelf`, `tests/made-up-worktrees.ts`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

## Output

1. **A copy is a repository of its own.** After `copy`, the copy's folder is the top of a git repository that holds the commit's files as one commit, with nothing untracked but the links the caller asked for (which are ignored there, so tools do not list a folder of installed packages as the project's files). `git ls-files` inside it lists the commit's files; `git status` is clean; the enclosing project's repository does not see the copy as changed and is not changed by anything done in the copy. Decide how (a fresh repository in the folder with one commit; or another way that gives the same facts) and say why; a way that makes the copy a worktree of the project's repository is not acceptable unless you show that nothing done in the copy (a commit, a branch, a reset, a `git clean`) can reach the project's branches, index or other worktrees, since tools and tests in a copy run unconfined.
2. **Nothing of the owner's is used.** The commit in the copy is made with a fixed identity that says a copy was made, no signing, no hooks, no templates, no global or system configuration that could run code or ask for a key. The same holds for `overlay` and `apply` on a copy where they now touch its repository. The mode's test that every listed command carries its protections is extended to whatever is added.
3. **`overlay`, `apply`, `changed` and `remove` still do what the interface says** on a copy that is now a repository: each sentence of the interface that is affected is brought up to date, and each has a case. `remove` leaves nothing behind, and nothing in the project's repository (no stale worktree entry, no ref, no object that only the copy needed, unless the way chosen keeps objects in the project's store, which the report then says and measures).
4. **The interface says it**: `worktrees@1`'s sentence for `copy` states that the folder is a repository of its own holding the commit's files, that links are present and ignored, and that the project's repository is untouched by what happens inside. The shared test gains the cases: `git ls-files` (or, for a worktrees mode that is not git, "the tool the mode names for listing files", decided the way the shared test already keeps git out of its own words) lists exactly the commit's files; a commit made inside the copy does not appear in the project; the links are not listed. The made-up `shelf` passes them or the report says why it cannot and what that means for a second worktrees mode.
5. **The real thing**, pasted: in a throwaway kit repository, `git-worktrees.copy` of the head with `node_modules` linked, then `typescript.test` on the copy with a limit of 1,000 seconds (slice KL1 must be merged for this; if it is not when you reach this step, wait for the reviewer or use the limit that exists and say so). The verdict, the counts, the time. If tests still fail in the copy, list each with its cause; a cause in the copy is yours to fix, a cause in a test that assumes it runs in the owner's checkout is reported, not fixed.
6. The open-questions notes updated. `CONTEXT.md`: the row for Throwaway copy gains what is now true.
7. A report.

Out of scope: `bay/` (if the kernel's listing must change for this to work, stop and report, P-25); proof; the `cut` worktrees a builder works in.

## Definition of done

- [DOD-WT1-1] (must) Output 1 and 2, tests first and seen failing, in the mode's tests with literal expected values: the files listed; clean status; the commit's author and that it is unsigned; a project whose git config demands signing and has a hook that writes a file: the copy is made, nothing is signed, the hook's file does not exist; the project's `git status` and refs are the same before and after a copy, a commit inside it, a reset inside it and its removal.
- [DOD-WT1-2] (must) Output 3 and 4: each affected action's case; the interface's sentences old and new; the shared test's new cases with the made-up mode.
- [DOD-WT1-3] (must) `./bay.sh check --project <copy>` in a copy of the kit lists the kit's modes and gives the same findings as in the kit itself (the long-step and listed-command warnings; no "not a file of the mode folder").
- [DOD-WT1-4] (must) Output 5 pasted.
- [DOD-WT1-5] (must) The time and disk cost of one copy of the kit before and after, measured three times; if a copy costs more than a second more, say what would make it cheaper and whether proof, which makes two to a dozen per slice, should share copies.
- [DOD-WT1-6] (must) A mode's folder and its interface are all this changes (P-34): nothing under `bay/`, `schemas/` or `adapters/`; `tests/new-mode-isolation.test.ts` passes unchanged; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise; `bay check`'s warnings for the mode's listed commands, before and after, diffed.
- [DOD-WT1-7] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository: the copy is left without a repository; the links are tracked; the commit is signed when the project asks for signing; a hook runs; a commit in the copy reaches the project's refs; `remove` leaves an entry in the project's repository; `overlay` leaves the copy's status dirty where the interface says clean (or the reverse, by what you decide); `apply` of half a patch is kept; the copy holds the project's working files and not the commit's. Each caught, or a test added.
- [DOD-WT1-8] (must) `npm run check` passes. Size per file, never targeted (P-13). No test waits real minutes.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts by rule, detector count with its command.
2. Reproduce the fault first, small: a copy of a three-file repository, `git ls-files` inside it prints nothing. Write in the progress note the way you choose and why, with what each action does to the copy's repository, before code (P-35).
3. `copy`, tests first. Then the other actions. Then the interface and its shared cases. Then the real run. A commit each.
4. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner, `bay call`, `bay check`.

## Resources

`components/base/git-worktrees/` (manifest, scripts, tests, README), `components/base/interfaces/worktrees/`, `tests/made-up-worktrees.ts` and its test, `components/base/git-worktrees/tests/typescript-in-a-project.test.ts`, `tests/kit-copy.ts` and `bay/node-ports.ts` (read only: how files are listed).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place: how a copy's repository is made. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-19. P-25. P-28. P-29, P-30. P-34.
- TypeScript: `components/base/typescript/practices.md`.
- The worktrees mode is the only mode that runs git. Every git command it lists keeps the protections its test holds, and any new command's effects are its true effects.
- Nothing done inside a copy may change the project's repository, branches, index or worktrees. If the chosen way cannot hold that, choose another.
- Write scope: `components/base/git-worktrees/`, `components/base/interfaces/worktrees/`, `tests/made-up-worktrees*`, the two notes, `CONTEXT.md` for one row. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/proof/`, `components/base/forge/` and `bay/`. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/wt1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it. Inject bugs only in a throwaway copy, never in the worktree.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list.
- Commit after every step that passes typecheck and its tests; keep `/tmp/wt1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the way chosen and why; the real run; each DOD item with pasted output; the bug-injection table; what proof (P1 to P5) needs to know; what you did not do; what you did not verify.
