# Brief R4a: runs counts its own tool calls, and the mode harness uses runs

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `r4a/runs-ordering`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010`, `framework/practices.md`, `CONTEXT.md`, `bay/runs/runs.ts`.
- The report of slice R3b found two faults this slice fixes:
  1. `Runs.submit` and `Runs.callAction` count and record a tool call only if the caller asked `Runs.task` first. A caller can skip the tool-call limit by not asking.
  2. `tests/mode-harness.ts` builds its own engine from private runs files, because it starts an action as a calling mode and `Runs.start` has no caller.

## Output

1. Every tool call that reaches runs with a task token is counted against the round's limit and recorded, whichever method it comes through. No caller has to do anything first.
2. `tests/mode-harness.ts` and `tests/tools.test.ts` import no private runs file. The harness starts actions through `Runs` only.
3. A report.

`Runs` gains no member and no parameter that lets a holder start an action as another mode. Moving the engine's own tests is R4b and R4c.

## Definition of done

- [DOD-R4a-1] (must) A test in `tests/runs.test.ts`, written first and seen failing: a round with a limit of N tool calls refuses call N+1 when the calls are `callAction` made without `task` before them. The same for a mix of `task` and `callAction`. `submit` is never refused by the limit.
- [DOD-R4a-2] (must) Each tool call is recorded exactly once: a test counts the `tool.called` events after a read tool, a `call_action` and a `submit` made through `bay/tools.ts`, and finds three.
- [DOD-R4a-3] (must) `bay/tools.ts` contains no code that exists to keep the count right. The report names what was deleted.
- [DOD-R4a-4] (must) The mode harness reaches a called action the way a mode does in production: through an action whose `run` has a `call` step, in a fixture mode, started with `Runs.start`. The report shows the fixture.
- [DOD-R4a-5] (must) `git grep "runs/" -- tests/mode-harness.ts tests/tools.test.ts components` shows imports of `runs/runs.ts` only. The three assertions in `tests/tools.test.ts` that read a run's limit, a step's spend and the caller from the store are rewritten to assert what `Run` shows, or deleted if a test at the entry file already covers them; the report says which and names the covering test.
- [DOD-R4a-6] (must) What every agent tool returns is unchanged, and what every `bay` command prints is unchanged.
- [DOD-R4a-7] (must) The kernel line count (14,522 at the start) does not rise. The report gives both numbers and deletions per file (P-11, P-13).
- [DOD-R4a-8] (must) The same thing in more than one place (P-12): the report lists every block or rule this slice touched that also exists elsewhere, and what was done. The copy-paste detector count for non-test TypeScript (21 at the start) does not rise.
- [DOD-R4a-9] (must) `npm run check` passes. The debt file does not grow.
- [DOD-R4a-10] (must) Proven on the real thing (P-19): in a fresh project under `/tmp`, run `bay check`, `bay build`, `feed-briefing.sync`, then `feed-briefing.digest` with a hand-written submission through `bay call --tool`; paste the commands and output; delete the project.

## Instructions

1. Run `npm run check`; record test count, line count, debt and detector counts.
2. Write the failing tests for DOD-R4a-1 and DOD-R4a-2. Move the counting inside runs. Delete what `bay/tools.ts` no longer needs.
3. Write the fixture mode. Move the harness to `Runs.start`. Run every test that uses the harness.
4. Rewrite or delete the three store-reading assertions.
5. Inject at least 10 bugs, one at a time. Record what caught each. Add a test for any survivor, or prove no test can catch it.
6. Run the real-thing walk. Run `npm run check`. Commit. Write the report.

## Tools

`npm run check` and its parts, `node --test <file>`, `./bay.sh`, `git` (commit only), `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console`.

## Resources

`bay/runs/runs.ts`, `bay/tools.ts`, `tests/mode-harness.ts`, `tests/tools.test.ts`, `tests/bindings-per-requirer.test.ts`, `tests/kernel-fixture.ts`, `components/modes/feed-briefing/tests/feed-briefing.test.ts`.

## Rules and constraints

- P-01 no comments. P-02 code standards. P-04 readable before short. P-11 replace and delete. P-15 the interface is the test surface. P-17 test first, seen failing. P-25: if you must change course, stop and report.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited or deleted and why; deletions with line counts; the same thing in more than one place; the bug-injection table; ways the rule can still be got around; what you did not do; what you did not verify.
