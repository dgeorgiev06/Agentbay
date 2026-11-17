# Broker as one sealed feature: design A, the smallest

Constraint: the least machinery that removes the six-file chain. Plain data and functions. One new concept, the
table of operations, because ADR 17 forces it. Nothing a mode's author types changes, and no refusal changes by
one character.

The idea in one paragraph. An operation is one key in two records. The first record, `shapes`, holds what both
the child and the kernel must know: how to read a request and how to read a result. The second, `operations`,
holds what only the kernel knows: the effects needed, the words for a refusal, and the function that checks the
grant and does the work. Both records are typed over the same union of names, so the compiler refuses a table
with a missing or misspelt entry. Host, protocol, runner and rule read the records. None of them names an
operation.

## 1. The entry files

Two. `bay/sdk.ts` is the toolbox, for mode code. `bay/broker/broker.ts` is for the kernel.

```ts
export function createBroker(services: BrokerServices): Broker;

export type Broker = {
  readonly scripts: ScriptRunner;
  readonly forStep: (place: StepPlace, permissions: Permissions) => StepBroker;
};

export type StepBroker = {
  readonly ask: <Name extends OperationName>(name: Name, request: Requests[Name]) => Promise<Answer<Results[Name]>>;
  readonly close: () => void;
};

export function reachOf(permissions: Permissions): Reach;

export type Reach = {
  readonly writableFolders: readonly string[];
  readonly removesFiles: boolean;
  readonly commands: readonly string[];
};

export function submissionRefusal(spentUsd: number, effects: readonly Effect[], at: ActionAt): Refusal | undefined;

export type ActionAt = { readonly stepKey: string; readonly action: string; readonly manifest: string };

export const sdkSpecifier = "agentbay/sdk";
```

Ten names with `BrokerServices` and `BrokerLimits`: three functions, one constant, six types. `BrokerServices` is
today's `ScriptRunnerOptions`: the layout, the ports, the secret store and the event sink. `ScriptRunner`,
`StepPlace`, `Permissions` and the ports stay vocabulary. Who uses what:

- Kernel wiring: `createBroker`. `runs` receives `broker.scripts`; `Kernel.brokerFor` becomes `broker.forStep`.
- Agent tools: `step.ask("files.read", { path })` in place of `broker.readFile(path)`; four call sites in `tools.ts`.
- Harness: `reachOf` replaces `writableFolders` and `grantedCommands` in `adapter.ts`.
- Runs: `submissionRefusal` replaces `effectRefusal({ kind: "skill.submit" })` in `skill-steps.ts`.
- Check and scaffold: `sdkSpecifier`.

`sdk.ts` exports what it exports today, and now declares the shapes it used to borrow: `SqlParameters`, `Row`,
`ExecuteResult`, `AgentQueryResult`, `HttpRequest`, `HttpResponse`, `CommandRequest`, `CommandEnd`, `CommandOutput`,
`CommandRan`. `ScriptContext` is unchanged, line for line. Its only type imports are `Json` and `Answer`.

`ports.ts` keeps its own `HttpRequest` for the `Http` port. The two look alike today and change for different
reasons: one is what an author writes, the other is what goes on the network. `CommandRequest` and
`ProcessRequest` are already apart in the same way. The handler passes one to the other, so the compiler holds
them together where it matters.

## 2. One operation, in full

`bay/broker/operations.ts` is read by the child and the kernel. It imports types and three small guards.

```ts
export type Requests = {
  readonly "db.query": { readonly sql: string; readonly parameters: SqlParameters; readonly partition?: string };
  readonly "files.read": { readonly path: string };
  readonly "commands.run": CommandRequest;
};

export type Results = {
  readonly "db.query": readonly Row[];
  readonly "files.read": string;
  readonly "commands.run": CommandRan;
};

export type OperationName = keyof Requests;

export type Shape<Name extends OperationName> = {
  readonly resource: Resource;
  readonly request: (value: Json) => Requests[Name] | undefined;
  readonly result: (value: Json) => value is Json & Results[Name];
};

export const shapes: { readonly [Name in OperationName]: Shape<Name> } = {
  "db.query": { resource: "db", request: statementRequestOf, result: isRows },
  "files.read": {
    resource: "files",
    request: (value) => (isJsonRecord(value) && isText(value.path) ? { path: value.path } : undefined),
    result: isText,
  },
  "commands.run": { resource: "commands", request: commandRequestOf, result: isCommandRan },
};
```

