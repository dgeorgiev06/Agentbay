# Brief G1: a script of a base mode may run a command its mode lists

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `g1/script-commands`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0015` (the decision; this is its slice G1), `docs/adr/0002`, `docs/adr/0003`, `docs/adr/0005`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/forge/C-seams.md` and `docs/designs/forge/A-smallest.md`, each on its kernel addition K1.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `CONTEXT.md`.
- Today: a mode may list `resources.commands`, described as command prefixes its skill steps may run. Only a mode under the kit's `components/base/` may list any. An agent gets them only when its actions declare all five effects. A script cannot run a command at all: it runs in a confined child process with no process spawning, and the toolbox offers none.

## Output

1. The toolbox gives a script `context.commands.run(request)`. The request has a command as a list of arguments (the program first), a working folder, and a time limit. The answer has the exit code, whether the time limit was hit, and the ends of what the command wrote to its standard output and standard error.
2. The kernel runs the command, outside the script's confined process. It is run as an argument list, with no shell. Its environment holds `PATH` and nothing else from the kernel's own environment.
3. The command is allowed only when all of these hold; otherwise it is refused with a sentence that says what to change and where:
   - the script's mode lists a prefix in `resources.commands` that the argument list starts with, compared argument by argument;
   - the action being run declares all five effects, by the same rule that already decides whether an agent gets commands;
   - the working folder is inside the project, or inside the kit when the project is the kit, and is not inside `.agentbay/`.
4. What the command wrote is scrubbed of known secrets and cut to a fixed size before the script sees it. The arguments are scrubbed before they are recorded.
5. Each command that is run, and each that is refused, is recorded as an event of the run: the arguments as scrubbed, the working folder, the exit code or the refusal, how long it took, and a hash of the full output.
6. The schema's description of `resources.commands` says what is now true: prefixes that the mode's scripts and skill steps may run.
7. A report.

Out of scope: any mode that uses it (G2 and G3); changing what agents are given; removing the agents' commands or `adapters/claude-code/guard-commands.ts`; a shell, pipes, standard input, or environment variables chosen by the script.

## Definition of done

