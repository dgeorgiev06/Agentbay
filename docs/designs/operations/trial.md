# Trial: "rule, then handler" for a web request, a database statement and a file read

"Rule, then handler" holds for all three operations tried, including the two the designer doubted. No handler
needed the request or the grants. The web request needs one extra idea: its ruling carries a rule for the
redirects, which the handler calls at each hop. The database statement needs another: the rule writes the words
of the late refusals in advance, and the handler picks one when the database process answers. Both ideas fit in
the ruling's value, so the ruling does not need to become optional. For the redirects, the type holds the first
hop only. That the handler asks the carried rule before it follows a redirect is held by a test, not by the
compiler. ADR 19's fallback is not needed.

Tried on `b2/toolbox-and-shapes` at `0c89352`, in a throwaway copy. Nothing here is in the kernel.

## What was built

One shared file and three definitions. Twelve tests ask through one function, `answered`, against the fakes
the kernel's tests already use: `recordingSink`, `scriptedHttp`, `fakeClock`, `permissionsIn`, `withProject`,
the real `SecretStore` and the real database process.

The shared part:

```ts
export type Ruling<Allowed> =
  { readonly allowed: true; readonly value: Allowed } | { readonly allowed: false; readonly refusal: Answer<never> };

export type Distinct<Allowed, Request> = [Request] extends [Allowed] ? never : Allowed;

export type Definition<Name extends OperationName, Allowed> = {
  readonly operation: (request: Requests[Name], asking: Asking) => BrokerOperation;
  readonly rule: (request: Requests[Name], asking: Asking) => Promise<Ruling<Distinct<Allowed, Requests[Name]>>>;
  readonly handler: (allowed: Allowed, doing: Doing) => Promise<Answer<Results[Name]>>;
};

async function ruledAndDone<Name extends OperationName, Allowed>(
  definition: Definition<Name, Allowed>,
  request: Requests[Name],
  step: Step,
): Promise<Answer<Results[Name]>> {
  const short = effectRefusal(definition.operation(request, step.asking), step.asking.effects, step.asking.at);
  if (short !== undefined) {
    return refused(short);
  }
  const ruling = await definition.rule(request, step.asking);
  if (!ruling.allowed) {
    return ruling.refusal;
  }
  return definition.handler(ruling.value, step.doing);
}
```

`Asking` is what a rule may read: grants, effects, the action's place, the layout, the file inspector and the
limits. `Doing` is what a handler may use: the ports that act (files, network, clock), the open databases, the
step's key, `storedParameters`, `migratedOnce` and `record`. `Doing` has no grants and no effects. `operation`
wraps `ruledAndDone` in today's `try` and today's `#settle`, so every refusal is scrubbed and written as a
`refused` event (S4, S5, S6). The table is `{ readonly [Name in OperationName]: Guarded<Name> }`.

`operation` maps the request to today's `BrokerOperation`, so the trial reuses `effectRefusal` as it is. In
slice B4 that field becomes `needs` and `described`, as design A says.

`Distinct` is new. It came out of the trial. It makes a rule that allows the request unchanged fail to compile,
so the handler can never be given something the request already satisfies.

## The file read

```ts
const readDefinition: Definition<"files.read", ReadableFile> = {
  operation: (request, asking) => ({
    kind: "files.read",
    path: shownPath(asking.layout, resolve(asking.layout.project, request.path)),
  }),
  rule: async (request, asking) => {
    const permitted = asking.grants.readPaths;
    const check = await checkPath(asking.inspector, {
      layout: asking.layout,
      path: request.path,
      permitted,
      purpose: "read",
    });
    return check.status === "allowed" ? allowedWith({ file: check.path }) : readRefusal(check, asking);
  },
  handler: async (readable, doing) => {
    const text = await doing.files.readText(readable.file);
    return text === undefined ? failed(`The file ${readable.file} does not exist.`) : granted(text);
  },
};
```

`ReadableFile` is `{ readonly file: string }`: the path the check allowed. `readRefusal` is today's
`#pathRefusal` with `purpose` fixed to read. It fitted with no change of idea.

