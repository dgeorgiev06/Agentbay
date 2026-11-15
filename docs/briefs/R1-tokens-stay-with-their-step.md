# Brief R1: a task token stays with its step

Slice for one builder. Words are used as `CONTEXT.md` defines them.

## Input

- Branch `r1/task-tokens`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010` (the decision this slice starts), `docs/adr/0009`, `CONTEXT.md`.
- `docs/plans/0022-typescript-port.md`: DOD-1 to DOD-11.

## Output

1. `bay submit` never prints the task token of a step other than the one submitted.
2. `bay submit <json | @file | -> --token <token>`: the run and step arguments are gone. The token names them.
3. A report.

Nothing moves into a folder. No interface is added. That is slices R2 and R3.

## Definition of done

- [DOD-R1-1] (must) A test, written first and seen failing: a workflow with two skill steps in a row; the first step's output is handed in with `bay submit`; the printed result contains no token for the second step, and says how the coordinator gets the second step's task.
- [DOD-R1-2] (must) The same holds for the `submit` agent tool; if a test already shows it, name it.
- [DOD-R1-3] (must) A rejected submission still returns a fresh token for the next round of the same step, through both the command and the tool.
- [DOD-R1-4] (must) `bay submit` refuses, with a sentence, positional run or step arguments, a missing token, an unknown token and a spent token. Each has a test.
- [DOD-R1-5] (must) Everything that printed or documented the old form is changed: usage text, help, the coordinator instructions the adapter writes, agent files, READMEs, templates, tests. `grep` for the old usage finds nothing.
- [DOD-R1-6] (must) `checkTaskTokenFor` and anything else the old form alone used is deleted, with its tests.
- [DOD-R1-7] (must) The kernel line count (`bay/`, generated types excluded; 14,273 at the start) does not rise. The report gives both numbers.
- [DOD-R1-8] (must) `npm run check` passes. The feature-map debt file does not grow.
- [DOD-R1-9] (must_not) No other change to what any command does or prints.

## Instructions

1. Read the inputs. Run `npm run check`; record the test count and line count.
2. Write the failing test for DOD-R1-1. Fix it. Then DOD-R1-4, test first.
3. Delete what the old form alone used. Update every place that showed it.
4. Inject at least 8 bugs, one at a time. Record what caught each. Add a test for any survivor.
5. Run `npm run check`. Commit. Write the report.

## Tools

`npm run check` and its parts, `node --test <file>`, `git` (commit only).

## Resources

`bay/commands/submit.ts`, `bay/run-report.ts` (`engineOutput`), `bay/tools.ts`, `bay/task-tokens.ts`, `adapters/claude-code/coordinator.ts`, `tests/cli-*.test.ts`, `tests/tools.test.ts`, `tests/task-tokens.test.ts`.

## Rules and constraints

- Replace and delete, never layer. No option that keeps the old form working.
- Readability before line counts; never pack lines.
- Code standards: no `any`, no `as` except `as const`, no `!`, no enum, named exports, at most three parameters, complexity 10, problems as values, no comments.
- Small commits. A change to a shared type goes in its own commit, listed first in the report.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report, in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited or deleted and why; deletions with line counts; the bug-injection table; ways the rule can still be got around; what you did not do; what you did not verify.
