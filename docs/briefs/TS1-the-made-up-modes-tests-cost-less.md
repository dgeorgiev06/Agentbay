# Brief TS1: the tests of the shared tests cost less, and catch the same bugs

A tooling slice on tests only. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

The suite takes 748 seconds on a quiet two-core machine for 1,861 tests. Four files that test the interfaces' shared tests with made-up modes take 236 seconds alone, a third of it: `tests/made-up-proofs.test.ts` 120 s for 8 tests, `tests/made-up-worktrees.test.ts` 49 s for 3, `tests/made-up-toolchains.test.ts` 42 s for 8, `tests/made-up-sources.test.ts` about 25 s for 2. This slice cuts their time without losing what they show.

## Input

- Your branch, cut from `feat/0022-agentbay5`, in the worktree you are given.
- The four files above and the made-up modes they use (`tests/made-up-*.ts`), the shared tests under `components/base/interfaces/*/tests/shared.ts`, `docs/research/2026-11-17-suite-time.md`, `tests/test-toolbox.ts`.
- `framework/practices.md`, `components/base/typescript/practices.md`.

## What these files are for

Each shows two things about an interface's shared test: a correct made-up mode passes every case, and a made-up mode that is wrong in one way fails the case meant to catch it. The second is a test of the test. Neither needs every wrong variant to run every case.

## Output

1. First, measured and written in the progress note before any change: for each of the four files, where its seconds go (per test, and inside the slowest tests: processes started, projects opened, shared cases run per variant).
2. Then the cuts the measurement supports, in this order of preference, each only where it loses nothing:
   - a wrong variant runs only the case or cases meant to catch it (by the shared test's own way of choosing cases, or a filter added to how these files start it), not the whole shared test;
   - variants that open the same project or copy share one opening where no case writes what another reads;
   - runs that wait for one another only because they were written one after another run side by side, within the machine's two cores.
3. Nothing a shared test checks about a real mode changes: `components/base/interfaces/*/tests/shared.ts` may gain a way to choose cases and nothing else; every real mode's own test file still runs every case.
4. A report.

## Definition of done

- [DOD-1] (must) Before and after, each of the four files alone, three runs, median, on a quiet machine (say what `uptime` showed). Target: the four together under 120 seconds. If the measurement shows the target cannot be met without losing a check, stop at what can be had and say why (P-25).
- [DOD-2] (must) Nothing lost, shown: for every wrong variant, the case that catches it still fails for it, and the test still names that case. For every case the correct made-up mode passed before, it passes now. A table: variant, the case that catches it, before and after.
- [DOD-3] (must) The bugs that these files were written to catch are still caught. Inject in a throwaway copy that is a git repository, one at a time, at least 8: in each interface's shared test, weaken one case so it no longer catches its wrong variant (the file must fail); make a correct made-up mode wrong in a way no variant covers (the file must fail); make the case filter choose nothing (the file must fail, never pass with zero cases run).
- [DOD-4] (must) A run with zero cases is a failure everywhere a filter is used.
- [DOD-5] (must) Verified by `npm run test:affected -- feat/0022-agentbay5` (its tier will be all, since `tests/` changed): run it once at the end, in the foreground of a step of yours with nohup and a log, and paste its result and its test time.
- [DOD-6] (must) Neither debt list grows; the detector count does not rise; nothing under `bay/`, `adapters/` or a mode's folder changes.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-13. P-18, P-31. P-25.
- A test is never deleted to save time unless the report shows another test that holds the same thing, by name.
- No test waits for wall-clock time it does not need; no time limit is shortened to pass under load.
- Report (P-22), short sentences: times first; anything beyond the brief; each DOD item with pasted output; the bug table; what you did not verify; and which other files in the suite have the same shape and what the same cut would save there (`tests/shared-tests-in-a-project.test.ts`, `tests/new-mode-isolation.test.ts`), measured, not built.