## The web request

```ts
type CheckedRequest = {
  readonly first: HttpRequest;
  readonly redirect: (target: string) => Ruling<string>;
  readonly redirects: number;
  readonly responseBytes: number;
};

function redirectRule(asking: Asking): (target: string) => Ruling<string> {
  return (target) => {
    const check = checkUrl(target, asking.grants.hosts);
    return check.status === "allowed" ? allowedWith(target) : urlRefusal(check, asking, true);
  };
}

const requestDefinition: Definition<"http.request", CheckedRequest> = {
  operation: (request) => ({ kind: "http.request", method: request.method, url: request.url }),
  rule: (request, asking) => {
    const size = Buffer.byteLength(request.body ?? "");
    if (size > asking.limits.httpRequestBytes) {
      return Promise.resolve(
        refusedWith({
          resource: "http",
          asked: `${askingSentence(asking)} to send a request body of ${String(size)} bytes`,
          declared: `the broker sends at most ${String(asking.limits.httpRequestBytes)} bytes`,
          change: "Send a smaller body; no manifest line raises this cap.",
        }),
      );
    }
    const check = checkUrl(request.url, asking.grants.hosts);
    if (check.status !== "allowed") {
      return Promise.resolve(urlRefusal(check, asking, false));
    }
    const limits = { redirects: asking.limits.httpRedirects, responseBytes: asking.limits.httpResponseBytes };
    return Promise.resolve(allowedWith({ first: request, redirect: redirectRule(asking), ...limits }));
  },
  handler: async (checked, doing) => {
    let current = checked.first;
    for (let hops = 0; hops <= checked.redirects; hops += 1) {
      const response = await sentOnce(current, doing);
      if (!response.ok) {
        return response;
      }
      const hop: Hop = { request: current, response: response.value };
      const target = redirectTarget(hop);
      if (target === undefined) {
        return capped(response.value, checked.responseBytes);
      }
      if (hops === checked.redirects) {
        break;
      }
      const ruled = checked.redirect(target);
      if (!ruled.allowed) {
        return ruled.refusal;
      }
      current = nextRequest(hop, ruled.value);
    }
    return failed(`The request was redirected more than ${String(checked.redirects)} times.`);
  },
};
```

`sentOnce` is today's `#sendOnce`: it sends through the port and records the `http` event. `capped` is today's
`#cappedResponse`. `urlRefusal` is today's `#urlRefusal` and `#urlRule`, given `Asking`.

What fitted: the rule checks the first URL and the body. The handler sends and follows. The refusal for a bad
redirect is worded by the rule, inside the closure, and the handler only returns it. The handler never sees the
hosts.

What did not fit by type: the redirect target and the allowed target are both `string`. A handler that skipped
`checked.redirect` and passed `target` to `nextRequest` would compile. The test "a redirect to an undeclared host
is refused while the request runs" catches it. A distinct type for an allowed target would not close the gap
either: the handler lives in the same file as the code that makes that type, so it could make one itself.

## The database statement

