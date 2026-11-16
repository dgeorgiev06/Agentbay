# Brief G2: the toolchain interface, and the TypeScript setup as the first mode that serves it

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `g2/toolchain`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0015` (the decision; this is its slice G2), `docs/adr/0012` (every action has a description), `docs/adr/0003`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/forge/C-seams.md` and `docs/designs/forge/A-smallest.md`, each on the toolchain interface and the TypeScript mode.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slice G1 (merged): a script of a base mode may run a command its mode lists, through `context.commands.run`, when its action declares all five effects. See `docs/briefs/G1-scripts-run-listed-commands.md` and `tests/script-commands.test.ts`.
- Today: `components/base/typescript/` is a folder of configuration (`eslint.config.js`, `prettier.json`, `knip.json`) with `practices.md` and a `README.md`. It is not a mode. The kit is checked by `npm run check`, whose parts are scripts in `package.json`: `generate:check`, `typecheck`, `lint`, `format:check`, `deadcode`, `test`.
- The reviewer's bug injection on G1 found one thing no test pins: a listed prefix is matched exactly, including the case of each argument.

## Output

1. An interface `toolchain@1` in `components/base/interfaces/`, with three actions, each with a description, an input schema and an output schema:
   - `describe`: the language's name, which files are its source and which are its tests (as patterns), the path of its practices file, and the names of the checks it has.
   - `check`: given a folder that holds a checkout of the code, run the language's static checks there and return one verdict per check: its name, `passed`, `failed` or `inconclusive`, how long it took, and the end of its output. Given a list of check names, run only those.
   - `test`: given a folder, and optionally a list of test files, run the tests there and return a verdict, the counts of tests that passed and failed, the names of the tests that failed, how long it took, and the end of the output.
2. `components/base/typescript/` is a mode named `typescript` that implements `toolchain@1`. Its configuration files and `practices.md` stay where they are. It lists exactly the commands it runs.
3. One definition of each check (P-12): the mode runs the same thing `npm run check` runs. The report says how that is achieved and shows there is one place to change a check.
4. A verdict is `inconclusive`, never `passed`, when a check could not be run, timed out, or ended in a way the mode does not recognise.
5. A test that a listed command prefix is matched exactly, case included.
6. A report.

Scope of this slice: the folder given is a checkout of the kit, or of a project that is the kit. Checking the modes of a project that sits beside the kit is not in this slice; the report says what it would need. Out of scope: bug injection and size measures (G5); a Go mode; forge; changing what `npm run check` does.

## Definition of done

