# Broker as one sealed feature: design B, from the mode's author outward

Constraint: start from the commonest caller, the author of a mode's script, and let the inside follow. The author
is often a builder agent that reads `bay/sdk.ts` and nothing else of the kernel.

## 0. What the author should see, decided first

| Today | In this design |
|---|---|
| `sdk.ts` borrows its types from five files. An author who follows `CommandRequest` lands in `contracts.ts`. | `sdk.ts` declares every shape an author can reach. It is the one page to read. |
| No comments (P-01), so nothing says what `files.link` is for or which manifest line allows it. | Each operation carries one sentence and the manifest lines that allow it. A listing, `framework/toolbox.md`, is generated from the table and `sdk.ts`. |
| A command's fixed part is written twice: 22 lines of `mode.yaml` and again in `scripts/lib/git.ts:3-21,55-58`. The script rebuilds the words the manifest lists and the broker compares them. | A command is listed under a name, once. The script gives the name and the arguments that vary. |
| Four modes each wrote "if the answer is not ok, fail with its message" (`copies.ts:8`, `commands.ts:30`, `sql.ts:9`, `calls.ts:5`). | `valueOf(answer)` in the toolbox (ADR 11: between modes, the toolbox). |
| Agent tools use `Broker` methods; scripts use `ScriptContext`; a mode test starts a child process to get either. | One face. The kernel hands out the same `Operations` object the script sees, built without a child. |
| Adding an operation means finding six files. | Write the method in `sdk.ts`. The compiler then names the two entries that are missing. |

What a script looks like before and after, from `git-worktrees/scripts/lib/git.ts`:

```ts
const command = ["git", ...optionsFor(subcommand), ...gitArguments];
const answer = await context.commands.run({ command, folder, timeLimitSeconds });
if (!answer.ok) {
  return fail(answer.message);
}
```

```ts
const ran = valueOf(await context.commands.run({ command: "changes", arguments: [], folder, timeLimitSeconds }));
```

Everything below serves that table.

## 1. The entry files

`bay/sdk.ts`, the toolbox. Its type imports are `Json` and `Answer` and nothing else. What changes:

```ts
export type Operations = {
  readonly db: DatabaseStatements & { readonly partition: (name: string) => DatabasePartition };
  readonly files: { readonly read: (path: string) => Promise<Answer<string>> };
  readonly commands: { readonly run: (request: CommandRequest) => Promise<Answer<CommandRan>> };
  readonly call: (reference: string, input: Json) => Promise<Answer<Json>>;
  readonly spend: (spending: Spending) => Promise<Answer<null>>;
};

export type StepFacts = {
  readonly settings: Readonly<Record<string, Json>>;
  readonly now: () => Date;
  readonly caller: string | undefined;
  readonly skillInput: Json | undefined;
};

export type ScriptContext = Operations & StepFacts;

export type CommandRequest = {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly folder: string;
  readonly timeLimitSeconds: number;
  readonly input?: string;
};

export function valueOf<Value>(answer: Answer<Value>): Value;
```

