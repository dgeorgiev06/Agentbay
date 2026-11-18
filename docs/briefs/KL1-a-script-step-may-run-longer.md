# Brief KL1: a script step may run longer than eight minutes when its action says so, and a toolchain call may then ask for up to 1,000 seconds

A capability slice in runs and the broker, then the one interface sentence it makes true. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `kl1/longer-steps`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0003`, `0005`, `0013` (budgets: every run has limits, and minutes are one of them), `0019`, `0022`, `0023` ("with it, in the same slice": a test call may ask for up to 1,000 seconds; this slice is where that becomes possible), `docs/designs/operations/0-frame.md` (the properties; none may weaken), `docs/research/2026-11-17-suite-time.md` (the kit's suite takes about 450 seconds alone and more beside another run).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Today: `maximumScriptMilliseconds = 8 * 60_000` in `bay/runs/action-steps.ts`, and `timeLimitOf` caps every script step there whatever the run's budget. The broker gives a step's commands and database calls a limit equal to the script's own (`bay/broker/script-runner.ts`), over defaults of ten minutes (`step-broker.ts`); a command's asked limit is cut to that (`command-operations.ts`). When the script's limit passes, the kernel stops the whole script and the run fails: the script cannot answer "inconclusive". `toolchain@1`'s request schemas allow a time limit of at most 420 seconds, which leaves a script about a minute of its eight. Slice T1 found this and stopped.

## Output

1. **An action may say how long one of its script steps may run**, in its manifest, in whole seconds, above today's eight minutes and at most a ceiling the kernel fixes (1,800 seconds). With nothing said, a script step is stopped at eight minutes exactly as today. The schema's sentence says what the limit is, what happens when it passes, and that the run's budget of minutes still applies. Decide where it is written (on the step, or on the action for all its script steps) from how `run:` steps are written today, and say why.
2. **The limit is still a limit.** A value above the ceiling, zero, negative or not a whole number is a problem when the project loads, with a sentence. A step is stopped when its limit passes, as today, and what the owner reads says which limit it was and where it was declared.
3. **The budget is not bypassed.** A run whose budget of minutes is smaller than a step's declared limit is still stopped by the budget; a nested call draws from the same budget (ADR 13). Test both. If today's code lets a long step outrun a smaller budget, that is a finding: fix it only if it is one place in runs, else report it.
4. **Commands inside a step get what is left.** A command may run until the step's limit, less what the step has already used, and no longer; its asked limit is cut to that, and a command stopped by its limit still returns to the script as stopped, so the script can answer (for a toolchain: an inconclusive verdict) before its own limit. Say how much margin the kernel keeps for the script to answer and why, and test that a toolchain-like script whose command hits its limit returns its own answer and the run is done, not failed.
5. **`bay check` shows the owner each long step**: a warning per action that declares a limit above eight minutes, with the mode, the action and the seconds, since a long unattended step is something an owner should see. Base modes included.
6. **`toolchain@1`**: the request schemas' maximum for `check` and `test` rises to 1,000 seconds, with the sentence saying why a suite may need it; the typescript mode's `check` and `test` actions declare the limit they need for that (the ceiling plus the margin of output 4, in one place). The shared test's time-limit cases still pass; add one that a call asking 1,000 is accepted and 1,001 refused. If slice T1 has not merged when you start, do this output on top of what is on the branch; if T1 changed the same files, the reviewer merges.
7. `CONTEXT.md` if a word is added. The open-questions note of the toolchain interface updated: question 9 and the ceiling.
8. A report.

Out of scope: the default of eight minutes; skill steps; a host kept alive across steps; unattended runs.

## Definition of done

- [DOD-KL1-1] (must) Outputs 1 and 2, tests first and seen failing, with literal sentences: a step declaring 900 runs past eight minutes on the test's clock and is stopped at 900; nothing declared is stopped at 480 as today (the existing test unchanged); 1,801, 0, -5 and 2.5 each refused at load.
- [DOD-KL1-2] (must) Output 3: the two tests, with what the run's end says.
- [DOD-KL1-3] (must) Output 4, tests first and seen failing: the limit a command is given at the start of a step and after the step has used half its time; a command asking more is cut; a script whose command is stopped answers and the run is done; a script that itself overruns is stopped and the run fails with the sentence. Use the test clock and made-up processes the runner's tests already use; no test waits real minutes.
- [DOD-KL1-4] (must) Output 5: the literal warning; `bay check` on the kit shows it for the typescript mode's two actions and nothing else new (the warnings before and after, diffed).
- [DOD-KL1-5] (must) Output 6: the schema lines; the shared test's new case; the typescript mode's tests pass; one real run, on a quiet machine, of `typescript.test` on a throwaway copy of the kit made by the worktrees mode, with the limit 1,000, giving a passed verdict: the command, the time it took and the verdict pasted. This is the first time the kit's own suite is judged through its toolchain; if it does not pass, report what stood in the way and do not paper over it.
- [DOD-KL1-6] (must) Nothing else changes: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), differs only by the new warnings in the kit's check; every differing file named.
- [DOD-KL1-7] (must) Boundaries: runs, manifests and broker stay sealed; the mode schema gains one field and no new file; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise.
- [DOD-KL1-8] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository: the declared limit is ignored; a limit above the ceiling loads; an undeclared step runs past eight minutes; the budget no longer stops a long step; a command gets the whole step limit after half is used; a command's asked limit is not cut; a stopped command fails the run; the warning is missing; 1,001 seconds accepted by the interface. Each caught, or a test added.
- [DOD-KL1-9] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count with its command.
2. Read how a script step's limit, the run's budget and the broker's limits meet today, from the runs entry down to the script runner. Write in the progress note the one type for a step's limit and where each number is decided, before code (P-35). One place decides a step's limit; the broker is handed it.
3. The manifest field and load problems. Then the step limit. Then commands and what is left. Then the warning. Then the interface and the typescript mode. A commit each, tests first.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. The real run of output 6. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under your own scratch folder.

## Resources

`bay/runs/action-steps.ts` (`maximumScriptMilliseconds`, `timeLimitOf`), `bay/runs/` budget handling, `bay/broker/script-runner.ts`, `step-broker.ts`, `command-operations.ts`, `schemas/mode.schema.json` and generated types, `bay/manifests/` where a mode's actions are checked, `bay/check.ts` and the check feature, `components/base/interfaces/toolchain/`, `components/base/typescript/`, `tests/script-runner.test.ts`, the runs tests on time limits and budgets.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: a limit is a type, not a bare number passed around. P-11 replace and delete. P-12 one place: the default, the ceiling and the margin are each named once. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if a property of the frame must bend, stop and report. P-28: the sentences are read by the owner and a mode's author. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- Fail closed: a limit that cannot be read is a load problem, never "no limit". No step is ever without a limit.
- Write scope: `bay/runs/`, `bay/broker/script-runner.ts`, `step-broker.ts`, `command-operations.ts`, `schemas/mode.schema.json` and generated types, the place in `bay/manifests/` that checks an action, the check feature for one warning, `components/base/interfaces/toolchain/` request schemas and shared test, `components/base/typescript/mode.yaml` and its tests, tests, the feature map, the note. Anything else is named at the top of the report with its reason.
- Other builders may be working in different worktrees on `components/base/typescript/` scripts and the toolchain shared test (slice T1), and on `bay/run-report.ts` and `bay/commands/approve.ts`. Keep changes to files T1 also changes to the fewest lines.
- Keep every scratch file of yours under one new folder, `/tmp/kl1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/kl1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with every new sentence; each DOD item with pasted output; the bug-injection table; what P1 needs to know (the limit its own actions should declare, and what a proof script sees when a toolchain call runs out of time); what you did not do; what you did not verify.
