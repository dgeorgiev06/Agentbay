# Brief SP1: the suite's time: measured per file, and the slowest tests share what they each build today

For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `sp1/suite-time`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/practices.md` (P-15 to P-19, P-31), `components/base/typescript/practices.md`, `docs/research/2026-11-17-boundary-audit-after.md` (the suite went from about 6 to 12.5 minutes during the boundary work), `docs/adr/0017`.
- `npm test` runs `node --test` over 1,495 tests and takes about 800 seconds alone on this machine, 900 to 1,050 beside another run. Every review and every builder waits for it at least twice per slice. Known costs, not yet measured per file: tests that copy the whole kit (`tests/kit-copy.ts`), the made-up modes' tests that run a shared test in a fresh project each (`tests/made-up-*.test.ts`, about 35 s each for toolchains), `tests/shared-tests-in-a-project.test.ts` (about 110 s), and each base mode's shared test.
- Nothing about what the tests prove may weaken. This slice changes how long they take and nothing else.

## Output

1. A measurement, kept in the repository as a short note under `docs/research/`: the time of every test file alone (wall time, three runs, median), the twenty slowest with what each spends its time on (copying the kit, opening projects, starting processes, waiting on a time limit), how many files run at once and how many cores the machine has, and the suite's wall time before.
2. A script `npm run test:times` that prints that table from one run, so the next person does not measure by hand. It is the only new command.
3. The suite's wall time alone is at most half of the measured start, or the note says exactly what stands in the way and what was gained. Ways, in the order to try them: share one copied kit among the tests of a file where each test only reads it (never where a test writes into it); share one opened project among cases that already share it in the shared tests' design; run a wrong made-up mode only against the cases it is meant to fail plus one it passes, where the test's claim is "fails only this case" prove that claim still holds some cheaper way or leave it; shorten waits that are real time limits by making the limit a parameter the test sets low, never by removing the wait's assertion; raise the number of files run at once if the machine has idle cores and the tests are isolated enough, with proof they are (run the suite three times with the files in shuffled order).
4. No test is deleted, skipped or marked to run only sometimes. The count of tests after is at least the count before. A test whose setup is now shared still fails for the same injected bug as before (DOD-SP1-3).
5. A report.

## Definition of done

- [DOD-SP1-1] (must) Output 1 and 2: the note and the script; the table pasted in the report.
- [DOD-SP1-2] (must) Output 3: three runs of `npm test` alone before and three after, wall times pasted, on the same machine with nothing else running (check with `pgrep -f "node --test"` first and say what you saw). The median after against the median before.
- [DOD-SP1-3] (must) Nothing was weakened. For every test file whose setup you changed: one bug injected into the code it tests, in a throwaway copy that is a git repository, with the failing tests listed before your change and after it: the same tests fail. At least 12 bugs in all, spread over every changed file, results saved as you go. For the made-up wrong modes: each still fails exactly the cases it failed before.
- [DOD-SP1-4] (must) Isolation holds: the suite passes three times with test files in shuffled order and once with `--test-concurrency=1`; no test depends on another's leftovers; nothing is written outside each test's own temporary folder (compare the kit's tree and `/tmp` entries you own before and after).
- [DOD-SP1-5] (must) Boundaries: neither debt list grows; the detector count does not rise; `tests/new-mode-isolation.test.ts` passes unchanged; a mode's tests still import only what they may.
- [DOD-SP1-6] (must) `npm run check` passes. The time of each of its stages before and after.

## Instructions

1. Check nothing else is running. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time per stage, debt counts by rule, detector count.
2. Measure before you change anything, and write the note's table. Decide from the table, not from this brief's guesses: if the twenty slowest files are not the ones named above, follow the table and say so.
3. One file or one family of files per commit, each with its before and after time and its injected bug.
4. Regenerate the debt lists. `npm run check`. Commit. Report.

## Tools

Shell, git, node 22's test runner and its options (`--test-concurrency`, `--test-shard`, `--test-reporter`); read `node --help` for what this version has before relying on an option.

## Resources

`package.json`, `tests/kit-copy.ts`, `tests/test-toolbox.ts`, `tests/made-up-*.ts` and their tests, `tests/shared-tests-in-a-project.test.ts`, `components/base/interfaces/*/tests/shared.ts`, each base mode's `tests/`, `tests/kit-check.test.ts`, `tests/feature-map.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short: a shared setup must read as plainly as the one it replaces. P-11 replace and delete. P-12 one place: if several files copy the kit the same way, one helper does it. P-15, P-16. P-25: if a faster suite needs a test to prove less, stop and report; do not trade. P-31.
- TypeScript: `components/base/typescript/practices.md`.
- Never share state a test writes. Sharing is for what tests only read.
- Do not change code under `bay/`, `adapters/` or a mode's scripts to make tests faster. If the kernel itself is slow somewhere a test shows (for example a load that reads every file twice), report it with the measurement and leave it.
- Write scope: `tests/`, each mode's `tests/`, the shared tests, `package.json` for the one script, the note. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `adapters/claude-code/` and its tests. Do not edit those; if an adapter test is among the slowest, name it and leave it.
- To stop a run of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list by accident: when you mean the whole suite, use `npm test`. A run that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/sp1-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: the times first; anything beyond the brief; each DOD item with pasted output; the bug table; what still costs the most and what would cut it; what you did not do; what you did not verify.
