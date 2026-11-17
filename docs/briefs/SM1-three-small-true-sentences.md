# Brief SM1: four small faults found in review: the coordinator's approval command, a spend refusal that echoes a value, a toolchain test that hides why, and folders tests leave behind

Four small outputs, one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `sm1/small-faults`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`, `docs/adr/0009`, `docs/adr/0019`, `docs/adr/0020` (item 3).
- Fault 1: the coordinator's text (`adapters/claude-code/coordinator.ts`) tells the session agent to run `bay approve <runId> --hash <hash> --via chat --quote "…" --json`; the command's usage is `approve <run> <stepKey> --hash <hash> …`. Followed as written, the coordinator's command is refused. No test runs the coordinator's sentence against the command.
- Fault 2: the broker's refusal for a spend request puts the request's spending value into the sentence (`JSON.stringify(request.spending)` in `bay/broker/other-operations.ts`). Slice WC made every other misreading name the field and never echo a value, in case it is a secret. A script can put any text there.
- Fault 3: the toolchain interface's shared test replaces every reason a toolchain gives with "a reason is given" before comparing, so when a project's toolchain is refused a command (for example because it is not trusted), its author sees only "inconclusive" verdicts and never the broker's sentence.
- Fault 4: every run of the suite leaves three folders in `/tmp` (measured in `docs/research/2026-11-17-suite-time.md`): two `agentbay-modes-*` from `tests/test-toolbox.test.ts`, because `openModeProject` does not remove the folder it made when the kernel fails to load there; one `agentbay-remove-*` from `tests/node-ports.test.ts`, which never removes its folder.

## Output

1. The coordinator's sentence for approving a run is the command as it really is, with every argument the command needs and where the coordinator finds each (the run and the step's key come from what `bay` printed when the run stopped for approval). A test takes the command line out of the built coordinator text, fills its placeholders from a real stopped run in a made-up project, runs it, and the approval is accepted; the same for the trust command's two lines. So a later change to either command's arguments fails a test until the coordinator's text follows.
2. The spend refusal names what was wrong with the spending without echoing a value a script chose: a number is shown (it is the amount, the owner needs it), anything that is not the expected shape is named by field as slice WC's sentences do. Decide from the code which values are safe to show and say why in the report.
3. When a toolchain's verdict is inconclusive in the shared test and the case expected otherwise, the failure the author reads includes the reason the toolchain gave, whole. The comparison of verdicts stays as strict as it is; only what is shown on failure changes. If the toolbox's refusal sentence for an untrusted mode (slice TR5) is the reason, the author sees it.
4. A run of the suite leaves nothing behind in `/tmp`: `openModeProject` removes the folder it made on every path where it does not hand a project back, and the node-ports test removes its own. A test lists `/tmp` entries with the suite's prefixes before and after opening a project that fails to load, and they are equal.
5. A report.

## Definition of done

- [DOD-SM1-1] (must) Output 1, tests first and seen failing: the test fails on today's text with the command's own refusal, pasted; passes after. The old and new sentences side by side at the top of the report (P-28).
- [DOD-SM1-2] (must) Output 2, tests first and seen failing: a spend request whose spending is a marker string, an object with a marker inside, and a negative number, each with its literal sentence; the marker appears nowhere the author or the journal reads.
- [DOD-SM1-3] (must) Output 3, tests first and seen failing: in a made-up project, an untrusted toolchain's shared test output contains the broker's sentence and the toolbox's sentence for the author; a trusted one passes as before; the made-up toolchains' expectations are unchanged.
- [DOD-SM1-3b] (must) Output 4, test first and seen failing; and one whole `npm test` with the `/tmp` entries of the suite's prefixes listed before and after, equal, pasted.
- [DOD-SM1-4] (must) Boundaries: manifests, runs and broker stay sealed; neither debt list grows; the detector count does not rise.
- [DOD-SM1-5] (must) Bug injection (P-18, P-31): at least 6 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: the coordinator's sentence loses the step's key again; the trust line loses `--hash`; the spend sentence echoes a string; the spend sentence hides the amount; the shared test hides the reason again; the shared test accepts an inconclusive verdict where it expected passed. Each caught, or a test added.
- [DOD-SM1-6] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. One output per commit, tests first.
3. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Tools

Shell, git, node's test runner.

## Resources

`adapters/claude-code/coordinator.ts` and `adapters/claude-code/tests/build.test.ts`, `bay/commands/approve.ts`, `tests/approve-trust.test.ts` and the tests of run approvals, `bay/broker/other-operations.ts`, `bay/broker/operations.ts` (`shownToAuthor`), `tests/inside/broker/`, `components/base/interfaces/toolchain/tests/shared.ts`, `tests/made-up-toolchains.test.ts`, `tests/shared-tests-in-a-project.test.ts`, `tests/test-toolbox.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if you must change course, stop and report. P-28: the coordinator's sentence is read by the owner.
- TypeScript: `components/base/typescript/practices.md`.
- The coordinator's text must not carry an example of a filled-in quote.
- Write scope: `adapters/claude-code/coordinator.ts` and its tests, `bay/broker/other-operations.ts` and its tests, the toolchain shared test, `tests/test-toolbox.ts`, tests. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `components/base/interfaces/proof/`, `tests/made-up-proofs*` and `bay/runs/`. Do not edit those. Full checks share the machine.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- The full check takes eight to fifteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/sm1-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the sentences; each DOD item with pasted output; the bug-injection table; what you did not do; what you did not verify.
