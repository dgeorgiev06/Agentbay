# Runs as one deep module: design B, optimised for the common caller

Constraint: each thing a real caller does today is one short, hard-to-misuse call; ordering and error modes are made impossible, not documented; rare needs may be awkward. What callers can get wrong today:
- `bay resume` must read the skill wait *before* the engine call so `engineOutput` knows whether to issue a task token. Forget it and the agent never gets a token.
- `bay submit` must check the token against the run and step itself, then call `engine.submit` with a different key than the record's.
- `tools.ts` must resolve token, read the run, find the skill step, count `tool.called` events, append one after every call, and record `run.asked-by`. Forget the append and the tool-call limit is never reached.
- The kernel must open the store before the script runner (the runner's event sink is the store), then build the engine. Three objects, one order.
- `bay runs` loops over `runStatuses`; `--extend` checks `measures`; `run-report` imports `askedByKind` from `tools.ts`.

## 1. The interface

One entry file, `bay/runs.ts`. Six exported names.

```ts
export function openRuns(needs: RunsNeeds): Promise<Outcome<Runs>>;

export type RunsNeeds = {
  readonly project: string;
  readonly folders: Folders;
  readonly files: FileSystem;
  readonly clock: Clock;
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly scrubber: Scrubber;
  readonly runner: (events: EventSink) => ScriptRunner;
  readonly toolCallsPerRound: number;
};

export type Runs = {
  readonly start: (what: { readonly action: string } | { readonly workflow: string }, input: Json) => Promise<Outcome<Run>>;
  readonly show: (runId: string) => Promise<Outcome<Run>>;
  readonly list: () => Promise<readonly RunSummary[]>;
  readonly approve: (runId: string, decision: {
    readonly stepKey: string;
    readonly hash: string;
    readonly verdict: "approve" | "reject";
    readonly by: string;
  }) => Promise<Outcome<Run>>;
  readonly resume: (runId: string, options?: { readonly rerun: boolean }) => Promise<Outcome<Run>>;
  readonly extend: (runId: string, extra: Readonly<Record<string, number>>) => Promise<Outcome<Run>>;
  readonly stop: (runId: string) => Promise<Outcome<Run>>;
  readonly wakeDue: () => Promise<readonly Outcome<Run>[]>;
  readonly reissueTask: (runId: string) => Promise<Outcome<Run>>;
  readonly task: (token: string, tool: string) => Promise<Outcome<Task>>;
  readonly submit: (
    token: string,
    submission: { readonly output: Json; readonly spent?: Partial<Spend> },
    at?: { readonly runId: string; readonly stepKey: string },
  ) => Promise<Outcome<{ readonly accepted: boolean; readonly reason?: string; readonly run: Run }>>;
  readonly callAction: (token: string, action: string, input: Json) => Promise<Outcome<{ readonly output: Json; readonly runId: string }>>;
  readonly events: EventSink;
  readonly close: () => void;
};

export type Run = {
  readonly id: string;
  readonly target: { readonly kind: "action" | "workflow"; readonly mode: string; readonly name: string };
  readonly state:
    | { readonly status: "running" }
    | { readonly status: "waiting"; readonly waiting:
        | { readonly reason: "skill"; readonly stepKey: string; readonly task: Task }
        | { readonly reason: "approval"; readonly stepKey: string; readonly question: string; readonly hash: string; readonly content: Json; readonly previousHash?: string }
        | { readonly reason: "time"; readonly stepKey: string; readonly until: string }
        | { readonly reason: "budget"; readonly stepKey: string; readonly overrun: { readonly measure: string; readonly limit: number; readonly spent: number } }
        | { readonly reason: "owner"; readonly stepKey: string; readonly question: string } }
    | { readonly status: "done"; readonly output: Json }
    | { readonly status: "failed"; readonly reason: string }
    | { readonly status: "undone"; readonly reason: string; readonly undo: Readonly<Record<"undone" | "failed" | "noUndo" | "deleteNotUndone", readonly string[]>> };
  readonly spent: Spend;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly askedBy?: { readonly runId: string; readonly stepKey: string };
  readonly steps: readonly {
    readonly key: string; readonly kind: string; readonly status: "started" | "done" | "failed";
    readonly startedAt: string; readonly finishedAt?: string;
    readonly input: Json; readonly output?: Json; readonly reason?: string; readonly detail: Json;
  }[];
  readonly events: readonly RunEvent[];
};

export type RunSummary = Pick<Run, "id" | "target" | "createdAt" | "updatedAt"> & {
  readonly status: Run["state"]["status"];
  readonly waitingFor?: string;
  readonly stepKey?: string;
};

export type Task = {
  readonly runId: string;
  readonly stepKey: string;
  readonly round: number;
  readonly feedback: readonly string[];
  readonly skill: string;
  readonly tier: Tier;
  readonly input: Json;
  readonly files: { readonly skill: string; readonly outputSchema: string; readonly alsoMatches: readonly string[] };
  readonly place: StepPlace;
  readonly permissions: Permissions;
  readonly toolCalls: number;
  readonly token?: string;
};
```

Rules runs enforces, so no caller has to:
- Every verb that changes a run returns the run as it now stands. If that call put the run into a skill wait it was not in before, the task carries a fresh `token`. `show` never issues one; `reissueTask` replaces it. No caller compares "before" and "after".
- `submit` returns a token only for the next round of the *same* step. A different skill step's task is never handed to the agent that submitted; `reissueTask` gives it.
- `task(token, tool)` checks the token, records `tool.called`, and refuses past `toolCallsPerRound` unless `tool` is `submit`. Recording cannot be forgotten, because it is the lookup.
- `callAction` resolves the action from the skill's mode, refuses effects other than `read`, refuses an action that waits, charges the calling step and records who asked. All under the calling run's lock.
- `start` parses `mode.action` and `mode:path`; `extend` names the measures when it refuses; `wakeDue` uses its own clock.
- `openRuns` opens `<project>/.agentbay/kernel.db` owner-only, then builds the runner with the scrubbed event sink; wrong order is not expressible. Every verb returns `Outcome`; a thrown error becomes a refusal naming `bay resume <id>`, lock released.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). `Kernel` loses `store` and `engine` and gains `runs`.
```ts
const runs = await openRuns({
  project: layout.project, folders: ports.folders, files: ports.files, clock: ports.clock,
  system, policyOf, scrubber: secrets, toolCallsPerRound: limits.toolCallsPerRound,
  runner: (events) => createScriptRunner({ ...services, events, clock: ports.clock, childProcesses: ports.childProcesses }),
});
if (!runs.ok) {
  return runs;
}
const brokerFor = (place: StepPlace, permissions: Permissions): Broker =>
  new Broker({ ...services, events: runs.value.events, clock: ports.clock, childProcesses: ports.childProcesses, place, permissions });
```

