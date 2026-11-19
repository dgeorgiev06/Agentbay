# What a good test is: the reviewer's instructions

For the reviewer of a slice (ADR 24). This becomes a resource of forge's review skill. The examples use the todo mode. The reviewer reads the tests against the slice's conditions, never against the builder's code first.

## How to review

1. Read the slice's conditions. For each, write down in one line what a person would see if it held.
2. Read the tests. For each condition, find the case that would fail if the condition did not hold. A condition with no such case is a finding.
3. Go through the ten questions below for every case, then the list of negative paths for every action.
4. Only then read the code, to ask the planter's question: what small break here would no case notice?
5. Each finding names the case, the question it fails, and what would fix it. A finding for the test writer may quote the test. A finding for the builder never does.

## The ten questions

### 1. Does it test the condition, through the interface?

A test calls what a user of the module calls. It does not reach into the module's files.

Weak: it tests a helper the condition never mentions.

```ts
import { openTodos } from "../scripts/list.ts";

test("the table is created", async () => {
  const table = await openTodos(fakeContext);
  assert.equal(table.name, "todos");
});
```

Good: it does what the condition says.

```ts
test("a todo that was added is listed", async () => {
  await project.output("todo.add", { text: "buy milk" });
  const listed = await project.output("todo.list", {});
  assert.deepEqual(listed.todos, [{ id: 1, text: "buy milk", status: "open" }]);
});
```

### 2. Would it fail if the code were wrong?

Ask of each assertion: which wrong program still passes this?

Weak: any answer at all passes.

```ts
const listed = await project.output("todo.list", {});
assert.ok(listed);
assert.ok(Array.isArray(listed.todos));
```

Good: only the right answer passes.

```ts
assert.deepEqual(listed.todos, [
  { id: 1, text: "buy milk", status: "open" },
  { id: 2, text: "call the bank", status: "open" },
]);
```

### 3. Does it state the expected value literally?

The expected value is written out. It is not computed the way the code computes it, or the test repeats the code's mistake.

Weak:

```ts
const expected = texts.map((text, index) => ({ id: index + 1, text, status: "open" }));
assert.deepEqual(listed.todos, expected);
```

Good: the literal list, as in question 2.

### 4. Does one case show one thing, and say which in its name?

The name is a sentence that is true when the case passes. A reader of a failing name knows what broke without opening the file.

Weak: `test("todo works")`, `test("list")`, or one case with twelve unrelated assertions.

Good: `test("a todo marked done is not listed among the open ones")`.

### 5. Are the edges of the condition covered?

For every rule there is a case at the edge and a case just past it: none, one and two; the empty text; the longest text allowed and one more; the id that names nothing; the same call twice.

Weak: only "add one todo, list it".

Good, beside the main case:

```ts
test("an empty text is refused, and nothing is stored", async () => {
  const refused = await project.refusal("todo.add", { text: "" });
  assert.match(refused, /text/);
  assert.deepEqual((await project.output("todo.list", {})).todos, []);
});

test("listing before anything was added gives an empty list", async () => {
  assert.deepEqual((await project.output("todo.list", {})).todos, []);
});
```

### 6. Does it check what must not happen?

A refusal changes nothing. A read writes nothing. One user's data is not shown to another. These are conditions too, and a test for them asserts the state after, not only the error.

Weak: it checks that the error came and stops.

Good: the first case under question 5, which also lists after the refusal.

### 7. Is it independent of the other cases and of the clock?

Each case makes what it needs and passes alone, in any order, on a busy machine. Time comes from the test toolbox's clock, never from the real one. No case sleeps.

Weak:

```ts
test("a second todo gets id 2", async () => {
  const added = await project.output("todo.add", { text: "call the bank" });
  assert.equal(added.id, 2);
});
```

It passes only when another case ran first.

Good: the case adds both todos itself, in a project of its own.

### 8. Does it use the real thing where it can?

The kernel, the database and the mode are real, opened by the test toolbox. Only what is outside the machine is replaced: the network, a paid service, the model. A replaced thing answers the way the real one is documented to, including its failures.

