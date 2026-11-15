# Runs as one deep module: design A, the smallest interface

Constraint: the fewest exported names and the fewest things a caller must know. Callers never see a store
record, a step key they must build or parse, a waiting state or a budget measure.

## 1. The interface

One entry file, `bay/runs.ts`. It exports three names.

```ts
export function openRuns(options: {
  readonly project: string;
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly scrubber: Scrubber;
  readonly clock: Clock;
  readonly files: FileSystem;
  readonly folders: Folders;
  readonly scripts: (events: EventSink) => ScriptRunner;
}): Promise<Outcome<Runs>>;

export type Runs = {
  readonly start: (
    target: string,
    input: Json,
    from?: { readonly caller?: string; readonly token?: string },
  ) => Promise<Outcome<Run>>;
  readonly act: (
    runId: string,
    act:
      | { readonly do: "resume"; readonly rerun?: boolean }
      | { readonly do: "extend"; readonly by: Readonly<Record<string, number>> }
      | { readonly do: "stop" }
      | { readonly do: "approve" | "reject"; readonly hash: string; readonly by: string }
      | { readonly do: "new-token" },
  ) => Promise<Outcome<Run>>;
  readonly submit: (token: string, submission: Submission) => Promise<Outcome<Run>>;
  readonly task: (token: string) => Promise<Outcome<SkillTask>>;
  readonly wake: () => Promise<readonly Outcome<Run>[]>;
  readonly show: (runId: string, detail?: { readonly full?: boolean; readonly events?: boolean }) => Promise<Outcome<Run>>;
  readonly list: () => Promise<readonly Run[]>;
  readonly events: EventSink & { readonly read: (runId: string) => Promise<readonly RunEvent[]> };
  readonly close: () => void;
};

export type Run = {
  readonly id: string;
  readonly status: "running" | "waiting" | "done" | "failed" | "undone";
  readonly output: Json;
  readonly reason: string;
  readonly token: string | undefined;
  readonly json: Json;
  readonly text: string;
};
```

Exported names: **3** (`openRuns`, `Runs`, `Run`). Today: 16 used by the kernel, 45 more by tests. Every
other type in the signatures already exists in `contracts.ts`, `ports.ts`, `registry.ts` or `outcome.ts`.

What a caller must know, in full:
- `target` is `mode.action` or `mode:path/to/workflow.yaml`. A colon means a workflow.
- `from.token` makes the run a call from a waiting skill step. Its spend is charged to that step and its
  budget is what that run has left. `from.caller` names the calling mode for bindings.
- A task token names one round of one waiting skill step. `submit` and `task` take only the token.
- `Run.output` is the output when `done`, else `null`. `Run.reason` is one sentence: why it failed or was
  undone, or what it waits for. It is `""` when done.
- `Run.token` is set only when this call issued a fresh token. `start` and `act` issue one when the run comes
  to wait at a new skill round. `submit` issues one only for a new round of the submitted step, so an agent
  never receives another step's token. `act(id, { do: "new-token" })` replaces the token of the waiting task.
- `Run.json` and `Run.text` are the run report the owner reads. From `list`, they are the one-line forms.
- Every method returns problems as values: sentences with a fix. Only a dead database throws.
- One writer per run at a time; a second is refused with "try again"; a lock silent ten minutes is taken over.
- Budget measures are not part of the interface. `extend` takes any names; an unknown name is refused with
  a sentence that lists the measures.

## 2. Usage by each caller

Kernel wiring (`bay/kernel.ts`). The runner needs the event sink and the runs need the runner: a factory.

```ts
const runs = await openRuns({
  project: layout.project, system, policyOf, scrubber: secrets, clock: ports.clock,
  files: ports.files, folders: ports.folders,
  scripts: (events) => createScriptRunner({ ...services, events, clock: ports.clock, childProcesses: ports.childProcesses }),
});
const brokerFor = (place: StepPlace, permissions: Permissions): Broker =>
  new Broker({ ...services, events: runs.value.events, clock: ports.clock, place, permissions });
```

`Kernel` loses `store`, `engine` and `runner`, and gains `runs: Runs`. A bay command prints `run.json` and `run.text`; the exit code is 1 when the status is `failed` or `undone`.

```ts
// bay call notes.add '{"count":1}'      and      bay call --workflow notes:workflows/daily.yaml
printed(await kernel.runs.start(form.target, input));
// bay approve <run> --hash <hash> [--reject]
const shown = await kernel.runs.show(runId);
const answer = await terminal.ask(`Approve ${shown.ok ? shown.value.text : runId}\nType yes to confirm: `);
printed(await kernel.runs.act(runId, { do: "approve", hash, by: "owner at the terminal" }));
// bay resume <run> [--rerun | --extend usd=2,items=5 | --stop]     and     bay resume --due
printed(await kernel.runs.act(runId, { do: "extend", by: { usd: 2, items: 5 } }));
const woken = await kernel.runs.wake();
// bay runs     and     bay runs <run> [--full] [--events] [--new-token]
const all = await kernel.runs.list();
printed(newToken ? await kernel.runs.act(runId, { do: "new-token" }) : await kernel.runs.show(runId, { full, events }));
// bay submit <json | @file | -> --token <token> [--tokens n] [--usd x]
printed(await kernel.runs.submit(token, { output, spent }));
```

