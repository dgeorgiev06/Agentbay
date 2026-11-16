# Brief D1: a model can ask the registry what agentbay can do

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `d1/discovery`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0012` (the decision this slice carries out), `docs/adr/0002`, `docs/adr/0006`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Today: a mode has a `description`; an action has none; no command lists actions; the instructions the Claude Code adapter writes say how to run an action and not which exist.

## Output

1. `description` is required on every action in `mode.yaml`: one sentence saying when to use the action. The schema, the generated types, `bay check`, the templates of `bay new mode` and `bay new action`, and the three shipped modes all have it.
2. One function in the manifests feature answers "what can agentbay do" from the loaded system. It is exported from that feature's entry file.
3. The command `bay actions [<mode>] [--find <words>] [--json]`:
   - with no mode, it lists each active mode: name and description;
   - with a mode, it lists that mode's actions: name as `mode.action`, description, effects, and the input schema;
   - `--find` keeps the modes or actions whose name or description holds every given word, whatever the case. It ranks nothing.
4. The kernel tool `actions` on the tool server, and through `bay call --tool actions`, with the same answers as the command with `--json`. It takes no task token.
5. The instructions the Claude Code adapter writes tell the coordinator, in one sentence, to ask `bay actions` when it does not know which action fits. They carry no list of modes or actions.
6. A report.

Out of scope: the Chief of Staff mode; offering each action as a tool of its own; any ranking or matching by the kernel beyond the word filter.

## Definition of done

- [DOD-D1-1] (must) A test, written first and seen failing: `bay check` on a mode whose action has no description reports one problem that names the action, the file and the line, and says what to write. A description that is empty or only spaces is refused the same way.
- [DOD-D1-2] (must) The three shipped modes pass `bay check`. Each action's description is one sentence, says when an owner or a mode would use it, uses the glossary's words, and does not repeat the action's name. The report lists all of them for the reviewer to read.
- [DOD-D1-3] (must) Tests of the function at the manifests entry file, with literal expected values: the list of modes; the actions of one mode; an unknown mode gives a problem that names the modes that exist; a mode that is loaded but not active is not listed; `find` with two words, with mixed case, and with no match.
- [DOD-D1-4] (must) The answer is live: a test loads a system, adds a mode folder to the project, loads again and sees the new mode. Nothing is cached between calls of the command.
- [DOD-D1-5] (must) Tests at the command line: the text form and the `--json` form for no mode, one mode, `--find`, and an unknown mode (exit 1, with the sentence). `bay actions` appears in `bay`'s help.
- [DOD-D1-6] (must) The tool `actions` answers without a token, through the tool server and through `bay call --tool actions`. Every other tool still refuses a call without a token, and a test shows that for each of them by name.
- [DOD-D1-7] (must) The tool and the command return manifest contents only. A test with a mode whose settings hold a made-up secret, and whose store holds an item, shows that neither the secret's text, nor any setting value, nor any stored data appears in any answer. The handler receives the loaded system and nothing else: no broker, no runs, no secret store; the report shows its signature.
- [DOD-D1-8] (must) The adapter's instructions contain the sentence about `bay actions` and contain no mode name and no action name. A test builds a project with two modes and asserts both.
- [DOD-D1-9] (must) The same thing in more than one place (P-12): the command and the tool call the one function; the text form is produced from the same value as the JSON form. The report names the function and its two callers.
- [DOD-D1-10] (must) Boundaries (P-08): neither debt list grows. The new function is in the manifests feature; the command is in command-line; the tool is in agent-tools. If the map needs a line, say which and why; do not edit `framework/features.yaml` beyond adding a new file to its feature.
- [DOD-D1-11] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy of the tree, each test run with a time limit. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-D1-12] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript (15 at the start) does not rise. Size before and after is reported and never targeted (P-13).
- [DOD-D1-13] (must) Proven on the real thing (P-19): in a fresh project under `/tmp` with the feed-briefing config, run `bay check`, `bay actions`, `bay actions feed-briefing`, `bay actions --find digest`, `bay actions store --json`, and `bay call --tool actions '{}'`. Then add a small mode of your own to the project's `components/modes/` and run `bay actions` again without `bay build`. Paste commands and output. Delete the project.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count, both debt counts and the detector count.
2. Write the test for DOD-D1-1, failing. Add `description` to the schema, regenerate the types, make `bay check` report it, write the descriptions of the shipped modes, update the templates.
3. Write the tests for DOD-D1-3 and DOD-D1-4, failing. Write the function.
4. Write the command, test first. Then the tool, test first.
5. Change the adapter's instructions, test first.
6. Inject the bugs in a copy. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `npm run generate` regenerates `bay/generated/`; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`schemas/mode.schema.json`, `bay/generate-types.ts`, `bay/registry.ts`, `bay/check.ts`, `bay/new.ts`, `bay/templates/`, `bay/commands.ts`, `bay/commands/runs.ts` (a command to model on), `bay/tools.ts`, `bay/tool-definitions.ts`, `bay/mcp-server.ts`, `adapters/claude-code/coordinator.ts`, `components/base/store/mode.yaml`, `components/modes/fake-source/mode.yaml`, `components/modes/feed-briefing/mode.yaml`, `tests/cli-fixture.ts`, `tests/tools.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 and P-06: the answer is a typed value, built once. P-08 features meet at entry files. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner reads.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- The kernel drives no model (`docs/adr/0002`): no ranking, no synonyms, no guessing which action a request means.
- Run long commands in the foreground and wait for them. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every description written, in a list; every test file edited and why; the same thing in more than one place; the bug-injection table; ways the token-free tool could be misused; what you did not do; what you did not verify.
