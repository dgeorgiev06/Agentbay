# Brief E1: the git-worktrees mode declares the effects its commands and actions really have

Mode slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `e1/worktrees-true-effects`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (effects per listed command), `docs/adr/0003` (what the five effects mean), `docs/briefs/B7-commands-by-name.md` and what it built: a mode lists each command under a name with the words it runs and its own effects; an action may run the commands whose effects it declares; `bay check` shows each command and its effects to the owner as the mode author's claim, which the kernel believes and cannot check.
- `components/base/git-worktrees/`: its manifest lists 22 commands, each still with all five effects, and each of its nine actions still declares all five, as slice B7 left them so that nothing changed. `components/base/interfaces/worktrees.yaml` allows all five for every action. The shared test `components/base/interfaces/worktrees/tests/shared.ts` and the mode's own tests hold what the mode does.
- From B7's report: `git status` can refresh and rewrite the repository's index file, so listing it as read-only would be a false claim unless it is run so that it cannot (`--no-optional-locks`). The mode's helper `scripts/lib/git.ts` keeps its own table from command name to git's word and refuses changing commands outside `.forge/`.

## Output

1. Each listed command declares exactly the effects it can have, argued one by one in the report from what the command's words can do with any arguments a script could add after them, not from how the mode happens to call it. Where a command can be made read-only by its listed words (as with `git status`), change the words and say so. Where a claim cannot be made honestly narrower, it stays wide and the report says why. No command of this mode reaches the network or spends; if you find one that can, say which words allow it.
2. Each action declares exactly the effects it needs: the union of the effects of the commands its script can run and of the other operations it asks for (its database, throwaway folders). `status` and `changed` end read-only if Output 1 allows it.
3. `components/base/interfaces/worktrees.yaml` allows for each action what the interface means that action to need, no wider, so that a second implementation is held to the same. If the kernel requires an implementing action's effects to equal the interface's rather than fit within them, say which, and what you did.
4. The effects are tested, not only declared: for each action, a test that it runs with exactly its declared effects (the mode's existing tests and the shared test do this once the manifest is narrowed), and for each effect removed from an action, the report shows by a throwaway edit that removing one more makes a named test fail with the broker's refusal. A table of that in the report.
5. What an agent in a skill step is given follows: a step of a read-only action is given only the read-only commands. Paste what the adapter would write for `status` and for `remove`.
6. The mode's README and its listed-commands test say what is true. Wording that still speaks of "prefixes" in this mode's folder is corrected.
7. A report.

## Definition of done

- [DOD-E1-1] (must) A table of the 22 commands: name, words, effects before and after, and the reason for each effect kept, including what a script-added argument could make the command do.
- [DOD-E1-2] (must) A table of the nine actions: effects before and after, the commands and operations each can reach, and the interface's allowed effects before and after.
- [DOD-E1-3] (must) Output 4's table, from throwaway edits with time limits, results saved as you go.
- [DOD-E1-4] (must) Every test of the mode and the shared test of `worktrees@1` pass with no expected value changed except the effects a refusal sentence lists and the listed-commands warnings; each changed expectation listed. The made-up worktrees mode in `tests/made-up-worktrees.ts` still passes as before; if narrowing the interface forces a change there, it is the smallest one, named.
- [DOD-E1-5] (must) `bay check` on the kit pasted: the same count of warnings, with each of this mode's commands showing its new effects. `bay actions git-worktrees` pasted.
- [DOD-E1-6] (must) Output 5.
- [DOD-E1-7] (must) Write scope held: `git diff --stat` shows only `components/base/git-worktrees/` and `components/base/interfaces/worktrees.yaml` (and `tests/made-up-worktrees.ts` if DOD-E1-4 forces it). No file under `bay/`.
- [DOD-E1-8] (must) Proven on the real thing (P-19): through `./bay.sh call` in the worktree: `cut`, `status`, `changed`, `copy`, `overlay`, `remove` of the copy, `remove` of the worktree refused as unmerged, then cleaned by hand (names starting `e1-walk`), each working with its narrowed effects; `./bay.sh runs <id> --events` for `status` shows only read-only commands ran. Nothing left behind; `git worktree list` and `git branch --list 'forge/*'` pasted.
- [DOD-E1-9] (must) Neither debt list grows; the copy-paste detector count does not rise. `npm run check` passes.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, both debt counts, the detector count.
2. For each of the 22 commands, read git's documentation of the subcommand and its options as listed, and write in the progress note what it can read, write, delete, send or run, with any trailing arguments. Decide each command's effects. Then each action's.
3. Narrow the commands, run the mode's tests. Narrow the actions and the interface, run them again and the shared test. Commit after each.
4. Output 4's throwaway edits. The walk. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools". No capture is needed.

## Resources

`components/base/git-worktrees/` (all of it), `components/base/interfaces/worktrees.yaml` and its shared test, `tests/made-up-worktrees.ts`, `bay/broker/command-operations.ts` and `bay/broker/broker.ts` (read only: how effects decide), `adapters/claude-code/` (read only).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-16 literal expected values. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-29, P-30. P-34: this is a mode slice; if it needs a change under `bay/`, stop and say what capability is missing.
- An effect is a claim the owner will read and rely on. When unsure whether a command can write or delete, it can. Never narrow a claim to make an action look read-only.
- No behaviour of the mode changes except which effects it declares and, where Output 1 says so, the words of a listed command.
- Your worktree is a linked worktree of a shared repository. Tests build their own repositories; the walk's names start `e1-walk` and all are gone at the end.
- Another builder is working in a different worktree on the four interfaces' `tests/shared.ts` files, `tests/test-toolbox.ts` and tests under `tests/`. Do not edit those.
- The full check can take more than ten minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes its tests, and keep `/tmp/e1-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the three tables; each DOD item with pasted command output; what you did not do; what you did not verify.
