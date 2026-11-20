# TypeScript practices

What a builder reads before writing TypeScript in this kit. Each entry says what holds it. An entry held by the compiler or the linter fails `npm run check`, so the builder sees the error; the entry explains what to write instead. Entries held by review are the ones a tool cannot judge.

Where a rule comes from is stated. **Official** means a TypeScript compiler option, the TypeScript documentation, or the Node.js documentation. **Linter** means a published rule of typescript-eslint or eslint. **Ours** means a choice of this project, with its reason. TypeScript publishes no official style guide; the general practices are in `framework/practices.md`.

## TS-01 The file must run with its types erased

Held by: compiler (`erasableSyntaxOnly`, `verbatimModuleSyntax`). Source: official (Node type stripping; TypeScript `erasableSyntaxOnly`).

Node runs these files by removing the types. Nothing may need turning into other code.

```ts
// good
import type { Json } from "./contracts.ts";
const tiers = ["fast", "balanced", "deep"] as const;
type Tier = (typeof tiers)[number];

// bad: none of these can be erased
enum Tier { Fast, Balanced, Deep }
namespace Tiers { export const first = "fast"; }
class Store { constructor(private file: string) {} }
```

## TS-02 A closed set is a union with one shape per case

Held by: linter (`switch-exhaustiveness-check`, no `enum`); review for the shape. Source: official handbook (narrowing, discriminated unions); linter.

A value that cannot exist cannot be written, and the compiler says which case a `switch` forgot.

```ts
// good
type RunState =
  | { readonly status: "running" }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string };

// bad: a done run with no output, or a running run with a reason, both type-check
type RunState = { readonly status: string; readonly output?: Json; readonly reason?: string };
```

## TS-03 No `any`, no assertion, no `!`

Held by: linter (`no-explicit-any`, `consistent-type-assertions` set to never, `no-non-null-assertion`, `ban-ts-comment`). Source: official handbook Do's and Don'ts for `any`; linter for the rest.

Each of these tells the compiler to stop checking. Take `unknown` and narrow it.

```ts
// good
function nameOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === "string" ? value.name : undefined;
}

// bad
function nameOf(value: any): string { return (value as { name: string }).name!; }
```

`as const` is the one assertion allowed: it narrows, it does not override.

## TS-04 Data from outside is parsed once, at the edge

Held by: review. Source: ours.

A manifest, a JSON argument, a database row and a message from a child process are `unknown` until one function has checked them. Past that function the type is trusted and not checked again.

```ts
// good: the edge returns a typed value or problems
function readTask(text: string): Outcome<Task> { ... }

// bad: the same field is re-checked wherever it is used
if (typeof task.round === "number") { ... }
```

## TS-05 A problem the caller can act on is a value

Held by: review. Source: ours; Google TypeScript style guide (`cause`); Go best practices (error handling).

Return `Outcome<T>` from `bay/outcome.ts`. Throw only when the process cannot go on. Return every problem found, not the first.

When a caught error becomes a problem, keep the error as its cause. Add words only when they tell the caller something the cause does not.

```ts
// good
function parseReference(text: string): Outcome<Reference> {
  return text.includes(".") ? succeededWith(split(text)) : failedWith([unplacedProblem(`${text} is not mode.action.`)]);
}

// bad: the caller must know to catch, and learns one problem at a time
function parseReference(text: string): Reference { throw new Error("bad reference"); }
```

## TS-06 Index access may be missing

Held by: compiler (`noUncheckedIndexedAccess`). Source: official compiler option.

`list[0]` and `record[key]` have type `T | undefined`. Handle the missing case; do not silence it.

```ts
// good
const first = steps[0];
if (first === undefined) { return failedWith([unplacedProblem("The action has no steps.")]); }

// bad
const first = steps[0]!;
```

## TS-07 An optional field is absent, not `undefined`

Held by: compiler (`exactOptionalPropertyTypes`). Source: official compiler option.

`caller?: string` means the key may be left out. Build the object without the key.

```ts
// good
const options = caller === undefined ? {} : { caller };

// bad: does not compile
const options: { caller?: string } = { caller: undefined };
```

## TS-08 Exported functions state their types

Held by: linter (`explicit-module-boundary-types`). Source: linter.

Parameter and return types of anything exported are written out, so an interface does not change because a body did.

## TS-09 At most three parameters, then one named object

Held by: linter (`max-params` 3). Source: ours.

```ts
// good
function startRun(target: Target, input: Json, options: StartOptions): Promise<Outcome<Run>>

// bad
function startRun(mode: string, action: string, input: Json, caller: string, budget: Budget, rerun: boolean)
```

