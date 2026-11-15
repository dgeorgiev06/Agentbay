# Brief R4c: the runs feature is tested at its entry file

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `r4c/runs-tests`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010`, `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`.
- `framework/practices.md`, and `components/base/typescript/practices.md` (TS-01 to TS-17).
- `framework/features.yaml`, `tests/feature-map.test.ts`.
- These test files import private files of the runs feature today: `tests/budget.test.ts`, `tests/engine-crash.test.ts`, `tests/engine-fixture.ts`, `tests/engine-parts.test.ts`, `tests/engine-workflow.test.ts`, `tests/kernel-db-fixture.ts`, `tests/run-store.test.ts`, `tests/step-key.test.ts`, `tests/task-tokens.test.ts`. `tests/engine.test.ts`, `tests/engine-scrub.test.ts` and `tests/engine-processes.test.ts` reach the engine through `tests/engine-fixture.ts`.

## Output

1. Tests of what a caller of runs can observe import `bay/runs/runs.ts` and fixtures, and nothing else from `bay/runs/`.
2. Tests that need a private seam of runs live in one folder, `tests/inside/runs/`, with the fixtures only they use. These are: the crash tests with the fault injector, the store's own tests (locks, heartbeat, owner-only file, the table's constraints), and the race test's driver.
3. A check, in `tests/feature-map.test.ts`, that fails when a test file outside `tests/inside/<feature>/` imports a private file of that feature, and when a file in `tests/inside/<feature>/` imports a private file of another feature. It applies to every feature; breaks in features other than runs are listed in `framework/feature-map-debt.yaml` under a new key, generated like the first list.
4. Everything in `bay/runs/` that was exported only so a test could import it stops being exported.
5. A report.

Shrinking and merging inside `bay/runs/` is R5. This slice changes no kernel behaviour.

## Definition of done

- [DOD-R4c-1] (must) For each test file listed in Input, the report gives one line: moved to the entry file, moved to `tests/inside/runs/`, or deleted because a named test at the entry file already asserts the same thing. A test is deleted only when the report names the test that covers it.
- [DOD-R4c-2] (must) A test moved to the entry file asserts what a caller observes: the `Run` returned, what a later `show` returns, the events of the run. It does not read the store, a step record or a step key's parts.
- [DOD-R4c-3] (must) Coverage is not lost. Before any edit, list every `test(` title in the files in Input. At the end, each title is mapped to the test that now carries it, or to a deletion with its covering test. The mapping is in the report.
- [DOD-R4c-4] (must) The new check is written first with made-up files and seen failing for each of its two rules, then pointed at the kit. `git grep "bay/runs/" -- tests` outside `tests/inside/runs/` shows `bay/runs/runs.ts` only.
- [DOD-R4c-5] (must) The crash tests keep their 54 crash points. The report gives the count.
- [DOD-R4c-6] (must) Nothing in `bay/runs/` is exported that no kernel file and no file in `tests/inside/runs/` imports. `parseStepKey` and `stepKeyText` are either used by kernel code outside their own file or not exported; the report says which.
- [DOD-R4c-7] (must) The same thing in more than one place (P-12): one fixture opens runs for tests at the entry file; `tests/runs.test.ts` and the moved tests share it. The report lists what was shared and what was left apart and why.
- [DOD-R4c-8] (must) Bug injection shows the tests still bite after the move: at least 15 bugs, one at a time, across `engine.ts`, `action-steps.ts`, `workflow-steps.ts`, `skill-steps.ts`, `walk.ts`, `undo.ts`, `waiting.ts` and `budget.ts`. Each is caught by a test, or a test is added, or the report proves no test can catch it.
- [DOD-R4c-9] (must) `npm run check` passes. The first debt list does not grow. The copy-paste detector count for non-test TypeScript (20 at the start) does not rise. Size before and after is reported and never targeted (P-13).
- [DOD-R4c-10] (must_not) No kernel file changes what it does. The only kernel changes are removing the word `export`, and each is listed.
- [DOD-R4c-11] (must) Proven on the real thing (P-19): in a fresh project under `/tmp`, run `bay check`, `bay build`, `bay call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'`, then `bay call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}' --json` and hand in a digest written by hand with `bay call --tool submit`; paste commands and output, leaving the token out; delete the project.

## Instructions

1. Run `npm run check` before any edit. Record: test count, time, kernel line count, the debt and detector counts, and the list of test titles for DOD-R4c-3.
2. Write the new check with made-up files, failing. Point it at the kit and generate its debt list.
3. Create `tests/inside/runs/`. Move the crash tests, the store tests, the race driver and their fixtures there with `git mv`.
4. Take the remaining files one at a time. For each test: move it to the entry file, or name the test that already covers it and delete it. Run that file after each.
5. Stop exporting what nothing needs. Run both dead-code checks.
6. Inject the bugs. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` and `git mv` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/runs/runs.ts`, `tests/runs.test.ts`, `tests/engine-fixture.ts`, `tests/kernel-db-fixture.ts`, `tests/kernel-fixture.ts`, `tests/feature-map.test.ts`, `components/base/typescript/knip.json`, `package.json` (the test script's file pattern must still find tests in `tests/inside/`).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-24: moves are made with `git mv`, and a rename of many call sites by a script kept outside the repo and named in the report. P-25: if you must change course, stop and report.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say in the report if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; the title mapping; every test file moved, edited or deleted and why; deletions with line counts; the same thing in more than one place; the bug-injection table; ways the new check can still be got around; what you did not do; what you did not verify.
