# Brief B1: the broker's files move into one folder

Capability slice in the kernel, the first of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b1/broker-folder`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (the decision), `docs/designs/operations/0-frame.md` and `A-smallest.md` (sections 7, 8 and 11; this is slice 1 of section 11), `docs/adr/0006`, `0009`, `0013`, `0017`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `tests/feature-map.test.ts`, `CONTEXT.md`.
- How the manifests and runs features were moved into folders: `git log --oneline --all -- bay/manifests bay/runs | tail`, and their briefs `docs/briefs/M1*.md` and `docs/briefs/R1*.md`, as the model for a move that changes no behaviour.

## Output

1. The files that design A places in the broker feature are in `bay/broker/`, moved with `git mv` so that history follows: the broker, the script runner, host, protocol and preload, the effect rule, file access, http access, the database files and its child and process, the agent query and its child, the SQL statements, and `folder-links.ts`. The design's section 7 is the list; where the code today differs from the design's list, the report says so and why you chose as you did. `bay/sdk.ts` stays where it is: every mode imports it by that path.
2. Nothing but location and import lines changes: no name, no signature, no behaviour, no wording. Paths held in strings (the script host and preload the runner starts, what a confined script may read, the dead-code and lint configuration, the type generator, `package.json`) are found and corrected, each listed in the report.
3. The feature map says what is true after the move and nothing that is not yet true: the files are one feature named `broker` whose folder is `bay/broker/`, with today's entry files still listed as entries (it is not sealed yet; a later slice does that). The `scripts` feature and the parts of `safety` and `platform` that moved are gone from the map. Debt entries that the move makes into imports inside one feature disappear; none is added.
4. A report with the counts: debt entries by rule before and after, and which ones went.

Out of scope: any change inside a moved file beyond its import lines; the table of operations; sealing; the toolbox.

## Definition of done

- [DOD-B1-1] (must) `git diff --stat -M` from the starting commit shows the moved files as renames with only import lines changed. The report pastes it and the number of lines changed inside moved files, each of which is an import or a path.
- [DOD-B1-2] (must) The capture script, run on the starting commit and on your final commit, shows no difference. `diff -r` is pasted, empty.
- [DOD-B1-3] (must) No test's assertions change. Test files change only in import lines and in paths; the report lists any that changed more, with the reason.
- [DOD-B1-4] (must) Output 2: a table of every path held in a string that was corrected, found by searching for each moved file's old path across the whole repository, `docs/` aside. `git grep` for each old path, outside `docs/`, finds nothing.
- [DOD-B1-5] (must) Output 3: the map's `broker` entry in full; the debt file's diff; counts by rule before and after. Neither list gains an entry.
- [DOD-B1-6] (must) A real script still runs confined: the mode tests that start the script child pass, and the report names three of them. In the worktree, `./bay.sh call typescript.describe '{}'` answers as before, pasted.
- [DOD-B1-7] (must) `npm run check` passes. Kernel line count before and after is the same, give or take import lines; the report gives both.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. Write the move as a script under `/tmp/b1-scripts/` that does the `git mv` and rewrites import specifiers, so that it can be run again on a newer base if the branch must be rebuilt. Run it. Typecheck. Fix what the script missed by improving the script, not by hand, where that is practical.
3. Find and correct the paths held in strings. Update the map. Regenerate the debt lists and read the diff.
4. Capture and diff. `npm run check`. Commit. Report, with the script's path.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b1-capture/`.

## Resources

`bay/` (the files named in Output 1 and everything that imports them), `framework/features.yaml`, `framework/feature-map-debt.yaml`, `knip.json`, `components/base/typescript/eslint.config.js`, `package.json`, `schemas/generate-types.ts`, `tests/`, `adapters/claude-code/`.

## Rules and constraints

- P-01 no comments. P-11 replace and delete: no file is left behind that only re-exports from the new place. P-25: if you must change course, stop and report. P-29 one meaning per word.
- This slice changes behaviour nowhere. If a test fails after the move for a reason other than a path, stop and report it rather than change the code under test.
- Another builder is working in a different worktree on `bay/manifests/`, `bay/check-layout.ts`, the modes' manifests and schema files. Change only import lines in those files, and expect that the branch is merged after theirs: keep your script so the move can be redone.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- The session has been stopped without warning several times. Commit after every step that passes typecheck, and keep `/tmp/b1-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; each DOD item with pasted command output as evidence; what you did not do; what you did not verify.
