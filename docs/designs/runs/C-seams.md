# Runs feature, design C: designed around seams

## 0. The seams, decided first

The feature needs seven things from outside. For each I ask the same question: is this a port with two adapters, or something else?

| Need | Today | Decision | Adapters |
|---|---|---|---|
| Script runner | `ScriptRunner` | **Port.** Kept. | real: `createScriptRunner` (scripts); test: the fake runner in the fixture |
| Clock | `Clock` | **Port.** Kept. | real: `systemClock`; test: `fakeClock` |
| Schema files | `FileSystem` | **Port.** Kept. | real: `nodeFileSystem`; test: `fakeFileSystem` |
| Owner-only data file | imports `owner-only.ts` (a debt entry) | **Port.** `Folders`, passed in. | real: `nodeFolders`; test: `fakeFolders` |
| Storage | `RunStore`, 12 methods, public | **Private seam, not a port.** One adapter: SQLite. | real only. `MemoryRunStore` is deleted. |
| Policy | `policyOf` passed separately from `system` | **Not a seam.** A value from safety: one `PolicedSystem`. | tests use the real policy; `fakePolicy` is deleted |
| Scrubber | `Scrubber`, test adapter is a regex | **Not a seam.** A value from secrets. | tests use a real `SecretStore` over a test environment |

Why storage stops being a port. The in-memory store exists only for tests; 220 lines of maps re-implementing 569 lines of SQL test the maps, not the database. SQLite on a temp file is what ships. With one adapter there is no port (ADR 0006), so the store becomes a private file, and its record shapes (`StoredRun`, `StepRecord`, `Writer`, ...) leave the interface.

Why policy and scrubber are not seams. They are not outside the process and nobody swaps them in production. A fake of them lets a test pass with grants the real policy would refuse.

One module or two? I considered a "run record" module (store, events, task tokens) and an "engine" module (advances runs). They would share every record shape: the engine needs full step records to replay. Splitting them puts the 16 leaked names back on a seam between two features. The record has no caller of its own once task tokens and reports read through the engine. So: **one deep module**, with storage as a private seam inside it.

## 1. The interface

Entry file: `bay/runs/runs.ts`. Eleven exported names.

```ts
export type RunsOptions = {
  readonly system: PolicedSystem;
  readonly project: string;
  readonly folders: Folders;
  readonly files: FileSystem;
  readonly clock: Clock;
  readonly scrubber: Scrubber;
  readonly runner: (events: EventSink) => ScriptRunner;
};

export function openRuns(options: RunsOptions): Promise<Outcome<Runs>>;

export type Runs = EventSink & {
  readonly startAction: (reference: string, input: Json, options?: { readonly id?: string }) => Promise<Outcome<RunView>>;
  readonly startWorkflow: (
    workflow: { readonly mode: string; readonly path: string },
    input: Json,
    options?: { readonly id?: string },
  ) => Promise<Outcome<RunView>>;
  readonly submit: (token: string, submission: Submission) => Promise<Outcome<RunView>>;
  readonly approve: (runId: string, stepKey: string, decision: ApprovalDecision) => Promise<Outcome<RunView>>;
  readonly resume: (runId: string, how?: Resumption) => Promise<Outcome<RunView>>;
  readonly wakeDue: () => Promise<readonly Outcome<RunView>[]>;
  readonly read: (runId: string) => Promise<Outcome<RunView>>;
  readonly list: () => Promise<readonly RunSummary[]>;
  readonly task: (token: string) => Promise<Outcome<TaskAt>>;
  readonly newToken: (runId: string) => Promise<Outcome<string>>;
  readonly callFor: (
    token: string,
    call: { readonly reference: string; readonly input: Json; readonly caller?: string },
  ) => Promise<Outcome<RunView>>;
  readonly toolCalled: (token: string, call: { readonly tool: string; readonly ok: boolean }) => Promise<void>;
  readonly close: () => void;
};

export type RunState =
  | { readonly status: "running" }
  | { readonly status: "waiting"; readonly waiting: Waiting }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string; readonly undo: Json };

export type Waiting =
  | { readonly reason: "skill"; readonly stepKey: string; readonly task: SkillTask }
  | { readonly reason: "approval"; readonly stepKey: string; readonly question: string; readonly hash: string;
      readonly content: Json; readonly previousHash?: string }
  | { readonly reason: "time"; readonly stepKey: string; readonly until: string }
  | { readonly reason: "budget"; readonly stepKey: string; readonly overrun: Json }
  | { readonly reason: "owner"; readonly stepKey: string; readonly question: string };

export type StepView = {
  readonly key: string;
  readonly kind: string;
  readonly status: "started" | "done" | "failed";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input: Json;
  readonly output?: Json;
  readonly reason?: string;
  readonly detail: Json;
};

export type RunView = RunSummary & {
  readonly state: RunState;
  readonly spent: Spend;
  readonly steps: readonly StepView[];
  readonly events: readonly RunEvent[];
  readonly askedBy?: { readonly runId: string; readonly stepKey: string };
  readonly token?: string;
};

export type RunSummary = {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly target: { readonly kind: "action" | "workflow"; readonly mode: string; readonly name: string };
  readonly status: RunState["status"];
  readonly waitingFor?: { readonly reason: Waiting["reason"]; readonly stepKey: string };
};

export type ApprovalDecision = { readonly hash: string; readonly decision: "approve" | "reject"; readonly by: string };

export type Resumption =
  | { readonly kind: "continue"; readonly rerun: boolean }
  | { readonly kind: "extend"; readonly extra: Readonly<Record<string, number>> }
  | { readonly kind: "stop" };

export type TaskAt = {
  readonly waitingKey: string;
  readonly task: SkillTask;
  readonly mode: LoadedMode;
  readonly skillFile: string;
  readonly toolCalls: number;
};
```

