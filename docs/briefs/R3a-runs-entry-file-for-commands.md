# Brief R3a: the runs entry file, used by the kernel and the commands

Slice for one builder. Words are used as `CONTEXT.md` defines them.

## Input

- Branch `r3a/runs-entry`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010` (the decision), `docs/adr/0006`, `docs/adr/0009`, `CONTEXT.md`.
- `docs/designs/runs/B-common-caller.md`: sections 1 and 2 are the interface and its use. Where ADR 0010 differs, the ADR wins: `submit` takes the token and the submission only (no `at`); the run report stays in the command line.
- `docs/designs/runs/C-seams.md` section 0: the seams.
- `framework/features.yaml`, `framework/feature-map-debt.yaml`.

## Output

1. `bay/runs/runs.ts`: the entry file. It exports `openRuns`, `Runs`, `RunsNeeds`, `Run`, `RunSummary` and `Task`, as design B section 1 gives them, built over the existing engine and store.
2. `bay/kernel.ts` opens runs with one call. It no longer builds a store, a runner and an engine in order.
3. The commands `call`, `approve`, `resume`, `runs` and `submit`, and `bay/run-report.ts`, use only `Runs` and `Run`. They import no other runs file.
4. `framework/features.yaml` names `bay/runs/runs.ts` as the entry of runs. `bay/runs/engine.ts` becomes private.
5. A report.

The agent tools (`bay/tools.ts`, `bay/mcp-server.ts`) keep working exactly as today. Moving them to `Runs.task`, `Runs.submit` and `Runs.callAction` is slice R3b; in this slice those three methods exist and are tested, and the tools may keep reaching the engine through whatever `Runs` or the kernel still hands them, recorded as debt. Tests stay where they are; moving them to the entry file is R4.

## Definition of done

- [DOD-R3a-1] (must) The entry file's exported names are the six above and no others. The report pastes its exports.
- [DOD-R3a-2] (must) `Run` is typed by status as design B gives it: a done run has `output`, a failed one `reason`, a waiting one says what it waits for. No caller reads a field of a run through `Json` or a cast.
- [DOD-R3a-3] (must) Each method of `Runs` has a test in `tests/runs.test.ts` that imports only `bay/runs/runs.ts` (plus fixtures) and asserts what a caller observes. Each test was seen failing first against a method that returns the wrong thing.
- [DOD-R3a-4] (must) Every ordering rule that callers had to follow is now inside runs and has a test: the token decision around `resume`; the store opened before the runner; a submitter never receiving another step's token.
- [DOD-R3a-5] (must) After the change, `git grep "runs/" -- bay/kernel.ts bay/commands bay/run-report.ts bay/command-context.ts` shows imports of `runs/runs.ts` only.
- [DOD-R3a-6] (must) The debt file is regenerated. No entry is added. Every entry whose `from` is the kernel, a command or the run report and whose `to` is a runs file is gone. The report gives the counts before and after by rule and explains each difference.
- [DOD-R3a-7] (must) Code the old wiring alone used is deleted: helpers in the commands and run report that read store records, built step keys, or decided about tokens. The report lists deletions with line counts.
- [DOD-R3a-8] (must) The kernel line count (14,272 at the start) does not rise by more than the size of `bay/runs/runs.ts` minus what was deleted, and the report gives the arithmetic. If the total rises, say by how much and why it could not be avoided.
- [DOD-R3a-9] (must) `npm run check` passes. What every `bay` command prints is unchanged: the existing command tests pass without edits to their assertions. Any assertion you had to edit is listed with the reason.
- [DOD-R3a-10] (must_not) No second way to do the same thing is left for callers in scope: no command reaches the engine or the store directly.
- [DOD-R3a-11] (should) Where design B's signatures cannot be met as written, keep the smaller interface and say what you changed and why.

## Instructions

1. Run `npm run check`; record test count, line count and debt by rule.
2. Write `tests/runs.test.ts` for `openRuns`, `start` and `show` first, failing. Add the entry file to pass them. Continue one method at a time: test, then code.
3. Move `bay/kernel.ts` to `openRuns`. Then one command at a time, running that command's tests after each.
4. Move `bay/run-report.ts` to take a `Run`. Delete what it no longer needs.
5. Update the map. Regenerate the debt file and read its diff.
6. Inject at least 15 bugs, one at a time, across the entry file and the moved callers. Record what caught each. Add a test for any survivor.
7. Run `npm run check`. Commit. Write the report.

## Tools

`npm run check` and its parts, `node --test <file>`, `git` (commit only), `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts`.

## Resources

`bay/runs/engine.ts`, `bay/runs/run-state.ts`, `bay/runs/waiting.ts`, `bay/runs/task-tokens.ts`, `bay/kernel.ts`, `bay/commands/*.ts`, `bay/run-report.ts`, `tests/engine-fixture.ts`, `tests/cli-*.test.ts`.

## Rules and constraints

- Replace and delete, never layer. When a caller moves to `Runs`, what it used before stops being exported if nothing else uses it.
- The interface is the test surface: `tests/runs.test.ts` imports the entry file only.
- Readability before line counts; never pack lines. Code standards: no `any`, no `as` except `as const`, no `!`, no enum, no inheritance, named exports, at most three parameters, complexity 10, problems as values (`Outcome<T>`), no comments.
- Small commits: the entry file with its tests; the kernel; each command; the run report; the map and debt. A change to `bay/contracts.ts` goes in its own commit, listed first in the report.
- Formatting uses the project's configuration (`npm run format:check`); never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report, in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited or deleted and why; deletions with line counts; the bug-injection table; where you departed from design B; ways the interface can still be got around; what you did not do; what you did not verify.
