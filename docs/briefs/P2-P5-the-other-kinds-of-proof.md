# Briefs P2, P3, P4, P5: the proof mode's other six kinds, one slice each, built side by side

Four mode slices (P-34) with one brief, because they share everything but their kind. Each builder is told which slice is theirs and does only that one. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## What all four share

### Input

- Your branch, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022`, `0015`, `0017`, `0020` (item 2), `docs/plans/0022-forge-in-waves.md`.
- The interface: `components/base/interfaces/proof/` (`prove-request.json` says what your kind's part of the request holds and what "passed" means; `prove-response.json`; `settings.json`; `tests/shared.ts`, whose cases for your kind are your target; `tests/tr2.json`) and `docs/designs/proof/interface-open-questions.md`.
- The mode as slice P1 left it: `components/base/proof/` (`scripts/kinds.ts` is the table; `scripts/kinds/checks.ts` and `fails-first.ts` are the two built kinds and the pattern to follow: a function that gathers evidence through the step, and a pure function from evidence to parts; `scripts/lib/step.ts` is the copy lifecycle and the step's clock; `lib/verdicts.ts` the rule that any inconclusive part makes the item inconclusive; `lib/request.ts` already reads every kind's fields and proof's settings; `tests/proof.test.ts` holds one list, `notBuilt`, of the shared cases answered "not built"; `README.md` has a paragraph per kind).
- `tests/made-up-proofs.ts`: the made-up proof does every kind, small and plain. It is the reference for behaviour, not code to copy whole.
- `docs/designs/forge/calling-a-toolchain.md` (copy, call, remove), `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`.

### What each slice does to shared files, and nothing more

Four builders edit `scripts/kinds.ts`, `tests/proof.test.ts` and `README.md` at once. Slice P1 showed the four edits merge without conflict when each keeps to its own lines:

- In `scripts/kinds.ts`: add your import line(s) where your section says, and change only your kind's row(s) from `notBuilt` to your function. Do not reorder, reformat or touch another row, the blank lines between groups, or the `notBuilt` function (the reviewer removes it when the last slice merges).
- In `tests/proof.test.ts`: delete only your kind's names from the list `notBuilt`. Do not delete the blank lines between groups.
- In `README.md`: change only your kind's paragraph(s).
- Everything else you add is new files of your own: `scripts/kinds/<kind>.ts`, `tests/<kind>.test.ts`. If you need something in `scripts/lib/` that is not there, stop and report what, with its signature: the library is shared and another builder may need the same thing.

### Definition of done, for each slice

- [DOD-1] (must) Pure function first: tests of your kind's function from evidence to parts, with literal evidence and literal parts for passed, failed and inconclusive, written first and seen failing against `notBuilt`.
- [DOD-2] (must) The shared test's cases for your kind pass; `tests/proof.test.ts` passes with your names off the list, and fails if you put one back. No other case changes.
- [DOD-3] (must) Copy, call, remove: every copy your kind makes is removed on every path, including a failed call and a stop at a time limit; one test of the mode's own in your test file shows it with the real git-worktrees mode, as `tests/copies.test.ts` does for the first two kinds (extend nothing there; write yours).
- [DOD-4] (must) Time: your kind asks each call for what is left of the step through the library's clock, never a number of its own; a call with no time left is not made and its part is inconclusive. A test pins the literal limits asked.
- [DOD-5] (must) Nothing a builder wrote reaches a detail or a reason except as a path, a name or a line the kernel's own commands printed, and where the interface says a count, a count.
- [DOD-6] (must) The real thing (P-19), once, pasted: `./bay.sh call proof.prove` on the kit for slice TR2 from `tests/tr2.json` with its real base and head, keeping only the items of your kind (and the two added items for P2). The verdicts, the time, what stood in the way. A verdict that is wrong for a reason outside your kind is reported, not worked around.
- [DOD-7] (must) A mode's folder is all this changes (P-34): nothing under `bay/`, `schemas/`, `adapters/` or the interface's folder; `tests/new-mode-isolation.test.ts` passes unchanged; neither debt list grows; the detector count (the command in the builder's note, before and after) does not rise; `bay check` on the kit has no new error, and any new warning (a listed command) is pasted with why the command is needed and that its effects are true.
- [DOD-8] (must) Bug injection (P-18, P-31): at least 8 bugs for your kind, one at a time, in a throwaway copy that is a git repository; your section lists some that must be among them. Each caught, or a test added.
- [DOD-9] (must) `npm run check` passes. Size per file, never targeted (P-13). No test waits real minutes; your test files' time alone.

### Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts, detector count.
2. Write in the progress note your kind's evidence type and its parts, before code (P-35).
3. Pure function, tests first. Then gathering, through the shared test. Then the table row, the list, the README. A commit each.
4. The real run. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

### Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: evidence and parts are closed sets in types. P-12: the copy lifecycle, the clock and the rule on inconclusive are the library's; use them. P-15, P-16, P-17. P-25: if the interface or its shared test is wrong or unclear for your kind, stop and report; the interface is not yours. P-28: a detail and a reason are read by the owner on a card. P-32: no skill. P-34.
- TypeScript: `components/base/typescript/practices.md`.
- Inconclusive is never a pass. A toolchain or a command is given only a copy from the worktrees interface's `copy`, never a worktree or the project.
- Your kind runs code a builder wrote, unconfined, where it runs tests or commands in a copy; the README says so already. Add no sentence that says otherwise.
- Keep every scratch file under the one folder you are given under `/tmp`. Touch nothing else under `/tmp`. If a command is refused or asks for permission, choose another way and note it. Inject bugs only in a throwaway copy. Never run prettier with `--write` on a folder. Stop a process of your own only by its process id.
- Commit after every step; keep your progress note current. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the real run; each DOD item with pasted output; the bug table; what forge's card script needs to know about your kind's details; what you did not do or verify.

## P2: changes are in scope, and what changed is as declared

- Kinds `in-scope` and `as-declared`. They are the two items proof adds to every slice (`scope`, `declared`), not kinds an item names.
- Evidence comes from the worktrees interface's `changed` between base and head, never from a copy's working files. A path is matched against the slice's scope with the toolbox's path matching (slice TB1; it is merged before you start, and its note in `docs/designs/proof/` shows the call). Do not write matching of your own.
- `as-declared`: files changed against files declared; and action names, read from each changed `mode.yaml` and interface `.yaml` on both sides. Decide from the code how those files are read without a read grant over copies (the listed `count-lines` shows how the mode reads through a command in a copy; a new listed command with the effect read is allowed, with its warning in DOD-7; the toolbox reads YAML to a value after TB1).
- A move counts as two paths for both kinds.
- Also yours: the `scope` and `declared` verdicts in `tests/prove.example.json`.
- TR2's real base and head differ in 24 paths, not the 11 the fixture declares (the base is the merge's first parent, not where the branch was cut). In the real run say what the two items give and why; do not change the fixture.
- `kinds.ts`: import after line 2; rows `in-scope` and `as-declared`. `proof.test.ts`: the six names that begin `in-scope:` and `as-declared:`.
- Bugs that must be among yours: a path that only starts like a folder of the scope is accepted; the old path of a move is not checked; `as-declared` compares counts and not paths; a declared path's text appears in the detail; an action that changed is not seen as changed; working files of the copy are compared, not the two commits.

## P3: injected bugs are caught

- Kind `bugs-caught`. For each bug of the request: a copy of the head, the bug's patch applied with the worktrees interface's `apply`, the toolchain's `test` with only the bug's covering test files, the copy removed. Passed when every run failed; a run that passed is a survivor, named, and fails the item; a patch that does not apply, a run that is inconclusive, or no bugs at all make the item inconclusive.
- The step's time is shared among the bugs through the library's clock; say how, and what a slice with a dozen bugs gets each.
- `kinds.ts`: import after line 1; row `bugs-caught`. `proof.test.ts`: the three names that begin `bugs-caught:` and the one that begins `a bug's run`.
- Bugs that must be among yours: a survivor counted as caught; a patch that does not apply counted as caught; the bug's test files ignored and the whole suite run; two bugs applied to one copy; a copy left after a survivor; an inconclusive run counted as caught.

