# Brief G3: the worktrees mode, part one: cut, status, changed, copy, overlay, remove

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `g3/worktrees`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0015` (the decision; this is its slice G3), `docs/adr/0012`, `docs/adr/0009`, `docs/adr/0011`.
- `docs/designs/forge/C-seams.md` section 2.3 (the actions this mode was designed with) and `docs/designs/forge/A-smallest.md` on worktrees.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slices G1 and G2 (merged): a script of a base mode may run a command its mode lists; `components/base/typescript/` is a mode behind `toolchain@1` and is the closest thing to model on. Read `docs/briefs/G2-toolchain-interface-and-typescript-mode.md` and that mode's code and tests.
- What the kernel gives a command: an argument list with no shell, only `PATH` in its environment, a working folder inside the project and outside `.agentbay/`, a time limit.
- Git runs code from the repository it works on: hooks, and filters and aliases from its configuration.

## Output

1. An interface `worktrees@1` in `components/base/interfaces/`, and a base mode `git-worktrees` in `components/base/git-worktrees/` that implements it. It is the only mode that lists a git command. Six actions, each with a description, an input schema and an output schema:
   - `cut`: given a slice name and a base commit, make a branch and a worktree for it under `.forge/worktrees/` in the project, and return the folder, the branch and the commit. Refused with a sentence when the branch or folder already exists.
   - `status`: given a worktree's folder and a base commit, return its head commit, the commits since the base (hash and subject), whether it is clean, and the paths that are changed or untracked.
   - `changed`: given two commits, return each path that differs and how: added, modified, deleted, or renamed and from where.
   - `copy`: given a commit and a name, make a throwaway copy of that commit's files under `.forge/copies/`, and return the folder. Given a list of paths to link, each must be ignored by git in the project; the copy gets a link to each. The mode names no language and no such path itself.
   - `overlay`: given a copy's folder, a commit and a list of paths, put those paths as they are at that commit into the copy. A path absent at that commit is removed from the copy. Never a worktree.
   - `remove`: given a folder, remove a copy; or remove a worktree when it is clean and its branch is merged into a named branch, and otherwise refuse with a sentence saying which of the two is not so. The branch is deleted with its worktree.
2. No action runs code from the repository: hooks do not run, and the report lists every other way git could run code for the commands used and how each is closed or left open.
3. Every name and path that comes from input is checked before it reaches git: a slice or copy name is letters, digits and dashes; a commit is a full or short hash or a branch name with no leading dash; a path is relative, has no `..`, and does not start with a dash. A folder given to `status`, `overlay` or `remove` must be one this mode made.
4. `.forge/` is ignored by git. The `throwaway/` entry G2 added to `.gitignore` is replaced by it, with G2's README and any test that names it updated, so there is one place for throwaway folders (P-12).
5. A report.

Out of scope, for the next slice: `merge`, `set-aside`, `apply`. Also out of scope: forge, proof, pushing or fetching, anything remote.

## Definition of done

- [DOD-G3-1] (must) `bay check` on the kit passes with the mode and interface present. Its only new findings are one warning per command the mode lists, and the test of the kit's own check is updated with them as literals. `bay actions git-worktrees` lists the six actions with their descriptions. The report pastes both.
- [DOD-G3-2] (must) Tests of each action, each written first and seen failing, with literal expected values, run against small git repositories the test builds inside a temporary project. At least:
  - `cut`: a worktree and branch exist at the base commit; a second `cut` of the same name is refused and changes nothing; a name with a slash, a space or a leading dash is refused and no command runs.
  - `status`: clean with no commits; two commits since base, with their subjects in order; a changed file and an untracked file are named; a folder this mode did not make is refused.
  - `changed`: one added, one modified, one deleted and one renamed path between two commits; the same commit twice gives an empty list.
  - `copy`: the copy holds exactly the files of the commit and no `.git`; a linked path is a link to the project's own; a path to link that git does not ignore is refused; a name already in use is refused.
  - `overlay`: a named path takes the other commit's content; a path absent at that commit is removed; a path with `..` is refused; a worktree's folder is refused.
  - `remove`: a copy is removed; a clean, merged worktree is removed with its branch; a worktree with a changed file is refused and kept; a worktree whose branch is not merged is refused and kept; a folder outside `.forge/` is refused.
- [DOD-G3-3] (must) A test that a hook in the repository does not run: the test repository has a `post-checkout` hook that writes a file, and after `cut` the file does not exist. Written first and seen failing against the command without the protection.
- [DOD-G3-4] (must) Each action declares the effects the interface allows it, and all five where it runs a command, as G1 requires. `resources.commands` lists only what the scripts run, each prefix as narrow as git's argument order allows; none is the bare `git`. The report lists each prefix and what it can do beyond its intended use.
- [DOD-G3-5] (must) Used together with the TypeScript mode, in one test: `copy` a commit of the kit with `node_modules` linked, then `typescript.check` for `typecheck` alone on that copy is `passed`. The report gives its time.
- [DOD-G3-6] (must) Output 4, with `git grep -n throwaway` pasted showing what remains and why.
- [DOD-G3-7] (must) Boundaries: neither debt list grows; the feature map lists the new mode under `outside`; mode code imports only the toolbox; mode tests import only what `bay check` allows.
- [DOD-G3-8] (must) The same thing in more than one place (P-12): what this mode shares with the TypeScript mode (running a command and reading how it ended, reading a request) is in one place, or the report says why it is not. The copy-paste detector count for non-test TypeScript does not rise above what you measure at the start.
- [DOD-G3-9] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy, each test run with a time limit, each result saved to a file as you go. Include: `remove` deletes a worktree with a changed file; `remove` deletes an unmerged branch; a name check is dropped; `overlay` accepts a worktree; `copy` includes `.git`; hooks run. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-G3-10] (must) `npm run check` passes. The capture script, run on the starting commit and on your final commit, differs only where the kit has a new mode and interface and the new warnings; the report pastes the file names that differ and explains each. Size before and after is reported per file and never targeted (P-13).
- [DOD-G3-11] (must) Proven on the real thing (P-19): in your worktree, with the kit as the project and the mode named in the kit's config, through `./bay.sh call`: `cut` a slice from the head commit; commit one small file in the new worktree by hand; `status`; `changed` between base and the new commit; `copy` the new commit with `node_modules` linked; `overlay` one path from the base; try `remove` on the unmerged worktree and paste the refusal; `remove` the copy. Then clean up by hand what the mode rightly refused to remove, and paste `git worktree list` and `git branch --list 'forge/*'` showing nothing is left.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. Find out by trying what git needs with only `PATH` set and no shell (for example a home folder or an identity) for each command you plan to use, and how to stop hooks and repository configuration from running code. Write what you found in the progress note before writing mode code.
3. The interface and its schemas. Then one action at a time, tests first, in the order of Output 1. Commit after each.
4. Output 4. The test of DOD-G3-5. The feature map. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Run the capture and diff it. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push); `./bay.sh` in the worktree.
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy for bug injection: `git archive <commit> | tar -x -C <new folder>`, then link `node_modules` into it and `git init` it.
- The capture: `/home/claude/m5-capture/capture.sh <kit folder> <output folder>`; read the script first. Write your outputs under `/tmp/g3-capture/`.
- A new mode or action can be started with `./bay.sh new`; see `./bay.sh new --help`.

## Resources

`components/base/typescript/` (mode, scripts, tests, `tests/checkouts.ts`), `components/base/interfaces/toolchain.yaml` and its schema folder, `bay/sdk.ts`, `bay/effect-rule.ts` (how a listed prefix is matched), `tests/script-commands.test.ts`, `tests/mode-harness.ts`, `tests/kit-check.test.ts`, `framework/features.yaml`, `.gitignore`, `agentbay.config.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: how a path changed is one of a closed set. P-08 mode code imports only the toolbox. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface: test the mode through its actions. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner reads, descriptions included.
- TypeScript: `components/base/typescript/practices.md`.
- This mode can delete work. When unsure whether something may be removed, refuse and say why. Never force a removal, and never list a command with a force flag.
- Nothing remote: no fetch, pull, push or clone, and no prefix that allows one.
- If a script needs something the toolbox or the kernel lacks (for example a way to make a link, or to remove a folder), stop on that point: say what is missing and the smallest addition that would serve, make it in its own commit with its own tests written first, and name it at the top of the report. Do not widen a listed command to get around it.
- If two items here cannot both be met, say so plainly at the top of the report and meet the one that grants less.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep a progress note in `/tmp/g3-progress.md` saying what is done, what is next, and each decision you made, updated after each commit. Run long commands in the foreground. Leave nothing running in the background.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print real secrets. Never push. Never touch `main` or another worktree; the worktrees your tests and your walk make are inside your own worktree's project.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; each DOD item with pasted command output as evidence; the interface file and the mode's manifest in full; every test file edited and why; the same thing in more than one place; the bug-injection table; ways this mode could still lose work or run code; what you did not do; what you did not verify.
