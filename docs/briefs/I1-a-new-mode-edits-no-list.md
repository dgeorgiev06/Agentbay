# Brief I1: a new mode edits no list

Slice for one builder, outside the kernel. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `i1/no-lists`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (the decision; this is its slice I1) and `docs/research/2026-11-16-boundary-audit.md` (changes 4, 5 and 10).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `tests/feature-map.test.ts`, `CONTEXT.md`, `docs/adr/0009`, `0011`.
- The audit's finding: every slice that added a mode also edited `framework/features.yaml` (one entry per mode under `outside`), `tests/build.test.ts` (a literal list of the kit's inactive modes) and `tests/kit-check.test.ts` (every listed command of every mode, with its line number in the manifest). The kit's dead-code configuration sits inside the typescript mode and changed in ten slices for reasons that have nothing to do with that mode.

## Output

1. The feature map covers modes by a rule, not an entry each: every folder that holds a mode under `components/` is outside the kernel and may reach it only through the toolbox. Adapters keep their entries. `tests/feature-map.test.ts` enforces the rule exactly as strictly as the entries did, and the per-mode entries are deleted.
2. No test under `tests/` or `adapters/` names a mode of the kit in what it expects. A test that needs modes builds a fixture project with modes of its own. What `tests/kit-check.test.ts` protected is kept in two parts: the kit's own `bay check` still has no error, and its warnings are only of kinds the test names (the two size warnings, and "lists the command"), with no list of each one. Each mode that lists commands asserts its own warnings, as literals, in a test in its own folder.
3. Tests of the kit that exist to exercise a real mode from end to end (the audit names `tests/feed-briefing-session.test.ts`, `tests/two-briefings-session.test.ts`, `tests/database-files.test.ts`) either move into that mode's folder or use fixture modes, whichever keeps what they prove. The report says which and why for each.
4. The kit's dead-code configuration (`knip.json`) moves out of the typescript mode to the kit's root, and `package.json` points to it there. The lint and format configuration stay in the typescript mode: they are the standard that mode ships, and the kit uses them as any project would. The mode's `extraFiles` and README say what is true afterwards.
5. A test that fails when a file under `tests/` or `adapters/` names a kit mode in an expectation, or, if that cannot be told apart from a fixture's own names by a test, the report says why and what review must look for.
6. A report, which also proves the point: in a throwaway copy, add a small made-up mode under `components/modes/` with one script action, change nothing else, and show `npm run check` passing.

Out of scope: schemas copied between an interface and its mode (I2); the mode test harness (I3); any kernel code under `bay/`.

## Definition of done

- [DOD-I1-1] (must) Output 1. A test, written first and seen failing, that a mode folder importing a kernel file other than the toolbox is reported, using a fixture or the test's existing way of checking a rule. `framework/features.yaml` has no entry naming a mode. The stale sentence in its header that says the map is not yet enforced is corrected.
- [DOD-I1-2] (must) Output 2. `grep -rnE "typescript|git-worktrees|feed-briefing|fake-source|\bstore\b" tests adapters` is pasted, with every remaining hit classified: a fixture's own name, a path to a tool's configuration, or an expectation that names a kit mode (there are none of the last, or each is explained).
- [DOD-I1-3] (must) Output 3, a table: each such test, where it lives now, what it proves, and that the proof is unchanged.
- [DOD-I1-4] (must) Output 4. `npm run deadcode` gives the same result as at the start. `git grep -n knip` is pasted.
- [DOD-I1-5] (must) Output 5.
- [DOD-I1-6] (must) Output 6: the made-up mode in a throwaway copy, `git status --short` there showing only its folder, and `npm run check` passing there.
- [DOD-I1-7] (must) No protection is lost. For each assertion removed from `tests/build.test.ts` and `tests/kit-check.test.ts`, the report names the test that now makes it. Bug injection (P-18, P-31), at least 8 bugs, one at a time, in a throwaway copy with time limits and results saved as you go, includes: a mode imports a private kernel file; a mode imports another mode; the kit's check gains an error; a mode lists a command its own test does not expect; `planAgents` plans an agent for an inactive mode. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-I1-8] (must) Boundaries: neither debt list grows; the report says whether either shrank. The copy-paste detector count does not rise above your starting measure.
- [DOD-I1-9] (must) `npm run check` passes. The capture script, run on the starting commit and on your final commit, differs only where files of the kit moved; the report names every file that differs and explains it. Size before and after is reported and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. List every place in the repository, outside each mode's own folder and its interface, that names a mode of the kit. Classify each in the progress note before editing.
3. Output 1, test first. Commit.
4. Output 2: the fixture projects, then each mode's own warnings test. Commit per test file.
5. Output 3. Output 4. Output 5. A commit each.
6. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Output 6. Capture and diff. `npm run check`. Commit. Report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push); `./bay.sh`.
- Kernel line count, debt, copy-paste detector, a throwaway copy, and the capture: as in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/i1-capture/`.

## Resources

`framework/features.yaml`, `tests/feature-map.test.ts`, `tests/build.test.ts`, `tests/kit-check.test.ts`, `tests/project-fixture.ts`, `tests/mode-harness.ts`, `tests/feed-briefing-session.test.ts`, `tests/two-briefings-session.test.ts`, `tests/database-files.test.ts`, `components/` (every mode's `tests/`), `components/base/typescript/knip.json`, `package.json`, `agentbay.config.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing, for anything new. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose.
- TypeScript: `components/base/typescript/practices.md`.
- This slice changes no file under `bay/`. If it seems to need to, stop and say so at the top of the report.
- Another builder is working in a different worktree on `bay/contracts.ts`, `bay/policy.ts`, `bay/ports.ts`, `tests/fakes.ts`, `tests/broker-fixture.ts`, `tests/policy.test.ts` and the adapter's test fixtures. Do not edit those files; if you must, make the smallest edit and name it at the top of the report.
- The machine is shared with that builder, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- The kit's own config (`agentbay.config.yaml`) is the one legitimate place that names which modes are active. Leave it as it is.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/i1-progress.md` current: what is done, what is next, each decision. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