## TS-10 Unions, not overloads; no boolean that switches behaviour

Held by: review. Source: official handbook Do's and Don'ts (prefer union types to overloads that differ in one argument); ours for the boolean.

```ts
// good
function show(what: { readonly run: string } | { readonly all: true }): ...

// bad
function show(run: string): ...
function show(all: boolean): ...
```

## TS-11 A class only for state with a lifetime

Held by: linter (no inheritance, `prefer-readonly`, no access keywords); review for the choice. Source: ours.

Use a class for a thing that is opened, holds state and is closed: a store, a broker, an engine. Everything else is a function and a type. No `extends`. A private member is written `#name`: it is JavaScript, so it is still private when the types are erased. Fields are `readonly` unless reassigned.

```ts
// good
export class SqliteRunStore {
  readonly #database: Database;
  #closed = false;
}

// bad
export class RunStore extends BaseStore { private database: Database; }
```

## TS-12 Named exports; a file exports what it defines

Held by: linter (no default export); dead-code check; review. Source: ours.

No default export. No file that only re-exports other files: a feature's entry file defines its interface, it does not forward one.

## TS-13 Promises are awaited or returned

Held by: linter (`no-floating-promises`, part of the strict type-checked set). Source: linter.

A promise that is neither awaited nor returned loses its error.

## TS-14 Parameters are not reassigned; data is `readonly`

Held by: linter (`no-param-reassign`, `prefer-readonly`); review for type fields. Source: ours.

Type fields are `readonly` and lists are `readonly T[]`. A function returns a new value; it does not change the one it was given.

## TS-15 Names say what a thing is, in full words

Held by: review; the glossary. Source: ours.

Full words, no abbreviations. A name uses the word `CONTEXT.md` gives the thing. A function is named for what it returns or does, not how. There are no comments (P-01), so the name carries it.

```ts
// good
function remainingBudget(limit: Budget, spent: Spend): Budget

// bad
function calcRem(l: Budget, s: Spend): Budget
```

## TS-16 One level of thought per function

Held by: linter (`complexity` 10, `no-nested-ternary`); review. Source: ours.

When a function passes ten branches, name a part and move it. A function past about 40 lines is read for a part with a name of its own: a prompt to look, never a reason to split. Do not split a function only to pass the linter: each part must have a name that makes sense on its own. Small private functions inside a feature are fine; they must not become things another feature imports (P-08).

## TS-17 The outside world comes in as an argument

Held by: the feature map; review. Source: ours.

Files, the clock, processes and the network are ports from `bay/ports.ts`, passed in. Logic does not import `node:fs` or call `Date.now()`. A port exists only when two adapters exist (P-10).

## TS-18 A loop says what it makes

Held by: review; linter where a rule exists (`prefer-for-of`). Source: ours.

Making a list from a list is `map`; choosing from one is `filter` or `find`; doing something for each item is `for…of`. An index appears only when the index is the point.

```ts
// good
const open = todos.filter((todo) => todo.status === "open");
const texts = open.map((todo) => todo.text);

// bad
const texts = [];
for (let i = 0; i < todos.length; i++) {
  if (todos[i].status === "open") {
    texts.push(todos[i].text);
  }
}
```

## TS-19 One loop, one job

Held by: review. Source: ours.

A loop that chooses, changes and totals at once is three named steps. Each can be read, and tested, alone.

```ts
// good
const open = todos.filter(isOpen);
const overdue = open.filter((todo) => isOverdue(todo, today));
const count = overdue.length;

// bad
let count = 0;
const overdue = [];
for (const todo of todos) {
  if (todo.status === "open" && todo.due !== undefined && todo.due < today) {
    overdue.push({ ...todo, late: true });
    count += 1;
  }
}
```

## TS-20 Leave early

Held by: review; linter (`no-else-return`, `complexity` 10). Source: ours.

What is refused or empty is answered at the top, and the function returns. The main path is then not nested.

```ts
// good
function markDone(todos: readonly Todo[], id: number): Outcome<readonly Todo[]> {
  const found = todos.find((todo) => todo.id === id);
  if (found === undefined) {
    return refused(`No todo has the id ${String(id)}.`);
  }
  if (found.status === "done") {
    return ok(todos);
  }
  return ok(todos.map((todo) => (todo.id === id ? { ...todo, status: "done" } : todo)));
}

// bad
function markDone(todos: readonly Todo[], id: number): Outcome<readonly Todo[]> {
  const found = todos.find((todo) => todo.id === id);
  if (found !== undefined) {
    if (found.status !== "done") {
      return ok(todos.map((todo) => (todo.id === id ? { ...todo, status: "done" } : todo)));
    } else {
      return ok(todos);
    }
  } else {
    return refused(`No todo has the id ${String(id)}.`);
  }
}
```

