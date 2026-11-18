# Brief T1: the typescript and git-worktrees modes work from a project that is not the kit

A mode slice with its interface (P-34). For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `t1/toolchain-anywhere`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0023` (the decision), `0018`, `0020` (item 2), `0022`, `docs/plans/0022-forge-in-waves.md` (this is slice T1; P1 needs it), `docs/designs/forge/modes-beside-the-kit.md`, `toolchain-open-questions.md`, `calling-a-toolchain.md`, `docs/designs/proof/A-smallest.md` (what proof's "output is the same" needs from fixtures in the repository), `docs/research/2026-11-17-suite-time.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Today the typescript mode lists six commands that run scripts of the checkout's `package.json` by name; its tests run it only where the project is the kit. `describe` returns `practices` as a path "relative to the kit". The request schemas allow a time limit of at most 420 seconds. The git-worktrees mode's tests also run only in the kit. The capture's fixtures live outside the repository at `/home/claude/m5-capture/fixtures/`.

## Output

1. **In a project that is not the kit**, with the kit's typescript mode active and a small TypeScript package of the test's own making (its own `package.json` with the agreed scripts, its own tsconfig, two source files and a test), `describe`, `check` and `test` give true verdicts: all pass; a type error fails `typecheck` with its last line; a failing test fails `test` with the test's name. The folder checked is a throwaway copy made by the kit's git-worktrees mode in that same project, so the two modes are proven together there.
2. **A required script the project lacks** makes that check inconclusive with a sentence that names the script and says what to add to `package.json`. Decide from the code how the mode learns which scripts exist without running anything the project wrote (reading the checkout's `package.json` through the mode's granted read, or a listed command that prints it; say which and why it is safe), and hold it with a test.
3. **An optional check**: `generate:check` is listed by `describe` and run by `check` only where the project has the script. In the kit nothing changes: the same checks in the same order with the same verdicts.
4. **`describe` says what a project has and lacks**: the agreed scripts present and missing, in the interface's response, with a sentence on each new field. The shared test gains the cases this needs, written so that a toolchain for another language (the made-up `tally`) passes them too: the notion is "a check the checkout is not set up for is inconclusive and `describe` says so", not "npm".
5. **Practices are relative to the mode's own folder** in the interface's sentence and in what the typescript mode returns. Every caller that reads the path is changed with it; the shared test's case for the practices file holds in the kit and in a project (the case the project's `tally` fails today passes).
6. **The time limit** a `check` or `test` call may ask for rises to 1,000 seconds in both request schemas, with the sentence saying why a suite may need it. The default when none is given is stated (open question 9) and tested.
7. **The capture's fixtures move into the repository** under `tests/fixtures/`, unchanged, with a short README saying what each is for and that proof's settings will name them. The capture script outside the repository is left as it is. Nothing reads the new folder yet except a test that each fixture loads or fails to load as its README says.
8. `docs/designs/forge/modes-beside-the-kit.md` and `toolchain-open-questions.md` are brought up to date: what is now answered, by which slice, and what is still open.
9. A report.

Out of scope: forge being active outside the kit; proof; a second language; any change under `bay/`.

## Definition of done

- [DOD-T1-1] (must) Output 1, tests first and seen failing, with literal verdicts, in a project the test makes outside the kit through the test toolbox. The kit's own typescript and git-worktrees tests pass unchanged.
- [DOD-T1-2] (must) Outputs 2 to 4, tests first and seen failing: the literal sentence for a missing required script; `describe`'s literal response in the kit, in a project with every script, and in one with two missing; the optional check absent and present. The made-up toolchains pass the new shared cases, and a new wrong one that reports "passed" for a check the checkout is not set up for fails exactly that case.
- [DOD-T1-3] (must) Output 5: `grep -rn "relative to the kit" components bay tests docs/adr/0023*` pasted with a line on each remaining hit. `tests/shared-tests-in-a-project.test.ts`: the trusted project toolchain now passes every case; the count before and after.
- [DOD-T1-4] (must) Output 6: a test call asking 1,000 is accepted and 1,001 refused with the schema's sentence; the default pinned.
- [DOD-T1-5] (must) Output 7: `diff -r` of the moved fixtures against the originals, empty, pasted; their size; the format and lint checks still pass with them in the tree (say what, if anything, had to be excluded and why).
- [DOD-T1-6] (must) A mode's folder and its interface are all this changes (P-34): nothing under `bay/`, `schemas/` or `adapters/`; `tests/new-mode-isolation.test.ts` passes unchanged; neither debt list grows; the detector count does not rise.
- [DOD-T1-7] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: a missing required script reported as passed; reported as failed; the optional check listed where the script is absent; the optional check dropped in the kit; `describe` lists a missing script as present; practices resolved against the kit in a project; the project's scripts read from the kit's `package.json`; the checked folder is the project and not the copy; 1,001 seconds accepted. Each caught, or a test added.
- [DOD-T1-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13). The time of each new or changed test file alone.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts by rule, detector count.
2. Write the interface's new sentences and fields first, and in the progress note how each caller changes, before code (P-35). Commit the interface.
3. The shared cases with the made-up toolchains. Then the typescript mode. Then the project test with the worktrees mode. Then the fixtures. A commit each.
4. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner, npm inside the test's own small package (no network: the package uses only what `node_modules` of the kit already holds, linked as the worktrees interface's `copy` allows).

## Resources

`components/base/typescript/` (manifest, scripts, tests, README), `components/base/interfaces/toolchain/` (schemas, `tests/shared.ts`), `components/base/git-worktrees/` and `components/base/interfaces/worktrees/`, `tests/made-up-toolchains.ts` and its test, `tests/shared-tests-in-a-project.test.ts`, `tests/test-toolbox.ts`, `tests/kit-copy.ts`, `/home/claude/m5-capture/fixtures/` (read only).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: "not set up for" is a reason of an inconclusive verdict, in the type. P-11 replace and delete. P-12 one place: the list of agreed scripts, required or optional. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if the decision cannot be built without a change under `bay/`, stop and report what capability is missing (P-34). P-28: the sentences are read by a project's owner. P-29, P-30.
- TypeScript: `components/base/typescript/practices.md`.
- Inconclusive is never a pass. A check the mode could not run is never reported as passed or failed.
- The mode's commands run the project's scripts, which is unconfined code the project's owner wrote; the README already says so. Do not add a sentence that suggests otherwise.
- Write scope: `components/base/typescript/`, `components/base/interfaces/toolchain/`, the git-worktrees mode's tests only (not its scripts), `tests/made-up-toolchains*`, `tests/shared-tests-in-a-project.test.ts`, a new project test, `tests/fixtures/`, the two notes. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/interfaces/proof/`, `tests/made-up-proofs*`, `bay/runs/` and the workflow schema. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/t1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/t1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with every new sentence; each DOD item with pasted output; the bug-injection table; what P1 needs to know; which open questions of the interface remain; what you did not do; what you did not verify.
