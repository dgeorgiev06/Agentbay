# Broker as one sealed feature: design C, designed around seams

Constraint: put the seams where testing, proof and a second transport need them. An operation's rule, its effect
on the world and its record are three things a test can hold apart. The script child process is one way to carry
a script; a container or a remote worker is another (ADR 5).

## 0. The seams, decided first

| Candidate | Decision | Reason |
|---|---|---|
| The rule: may this step do this? | **A function per operation.** It returns a ruling. It may look at the world (real paths, links). It cannot change it: its `Look` has no method that writes. | Today a grant check is some lines inside a 30-line method. A reviewer cannot see where checking ends and doing begins. |
| The effect on the world | **A function per operation.** It takes what the rule allowed, not what was asked, and the ports. It never sees grants. | "Done without being ruled" becomes a type error: a checked path is a different type from an asked path. |
| The record | **A function per operation**, from what was allowed and what happened to events. Data in, data out. | S5 is held today by a handler remembering to call `#append`. Here an operation that records nothing says so. |
| The answer | **A function per operation**, from what happened to what the script receives: cut, scrubbed, shaped. | Hashes go to the record and text to the script. They are not the same value. |
| Scrubbing | **Not a seam.** One function wraps every refusal, failure and record. Tests use the real secret store (ADR 10). | One rule, one place. |
| Carrying a script and its requests | **A port, `Transport`.** | See below. |
| The database child, the agent-query child | **Private, as they are.** | They are already processes behind one function each. |
| Files, clock, http, processes | **Ports, as they are.** | Two adapters each exist. |

**The transport.** Today `script-runner.ts` does two jobs in one function (`:276-313`): it starts a Node child
with permission flags and reads its lines, and it answers requests and adds up spending. A container or a remote
worker changes the first job and must not touch the second. The port is:

```ts
export type Transport = {
  readonly carry: (script: CarriedScript, answer: Answerer) => Promise<CarriedEnd>;
};

export type CarriedScript = {
  readonly file: string;
  readonly folder: string;
  readonly start: StartMessage;
  readonly confinement: { readonly readable: readonly string[]; readonly writable: readonly string[]; readonly removesFiles: boolean };
  readonly limits: { readonly milliseconds: number; readonly outputBytes: number };
};

export type Answerer = (request: WireRequest) => Promise<Answer<Json>>;

export type CarriedEnd =
  | { readonly how: "done"; readonly output: Json }
  | { readonly how: "failed"; readonly reason: string }
  | { readonly how: "broke-protocol" }
  | { readonly how: "stopped"; readonly reason: string };
```

Two adapters exist on the day it is built (P-10). The real one is the child process. The test one runs a
script's handler in the test's own process over the same messages. The second is not a pretend broker: the rule,
the doing and the record behind it are the real ones. Confinement is tested only against the real adapter.

## 1. The entry files

`bay/sdk.ts`, the toolbox: unchanged for an author, and it declares every shape it shows (see section 3).

`bay/broker/broker.ts`, twelve names:

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

export function childProcessTransport(childProcesses: ChildProcesses): Transport;

export function reachOf(permissions: Permissions): Reach;

export function submissionRefusal(spentUsd: number, effects: readonly Effect[], at: ActionAt): Refusal | undefined;

export const sdkSpecifier = "agentbay/sdk";
```

The types `Transport`, `BrokerServices`, `BrokerLimits`, `Reach` and `ActionAt` are the other five.
`BrokerServices` is today's `ScriptRunnerOptions` with a `transport` added: the kernel passes
`childProcessTransport(ports.childProcesses)`. Agent tools call `step.ask("files.read", { path })`. The harness
asks `reachOf`; runs asks `submissionRefusal`; check and scaffold read `sdkSpecifier`.

## 2. One operation, in full

Shapes are in `bay/broker/operations.ts`, which the child and the kernel read:

```ts
export type Requests = {
  readonly "db.query": { readonly sql: string; readonly parameters: SqlParameters; readonly partition?: string };
  readonly "commands.run": CommandRequest;
};

export type Results = { readonly "db.query": readonly Row[]; readonly "commands.run": CommandRan };

export type OperationName = keyof Requests;