(`Operations` is shortened; it has today's members.) `ScriptContext` has the same members as today. The shapes
`SqlParameters`, `Row`, `ExecuteResult`, `AgentQueryResult`, `HttpRequest`, `HttpResponse`, `CommandEnd`,
`CommandOutput` and `CommandRan` are declared here and no longer in four other files.

`bay/broker/broker.ts`, for the kernel. Eleven names:

```ts
export function createBroker(services: BrokerServices): Broker;

export type Broker = {
  readonly scripts: ScriptRunner;
  readonly forStep: (place: StepPlace, permissions: Permissions) => StepOperations;
};

export type StepOperations = {
  readonly operations: Omit<Operations, "call" | "spend">;
  readonly close: () => void;
};

export function reachOf(permissions: Permissions): Reach;

export type Reach = {
  readonly writableFolders: readonly string[];
  readonly removesFiles: boolean;
  readonly commands: readonly string[];
};

export function submissionRefusal(spentUsd: number, effects: readonly Effect[], at: ActionAt): Refusal | undefined;

export function listedOperations(): readonly ListedOperation[];

export type ListedOperation = {
  readonly name: string;
  readonly summary: string;
  readonly needs: string;
  readonly allowedBy: readonly string[];
};

export const sdkSpecifier = "agentbay/sdk";
```

`BrokerServices` is today's `ScriptRunnerOptions`. `BrokerLimits` and `ActionAt` are the other two names. Agent
tools write `step.operations.files.read(path)`. The harness asks `reachOf`. Runs asks `submissionRefusal`. The
listing generator, a development tool next to `schemas/generate-types.ts`, asks `listedOperations`.

## 2. One operation, in full

The types of every operation come from `sdk.ts`. Nothing restates a request. `bay/broker/faces.ts`, which the
child and the kernel both read:

```ts
export type Methods = {
  readonly "db.query": InPartition<DatabaseStatements["query"]>;
  readonly "files.read": Operations["files"]["read"];
  readonly "commands.run": Operations["commands"]["run"];
};

export type OperationName = keyof Methods;

export type Given<Name extends OperationName> = Parameters<Methods[Name]>;

type Results = { readonly [Name in OperationName]: AnswerValueOf<Methods[Name]> };

export type Face<Name extends OperationName> = {
  readonly summary: string;
  readonly given: (values: readonly Json[]) => Given<Name> | undefined;
  readonly result: (value: Json) => value is Json & Results[Name];
};

export const faces: { readonly [Name in OperationName]: Face<Name> } = {
  "db.query": {
    summary: "When a script needs rows from its mode's own database.",
    given: statementGiven,
    result: isRows,
  },
  "files.read": {
    summary: "When a script needs the text of a file its mode may read.",
    given: ([path]) => (isText(path) ? [path] : undefined),
    result: isText,
  },
  "commands.run": {
    summary: "When a script of a base mode needs a program run that its mode lists by name.",
    given: ([request]) => {
      const parsed = commandRequestOf(request);
      return parsed === undefined ? undefined : [parsed];
    },
    result: isCommandRan,
  },
};
```

`Given<"files.read">` is `[path: string]`. `InPartition` puts the partition, or `null`, in front of a database
method's own parameters; four entries use it. Three of the 16 keys are shown.

The kernel's half sits in one file per member of `Operations`, named as the author names it:
`bay/broker/operations/commands.ts`, `files.ts`, `db.ts` and so on.

```ts
export type Needs<Name extends OperationName> =
  | { readonly when: "always"; readonly needs: readonly Need[] }
  | {
      readonly when: "by-request";
      readonly inWords: string;
      readonly needs: (given: Given<Name>, grants: ModeGrants) => readonly Need[];
    };

export type Operation<Name extends OperationName> = {
  readonly resource: Resource;
  readonly allowedBy: readonly string[];
  readonly needs: Needs<Name>;
  readonly asked: (given: Given<Name>, step: Step) => string;
  readonly refusalDetail: (given: Given<Name>) => { readonly [key: string]: Json };
  readonly answer: (given: Given<Name>, step: Step) => Promise<Answer<Results[Name]>>;
};
```

`commands.run`:

```ts
export const commandsRun: Operation<"commands.run"> = {
  resource: "commands",
  allowedBy: ["resources.commands.<name>"],
  needs: {
    when: "by-request",
    inWords: "the effects its listed command declares",
    needs: ([request], grants) => commandNeeds(request.command, grants.commands[request.command]),
  },
  asked: ([request]) =>
    `run the listed command ${request.command} with ${JSON.stringify(request.arguments)} in ${request.folder}`,
  refusalDetail: ([request]) => ({ command: request.command, arguments: request.arguments, folder: request.folder }),
  answer: async ([request], step) => {
    const listed = step.grants.commands[request.command];
    if (listed === undefined) {
      return refused(unlistedCommand(request, step));
    }
    const milliseconds = commandMilliseconds(request, step);
    if (!milliseconds.ok) {
      return milliseconds;
    }
    const folder = await commandFolder(request, step);
    if (!folder.ok) {
      return folder;
    }
    const words = [...wordsOf(listed.run), ...request.arguments];
    return ranCommand({ words, request }, { folder: folder.value, milliseconds: milliseconds.value }, step);
  },
};
```

`files.read`:

```ts
export const filesRead: Operation<"files.read"> = {
  resource: "files",
  allowedBy: ["resources.files.read", "resources.files.write"],
  needs: { when: "always", needs: [] },
  asked: ([path], step) => `read ${shownIn(step.layout, path)}`,
  refusalDetail: () => ({}),
  answer: async ([path], step) => {
    const checked = await checkedPath(path, "read", step);
    if (!checked.ok) {
      return checked;
    }
    const text = await step.files.readText(checked.value);
    return text === undefined ? failed(`The file ${checked.value} does not exist.`) : granted(text);
  },
};
```

Where each part lives:

| Part | Where |
|---|---|
| Request shape, result shape | `sdk.ts`, as the method's parameters and its answer |
| Request guard, result guard, the author's sentence | `faces[name]` |
| Needed effects | `needs`, as data when fixed, so the listing prints them |
| Grant check | The first lines of `answer`; `allowedBy` names the manifest lines for the listing |
| Refusal wording | `asked`; grant refusals beside their check; the effect refusal once, in `rule.ts`. Sentences stay as today, except for commands |
| Event record | `refusalDetail`, and `step.record` in `answer` |
| Handler | `answer` |

`broker.ts` joins the entries into `{ readonly [Name in OperationName]: Operation<Name> }`. A missing entry does
not compile.

## 3. One path for every caller

There is one function that answers, and both the script runner and `forStep` call it:

```ts
export async function answered<Name extends OperationName>(
  name: Name,
  values: readonly Json[],
  step: Step,
): Promise<Answer<Json>> {
  const given = faces[name].given(values);
  if (given === undefined) {
    return malformed(name);
  }
  const operation = operations[name];
  const doing = operation.asked(given, step);
  const refusal = effectRefusal({ resource: operation.resource, doing, needs: neededBy(operation, given, step) }, step);
  try {
    const answer = refusal === undefined ? await operation.answer(given, step) : refused(refusal);
    return await settled(answer, step, operation.refusalDetail(given));
  } catch (error) {
    return settled(failed(`The step ${step.at.stepKey} could not ${doing}: ${errorLine(error)}`), step, {});
  }
}
```

A request from an agent's tool is parsed by the same guard as one from the child. That costs a guard pass in
process and buys one path (S1, S7).

`Operations` is built once, at the bottom of `faces.ts`, over any way of asking:

```ts
export type Ask = (name: OperationName, given: readonly unknown[]) => Promise<Answer<Json>>;

export function operationsOver(ask: Ask): Operations {
  const method =
    <Name extends OperationName>(name: Name) =>
    async (...given: Given<Name>): Promise<Answer<Results[Name]>> =>
      narrowed(await ask(name, given), faces[name].result);
  return {
    files: { read: method("files.read"), write: method("files.write") },
    commands: { run: method("commands.run") },
    call: method("call"),
    spend: method("spend"),
  };
}
```

The child passes an `ask` that writes a line and waits. `forStep` passes one that calls `answered`. `method(name)`
has exactly the type of the toolbox's method, so no argument is restated. Two methods with the same signature
could be swapped and still compile (`files.makeFolder` and `files.remove`), so a table test walks the object by
each name's dots and checks the name that is asked.

So `sdk.ts` is written by hand and is the source; nothing is derived into it. Its surface is pinned by the
listing. `schemas/generate-toolbox-listing.ts` prints, for each operation, its signature (read from `sdk.ts` with
the compiler, which the kit already has), its sentence, its needs and its manifest lines, and then every shape:

```
files.read(path: string): Promise<Answer<string>>
  When a script needs the text of a file its mode may read.
  Needs no effect. Allowed by resources.files.read, resources.files.write.
```

`npm run generate:check` fails when `framework/toolbox.md` is stale. That check exists today for the manifest
types. A change to the toolbox is a diff of this file, and forge's card shows the diff: lines an owner can read.

## 4. The protocol

A request is `{ type: "request", id, operation, given }`, where `given` is the list of arguments as the author
wrote them. `childMessageOf` checks the name against `faces` and that `given` is a list. `script-protocol.ts`
loses its union and its seven parsers; `script-runner.ts` loses its three switches and calls `answered`.
`call` and `spend` are entries like any other: `call` answers through `step.call`, `spend` adds to `step.spent`.
`skill.submit` is not an operation; it is `submissionRefusal`.

## 5. The effect rule

`effectRefusal` receives needs and compares them with the step's effects. It names no operation. The union, the
table and the switches of `effect-rule.ts` are deleted; their lines are the `resource`, `needs` and `asked` of the
entries.

## 6. Effects per listed command

A command is listed under a name, with what it runs and what it does:

```yaml
resources:
  db: { migrations: migrations }
  files:
    throwaway: [.forge/copies/]
  commands:
    commit-of:
      run: git <protections> rev-parse --verify --quiet --end-of-options
      effects: [read]
    changes:
      run: git <protections> status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --
      effects: [read]
    remove-worktree:
      run: git <protections> worktree remove --end-of-options
      effects: [write, delete]
    delete-branch:
      run: git <protections> branch -d --end-of-options
      effects: [write, delete]

actions:
  status: { effects: [read], run: [{ script: scripts/status.ts }] }
  remove: { effects: [read, write, delete], run: [{ script: scripts/remove.ts }] }
```

`<protections>` stands for the options every line carries today. The actions' other keys are left out.

In the rule the lookup is by name, exact. Matching words one by one against every listed line goes away, and so
does the question of which line wins. The words the kernel runs are the listed ones followed by the script's
arguments; a script cannot change the listed part. The needs are the listed effects:

> The step run.0 of action status asked to run the listed command remove-worktree with [".forge/worktrees/k3"]
> in ., but the action status declares the effects: read, and remove-worktree is listed with: write, delete. To
> allow it, add write to actions.status.effects in components/base/git-worktrees/mode.yaml.

The `command` event records the name and the full words, so the record is as exact as today. `reachOf` gives the
harness the `run` texts of the commands whose effects the action declares.

What this trades, stated plainly. Today the kernel assumes a command can do anything. Afterwards it believes the
manifest: the effects of a listed command are the author's claim, only a base mode may make it, and `bay check`
warns on each with its effects so the owner reviews it.

## 7. Files after, and what is deleted

Estimates. Today: 15 files, 3,209 lines.

| File | Lines | Holds |
|---|---|---|
| `bay/sdk.ts` (entry) | 250 | The toolbox, with all its shapes, `Operations` and `valueOf` |
| `bay/broker/broker.ts` (entry) | 200 | `createBroker`, `forStep`, the joined table, `reachOf`, `listedOperations` |
| `bay/broker/faces.ts` | 320 | `Methods`, `faces`, `operationsOver`. The child reads it |
| `bay/broker/rule.ts` | 150 | `Operation`, `Step`, `answered`, `settled`, `effectRefusal` |
| `bay/broker/operations/` `db`, `files`, `http`, `commands`, `secrets`, `events`, `call`, `spend` | 230, 230, 130, 150, 20, 30, 25, 40 | The entries, one file per member of `Operations` |
| `script-runner.ts`, `script-host.ts`, `script-protocol.ts` | 250, 110, 90 | From 354, 212, 258 |
| Moved unchanged: preload and nine helper files | 1,085 | |
| **Kernel total** | **3,310** | |
| `schemas/generate-toolbox-listing.ts`, `framework/toolbox.md` | 90, 80 | A development tool and its output |

Deleted: all that design A deletes (the `Broker` class, `effect-rule.ts`'s union, table and switches, the
runner's switches, the protocol's union and parsers, the guards written twice, the command shapes in
`contracts.ts`). Also: `startsWithPrefix` and `argumentsOf`; in git-worktrees `protections`, `emptyAttributes`,
`committer`, `makesCommits`, `readsTheCopysAttributes` and `optionsFor` (about 30 lines); the four copies of the
unwrap in four modes.

## 8. The feature map after

```yaml
broker:
  purpose: Runs a mode's script confined, and does every operation a script or an agent's tool asks for, by one rule.
  entry: [bay/broker/broker.ts, bay/sdk.ts]
  may_import: [vocabulary, secrets]
```

`scripts` is gone; safety is `bay/policy.ts` alone. Importers of `broker.ts`: kernel, agent-tools, harness, runs,
check, scaffold, and the listing generator under `schemas`. Of the 18 debt entries here 16 go, as in any design
that merges the three features; `database.ts` to `owner-only.ts` and `answers.ts` to `secret-patterns.ts` stay.
The 8 test entries go.

## 9. Walk-throughs

Adding `files.exists`:

1. `bay/sdk.ts`: `readonly exists: (path: string) => Promise<Answer<boolean>>`.
2. `bay/broker/faces.ts`: its line in `Methods`, its face, its line in `operationsOver`.
3. `bay/broker/operations/files.ts`: its entry.
4. `framework/toolbox.md`: regenerated. Four new lines.
5. Tests: one example in the table test; its cases in `tests/broker-files.test.ts`.

Three source files, as in A. The difference is what the author of the next mode gets: the listing already says
what the operation is for and what to declare.

Adding the field `environment` to a command: `sdk.ts` (the field), `faces.ts` (the guard), `commands.ts` (its
use), the listing, the example. Adding a second positional parameter to a method changes `sdk.ts`, its `given`
guard and its handler, and it changes the wire; a field in a request object does not change the wire's form.

## 10. Tests

A test of one operation holds the same object a script holds, with no child process:

```ts
const { operations } = fixture.broker.forStep(place, permissionsWith({ effects: ["read"] }));
const answer = await operations.commands.run({ command: "remove-worktree", arguments: ["x"], folder: ".", timeLimitSeconds: 5 });
assert.equal(messageOf(answer), "The step run.0 of action status asked to run the listed command remove-worktree …");
assert.deepEqual(fixture.events.map(kindOf), ["refused"]);
```

A script rewrites the seven `broker-*` test files from `broker.readFile(path)` to `operations.files.read(path)`
(P-24); expected values stay, except those of commands. A mode's tests can be given `operationsOver` an `ask`
that calls the real broker with test adapters. Slice I3 decides that; this design makes it one function call.

## 11. Migration

| # | Slice | Write scope | After |
|---|---|---|---|
| 1 | Move the files into `bay/broker/`, by script | `bay/broker/`, import lines, the map | |
| 2 | The interface: `sdk.ts` declares the shapes, `Operations`, `valueOf`; `faces.ts` with the round-trip test; the listing and its check | `bay/sdk.ts`, `faces.ts`, `contracts.ts`, `schemas/`, `framework/toolbox.md`, `package.json` | 1 |
| 3 | Host and protocol read `faces`; the wire carries `given` | the three `script-*` files, `faces.ts` | 2 |
| 4 | `rule.ts` and the table for `files` and `db` | `bay/broker/` | 3 |
| 5 | The rest of the table; the class, `effect-rule.ts` and the switches are deleted | `bay/broker/` | 4 |
| 6 | Seal: the entry; tools use `operations`; adapter, skill-steps, check, scaffold move; tests to the entry | `broker.ts`, six callers, tests, the map | 5 |
| 7 | Named commands with effects. Kernel, and both modes that run commands: their `mode.yaml` and the one file each that builds commands. Every command keeps all five effects, so only the form changes | schema, `policy.ts`, `contracts.ts`, `sdk.ts`, `operations/commands.ts`, `check.ts`, `adapter.ts`, the Claude Code adapter, two modes | 6 |
| 8a-8d | git-worktrees and typescript declare true effects; all four modes that unwrap use `valueOf` | one mode's folder each | 7 |

Longest chain: seven, in one feature, so one builder at a time (ADR 17). One wave of four at the end. The chain
runs beside the isolation chain. Slice 7 breaks P-34 on purpose: it is a kernel slice that edits two modes,
because a change to what `commands.run` takes cannot be made without moving its callers (ADR 9).

## 12. Risks, and what this design makes harder

- It changes what an author types for a command. Two modes move now; every later one is easier. If the owner
  wants no change to the toolbox in this round, section 6 falls back to design A's form and the rest stands.
- A name per command is one more thing to invent, and git-worktrees needs 22. A script can no longer pick options
  by subcommand; each variant is a listed name.
- The wire carries arguments by position. An event or a log of a raw request is less plain than a named record.
- `summary` and `allowedBy` are prose beside code. Nothing but review holds them true.
- The types lean on `Parameters` and a mapped conditional type. A sketch of four operations compiles under the
  kit's flags with no assertion; the errors for a wrong entry are long.
- As in A, the grant check is the first lines of `answer` by habit, and an operation that records nothing
  compiles. Design C answers that.

## 13. What it deliberately does not do

It does not reword refusals other than for commands. It keeps `Answer` as a value; `valueOf` is a choice the
script makes. It does not split the rule from the doing, add a transport port, version the protocol or add kinds
of event.
