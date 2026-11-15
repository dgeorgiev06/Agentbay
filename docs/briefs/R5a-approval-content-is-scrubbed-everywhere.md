# Brief R5a: an approval shows the same scrubbed content everywhere

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `r5a/approval-content`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010`, `docs/adr/0003`, `framework/practices.md`, `components/base/typescript/practices.md`.
- The fault, found in slice R4c: when a workflow reaches an approval whose content holds a secret, the `Run` returned by `Runs.start` (and by any call that advances the run to that approval) carries the content with the secret in clear. The stored copy is redacted. A later `Runs.show` returns `content: null`. So `bay call` prints the secret, and it reaches the coordinating model; and `bay runs <id>` cannot show the owner what they are asked to approve.
- `tests/runs-scrub.test.ts`, the test "approval content and event details are stored redacted", which today asserts the `content: null`.

## Output

1. The content of a pending approval is scrubbed before it leaves runs, on every path: the `Run` returned by `start`, `resume`, `approve`, `extend`, `submit`, `wakeDue`, and by `show`.
2. Every path returns the same content and the same hash for the same pending approval. The hash is the hash of the scrubbed content, because that is what the owner saw and approved.
3. `show` returns the content, not `null`, after the process restarts.
4. A report.

## Definition of done

- [DOD-R5a-1] (must) A test in `tests/runs-scrub.test.ts`, written first and seen failing: a workflow whose approval shows a setting that holds a handed-out secret. The `Run` from `start` has content with `[redacted:NOTES_TOKEN]` and does not contain the secret's text anywhere in its JSON.
- [DOD-R5a-2] (must) The same test, continued: a fresh `openRuns` over the same file returns, from `show`, the same `content` and the same `hash` as `start` did. The old assertion of `content: null` is gone.
- [DOD-R5a-3] (must) Approving with that hash succeeds from the fresh `openRuns`. Approving with the hash of the unscrubbed content is refused.
- [DOD-R5a-4] (must) A test for each other path in Output 1 that can arrive at an approval (`resume` after a crash before the approval, `submit` whose next step is an approval, `wakeDue` after a wait): the returned `Run` holds no secret text. Where two paths share code, one test may cover both and the report says so.
- [DOD-R5a-5] (must) A test at the command line: `bay call` of that workflow prints no secret text, in text or with `--json`.
- [DOD-R5a-6] (must) The scrubbing happens in one place (P-12). The report names the function and shows that every path in Output 1 passes through it.
- [DOD-R5a-7] (must) Approvals whose content holds no secret behave exactly as before: the existing approval tests pass without edits to their assertions, apart from the one named in Input.
- [DOD-R5a-8] (must) `npm run check` passes. Neither debt list grows. The copy-paste detector count for non-test TypeScript (20 at the start) does not rise. Size before and after is reported and never targeted (P-13).
- [DOD-R5a-9] (must) Proven on the real thing (P-19): in a fresh project under `/tmp`, with a workflow that has an approval showing a setting, and a secret set with `bay secret set` that a script reads and returns into that content: run it with `bay call`, show it with `bay runs <id>`, approve it with `bay approve`. Paste commands and output. The secret's text appears nowhere in the output. Delete the project.
- [DOD-R5a-10] (should) While reading the paths, list any other field of a returned `Run` that could carry unscrubbed text (a step's input or output, a failure reason, a task's input, an event detail). For each, say whether it is scrubbed and which test shows it. Fix what is in clear, test first; if a fix is large, report it and stop.

## Instructions

1. Run `npm run check` before any edit. Record test count, kernel line count, both debt counts and the detector count.
2. Write the test for DOD-R5a-1 and DOD-R5a-2 and see it fail.
3. Find where a `Run` is built from the engine's own wait and where from the stored one. Make one function produce the approval's content and hash, scrubbed, for both.
4. Write the tests for DOD-R5a-3 to DOD-R5a-5, each failing first where it can.
5. Do DOD-R5a-10.
6. Inject at least 8 bugs, one at a time, into the scrubbing and the hash. Record what caught each. Add a test for any survivor, or prove none can.
7. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.

## Resources

`bay/runs/runs.ts`, `bay/runs/waiting.ts`, `bay/runs/workflow-steps.ts`, `bay/runs/scrubbed-store.ts`, `bay/runs/step-detail.ts`, `bay/secrets.ts`, `bay/commands/approve.ts`, `bay/run-report.ts`, `tests/runs-scrub.test.ts`, `tests/runs-fixture.ts`, `tests/cli-owner.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface: new tests import `bay/runs/runs.ts` and fixtures only. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- In tests and in the report, use a made-up secret value. Never read or print a real secret.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say in the report if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited and why; the same thing in more than one place; the bug-injection table; ways a secret could still leave runs; what you did not do; what you did not verify.
