# Brief W1: the forge mode begins: a plan is a file a script checks, and `forge.waves` prints its table, its waves and what is wrong with it

A mode slice (P-34). For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `w1/waves`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022` (question 3: a plan is a YAML file a script checks; the owner reads what the script prints from it; the table is never edited by hand; the plan is a file of the forge mode, not a schema of the kernel), `0017` (items 1, 6 and 8: every slice has a kind and a write scope; scopes of slices planned to run together are disjoint, checked by script; a plan states order with reasons, and a plan in which every slice waits for the one before is sent back unless it says why), `0018`, `0015`.
- `docs/designs/proof/A-smallest.md` section 2 (a plan as a file of the forge mode, the action `forge.waves`, and plan 0022 written in the form), `docs/designs/proof/interface-open-questions.md` item 1 (the slice's form in `proof@1`'s request has no title and no feature; a plan gives each slice its title).
- The slice's form as merged: `components/base/interfaces/proof/prove-request.json` (the `slice` part) and `tests/tr2.json`.
- `docs/plans/0022-forge-in-waves.md`: the plan this slice must be able to hold, with its waves; it is this slice's real test.
- `bay/policy.ts` and `bay/manifests/activation.ts`: forge is a base mode with rules of its own (only forge may name the kit's `framework/` and write a mode's own code; forge may be active only when the project is the kit). There is no `components/base/forge/` yet.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.

- Slice TB1 comes first and is merged before this one starts: the toolbox reads YAML to a value, checks a value against a schema of the mode or of an interface it requires, lets a mode's schema hold a part of an interface's schema by reference, and matches a path against a pattern in `proof@1`'s dialect. Its note in `docs/designs/proof/` shows each as a caller uses it. This slice uses them and writes none of its own.
- The slice's form as merged names a slice by `name` (not `id`), requires `done` with at least one item (a judgement item is enough), and has three kinds: interface, capability, mode. A plan holds slices that are built and judged; a design round is not one. The todo mode's slice is a mode slice.

## Output

1. `components/base/forge/`: the forge mode's first files. A manifest with one action, `waves`, that runs one script and uses no model (P-32); the read it needs to reach plan files; nothing else. It lists no command and names no throwaway folder. Later slices add its workflows and skills; say in the report which files F1 to F4 will add so that their scopes can be named.
2. **The plan's form**, as a schema in the mode's own folder: a title and a list of slices. Each slice is the slice of `proof@1`'s request (the same fields, read from the interface's schema and not copied into a second definition that could drift: say how that is held, and if a mode cannot read an interface's schema by reference, say what you did instead and test that the two agree), plus what only a plan knows: its title. The owner writes a plan by hand today and forge will write it later; the schema's sentences are for both.
3. **`forge.waves`** takes the path of a plan file in the project and returns, as data and as lines for the owner:
   - the table of slices: name, title, kind, scope, after with reasons;
   - the waves: slices in one wave have no order between them and scopes that share no path; each wave with how many builders it can use;
   - the longest chain, by names;
   - every problem, each with a sentence and never just the first: an `after` that names no slice; a cycle, with the names in it; two slices that could run in one wave and whose scopes share a path, with the pattern of each that overlaps and one example path that both admit; a slice with no write scope; a scope that is a whole kernel feature, as a warning that says the feature may need an entry first; a plan in which every slice waits for the one before with no reason given for that.
   Two slices whose scopes overlap are not an error if an `after` orders them; they are then simply not in one wave.
4. **Whether two scopes share a path** is decided by one pure function from two lists of patterns, in the pattern dialect `proof@1`'s `in-scope` kind uses (the same matching, shared in the way a mode may share code with an interface's shared test; if it cannot be shared, the two are held to agree by a table of cases that both run). It must not answer "disjoint" when unsure: where it cannot decide, it says the scopes may share a path and names both patterns.
5. **Plan 0022 as a file**: `docs/plans/0022-forge-in-waves.yaml`, written from the Markdown plan, with every slice's scope named by path patterns exact enough that `forge.waves` gives the waves the plan states, or shows where the plan is wrong. Where the script and the Markdown disagree, the script wins and the report says what was wrong in the Markdown. The table and waves the script prints are pasted in the report; the Markdown plan gains one line at its top pointing at the file and is otherwise left for the reviewer to retire.
6. `CONTEXT.md` gains Plan, Wave and Longest chain if they are not there, with synonyms not to use. `README.md` for the mode: what it is today (one action) and what it will become.
7. A report.

Out of scope: any workflow, skill or card; running a wave; proof; anything under `bay/` or `schemas/`. If the kernel refuses the forge mode something this slice needs, stop and report (P-25).

## Definition of done

- [DOD-W1-1] (must) Output 1 and 2: `bay check` on the kit shows the forge mode with no error, pasted; a plan file that lacks a field, has an unknown field, or a slice of an unknown kind is refused with the schema's sentence, each pinned; the test that the plan's slice and `proof@1`'s slice cannot drift.
- [DOD-W1-2] (must) Output 3, tests first and seen failing, with literal expected data and literal lines, through the action with the test toolbox: a plan of six slices in three waves; each problem alone and three together (all three reported); overlapping scopes ordered by `after` (no problem); the same without the order (the problem, with both patterns and an example path); a plan of one slice; an empty plan.
- [DOD-W1-3] (must) Output 4: a table of at least twenty pairs of pattern lists with the answer for each, covering `**`, `*`, a file against a folder pattern, a prefix that is not a path part (`bay/run` against `bay/runs/**`), the same file named twice, and a pair the function cannot decide; the agreement with `in-scope`'s matching shown.
- [DOD-W1-4] (must) Output 5 pasted: the waves as printed; each difference from the Markdown plan named.
- [DOD-W1-5] (must) A mode's folder is all this adds (P-34): nothing under `bay/`, `schemas/` or `adapters/`; `tests/new-mode-isolation.test.ts` passes unchanged or the report explains the one change; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise.
- [DOD-W1-6] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy that is a git repository: two overlapping slices placed in one wave; a slice placed before one it comes after; a cycle not found; the longest chain short by one; only the first problem reported; `bay/run` treated as inside `bay/runs/**`; an undecidable pair answered disjoint; a missing `after` target ignored; a plan where every slice waits passes without a reason. Each caught, or a test added.
- [DOD-W1-7] (must) `npm run check` passes. Size per file, never targeted (P-13). The time of the mode's test files alone.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, debt counts by rule, detector count with its command.
2. Write the plan's schema and plan 0022 as a file first, and in the progress note the output's type and the list of problems as a closed set, before code (P-35). Commit.
3. The pure functions, tests first: scopes sharing a path; waves from order and scopes; the longest chain; the problems. Then the action and its lines. A commit each.
4. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner, `bay call`, `bay check`.

## Resources

`components/base/interfaces/proof/prove-request.json`, `tests/made-up-proofs.ts` (how `in-scope` matches a path against patterns), `components/base/typescript/` and `components/base/git-worktrees/` (how a base mode is laid out and tested), `bay/policy.ts` and `bay/manifests/activation.ts` (read only: forge's rules), `bay/sdk.ts`, `tests/test-toolbox.ts`, `docs/plans/0022-forge-in-waves.md`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: a problem is a closed set in a type, each with its sentence. P-12 one place: the matching of a path against a pattern. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25. P-28: the lines are read by the owner. P-29, P-30. P-32: no skill. P-33: the output is what makes side-by-side work safe, so it errs toward "may overlap". P-34. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- Never answer that two scopes are disjoint when that is not certain.
- Write scope: `components/base/forge/`, `docs/plans/0022-forge-in-waves.yaml`, one line in the Markdown plan, `CONTEXT.md`, the feature map if a rule must name the mode. Anything else is named at the top of the report with its reason.
- Other builders may be working in different worktrees on `components/base/proof/`, `bay/` and `adapters/`. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/w1/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it. Inject bugs only in a throwaway copy, never in the worktree.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. No test may wait real minutes.
- Commit after every step that passes typecheck and its tests; keep `/tmp/w1/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; plan 0022's waves as printed and what the Markdown had wrong; each DOD item with pasted output; the bug-injection table; what F1 to F4 need to know; what you did not do; what you did not verify.