## P4: output is the same, and the real thing

- Kinds `same-output` and `real-thing`. Both run the copy's own `./bay.sh` at the copy's root, by a listed command of the mode (new; effects read and write; its warning pasted in DOD-7), with words from proof's settings (`same-output`) or from the item (`real-thing`).
- `same-output`: a copy of the base and a copy of the head; each declared command in both; output and exit code compared, standard error not; those the item names in `differ` must differ and the rest must not. A project that declares no commands: inconclusive with the interface's literal sentence.
- `real-thing`: a fresh copy of the head; each run's output and exit code against the literal text the item gives.
- This slice needs a copy to be a repository of its own (slice WT1, merged before you start): `bay` lists a project's files with git. If `./bay.sh` in a copy still sees an empty project, stop and report.
- A command's output on a card: the detail gives counts and the names of commands that differ, never the output itself.
- `kinds.ts`: import after line 3; rows `same-output` and `real-thing`. `proof.test.ts`: the five names that begin `same-output:` and `real-thing:`.
- Bugs that must be among yours: the head compared with itself; exit codes ignored; a command named in `differ` that did not differ passes; a project with no commands passes; the real thing run at the project's root and not in a copy; standard error compared.

## P5: a count

- Kind `count`. Counts the lines that hold a text, as written and not as a pattern, under the given paths in a copy of the head (and of the base, for a count that may not rise), by a listed command of the mode (new or shared with what is there; effect read). Passed when the head has at most `most`, or at most the base. A path that does not exist: inconclusive.
- A declared count (from proof's settings, named by the item with `use`) and a count given in the item are the same code.
- `kinds.ts`: import after line 4; row `count`. `proof.test.ts`: the two names that begin `count:`.
- Bugs that must be among yours: the text matched as a pattern; the base counted for both; a missing path counted as zero and passed; `most` compared with less-than; a declared count's name not found reads as passed.
- If yours is the last of the four to merge, the reviewer removes `notBuilt` and `notBuiltParts`; do not.