## TS-21 A function that decides is apart from one that acts

Held by: review. Source: ours.

Working out what to do is a pure function from values to a value, tested with plain values. Doing it, a write or a call to the outside, is a thin function around it (TS-17).

```ts
// good
function nextId(todos: readonly Todo[]): number {
  return todos.reduce((highest, todo) => Math.max(highest, todo.id), 0) + 1;
}

async function add(store: TodoStore, text: string): Promise<Todo> {
  const todo = { id: nextId(await store.all()), text, status: "open" } as const;
  await store.insert(todo);
  return todo;
}

// bad
async function add(store: TodoStore, text: string): Promise<Todo> {
  const rows = await store.all();
  let highest = 0;
  for (const row of rows) {
    if (row.id > highest) {
      highest = row.id;
    }
  }
  const todo = { id: highest + 1, text, status: "open" } as const;
  await store.insert(todo);
  return todo;
}
```

## TS-22 A function returns one kind of thing

Held by: the compiler for most (TS-08); review. Source: ours.

Not a list at one time and nothing at another: no todos is an empty list. Not a value at one time and a thrown error at another for a problem the caller can act on (TS-05).

```ts
// good
function openTodos(todos: readonly Todo[]): readonly Todo[] {
  return todos.filter((todo) => todo.status === "open");
}

// bad
function openTodos(todos: readonly Todo[]): readonly Todo[] | undefined {
  const open = todos.filter((todo) => todo.status === "open");
  return open.length === 0 ? undefined : open;
}
```

## TS-23 A problem's text says what failed, on what, and what was wanted

Held by: review. Source: Deno style guide (error messages); Go Code Review Comments (error strings).

The text names the action that failed, quotes the value, and gives the state found and the state wanted. A person can act on it without reading the code.

```ts
// good
failedWith([unplacedProblem(`The plan "${file}" names the slice "${name}" twice; each slice needs its own name.`)]);

// bad
failedWith([unplacedProblem("Invalid plan.")]);
```

## TS-24 A try holds only the call that may throw

Held by: linter (`no-empty`) for an empty catch; review. Source: Google TypeScript style guide (keep try blocks focused; empty catch blocks); PEP 8.

Where throwing is allowed, the `try` wraps the one call that may throw, so a bug in the lines around it is not caught by accident. A `catch` is never empty.

```ts
// good
function parsed(text: string): Outcome<Json> {
  try {
    return succeededWith(JSON.parse(text));
  } catch (error) {
    return failedWith([unplacedProblem(`The text is not JSON: ${String(error)}`)]);
  }
}

// bad: a mistake in shapeOf or stored is reported as bad JSON
function loaded(text: string): Outcome<Plan> {
  try {
    const plan = shapeOf(JSON.parse(text));
    stored(plan);
    return succeededWith(plan);
  } catch {
    return failedWith([unplacedProblem("The text is not JSON.")]);
  }
}
```

## TS-25 A module keeps no state

Held by: review; linter (`prefer-const`) for part. Source: Google TypeScript style guide (mutable exports); Go best practices (global state).

No `export let`. No variable at the top of a module that changes after the module loads. State lives in a value that is passed in (TS-17).

```ts
// good
function counted(tally: Tally, word: string): Tally {
  return { ...tally, [word]: (tally[word] ?? 0) + 1 };
}

// bad
let tally: Record<string, number> = {};
export function count(word: string): void {
  tally[word] = (tally[word] ?? 0) + 1;
}
```

## TS-26 Plain types first

Held by: review. Source: TypeScript handbook (generics); Google TypeScript style guide (mapped and conditional types); Go style decisions (generics).

A generic, a mapped type or a conditional type appears when a second real caller needs it, as a port does under P-10. No type parameter that is used once.

```ts
// good
function firstOpen(todos: readonly Todo[]): Todo | undefined {
  return todos.find((todo) => todo.status === "open");
}

// bad: one caller, and the type parameters tell the reader nothing
function firstWhere<T extends { status: string }, K extends T["status"]>(items: readonly T[], status: K): T | undefined {
  return items.find((item) => item.status === status);
}
```

## TS-27 No code that writes code

Held by: review. Source: Deno style guide; Google TypeScript style guide (getters); Google Python style guide (power features).

No `Proxy`. No call found by building a property's name from text. No getter that changes something. Say it out, even when it is longer.

```ts
// good
const handlers = { add: addTodo, list: listTodos };
const handler = name === "add" ? handlers.add : handlers.list;

// bad
const handler = actions[`${name}Todo` as keyof typeof actions];
```