export const shapes: { readonly [Name in OperationName]: Shape<Name> } = {
  "db.query": { resource: "db", request: statementRequestOf, result: isRows },
  "commands.run": { resource: "commands", request: commandRequestOf, result: isCommandRan },
};
```

(Two of 16 keys.) A `Shape` is a request guard that returns the typed request or nothing, and a result guard.
The kernel's half, in `bay/broker/rule.ts`:

```ts
export type Ruling<Allowed> =
  | { readonly allowed: true; readonly value: Allowed }
  | { readonly allowed: false; readonly refusal: RefusalWording };

export type Definition<Name extends OperationName, Allowed, Done> = {
  readonly needs: (request: Requests[Name], grants: ModeGrants) => readonly Need[];
  readonly asked: (request: Requests[Name], asking: Asking) => string;
  readonly rule: (request: Requests[Name], asking: Asking, look: Look) => Promise<Ruling<Allowed>>;
  readonly perform: (allowed: Allowed, world: World) => Promise<Done>;
  readonly record: (allowed: Allowed, done: Done) => readonly Recorded[];
  readonly answer: (done: Done, shown: Shown) => Answer<Results[Name]>;
  readonly lateRefusal?: (done: Done, request: Requests[Name], asking: Asking) => RefusalWording | undefined;
};
```

- `Asking` is data: grants, effects, the place, the layout, the limits.
- `Look` reads: real path, is it a link, does it exist. `World` holds the ports that change things and the open
  databases. `World` has no grants in it.
- `Shown` scrubs and cuts: the secret store's `redact` and the limits on what a script is given.
- `lateRefusal` is for what only the world can tell: the database child found a write on a read-only connection,
  or two statements in one call. The rule opened the connection read-only; the words come afterwards.

`commands.run`, in `bay/broker/commands.ts`:

```ts
type CommandToRun = {
  readonly words: readonly string[];
  readonly listed: ListedCommand;
  readonly realFolder: string;
  readonly milliseconds: number;
  readonly input: string | undefined;
};

type CommandDone = { readonly result: ProcessResult; readonly took: number };

export const commandRule: Definition<"commands.run", CommandToRun, CommandDone>["rule"] = async (request, asking, look) => {
  const listed = listedCommand(request.command, asking.grants.commands);
  if (listed === undefined) {
    return refusedWith(unlistedCommand(request, asking));
  }
  const milliseconds = commandMilliseconds(request, asking);
  if (!milliseconds.allowed) {
    return milliseconds;
  }
  const folder = await commandFolder(request, asking, look);
  if (!folder.allowed) {
    return folder;
  }
  const timed = { realFolder: folder.value, milliseconds: milliseconds.value };
  return allowedWith({ words: request.command, listed, input: request.input, ...timed });
};

export async function performCommand(command: CommandToRun, world: World): Promise<CommandDone> {
  const startedAt = world.clock.now().getTime();
  const result = await world.processes.run(processRequestOf(command, world.commandSearchPath));
  return { result, took: world.clock.now().getTime() - startedAt };
}

export function commandRecord(command: CommandToRun, done: CommandDone): readonly Recorded[] {
  const hashes = { stdoutHash: done.result.stdout.hash, stderrHash: done.result.stderr.hash };
  const ran = { command: command.words, folder: command.realFolder, end: done.result.end, milliseconds: done.took };
  return [{ kind: "command", detail: { ...ran, ...inputHashOf(command.input), ...hashes } }];
}

export const commandsRun = operation<"commands.run", CommandToRun, CommandDone>({
  needs: (request, grants) => commandNeeds(listedCommand(request.command, grants.commands)),
  asked: (request) => `run the command ${JSON.stringify(request.command)} in ${request.folder}`,
  rule: commandRule,
  perform: performCommand,
  record: commandRecord,
  answer: commandAnswer,
});
```

`commandAnswer` turns a result that did not start into a failure, and otherwise cuts and scrubs the two outputs.
`db.query`, in `bay/broker/database-operations.ts`:

```ts
type StatementToRun = {
  readonly file: string;
  readonly migrateFirst: boolean;
  readonly sql: string;
  readonly parameters: SqlParameters;
  readonly connection: Connection;
};

