# Brief B7: a mode lists its commands by name, each with its own effects

Capability slice in the kernel, the last of the chain in `docs/adr/0019`, together with the mechanical change it forces on the two modes that run commands. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b7/commands-by-name`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (the decision: commands by name, effects per command, matching by leading words deleted), `docs/designs/operations/B-mode-author.md` section 6 (the form, the refusal sentence, what it trades) and `A-smallest.md` sections 6 and 11 (slice 7), `docs/designs/operations/0-frame.md`, `docs/adr/0003`, `0005`, `0009`, `0011`, `0017`.
- `docs/briefs/G1-scripts-run-listed-commands.md` (what a listed command is today and every rule about running one), `docs/briefs/B5-the-rest-become-entries-and-the-class-goes.md`, and the code: `bay/broker/command-operations.ts`, `bay/broker/rule.ts`, `bay/broker/broker.ts` (`reachOf`), `bay/policy.ts`, `schemas/mode.schema.json`, `bay/sdk.ts`, `tests/toolbox-surface.test.ts`.
- Today: a base mode lists commands as lines of leading words under `resources.commands`. A script passes the whole argument list, and the rule allows it if some listed line's words match the first words, argument by argument. An action may run a command only if it declares all five effects, so effects say nothing for a mode that runs commands: the worktrees mode's read-only `status` declares write, network, spend and delete. An agent in a skill step is given the listed lines only if its action declares all five.
- The modes that list commands: `components/base/typescript/` and `components/base/git-worktrees/`. Made-up base modes written by tests list commands too (`tests/made-up-toolchains.ts`, `tests/made-up-worktrees.ts`).

## Output

1. In a mode's manifest a command is listed under a name, with the words it runs and the effects it has. The name is the mode's own word for what the command is for. A command with no effects listed is refused by `bay check` with a fix; a command may list no fewer than one effect.
2. A script names the command and gives only the arguments that vary: the toolbox's `commands.run` takes the command's name and a list of arguments, with the folder, the time limit and the optional input as today. The kernel runs the listed words followed by the arguments. A script cannot change, shorten or reorder the listed words. This is the one change to the toolbox's surface, and the pinned test shows it as changed lines, pasted in the report.
3. The rule is an exact lookup by name. Matching by leading words, and everything that existed only for it, is deleted. An unknown name is refused with a sentence that lists the mode's names.
4. An action may run a command when the action declares every effect the command lists. The rule that any command needs all five effects is deleted. The refusal when an action lacks an effect names the command, the effects it is listed with, the effects the action declares, and the line to change, in the form the design gives.
5. Everything else about running a command is unchanged and still held by its tests: only a base mode may list commands; no shell; only `PATH` in the environment; the working folder inside the project and outside `.agentbay/`, links included; the time limit and the kill of the whole process group; scrubbed output cut to its limit; the `command` event with hashes, which now also carries the command's name.
6. What an agent in a skill step is given changes as the design says: the harness is told the commands whose effects the step's action declares, no more and no fewer. `reachOf` and the Claude Code adapter follow, and a test shows an action with only the read effect being given only the read-only commands.
7. `bay check` still warns once for each listed command, and the warning now names the command and its effects, so that the owner reviews each claim. Each mode's own test of its listed commands holds the new warnings as literals.
8. Both modes are rewritten to the new form in this slice: each manifest lists its commands by name, and each script names its command. In this slice every listed command is given all five effects and every action keeps the effects it declares today, so that no behaviour changes yet; the next two slices give each mode its true effects. The made-up modes in the tests are rewritten the same way. The git-worktrees mode's protections that every command carries are written once in its manifest if the form allows it without a new concept, and if not, the report says what it would take.
9. A script-level proof that a script cannot escape its listing: arguments that look like options (`--force`, `-c`, `--output=...`), an empty name, a name with path characters, and an argument list of the wrong type are each handled as the tests say, with the listed words always first and unchanged. Where a listed command ends its fixed words with `--` or `--end-of-options`, a test shows a script's argument cannot become an option.
10. A test that closing a step's broker ends the database processes it opened, as an assertion and not as a test that hangs when it fails (review of slice B6 found the hang).
11. A report.

Out of scope: giving the two modes their true effects (the next two slices, which run side by side); any other change to the toolbox; the transport.

## Definition of done

- [DOD-B7-1] (must) Output 1 and 2: the schema's new text for a listed command; the two modes' manifests' command sections pasted; the pinned test's changed lines pasted.
- [DOD-B7-2] (must) Output 3 and 4: tests, each written first and seen failing, with literal expected values: a named command runs the listed words followed by the arguments; an unknown name is refused with the sentence; an action with every effect of the command runs it; an action lacking one is refused with the sentence, and nothing runs; a command listed with only the read effect runs under an action that declares only read. `grep` shows the leading-words matching is gone.
- [DOD-B7-3] (must) Output 5: every existing test of running a command still passes with its expected values unchanged apart from the request's new shape and the event's new field; the report lists each changed expectation.
- [DOD-B7-4] (must) Output 6, with the agent file or settings the adapter writes for a read-only action and for an action with every effect, pasted.
- [DOD-B7-5] (must) Output 7: the kit's `bay check` output pasted; each mode's listed-commands test updated.
- [DOD-B7-6] (must) Output 8: every test of both modes passes with no expected value changed. The shared tests of `toolchain@1` and `worktrees@1` pass unchanged, and the made-up toolchain and worktrees modes pass as before. `git diff --stat` for `components/` is pasted and touches only the two modes' manifests, scripts and listed-commands tests.
- [DOD-B7-7] (must) Output 9 and 10: the tests, each written first and seen failing.
- [DOD-B7-8] (must) The capture, start and final back to back with a copy of the script that has a scratch folder of your own: it differs only in the kit's own changed files and in the wording of the listed-command warnings; every differing file is named and explained.
- [DOD-B7-9] (must) Boundaries: broker stays sealed (the feature-map test passes with no new debt entry); neither debt list grows; the copy-paste detector count does not rise above your starting measure.
- [DOD-B7-10] (must) Bug injection (P-18, P-31): at least 14 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a script's arguments replace the listed words; a script's first argument is run as the program; a name matches by prefix; an unknown name runs the first listed command; an action lacking one of a command's effects runs it; a command listed with no effects is accepted; a non-base mode lists a command; the harness is given a command whose effects the action lacks; the event drops the name; the working-folder rule is skipped; the output is not scrubbed. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B7-11] (must) Proven on the real thing (P-19): through `./bay.sh call` in the worktree and on a `git archive` copy of the starting commit: the git-worktrees `cut`, `status`, `copy`, `remove` (names starting `b7-walk`) and the typescript mode's `check` for `typecheck` on the copy. The outputs are the same apart from run ids, times and paths; the `command` events differ only by the new name. Nothing the walk made is left behind; `git worktree list` and `git branch --list 'forge/*'` pasted.
- [DOD-B7-12] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. In the progress note, before code (P-35): the manifest form as schema text and as the git-worktrees mode would write it; the toolbox member's new signature; the rule as a few lines; what `reachOf` returns; each refusal sentence. Name every command of both modes; a name says what the command is for, not how git spells it.
3. Kernel first, tests first: the schema and grants, the rule and the entry, the toolbox and the table of shapes with the pin, `bay check`, `reachOf` and the adapter. So that each commit passes, the two modes and the made-up modes move in the same commit as the kernel change that would break them; say in the report how the commits are ordered.
4. Outputs 9 and 10. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Capture and diff. Walk the real thing. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b7-capture/`.

