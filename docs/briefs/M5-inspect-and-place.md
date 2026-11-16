# Brief M5: check inspects through manifests, and scaffold asks where to write

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `m5/inspect-and-place`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0013` (the decision; this is its slice M5), `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/manifests/B-common-caller.md` (`inspectSystem`, `Inspection`, `placeToWrite`, `NewPart`) and `docs/designs/manifests/C-seams.md` (the "survey", and its warning that this side grows with every check).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `CONTEXT.md`, `bay/manifests/manifests.ts`.
- Today the check feature and the scaffold feature reach into manifests like this:
  - `bay/check.ts` imports `loadSystemReport` (entry) and `problemAt` (`spec.ts`).
  - `bay/check-context.ts` imports `findModeFolders`, `findInterfaceFiles` (entry) and `loadSpec`, `Loaded` (`spec.ts`). It finds the mode folders and parses every `mode.yaml` a second time.
  - `bay/check-layout.ts` imports `checkValue`, `Wording` (`spec.ts`).
  - `bay/check-skills.ts` imports `parseSkill`, `Wording` (`spec.ts`), and has its own parser of a skill's Tools section (`entriesOf`, with `listItemPattern` copied from `spec.ts`).
  - `bay/new.ts` imports `ModeFolder`, `findModeFolders`, `ownInterfacesFolder` (entry) and works out for itself where a new mode, action, skill, workflow or interface goes.
- Slice M4's reviewer found a branch in `valueProblems` in `bay/manifests/manifests.ts` (the `invalid` case) that no test reaches, because a schema file that is not JSON stops the load first.

## Output

1. One call in the manifests entry file, `inspectSystem(files, layout)`, gives the check feature everything it needs about what the owner wrote, sound or not: every mode folder found, each with its manifest if it could be read, a way to place a problem at a path inside that manifest with the right file and line, a way to check a value against a schema of that mode, and its skills as parsed, with their Tools entries; the interface files found; and every problem the load found. `loadSystemReport`'s failure is derived from the same inspection, so `bay check` and a load cannot disagree.
2. One call in the manifests entry file, `placeToWrite(files, layout, part)`, tells scaffold where a new mode, a new part of a mode, or a new interface goes, or why it cannot go there.
3. The check feature imports only `bay/manifests/manifests.ts` from manifests. `bay/check-context.ts` no longer finds folders or parses manifests; if nothing is left in it, it is deleted.
4. The scaffold feature imports only `bay/manifests/manifests.ts` from manifests and holds no folder rule of its own.
5. A skill's Tools section is parsed in one place.
6. `findModeFolders`, `findInterfaceFiles`, `ownInterfacesFolder` and `loadSystemReport` are no longer exported if `inspectSystem`, `placeToWrite` and `loadSystem` cover their callers; the report says what the entry exports at the end and why each remains.
7. The unreachable branch named in Input is either deleted, with the reason it cannot be reached, or reached by a test.
8. A report.

Out of scope: moving the feature's own tests and fixtures (M6); any new check; any change to what `bay check` or `bay new` prints.

## Definition of done

- [DOD-M5-1] (must) Before any edit, capture what `bay check` prints, in text and with `--json`, for: the kit itself; a sound project; and a project with one of each kind of problem `bay check` can report (the report lists the kinds, taken from the check feature's code and tests). Capture what `bay new` prints and writes for each thing it can make. At the end the same commands give the same output and the same files, byte for byte apart from temporary paths. The report pastes the commands and the empty diffs. The script that does this is kept outside the repo and given in the report (P-24).
- [DOD-M5-2] (must) Tests of `inspectSystem` and `placeToWrite` in `tests/manifests.test.ts`, importing only the entry file and fixtures, each written first and seen failing: a sound project; a mode whose `mode.yaml` cannot be read; a mode that breaks a schema rule, with the problem placed on the right line; a mode that breaks a grant rule; a skill whose file cannot be read; placing each kind of new part, and each refusal.
- [DOD-M5-3] (must) A test that a load fails exactly when the inspection reports an error: for each fixture used in DOD-M5-2, `loadSystem` gives a system if and only if `inspectSystem` reports no error, and the problems are the same sentences. `tests/check-equals-load.test.ts` still passes without edits to its assertions.
- [DOD-M5-4] (must) `git grep -n "manifests/" -- bay adapters ':!bay/manifests'` shows imports of `manifests/manifests.ts` only. Every kernel entry in the debt file whose `to` is a manifests file is gone.
- [DOD-M5-5] (must) Folders are found and manifests are parsed once per `bay check`. A test counts the reads of one `mode.yaml` during a check, through a file port that records them, and finds one.
- [DOD-M5-6] (must) The same thing in more than one place (P-12): the report lists, with line counts, what was deleted from check and scaffold. `git grep -n "listItemPattern"` finds one definition. The folder rules (where base modes, optional kit modes, project modes and interfaces live) are stated once; the report names the function.
- [DOD-M5-7] (must) The entry file's exports are pasted in the report, each with one caller in another feature. The report says how many names the entry exported at the start of the manifests work (30 used by other features, from four files), and how many now.
- [DOD-M5-8] (must) The check feature's own tests pass without edits to their assertions. Any edited assertion is listed with the reason.
- [DOD-M5-9] (must) Bug injection (P-18, P-31): at least 15 bugs, one at a time, in a throwaway copy, each test run with a time limit, with each result saved to a file as you go. Include: the inspection misses a mode folder; a problem is placed on the wrong line; a load succeeds where the inspection reports an error; a new mode is placed in the kit when the project is not the kit. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-M5-10] (must) `npm run check` passes. Both debt lists are regenerated and no entry is added; the report gives counts by rule before and after and explains each difference. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start. Size before and after is reported per file and never targeted (P-13).
- [DOD-M5-11] (must_not) No second way to do the same thing is left: the check and scaffold features do not read a manifest, a skill file or a schema file themselves, and nothing is re-exported from the entry.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count per file in `bay/manifests/`, `bay/check*.ts` and `bay/new.ts`, both debt counts by rule, and the detector count.
2. Write the capture script for DOD-M5-1 and save the "before" output outside the repo.
3. `inspectSystem`: the tests first, failing; then the code, derived from what the load already does. Commit.
4. Move the check feature to it, one file at a time, running that file's tests and the capture after each. Commit after each.
5. `placeToWrite`: the tests first; the code; move `bay/new.ts`. Commit.
6. One Tools parser. The unreachable branch. Stop exporting what nothing needs. Commit after each.
7. Update the map if needed. Regenerate the debt lists and read the diff.
8. Inject the bugs in a copy. Run the capture and diff it. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`; per file: `wc -l bay/manifests/*.ts bay/check*.ts bay/new.ts`.
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree. `bay new` takes: `new mode <name>`, `new action <mode> <name>`, `new skill <mode> <name>`, `new workflow <mode> <name>`, `new interface <name>`; check `./bay.sh new --help` for the exact forms.

## Resources

`bay/manifests/manifests.ts`, `bay/manifests/spec.ts`, `bay/check.ts`, `bay/check-context.ts`, `bay/check-layout.ts`, `bay/check-skills.ts`, `bay/check-imports.ts`, `bay/check-limits.ts`, `bay/new.ts`, `bay/templates/`, `bay/commands/check.ts`, `bay/commands/new.ts`, `tests/check.test.ts`, `tests/check-equals-load.test.ts`, `tests/kit-check.test.ts`, `tests/new.test.ts`, `tests/manifests.test.ts`, `tests/system-fixture.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: a mode folder whose manifest could not be read is a different case from one that could. P-06 parse at the edge, once. P-08 features meet at entry files. P-11 replace and delete, never layer. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-24 the capture is a script. P-25: if you must change course, stop and report. P-30 plain prose: the sentences an owner reads stay as they are.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Keep the inspection as narrow as the check feature needs today. Add nothing for a check that does not exist yet.
- Edit `framework/features.yaml` only to add, remove or rename a file of the manifests, check or scaffold feature.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/m5-progress.md` saying what is done, what is next, and each decision you made, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited or deleted and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; ways check or scaffold could still read a file for itself; what you did not do; what you did not verify.
