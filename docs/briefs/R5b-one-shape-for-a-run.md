# Brief R5b: one shape for a run, and no repeated blocks inside runs

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `r5b/one-run-shape`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010`, `docs/adr/0009`, `docs/adr/0011`, `framework/practices.md`, `components/base/typescript/practices.md`.
- What the reviewer measured in `bay/runs/` (16 files, 3,818 lines):
  1. A run's state is described twice. `bay/runs/run-state.ts` has `RunView` and `Waiting`, which the engine returns. `bay/runs/runs.ts` has `Run`, which callers get, and code that turns one into the other. The copy-paste detector reports the two unions as the same block.
  2. `bay/runs/workflow-steps.ts` repeats one block of six lines four times (near lines 79, 137, 163 and 190).
  3. `bay/runs/waiting.ts` (near line 35) and `bay/targets.ts` (near line 22) share a block of five lines.
  4. `Engine.startAction` still takes `id` and `caller` options that slice R4a reported as used only by tests that have since moved.
- Slice R3a added `bay/runs/runs.ts` over the existing engine to keep that slice small. That left two layers. This slice removes the doubled state. Whether the `Engine` class and `runs.ts` become one is decided after this slice, from your findings (see DOD-R5b-7).

## Output

1. One type describes a run's state inside runs and at its entry file. The engine produces it; nothing converts between two shapes of the same thing.
2. The repeated block in `bay/runs/workflow-steps.ts` exists once, with a name that says what it does.
3. The block shared by `bay/runs/waiting.ts` and `bay/targets.ts` exists once, in the feature that owns the idea, reached without adding a debt entry.
4. Options and parameters inside runs that nothing but a deleted test used are gone.
5. A report.

No behaviour changes: what `Runs` returns and what every `bay` command prints stay the same.

## Definition of done

- [DOD-R5b-1] (must) `RunView` and `Waiting` are deleted, or `Run`'s state is defined from them in one place with no second union written out. `git grep -n "status: \"done\"; readonly output" -- bay/runs` finds one definition. The report shows the type.
- [DOD-R5b-2] (must) The function or functions that turned one shape into the other are deleted, and the report lists them with line counts. If a part must stay (for example adding the task token), the report says what it adds that the engine does not know.
- [DOD-R5b-3] (must) The tests at the entry file pass without edits to their assertions: `tests/runs*.test.ts`, `tests/cli-*.test.ts`, `tests/tools.test.ts`, `tests/mcp.test.ts`. Any edited assertion is listed with the reason. Tests in `tests/inside/runs/` may change where they named a deleted type.
- [DOD-R5b-4] (must) The copy-paste detector no longer reports the three findings named in Input (the two unions, the four repeats in `workflow-steps.ts`, the block shared with `targets.ts`). The report pastes the detector's findings for `bay/runs/` before and after.
- [DOD-R5b-5] (must) For Input 4: each option removed is named, with the `git grep` that showed no kernel caller. An option a kernel caller uses stays.
- [DOD-R5b-6] (must) Bug injection shows the tests still bite: at least 12 bugs, one at a time, in the code you changed. Each is caught, or a test is added at the entry file, or the report proves no test can catch it.
- [DOD-R5b-7] (must) The deletion test (P-11), applied to each of the 16 files and reported as a table: the file, what would reappear in its callers if it were deleted, and your verdict (keep, merge into a named file, delete). Include a verdict on the `Engine` class against `runs.ts`: what each knows that the other does not, and what one layer would look like. Do not act on the table beyond Outputs 1 to 4.
- [DOD-R5b-8] (must) `npm run check` passes. Neither debt list grows; entries that disappear are named. Size before and after is reported per file and never targeted (P-13).
- [DOD-R5b-9] (must) Proven on the real thing (P-19): in a fresh project under `/tmp`, run `bay check`, `bay build`, `bay call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'`, `bay call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}' --json`, hand in a digest written by hand with `bay call --tool submit`, then `bay runs` and `bay runs <id> --full`. Paste commands and output, leaving the token out. Delete the project.
- [DOD-R5b-10] (must_not) No new exported name in `bay/runs/runs.ts`, and no new file in `bay/runs/` unless it replaces a deleted one.

## Instructions

1. Run `npm run check` before any edit, and wait for it to finish. Record test count, kernel line count per file in `bay/runs/`, both debt counts, and the detector's findings.
2. Read how a `Run` is built today, from the engine's result and from the stored run. Decide the one shape. Write it down in the report before changing code.
3. Change the engine to produce it. Delete the conversion. Run the entry-file tests after each step.
4. Remove the repeated blocks. Remove the unused options.
5. Inject the bugs. Fill in the deletion-test table.
6. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`; per file: `wc -l bay/runs/*.ts`.
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count; findings are listed above it).
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/runs/runs.ts`, `bay/runs/run-state.ts`, `bay/runs/engine.ts`, `bay/runs/waiting.ts`, `bay/runs/workflow-steps.ts`, `bay/runs/action-steps.ts`, `bay/runs/walk.ts`, `bay/targets.ts`, `bay/run-report.ts`, `tests/runs-fixture.ts`, `tests/inside/runs/engine-harness.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types (TS-02). P-08 other features import only the entry file. P-11 replace and delete. P-12 one place. P-13 size is reported, never targeted. P-15 the interface is the test surface. P-17 test first where behaviour is added; this slice adds none. P-25: if you must change course, stop and report.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say in the report if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; the one shape, as code; every test file edited and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; the deletion-test table; what you did not do; what you did not verify.