`bay call` (and `{ workflow: "notes:workflows/daily.yaml" }`):
```ts
return printed(kernel, await kernel.runs.start({ action: form.reference }, input));
```

`bay approve` (channel rules stay in the command; they are owner interface, not run state):
```ts
const shown = await kernel.runs.show(runId);
const verdict = { stepKey, hash, verdict: rejecting ? "reject" : "approve", by } as const;
return printed(kernel, await kernel.runs.approve(runId, verdict));
```

`bay resume` and `bay runs`:
```ts
kernel.runs.resume(runId, { rerun });
kernel.runs.extend(runId, { usd: 2, items: 5 });
kernel.runs.stop(runId);
kernel.runs.wakeDue();
kernel.runs.list();
kernel.runs.show(runId);
kernel.runs.reissueTask(runId);
```

`bay submit`:
```ts
const result = await kernel.runs.submit(token, { output, spent: { tokens, usd } }, { runId, stepKey });
return printed(kernel, result.ok ? succeededWith(result.value.run) : result);
```

Agent tools (`bay/tools.ts`); the Tools-section check, size cap and result scrubbing stay here.
```ts
const task = await kernel.runs.task(token, name);
const broker = kernel.brokerFor(task.value.place, task.value.permissions);
const listed = await skillToolsOf(kernel.ports.files, task.value.files.skill);
const submitted = await kernel.runs.submit(token, { output, spent: { tokens, usd } });
const called = await kernel.runs.callAction(token, action, fieldOf(input, "input") ?? {});
```

`printed` is the run report: `reportOf(run, { full })` returns `{ json, text, exitCode }` from a `Run` alone.

## 3. What the implementation hides, and the files

Hidden: record shapes (`StoredRun`, `StepRecord`, `StoredState`, `StepDetail`), the step-key grammar, the lock and heartbeat, the writer, budget frames and measures, the waiting state as stored, token hashing and liveness, redaction before every write, undo planning, the database file name and schema.

