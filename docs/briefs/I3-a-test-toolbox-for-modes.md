# Brief I3: a mode's tests use a test toolbox that does not hand out the kernel

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `i3/test-toolbox`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (this is its slice I3), `docs/research/2026-11-16-boundary-audit.md` (change 8), `docs/adr/0006`, `0009`, `0010`, `0011`, `0018`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `tests/feature-map.test.ts`, `CONTEXT.md`.
- The audit's finding: a mode's source imports only the toolbox, but every mode's tests import `tests/mode-harness.ts`, which imports nine kernel files and hands out the `Kernel`. Tests of two modes then call `project.kernel.runs` directly (`components/modes/feed-briefing/tests/feed-briefing.test.ts`, `components/base/git-worktrees/tests/cut.test.ts`). The feature-map test does not look at what a mode's tests import, so nothing holds this in place. A mode's tests are therefore bound to the kernel's inside, and a change to the runs feature can break a mode's tests.

## Output

1. One file is the test toolbox for modes: what a mode's test may import from the kit, and nothing else. It is the counterpart of `bay/sdk.ts` for tests. It offers what mode tests need, stated as a mode's author would use it: open a project with these modes and bindings and settings; call an action and get its output, its refusal or its failure; start a workflow and see where the run stands; answer a skill step as the agent would; approve; extend a budget; list runs; read a run's events; read a mode's own database through the same rule a script would; close. It does not hand out the kernel, the runs feature, the broker or any port.
2. Every mode's tests use only the test toolbox. No mode test reaches `project.kernel` or imports another kit test helper. What the five call sites named above did is offered by the toolbox in terms of runs as the glossary defines them.
3. The feature map states the rule and `tests/feature-map.test.ts` enforces it: a file under a mode's `tests/` folder may import the test toolbox, the toolbox, and files of its own mode, and nothing else. A test, written first and seen failing, shows a mode test that imports another kit test helper, a kernel file, or another mode being reported.
4. The test toolbox's surface is pinned by a test, in the same way slice B2 pins the toolbox if B2 has merged by then; if it has not, pin it with a literal list of its exported names and say so.
5. Where the test toolbox lives and what it is called are for you to choose and argue in the report: it must be obvious to a mode's author, it must not be under `bay/` unless the feature map gives it a feature of its own, and a project beside the kit (`docs/adr/0018`) must be able to use it for its own modes' tests.
6. A report.

Out of scope: what the kernel's own tests import; the kernel under `bay/`; any change to what a mode does.

## Definition of done

- [DOD-I3-1] (must) Output 1: the file, its exported names and signatures pasted, and for each a sentence on which mode test needs it. `grep -n "^import" <the file>` pasted. It exports no type that names the kernel, the runs entry, the broker or a port.
- [DOD-I3-2] (must) Output 2: `grep -rn "\.kernel\b" components` finds nothing. `grep -rhn "tests/" components --include=*.ts | grep import` is pasted with every hit being the test toolbox or the mode's own file.
- [DOD-I3-3] (must) No mode test's assertions change. The report lists each mode test file edited and that only how it reaches the kit changed. Each mode's tests pass, with the count per mode before and after.
- [DOD-I3-4] (must) Output 3, with the three reported cases pasted, and the kit passing the new rule with no debt entry for it. If a mode test cannot meet the rule without a real loss, it gets a debt entry and the report says what the loss would be; none is expected.
- [DOD-I3-5] (must) Output 4.
- [DOD-I3-6] (must) A made-up mode proves the point: in a throwaway copy, add a small mode with one script action and a test that uses only the test toolbox; change nothing else; `npm run check` passes there. Pasted with `git status --short`.
- [DOD-I3-7] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a mode test imports `bay/kernel.ts`; a mode test imports another mode's file; the test toolbox exports the kernel again; `call` returns a refusal as an output; the database read skips the rule. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-I3-8] (must) Boundaries: neither debt list grows, and the report says what shrank; the copy-paste detector count does not rise above your starting measure.
- [DOD-I3-9] (must) `npm run check` passes. The capture script, run on the starting commit and on your final commit, differs only in the kit's own moved or changed test files; every differing file is named and explained. Size before and after is reported and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, the detector count, and the test count per mode.
2. List every use a mode test makes of `tests/mode-harness.ts` and of `project.kernel`, grouped by what the test is trying to do. Write the list in the progress note. Design the test toolbox's surface from that list, smallest first (P-35), and write it in the progress note before writing code.
3. The feature-map rule, test first. Then the test toolbox. Then each mode's tests, one commit per mode.
4. Delete what the old harness no longer needs to offer (P-11); if the kernel's own tests still use parts of it, say which and leave those.
5. Regenerate the debt lists and read the diff. Inject the bugs in a copy. The made-up mode. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/i3-capture/`. Run a copy of the capture script with a scratch folder of your own.

## Resources

`tests/mode-harness.ts`, `tests/kernel-fixture.ts`, `tests/project-fixture.ts`, every `components/*/*/tests/`, `tests/feature-map.test.ts`, `framework/features.yaml`, `bay/sdk.ts`, `bay/kernel.ts`, `bay/runs/runs.ts` (the entry: what a run is and what can be asked of it).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: the test toolbox, `tests/mode-harness.ts`, the modes' `tests/` folders, `tests/feature-map.test.ts`, `framework/features.yaml`. No file under `bay/` unless the report shows the test toolbox cannot be written without it; then the smallest change, named at the top of the report.
- Another builder is working in a different worktree on `bay/sdk.ts`, `bay/broker/`, `bay/contracts.ts`, `bay/ports.ts` and their tests. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/i3-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; where the test toolbox lives and why; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