Rules a caller must know, and nothing else:
- Every problem is an `Outcome` refusal. Nothing throws; an unexpected error becomes a refusal naming `bay resume <run>`.
- `token` is set only on the result of a call that entered a new skill wait (new step or round). It is shown once; `newToken` replaces it. It dies when the run leaves that wait.
- `resume` with `extend` refuses an unknown measure or a negative amount. `list` is newest first. `read` includes the events.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). The runner needs the event sink, and the runs need the runner, so the runner is a factory:
```ts
const runs = await openRuns({
  system: loaded.value, project: layout.project, folders: ports.folders, files: ports.files,
  clock: ports.clock, scrubber: secrets,
  runner: (events) => createScriptRunner({ ...shared, events }),
});
if (!runs.ok) { return runs; }
const brokerFor = (place: StepPlace, permissions: Permissions): Broker =>
  new Broker({ ...shared, events: runs.value, place, permissions });
```
`Kernel` loses `store`, `engine` and `runner` and gains `runs: Runs`. `close` calls `runs.close()`.

`bay call`: `kernel.runs.startAction(form.reference, input)` or `kernel.runs.startWorkflow({ mode, path }, input)`, then `runOutput(kernel, result)`.

`bay approve`: the confirmation text reads the waiting approval through `read`.
```ts
const run = await kernel.runs.read(decision.runId);
const waiting = run.ok && run.value.state.status === "waiting" ? run.value.state.waiting : undefined;
const result = await kernel.runs.approve(decision.runId, decision.stepKey, { hash, decision: verdict, by });
```

`bay resume`: `kernel.runs.resume(form.runId, form.how)` for continue, extend and stop; `kernel.runs.wakeDue()` for `--due`. `skillWaitOf` is gone: the token arrives on the result.

`bay runs`:
```ts
const runs = await kernel.runs.list();
const shown = await kernel.runs.read(runId);
const token = invocation.flags.has("new-token") ? await kernel.runs.newToken(runId) : undefined;
```

`bay submit`: checks that the token is for the run and step on the command line, then submits.
```ts
const at = await kernel.runs.task(token);
if (!at.ok || at.value.task.place.runId !== runId || at.value.waitingKey !== stepKey) { return refused(...); }
return runOutput(kernel, await kernel.runs.submit(token, { output, spent }));
```

Agent tools, `submit`: `kernel.runs.submit(call.token, { output, spent })`; a `token` on the result means a new round, and it goes back to the agent with the feedback.
Agent tools, `call_action`: `kernel.runs.callFor(call.token, { reference, input, caller })`. The skill's Tools list and the read-only check stay in agent-tools.
Agent tools, every tool: `kernel.runs.task(token)` gives the step, mode, skill file and calls used this round; afterwards `kernel.runs.toolCalled(token, { tool: name, ok })`.

