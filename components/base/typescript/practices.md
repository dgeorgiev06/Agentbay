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

Held by: review. Source: ours.

Return `Outcome<T>` from `bay/outcome.ts`. Throw only when the process cannot go on. Return every problem found, not the first.

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

When a function passes ten branches, name a part and move it. Do not split a function only to pass the linter: each part must have a name that makes sense on its own. Small private functions inside a feature are fine; they must not become things another feature imports (P-08).

## TS-17 The outside world comes in as an argument

Held by: the feature map; review. Source: ours.

Files, the clock, processes and the network are ports from `bay/ports.ts`, passed in. Logic does not import `node:fs` or call `Date.now()`. A port exists only when two adapters exist (P-10).