The three maps show three of the 16 keys. `commandRequestOf` and `statementRequestOf` are today's parsers from
`script-protocol.ts:101` and `:123`, moved as they are. The kernel's half is typed the same way, in `bay/broker/rule.ts`:

```ts
export type Need = { readonly effect: Effect; readonly because: string };

export type Operation<Name extends OperationName> = {
  readonly needs: (request: Requests[Name], grants: ModeGrants) => readonly Need[];
  readonly described: (request: Requests[Name], step: Step) => string;
  readonly refusalDetail: (request: Requests[Name]) => { readonly [key: string]: Json };
  readonly answer: (request: Requests[Name], step: Step) => Promise<Answer<Results[Name]>>;
};

export type Operations = { readonly [Name in OperationName]: Operation<Name> };
```

`Step` is what a handler may touch: `grants`, `effects`, `at`, `layout`, the ports, `limits`, `secrets`,
`record(kind, detail)` and the open databases of this step. It replaces the private fields of the `Broker` class.

`commands.run`, in `bay/broker/command-operations.ts`:

```ts
export const commandOperations: Pick<Operations, "commands.run"> = {
  "commands.run": {
    needs: (request, grants) => commandNeeds(listedCommand(request.command, grants.commands)),
    described: (request) => `run the command ${JSON.stringify(request.command)} in ${request.folder}`,
    refusalDetail: (request) => ({ command: request.command, folder: request.folder }),
    answer: async (request, step) => {
      const listed = listedCommand(request.command, step.grants.commands);
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
      return ranCommand(request, { folder: folder.value, milliseconds: milliseconds.value }, step);
    },
  },
};
```

`db.query`, in `bay/broker/database-operations.ts`:

```ts
"db.query": {
  needs: (request) => statementNeeds(request.sql),
  described: (request) => `run a statement that starts with "${leadingKeyword(request.sql)}"`,
  refusalDetail: () => ({}),
  answer: async (request, step) => {
    const file = partitionFile(request.partition, step);
    if (!file.ok) {
      return file;
    }
    const keyword = leadingKeyword(request.sql);
    if (!readKeywords.includes(keyword)) {
      return statementRefusal(keyword, readKeywords, step);
    }
    const migrated = await migratedFirst(request.partition, step);
    if (!migrated.ok) {
      return migrated;
    }
    const result = await step.databaseOf(file.value).request({ method: "query", ...request });
    return databaseAnswer(result, { keyword, fits: isRows }, step);
  },
},
```

Where each part lives:

| Part | Where |
|---|---|
| Request shape, result shape | `sdk.ts` when an author names it; else inline in `Requests` and `Results` |
| Request guard, result guard | `shapes[name]` in `operations.ts`. Each guard exists once |
| Needed effects | `operations[name].needs` |
| Grant check | The first lines of `answer`, through the check for its resource: `checkedPath`, `checkUrl`, `listedCommand` |
| Refusal wording | `described` for what was asked; the grant refusals beside the check that makes them; the effect refusal once, in `rule.ts` |
| Event record | `refusalDetail` for a refusal; `step.record` inside `answer` for the rest, as today |
| Handler | `answer` |

The one rule, in `rule.ts`, is the only caller of `answer`:

```ts
export async function guarded<Name extends OperationName>(
  operations: Operations,
  asked: { readonly name: Name; readonly request: Requests[Name] },
  step: Step,
): Promise<Answer<Results[Name]>> {
  const operation = operations[asked.name];
  const doing = operation.described(asked.request, step);
  const refusal = effectRefusal({ name: asked.name, doing, needs: operation.needs(asked.request, step.grants) }, step);
  try {
    const answer = refusal === undefined ? await operation.answer(asked.request, step) : refused(refusal);
    return await settled(answer, step, operation.refusalDetail(asked.request));
  } catch (error) {
    return settled(failed(`The step ${step.at.stepKey} could not ${doing}: ${errorLine(error)}`), step, {});
  }
}
```

