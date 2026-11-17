# Brief P1: a shared test runs in the project the mode lives in

Slice for one builder, in tests only. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `p1/shared-tests-in-projects`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/designs/forge/modes-beside-the-kit.md` (item 3 is this slice; items 1 and 2 are not), `docs/adr/0017`, `0018`.
- The four shared tests: `components/base/interfaces/{items-store,toolchain,worktrees,items-source}/tests/shared.ts`, and how each kit mode runs its own. The test toolbox, `tests/test-toolbox.ts`, whose `openModeProject` already takes a `project` option that copies a project's `components/` folder into the project it opens; its own tests use it with a fixture project.
- What slice S3 found: the feed-briefing test `components/modes/feed-briefing/tests/two-briefings.test.ts` writes a mode `fake-two` into a project. `fake-two` implements `items-source@1` and carries a test that imports and calls the shared test, which satisfies `bay check`. Run from that project, the test fails on every case with "modes lists fake-two, which is not a mode of the kit or of the project", because each shared test opens a project made of the kit's modes only. So a mode that lives in a project cannot run the shared test of a kit interface it implements, and the rule that it "runs it" is held by a file that only runs when the mode sits in the kit.

## Output

1. Each of the four shared tests can be run by a mode that lives in a project: the mode's test says which project it lives in, in one small and obvious way that is the same for all four, and the shared test opens that project with the kit's modes it needs beside it. A kit mode's test does not have to say anything new. You choose the form and argue it in the report; a mode's author in a project must be able to copy two or three lines from the kit's examples and have it work.
2. Proof on a real project folder, not a fixture inside a test's own process: a test in the kit's suite makes a project in a temporary folder outside the kit (its own `agentbay.config.yaml`, its own `components/modes/<mode>/`), with one mode for each of two interfaces (`items-source@1` and `items-store@1` are enough; say why if you choose others), each carrying its shared-test file; `bay check` run in that project passes; and each mode's shared-test file, run from that project as its author would run it, passes every case. A mode there that is deliberately wrong fails. The test says how it runs a project's test files, since a project has no `npm test` of the kit's.
3. `fake-two` in the two-briefings test: its shared-test file would now pass where the test writes it. A check of that is added to that test only if it stays fast; otherwise the report says what was run by hand and pastes it.
4. Nothing changes for the kit's own modes: each still passes its shared test with the same cases, counts and expected values.
5. A report, which also says plainly what still does not work for a mode in a project after this slice (the two other items of `modes-beside-the-kit.md`, and anything new you find), without fixing it.

## Definition of done

- [DOD-P1-1] (must) Output 1: the form, with the lines a project mode's test needs, pasted for one interface; the same lines work for all four.
- [DOD-P1-2] (must) Output 2: the test, written first and seen failing with today's message; then passing. The wrong mode's failure pasted. The test's time.
- [DOD-P1-3] (must) Output 3.
- [DOD-P1-4] (must) Output 4: each kit mode's shared-test run before and after, with the same number of cases passing. `git diff` of the four `shared.ts` files shows no case added, removed or changed in what it expects.
- [DOD-P1-5] (must) Write scope held: the four `shared.ts` files, `tests/test-toolbox.ts` and its test, the new test and its helpers under `tests/`, and `two-briefings.test.ts` only for Output 3. No file under `bay/`; if the test toolbox cannot do this without a kernel change, stop and say what is missing (P-34).
- [DOD-P1-6] (must) Bug injection (P-18, P-31): at least 6 bugs, one at a time, in a throwaway copy with time limits and results saved: a shared test ignores the project it is given; the project's mode is opened but the kit's modes it needs are not; a kit mode is opened in place of a project mode of the same name; the project's settings are ignored; the proof test passes when the project mode's shared-test file is never run; the wrong mode is accepted. Each is caught or a test is added.
- [DOD-P1-7] (must) The feature-map rules still hold with no new debt entry: a mode's tests import only the test toolbox, the toolbox, their own mode's files and the shared test of an interface the mode implements. Neither debt list grows; the copy-paste detector count does not rise. `npm run check` passes; the suite's time before and after is reported.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, both debt counts, the detector count.
2. Read the four shared tests and the test toolbox. In the progress note, write the form of Output 1 before code, with what each shared test would do with it (P-35).
3. The proof test of Output 2 first, seen failing. Then the form in the test toolbox and the four shared tests, one commit per shared test.
4. Output 3. Inject the bugs in a copy. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools". No capture is needed.

## Resources

The four `shared.ts` files and the kit modes' tests that run them, `tests/test-toolbox.ts`, `tests/test-toolbox.test.ts`, `tests/kit-copy.ts`, `tests/project-fixture.ts`, `tests/made-up-modes.ts`, `tests/made-up-sources.ts`, `components/modes/feed-briefing/tests/two-briefings.test.ts`, `bay/check-imports.ts` (read only: how a project mode's import of a kit shared test is resolved).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place: the four shared tests open a project the same way, through one function. P-15, P-16, P-17. P-25: if you must change course, stop and report. P-29, P-30. P-34: no kernel change from this slice. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- A type-only import of a shared test counts, to `bay check`, as running it; only a test file that calls the shared test may import it.
- Another builder is working in a different worktree on `bay/`, the manifests, scripts and listed-commands tests of the typescript and git-worktrees modes, and the made-up modes in `tests/made-up-toolchains.ts` and `tests/made-up-worktrees.ts`. Do not edit those files.
- The full check can take more than ten minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests, and keep `/tmp/p1-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the form and why; each DOD item with pasted command output; the bug-injection table; what still does not work for a mode in a project; what you did not do; what you did not verify.
