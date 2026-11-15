# Design frame: the runs feature as one deep module

Read-only design task. Do NOT change any file in /home/claude/agentbay. Write one file only, the path you are given.

## Read
- /home/claude/agentbay/CONTEXT.md (use these words exactly)
- /home/claude/agentbay/docs/adr/0002, 0006, 0009
- /home/claude/agentbay/framework/features.yaml (the `runs` feature and who may import it)
- /home/claude/agentbay/framework/feature-map-debt.yaml (entries whose `from` or `to` is a runs file)
- The 14 files of the runs feature (3,263 lines): bay/engine.ts, action-steps.ts, workflow-steps.ts, skill-steps.ts, walk.ts, undo.ts, waiting.ts, budget.ts, run-state.ts, run-store.ts, sqlite-run-store.ts, scrubbed-store.ts, step-key.ts, step-detail.ts
- Its callers: bay/kernel.ts, bay/tools.ts, bay/task-tokens.ts, bay/run-report.ts, bay/commands/*.ts
- Its tests: tests/engine*.test.ts, tests/run-store.test.ts, tests/budget.test.ts, tests/step-key.test.ts, tests/memory-run-store.ts, tests/engine-fixture.ts

## Facts measured today
- Other kernel features import 16 names from 6 different runs files: Engine, RunView, Waiting, RunStore, RunWithSteps, StepRecord, StoredRun, StoredState, TaskTokenStore, kernelDatabaseFile, runStatuses, SqliteRunStore, SkillStepAt, skillStepAt, storedWaiting, measures.
- Tests import 45 further names that no kernel code outside the feature uses.
- The run store has two adapters: SQLite (real) and in-memory (tests).

## The problem
The feature's interface is whatever its 14 files export. Callers must know the store's record shapes, the step-key text, the waiting state and the budget measures. The goal is one entry file with a small interface that hides all of that, tests that assert only through that interface, and less code than today.

## Definitions (from the codebase-design skill the owner chose)
Interface: everything a caller must know - types, ordering, error modes, config. Deep: much behaviour behind a small interface. Seam: where an interface sits. A port needs two adapters to exist. The interface is the test surface. Deletion test: if deleting a module makes complexity vanish, it was a pass-through. Replace, don't layer: old tests of internals are rewritten at the interface and deleted.

## Your output (one Markdown file, at most 250 lines, plain English, short sentences)
1. The interface: the entry file's exports as TypeScript signatures. Count the exported names.
2. A usage example for each caller: kernel wiring, a bay command (call, approve, resume, runs), and the agent tools (submit, call_action).
3. What the implementation hides, and which of today's files merge, shrink or are deleted. Estimate lines before and after, per file.
4. Dependency strategy: what the feature needs from outside (script runner, policy, secrets scrubber, clock, database) and at which seams. Say for each seam which two adapters exist.
5. How it is tested through the interface only: what a test sets up, what it asserts, and what happens to the 45 names only tests use.
6. Where task tokens, the run report and undo sit, and why.
7. Trade-offs: what this design makes harder, and the strongest argument against it.
8. Migration: an ordered list of slices, each small enough for one builder, each leaving `npm run check` green.

Code standards that bind the design: no classes with inheritance, no `any`, no `as` except `as const`, at most three parameters per function, problems returned as values (`Outcome<T>` in bay/outcome.ts), no comments in code.