- No run-store port. Only SQLite adapts it in the kit; the in-memory adapter exists for tests alone. Tests open SQLite in a temp folder. `RunStore`, `MemoryRunStore` and the wrapper `scrubbedStore` go; redaction happens inside the store's write functions.
- Step keys are built by functions and only ever compared by prefix: `isUndoKey` is `startsWith("undo[")`, "inside frame f" is `startsWith(f + "/")`, the round is after the last `#`. The parser goes.
- The budget wait's overrun is stored (one migration adds a `waiting_detail` column), so `show` and the call that waited return the same `Run`.

| File today | Lines | After | Lines |
|---|---|---|---|
| engine.ts | 546 | runs.ts (entry: openRuns, verbs, refusals, token rule, callAction) | 430 |
| waiting.ts + run-report gathering | 83 | view.ts (stored run to `Run`, `Task`) | 140 |
| action-steps.ts | 510 | same | 500 |
| workflow-steps.ts | 288 | same | 285 |
| skill-steps.ts | 80 | same | 80 |
| walk.ts | 219 | same, `Services` loses `store` type export | 205 |
| undo.ts | 146 | same | 140 |
| budget.ts | 136 | private; `measures` no longer exported | 115 |
| run-store.ts + run-state.ts | 200 | records.ts (private types) | 160 |
| sqlite-run-store.ts + scrubbed-store.ts | 652 | store.ts (functions, redacts on write) | 560 |
| step-key.ts | 219 | builders and three prefix checks | 45 |
| step-detail.ts | 184 | same | 175 |
| task-tokens.ts (now agent-tools) | 90 | moved into runs, private | 70 |
| **Feature** | **3,353** | | **2,905** |

Callers 1,270 to 930: kernel.ts 132 to 115, tools.ts 335 to 230, run-report.ts 321 to 190, approve 121 to 105, resume 122 to 95, runs 52 to 30, submit 92 to 80, call 95 to 85. Production total: about 4,620 to about 3,835 lines. Deleted files: engine.ts (renamed), waiting.ts, run-state.ts, run-store.ts, scrubbed-store.ts, sqlite-run-store.ts (renamed), and tests/memory-run-store.ts.

## 4. Dependency strategy

| Need | Seam | Real adapter | Test adapter |
|---|---|---|---|
| Script runner | `RunsNeeds.runner`, a factory given the event sink | `createScriptRunner` (scripts feature) | fake runner keyed by `mode:script` |
| Policy | `RunsNeeds.policyOf` | from `loadPolicedSystem` (safety) | `fakePolicy` |
| Secrets scrubber | `RunsNeeds.scrubber` | `SecretStore` (secrets) | regex scrubber for `SECRET-…` |
| Clock | `RunsNeeds.clock` | `systemClock` | `fakeClock`, also used to inject crashes |
| Files (schemas, SKILL.md) | `RunsNeeds.files` | `nodeFileSystem` | `fakeFileSystem` |
| Owner-only database file | `RunsNeeds.folders` | `nodeFolders` | `fakeFolders` |
| Database | none: not a port | SQLite file | the same SQLite, in a temp folder |
| System | plain data | `loadPolicedSystem` | `fixtureSystem` |

The database is not a seam: it is in-process, fast and deterministic, and the lock semantics that matter are SQLite's own.

## 5. Testing through the interface only

Setup: `openRuns` with a temp project folder, `fixtureSystem` and the fakes above. A second `openRuns` on the same folder is "another engine" or "after a restart". Assertions are only on `Run`, `RunSummary`, `Task`, `Outcome` and `Run.events`:
- Pipeline, replay, skill rounds, checks, approvals bound to hash, waits, foreach, budget waits and `extend`, stop, undo order: drive with verbs, assert `state` and `steps`.
- Step keys: asserted as the keys runs shows (`"0#2"`, `"draft/0"`, `"undo[0]"`, `".call0"`), not by parsing.
- Scrubbing: a secret in input, output, reason, approval content and event details never appears in `show`.
- Tokens: a start that waits for a skill carries one, `show` does not, `reissueTask` kills the old one, a token dies with its step, the limit refuses call 201 but not `submit`.
- Crash between writes: a clock that throws on its Nth `now()` (every write is stamped), then a fresh `openRuns` resumes. Mid-step crash: a runner that throws. A lock left by a dead engine: a runner whose promise never settles, then a second `openRuns` with the clock eleven minutes on.
- Busy database: the test holds `begin immediate` through `node:sqlite`. Persistence: reopen. Owner-only: `fakeFolders` saw the file first.

