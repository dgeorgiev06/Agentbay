# Brief B4: the rule, and files and the database as entries with rulings

Capability slice in the kernel, the fourth of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b4/first-entries`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019` (the decision: design A as the base, with the ruling from design C), `docs/designs/operations/A-smallest.md` (sections 1, 2, 5, 9, 10, 11 and 12; this is slice 4 of section 11), `docs/designs/operations/C-seams.md` (the ruling only), `docs/designs/operations/trial.md` (the ruling tried in code on a web request, a database statement and a file read: its `Ruling`, `Distinct`, `Definition` and the function that answers a request), `docs/designs/operations/0-frame.md` (what must stay true).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0003`, `0005`, `0006`, `0009`, `0011`.
- Slices B1 to B3 (merged): the broker's files are in `bay/broker/`; `bay/broker/operations.ts` holds the table of shapes and builds a script's context; the protocol and the runner read the table; the runner answers each operation from a table of operation name to a method of the `Broker` class.
- Today every operation is a method of the `Broker` class (`bay/broker/broker.ts`), each of which checks the effect rule, checks its grant, does the work and records, in one body. The effect rule (`bay/broker/effect-rule.ts`) has its own union of operations, a table and a switch.

## Output

1. `bay/broker/rule.ts` holds what every entry shares: the type of a definition (its needs in effects, its rule, its handler, what it records), the ruling a rule returns, the one function that answers a request by a definition (effect rule first, then the entry's rule, then the handler given only what the rule allowed, then the record, with the same guard against a closed broker and the same counting as today), and the refusal wording that is common. The trial's shapes are the starting point; where the kernel's real needs differ from the trial, the report says how.
2. The file operations (`files.read`, `files.list`, `files.write`, `files.makeFolder`, `files.link`, `files.remove`) and the database operations (`db.execute`, `db.query`, `db.migrate`, `db.agentQuery`) are entries: each has a rule that returns a ruling, and a handler that receives the ruling's value and never the request or the grants. They live in files by resource, as the design lays out. Their methods on the `Broker` class, their kinds in the effect rule's union, and their cases in its table and switches are deleted.
3. A handler cannot be handed the unchecked request: the report pastes the compiler's error for a handler written to take the request, and for a rule that returns the request unchanged.
4. The runner asks the table of entries first and falls back to the class for the operations not yet moved (web requests, secrets, events, commands, spend, call). This half-moved state is expected for this one slice and the next slice ends it; the report shows the one place where the fallback is, so that deleting it later is one edit.
5. Agent tools and anything else that called the moved methods on the class ask through the same function the runner uses. No caller keeps a second way in.
6. Every refusal sentence, every event, and every count is the same as before, character for character: the capture is identical and no expected value in a test changes. Tests that called the moved methods directly are changed only in how they ask.
7. Proofs through the entry, for the moved operations, from two examples each: an operation without its needed effect is refused and does nothing; an operation outside its grant is refused and does nothing; an allowed operation is recorded where today's is. The design's section 10 describes them.
8. A report.

Out of scope: web requests, secrets, events, commands, spend and call (slice B5); deleting the class; sealing the feature; commands by name; the toolbox.

## Definition of done

- [DOD-B4-1] (must) Output 1 and 2: the definition type and the answering function pasted; one file entry and one database entry pasted in full. `grep -n` for the moved method names on the class and for the moved kinds in `effect-rule.ts` finds nothing.
- [DOD-B4-2] (must) Output 3: both compiler errors pasted.
- [DOD-B4-3] (must) Output 6: the capture, start and final back to back with a copy of the script that has a scratch folder of your own, shows no difference; `diff -r` pasted, empty. `git diff` of the test files shows no expected sentence, event or count changed; the report lists every test file edited and what changed in it.
- [DOD-B4-4] (must) Output 7: the proofs, written first and seen failing against a definition whose rule allows everything and against one whose handler records nothing.
- [DOD-B4-5] (must) Output 5: every caller of a moved method, before and after, as a table.
- [DOD-B4-6] (must) `tests/toolbox-surface.test.ts` passes unchanged. `git diff --stat` for `components/` and `bay/sdk.ts` is empty.
- [DOD-B4-7] (must) Boundaries: every new file is in the feature map under `broker`; neither debt list grows, and the report says what shrank; the copy-paste detector count does not rise above your starting measure.
- [DOD-B4-8] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a file read skips its grant check; a write is allowed without the write effect; a remove is allowed without the delete effect; a path through a link out of the granted folder is read; a statement that writes passes as a query; a statement in another caller's partition is run; the record of a throwaway change is dropped; the handler runs before the effect rule; the fallback to the class answers a moved operation. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B4-9] (must) Proven on the real thing (P-19): in the worktree, through `./bay.sh call`, one action that reads and writes files, one that uses the database (the store mode), and the git-worktrees `copy` and `remove` of that copy (which use throwaway folders), each the same as on the starting commit apart from run ids. Nothing the walk made is left behind.
- [DOD-B4-10] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. Read the class's file and database methods and the effect rule end to end. In the progress note, write for each moved operation: what it checks and in what order, what it does, what it records, and each refusal sentence with the condition that gives it. That list is what must not change.
3. `rule.ts` and the proofs of Output 7, tests first. Then the file operations, one commit. Then the database operations, one commit. After each, the capture.
4. Move the callers. Delete what the class and the effect rule no longer need. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Capture and diff. Walk the real thing. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b4-capture/`.

## Resources

`bay/broker/` (all of it), `bay/tools.ts` and `bay/runs/skill-steps.ts` (callers), `bay/policy.ts`, `bay/secrets.ts`, `tests/broker-*.test.ts`, `tests/broker-fixture.ts`, `tests/inside/broker/`, `tests/script-*.test.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short: an entry reads top to bottom as rule, then handler. P-05 model the domain in types: what a rule allows is a type of its own, not the request. P-11 replace and delete: a moved operation has one home. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-28: nothing a mode's author or the owner reads changes. P-29 one meaning per word; "ruling" needs a glossary line, proposed in the report. P-30 plain prose.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: `bay/broker/`, the import and call lines of its callers, tests, and the feature map's `broker` entry. Nothing under `components/`, not `bay/sdk.ts`. Anything else is named at the top of the report with its reason.
- No security property in `0-frame.md` is weakened. Where today's order of checks matters to what a refusal says or to what is recorded, the order is kept.
- If an operation does not fit "rule, then handler" without a handler needing something the ruling does not carry, stop on that operation, leave it on the class, and say so at the top of the report: ADR 19 makes that the owner's decision.
- Another builder may be working in a different worktree on the modes' tests, interfaces' shared tests, `tests/feature-map.test.ts` and `framework/features.yaml` (the `modes` rule). Do not edit those except the feature map's `broker` entry.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b4-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; where the fallback is; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
