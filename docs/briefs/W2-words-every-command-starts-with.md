# Brief W2: a mode states once the words every one of its commands starts with

Capability slice in the kernel, with the one mode that needs it. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `w2/shared-command-words`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020` item 4 (the decision) and `0021` (trust will take a hash over a mode's commands as resolved words, so this comes first), `docs/adr/0019`, `docs/briefs/B7-commands-by-name.md`.
- Today a mode lists each command under a name with `run` (the words) and `effects`. The git-worktrees mode lists 22, and each repeats the same protections at the start of its words (`git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false --attr-source=<empty tree>`, with small variations: some commands carry the committer identity, some carry `--no-optional-locks`, and two leave out `--attr-source`). A command added without them would run a repository's hooks or filters, and only review would notice.
- The code: `schemas/mode.schema.json` (`resources.commands`), `bay/policy.ts` (grants: a command's words), `bay/broker/command-operations.ts` (what runs), `bay/broker/broker.ts` (`reachOf`: what the harness is given), the check feature's warning per listed command, `components/base/git-worktrees/mode.yaml` and its `scripts/lib/git.ts`.

## Output

1. One optional field in a mode's manifest, beside `commands`, holds the words that every command of the mode starts with. A command's words are those words followed by its own `run`. You choose the field's name and exact place, write it as schema text and as the git-worktrees manifest would use it, and argue it in the report (P-35); it must read plainly to an owner who has never seen it.
2. The resolved words are what everything downstream sees, with no second way: the grants, what the broker runs, the `command` event, what the harness is given, and the `bay check` warning, which shows the full words that will run. Nothing downstream knows the field exists.
3. The git-worktrees mode states its protections once. Where a command today differs from the common start (the committer identity, `--no-optional-locks`, the two that must leave out `--attr-source`), say for each how it is expressed under the new form without weakening it and without a second concept; if the form cannot express the two that leave out a shared word, the shared words are the largest set every command carries, and the report shows which protections therefore stay on individual lines and how a test still holds them.
4. A test in the git-worktrees mode that every one of its commands' resolved words carries each protection it must (hooks off, file watcher off, submodule recursion off, and the attribute source wherever git accepts it), so that a command listed without them fails a test even where the field does not force it.
5. `bay check` refuses shared words that would make a command something else entirely: empty words, or a mode that gives shared words and lists no command. A mode outside the kit's base folder that gives shared words is refused as it is for commands today.
6. Nothing changes in what runs: for every command of both command-running modes, the resolved words are the same as before, word for word, shown by a comparison before and after.
7. A report.

Out of scope: trust; any change to how effects are decided; the typescript mode (it has no shared words, unless you find it reads better with `npm run`, in which case say so and leave it).

## Definition of done

- [DOD-W2-1] (must) Output 1: the schema text and the git-worktrees manifest's commands section pasted, before and after, with line counts.
- [DOD-W2-2] (must) Tests, each written first and seen failing, with literal expected values: a mode with shared words and two commands is granted both with resolved words; what runs is the resolved words followed by the script's arguments; the event and the harness's list show resolved words; a mode with no shared words is unchanged; the refusals of Output 5 with their literal messages.
- [DOD-W2-3] (must) Output 6: a script prints every command's resolved words for both modes at the starting commit and at your final commit; the two outputs are identical; pasted `diff`, empty.
- [DOD-W2-4] (must) Output 4, seen failing with a command added that lacks a protection.
- [DOD-W2-5] (must) Every test of both modes and the shared tests of `worktrees@1` and `toolchain@1` pass with no expected value changed, except the manifest line numbers that listed-command warnings carry; each changed expectation listed.
- [DOD-W2-6] (must) The capture, start and final back to back with a copy of the script that has a scratch folder of your own: differs only in the kit's own changed files and in warning line numbers; every differing file named and explained.
- [DOD-W2-7] (must) Boundaries: broker and manifests stay sealed; neither debt list grows; the copy-paste detector count does not rise.
- [DOD-W2-8] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy with time limits and results saved: the shared words are dropped from what runs; they are added twice; they are placed after the command's own words; the harness is given the unresolved words; the warning shows the unresolved words; a script's arguments come before the shared words; a non-base mode's shared words are accepted; a git-worktrees command loses `core.hooksPath`. Each caught, or a test added.
- [DOD-W2-9] (must) Proven on the real thing (P-19): `./bay.sh call` for the git-worktrees `cut`, `status` and `remove` (names starting `w2-walk`) and `./bay.sh runs <id> --events` showing the full words that ran, the same as on a `git archive` copy of the starting commit apart from ids, times and paths. Nothing left behind.
- [DOD-W2-10] (must) `npm run check` passes. Size before and after reported per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, both debt counts, the detector count. Save the resolved words of every command of both modes.
2. In the progress note, before code: the field, as schema text and as the manifest reads; where it is resolved (one place); what each downstream reader sees.
3. Kernel, tests first. Then the git-worktrees manifest and its test. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. Walk. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/w2-capture/`.

## Resources

`schemas/mode.schema.json` (types regenerated by `npm run generate`), `bay/policy.ts`, `bay/contracts.ts`, `bay/broker/command-operations.ts`, `bay/broker/broker.ts`, `bay/check.ts` and the check feature, `components/base/git-worktrees/` (manifest, `scripts/lib/git.ts`, tests), `tests/broker-commands.test.ts`, `tests/script-command-listing.test.ts`, `tests/agent-commands.test.ts`, `tests/made-up-worktrees.ts`, `tests/made-up-toolchains.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete. P-12 one place: the words are resolved once. P-15, P-16, P-17, P-19. P-25: if you must change course, stop and report. P-28: this adds one thing a mode's author may write, by the owner's decision; nothing else an author or owner reads changes. P-29, P-30. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: the schema and what is generated from it, `bay/policy.ts`, `bay/contracts.ts`, the broker and check features where the resolved words are read, the git-worktrees mode's manifest, README and tests, and tests. Anything else is named at the top of the report with its reason.
- No protection of the git-worktrees mode is weakened, and no command's resolved words change.
- Another builder is working in a different worktree on `components/base/interfaces/toolchain*` and `components/base/typescript/tests/`. Do not edit those.
- The full check can take more than ten minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again. Run a copy of the capture script with a scratch folder of your own.
- Commit after every step that passes typecheck and its tests; keep `/tmp/w2-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree. Walk names start `w2-walk` and are gone at the end.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the field and why; each DOD item with pasted output; the bug-injection table; what you did not do; what you did not verify.
