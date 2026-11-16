# Brief M3: the manifests entry file, and a system that answers questions

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `m3/manifests-entry`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0013` (the decision; this is its slice M3), `docs/adr/0010` and the briefs `docs/briefs/R3a-*.md` and `docs/briefs/R3b-*.md` (the same step done for the runs feature), `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/manifests/B-common-caller.md` sections 1 and 2, and `docs/designs/manifests/A-smallest.md` section 1, for how `system.action`, `system.workflow` and `system.listing` are used.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `CONTEXT.md`.
- Today: `bay/manifests/registry.ts` is the entry and exports 18 names. Other features also import `bay/manifests/targets.ts` (runs), `bay/manifests/spec.ts` and `bay/manifests/references.ts`. A `System` is a data structure (`modes`, `active`, `inactive`, `config`) that callers pick apart: they look a mode up in a map, check it is active, and resolve `mode.action` and `interface.action` with five functions from `targets.ts` and `servingMode`.

## Output

1. `bay/manifests/manifests.ts` is the feature's entry file. `bay/manifests/registry.ts` becomes private.
2. A `System` answers three questions, and callers stop working the answers out:
   - `system.action(reference, caller?)`: the action a name reaches. `mode.action` names it directly; with a caller, a bare name is the caller's own action and `interface.action` follows the caller's binding. It refuses, with a sentence, a mode that does not exist, a mode that is not active, an action that does not exist, an interface the caller does not require, and an interface that is not bound.
   - `system.workflow(mode, path)`: a workflow of an active mode.
   - `system.listing(question)`: what `bay actions` and the tool `actions` show.
3. `bay/manifests/targets.ts` is deleted. `servingMode`, `actionsListing`, `inactiveModeWording` and the five resolving functions are no longer exported; what they did is reached through the three questions.
4. Every other feature imports `bay/manifests/manifests.ts` for what this slice covers: loading a system, the `System` and `ActiveMode` types, the three questions, the binding uses that `bay config` shows. Imports of `bay/manifests/spec.ts` and `bay/manifests/references.ts` by other features stay as they are: they are slice M4. Imports of the folder-finding functions by check and scaffold stay as they are, re-pointed at whichever file holds them: they are slice M5.
5. A report.

Out of scope: schemas and `resolve` on targets (M4); `inspectSystem` and `placeToWrite` (M5); moving the feature's own tests (M6).

## Definition of done

- [DOD-M3-1] (must) The report pastes the entry file's exports. Each is used by another feature; the report names one caller for each.
- [DOD-M3-2] (must) Tests of the three questions in `tests/manifests.test.ts`, importing only the entry file and fixtures, each written first and seen failing against a question that answers wrongly. For `system.action`: each form of name, and each refusal named in Output 2, with its literal sentence. For `system.workflow`: found, mode unknown, mode not active, file missing. For `system.listing`: the cases `tests/actions-listing.test.ts` has, moved here; that file is deleted and the report maps each of its test titles to the test that now carries it.
- [DOD-M3-3] (must) The sentences an owner reads are unchanged. The existing tests of `bay call`, `bay actions`, the tools and runs pass without edits to their assertions. Any edited assertion is listed with the reason.
- [DOD-M3-4] (must) `git grep -n "manifests/" -- bay adapters ':!bay/manifests'` shows imports of `manifests/manifests.ts`, `manifests/spec.ts` and `manifests/references.ts` only, and of no other file in the folder. `bay/manifests/targets.ts` does not exist.
- [DOD-M3-5] (must) No caller outside `bay/manifests/` reads `system.modes`, `system.active` or `system.inactive` to decide whether a mode may be used, or resolves a reference by hand. The report gives the `git grep` for each of the three field names outside the folder and explains every line that remains (for example a caller that lists the active modes).
- [DOD-M3-6] (must) `framework/features.yaml` names `bay/manifests/manifests.ts` as the entry and the other files as private. Both debt lists are regenerated. Every entry whose `to` is `bay/manifests/registry.ts` or `bay/manifests/targets.ts` is gone. Entries whose `to` is `bay/manifests/spec.ts` or `bay/manifests/references.ts` may remain. No entry is added. The report gives counts by rule before and after and explains each difference.
- [DOD-M3-7] (must) The same thing in more than one place (P-12): resolving an action name happens in one function. The report names it and lists the code deleted from runs, agent-tools and command-line that did the same, with line counts.
- [DOD-M3-8] (must) Bug injection (P-18, P-31): at least 15 bugs, one at a time, in a throwaway copy, each test run with a time limit. Include: a caller's binding of another caller is followed; an inactive mode's action is found; a bare name reaches another mode's action. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-M3-9] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript (15 at the start) does not rise. Size before and after is reported per file and never targeted (P-13).
- [DOD-M3-10] (must) Proven on the real thing (P-19): in a fresh project under `/tmp` with the feed-briefing config, run `bay check`, `bay actions feed-briefing`, `bay call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'`, `bay call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}' --json`, then with the task's token `bay call --tool call_action` for `items-store.get` (an interface action, which follows the binding) and `bay call --tool submit` with a digest written by hand. Then `bay call nosuch.action '{}'` and `bay call store.nosuch '{}'`. Paste commands and output, leaving the token out. Delete the project.
- [DOD-M3-11] (must_not) No second way to do the same thing is left: no re-export of a private file from the entry, no function kept beside the question that replaced it.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count per file in `bay/manifests/`, both debt counts by rule, and the detector count.
2. Write `tests/manifests.test.ts` for `system.action`, failing. Add the entry file and the question. Then `system.workflow`, then `system.listing`, each test first.
3. Move runs to the questions; run the runs tests. Then agent-tools, then command-line, then harness and the kernel. One feature per commit.
4. Delete `targets.ts` and what nothing calls. Update the map. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`; per file: `wc -l bay/manifests/*.ts`.
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/manifests/registry.ts`, `bay/manifests/targets.ts`, `bay/runs/engine.ts`, `bay/runs/action-steps.ts`, `bay/runs/workflow-steps.ts`, `bay/runs/waiting.ts`, `bay/runs/runs.ts`, `bay/tools.ts`, `bay/commands/actions.ts`, `bay/commands/call.ts`, `bay/commands/config.ts`, `bay/build.ts`, `bay/kernel.ts`, `tests/actions-listing.test.ts`, `tests/targets.test.ts`, `tests/system-fixture.ts`, `tests/runs-fixture.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-08 features meet at entry files. P-11 replace and delete, never layer. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-30 plain prose: the sentences an owner reads stay as they are.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- You may edit `framework/features.yaml` only as DOD-M3-6 says.
- Run long commands in the foreground and wait for them. Leave nothing running in the background. The session can be stopped without warning: commit each finished step, so the next builder can pick up from your commits.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited or deleted and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; ways a caller can still pick the system apart; what you did not do; what you did not verify.