- [DOD-G1-1] (must) A test mode in the tests' fixtures, under a kit's `components/base/`, lists the prefix `node --version` and has an action that declares all five effects and a script that runs `node --version` and returns the answer. A test at the runs entry file, written first and seen failing: the run is done and the answer has exit code 0 and output that starts with `v`.
- [DOD-G1-2] (must) Tests, each written first and seen failing, each asserting the literal refusal sentence: a command no prefix matches; a prefix that matches only as text and not argument by argument (the mode lists `git status`, the script runs `git statusx`, and separately `git` with the single argument `status --porcelain`); an action that lacks one of the five effects; a working folder outside the project; a working folder inside `.agentbay/`; a mode outside `components/base/` (which today cannot list commands at all: the test shows the load still refuses it).
- [DOD-G1-3] (must) A test that the command runs without a shell: an argument such as `; echo injected` or `$(echo injected)` reaches the program as that literal text. Use a program that prints its arguments.
- [DOD-G1-4] (must) A test of the time limit: a command that sleeps past it is stopped, the answer says the limit was hit, the script gets the answer and the run goes on. No process is left running; the test checks the process is gone.
- [DOD-G1-5] (must) A test of the environment: with a made-up variable and a made-up secret set in the kernel's environment, a command that prints its environment shows `PATH` and neither of them.
- [DOD-G1-6] (must) A test of scrubbing: a command that prints a secret the mode declares gives the script the redacted form, and the event holds the redacted form. A script that passes that secret as an argument has it redacted in the event.
- [DOD-G1-7] (must) A test of the size limit: a command that writes more than the limit gives the script the end of the output, cut at the limit, and says it was cut. The event's hash is of the full output.
- [DOD-G1-8] (must) A test of the events: one for a command that ran, one for a command that was refused, with the fields in Output 5 as literal values where they are fixed.
- [DOD-G1-9] (must) The rule that decides whether a command is allowed is in the one place that already decides effects and commands (`bay/effect-rule.ts`), and the operation is in its table of operations. A test shows that a new operation kind missing from the table does not compile or does not pass, as the existing tests show for the others; the report says which.
- [DOD-G1-10] (must) The same thing in more than one place (P-12): matching an argument list against a listed prefix happens in one function, used here and by whatever decides an agent's commands today if that code matches prefixes too; the report says what it found and what it did. Running a child process with a time limit uses the port the kernel already has for that; the report names it.
- [DOD-G1-11] (must) Boundaries: neither debt list grows. The new code is where the feature map says each part belongs (the rule in safety, the operation in broker, the toolbox function in scripts). The report lists each new or changed file with its feature.
- [DOD-G1-12] (must) What every existing `bay` command prints is unchanged, and what an agent is given is unchanged: the capture script at `/home/claude/m5-capture/capture.sh`, run on the starting commit and on your final commit, gives outputs with an empty `diff -r`; and the agent files built for the feed-briefing project are the same before and after. The report pastes the commands and results.
- [DOD-G1-13] (must) Bug injection (P-18, P-31): at least 15 bugs, one at a time, in a throwaway copy, each test run with a time limit, with each result saved to a file as you go. Include: the prefix is matched as text; the effects check is skipped; the command is run through a shell; the working folder check is skipped; the output is not scrubbed; the event is not written for a refusal. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-G1-14] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start. Size before and after is reported per file and never targeted (P-13).
- [DOD-G1-15] (must) Proven on the real thing (P-19): in a throwaway copy of the kit under `/tmp` (so that a base mode can be added), add a small base mode whose script runs `git status --porcelain` in the project, with an action that declares all five effects. Run `bay check`, then `bay call` for the action, then `bay runs <id> --events`. Then change the script to run `git log` and show the refusal. Paste commands and output. Delete the copy.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo; build the feed-briefing project's agent files and keep them too.
2. Write the test for DOD-G1-1, failing. Add the operation to the rule's table, the broker operation, the toolbox function and the path from the script's process to the kernel. Commit.
3. Take the refusals of DOD-G1-2 one at a time, each test first. Commit after each group.
4. No shell, the time limit, the environment, scrubbing, the size limit, the events: each test first. Commit after each.
5. Update the schema's description and regenerate the types. Regenerate the debt lists and read the diff.
6. Inject the bugs in a copy. Run the capture and diff it. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `npm run generate` regenerates `bay/generated/`; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy: `git archive <commit> | tar -x -C <new folder under /tmp>`, then link `node_modules` into it, and `git init` it if a script needs git.
- The capture: `/home/claude/m5-capture/capture.sh <kit folder> <output folder>`; read the script first. It needs a kit folder that is a git repository. Write your outputs under `/tmp/g1-capture/`.

## Resources

`bay/effect-rule.ts`, `bay/policy.ts`, `bay/broker.ts`, `bay/sdk.ts`, `bay/script-host.ts`, `bay/script-runner.ts`, `bay/script-protocol.ts`, `bay/script-preload.ts`, `bay/ports.ts`, `bay/node-ports.ts`, `bay/secrets.ts`, `bay/build.ts`, `adapters/claude-code/guard-commands.ts`, `schemas/mode.schema.json`, `tests/broker-fixture.ts`, `tests/runs-fixture.ts`, `tests/broker-effects.test.ts`, `tests/effects.test.ts`, `tests/script-runner.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: a command that ran and a command that was refused are different shapes. P-06 parse at the edge: the request from the script's process is checked once. P-08 features meet at entry files where they exist; add no boundary break. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-30 plain prose in every sentence an owner reads.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Security comes first in this slice. Where the brief leaves a choice, take the one that lets a command do less. Never build a command line as one string. Never pass the kernel's environment through.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/g1-progress.md` saying what is done, what is next, and each decision you made, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited and why; the same thing in more than one place; the bug-injection table; ways a script could still run something it should not, or learn something it should not, through a command; what you did not do; what you did not verify.
