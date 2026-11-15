# Brief R3b: the agent tools use the runs interface

Slice for one builder. Words are used as `CONTEXT.md` defines them.

## Input

- Branch `r3b/tools-on-runs`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010`, `docs/adr/0009`, `CONTEXT.md`, `bay/runs/runs.ts` (the entry file from R3a).
- `framework/features.yaml`, `framework/feature-map-debt.yaml`.

## Output

1. `bay/tools.ts` and everything else in the agent-tools feature reach runs only through `Runs.task`, `Runs.submit`, `Runs.callAction` and `Runs.events`.
2. `Runs.agentTools` is deleted. Nothing outside `bay/runs/` can obtain the engine or the store.
3. The logic that R3a left in two places (token lookup, the tool-call limit, recording a tool call, the rules of `call_action`, the token decision after a submission) exists once, inside runs.
4. Tests that used `kernel.runs.agentTools` use `Runs` instead.
5. A report.

Moving the engine's own tests to the entry file is R4. Shrinking inside runs is R5.

## Definition of done

- [DOD-R3b-1] (must) `git grep agentTools` finds nothing in `bay`, `tests`, `adapters` or `components`.
- [DOD-R3b-2] (must) No file outside `bay/runs/` imports a file in `bay/runs/` other than `runs.ts`, except test files that R4 will move; the report lists those test files. The debt file has no entry whose `to` is a private runs file.
- [DOD-R3b-3] (must) The entry file still exports exactly six names. Types used in its signatures that a caller must name are either among the six or already in the shared types; the report says which.
- [DOD-R3b-4] (must) What every agent tool returns is unchanged: `tests/tools.test.ts` and `tests/mcp.test.ts` pass without edits to their assertions, apart from how they obtain the kernel. Any edited assertion is listed with the reason.
- [DOD-R3b-5] (must) For each piece of logic in Output 3, the report names the one place it now lives and the lines deleted from the other.
- [DOD-R3b-6] (must) The kernel line count (14,638 at the start) is lower at the end. The report gives both numbers and deletions per file. If `bay/tools.ts` does not shrink, explain why.
- [DOD-R3b-7] (must) The debt file is regenerated and no entry is added. The report gives counts before and after by rule and explains each difference.
- [DOD-R3b-8] (must) `npm run check` passes.
- [DOD-R3b-9] (must_not) No new member on `Runs` beyond what `task`, `submit`, `callAction` and `events` already offer, unless a tool cannot work without it; then say which tool and why, and keep it as small as possible.

## Instructions

1. Run `npm run check`; record test count, line count and debt by rule.
2. Move one tool at a time onto `Runs`, running `tests/tools.test.ts` after each: the read tools (`db_query`, `files_read`, `files_list`, `files_write`) through `Runs.task`; then `call_action`; then `submit`.
3. Delete what `bay/tools.ts` no longer needs. Move the tests off `agentTools`. Delete `agentTools`.
4. Regenerate the debt file and read its diff.
5. Inject at least 12 bugs, one at a time, across `bay/tools.ts` and the three `Runs` methods. Record what caught each. Add a test for any survivor.
6. Run `npm run check`. Commit. Write the report.

## Tools

`npm run check` and its parts, `node --test <file>`, `git` (commit only), `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts`.

## Resources

`bay/tools.ts`, `bay/tool-definitions.ts`, `bay/skill-tools.ts`, `bay/mcp-server.ts`, `bay/runs/runs.ts`, `tests/tools.test.ts`, `tests/mcp.test.ts`, `tests/mode-harness.ts`.

## Rules and constraints

- Replace and delete, never layer. This slice exists to remove duplication; it must end smaller.
- Readability before line counts; never pack lines. Code standards: no `any`, no `as` except `as const`, no `!`, no enum, no inheritance, named exports, at most three parameters, complexity 10, problems as values, no comments.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report, in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited or deleted and why; deletions with line counts; the bug-injection table; ways the interface can still be got around; what you did not do; what you did not verify.