`settled` is today's `#settle`: it scrubs every sentence and writes the `refused` event. `StepBroker.ask` and the
script runner both call `guarded`. The resource files export their records only to `broker.ts`, which joins them:
`const operations: Operations = { ...databaseOperations, ...fileOperations, ...commandOperations, ... }`.

`call` and `spend` are operations in the table. `call` answers through `step.call`, which the runner sets from the
`ScriptRequest` and a tool's step lacks. `spend` adds to `step.spent`, which the runner reads when the child ends.
`skill.submit` is not an operation: no one asks for it over the protocol. It is the function `submissionRefusal`,
which uses the same `effectRefusal`.

## 3. The toolbox

`sdk.ts` stays written by hand. An author reads plain signatures there, not a mapped type.

The object behind `ScriptContext` is built at the bottom of `operations.ts`, next to the shapes:

```ts
export type Ask = (name: OperationName, request: Json) => Promise<Answer<Json>>;

export function contextOver(ask: Ask, start: Start): ScriptContext {
  const asked = async <Name extends OperationName>(
    name: Name,
    request: Requests[Name] & Json,
  ): Promise<Answer<Results[Name]>> => narrowed(await ask(name, request), shapes[name].result);
  return {
    files: {
      read: (path) => asked("files.read", { path }),
      write: (path, text) => asked("files.write", { path, text }),
    },
    commands: { run: (request) => asked("commands.run", request) },
    settings: start.settings,
    now: () => new Date(start.now),
  };
}
```

(Shortened to three methods.) The return type is `ScriptContext`, so a method that is missing, misnamed or tied to
the wrong operation does not compile. `script-host.ts` calls `contextOver` and holds no operation's name. One gap:
`files.makeFolder` and `files.remove` take and give the same shapes, so their names could be swapped and still
compile. The table test walks the context by each name's dots and checks the name that is asked.

The surface is pinned by `tests/toolbox-surface.test.ts`. It writes the whole of `ScriptContext` out again as one
type literal with no import but `Json`, every shape inline, and requires the two types to be the same:

```ts
const samePinnedSurface: Same<ScriptContext, PinnedScriptContext> = true;
```

`npm run typecheck` fails when the toolbox changes and the pin does not, whichever file the change was made in. So
a change to the surface is always a change to this one file, and forge's card can show its diff. The same test
asserts at run time that the keys of `shapes` are the 16 literal names.

## 4. The protocol

A request is `{ type: "request", id, operation, request }`. `childMessageOf` checks that `operation` is a key of
`shapes` and leaves `request` as `Json`. The runner then does the one parse (S7):

```ts
async function answerFor<Name extends OperationName>(name: Name, raw: Json, step: Step): Promise<Answer<Json>> {
  const request = shapes[name].request(raw);
  return request === undefined ? malformed : guarded(operations, { name, request }, step);
}
```

A request that does not parse ends the script as a malformed line does today. `script-protocol.ts` keeps the
messages, the start message and the answer parser, and loses its 16-case union and seven request parsers.
`script-runner.ts` loses its three switches. Neither file changes when an operation is added.

## 5. The effect rule

`effectRefusal` takes the needs it is given and the effects of the step. It no longer knows any operation. The
union `BrokerOperation`, the table `operationRules` and the four `described…` switches are deleted; each line of
them is now the `resource`, `needs` or `described` of one entry. `reachOf` answers the three questions the runner
and the harness ask: writable folders, whether files may be removed, and which commands may run.

## 6. Effects per listed command

A listed command becomes a mapping with its own effects. There is no text form left (P-11).

```yaml
resources:
  db: { migrations: migrations }
  files:
    throwaway: [.forge/copies/]
  commands:
    - run: git <protections> rev-parse --verify --quiet --end-of-options
      effects: [read]
    - run: git <protections> status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --
      effects: [read]
    - run: git <protections> worktree remove --end-of-options
      effects: [write, delete]
    - run: git <protections> branch -d --end-of-options
      effects: [write, delete]

actions:
  status: { effects: [read], run: [{ script: scripts/status.ts }] }
  remove: { effects: [read, write, delete], run: [{ script: scripts/remove.ts }] }
```

