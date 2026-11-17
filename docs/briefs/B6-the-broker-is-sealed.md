# Brief B6: the broker is sealed behind its entry

Capability slice in the kernel, the sixth of the chain in `docs/adr/0019`. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `b6/broker-sealed`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019`, `docs/designs/operations/A-smallest.md` (sections 1, 7, 8, 10 and 11; this is slice 6 of section 11), `docs/designs/operations/0-frame.md`, `docs/adr/0006`, `0009`, `0010`, `0013` (how runs and manifests were sealed).
- How a feature is sealed today: `tests/feature-map.test.ts` holds a list of sealed features (manifests and runs). For a sealed feature nothing outside it imports a file of it other than its entry, the entry re-exports nothing it does not own, and its tests ask through the entry or live under `tests/inside/<feature>/`. Read the test and `framework/features.yaml`, and `docs/briefs/M6*.md` or the last manifests brief as the model.
- Slices B1 to B5 (merged): every operation is an entry with a ruling; `bay/broker/broker.ts` exports `brokerForStep` and `StepBroker { entries, settled, spent, close }`; the class and the old rule file are gone.
- What still reaches a private file of `bay/broker/` from outside, from B5's report (verify it; the debt file and a search are the truth):

| Importer | Private file | What it needs |
|---|---|---|
| `bay/adapter.ts` | `rule.ts` | `writableFolders`, `grantedCommands` (the design's `reachOf` covers both) |
| `bay/runs/skill-steps.ts` | `rule.ts` | `submissionRefusal` |
| `bay/check-imports.ts`, `bay/new.ts` | `script-protocol.ts` | the toolbox's import name |
| `bay/kernel.ts` | `script-runner.ts` | `createScriptRunner` |
| tests | `broker.ts`, `script-runner.ts`, and private files such as `agent-query.ts`, `database-process.ts`, `file-access.ts`, `http-access.ts`, `sql-statements.ts` | their helpers directly |

## Output

1. `bay/broker/broker.ts` is the feature's one entry for the kernel, and `bay/sdk.ts` its one entry for modes. Design A's section 1 is the starting point for what `broker.ts` exports; the code as B5 left it is the other. Before changing code, write three candidate surfaces for the entry in the progress note (the design's, the smallest change from today's, and one more of your own), each as TypeScript signatures with who calls what, and choose one with reasons (P-35). The report gives all three and the choice. Whatever is chosen: a caller asks for an operation in one way; nothing outside learns what a ruling, a definition or a step is; the entry exports no name that nothing outside uses.
2. Every importer outside the feature imports only the entry. The four kernel debt entries of the table go.
3. The broker's tests ask through the entry, with literal expected values as now, or live under `tests/inside/broker/` where they test a private file on purpose. The report gives a table of every broker test file: asks through the entry, moved inside, or deleted because what it tested no longer exists, with what holds the same behaviour. The test debt entries that point into `bay/broker/` go.
4. The feature map says what is true: one feature `broker` with its two entries, its private files, and what it may import; who may import it. `broker` joins the list of sealed features in `tests/feature-map.test.ts`, and the test passes with no debt entry that names a file of `bay/broker/` as the target of an outside import. The two entries the design says are not this feature's to fix (`database.ts` to `owner-only.ts`, `answers.ts` to `secret-patterns.ts`) stay, if they are still there, and the report says so.
5. Nothing a mode's author or the owner reads changes: the capture is identical and no expected value in a test changes.
6. A report, which also gives the numbers the audit asked for: files touched to add one operation today (name them, by walking through adding a made-up operation `files.exists` in a throwaway copy and listing every file that had to change for the type check and the pinned tests to pass), against the six to nine before this chain.

Out of scope: commands by name and effects per command (slice B7); the toolbox's surface; any mode; the transport.

## Definition of done

- [DOD-B6-1] (must) Output 1: the three surfaces and the choice; `grep -n "^export" bay/broker/broker.ts` pasted, with the importer of each name.
- [DOD-B6-2] (must) Output 2 and 4: a test, written first and seen failing, that the feature is sealed (adding `broker` to the sealed list is that test); the list of outside imports of private files before and after, the second empty. Debt counts by rule before and after, with every entry that went named.
- [DOD-B6-3] (must) Output 3: the table of test files. No expected sentence, event or count changes; the report lists every assertion that changed and why, or says none did.
- [DOD-B6-4] (must) Output 5: the capture, start and final back to back with a copy of the script that has a scratch folder of your own; `diff -r` pasted, empty.
- [DOD-B6-5] (must) `tests/toolbox-surface.test.ts` passes unchanged. `git diff --stat` for `components/` and `bay/sdk.ts` is empty.
- [DOD-B6-6] (must) Output 6: the walk-through of adding `files.exists`, in a throwaway copy, with the list of files changed and the pinned test's failure that told you the toolbox's surface had moved. Not merged.
- [DOD-B6-7] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a file outside the feature imports `rule.ts`; the entry re-exports a private file whole; a test outside `tests/inside/broker/` imports a private file; the entry hands out the step's `settled`; `reachOf` (or whatever replaces the two reach functions) reports a folder the mode may not write; the submission refusal is skipped; an operation asked through the entry skips the effect rule. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-B6-8] (must) Proven on the real thing (P-19): the same walk slice B5 did (its script may still be at `/tmp/b5-scripts/walk.sh`; write your own if not), on a `git archive` copy of the starting commit and on your worktree, the same apart from run ids, times and paths. Nothing left behind; `git worktree list` and `git branch --list 'forge/*'` pasted.
- [DOD-B6-9] (must) `npm run check` passes. The copy-paste detector count does not rise above your starting measure. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. List every import of a file of `bay/broker/` from outside it, kernel and tests, with what it uses. Write the three surfaces and choose.
3. Add `broker` to the sealed list and see the test fail. Then the entry, then each outside importer, then the tests, a commit each, with typecheck and the affected tests after each.
4. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. Walk the real thing. The `files.exists` walk-through in a copy. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/b6-capture/`.

## Resources

`bay/broker/` (all of it), `bay/kernel.ts`, `bay/tools.ts`, `bay/adapter.ts`, `bay/runs/skill-steps.ts`, `bay/check-imports.ts`, `bay/new.ts`, `tests/broker-*.test.ts`, `tests/script-*.test.ts`, `tests/inside/broker/`, `tests/test-toolbox.ts`, `tests/feature-map.test.ts`, `framework/features.yaml`, `framework/feature-map-debt.yaml`, `bay/manifests/manifests.ts` and `bay/runs/runs.ts` (two sealed entries to compare with).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-06 and the deep-module rule: a small entry with much behind it; a name is exported only for a caller that exists. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-19 proven on the real thing. P-25: if you must change course, stop and report. P-28: nothing a mode's author or the owner reads changes. P-29 one meaning per word. P-30 plain prose. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: `bay/broker/`, the import and call lines of its callers, tests, the feature map and the debt file. Nothing under `components/`, not `bay/sdk.ts`. Anything else is named at the top of the report with its reason.
- No security property in `0-frame.md` is weakened.
- Another builder may be working in a different worktree on an interface's shared test and one mode's tests under `components/`, and on `tests/made-up-*.ts`. Do not edit those.
- The machine is shared, so runs are slower. The full check can take longer than ten minutes: if your tools have a foreground limit, start it with nohup writing to a log and poll. Never run `node --test` with an empty file list. A check that ends with "Terminated" or exit 143 was stopped from outside; run it again.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/b6-progress.md` current. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; the three surfaces and the choice; each DOD item with pasted command output as evidence; the bug-injection table; the count of files to add an operation; what you did not do; what you did not verify.
