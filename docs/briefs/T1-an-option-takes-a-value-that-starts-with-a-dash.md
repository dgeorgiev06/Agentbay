# Brief T1: a task token that starts with a dash is refused by the command line

Small capability slice in the kernel's command-line feature, for one builder. Words are used as `CONTEXT.md` defines them.

## Input

- Branch `t1/dash-values`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`.
- What was seen: under load, `tests/cli-runs.test.ts` ("submit takes the output and the task's token…") once failed with `The option --token needs a value.` (`bay/command-line.ts:85`). A task token is `randomBytes(...).toString("base64url")` (`bay/runs/task-tokens.ts:43`), and that alphabet includes `-`. The guess, not yet verified: about one token in 64 starts with a dash, and the command line then takes it for an option. If so, an agent submitting a step's output fails about one time in 64 through no fault of its own.

## Output

1. The cause, shown: a test that fails every time on the code as it is, not one time in 64. If the guess is wrong, stop and report what the cause is instead.
2. The fix, in the place where it holds for every option that takes a value and for every value the kernel itself hands out. The report says which of these it chose and why, and what each would have cost: the command line accepts a value that starts with a dash for an option that needs one; or the kernel never hands out a token that starts with a dash; or both.
3. Whatever is chosen, an owner who forgets a value still gets a sentence that says so: `bay submit --token --json` must not silently take `--json` as the token and then fail somewhere worse. The report shows the sentence for that case before and after.
4. A report.

## Definition of done

- [DOD-T1-1] (must) Output 1: the test, written first, pasted failing on the starting commit.
- [DOD-T1-2] (must) Tests with literal expected values for: a token that starts with one dash; with two dashes; a value that is exactly `-`; the forgotten value of Output 3; an option given twice. Each written first and seen failing where it is new behaviour.
- [DOD-T1-3] (must) If tokens change form, every place a token's form is assumed is listed (tests, the adapter's guard, the agent files) and a stored run made before the change still accepts its token, or the report says why none can exist.
- [DOD-T1-4] (must) Write scope: `bay/command-line.ts`, `bay/runs/task-tokens.ts` if needed, and tests. `git diff --stat` shows nothing else, or each other file is explained.
- [DOD-T1-5] (must) Bug injection (P-18, P-31): at least 5 bugs, one at a time, in a throwaway copy with time limits. Each is caught or a test is added. The working tree is clean at the end.
- [DOD-T1-6] (must) Neither debt list grows. The capture script, run on the starting and final commits, shows no difference, or each difference is explained. `npm run check` passes; run it three times in all and report each result, since the fault was intermittent.

## Instructions

1. Run `npm run check` before any edit, in the foreground. Record the test count and both debt counts.
2. Reproduce: Output 1. Commit the failing test only with the fix, never alone.
3. Decide per Output 2, write the tests, then the fix. Commit.
4. Bug injection in a copy. Capture and diff. The three runs of the check. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/t1-capture/`.

## Resources

`bay/command-line.ts`, `bay/commands/` (how options are declared), `bay/runs/task-tokens.ts`, `tests/cli-runs.test.ts`, `tests/command-line.test.ts` if it exists, `adapters/claude-code/step-guard.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-30 plain prose in every sentence an owner reads.
- Another builder is working in a different worktree on `bay/manifests/`, the modes' manifests and schema files. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- Commit after every step that passes typecheck and its tests, and keep `/tmp/t1-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report in plain English and short sentences: the cause; the choice and what the others would have cost; each DOD item with pasted output; what you did not verify.