```ts
type LateRefusals = {
  readonly writesOnReadOnly: RefusalWording;
  readonly severalStatements: RefusalWording;
  readonly missing: string;
};

type StatementToRun = {
  readonly file: string;
  readonly sql: string;
  readonly parameters: SqlParameters;
  readonly writable: boolean;
  readonly migrateFirst: string | undefined;
  readonly late: LateRefusals;
};

function statementAnswer(result: DatabaseResult<Json>, late: LateRefusals): Answer<ExecuteResult> {
  switch (result.status) {
    case "done":
      return isExecuteResult(result.value)
        ? granted(result.value)
        : failed("The database process gave an answer of the wrong shape.");
    case "missing":
      return failed(late.missing);
    case "writes-on-read-only":
      return refused(late.writesOnReadOnly);
    case "several-statements":
      return refused(late.severalStatements);
    case "error":
      return failed(`The statement failed: ${result.message}`);
  }
}

const executeDefinition: Definition<"db.execute", StatementToRun> = {
  operation: (request) => ({ kind: "db.execute", sql: request.sql }),
  rule: (request, asking) => {
    const file = partitionFile(request.partition, asking);
    if (!file.allowed) {
      return Promise.resolve(file);
    }
    const keyword = leadingKeyword(request.sql);
    const allowedKeywords = [...readKeywords, ...writeKeywords];
    if (!allowedKeywords.includes(keyword)) {
      return Promise.resolve(
        refusedWith({
          resource: "db",
          asked: `${askingSentence(asking)} to run a statement that starts with "${keyword}"`,
          declared: `this call runs only ${allowedKeywords.join(", ")} statements on the mode's own database`,
          change: "No manifest line allows attach, detach, vacuum, pragma or transaction statements; use plain SQL.",
        }),
      );
    }
    const migrations = migrationsFolder(request.partition, asking);
    if (!migrations.allowed) {
      return Promise.resolve(migrations);
    }
    return Promise.resolve(
      allowedWith({
        file: file.value,
        sql: request.sql,
        parameters: request.parameters,
        writable: changesDataAllowed(asking.effects),
        migrateFirst: migrations.value,
        late: lateRefusals(keyword, asking),
      }),
    );
  },
  handler: async (statement, doing) => {
    const folder = statement.migrateFirst;
    if (folder !== undefined) {
      const ready = await doing.migratedOnce(() => migrated(statement, folder, doing));
      if (!ready.ok) {
        return ready;
      }
    }
    const parameters = await doing.storedParameters(statement.parameters);
    const order = { method: "execute" as const, sql: statement.sql, parameters, writable: statement.writable };
    return statementAnswer(await doing.databaseOf(statement.file).request(order), statement.late);
  },
};
```

`partitionFile` is today's `#partitionFile`. `migrationsFolder` is the grant check that today sits inside
`#migrateNow`: the migrations must lie inside the mode's folder. `lateRefusals` holds the two refusals of today's
`#databaseAnswer`, worded when the rule runs. `migrated` is the rest of `#migrateNow` and `#migrationsIn`.

What fitted: the rule decides the connection (`writable`) from the effects, so the handler does not need them.
The database process finds a hidden write or a second statement only when it runs. The handler then returns the
words the rule wrote. The `refused` event and the scrubbing are the same as today, because `settled` treats a
late refusal like any other.

Two things moved. The migration folder check moved from the migration into the rule. It is still made before
the statement runs, so no answer changes. And the step must remember that it migrated once; `#unnamedMigration`
in today's class becomes `migratedOnce` in `Doing`.

## Did a handler need what the ruling did not carry?

No. Each handler used only its ruling and `Doing`:

| Operation | From the ruling | From `Doing` |
|---|---|---|
| `files.read` | the checked file | `files.readText` |
| `http.request` | the first request, the redirect rule, the two limits | `http`, `record`, the step's key |
| `db.execute` | file, statement, connection, migration folder, late refusal words | `databaseOf`, `migratedOnce`, `storedParameters`, `files`, `clock` |

The limits for the web request could come from `Doing` instead. I put them in the ruling so that the handler
reads one value.

## The compiler's messages

An entry missing from the table:

```
bay/broker/trial/operations.ts(6,14): error TS2741: Property '"db.execute"' is missing in type '{ "http.request": Guarded<"http.request">; "files.read": Guarded<"files.read">; }' but required in type 'Operations'.
```

The one function gives the handler the request instead of the ruling's value:

```
bay/broker/trial/rule.ts(119,29): error TS2345: Argument of type 'Requests[Name]' is not assignable to parameter of type 'Allowed'.
  'Allowed' could be instantiated with an arbitrary type which could be unrelated to 'Requests[Name]'.
```

A definition whose handler is written to take the request:

```
bay/broker/trial/files.ts(61,3): error TS2322: Type '(request: { readonly path: string; }, doing: Doing) => Promise<Failure | { readonly ok: true; readonly value: string; }>' is not assignable to type '(allowed: ReadableFile, doing: Doing) => Promise<Answer<string>>'.
  Types of parameters 'request' and 'allowed' are incompatible.
    Property 'path' is missing in type 'ReadableFile' but required in type '{ readonly path: string; }'.
```

