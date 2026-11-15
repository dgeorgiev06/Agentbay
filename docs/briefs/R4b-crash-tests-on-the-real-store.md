# Brief R4b: crash tests on the real store, and the in-memory store deleted

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `r4b/real-store`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0010` (storage is private to runs and SQLite is its only adapter; the feature's own tests wrap the real store with a fault injector), `docs/adr/0006`, `framework/practices.md`, `CONTEXT.md`.
- `components/base/typescript/practices.md`: the TypeScript practices, TS-01 to TS-17, each with a good and a bad example.
- `docs/designs/runs/C-seams.md`, section 0 and its strongest objection: today's crash test fails the store exactly before or after every single write, and that precision must not be lost.

## Output

1. A fault injector, private to the runs feature's tests, that wraps the real SQLite run store and fails before or after a chosen write.
2. Every test that used the in-memory store runs on the real store, on a temporary file.
3. `tests/memory-run-store.ts` is deleted, with everything that existed only for it.
4. Tests use the real policy and the real secrets scrubber where they used fakes of them (`docs/designs/runs/C-seams.md` section 0 says why).
5. A report.

Moving the remaining engine tests to the entry file is R4c. This slice changes no kernel behaviour.

## Definition of done

- [DOD-R4b-1] (must) The crash test still stops the store before and after every single write of a run from start to done, and after each stop a fresh engine over the same file resumes the run to the same result. The report gives the number of crash points before this slice and after; the number does not fall. If it changes, each difference is explained.
- [DOD-R4b-2] (must) The fault injector is seen working: a test shows that with a fault set at write N the run stops there and the database holds exactly the writes before N.
- [DOD-R4b-3] (must) `git grep -i "memory-run-store\|MemoryRunStore"` finds nothing in `bay`, `tests`, `adapters` or `components`.
- [DOD-R4b-4] (must) `fakePolicy` and the regex scrubber fake are deleted if nothing needs them. Where a test truly needs a stand-in, the report names the test and says why the real thing cannot serve.
- [DOD-R4b-5] (must) Any test that passed only because a fake allowed what the real policy refuses is reported: its name, what the real policy said, and what you did. This is a finding, not a failure.
- [DOD-R4b-6] (must) The `RunStore` type stays, as a private seam of the runs feature (P-10). It has two implementers in the kernel, the SQLite store and the scrubbing wrapper in `bay/runs/scrubbed-store.ts`; the fault injector is a third wrapper of the same shape. The type is not exported from `bay/runs/runs.ts`, and no file outside `bay/runs/` and the runs feature's own tests imports it. The report pastes the `git grep` that shows this.
- [DOD-R4b-7] (must) The time of the full test run is reported before and after. If the real store makes the suite more than a minute slower, say where the time goes and what could be done; do not weaken a test to save time.
- [DOD-R4b-8] (must) The same thing in more than one place (P-12): set-up repeated across the engine tests goes into one fixture. The report lists what was shared and what was left apart and why.
- [DOD-R4b-9] (must) `npm run check` passes. The debt file does not grow. The copy-paste detector count for non-test TypeScript (20 at the start) does not rise.
- [DOD-R4b-10] (must_not) No kernel file changes what it does. A kernel change is allowed only to stop exporting something or to give the injector a place to stand, and each is listed.

## Instructions

1. Run `npm run check` before any edit; record test count, time, line count, debt and detector counts, and the number of crash points the crash test covers.
2. Write the test for the injector first (DOD-R4b-2), failing. Build the injector.
3. Move the crash test onto it. Compare crash points.
4. Move the other tests off the in-memory store, one file at a time. Delete it.
5. Replace the policy and scrubber fakes, one test file at a time. Record what the real ones refuse.
6. Inject at least 10 bugs, one at a time, into the store's writes and the engine's resume path. Record what caught each. Add a test for any survivor, or prove none can.
7. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only).
- The copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console`. Its last line gives the count.
- The debt file: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates it; `grep -c "rule:" framework/feature-map-debt.yaml` counts it.
- The kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`.

## Resources

`bay/runs/run-store.ts`, `bay/runs/sqlite-run-store.ts`, `bay/runs/scrubbed-store.ts`, `tests/memory-run-store.ts`, `tests/engine-crash.test.ts`, `tests/engine-fixture.ts`, `tests/engine-parts.test.ts`, `tests/run-store.test.ts`, `tests/fakes.ts`, `bay/policy.ts`, `bay/secrets.ts`.

## Rules and constraints

- P-01 no comments. P-02 code standards. P-04 readable before short. P-11 replace and delete. P-13: report size, never shape code to a number. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never read or print secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited or deleted and why; deletions with line counts; the same thing in more than one place; the bug-injection table; ways the crash coverage can still miss a failure; what you did not do; what you did not verify.
