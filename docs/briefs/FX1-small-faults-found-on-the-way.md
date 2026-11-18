# Brief FX1: small faults found on the way: two tests that fail only under load, and loose ends in the proof interface, the coordinator's text and two notes

Several small outputs, one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `fx1/small-faults`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`, `docs/designs/proof/interface-open-questions.md`, `docs/designs/proof/C1r-what-an-approval-shows.md`, `docs/designs/forge/one-slice.md` (section 3, "Not slices, but found").
- Fault 1: `components/base/typescript/tests/kit.test.ts` calls `typescript.check` on a copy of the kit with no time limit, so each check gets the default 90 seconds. When three suites share this two-core machine, lint takes longer and the verdict is inconclusive: the full check then fails one test for a reason that has nothing to do with the code under review. Seen twice.
- Fault 2: `tests/yaml-text.test.ts`, "hostile texts at the size limit are answered within seconds", asserts a wall-clock bound. Under the same load it took 11.6 seconds and failed; alone it passes. Seen once.
- Fault 3: the made-up toolchain inside `components/base/interfaces/proof/tests/shared.ts` answers `describe` without `present` and `missing`, which `toolchain@1` now requires, so a proof mode cannot use `describe` in the shared test (slice P1 worked around it).
- Fault 4: a project cannot say which links a throwaway copy needs; the proof mode links `node_modules` always, and in a project where git does not ignore that folder every copy is refused. Proof's settings are the place (`components/base/interfaces/proof/settings.json`).
- Fault 5: `components/base/interfaces/proof/tests/tr2.json` and open question 21 say TR2 changed eleven paths. Its real base and head (the parents of its merge) differ in twenty-four, because the base is the merge's first parent and not the commit the branch was cut from.
- Fault 6: the coordinator's text, step 4, tells the session agent to show "the content" of an approval; for an approval with a card and no choices it must show the card as the command line prints it. And the kernel's fix sentence for a stale hash says "Approve or reject exactly what the waiting approval shows" where the approval has choices.
- Fault 7: the kit's own tools may read `.forge/`: lint is `eslint … .` with no ignore for it, and `node --test` with no file names searches every folder. Not known whether either reads a slice's worktree under `.forge/worktrees/`.

## Output

1. `kit.test.ts` asks for an explicit time limit that fits a loaded machine, and says why in the test's name or its constant's name. No other typescript test relies on the default where its command is slow; list the ones you checked.
2. The hostile-text test holds what it means, that the reader's work is bounded, in a way that does not fail when the machine is busy: by the reader's own limits being hit (a count of nodes visited, the size refused) or by processor time of the process, not by wall time. If only a time bound can hold it, make it one that a busy two-core machine meets by a wide margin and say what the margin is.
3. The made-up toolchain in the proof shared test answers `describe` as `toolchain@1` requires; a case of the shared test fails if it does not (run its answer through the interface's response schema with the toolbox's check).
4. Proof's settings may name the links a copy needs; left out, none are made. The proof mode reads the setting, the kit's own config names `node_modules`, the shared test has a case, and the made-up proof follows. The interface's sentence says what a link is for.
5. TR2 as a fixture is true: either its declared paths are the twenty-four that really differ, or its base is the commit the branch was cut from and the eleven stand; choose the one that leaves `scope` and `declared` passing for the real commits, change the open-questions note, and say which.
6. The coordinator's step 4 and the stale-hash fix sentence say what is true for an approval with a card or with choices; `tests/coordinator-commands.test.ts` still passes and gains what holds the new words.
7. The experiment of fault 7, done: with one worktree under `.forge/worktrees/` holding a TypeScript file with a lint error and a failing test, run the kit's lint and its test runner's file search and see whether either names it. If so, the smallest ignore that fixes it, in the typescript mode's config and wherever the test script's search is set, with a test. If not, a line in the forge design note saying so and how it was shown.
8. A report.

## Definition of done

- [DOD-FX1-1] (must) Each output with a test seen failing first where behaviour changes (3, 4, 6, 7), and for 1 and 2 the old test shown failing under a made-up load (for example the same test with the limit or bound set to what a loaded run measured) and the new one passing under it.
- [DOD-FX1-2] (must) Nothing else changes: every kit mode's tests pass; `bay check` on the kit prints the same findings but for what output 4 adds, pasted.
- [DOD-FX1-3] (must) Boundaries: neither debt list grows; the detector count does not rise.
- [DOD-FX1-4] (must) Bug injection (P-18, P-31), at least 6, in a throwaway copy that is a git repository: the made-up toolchain's describe loses `missing`; links are made though the setting is left out; a link not named is made; the coordinator's step 4 says "the content" again; the hostile text is not bounded at all; the lint ignore (if added) hides the kit's own files.
- [DOD-FX1-5] (must) `npm run check` passes, once, at the end. Size per file, never targeted (P-13). No test waits real minutes.

## Rules and constraints

- P-01 no comments. P-04. P-11. P-12. P-16. P-17. P-25: if an output needs more than its named files, stop and report that output and finish the others. P-28 for outputs 4 and 6.
- TypeScript: `components/base/typescript/practices.md`.
- A test that holds a bound must still fail when the bound is really broken; do not loosen a test until it holds nothing.
- Write scope: the two test files of outputs 1 and 2; `components/base/interfaces/proof/` (shared test, settings, fixture), `components/base/proof/` for output 4 only, `tests/made-up-proofs*`, `agentbay.config.yaml` for one setting; `adapters/claude-code/coordinator.ts` and its tests; the one sentence in `bay/runs/`; the typescript mode's lint config and `package.json`'s test script if output 7 needs them; the notes. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/proof/scripts/kinds/`, `components/base/proof/scripts/kinds.ts`, `components/base/proof/tests/proof.test.ts` and `components/base/forge/`. In the proof mode touch only what reads the setting (`scripts/lib/`), its settings copy and a test file of your own; do not touch `kinds.ts`, any file under `kinds/`, or `tests/proof.test.ts`.
- Keep every scratch file under the one folder you are given under `/tmp`. Touch nothing else there. Inject bugs only in a throwaway copy. Never run prettier with `--write` on a folder. Stop a process of your own only by its process id.
- Commit after every output; keep your progress note current. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; each output with what changed and its evidence; the bug table; what you did not do or verify.