export const dbQuery = operation<"db.query", StatementToRun, DatabaseResult<Json>>({
  needs: (request) => statementNeeds(request.sql),
  asked: (request) => `run a statement that starts with "${leadingKeyword(request.sql)}"`,
  rule: (request, asking) => {
    const file = partitionFile(request.partition, asking);
    if (!file.allowed) {
      return Promise.resolve(file);
    }
    const keyword = leadingKeyword(request.sql);
    if (!readKeywords.includes(keyword)) {
      return Promise.resolve(refusedWith(statementRefusal(keyword, readKeywords, asking)));
    }
    const migrateFirst = request.partition === undefined;
    return Promise.resolve(allowedWith({ file: file.value, migrateFirst, connection: "read-only", ...request }));
  },
  perform: (statement, world) => world.databases.run(statement),
  record: () => [],
  answer: (result) => databaseAnswer(result, isRows),
  lateRefusal: (result, request, asking) => statementLateRefusal(result, request, asking),
});
```

Where each part lives:

| Part | Where |
|---|---|
| Request shape, result shape | `sdk.ts` when an author names it; else inline in `Requests` and `Results` |
| Request guard, result guard | `shapes[name]`, once |
| Needed effects | `needs` |
| Grant check | `rule`, and nowhere else. `secrets.get` moves its check here from `secrets.ts:76-95` |
| Refusal wording | `asked`; each grant refusal in the rule that makes it; the effect refusal once |
| Event record | `record`. `[]` is written out and a reviewer sees it |
| Handler | `perform`, which cannot see grants, and `answer` |

`operation` is the one rule (S1). It is the only code that calls a `perform`:

```ts
export function operation<Name extends OperationName, Allowed, Done>(
  definition: Definition<Name, Allowed, Done>,
): Guarded<Name> {
  return async (request, step) => {
    const doing = definition.asked(request, step.asking);
    const short = effectRefusal({ doing, needs: definition.needs(request, step.asking.grants) }, step.asking);
    if (short !== undefined) {
      return step.settled(refused(short), request);
    }
    const ruling = await definition.rule(request, step.asking, step.look);
    if (!ruling.allowed) {
      return step.settled(refused(ruling.refusal), request);
    }
    const done = await definition.perform(ruling.value, step.world);
    await step.recordAll(definition.record(ruling.value, done));
    const late = definition.lateRefusal?.(done, request, step.asking);
    return step.settled(late === undefined ? definition.answer(done, step.shown) : refused(late), request);
  };
}
```

(The `try` around it, which turns a thrown error into a failure, is left out here.) `step.settled` scrubs and
writes the `refused` event; `step.recordAll` scrubs and appends. `broker.ts` joins the results into
`{ readonly [Name in OperationName]: Guarded<Name> }`, so a missing operation does not compile. A sketch of this
with two operations type-checks under the kit's flags with no assertion.

`call` and `spend` are operations. `call` performs through `world.call`; a tool's step has none and is refused.
`spend`'s record is the amounts, which the script run adds up. `skill.submit` is `submissionRefusal`, on the same
`effectRefusal`.

## 3. The toolbox

`sdk.ts` is written by hand. It declares `SqlParameters`, `Row`, `ExecuteResult`, `AgentQueryResult`,
`HttpRequest`, `HttpResponse` and the command shapes itself; its type imports are `Json` and `Answer`. The object
behind `ScriptContext` is built by `contextOver(ask, start)` at the bottom of `operations.ts`: one line per
method, such as `read: (path) => asked("files.read", { path })`, checked by the compiler against `ScriptContext`
and `Requests`. Any transport's far end calls it with its own `ask`.

Two pins. `tests/toolbox-surface.test.ts` writes `ScriptContext` out again as one literal type with every shape
inline and requires it to equal the real one; the type check fails when they part.
`tests/inside/broker/wire-examples.ts` holds, for each operation, one request line and one answer line as text; a test reads each
through its guard, compares with a typed example, and writes it back to the same text. A change to the toolbox is
a diff of the first file. A change to the protocol is a diff of the second.

## 4. The protocol

`bay/broker/wire.ts` holds the messages and their parser. A request is
`{ type: "request", id, operation, request }`; the start message gains `protocol: 1`. The parser checks the name
against `shapes`; the broker parses the request with `shapes[name].request` (S7). The file names no operation.
A transport moves these messages and nothing else. The child-process adapter writes them as lines; a worker far
away would send the same text, and the wire examples say what both must accept.

## 5. The effect rule

`effectRefusal` compares needs with the step's effects and names no operation. `effect-rule.ts`'s union, table
and switches are deleted. `reachOf` answers the runner's and the harness's questions.

## 6. Effects per listed command

A listed command is a mapping with its own effects:

```yaml
resources:
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