The 45 names only tests use: all stop being exported. Their tests are rewritten at the interface or deleted. `step-key.test.ts` (113), `budget.test.ts` (79), `run-store.test.ts` (427), `memory-run-store.ts` (220) and `task-tokens.test.ts` (176) are deleted, and about 260 lines of interface tests replace them. The targets half of `engine-parts.test.ts` moves to the manifests feature's tests. The fixture loses `storeKinds`, `freshEngine` and `Harness.store`. `stepKeyText` and `parseStepKey` leave the ADR 0009 exemption list. Tests: about 3,010 to about 2,050 lines.

## 6. Where task tokens, the run report and undo sit

- **Task tokens: inside runs.** A token is live exactly while its run waits at its step and round. That fact is run state, it lives in kernel.db, and it is checked under the run's lock. In agent-tools it forced three callers to coordinate issuing. Inside runs, issuing is a consequence of entering a wait. `features.yaml` moves `task-tokens.ts` from agent-tools to runs.
- **Run report: in command-line, as pure rendering.** It becomes `reportOf(run, options)` with no kernel, store or token access. It no longer imports `tools.ts` (`askedByKind`), `waiting.ts`, `run-store.ts` or `task-tokens.ts`. It keeps the agent name from the harness adapter, which runs may not import.
- **Undo: inside runs, with no verb.** A failed run undoes itself before the verb returns. Callers see only `state.undo`. There is no reason to call it directly.

## 7. Trade-offs

What this makes harder:
- `Runs` has 14 members: deep, but wide, and each new caller need tends to become a verb.
- Agent-tool policy moves into the engine (tool-call limit, `submit` exemption, read-only `call_action`, asked-by). A tool rule change edits runs.
- Crash injection is coarser: a throwing clock lands between writes but cannot name "after the step, before the run", as the crashing store did.
- No in-memory store: tests are slower, and a store bug cannot be isolated by switching adapters. `tool.called` loses its `ok` detail; `Run.events` is read on every verb.

**Strongest argument against:** it fixes today's callers into the kernel's deepest module. Token issuing, tool-call limits, `call_action` rules and CLI parsing are what the CLI and one tool server need *now*. The next harness (Mastra, Codex) or a second tool protocol will want different rules. With this design those rules are runs code, so ADR 0002's promise that harnesses sit behind adapters erodes. A narrower engine, with tokens and tool policy in agent-tools, would change less when callers change.

Found while reading: `bay submit` passes the submitted step as "before" to `engineOutput`, so when the run moves to a *different* skill step it prints that step's token to whoever submitted. The tool `submit` does not. This design makes both behave like the tool.

## 8. Migration

Each slice leaves `npm run check` green and deletes what it replaces.
1. **Step keys by prefix.** Replace `parseStepKey`, `stepKeyText`, `isInsideFrame` and `skillRoundOf` with builders and prefix checks. Delete `step-key.test.ts`; add key assertions to engine tests. Two names leave the exemption list.
2. **Stored overrun.** Migration adds `waiting_detail`; `storedWaiting` returns budget waits. A test checks that `show` equals the waiting result.
3. **Engine issues tokens.** Engine results carry `Task` with `token` on entering a skill wait. `submit` takes a token. Delete `skillWaitOf`, the "before" argument of `engineOutput`, and `checkTaskTokenFor`. Move `task-tokens.ts` to runs in `features.yaml`. Callers: resume, submit, run-report, tools submit.
4. **Engine view.** `show` and `list` return `Run` and `RunSummary`, with events and asked-by. `run-report.ts` renders only a `Run`. Delete the `storedWaiting` and `runStatuses` exports and the loop in `commands/runs.ts`.
5. **Agent verbs.** Add `task(token, tool)` and `callAction`, with the limit and asked-by inside. `tools.ts` stops importing run-store, waiting, task-tokens and targets; `askedByKind` moves into runs.
6. **Entry file.** `engine.ts` becomes `runs.ts` with `openRuns`; the `Engine` class is gone. `Kernel` drops `store` and `engine` and gains `runs`. Merge `scrubbed-store.ts` into the store. Delete `memory-run-store.ts`. Crash tests move to the throwing clock and runner.
7. **Tests at the interface.** Rewrite `run-store.test.ts`, `budget.test.ts`, `task-tokens.test.ts` and the gate and replay half of `engine-parts.test.ts` through `Runs`, then delete them. Move the targets tests to manifests.
8. **Fold private files.** `run-store.ts` and `run-state.ts` become `records.ts`; `waiting.ts` becomes `view.ts`; `sqlite-run-store.ts` becomes `store.ts`. Update `features.yaml`; remove the runs entries from `feature-map-debt.yaml`. The dead-code tool, run without exemptions, reports nothing in runs.