## 3. What the implementation hides, and the line counts

Hidden: the store and its record shapes, the lock and heartbeat, the step-key text, step details and their codec, budget frames and measures, the waiting state as stored, scrubbing at write, task-token hashing, the asked-by and tool-call events, the run id and engine owner.

| File today | Lines | After | Lines |
|---|---|---|---|
| engine.ts | 546 | `runs/runs.ts` (entry; closure, no class) | 470 |
| waiting.ts, run-state.ts | 83 + 49 | merged into `runs/runs.ts` | (in 470) |
| task-tokens.ts (agent-tools today) | 90 | merged into `runs/runs.ts` and `runs/record.ts` | (in 470, 640) |
| sqlite-run-store.ts | 569 | `runs/record.ts` (private seam) | 640 |
| run-store.ts | 151 | merged into `runs/record.ts`; `RunStore` type deleted | (in 640) |
| scrubbed-store.ts | 83 | deleted; scrubbing is one call in the record's JSON encoder | 0 |
| walk.ts | 219 | `runs/walk.ts` | 190 |
| action-steps.ts | 510 | `runs/action-steps.ts` | 490 |
| workflow-steps.ts | 288 | `runs/workflow-steps.ts` | 280 |
| skill-steps.ts | 80 | `runs/skill-steps.ts` | 80 |
| undo.ts | 146 | `runs/undo.ts` | 140 |
| budget.ts | 136 | `runs/budget.ts` (extend validation moves in) | 120 |
| step-key.ts | 219 | `runs/step-key.ts`; parser and text become file-private | 200 |
| step-detail.ts | 184 | `runs/step-detail.ts` | 184 |
| **Feature** | **3,353** | | **~2,800** |

Callers: tools.ts 335 to 285, run-report.ts 321 to 255, kernel.ts 132 to 120, approve 121 to 108, resume 122 to 95, runs 52 to 30, submit 92 to 85, call 95 to 92: 1,270 to ~1,070. Tests: 2,835 to ~2,050. All three together: ~7,460 to ~5,920.

## 4. Dependency strategy

- **Script runner** sits at the `runner` factory. Real: `createScriptRunner`. Test: the fixture's fake runner, which records calls and can hold a step open.
- **Clock** sits at `clock`. Real: `systemClock`. Test: `fakeClock`. `wakeDue` reads it; callers no longer pass `now`.
- **Files** sits at `files`, for schema checks. Real: `nodeFileSystem`. Test: `fakeFileSystem`.
- **Folders** sits at `folders`, so the record makes the data file owner-only without importing platform code. Real: `nodeFolders`. Test: `fakeFolders`. This clears the debt entry `sqlite-run-store.ts -> owner-only.ts`.
- **Database**: `runs/record.ts` is a private seam with one adapter, SQLite at `<project>/.agentbay/kernel.db`. Only `runs/runs.ts` imports it.
- **Policy, system, scrubber**: plain values (`PolicedSystem`, a real `SecretStore` built from a test environment).

## 5. Testing through the interface only

Setup. A test calls `openTestRuns({ scripts, changes })` from the fixture. It makes a temp project folder, loads the fixture system with the real policy, and opens `Runs` with the fake runner, `fakeClock`, `fakeFileSystem`, `fakeFolders` and a real `SecretStore`. It returns `runs`, `runner`, `clock` and `reopen()`. `reopen()` opens a second `Runs` on the same folder: that is the "fresh engine".

Assertions. Only on `RunView`, `RunSummary`, `TaskAt`, refusal messages, and the runner's recorded calls. Step keys are asserted as the owner sees them (`"0#1"`), because they are shown in `bay runs`.

Crashes. Today a store wrapper throws before or after write N. With no store port, a crash is made the way it happens for real: the database becomes unwritable. The test holds `begin immediate` on a second SQLite connection, started from the fake runner (inside a step) or from the clock (on its Nth reading, before a write). The run's next write fails and comes back as a refusal. The test then closes the blocker, advances the clock past the stale lock, calls `reopen()`, resumes, and asserts the same rules as today: at most one step unfinished, a write step waits for the owner, nothing runs twice unasked, the output is `{ count: 5 }`.

Locks. A runner script that waits on a promise holds a run open; a second `Runs` from `reopen()` is refused with "being advanced by". The multi-process test keeps its two processes, each calling `openRuns`.