A rule that allows the request unchanged, with `Distinct`:

```
bay/broker/trial/unchecked-probe.ts(6,22): error TS2322: Type 'Promise<Ruling<{ readonly path: string; }>>' is not assignable to type 'Promise<Ruling<never>>'.
  Type 'Ruling<{ readonly path: string; }>' is not assignable to type 'Ruling<never>'.
    Type '{ readonly allowed: true; readonly value: { readonly path: string; }; }' is not assignable to type 'Ruling<never>'.
      Type '{ readonly allowed: true; readonly value: { readonly path: string; }; }' is not assignable to type '{ readonly allowed: true; readonly value: never; }'.
        Types of property 'value' are incompatible.
          Type '{ readonly path: string; }' is not assignable to type 'never'.
```

`Distinct` stops only the plainest mistake. A ruling of `{ request }` still compiles. What a rule allows is
still read by a reviewer.

## Lines

Counted after formatting. Today's methods are in `bay/broker/broker.ts`; some of them serve more than one
operation, so the comparison favours today.

| Operation | The definition alone | Its file | What it replaces | Lines today |
|---|---|---|---|---|
| `files.read` | 20 | 67 | `readFile`, `#checkedPath`, `#pathRefusal` (shared with write and list) | 10 + 5 + 30 = 45 |
| `http.request` | 45 | 133 | `request`, `#sendFollowingRedirects`, `#urlRefusal`, `#urlRule`, `#sendOnce`, `#cappedResponse` | 4 + 29 + 7 + 26 + 16 + 9 = 91 |
| `db.execute` | 47 | 195 | `execute`, `#partitionFile`, `#migrateNow`, `#migrationsIn`, `#migratedFirst`, `#statementRefusal`, `#databaseAnswer` (several shared with query and migrate) | 21 + 17 + 26 + 17 + 7 + 8 + 28 = 124 |
| The one function | | 148 | `#guarded`, `#settle`, `#append` | 10 + 26 + 8 = 44 |

Each file holds about 15 import lines. The shared file also holds `Requests`, `Results`, `Asking`, `Doing` and
`Step`, which the class held as private fields. The trial is larger than the code it replaces, as design C
predicted. Most of the rise is types that name what each side may touch.

## The tests

Run in the throwaway copy with `node --test tests/trial.test.ts`:

```
ok 1 - files.read: a granted file is read, through the ruling
ok 2 - files.read: a path outside the grant is refused by the rule, and the handler never runs
ok 3 - http.request: a declared host is reached and recorded
ok 4 - http.request: without the network effect nothing is sent
ok 5 - http.request: an undeclared host is refused by the rule before any request
ok 6 - http.request: a redirect to an undeclared host is refused while the request runs, by the rule it carries
ok 7 - http.request: redirects between declared hosts are followed, dropping credentials on a host change
ok 8 - http.request: too many redirects fail after six requests
ok 9 - db.execute: with the write effect a statement runs after the migrations
ok 10 - db.execute: a write its first word does not show is refused late, in words the rule wrote
ok 11 - db.execute: two statements in one call are refused late, by the database process
ok 12 - db.execute: a pragma is refused by the rule, and an insert without write by the effect rule
# tests 12
# pass 12
# fail 0
```

Every refusal sentence the tests compare is today's, character for character.

## Security properties

None is weakened. S1: `ruledAndDone` is the only caller of a handler. S3: every grant check is in a rule. S4:
the refusals keep today's words. S5: `refused` and `http` events are written as today. S6: `settled` scrubs
every refusal and failure, and `record` scrubs every event. S2 and S7 are not touched by the trial.

## What this means for the table of shapes

The shapes in `operations.ts` need no change for the ruling. The rule reads `Requests[Name]` and the handler
answers `Results[Name]`. The ruling's value is private to each definition and never crosses to the child.

## Not tried

The other 13 operations. `spend` and `call`, whose handlers change the run and not the world. The migration
answer was simplified: a failed migration gives one sentence here, not today's per-status words. Lint and format
passed on the trial's files; the dead-code check was not run on the copy.
