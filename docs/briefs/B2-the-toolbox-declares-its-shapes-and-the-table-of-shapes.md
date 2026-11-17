# Brief B2: the toolbox declares its shapes, a test pins it, and the table of shapes exists

Capability slice in the kernel, the second of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b2/toolbox-and-shapes`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (the decision, and what must be tried in code before later slices are briefed), `docs/designs/operations/0-frame.md`, `A-smallest.md` (all of it; this is slice 2 of its section 11) and `C-seams.md` (the ruling: its `Ruling` type, a definition's `rule`, and how a handler takes the ruling's value), `comparison.md` (what the designer was unsure of).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0006`, `0009`, `0011`, `0017`.
- Slice B1 (merged): the broker's files are in `bay/broker/`.

## Output

Part one, merged into the kit:

1. `bay/sdk.ts` declares every shape a mode's author can reach, itself. Its only type imports are the two the design names. The shapes it used to borrow from other files are declared there and the other files take them from it or keep a shape of their own where the design says the two change for different reasons. `ScriptContext` is the same, member for member: no mode changes.
2. A test pins the toolbox's surface: every export of `sdk.ts` and every member of `ScriptContext` with its full type. A change to the surface fails the test until the pinned text is changed too, and the failure shows the changed line. The report shows the failure for one added member and for one changed parameter type. If the design's way of pinning (a type that must equal the real one) does not hold up, use the fallback it names and say why.
3. `bay/broker/operations.ts` holds `Requests`, `Results` and `shapes` for every operation a script can ask for (the design counts 16; count them yourself and say if it differs), typed over one union of operation names so that a missing entry does not compile. Each guard is written once. A round-trip test proves, for every operation from two examples each, that a request and a result pass their guards unchanged and that a malformed one is refused with a sentence.
4. Nothing reads the table yet except its tests; the protocol, host and runner are unchanged (slice B3 does that). So that no dead code is merged, the table is used where it can replace a guard that exists today without changing behaviour, or the report says exactly what the dead-code check needed and why.
5. The capture is identical.

Part two, a trial that is reported and not merged into the kernel:

6. In a throwaway copy, write the full definition with a ruling for the two operations the designer doubted: a web request, whose redirects are checked against the granted hosts while it runs, and a database statement, where the child process finds some refusals only when the statement runs. For each: the `rule`, the handler that takes only what the rule allowed, the record, and tests through one function that answers a request, run against the fakes the kernel's tests already use. Also write one easy operation (reading a file) the same way, for comparison.
7. `docs/designs/operations/trial.md`, committed: the code of the three definitions, what fitted and what did not, whether the handler ever needed something the ruling did not carry, how many lines each took against the method it would replace, the compiler's messages for a missing entry and for a handler given the unchecked request, and a plain answer to: does "rule, then handler" hold for all operations, for most with named exceptions, or not. If it does not hold, say what the smallest honest alternative is.

## Definition of done

- [DOD-B2-1] (must) Output 1: `grep -n "^import" bay/sdk.ts` pasted; a table of each shape that moved, from where, and who imports it now. No mode file changed: `git diff --stat` for `components/` is empty.
- [DOD-B2-2] (must) Output 2: the pin test, written first and seen failing on a deliberately changed surface; the two failure messages pasted.
- [DOD-B2-3] (must) Output 3: the list of operation names; the round-trip test, written first and seen failing; the compiler's error when one entry is removed from `shapes`, pasted.
- [DOD-B2-4] (must) Output 4, with `npm run deadcode` passing.
- [DOD-B2-5] (must) The capture script, run on the starting commit and on your final commit, shows no difference; `diff -r` pasted, empty. Run a copy of the script with a scratch folder of your own.
- [DOD-B2-6] (must) Boundaries: every new file is in the feature map under `broker`; neither debt list grows, and the report says what shrank; the copy-paste detector count does not rise above your starting measure.
- [DOD-B2-7] (must) Bug injection (P-18, P-31) for part one: at least 8 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a guard accepts a request missing a required field; a guard drops an optional field; two operations' result guards are swapped; an export is removed from the toolbox; a member's parameter type is widened. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B2-8] (must) Outputs 6 and 7: the trial's tests pass in the throwaway copy (pasted), and `trial.md` answers the question in its first paragraph.
- [DOD-B2-9] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. Part two first, in a throwaway copy: it is the cheapest way to learn whether the shapes you are about to write are the right ones. Write `trial.md` and commit it.
3. Then part one: the pin test, then the shapes moving into `sdk.ts`, then `operations.ts` with its round-trip test. A commit each.
4. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b2-capture/`.

## Resources

`bay/sdk.ts`, `bay/broker/` (all of it), `bay/contracts.ts`, `bay/ports.ts`, `bay/answers.ts`, `tests/sdk.test.ts`, `tests/broker-*.test.ts`, `tests/broker-fixture.ts`, `tests/fakes.ts`, `tests/script-runner*.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete. P-12 one place: a shape is declared once. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner reads.
- TypeScript: `components/base/typescript/practices.md`. The kit's limits on branches and parameters apply to guards; if they shape the table, say how.
- Write scope: `bay/sdk.ts`, `bay/broker/`, `bay/contracts.ts`, `bay/ports.ts`, their tests, the feature map, and `docs/designs/operations/trial.md`. No file under `components/`. Anything else is named at the top of the report with its reason.
- No security property in `0-frame.md` is weakened, in the kit or in the trial. If the trial can only be made to work by weakening one, that is the finding: say so.
- Another builder may be working in a different worktree on `tests/mode-harness.ts`, the modes' tests and `tests/feature-map.test.ts`. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b2-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: the trial's answer first; anything beyond the brief; items that could not both be met; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