- [DOD-G2-1] (must) `bay check` on the kit passes with the `typescript` mode and the interface present, with no new warning. `bay actions typescript` lists the three actions with their descriptions. The report pastes both.
- [DOD-G2-2] (must) Tests of `describe`, written first and seen failing, with literal expected values.
- [DOD-G2-3] (must) Tests of `check`, each written first and seen failing, run against small made-up checkouts built by the test in a temporary folder inside the project (a folder with a `package.json` whose scripts are stand-ins that pass, fail, hang or do not exist): every check passes; one fails, and its verdict is `failed` with the end of its output while the others still run and report; one hangs past its time limit and is `inconclusive`; one cannot be started and is `inconclusive`; a named subset runs only those; an unknown check name is refused with a sentence.
- [DOD-G2-4] (must) Tests of `test`, each written first and seen failing, against made-up checkouts: all pass, with counts; one fails, with its name; named files only; a test run that hangs is `inconclusive`; a run that reports no tests at all is `inconclusive`, not `passed`.
- [DOD-G2-5] (must) One test runs `check` and `test` for real against a throwaway copy of the kit itself placed inside the project, and finds every check `passed`. It may be the slowest test in the suite; the report gives its time. If it would make the suite more than two minutes slower, run the real `test` action on a small named subset of test files instead, and say so.
- [DOD-G2-6] (must) The mode's `resources.commands` lists only what its scripts run, as narrow prefixes. The report lists them and, for each, what it can do beyond its intended use. No prefix is a bare program name.
- [DOD-G2-7] (must) Each action declares the five effects G1 requires for running commands, and the interface allows them. The report says why a read-only `describe` does or does not need them, and takes the smaller grant where it can.
- [DOD-G2-8] (must) A test for Output 5, written first and seen failing against a rule that ignores case: with `git status` listed, `GIT status` and `git STATUS` are refused.
- [DOD-G2-9] (must) `npm run check` still works exactly as before for a person at the command line, and its output for the kit is the same apart from the new tests. The capture script at `/home/claude/m5-capture/capture.sh`, run on the starting commit and on your final commit, differs only where the kit now has a new mode and interface; the report pastes the `diff -r` and explains every line of it.
- [DOD-G2-10] (must) The same thing in more than one place (P-12): the report lists what was shared and what remains in two places and why. `components/base/typescript/README.md` says what is now true or is deleted.
- [DOD-G2-11] (must) Boundaries: neither debt list grows; the feature map lists the new mode under `outside` as the other modes are listed; mode code imports only the toolbox.
- [DOD-G2-12] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy, each test run with a time limit, with each result saved to a file as you go. Include: a failed check is reported as passed; a timed-out check is reported as passed; a run with no tests is reported as passed; a named subset runs everything; the output of a failed check is dropped. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-G2-13] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start. Size before and after is reported per file and never targeted (P-13).
- [DOD-G2-14] (must) Proven on the real thing (P-19): in the worktree, with the kit as the project and `typescript` named in the kit's own config, make a throwaway copy of the kit at a folder inside the project that git ignores, then run `bay call typescript.describe '{}'`, `bay call typescript.check` on that folder, and `bay call typescript.test` on that folder for two named test files. Then break one file in the copy so that the type check fails, and run `check` again. Paste commands and output. Delete the copy.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. The test for DOD-G2-8, failing if the rule ignores case; it should pass on the code as it is. Show it failing against a mutated copy. Commit.
3. The interface: its file and its schemas. Then `describe`: tests first. Commit.
4. `check`: tests first, against made-up checkouts. Commit.
5. `test`: tests first. Commit.
6. The real test of DOD-G2-5. The kit's own config. The README. Commit.
7. Update the feature map. Regenerate the debt lists and read the diff.
8. Inject the bugs in a copy. Run the capture and diff it. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push); `./bay.sh` in the worktree.
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy: `git archive <commit> | tar -x -C <new folder>`, then link `node_modules` into it, and `git init` it if a script needs git.
- The capture: `/home/claude/m5-capture/capture.sh <kit folder> <output folder>`; read the script first. Write your outputs under `/tmp/g2-capture/`.
- A new mode or action can be started with `./bay.sh new`; see `./bay.sh new --help`.

## Resources

`components/base/typescript/`, `components/base/interfaces/items-source.yaml` and its schema folder (an interface to model on), `components/base/store/` (a base mode to model on), `components/modes/fake-source/` (a small mode with scripts and tests), `package.json`, `tsconfig.json`, `agentbay.config.yaml`, `bay/sdk.ts`, `tests/script-commands.test.ts`, `tests/commands-fixture.ts`, `tests/mode-harness.ts`, `framework/features.yaml`, `.gitignore`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: a verdict is one of three values. P-08 mode code imports only the toolbox. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface: test the mode through its actions. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner reads, descriptions included.
- TypeScript: `components/base/typescript/practices.md`.
- Never report `passed` for something that was not run to its end. When unsure, `inconclusive`.
- The commands this mode runs execute code from the checkout it is given. That is their purpose, and it is why the grant must be narrow. Never widen a prefix to make a test easier.
- If the toolbox lacks something a script needs (for example a way to name the command types), say so in the report; add to `bay/sdk.ts` only what this mode needs, in its own commit.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/g2-progress.md` saying what is done, what is next, and each decision you made, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; the interface file and the mode's manifest in full; every test file edited and why; the same thing in more than one place; the bug-injection table; ways a verdict of `passed` could still be wrong; what a project beside the kit would need; what you did not do; what you did not verify.
