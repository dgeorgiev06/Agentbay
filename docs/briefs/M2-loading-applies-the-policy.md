# Brief M2: loading a system applies the policy, so no one holds an unpoliced system

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `m2/policed-load`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0013` (the decision; this is its slice M2), `docs/adr/0003`, `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/manifests/C-seams.md`, section 0, "Loading and policy"; `docs/designs/manifests/B-common-caller.md`, where it describes `grantsOf`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Today: `bay/policy.ts` (safety) imports `bay/manifests/registry.ts` and `bay/manifests/spec.ts`, and exports `loadPolicedSystem`, `policyFor`, `permissionsFor`, `PolicedSystem`, `PolicedReport`. `PolicyOf` is in `bay/contracts.ts`. The kernel, `bay check`, `bay actions` and the tool server load through `loadPolicedSystem`. `bay/manifests/registry.ts` can also be asked for a system with no policy applied.

## Output

1. Safety's grant rule is a function of plain data: one mode's manifest, where its folder is, and what it needs to know of the layout and of the other modes' folders. It returns that mode's grants, or the problems found, each with the path inside the manifest it is about. It imports no manifests file.
2. Loading a system, in the manifests feature, calls that rule for every active mode. A system is returned only when every manifest, binding and grant is sound. Each active mode in the system carries its grants.
3. Nothing outside the manifests feature can obtain a system that the policy has not passed.
4. `loadPolicedSystem`, `PolicedSystem`, `PolicedReport` and `policyFor` are deleted. `PolicyOf` is deleted from the shared types, and callers read a mode's grants from the system. `permissionsFor` goes too, unless a caller needs the grants of one mode and nothing else, in which case the report says which caller.
5. The feature map says what is now true: manifests may import safety; safety may not import manifests. The feature-map test also scans `schemas/`, and the map lists the type generator under `outside` with the kernel files it may import.
6. A report.

Out of scope: the entry file `bay/manifests/manifests.ts` and the questions a system answers (M3); schemas and reference resolution on targets (M4); `inspectSystem` and `placeToWrite` (M5). In this slice `bay check` keeps getting what it needs from the same report it gets today, with the policy problems in it.

## Definition of done

- [DOD-M2-1] (must) `git grep -n "manifests/" -- bay/policy.ts bay/effect-rule.ts bay/sql-statements.ts` finds nothing. The report pastes the grant rule's signature.
- [DOD-M2-2] (must) `git grep -n "loadPolicedSystem\|PolicedSystem\|PolicedReport\|policyFor\|PolicyOf" -- bay adapters components tests schemas` finds nothing.
- [DOD-M2-3] (must) A test, written first and seen failing, at the manifests feature's entry: for each policy rule that exists today (the report lists them from `bay/policy.ts`), a project that breaks that rule gives no system from the load, and the problem names the file, the line and the fix in the same words as today. The test from slice K9 that compares `bay check` with `bay call` rule by rule still passes without edits to its assertions.
- [DOD-M2-4] (must) A test shows the type of what the load returns cannot be used to reach a mode without grants: every active mode in the returned system has them, and the report shows the type. No function exported from `bay/manifests/` returns a system or a mode that skipped the rule. If `bay check` needs the unsound view, it gets problems and folders, not a system; the report says exactly what it gets.
- [DOD-M2-5] (must) Every former caller of `loadPolicedSystem` uses the one load: `bay/kernel.ts`, `bay/check.ts`, `bay/commands/actions.ts`, `bay/tools.ts`, and the test fixtures. The report lists each with its new call.
- [DOD-M2-6] (must) What every `bay` command prints is unchanged: the command-line tests pass without edits to their assertions. Any edited assertion is listed with the reason.
- [DOD-M2-7] (must) `framework/features.yaml`: safety's `may_import` is `[vocabulary]`; manifests' `may_import` is `[vocabulary, safety]`; the generator is listed under `outside`. `tests/feature-map.test.ts` scans `schemas/` and its own tests show the generator's imports are checked. Both debt lists are regenerated; the report gives counts by rule before and after and explains every entry that appeared or disappeared. No entry is added that is not the same break under a new rule name.
- [DOD-M2-8] (must) The same thing in more than one place (P-12): the grant rule is applied in one place. Where `bay/build.ts`, `bay/runs/` and `bay/tools.ts` worked out a mode's grants or permissions for themselves, they now read them from the system; the report lists what was deleted, with line counts.
- [DOD-M2-9] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy, each test run with a time limit, across the grant rule, the load, and the callers. Include: the load skips the rule for one mode; the load returns a system despite a grant problem; a mode gets another mode's grants. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-M2-10] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript (15 at the start) does not rise. Size before and after is reported per file and never targeted (P-13).
- [DOD-M2-11] (must) Proven on the real thing (P-19): in a fresh project under `/tmp` with the feed-briefing config, run `bay check`, `bay actions`, `bay build`, `bay call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'`. Then break one grant in a mode of the project's own (for example a `files.write` path outside the project) and run `bay check`, `bay call`, `bay actions` and `bay call --tool actions '{}'`: all four refuse with the same sentence. Paste commands and output. Delete the project.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count per file for `bay/policy.ts` and `bay/manifests/*.ts`, both debt counts by rule, and the detector count.
2. List the policy rules in `bay/policy.ts`. Write the test for DOD-M2-3, failing.
3. Make the grant rule a function of plain data. Keep its sentences.
4. Make the load call it. Put the grants on each active mode.
5. Move each caller. Delete what the old wrapper alone used.
6. Update the map and the feature-map test. Regenerate the debt lists and read the diff.
7. Inject the bugs in a copy. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/policy.ts`, `bay/manifests/registry.ts`, `bay/manifests/spec.ts`, `bay/contracts.ts`, `bay/kernel.ts`, `bay/check.ts`, `bay/check-context.ts`, `bay/commands/actions.ts`, `bay/tools.ts`, `bay/build.ts`, `bay/runs/runs.ts`, `bay/runs/walk.ts`, `bay/runs/waiting.ts`, `tests/policy.test.ts`, `tests/check-equals-load.test.ts`, `tests/runs-fixture.ts`, `tests/system-fixture.ts`, `tests/feature-map.test.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: a mode without grants cannot be written. P-06 parse at the edge. P-08 features meet at entry files. P-11 replace and delete, never layer: no wrapper that keeps the old names. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-30 plain prose: the sentences an owner reads stay as they are.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- You may edit `framework/features.yaml` only as DOD-M2-7 says.
- Run long commands in the foreground and wait for them. Leave nothing running in the background. The session can be stopped without warning: commit each finished step.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; ways an unpoliced system could still be obtained; what you did not do; what you did not verify.
