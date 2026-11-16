# 10. Runs is one deep module: one call per use, on real seams

Date: 2026-11-15. Status: accepted by the owner.

Three designs were written under different constraints and compared (`docs/designs/runs/`). This is a hybrid.

**Decision.**

- The runs feature is one module in `bay/runs/` with one entry file, `bay/runs/runs.ts`. It is not split into a record and an engine: they would share every record shape.
- The interface is design B's: `openRuns` returns `Runs`, with one method per real use - start, show, list, approve, resume, extend, stop, wake what is due, reissue a task, read a task, submit, call an action. A run is typed by status: a done run has an output, a waiting run says what it waits for.
- Task tokens live inside runs. `submit` and `task` take only the token; the token names the run, step and round. A submitter never receives the token of another step. The next step's token is given only by reissuing the task.
- Seams are design C's. The script runner, clock, files and folders are ports with a real and a test adapter. Policy and the secrets scrubber are passed in as the real things, not faked.
- Storage is private to the feature and SQLite is its only adapter. The in-memory store is deleted. The feature's own tests wrap the real store with a fault injector that fails before or after a chosen write, so crash tests stay exact.
- Undo stays inside. The run report stays in the command line: runs returns typed data and does not format it for the owner.
- Tests assert through the entry file. Names exported only for tests stop being exported.

**Why.** Other features import 16 names from 6 runs files today and tests import 45 more. Callers must know store records, step-key text and waiting states, and must call things in the right order. Design A hid the same knowledge behind untyped data. Design C's objection, losing exact crash tests, is answered by the private fault injector.

**Cost.** `bay submit` takes the token only. A `kernel.db` from before this change may not open. Many tests are rewritten and some deleted.

**Slices, each green on its own.**

1. R1: a submitter never receives another step's token; `bay submit` takes the token only.
2. R2: move the runs files and `task-tokens.ts` into `bay/runs/`. Nothing else changes.
3. R3: add the entry file with the interface above over the existing engine; move every caller to it; no other feature imports a runs file but the entry.
4. R4: tests move to the entry file; real policy and scrubber; the fault injector; delete the in-memory store and the test-only exports.
5. R5: delete and merge inside the feature until the deletion test finds nothing. Size is reported, not targeted.

**State after slices R1 to R5b (reviewer, 2026-11-15).** The feature is in `bay/runs/` behind `bay/runs/runs.ts`, which exports five names. No other feature imports a private runs file, and tests reach it through the entry file or live in `tests/inside/runs/`. A run's state has one shape. The copy-paste detector finds nothing in the folder.

Left open, on purpose:

- The `Engine` class and `runs.ts` are still two layers with one caller between them. The builder's deletion test judged the seam real (advancing a run and handing out its tasks are different ideas) but wide and partly pass-through. Merging them is its own slice and is not scheduled; it is taken up when a change next needs both.
- Three leftovers go with the next slice that touches runs: `AdvancedRun.spent` and `TaskPlace.round` are written and never read, and a task has two type names (`SkillTask`, `Task`) where the glossary has one.
- A waiting is built twice, by the walk and from the store. Tests hold the two to the same answer.