`<protections>` stands for the options every line carries today, written out in the manifest as now. The
actions' other keys are left out here. `remove` needs `write` and `delete` three times over: for the two
commands, for `files.remove`, and for the statement that forgets the folder.

In the rule: `listedCommand` finds the listed command whose `run` the asked command starts with, argument by
argument; the longest wins. `commandNeeds` turns its effects into needs. An action that lacks one is refused:

> The step run.0 of action status asked to run the command ["git", …, "worktree", "remove", …] in ., but the
> action status declares the effects: read. The listed command "git … worktree remove --end-of-options" has the
> write effect; to allow it, add write to actions.status.effects in components/base/git-worktrees/mode.yaml.

A command that is not listed has no needs and is refused by the grant check, in today's words. `reachOf` gives the
harness the commands whose effects the action declares, not all or none. `ModeGrants.commands` becomes a list of
`{ run, effects }`, built in `policy.ts`, which also refuses two entries with the same `run`.

What this trades. Today the kernel assumes a command can do anything. Afterwards it believes the manifest. The
effects of a listed command are a claim by the mode's author, and only a base mode may make it. `bay check` keeps
its warning per listed command and adds the effects to it, so the owner reviews the claim.

## 7. Files after, and what is deleted

Estimates. Today's 15 files are 3,209 lines.

| File | Lines | Holds |
|---|---|---|
| `bay/sdk.ts` (entry) | 230 | The toolbox; gains about 60 lines of shapes from four files |
| `bay/broker/broker.ts` (entry) | 190 | `createBroker`, `forStep`, the joined table, `reachOf`, `submissionRefusal` |
| `bay/broker/operations.ts` | 330 | `Requests`, `Results`, `shapes`, `contextOver`. The child reads it |
| `bay/broker/rule.ts` | 150 | `Operation`, `Step`, `guarded`, `settled`, `effectRefusal`, needs |
| `database-operations.ts`, `file-operations.ts`, `http-operations.ts`, `command-operations.ts`, `other-operations.ts` | 230, 230, 130, 170, 90 | The entries, by resource, with their grant refusals |
| `script-runner.ts` | 250 | From 354 |
| `script-host.ts` | 120 | From 212 |
| `script-protocol.ts` | 95 | From 258 |
| Unchanged, moved: preload, `file-access`, `http-access`, `database`, `database-child`, `database-process`, `agent-query`, `query-child`, `sql-statements`, `folder-links` | 1,085 | |
| **Total** | **3,300** | About the same. The gain is in places, not lines |

Deleted: the `Broker` class and its 14 public methods; `effect-rule.ts` as a file, with its union, table and
switches (about 150 lines); the runner's three switches (58 lines); the protocol's union and request parsers
(about 150); the guards written twice in `broker.ts` and `script-host.ts`; `grantedCommands`, `writableFolders`,
`mayRemoveFiles` as exports; `everyEffect` and `runsCommands`; `createScriptRunner` as an export; the command
shapes in `contracts.ts`; `tests/broker-helpers.test.ts` as a file that reaches into five private files.

## 8. The feature map after

```yaml
broker:
  purpose: Runs a mode's script confined, and does every operation a script or an agent's tool asks for, by one rule.
  entry: [bay/broker/broker.ts, bay/sdk.ts]
  may_import: [vocabulary, secrets]
safety:
  entry: [bay/policy.ts]
  private: []
```

The `scripts` feature is gone. Importers of `broker.ts`: kernel, agent-tools, harness, runs, check, scaffold.
Of the 18 debt entries in this area 16 go: thirteen become imports inside one feature, `folder-links.ts` moves in
(two entries), and the feature may import secrets (one). Two stay and are not this feature's to fix:
`database.ts` to `owner-only.ts`, and `answers.ts` to `secret-patterns.ts`. All 8 test entries go: the tests ask
through the entry, or move to `tests/inside/broker/`.

## 9. Walk-throughs

Adding an operation, say `files.exists`:

1. `bay/sdk.ts`: the line `readonly exists: (path: string) => Promise<Answer<boolean>>`.
2. `bay/broker/operations.ts`: its key in `Requests`, `Results` and `shapes`, and its line in `contextOver`.
3. `bay/broker/file-operations.ts`: its entry, with needs, words and `answer`.
4. `tests/toolbox-surface.test.ts`: the pinned line.
5. `tests/broker-operations.test.ts`: one example request and result. `tests/broker-files.test.ts`: its cases.