## Resources

`bay/broker/` (all of it), `bay/policy.ts`, `bay/contracts.ts`, `bay/sdk.ts`, `schemas/mode.schema.json` (types are regenerated by `npm run generate`, never edited by hand), `bay/check.ts` and the check feature, `bay/adapter.ts`, `adapters/claude-code/`, `components/base/typescript/`, `components/base/git-worktrees/`, `tests/script-commands.test.ts`, `tests/broker-commands.test.ts`, `tests/inside/broker/`, `tests/toolbox-surface.test.ts`, `tests/made-up-toolchains.ts`, `tests/made-up-worktrees.ts`, `tests/kit-check.test.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete: at the end there is one way to list a command and one way to run one; no old form is accepted beside the new. P-12 one place. P-15 the interface is the test surface: broker tests ask through the entry or live under `tests/inside/broker/`. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner or a mode's author reads. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- This slice changes what a mode's author writes, once, by the owner's decision in ADR 19. It changes nothing else an author or the owner reads, apart from the sentences named in the outputs.
- No security property in `0-frame.md` is weakened. The effects of a listed command are the mode author's claim, which only a base mode may make and which `bay check` shows the owner; say so wherever the kernel's own words describe it, and do not describe it as enforced.
- Write scope: `bay/broker/`, `bay/policy.ts`, `bay/contracts.ts`, `bay/sdk.ts`, the schema and what is generated from it, the check feature, `bay/adapter.ts` and the Claude Code adapter, the two modes' manifests, scripts and listed-commands tests, the made-up modes in tests, tests, the feature map. Anything else is named at the top of the report with its reason.
- Another builder may be working in a different worktree on `components/base/interfaces/items-source/` and `components/modes/fake-source/tests/`. Do not edit those.
- The machine is shared, so runs are slower. The full check can take longer than ten minutes: if your tools have a foreground limit, start it with nohup writing to a log and poll. Never run `node --test` with an empty file list. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b7-progress.md` current. Never pipe a check whose exit status you rely on.
- Small commits where the typecheck allows, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; the form chosen, with the manifest text and the toolbox line; each DOD item with pasted command output as evidence; the bug-injection table; what the next two slices (true effects per mode) need to know; what you did not do; what you did not verify.