The agent tools (`bay/tools.ts`):

```ts
const task = await kernel.runs.task(token);
if (!task.ok) {
  return task;
}
// submit
const run = await kernel.runs.submit(token, { output, spent });
if (!run.ok) {
  return { ok: true, value: { accepted: false, problems: run.problems.map((problem) => problem.message) } };
}
const retry = run.value.token === undefined ? {} : { token: run.value.token };
const ended = run.value.status === "failed" || run.value.status === "undone";
return { ok: true, value: { accepted: !ended && run.value.token === undefined, ...retry, run: run.value.json } };

// call_action
const called = await kernel.runs.start(`${target.mode.manifest.name}.${target.name}`, input, { token, ...caller });
```

The submit tool's reply changes shape: feedback and round are read from `run.json`, not from separate fields.
The tool-call cap writes and counts `tool.called` events through `runs.events`, keyed by the task's place
and round from `SkillTask`. The tools carry that text; they never build or parse it.

## 3. What the implementation hides, and what happens to each file

Hidden: the store records, the lock protocol, step-key text, step details, the waiting states, budget
frames and measures, scrubbing on write, task-token hashing, the `run.asked-by` event, undo, and the report.

| File | Lines today | After | What happens |
|---|---|---|---|
| bay/engine.ts | 546 | 470 | Becomes the entry bay/runs.ts. The class becomes a closure that `openRuns` returns. `resume`, `extendBudget`, `stop`, `approve` fold into `act`; `startForSkill` into `start`; `tick` into `wake`. |
| action-steps, workflow-steps, skill-steps, undo, step-detail | 1,208 | 1,208 | Unchanged, private. |
| bay/walk.ts | 219 | 215 | `gate`, `replayed`, `stopGate` stop being test targets. |
| bay/waiting.ts | 83 | 0 | Merged into the report and into `task`. |
| bay/budget.ts | 136 | 120 | `measures` and the helpers become private; `noSpend` and frame tests go. |
| bay/run-state.ts | 49 | 0 | Its types merge into run-records.ts, unexported outside the feature. |
| bay/run-store.ts | 151 | 100 | Renamed run-records.ts: record shapes, private. The `RunStore` and `TaskTokenStore` port types go. |
| bay/sqlite-run-store.ts | 569 | 590 | Absorbs scrubbing (about 45 lines). Loses `implements`, `SqliteOptions`, `listRuns(status)`. |
| bay/scrubbed-store.ts | 83 | 0 | Deleted; the SQLite store redacts on write with `redactJson` of the secret store. |
| bay/step-key.ts | 219 | 200 | `stepKeyText` and `parseStepKey` become unexported. Two dead-code exemptions go. |
| bay/task-tokens.ts (from agent-tools) | 90 | 60 | Moves in. `checkTaskTokenFor` and `TokenStores` go. |
| bay/run-report.ts (from command-line) | 321 | 270 | Moves in. `engineOutput`, `skillWaitOf`, `runOutput` and `CommandResult` go. |
| **Feature total** | **3,674** | **3,233** | |

Callers, today to after: kernel.ts 132 to 120; tools.ts 335 to 290 (`stepOfToken`, `recordAskedBy`,
`settledSubmission` go); commands/approve.ts 121 to 105; commands/resume.ts 122 to 95 (no `measures`, no
`skillWaitOf`); commands/runs.ts 52 to 25; commands/submit.ts 92 to 70; commands/call.ts 95 to 85.
Callers total: **949 to 790**.

Tests: 2,835 to about 1,850 lines (section 5). Overall: **7,458 lines to about 5,870**.

Debt: the 13 `feature-map-debt.yaml` entries whose `to` is a runs file go, and so do the entries from
`run-report.ts` and `task-tokens.ts`. The 11 entries from runs files to other features' private files
(`targets.ts`, `spec.ts`, `effect-rule.ts`, `references.ts`, `owner-only.ts`) are those features' debt.

## 4. Dependency strategy

| Need | Seam | Real adapter | Test adapter |
|---|---|---|---|
| Script runner | `scripts` factory in `openRuns` | `createScriptRunner` (scripts feature) | fake runner from a map of script to result |
| Policy | `policyOf` | from `loadPolicedSystem` | `fakePolicy` |
| Secrets scrubber | `scrubber` | `SecretStore` | regex scrubber of `SECRET-...` |
| Clock | `clock` | `systemClock` | `fakeClock` |
| Files (schemas, skills) | `files` | `nodeFileSystem` | `fakeFileSystem` |
| Owner-only file | `folders` | `nodeFolders` | `fakeFolders` |
| Database | none | SQLite at `<project>/.agentbay/kernel.db` | the same, in a temp folder |

The database is not a port. Its second adapter today, `MemoryRunStore`, serves only tests and makes every
engine test run twice. It is deleted, and with one adapter left the `RunStore` type goes. The system is data.