The 45 names only tests use:
- `MemoryRunStore` and its 14 store types: deleted with `tests/memory-run-store.ts` (220 lines).
- 13 step-key names and 15 budget names: un-exported. `step-key.test.ts` and `budget.test.ts` are deleted. Their cases become about 60 lines of interface tests: nested budgets wait on overrun, extend with a bad measure is refused, a foreach item's key is shown.
- `gate`, `replayed`, `stopGate`, `Walk`, `decodedStepDetail`, `stepDetailJson`: un-exported; covered by stop, replay and reopen tests.
- `stepKeyText` and `parseStepKey` leave the dead-code exemption list (ADR 0009).
- `run-store.test.ts` (427) is rewritten as about 150 lines: persistence across `reopen`, locks, stale locks, token death.

## 6. Where task tokens, the run report and undo sit

- **Task tokens: inside runs.** A token is valid only while its run waits at its step and round. That is run state, kept in the same database and changed by the same writes. Inside, a token dies in the same transaction that ends the wait, not lazily on the next check. Callers stop needing `readRun` and the stored state.
- **Undo: inside runs, private.** The engine starts undo when a run fails, and undo writes steps with undo keys in the same walk. It has no caller outside. The owner sees its result as the `undone` state.
- **Run report: outside, in command-line.** It turns a `RunView` into terminal text and JSON. That is presentation, it changes for different reasons, and it needs `agentName` from harness. It now reads only `RunView` and `RunSummary`.

## 7. Trade-offs

What gets harder:
- Every test pays for a temp SQLite file, and the crash test loops over many points.
- A crash right before `release` can no longer be placed exactly; it shows up as a stale lock.
- A caller who wants a new kind of question about runs (for example "all runs of a mode") needs a new method, not a store call.
- `openRuns` takes a runner factory because the runner needs the runs' event sink. That is a small cycle made visible.

**Strongest argument against this design.** Durability is the whole point of this feature, and the crash test is its most valuable test. Today it is exact: it fails the store before or after every single write, on a cheap in-memory adapter. Removing the store port replaces that with a blocked database triggered from the clock and the runner. That ties the test to when the engine happens to read the clock before each write, a hidden ordering that a harmless refactor can break, and it may quietly stop covering some crash points. A reviewer could fairly say the in-memory store is the second adapter, and that the port earns its keep through this one test.

## 8. Migration

Each slice leaves `npm run check` green and deletes what it replaces (ADR 0009).

1. **Move.** Move the 14 files into `bay/runs/`, `engine.ts` becoming `runs/runs.ts`. Update imports and `features.yaml`. No behaviour change.
2. **SQLite-only tests.** The fixture opens a temp project folder. Rewrite the crash test on a blocking connection. Delete `tests/memory-run-store.ts` and `storeKinds`.
3. **Scrub at write.** Move scrubbing into the record's JSON encoder. Delete `scrubbed-store.ts`. `engine-scrub.test.ts` keeps passing unchanged.
4. **Read and list.** Add `read` (with waiting and events) and `list`. Switch `run-report.ts`, `bay runs`, `bay approve`. Delete `storedWaiting`, `runStatuses` and `skillWaitOf`; `token` on results replaces the token choice.
5. **Tokens inside.** Move task tokens into runs; add `task`, `newToken`, `toolCalled`, `callFor`; `submit` takes a token. Switch `tools.ts` and `bay submit`. Delete `task-tokens.ts`, `TaskTokenStore`, `askedByKind` and `Kernel.store`.
6. **Open runs.** `openRuns` replaces `new Engine` and `SqliteRunStore.open` in the kernel; the class becomes a closure; `resume` absorbs `extendBudget` and `stop`; `tick` becomes `wakeDue`; extend validation moves in. Delete `Kernel.engine`, `Kernel.runner` and `measures` from `bay resume`.
7. **Tests at the interface.** All engine tests import only `bay/runs/runs.ts`. Rewrite `run-store.test.ts`; delete `budget.test.ts` and `step-key.test.ts`; un-export internals; remove the two step-key exemptions.
8. **Seams and debt.** Pass `Folders` and `PolicedSystem`; delete `fakePolicy` and the test scrubber. Remove every debt entry whose `from` or `to` is a runs file and that is now gone.
