# Brief KS1: the kernel compiles each schema once, and the cost of starting a script host is measured and cut where it is safe

Capability slice, kernel speed. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `ks1/kernel-speed`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/research/2026-11-17-suite-time.md`: one run of the suite costs about 870 CPU seconds, and three costs are in the kernel: (1) `checkValue` in `bay/manifests/spec.ts` builds a new validator and compiles the schema on every check, at least 119 CPU seconds a run; (2) a script host process is started per script step, 2,307 a run at about 0.125 CPU seconds each; (3) a database process per step broker, 1,105 a run at about 0.075 each. These cost every real run of every mode the same way, not only tests.
- `docs/adr/0003`, `0005` (the kernel never trusts a mode's code: a script runs in its own confined process), `0013`, `0019`, `docs/designs/operations/0-frame.md` (the security properties; none may weaken).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`.

## Output

1. A schema is compiled once and its validator reused: by the same schema object or by its content, whichever is correct for how schemas reach `checkValue` (say which and why). Every check gives exactly the answer it gave before, problem for problem and in the same order. A schema that changes on disk between two loads in one process is not checked with a stale validator; say how that is held and test it.
2. For the script host and the database process: a measurement first, with a profile of one start, of where the 0.125 and 0.075 seconds go (process start, module loading, type stripping, opening the database, the sandbox's setup). Then only changes that keep every property of the frame: for example loading fewer modules in the host, or not starting a database process for a step that never asks for one. A host kept alive across steps, or shared between modes, is not to be built here: write it up with what it would save and what it would put at risk, and stop.
3. The suite's CPU time and wall time before and after, three runs each, by `npm test` and by `npm run test:times`, in a short addition to the research note.
4. A report.

## Definition of done

- [DOD-KS1-1] (must) Output 1: tests first and seen failing where behaviour is new (the stale schema case; a count of compiles for repeated checks of one schema, taken through a seam the test can read without reaching into a private file). Every existing test of `checkValue` and of manifests passes unchanged.
- [DOD-KS1-2] (must) Same answers: for every schema in `schemas/` and every interface schema in the kit, a table-driven test checks a set of good and bad values with the old and the new path and compares the problems exactly; or, if the old path is deleted (P-11), the literal problems are pinned before the change and unchanged after.
- [DOD-KS1-3] (must) Output 2: the profile pasted; each change with its measured saving per start; a test for each (for example: a step that asks nothing of the database starts no database process, and one that asks does). The properties of the frame listed with how each still holds.
- [DOD-KS1-4] (must) Output 3: before and after, medians, nothing else running (check with `pgrep -f "node --test"` and say what you saw).
- [DOD-KS1-5] (must) Nothing changes for the kit's behaviour: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), shows no difference.
- [DOD-KS1-6] (must) Boundaries: manifests, runs and broker stay sealed; neither debt list grows; the detector count does not rise.
- [DOD-KS1-7] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy that is a git repository: the cache returns another schema's validator; the cache is keyed by a schema's title only; a changed schema is checked with the old validator; problems come back in another order; a step that writes to the database gets none; the host skips a module the sandbox needs. Each caught, or a test added.
- [DOD-KS1-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Check nothing else runs tests. Run `npm run check` before any edit (nohup and poll). Record test count, stage times, kernel line count, debt counts, detector count. Then three `npm test` runs for the before numbers.
2. Output 1 first, alone, measured. Commit. Then the profile for output 2, written into the note before any change. Then each safe change, one per commit, each measured.
3. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner and its `--cpu-prof`; `npm run test:times`.

## Resources

`bay/manifests/spec.ts` and its callers, `bay/broker/script-runner.ts`, `script-protocol.ts`, the script host's entry, `bay/node-ports.ts`, the database port and where a step broker opens it, `tests/script-runner.test.ts`, `docs/research/2026-11-17-suite-time.md`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place: one cache, in the module that owns checking. P-15, P-16. P-17 test first. P-25: if a saving needs a property of the frame to bend, stop and report it with the number; do not trade.
- TypeScript: `components/base/typescript/practices.md`.
- A script still runs in its own confined process, started for it, with write access to nothing but what its mode is granted.
- No module-level state that a test cannot reset or that leaks between two projects loaded in one process; say how the cache is scoped.
- Write scope: `bay/manifests/spec.ts`, the script runner and host, the place a step broker opens its database, their tests, the research note. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `bay/runs/`, `components/base/interfaces/proof/` and tests of their own. Do not edit those. Timed runs need the machine quiet: if other test runs are going, wait, and say so.
- To stop a run of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. A run that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step; keep `/tmp/ks1-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22): the times first; anything beyond the brief; each DOD item with pasted output; the bug table; what a kept-alive host would save and risk; what you did not do; what you did not verify.
