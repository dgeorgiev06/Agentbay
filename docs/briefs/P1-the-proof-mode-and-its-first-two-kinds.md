# Brief P1: the proof mode: its folder, its table of kinds, and the first two kinds: the checks pass, and a test fails first

A mode slice (P-34). For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `p1/proof-mode`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022` (the decision), `0015`, `0017`, `0018`, `0020` (item 2), `0023`.
- `docs/plans/0022-forge-in-waves.md`: this is slice P1. It lays out the mode's folder so that P2 to P5 each add one file per kind and its test, side by side, without touching what another adds.
- The interface as merged: `components/base/interfaces/proof/` (`prove-request.json`, `prove-response.json`, `settings.json`, `tests/shared.ts`, `tests/tr2.json`) and `docs/designs/proof/interface-open-questions.md` (every choice the interface made; items 3, 7, 8, 13, 14 and 16 to 19 bind this slice). `tests/made-up-proofs.ts`: the made-up proof `assay` that passes the shared test; it is the reference for what each kind does, small and plainly written, and it is not to be copied whole.
- `docs/designs/proof/A-smallest.md` section 1 (the mode: one action, a table from kind to script, the copy lifecycle, the four listed commands, what is behind the entry), `C-seams.md` section 1 (the private seam between gathering evidence and deciding a verdict), `docs/designs/forge/calling-a-toolchain.md` (copy, call, remove).
- The modes it calls: `toolchain@1` (typescript mode; `describe` says what a project is set up for; a check not set up is inconclusive; a call may ask up to 1,000 seconds once slice KL1 is merged, and the calling action must then declare how long its own script step may run) and `worktrees@1` (`copy` with links, `overlay`, `changed`, `apply`, `remove`).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

## Output

1. `components/base/proof/`: a base mode that implements `proof@1` with the one action `prove`. Its manifest requires `toolchain@1` and `worktrees@1`, lists only the commands its kinds need with their true effects (P1 needs none of its own if the two kinds reach code only through the two interfaces; say so), names its throwaway folder if it needs one, copies the interface's settings shape as the interface says a mode must, and declares the time its script step may take (from what the longest kind needs: a check and a test run of 1,000 seconds each on two copies, plus the margin slice KL1 states).
2. **The layout for kinds**: one table from kind to its script, one file per kind, one shared library for what every kind does (the copy lifecycle with remove on every path; turning parts into an item's verdict by the rule that any inconclusive part makes the item inconclusive; the two items proof adds to every slice; size). A kind that is not built yet answers inconclusive with a sentence that says the kind is not built in this version of the mode, never passed and never an error. Adding a kind is adding its file, its test and one row; say in the report exactly which lines P2 to P5 will each touch, so the reviewer can check they are disjoint.
3. **Inside a kind, gathering and deciding are separate**: a function that reaches the toolchain and worktrees and returns evidence as data, and a pure function from evidence to the verdict's parts. The pure functions are tested directly from the mode's own tests with literal evidence; the gathering is tested through the shared test.
4. **The kind `checks`**: a copy of the head; `describe`, then `check` and `test` on the copy; remove. Passed when every check passed and the test run passed. A check the project is not set up for, a run stopped at its limit, a copy that could not be made, each make it inconclusive with the reason the toolchain or worktrees gave, whole.
5. **The kind `fails-first`**: a copy of the base with the item's test files laid over it from the head, the tests run with those files; then a copy of the head, the same files. Passed when the run failed on the base (not inconclusive) and passed on the head. A test file that does not exist at the head, a run on the base that passed, and a run that could not start, each have their own sentence.
6. **The shared test**: the mode passes every case of `proof@1`'s shared test that concerns `checks`, `fails-first`, the copy lifecycle, the judgement items and size; for the cases of kinds not built yet it gives the not-built answer, and the mode's own test file says which cases those are, by name, in one list that P2 to P5 shorten. `bay check`'s rule that a mode runs its interface's shared test holds.
7. **The real thing** (P-19), once, by hand, pasted in the report: `bay call proof.prove` on the kit itself for a past slice of this kit written in the slice's form (take TR2 from `tests/tr2.json`, with its real base and head), with only its `checks` and `fails-first` items. Say what the verdicts were, how long it took, and what stood in the way. If slice KL1 is not merged when you reach this, do it with the limit that exists and say that the kit's suite did not fit.
8. `README.md` for the mode: what it proves, what it does not (it runs code a builder wrote, unconfined, as the toolchain does; a copy limits where that code writes by convention only), and how a reviewer calls it by hand.
9. A report.

Out of scope: the other six kinds (P2 to P5); forge; cards; anything under `bay/` or `schemas/`.

## Definition of done

- [DOD-P1-1] (must) Output 1 and 2: `bay check` on the kit shows the new mode with no error; the warnings it adds listed (a long step; any listed command). The table and the lines P2 to P5 will touch, pasted.
- [DOD-P1-2] (must) Output 3 to 5, tests first and seen failing: each pure function with literal evidence and literal verdict parts, for passed, failed and inconclusive, including a failed part beside an inconclusive one (inconclusive wins, as the interface chose); the shared test's cases for the two kinds pass.
- [DOD-P1-3] (must) Copy, call, remove: the shared test's cases on copies pass; and one test of the mode's own that a copy is removed when the toolchain call is stopped at its limit and when the proof's own input is refused midway.
- [DOD-P1-4] (must) Output 6: the list of shared cases that pass now and the list answered "not built", by name; the mode's test fails if a not-built case starts passing without being taken off the list, and if a built case stops passing.
- [DOD-P1-5] (must) Output 7 pasted.
- [DOD-P1-6] (must) A mode's folder and its interface are all this adds (P-34): nothing under `bay/`, `schemas/` or `adapters/`; `tests/new-mode-isolation.test.ts` passes unchanged; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise. If a capability is missing, stop and report it (P-25): do not add to the kernel.
- [DOD-P1-7] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy that is a git repository: a copy is not removed on a failed call; the toolchain is given the project and not a copy; the head's copy is checked for `fails-first`'s base run; the overlay is skipped; a test that passed on the base counts as failed-first; an inconclusive check counts as passed; an inconclusive check beside a failed one reads failed; a not-built kind answers passed; the test run is skipped when the checks passed; a check not set up reads as failed; size reports the head for both. Each caught, or a test added.
- [DOD-P1-8] (must) `npm run check` passes. Size per file, never targeted (P-13). The time of the mode's test files alone; no test waits real minutes, and the mode's tests run the shared test once.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts by rule, detector count with its command.
2. Read the interface, the shared test's cases and the made-up proof. Write in the progress note the mode's files, the table, the library's functions with their inputs and outputs, and the evidence type of each of the two kinds, before code (P-35). Commit the manifest and the layout with every kind answering "not built" first: the shared test then fails exactly the cases of built kinds, which is the red state to start from.
3. `checks`, then `fails-first`, each: pure function tests first, then gathering through the shared test. A commit each.
4. The real run. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner, `bay call`, `bay check`.

## Resources

`components/base/interfaces/proof/`, `tests/made-up-proofs.ts` and its test, `components/base/typescript/` and `components/base/git-worktrees/` (how a base mode is laid out, lists commands, calls another interface through the toolbox, and tests itself with the test toolbox), `components/base/git-worktrees/tests/typescript-in-a-project.test.ts` (copy with links, then check and test), `bay/sdk.ts` (the toolbox: the only kernel file a mode imports), `tests/test-toolbox.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: evidence, parts and verdicts are closed sets in types. P-11. P-12 one place: the copy lifecycle; the rule on inconclusive. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-19. P-25. P-28: a verdict's detail and reason are read by the owner on a card. P-29, P-30. P-32: proof is scripts, no skill. P-34. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- Inconclusive is never a pass. Nothing a builder wrote reaches a detail or a reason except as a path or a line the kernel's own commands printed.
- A toolchain is never given a slice's worktree or the project's folder: only a copy that came from the worktrees interface's `copy`, removed afterwards on every path.
- The mode's own words claim only what it does. It does not say code is safe, confined or correct.
- Write scope: `components/base/proof/`, the feature map if a rule there must name the mode, `CONTEXT.md` only for a word the mode adds. Not `components/base/interfaces/proof/`: if the interface or its shared test is wrong or unclear, stop and report it; the interface is another slice's.
- Other builders may be working in different worktrees on `bay/`, `adapters/claude-code/` and `components/base/forge/`. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/p1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it. Inject bugs only in a throwaway copy, never in the worktree.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/p1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the real run; each DOD item with pasted output; the bug-injection table; exactly what P2 to P5 each add and touch; what the interface left unclear; what you did not do; what you did not verify.