Weak: the database is a hand-written object that always says "saved", so a wrong table or a failed write passes.

### 9. Is it tied to behaviour, not to how the code is written?

Would the case still pass after the builder rewrote the inside without changing what a user sees? If not, it tests the writing.

Weak: it asserts that a private function was called once, or the exact SQL text, or the order of fields in a row that the interface does not promise.

Good: it asserts what the interface promises: the response's shape and values, the refusal's sentence, what a later call returns.

### 10. Can a person read it?

A case reads top to bottom: what is set up, what is done, what is expected. Shared setup is small and named. A sentence a person reads from the product is pinned whole, so that a change to it is seen.

Weak: a loop over a table of twenty unnamed rows, where a failure says "row 13".

Good: a table is fine when each row has a name and the failure prints it.

## Negative paths

Most tests show that the right input gives the right answer. A reviewer asks just as hard what happens when things go wrong, since that is where a builder's code is thinnest and where a person is hurt most. For every action in the slice, go down this list. Each row that applies needs a case; a row that does not apply is said so in one line.

| What goes wrong | A case for the todo mode |
|---|---|
| Input missing or of the wrong kind | `add` with no text; with a number for the text |
| Input at and past a limit | the longest text allowed is kept whole; one character more is refused |
| Input that is empty or only spaces | `add` with `""` and with `"   "` |
| It names something that is not there | `done` with an id no todo has |
| It was already done | `done` twice on one todo; `remove` twice |
| The caller may not | one caller lists or removes another caller's todos |
| Hostile input | a text that is SQL, a path with `..`, a control character, a very long line: it is stored and listed as text, or refused, never acted on |
| What it depends on fails | the database cannot be opened or written; a call to another action is refused; a time limit is reached |
| It fails half way | adding three todos where the second is refused: the first is kept or none is, as the condition says, and never half a row |
| Two at once | two adds at the same moment get two ids |

A negative case is whole only when it asserts four things:

1. **It is refused, not ignored.** The call fails; it does not answer as if it had worked.
2. **The sentence says what was wrong and what to do**, and it is pinned, at least the part a person acts on.
3. **Nothing changed.** The state after is the state before, read back through the interface.
4. **It still works afterwards.** The next right call succeeds; the failure left nothing stuck.

Weak: it only sees that something was thrown.

```ts
test("done with a bad id fails", async () => {
  await assert.rejects(project.output("todo.done", { id: 99 }));
});
```

Any failure passes that, including a crash for an unrelated reason.

Good: all four.

```ts
test("marking done an id that names no todo is refused, changes nothing, and the next call works", async () => {
  await project.output("todo.add", { text: "buy milk" });

  const refused = await project.failure("todo.done", { id: 99 });
  assert.equal(refused, "No todo has the id 99. List the todos to see their ids.");

  assert.deepEqual((await project.output("todo.list", {})).todos, [{ id: 1, text: "buy milk", status: "open" }]);

  await project.output("todo.done", { id: 1 });
  assert.deepEqual((await project.output("todo.list", {})).todos, []);
});
```

A failure of something the code depends on is made to happen in the test: a database file that cannot be written, a made-up action that refuses, the toolbox's clock moved past a limit. If the test toolbox cannot make it happen, that is a finding for the owner, not a reason to leave the case out.

A reviewer counts: for each action, how many cases show it working and how many show it refusing. An action with five of the first and none of the second is a finding whatever the conditions say.

## What is not a finding

- A case the reviewer would have written differently that still answers all ten.
- A missing case for something no condition asks for. Say it as a question for the owner, not as a finding.
- Style a tool already holds: formatting, lint.

## What the reviewer hands back

For each condition: held by which cases, or not held and why. For each finding: who it is for (the test writer or the builder), the case's name, the question it fails, one sentence on the fix. Then the practices no tool holds, each as held or not with one line. Everything the reviewer writes is judgement and is marked so on the card.
