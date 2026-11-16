# Brief M4: what the system hands back carries its schemas, its skills and its references

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `m4/targets-carry`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0013` (the decision; this is its slice M4), `docs/adr/0006`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/manifests/B-common-caller.md` section 1: `ActionTarget.input`, `ActionTarget.output`, `Schema.check`, `WorkflowTarget.resolve`, `SkillUse`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `CONTEXT.md`, `bay/manifests/manifests.ts`.
- Today, outside the manifests feature and outside check:
  - `bay/runs/walk.ts` imports `checkValue` from `bay/manifests/spec.ts`, finds an action's input or output schema file itself, and checks a value against it.
  - `bay/runs/workflow-steps.ts` imports `resolveInput`, `resolveValue` and `ReferenceScope` from `bay/manifests/references.ts`.
  - `bay/runs/skill-steps.ts` and `bay/build.ts` import `parseSkill` from `bay/manifests/spec.ts` and read a skill file themselves.
- The check feature also imports `spec.ts` (`bay/check.ts`, `bay/check-context.ts`, `bay/check-layout.ts`, `bay/check-skills.ts`). That is slice M5 and is not touched here.

## Output

1. An action the system hands back carries its input and output schemas. Each schema can check a value and returns the checked value or problems, in the sentences used today. Runs asks the target; it no longer finds or reads a schema file, and it no longer imports `checkValue`.
2. A workflow the system hands back can resolve the references in a value (`$trigger`, `$steps.<id>.output`, `$item`, `$settings.<key>`) against a scope the caller supplies. Runs no longer imports `bay/manifests/references.ts`.
3. An active mode can be asked for one of its skills by name and returns what its callers need: the file, the front matter, the tools its Tools section lists, and the schemas its output is checked against. `bay/runs/skill-steps.ts` and `bay/build.ts` ask the mode; they no longer import `parseSkill` or read the skill file for those facts.
4. `bay/manifests/references.ts` is private: no file outside `bay/manifests/` imports it, tests aside (they are M6).
5. A mode name is matched exactly. `Store.put` is refused when the mode is `store`. (The reviewer's bug injection on M3 found no test for this.)
6. A report.

Out of scope: `inspectSystem` and `placeToWrite`, and the check feature's imports of `spec.ts` (M5); moving the feature's own tests (M6).

## Definition of done

- [DOD-M4-1] (must) Tests in `tests/manifests.test.ts`, importing only the entry file and fixtures, each written first and seen failing:
  - an action target's `input` and `output` check a value: a fitting value comes back; an unfitting one gives the problem sentence used today, word for word; a schema file that is missing or is not a schema gives a problem, not an exception;
  - a workflow target's `resolve` for each of the four reference forms, for a value with no reference, for a reference to a step that has no output yet, and for a reference that names nothing, each with the sentence used today;
  - a mode's skill by name: found, with its front matter, tools and output schemas; not found; a skill file that cannot be read.
- [DOD-M4-2] (must) A test for Output 5, written first and seen failing: `system.action("Store.put")` is refused with the sentence for a mode that does not exist.
- [DOD-M4-3] (must) `git grep -n "manifests/" -- bay/runs bay/build.ts bay/tools.ts bay/kernel.ts bay/commands adapters` shows imports of `manifests/manifests.ts` only. `git grep -n "manifests/references" -- bay adapters ':!bay/manifests'` finds nothing.
- [DOD-M4-4] (must) The sentences an owner reads are unchanged, and what a step's agent is handed is unchanged: the existing tests of runs, the tools, the adapter build and the command line pass without edits to their assertions. Any edited assertion is listed with the reason.
- [DOD-M4-5] (must) The same thing in more than one place (P-12): the report lists, with line counts, the code deleted from runs and harness that found a schema file, checked a value, read a skill file or picked a reference apart. If the entry file reads every action's input schema at load for `bay actions` and the target also carries schemas, they are one read and one value; the report says where.
- [DOD-M4-6] (must) The entry file's exports are pasted in the report, each with one caller in another feature. Names that only the feature's own tests use are not exported from the entry; if a test in `tests/` still needs a private file until M6, it is listed.
- [DOD-M4-7] (must) Both debt lists are regenerated. No entry is added. Every kernel entry whose `from` is in `bay/runs/` or is `bay/build.ts` and whose `to` is `bay/manifests/spec.ts` or `bay/manifests/references.ts` is gone. The report gives counts by rule before and after and explains each difference.
- [DOD-M4-8] (must) Bug injection (P-18, P-31): at least 15 bugs, one at a time, in a throwaway copy, each test run with a time limit, with each result saved to a file as you go. Include: an action's output is checked against its input schema; a reference to one step resolves to another step's output; a skill gets the tools of another skill; an unfitting value is accepted. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-M4-9] (must) `npm run check` passes. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start. Size before and after is reported per file and never targeted (P-13).
- [DOD-M4-10] (must) Proven on the real thing (P-19): in a fresh project under `/tmp` with the feed-briefing config, run `bay check`, `bay build`, `bay call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'`, `bay call feed-briefing.sync '{"since":42}'` (an input that does not fit), `bay call --workflow feed-briefing:workflows/daily.yaml '{}'` up to its first wait, and `bay call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}' --json` followed by one submission that does not fit the output schema and one that does. Paste commands and output, leaving tokens out. Compare what the agent files under `.claude/agents/` contain before and after this slice for the same project, and paste the diff, which should be empty. Delete the project.
- [DOD-M4-11] (must_not) No second way to do the same thing is left: `checkValue`, `resolveInput`, `resolveValue` and `parseSkill` are not called from outside `bay/manifests/` except by the check feature, which is M5.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, kernel line count per file in `bay/manifests/` and `bay/runs/`, both debt counts by rule, and the detector count. Build a project as in DOD-M4-10 and keep a copy of its `.claude/agents/` for the comparison.
2. Schemas on action targets: the test first, failing; then the code; then move `bay/runs/walk.ts` to it. Commit.
3. `resolve` on workflow targets: the test first; the code; move `bay/runs/workflow-steps.ts`. Commit.
4. Skills by name: the test first; the code; move `bay/runs/skill-steps.ts`, then `bay/build.ts`. Commit after each.
5. The exact-name test and fix. Commit.
6. Update the map if a file became private. Regenerate the debt lists and read the diff.
7. Inject the bugs in a copy. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`; per file: `wc -l bay/manifests/*.ts bay/runs/*.ts`.
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive HEAD | tar -x -C <new folder under /tmp>`, then link `node_modules` into it.
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/manifests/manifests.ts`, `bay/manifests/spec.ts`, `bay/manifests/references.ts`, `bay/runs/walk.ts`, `bay/runs/workflow-steps.ts`, `bay/runs/skill-steps.ts`, `bay/runs/action-steps.ts`, `bay/build.ts`, `bay/skill-tools.ts`, `tests/manifests.test.ts`, `tests/references.test.ts`, `tests/spec.test.ts`, `tests/system-fixture.ts`, `tests/runs-fixture.ts`, `adapters/claude-code/tests/build-fixture.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-06 parse at the edge: a schema and a skill are read once and trusted after. P-08 features meet at entry files. P-11 replace and delete, never layer. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-30 plain prose: the sentences an owner reads stay as they are.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- Edit `framework/features.yaml` only to mark a manifests file private.
- The session has been stopped without warning several times, about 35 minutes into a builder's run. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/m4-progress.md` saying what is done and what is next, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. A change to the shared types goes in its own commit, listed first in the report. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every test file edited or deleted and why; deletions with line counts; the same thing in more than one place that remains; the bug-injection table; ways a caller can still read a schema, a skill or a reference for itself; what you did not do; what you did not verify.
