# Brief M6: manifests is tested at its entry file, and its one large file is split inside the feature

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `m6/manifests-tests`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0013` (the decision; this is its last slice), `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`, and the brief `docs/briefs/R4c-runs-tests-at-the-entry-file.md` with decision record `0010` (the same step done for the runs feature).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `tests/feature-map.test.ts`, `CONTEXT.md`.
- Today:
  - `tests/spec.test.ts` and `tests/references.test.ts` import private files of the manifests feature. `tests/registry.test.ts`, `tests/registry-bindings.test.ts`, `tests/registry-folders.test.ts`, `tests/registry-grants.test.ts` and `tests/manifests.test.ts` (1,345 lines) test the feature, mostly through the entry.
  - Eight test files build a system by copying one and swapping a field (`{ ...system, config }` and the like): `tests/runs-workflows.test.ts`, `tests/registry-folders.test.ts`, `tests/kernel.test.ts`, `tests/manifests.test.ts`, `tests/registry.test.ts`, `tests/build.test.ts`, `tests/registry-grants.test.ts`, `tests/runs-actions.test.ts`. A system built that way can be one that no load would ever return. The adapter's `adapters/claude-code/tests/build-fixture.ts` writes a `System` out by hand with stub questions.
  - `bay/manifests/manifests.ts` is 1,915 lines: finding folders, reading and validating files, interfaces and bindings, the active set, the grant rule's call, schemas, skills, the three questions, the inspection and the placement.
  - The dead-code check still hides exported functions that their own file calls. Three of the names it hides are in manifests: `isReferenceText`, `parseReference`, `resolveReference` (`bay/manifests/references.ts`), used from outside their file only by `tests/references.test.ts`.

## Output

1. Tests of what a caller of manifests can observe import `bay/manifests/manifests.ts` and fixtures, and nothing else from `bay/manifests/`. The test files are named for what they test, not for a file that no longer exists (`registry`).
2. Tests that need a private seam of manifests live in `tests/inside/manifests/`, with a reason given for each in the report. The expectation is that few or none are needed: reading a file against its schema and resolving a reference are both reachable through `inspectSystem`, a target's `check`, and a workflow target's `resolve`.
3. Every system a test uses comes from `loadSystem` over fake files. No test and no fixture spreads, copies or writes out a `System` or an `ActiveMode`. `tests/feature-map.test.ts` lists manifests among the features whose tests must not reach in.
4. `bay/manifests/manifests.ts` is the entry file and defines the feature's interface. The work behind it is in private files of the folder, each named for the one thing it does. No file in the folder only re-exports. No private file is imported from outside the folder.
5. Nothing in `bay/manifests/` is exported that no kernel file and no file in `tests/inside/manifests/` imports.
6. A report.

This slice changes no behaviour: what every `bay` command prints, and what every question answers, stays the same.

## Definition of done

- [DOD-M6-1] (must) Before any edit, list every `test(` title in the seven test files named in Input. At the end each title is mapped to the test that now carries it, or to a deletion with the name of the test that already asserts the same thing. The mapping is in the report. No title is dropped without a covering test.
- [DOD-M6-2] (must) `git grep -n "bay/manifests/" -- tests adapters ':!tests/inside/manifests'` shows `bay/manifests/manifests.ts` only. The `test_breaks` list in the debt file has no entry whose `to` is a manifests file.
- [DOD-M6-3] (must) `git grep -nE "\.\.\.(kernel\.)?system\b" -- tests adapters` finds nothing, and no test file contains a `System` or `ActiveMode` written out as an object literal. Where a test needed a system that a load would refuse (for example an interface that is not bound), the test now shows that the load refuses it, and the report lists each such test with what it asserts now.
- [DOD-M6-4] (must) A new check in `tests/feature-map.test.ts`, written first with made-up files and seen failing: no file under `bay/manifests/` other than the entry is imported from outside the folder, and the entry file contains no `export ... from` line. Then the same check for `bay/runs/`.
- [DOD-M6-5] (must) The split: the report lists each file of `bay/manifests/` with its line count, the one thing it does in a sentence, and what it imports from the others. The private files import one another in one direction, with no cycle; the report shows the order. `bay/manifests/manifests.ts` holds the exported types and the exported functions, each of which may hand its work to a private file.
- [DOD-M6-6] (must) The split is a move, not a rewrite. A script kept outside the repo, given in the report, checks that every function body in the new files is the same text as in the old file, apart from imports and the word `export` (P-24). Its output is pasted.
- [DOD-M6-7] (must) `isReferenceText`, `parseReference` and `resolveReference` are not exported. The report says how many names the dead-code setting still hides and names them.
- [DOD-M6-8] (must) Output unchanged: the capture script from slice M5 at `/home/claude/m5-capture/capture.sh` is run on the starting commit and on your final commit, and `diff -r` of the two is empty. The report pastes the commands and the result.
- [DOD-M6-9] (must) Bug injection (P-18, P-31): at least 20 bugs, one at a time, in a throwaway copy, each test run with a time limit, with each result saved to a file as you go, spread across every private file of the folder. Each is caught by a test at the entry file, or a test is added there, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-M6-10] (must) `npm run check` passes. Both debt lists are regenerated and no entry is added; the report gives counts by rule before and after and explains each difference. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start. Size before and after is reported per file and never targeted (P-13).
- [DOD-M6-11] (must_not) No kernel file outside `bay/manifests/` changes, except an import path if a type moved, which should not be needed.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, the detector count, and the list of test titles for DOD-M6-1. Run the capture script on the starting commit and keep its output outside the repo.
2. Write the new feature-map check with made-up files, failing. Point it at the kit; it will fail until step 5.
3. Fixtures first: make the shared fixtures load systems from fake files. Then one test file at a time: replace each copied or hand-written system. Run that file after each. Commit after each file.
4. Move the tests of `spec` and `references` to the entry file, or to `tests/inside/manifests/` with a reason. Rename the `registry*` test files. Commit.
5. Split `bay/manifests/manifests.ts` by moving functions, one concern per commit, running typecheck and the manifests tests after each. Run the body-comparison script.
6. Stop exporting what nothing needs. Run both dead-code checks.
7. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Run the capture and diff it. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` and `git mv` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`; per file: `wc -l bay/manifests/*.ts`.
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy: `git archive <commit> | tar -x -C <new folder under /tmp>`, then link `node_modules` into it, and `git init` it if a script needs git.
- The capture: `/home/claude/m5-capture/capture.sh <kit folder> <output folder>`; read the script first. It needs a kit folder that is a git repository.

## Resources

`bay/manifests/manifests.ts`, `bay/manifests/spec.ts`, `bay/manifests/references.ts`, `tests/manifests.test.ts`, `tests/registry*.test.ts`, `tests/spec.test.ts`, `tests/references.test.ts`, `tests/system-fixture.ts`, `tests/runs-fixture.ts`, `tests/broker-fixture.ts`, `adapters/claude-code/tests/build-fixture.ts`, `tests/fakes.ts`, `tests/feature-map.test.ts`, `components/base/typescript/knip.json`.

## Rules and constraints

- P-01 no comments. P-04 readable before short: a private file is split off because it does one thing, not to reach a size. P-08 features meet at entry files. P-11 replace and delete, never layer. P-12 one place. P-13 size is reported, never targeted. P-15 the interface is the test surface. P-16 literal expected values. P-24 moves and comparisons are scripts. P-25: if you must change course, stop and report.
- TypeScript: `components/base/typescript/practices.md`, TS-12 in particular: a file exports what it defines.
- Edit `framework/features.yaml` only to list the manifests feature's files.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/m6-progress.md` saying what is done, what is next, and each decision you made, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; the title mapping; the file table for the split; every test file moved, edited or deleted and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; ways a test could still build a system by hand; what you did not do; what you did not verify.
