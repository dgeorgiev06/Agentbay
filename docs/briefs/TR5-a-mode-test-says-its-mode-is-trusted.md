# Brief TR5: trust, slice five: a mode's test says its mode is trusted, and a toolchain and a worktrees mode pass their shared tests in a project that is not the kit

For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr5/trusted-in-tests`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (items on the test toolbox and shared tests), `docs/adr/0020`, `docs/adr/0021`, `docs/designs/trust/B-owner.md` (section 7 and slice 5 of section 9), `docs/designs/forge/modes-beside-the-kit.md`, the briefs TR1 to TR3.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slices TR1, TR2 and TR3 are merged. A project mode's list is granted only when the project's trust record holds trust for it, and the broker reads `.agentbay/trust.json` in the project again before each command. The test toolbox (`tests/test-toolbox.ts`, `openModeProject`) makes a temporary project and writes no trust record, so a project mode's tests cannot run its commands: `tests/shared-tests-in-a-project.test.ts` pins that a made-up toolchain and a made-up worktrees mode in a project load and then fail the cases that need a command (it counts how many pass).
- The record is written by `writeTrustRecord` in `bay/trust.ts` from the text `recordWithTrust` gives; `listOf(manifest)` in `bay/policy.ts` gives a mode's list; `scriptFilesOf` gives the fingerprint.

## Output

1. `ProjectOptions` of the test toolbox gains `trusted?: readonly string[]`: the names of modes of the temporary project that the test trusts. When opening the project, the toolbox writes that project's trust record through the same functions the trust command uses, for each named mode's list as its manifest has it at that moment, with `by` saying a test gave it. The owner's project and its record are never read or written. A name that is not a mode of the temporary project, or is a base mode, or lists nothing, fails the test's setup with a sentence.
2. Each shared test passes the option through, in the way that fits how it already takes its second argument, so a project mode's test file stays three lines: import the shared test, call it with the mode, and say the mode is trusted. Decide whether the shared test trusts the mode under test by itself (the mode's author wrote the test; the trust is for a temporary project) or the author must say so, argue the choice in the report from what an author would expect, and write the sentence an author reads when a command is refused in a test either way.
3. `tests/shared-tests-in-a-project.test.ts` now shows the true end state: in a project that is not the kit, a made-up toolchain and a made-up worktrees mode, trusted in the test, pass every case of their shared tests; without the option they load and are refused with the broker's sentence, which the test pins.
4. `bay check`'s fix sentence for a mode that does not run its shared test, and the README or note a mode's author reads about shared tests, say the one extra thing a project mode's test needs. No other owner-facing sentence changes.
5. A report.

Out of scope: `bay check`'s trust findings (TR4, in flight, owns `bay/check.ts` and `bay/commands/approve.ts`); the adapter (TR6); running the kit's own typescript mode from a project that is not the kit (it is a base mode and needs no trust; if you find it does not work there for another reason, report it and do not fix it).

## Definition of done

- [DOD-TR5-1] (must) Output 1, tests first and seen failing, in the toolbox's own test: a trusted project mode's script runs its command and the literal output comes back; without the option the literal refusal; the record written is in the temporary project and nowhere else (compare the kit's and the real project's `.agentbay/` before and after); the three setup failures with their literal sentences; a mode whose manifest changes after opening is refused at its next command (the trust was for the list at opening).
- [DOD-TR5-2] (must) Output 2 and 3: the made-up modes' test files pasted (three lines each); the counts in `shared-tests-in-a-project` before and after, per mode, with every case named that now passes.
- [DOD-TR5-3] (must) Output 4: the sentences pasted with the old ones beside them.
- [DOD-TR5-4] (must) The isolation rules hold: a mode's tests import only the toolbox, the test toolbox and its interface's shared test; `tests/new-mode-isolation.test.ts` passes unchanged or with a change the report explains; the test toolbox reaches the kernel through entries the feature map allows, and neither debt list grows.
- [DOD-TR5-5] (must) Nothing changes for the kit: every kit mode's tests pass unchanged; the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), shows no difference, or each differing file is named and explained.
- [DOD-TR5-6] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: the option trusts every mode of the project; the option trusts a mode it does not name; the record is written into the kit; the record is written with an empty list; a base mode's name is accepted silently; an unknown name is accepted silently; without the option the shared test still passes; the shared test trusts the mode when the author did not say so (or the reverse, by your choice in output 2). Each caught, or a test added.
- [DOD-TR5-7] (must) `npm run check` passes. Size before and after per file, never targeted (P-13). The time of `tests/shared-tests-in-a-project.test.ts` before and after.

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read `tests/test-toolbox.ts`, the four shared tests' second argument, and `tests/shared-tests-in-a-project.test.ts`. Write in the progress note the option's shape and how each shared test passes it, before code (P-35).
3. The option, tests first. Then the shared tests. Then the project test. Then the sentences. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr5-capture/`.

## Resources

`tests/test-toolbox.ts` and its test, `components/base/interfaces/*/tests/shared.ts`, `tests/shared-tests-in-a-project.test.ts`, `tests/made-up-*.ts`, `tests/new-mode-isolation.test.ts`, `tests/kit-copy.ts`, `tests/system-fixture.ts` (`trustRecordFiles`: the kernel's own fixtures; the toolbox does not import a kernel test fixture), `bay/trust.ts`, `bay/policy.ts` (`listOf`), `bay/check-imports.ts` (the fix sentence only), `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place: the record a test gets is made by the functions the trust command uses. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if you must change course, stop and report. P-28 for the sentences in output 4. P-34: this changes the test toolbox, the shared tests and tests only.
- TypeScript: `components/base/typescript/practices.md`.
- A test never touches the owner's project: not its `.agentbay/`, not its config.
- Trust in a test is for that temporary project only, and the record says a test gave it.
- Write scope: `tests/test-toolbox.ts` and its test, the four shared tests, `tests/shared-tests-in-a-project.test.ts`, the made-up modes' files, `bay/check-imports.ts` for one fix sentence, the note or README an author reads, the feature map. Nothing else under `bay/`, nothing under `adapters/`. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `bay/check.ts`, `bay/commands/approve.ts`, `bay/trust-card.ts` and their tests. Do not edit those.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- The full check takes thirteen to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr5-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; the choice in output 2 and its reason; each DOD item with pasted output; the bug-injection table; what forge's proof mode needs to know about trust in a worktree; what you did not do; what you did not verify.