Three source files and two test files. The compiler names each one that is missing: step 1 alone breaks
`contextOver`, step 2 breaks the joined table, and the example record is typed over `OperationName`.

Adding a field, say `environment` to a command: `sdk.ts` (the field), `operations.ts` (the guard),
`command-operations.ts` (its use), the pin, and the example. The example's type makes every optional field
required, so a new field cannot be left out of it, and the round-trip test fails if the guard drops it. That is
the mistake commit `616e674` could have made without anyone seeing.

## 10. Tests

A test of one operation asks through the entry and asserts the sentence and the events:

```ts
const answer = await fixture.step.ask("files.read", { path: "notes/../secret.txt" });
assert.equal(messageOf(answer), "The step s1 asked to read secret.txt, but the mode notes may read only: notes. …");
assert.deepEqual(fixture.events.map(kindOf), ["refused"]);
```

The seven `broker-*` test files keep every expected value. A script rewrites `broker.readFile(path)` to
`step.ask("files.read", { path })` (P-24). One new table test covers all 16: the names, each example through its
guard and back, and that an operation with needs is refused with no effects declared.

## 11. Migration

Each slice is one builder and ends green. All but the last two are in one feature, so they form a chain (ADR 17).

| # | Slice | Write scope | After |
|---|---|---|---|
| 1 | Move the 15 files and `folder-links.ts` into `bay/broker/`, by script. Imports only | `bay/broker/`, importers' import lines, the map | |
| 2 | The interface: `sdk.ts` declares the shapes; the pin test; `Requests`, `Results`, `shapes` with the round-trip test | `bay/sdk.ts`, `operations.ts`, `contracts.ts`, tests | 1 |
| 3 | Protocol and host read `shapes`: `contextOver`; the protocol's parsers and the host's guards are deleted | `script-host.ts`, `script-protocol.ts`, `script-runner.ts`, `operations.ts` | 2 |
| 4 | `rule.ts` and the table: files and database move from class methods to entries; their union kinds and switch cases go | `bay/broker/` | 3 |
| 5 | The rest move: http, secrets, events, commands, spend, call. The class, `effect-rule.ts` and the runner's switches are deleted | `bay/broker/` | 4 |
| 6 | Seal: the entry of section 1; kernel, tools, adapter, skill-steps, check and scaffold move; tests to the entry | `bay/broker/broker.ts`, six callers, tests, the map | 5 |
| 7 | Effects per listed command in the kernel. Both manifests are rewritten by script with all five effects on each command, so nothing changes yet | schema, `policy.ts`, `contracts.ts`, `command-operations.ts`, `check.ts`, `adapter.ts`, the Claude Code adapter, two `mode.yaml` | 6 |
| 8a | git-worktrees declares true effects per command and per action | its folder | 7 |
| 8b | typescript does the same | its folder | 7 |

Longest chain: seven. One wave of two at the end. The whole chain runs beside the isolation chain I1 to I4, whose
scopes it does not touch. Slice 4 leaves a table over ten names and a class with six methods for one slice; the
runner asks the table first. That is a half-moved state and slice 5 ends it. I see no order that avoids it short
of one slice that rewrites 916 lines.

## 12. Risks, and what this design makes harder

- The grant check is the first lines of `answer`, by habit. Nothing makes a new operation check a grant. A
  reviewer reads the handler. Design C answers this; A does not.
- The same holds for events. An operation that records nothing compiles.
- Two records and a line in `contextOver` per operation is three spots in two files, plus `sdk.ts`. The compiler
  finds a missing one, but a reader still follows a name across four places.
- Typing a table over a union of names leans on one pattern of the compiler. An entry with a wrong type gives a
  long error. The sketch compiled; the real 16 have not been tried.
- A second transport is not prepared. `script-runner.ts` still owns both the child process and the answering.

## 13. What it deliberately does not do

It does not change the toolbox, a refusal or an event. It does not name commands, add an in-process toolbox for
mode tests, version the protocol, or split the rule from the doing. B and C make those choices.