`<protections>` stands for the options each line carries today; other keys are left out. `listedCommand` finds the
listed command the asked words start with, the longest first. Its effects are the needs:

> The step run.0 of action status asked to run the command ["git", …, "worktree", "remove", …] in ., but the
> action status declares the effects: read. The listed command "git … worktree remove --end-of-options" has the
> write effect; to allow it, add write to actions.status.effects in components/base/git-worktrees/mode.yaml.

What this trades. Today the kernel assumes a command can do anything. Afterwards the effects are the author's
claim, made only by a base mode and shown by `bay check` for the owner to review. A child process cannot hold a
program to its claim. This design keeps the listed command in the ruling (`CommandToRun.listed`), so the value is
at the seam on the day an adapter can enforce it: no network without `network`, a read-only mount without
`write`. No field is added to a port until an adapter reads it.

## 7. Files after, and what is deleted

Estimates. Today: 15 files, 3,209 lines.

| File | Lines | Holds |
|---|---|---|
| `bay/sdk.ts` (entry) | 230 | The toolbox and its shapes |
| `bay/broker/broker.ts` (entry) | 180 | `createBroker`, `forStep`, the joined table, `reachOf` |
| `operations.ts` | 330 | Shapes and `contextOver`. The far end reads it |
| `wire.ts` | 110 | Messages, parser, version. The far end reads it |
| `rule.ts` | 190 | `Definition`, `operation`, `Asking`, `Look`, `World`, `effectRefusal`, settling |
| `database-operations.ts`, `file-operations.ts`, `http-operations.ts`, `commands.ts`, `other-operations.ts` | 280, 290, 170, 210, 120 | Four parts per operation |
| `script-runs.ts` | 120 | One run of a script: checks before the start, spending, the outcome |
| `transport/child-process.ts` | 230 | Flags, the child, lines, ends |
| `script-host.ts`, preload, nine helper files | 120, 1,085 | |
| **Total** | **3,665** | About 450 more than today. The four-part split and the port cost lines |
| `tests/inside/broker/` | 330 | The in-process adapter, the wire examples, the table of proofs |

Deleted: the `Broker` class; `effect-rule.ts`; the runner's switches; the protocol's union and parsers; the
guards written twice; `script-runner.ts` as one file; `SecretStore.get` (its check moves to the rule; `lookUp`
stays); the command shapes in `contracts.ts`; `tests/broker-helpers.test.ts`.

## 8. The feature map after

```yaml
broker:
  purpose: Runs a mode's script confined, and does every operation a script or an agent's tool asks for, by one rule.
  entry: [bay/broker/broker.ts, bay/sdk.ts]
  may_import: [vocabulary, secrets]
```

`scripts` is gone; safety is `bay/policy.ts`. Importers: kernel, agent-tools, harness, runs, check, scaffold. 16
of the 18 debt entries go; `database.ts` to `owner-only.ts` and `answers.ts` to `secret-patterns.ts` stay. The 8
test entries go: tests ask through the entry or live in `tests/inside/broker/`.

## 9. Tests and proof

Three tests of one operation, each small:

```ts
const ruling = await commandRule(request, askingWith({ commands: [statusCommand], effects: ["read"] }), fakeLook);
assert.deepEqual(ruling, { allowed: false, refusal: { resource: "commands", asked: "…", declared: "…", change: "…" } });

const done = await performCommand(commandToRun, worldWith({ processes }));
assert.deepEqual(processes.requests, [{ command: "git", arguments: ["status"], directory: "/project", … }]);

assert.deepEqual(commandRecord(commandToRun, done), [{ kind: "command", detail: { command: ["git", "status"], … } }]);
```

