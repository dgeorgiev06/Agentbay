# Brief AF1: the tests a change needs, worked out from the paths it changed

A tooling slice. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

Every slice has run the whole suite twice, about half an hour each time on this machine, also when it changed one mode's folder. This slice gives the kit one command that names, from the paths a change touched, the test files that change needs, in three tiers, and runs them.

## Input

- Your branch, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/features.yaml` and `tests/feature-map.test.ts` (what a feature is, which paths it owns, what it may import), `tests/new-mode-isolation.test.ts`, `package.json`, `tests/suite-times.ts`, `docs/research/2026-11-17-suite-time.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`.

## Output

1. `tests/affected.ts`: a pure function from a list of changed paths and the repository's list of test files to `{ tier, files, why }`, and a small command around it. Tiers:
   - **mode**: every changed path is inside one or more mode folders (`components/base/<mode>/`, `components/modes/<mode>/`) and none is a `mode.yaml`, a schema, a workflow or a skill's front matter. Files: those modes' own tests.
   - **manifest**: as above, but a manifest, schema or workflow of a mode changed. Files: those modes' tests, plus every test file that loads all the kit's modes together or checks a boundary. Find that set from the code, not by guessing: a test that opens the kit itself, runs `bay check` or `bay build` on the kit, copies the kit, or is one of the boundary tests (`feature-map`, `new-mode-isolation`, `check-imports` and their like). The set is a named list in one place, and a test of yours fails when a test file that opens the kit is not on it.
   - **all**: anything else changed (the kernel, an adapter, an interface's folder, a root schema, `package.json`, a test under `tests/`, a file you cannot place). Files: the whole suite. When in doubt, all.
   - Paths under `docs/` and `*.md` outside a skill need no test and do not raise the tier.
2. `npm run test:affected -- <base>`: the changed paths are `git diff --name-only <base>...HEAD` plus uncommitted and untracked paths; it prints the tier, the reason in one sentence, the number of files, then runs typecheck, lint and the format check on the whole kit (they are fast) and the test files with the same runner options as `npm test`. Exit status is the run's. With no test file to run it says so and exits 0 after the static checks.
3. `tests/affected.test.ts`: the pure function, case by case.
4. A paragraph in `CONTRIBUTING.md` or the place the kit says how to check a change (find it; add no new document).

## Definition of done

- [DOD-1] (must) Tests first, seen failing. Cases, with literal paths: one mode's script; two modes' tests; a mode's `mode.yaml`; a mode's schema; a kernel file; an interface file; a doc only; a doc plus a mode's script; an unknown top-level file; a deleted file; a moved file (both paths count); nothing changed.
- [DOD-2] (must) Checked against history, pasted: for each of the merges F1 (`4c38786..` the F1 merge commit), P2 and TT1 on this branch, the tier the command gives for the slice's own changes. F1 must come out **manifest**, and its file list must contain `tests/made-up-worktrees.test.ts` and `tests/shared-tests-in-a-project.test.ts`, the two files F1 really broke. P2 changed a `mode.yaml`: manifest. TT1 changed `tests/test-toolbox.ts`: all.
- [DOD-3] (must) Never too few by silence: a path the function cannot place gives `all` with a reason that names the path.
- [DOD-4] (must) Times, measured once each on this machine and pasted: `npm run test:affected` for a made-up change to one mode's script, and for a made-up change to one mode's manifest. No promise beyond the numbers.
- [DOD-5] (must) Bug injection (P-18, P-31), at least 6, in a throwaway copy that is a git repository: a manifest change given the tier mode; a kernel path given manifest; an unknown path ignored; a moved file's old path dropped; a doc raising the tier; a test that opens the kit missing from the list and unnoticed.
- [DOD-6] (must) Verified by its own rule: this slice changes `tests/` and `package.json`, so its tier is all; run `npm run check` once at the end.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: the tier is a closed set. P-12: read the feature map's own reader for what a feature owns; write no second parser of `features.yaml` if one can be imported within the debt rules. P-25: if the feature map cannot say what you need, stop and report. P-13.
- Change nothing under `bay/`, `components/` or `adapters/`. Neither debt list grows; the detector count does not rise.
- The command decides what to run; it never decides that a change is safe. Its words say "the tests this change needs before a merge", and that the whole suite still runs on the merged branch.
- Report (P-22), short sentences: anything beyond the brief first; the list of tests that open the kit and how you found it; each DOD item with pasted output; the bug table; what you did not verify.
