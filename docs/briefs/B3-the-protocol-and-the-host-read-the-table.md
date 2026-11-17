# Brief B3: the protocol and the script host read the table of shapes

Capability slice in the kernel, the third of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b3/protocol-reads-table`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019`, `docs/designs/operations/A-smallest.md` (sections 3, 4, 9 and 11; this is slice 3 of section 11), `docs/designs/operations/trial.md`, `docs/designs/operations/0-frame.md` (what must stay true).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0005`, `0006`, `0009`, `0011`.
- Slice B2 (merged): `bay/sdk.ts` declares every shape; `tests/toolbox-surface.test.ts` pins the surface; `bay/broker/operations.ts` holds `Requests`, `Results` and `shapes` for 16 operations, with every field of every guard held by a refused case in `tests/inside/broker/operations.test.ts`.
- Today the same shapes are still written twice more: the request union and its parsers in `bay/broker/script-protocol.ts`, and the asks and result guards in `bay/broker/script-host.ts`. The runner's dispatch switch (`bay/broker/script-runner.ts`) names every operation.
- What B2 found about wording, which the owner has not yet decided: today a malformed request of any kind gets one sentence, "The script sent a line that is not a valid message.", and a malformed result reaching the script gets "The broker's answer did not have the expected shape." The table has a sentence per field.

## Output

1. The script host builds a script's `context` from the table by one function (the design calls it `contextOver`): for each operation, the member a mode's author calls sends that operation's request and reads the answer with that operation's result guard. No operation is named in the host apart from where the toolbox's members are mapped to operation names, once.
2. The protocol reads a request by the table's request guard for the operation named in the message. The protocol's own request union and per-operation parsers are deleted. The small checks the table took from the protocol live in one place, and the report says where and why.
3. The runner's dispatch still calls the broker's methods (slices B4 and B5 replace those), but it takes each request already read by the table and no longer re-states its shape. If the dispatch switch can shrink to a table of operation name to broker method without changing behaviour, do that; if not, say what stops it.
4. Wording is unchanged for a mode's author in this slice: a malformed request still ends with today's one sentence, and a malformed result still gives today's one sentence. The table's sentence for the field is not lost: it is recorded with the refusal in the run's events, where the owner can read it. The choice of what the author sees is made in one place, so that the owner's decision later is a change of one line; the report names the line.
5. `db.agentQuery` and any other request whose shape today differs between a script and an agent's tool: the table says what is true for both, and the report lists each such difference and how it was settled without changing behaviour.
6. A script still runs confined and still cannot read kernel files it should not: the list of files the child may read gains the table's file and nothing else, and a test shows a script cannot read another kernel file.
7. The capture is identical.
8. A report.

Out of scope: the broker's class and its methods; the effect rule; rulings; commands by name; any change to `ScriptContext` or to a mode.

## Definition of done

- [DOD-B3-1] (must) Output 1 and 2: `grep -n` for each operation name in `script-host.ts` and `script-protocol.ts`, before and after, pasted. The lines deleted from each file, counted.
- [DOD-B3-2] (must) `tests/toolbox-surface.test.ts` passes unchanged: the surface did not move. `git diff --stat` for `components/` and `bay/sdk.ts` is empty.
- [DOD-B3-3] (must) Tests, each written first and seen failing where the behaviour is new: every operation asked through a real confined script answers as before (the existing script and mode tests count, and the report names the test that covers each of the 16; any operation with no such test gets one); a malformed request for three different operations ends the script with today's sentence and leaves the field's sentence in the run's events; a malformed result does the same on its side.
- [DOD-B3-4] (must) Output 6: the test, written first and seen failing against a child that is allowed one file too many.
- [DOD-B3-5] (must) The tests that reached into the protocol's parsers (`tests/broker-helpers.test.ts` and others the report lists) are rewritten to ask through what remains, or deleted where what they tested no longer exists, with each one named and what now holds the same behaviour.
- [DOD-B3-6] (must) The capture script, run on the starting commit and on your final commit back to back from the same folder, with a copy of the script that has a scratch folder of your own, shows no difference; `diff -r` pasted, empty.
- [DOD-B3-7] (must) Boundaries: neither debt list grows, and the report says what shrank; every file is in the feature map; the copy-paste detector count does not rise above your starting measure.
- [DOD-B3-8] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: two operations' requests are sent under each other's name; a result is read with another operation's guard; a malformed request is passed on to the broker; the field's sentence is dropped from the record; the field's sentence is shown to the script; the child may read `bay/kernel.ts`. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B3-9] (must) Proven on the real thing (P-19): in the worktree, `./bay.sh call typescript.describe '{}'`, and one action of the git-worktrees mode that runs a command (for example `status` on a worktree you cut and then remove), pasted and the same as on the starting commit apart from run ids. Nothing the walk made is left behind.
- [DOD-B3-10] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13); the report says how many lines the three files lost.

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Take the starting capture.
2. Write in the progress note how a request travels today from a mode's call to the broker's method and back, file by file, and where each shape is stated. Then the same after this slice.
3. The host first (`contextOver`), tests first. Then the protocol. Then the runner's dispatch. A commit each.
4. Rewrite or delete the tests of DOD-B3-5. Regenerate the debt lists and read the diff.
5. Inject the bugs in a copy. Capture and diff. Walk the real thing. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b3-capture/`.

## Resources

`bay/broker/` (all of it), `bay/sdk.ts`, `tests/inside/broker/`, `tests/script-runner*.ts`, `tests/script-*.test.ts`, `tests/broker-helpers.test.ts`, `tests/toolbox-surface.test.ts`, `components/` (how modes call the toolbox; read only), `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete: at the end a shape is stated once. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-28: what a mode's author or the owner reads does not change in this slice. P-29 one meaning per word. P-30 plain prose.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: `bay/broker/` and tests. Nothing under `components/`, not `bay/sdk.ts`, not `CONTEXT.md`. Anything else is named at the top of the report with its reason.
- No security property in `0-frame.md` is weakened. The child process is given no more than it has today except the one file it must read.
- Another builder may be working in a different worktree on the modes' tests, the test toolbox for modes, `tests/feature-map.test.ts` and `framework/features.yaml`. Do not edit those except the feature map's `broker` entry if a file is added or removed.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b3-progress.md` current. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; the line where the author's wording is chosen; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