These live in `tests/inside/broker/`. The seven `broker-*` files stay at the entry, moved by script to
`step.ask`, with every expected value kept. On top, one table of proofs runs over all 16 operations, each with an
example that is allowed and one that is refused:

- a refused example changes nothing: the recording adapters saw no call;
- a refused example writes exactly one `refused` event, with all three sentences;
- a secret planted in a request appears in no answer and no event;
- each example gives the same answer through the child process and in process.

A new operation gets these four by adding its two examples; the example record is typed over `OperationName`.

## 10. Walk-throughs

Adding `files.exists`: `bay/sdk.ts` (the method); `operations.ts` (its keys and its line in `contextOver`);
`file-operations.ts` (rule, perform, record, answer); `tests/toolbox-surface.test.ts`; the wire examples; the two
proof examples; its own tests. Three source files and four test files.

Adding `environment` to a command: `sdk.ts`, `operations.ts` (the guard), `commands.ts` (`CommandToRun` and its
use), the surface pin, the wire example. The round-trip test fails if the guard drops the field.

Adding a container transport: one file in `transport/`, one line of kernel wiring, and the proofs run over it.
No operation changes.

## 11. Migration

| # | Slice | Write scope | After |
|---|---|---|---|
| 1 | Move the files into `bay/broker/`, by script | `bay/broker/`, import lines, the map | |
| 2 | The interface: `sdk.ts` declares the shapes; `operations.ts`; the surface pin; the wire examples | `bay/sdk.ts`, `operations.ts`, `contracts.ts`, tests | 1 |
| 3 | `wire.ts`; host and runner read `shapes`; the runner asks the broker by name through one function | `script-*` files, `wire.ts`, `broker.ts` | 2 |
| 4 | `rule.ts`; files and database become four-part definitions | `rule.ts`, resource files, `broker.ts`, `effect-rule.ts` | 3 |
| 5 | The rest; the class and `effect-rule.ts` are deleted; the secret check moves in | the same, and `secrets.ts` | 4 |
| 6 | The transport port: `script-runs.ts`, the child-process adapter, the in-process adapter, the table of proofs | `script-runner.ts`, `transport/`, `tests/inside/broker/` | 3 |
| 7 | Seal: the entry; six callers move; tests to the entry | `broker.ts`, callers, tests, the map | 5, 6 |
| 8 | Effects per listed command in the kernel; both manifests rewritten by script with all five effects | schema, `policy.ts`, `contracts.ts`, `commands.ts`, `check.ts`, `adapter.ts`, the Claude Code adapter, two `mode.yaml` | 7 |
| 9a, 9b | git-worktrees and typescript declare true effects | one mode's folder each | 8 |

Slice 6 can run beside 4 and 5: after slice 3 the runner and the operations meet only at one function, and the
scopes do not overlap. ADR 17 says slices in one kernel feature go one after another, so this needs the owner's
word; if not given, 6 follows 5. Longest chain: seven with the wave, eight without. The chain runs beside the
isolation chain.

## 12. Risks, and what this design makes harder

- It is the most code: about 450 lines more than today, and four functions where a simple operation had one.
  `files.list` gains nothing from the split.
- `Definition` has three type parameters and one optional member. It is the most to learn.
- Some rules need the world: a path check follows links. So the rule is not pure; it is read-only, held by the
  type of `Look`. Redirects are checked hop by hop inside `perform`, with the URL rule passed in as part of what
  was allowed. That one operation does not split cleanly.
- The in-process adapter can hide a fault that only a real child shows. The confinement tests must stay on the
  child process, and the fourth proof exists to catch drift.
- The transport port is a bet that a mode's tests (slice I3) and later a container will use it. If neither does,
  it is a port with one real user.

## 13. What it deliberately does not do

It does not change the toolbox, a refusal or the kinds of event. It does not name commands. It adds no field to a
port for confinement by effects. It does not build a container.

## Open choices for the owner

Transport:
- [x] A port now, with the in-process adapter for tests.
- [ ] No port until a container exists. Slice 6 goes; the design is then A with the four-part definition.

What is recorded:
- [x] The five kinds of event of today.
- [ ] Also every operation with a need: `files.write` and each changing statement (keyword only). More events.