`runs` adds `harness` to its `may_import` for `agentName`, used by the report's task.

## 5. Testing through the interface only

A test sets up a temp project folder, a system from the existing fixture YAML, the fake runner, the fake
clock, the fake files and the regex scrubber, then calls `openRuns`. It asserts only on `Run` fields, on
`problems`, on `runs.events.read`, and on what the fake runner was asked to run.

- Durability: open a second `Runs` on the same folder, advance the clock, `act(id, { do: "resume" })`.
- Crashes between writes: a test helper adds SQLite triggers to kernel.db that raise on the Nth write. The
  write fails, its transaction rolls back, and every later write fails. The helper then drops the triggers
  and the test resumes on a fresh `Runs`. This covers "before write N" and "after write N - 1" with the real
  store. It replaces the crashing wrapper around `RunStore`.
- Locks: two `Runs` on one file. Approvals: the test reads the hash from `run.json`.
- Skill steps: the test takes `run.token` from the `start` result and calls `submit` and `task`.
- Ids: tests read `run.id`. The `id`, `owner`, `newId` and `busyMilliseconds` options are gone.

The 45 names only tests use are all unexported or deleted, with their tests. Test files, today to after:
- Deleted: budget.test.ts 79 (rules asserted via `extend` and budget waits), step-key.test.ts 113 (keys are
  private text), run-store.test.ts 427 (locks, takeover, round-trips asserted via `Runs`),
  memory-run-store.ts 220, engine-parts.test.ts 139 (its targets test, about 60 lines, moves to targets).
- The six other engine*.test.ts, 1,473, become runs*.test.ts, about 1,450: one store, plus token and
  report tests. task-tokens.test.ts folds in.
- engine-fixture.ts 384 becomes runs-fixture.ts, about 330, with the trigger helper.

Bug injection check: flip one line in `walk.ts`, `undo.ts`, `budget.ts`, `step-key.ts`; a runs test fails.

## 6. Where task tokens, the run report and undo sit

- **Task tokens: inside runs.** A token is bound to one round of a waiting step and dies when the step moves
  on. The tokens table is already in kernel.db and the store already deletes tokens. Inside, `submit` checks
  the token and the waiting step under the same lock, so the separate `checkTaskTokenFor` check goes.
- **The run report: inside runs.** It reads every hidden shape: states, steps, waiting, events. Left outside,
  it would force the waiting shape into the interface. The command line only prints it.
- **Undo: inside runs, private.** It runs when the main phase fails; its result is a status. No caller starts it.

## 7. Trade-offs

What this makes harder:
- The report is the only view of a run. A caller needing one detail, such as a hash, reads `run.json`.
- Owner-facing wording and CLI hints ("decide with: bay approve ...") now live in the engine feature.
- The database cannot be swapped, and crash tests know the table names of kernel.db.
- The CLI changes: `bay approve <run> --hash` with no step key; `bay submit --token` with no run or step.
- After a submit, the next step's token is withheld; the coordinator needs `bay runs <id> --new-token`.
- Without `id` and `busyMilliseconds`, tests are less deterministic and one is 3 seconds slower.

**The strongest argument against it.** Hiding the waiting state behind `json` does not remove that interface.
It makes it untyped. The approve command, the submit tool, the mode tests and the harness coordinator still
depend on fields such as `waiting.hash`, `task.feedback` and `task.round`. The compiler no longer checks that
dependency, and a report change can break a caller with every check still green. The count of three names
understates what callers must know.

## 8. Migration

Each slice leaves `npm run check` green and deletes what it replaces (ADR 0009).
1. **One store.** Delete `tests/memory-run-store.ts` and the store-kind loop. Rewrite the crash tests with the
   SQLite trigger helper. Fold `run-store.test.ts` behaviours into engine tests and delete it.
2. **Scrub on write.** Move redaction into the SQLite store; delete `scrubbed-store.ts` and the `RunStore`
   port type.
3. **Tokens inside.** Move `task-tokens.ts` into runs. Make the engine's submit take the token. Change
   `bay submit` and the submit tool. Delete `checkTaskTokenFor`. Update features.yaml and the debt file.
4. **Report inside.** Move `run-report.ts` and `waiting.ts` into runs. The engine returns `Run` with `json`,
   `text` and `token`. Add `show`, `list`, `task`. `bay approve` drops the step key. Delete `storedWaiting`,
   `skillStepAt`, `engineOutput`, `skillWaitOf`.
5. **One entry.** Create `bay/runs.ts` with `openRuns`; fold the engine methods into `act`, `start`, `wake`.
   The kernel holds `runs`. Delete `engine.ts`, `run-state.ts` and the exports of `kernelDatabaseFile`,
   `runStatuses`, `measures`, `SqliteRunStore`.
6. **Tests at the interface.** Rename engine tests to runs tests. Delete `budget.test.ts`,
   `step-key.test.ts`, `engine-parts.test.ts`. Unexport `stepKeyText` and `parseStepKey` and remove their
   dead-code exemptions. Clear the last runs entries from `feature-map-debt.yaml`.
