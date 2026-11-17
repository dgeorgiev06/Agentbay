# Brief S1: a shared test for `toolchain@1`

Mode slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `s1/toolchain-shared-test`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` and `0018`, `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md` (Toolchain, Verdict, Shared test, Test toolbox).
- Slice I4 (merged), which is the model to follow: `components/base/interfaces/items-store/tests/shared.ts` (the shared test of `items-store@1`), how the store mode runs it (`components/base/store/tests/items-store.test.ts`), the rule that allows it (`framework/features.yaml` under `interfaces`, `bay/check-imports.ts`), and how a made-up implementation proved it (`tests/new-mode-isolation.test.ts`, `tests/made-up-modes.ts`). Read `docs/briefs/I4-a-new-mode-adds-only-its-folder-and-an-interface-has-one-test.md` for the reasoning.
- `components/base/interfaces/toolchain.yaml` and its schemas; the typescript mode (`components/base/typescript/`) and its tests. Forge will call `toolchain@1` to judge a builder's work, and a second language will be a second mode behind it, so what the interface means has to be stated once, for any language.
- What I4's builder proposed the shared test would state: describe names `checks` in order, and check returns one verdict per check asked, in that order; a checkout with a deliberate failure gives `failed` and a clean one `passed`; a run with no tests, or one that runs out of time, is `inconclusive` and never passes; `testFiles` lies within `sourceFiles`. Treat this as a starting list, not the answer.

## Output

1. `components/base/interfaces/toolchain/tests/shared.ts`: what any mode that implements `toolchain@1` must do, through the interface's three actions only, using only the test toolbox. It names no language. What differs by language is given to it by the mode's test: at least the mode's name, and how to make a small checkout that passes every check, one that fails a named check, one whose tests fail, one with no tests, and one whose check or tests do not end. You choose the form of that argument and argue it in the report; a second implementer must be able to supply it without reading the typescript mode.
2. The statements it holds, each with literal expected values and each resting on a named place in the interface (a schema, a description, the glossary's definition of Verdict). At least: what `describe` promises; that `check` gives one verdict per check, in the order `describe` gives, and only the checks asked when some are named; that an unknown check name is refused and nothing runs; that a verdict is `failed` only when the check ran to its end and found something, and `inconclusive` whenever it could not be run to its end, and never `passed` in either case; the same for `test`, with counts and the names of failed tests; that a run with no tests is `inconclusive`; that the time taken is reported; that nothing is written into the checkout that the checkout's own tools did not write.
3. The typescript mode runs the shared test from its own tests. Its tests that state the interface's meaning move into the shared test; tests of how this mode does it (npm, exit codes, TAP, the kit's own scripts) stay in the mode. Nothing the typescript mode's tests held is lost.
4. A made-up second implementation proves the shared test is about the interface: a small toolchain for a made-up language, written by a test in the way I4 did it (its "checks" can be trivial programs the mode lists as commands, if a made-up base mode can be written by a test; if the rule that only base modes list commands makes that impossible inside a test, say so and give the nearest honest proof), passes the shared test; a deliberately wrong one, which reports `passed` for a check that did not end, fails it.
5. A report, which also states plainly anything the interface leaves undefined that a second language would trip on (for example what a check name may be, whether order matters, what "the end of the output" promises), as questions for the owner. Do not change the interface.

## Definition of done

- [DOD-S1-1] (must) The shared test's cases listed, each with the place in the interface it rests on.
- [DOD-S1-2] (must) A table of the typescript mode's tests: moved to the shared test, or stays and why. The mode's test count before and after, with nothing lost.
- [DOD-S1-3] (must) `bay check` on the kit passes: the typescript mode imports its interface's shared test. In a throwaway copy with that import removed, the finding is pasted.
- [DOD-S1-4] (must) Output 4: the made-up toolchain passes; the wrong one fails with the case that caught it, pasted.
- [DOD-S1-5] (must) Bug injection (P-18, P-31) in the typescript mode, at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go, run against the shared test alone. Include: a failed check reported as passed; a check that timed out reported as passed; a check that could not start reported as failed; a run with no tests reported as passed; a named subset runs every check; verdicts returned in a different order; an unknown check name ignored; failed test names dropped. Each is caught by the shared test, or a case is added, or the report says why it belongs to the mode's own tests.
- [DOD-S1-6] (must) Write scope held: `git diff --stat` shows only `components/base/interfaces/toolchain/tests/`, `components/base/typescript/tests/`, and the tests that prove Output 4. No file under `bay/`. The interface's signatures and schemas are unchanged.
- [DOD-S1-7] (must) Neither debt list grows; the copy-paste detector count does not rise above your starting measure. `npm run check` passes. The suite's time before and after is reported; if the shared test adds more than a minute, say where the time goes.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, both debt counts by rule, the detector count, and the typescript mode's test count.
2. Read the interface, its schemas and the typescript mode's tests. Write in the progress note what the interface means, as a list of statements, and which existing test holds each. Decide the form of what a mode's test gives the shared test, and write it down before code (P-35).
3. The shared test, with the typescript mode running it. Move the tests. A commit.
4. The made-up implementations. A commit.
5. Inject the bugs in a copy. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools". No capture is needed for this slice.

## Resources

`components/base/interfaces/toolchain.yaml` and `toolchain/`, `components/base/typescript/` (read its scripts; change only its tests), `components/base/interfaces/items-store/tests/shared.ts`, `tests/test-toolbox.ts`, `tests/made-up-modes.ts`, `tests/new-mode-isolation.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete: a statement about the interface is tested in one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose. P-34: this is a mode slice. If it seems to need a change under `bay/`, stop and say what capability is missing; do not add it. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- The typescript mode's scripts do not change. If the shared test shows the mode does not do what its interface says, stop on that point and report it.
- Another builder is working in a different worktree on `bay/broker/` and its tests. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/s1-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the form of what a mode gives the shared test and why; each DOD item with pasted command output as evidence; the bug-injection table; the questions for the owner; what you did not do; what you did not verify.
