# Brief D2: discovery is live on the tool server too

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `d2/discovery-live`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0012`: the registry answers at the moment of the call.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- What slice D1 left, from its report and the reviewer's check:
  1. The tool `actions` on the tool server answers from the system as it was when the server started. `bay actions` and `bay call --tool actions` reload on every call. A mode added during a session is missing from the tool until the server restarts.
  2. `bay actions` is the thirteenth command and `framework/limits.yaml` has `cli_commands: 12`, so `bay check` on the kit now prints a warning.
  3. Nothing tests that a step's agent cannot use `actions`. The tool takes no token, so only the step guard and the agent's tool list keep a step's agent from mapping the project.
  4. A YAML `description:` with nothing after it is refused with "must be text, but it is empty." and does not say what to write.

## Output

1. The tool `actions` on the tool server reads the registry at each call. Its handler is given one thing: a function that loads the system. It is given no broker, no runs, no secret store and no file port of its own.
2. `cli_commands` in `framework/limits.yaml` is 13, with the reason on the same line of the file that records ceilings and their reasons if one exists, or in the report if none does. `bay check` on the kit prints no warning for it.
3. A step's agent cannot use `actions`: the agent file's tool list does not hold it unless the skill's Tools section lists it, and the step guard denies it otherwise.
4. An empty `description:` gets the same sentence as a missing one, saying what to write.
5. A report.

## Definition of done

- [DOD-D2-1] (must) A test, written first and seen failing: a tool server is started on a project; a mode folder is added to the project; the next `actions` call to the same server lists the new mode. The same for a mode that is removed.
- [DOD-D2-2] (must) The handler's signature is shown in the report. A test shows that when loading fails (a broken `mode.yaml` added during the session) the tool answers with the load problems as a refusal and the server keeps serving; the next call after the file is fixed answers again.
- [DOD-D2-3] (must) The other six tools are unchanged: they still use the system loaded when the server started, and a test shows a step in progress is not disturbed by a mode added during the session.
- [DOD-D2-4] (must) `bay check` on the kit prints no `cli_commands` warning. The tests that slice D1 changed to expect that warning (`tests/kit-check.test.ts`, `tests/cli-project.test.ts`) go back to what they asserted before D1, and the report shows the diff against the commit before D1 for those assertions. `tests/cli-commands-measure.test.ts` still shows the measure fires when the ceiling is lowered.
- [DOD-D2-5] (must) Tests in `adapters/claude-code/tests/`: for a skill whose Tools section does not list `actions`, the agent file's tools do not include it and the guard's decision for that step on the tool is deny; for a skill that lists it, both allow it. Written first; if the first already passes, the report says so and shows the mutation that makes it fail.
- [DOD-D2-6] (must) A test in `tests/check.test.ts`: `description:` with nothing after it gives one finding on the right line whose fix says what to write, in the same words as for a missing description.
- [DOD-D2-7] (must) The same thing in more than one place (P-12): loading the system for the tool uses the function `bay actions` already uses. The report names it and its callers.
- [DOD-D2-8] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy, each test run with a time limit. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-D2-9] (must) `npm run check` passes. Neither debt list grows. The copy-paste detector count for non-test TypeScript (15 at the start) does not rise. Size before and after is reported and never targeted (P-13).
- [DOD-D2-10] (must) Proven on the real thing (P-19): in a fresh project under `/tmp` with the feed-briefing config, start the tool server (`node <kit>/bay/mcp.ts --project <project>`) and speak to it over its standard input as a client does: initialize, list tools, call `actions`. Add a mode folder. Call `actions` again on the same server. Paste the messages sent and received. Stop the server. Delete the project.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count, both debt counts and the detector count.
2. Write the test for DOD-D2-1, failing. Give the handler the loader.
3. Raise the ceiling. Put the two tests back.
4. Write the adapter tests for DOD-D2-5.
5. Write the test for DOD-D2-6, failing. Fix the wording.
6. Inject the bugs in a copy. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The commit before D1, for DOD-D2-4: `git log --oneline --grep "Brief D1"` gives it.

## Resources

`bay/tools.ts`, `bay/mcp.ts`, `bay/mcp-server.ts`, `bay/kernel.ts`, `bay/registry.ts`, `bay/commands/actions.ts`, `bay/spec.ts`, `framework/limits.yaml`, `bay/check-limits.ts`, `adapters/claude-code/agent-file.ts`, `adapters/claude-code/guard-decide.ts`, `tests/mcp.test.ts`, `tests/actions-tool.test.ts`, `tests/kit-check.test.ts`, `tests/cli-project.test.ts`, `tests/check.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-08 features meet at entry files. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-30 plain prose in every sentence an owner reads.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Run long commands in the foreground and wait for them. Leave nothing running in the background; a server you start for a test or the walk is stopped before you go on.
- The session you run in can be stopped without warning. Commit each finished step as you go.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited and why; the same thing in more than one place; the bug-injection table; ways the token-free tool could still be misused; what you did not do; what you did not verify.
