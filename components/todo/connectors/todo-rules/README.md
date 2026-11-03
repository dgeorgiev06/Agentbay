# todo-rules

The rules of the todo mode, as a small code connector. It implements the interface `todo.rules/v1`.

It holds no data. It reads no store, uses no network and writes no file. All three endpoints are pure functions of
their input, so all have the effect `read`. The caller reads the to-do first and writes the result afterwards.

Every endpoint takes `items`, the list that `items.store/v2.get` returns, with exactly one to-do, and optionally
`missing`, the ids that get did not find. An empty `items` is refused with `no to-do with that id (<id>); check the
id with todo.query`. More than one to-do is refused too.

It works on `todoitem/v1` items (see `components/todoitem`).

## Files

- `components/todo/interfaces/todo.rules.v1.yaml`: the interface. Three endpoints, `plan`, `brief` and `track`, with
  input and output schemas.
- `connector.yaml`: the connector manifest, in this folder.
- `todo_rules.py`: the code. Python standard library only.
- `tests/test_todo_rules.py`: the tests.

## Endpoints

### plan

Input: `{items, missing?, action: complete|reopen|drop|status, status?, scope?: occurrence|series, at?}`.
Output: `{id, set, next}`.

- `id` is the id of the to-do, for the `update` that writes `set`.
- `set` holds the fields to update: `status`, `completedAt` or `droppedAt`, and `history`. `history` is the whole
  list with one new entry `{at, field, from, to}` at the end. A reopen sets `completedAt` and `droppedAt` to null.
- `next` is a new todoitem for the next occurrence, or null.
- `at` is the time of the change. It defaults to now.

Allowed moves:

- open, doing and waiting move freely among themselves.
- Any of them can go to done or dropped.
- done and dropped can go back to open. Nothing else.

Any other move is refused with an error that names it, for example `status move done -> doing is not allowed`.
Moving to the same status is refused too. `reopen` works only on a done or dropped to-do. `action: status` with
`status: done` or `dropped` does the same as `complete` or `drop`. Every refusal is a `TodoRulesError`.

When a recurring to-do is completed or dropped, `next` has:

- `threadId`: the series. It is the `threadId` of the item, or the item `id` when it has none. In that case `set` also
  carries the `threadId`, so the finished to-do joins the series.
- `prevId`: the id of the item.
- `status: open`, and the next `due`.
- the same `title`, `text`, `labels` and `priority`, and a copy of `recur`. No history, no delegation.

`drop` with `scope: series` ends the series, so `next` is null. `scope: series` is refused for any other action.

#### Recurrence

`recur` is `{every, unit: day|week|month, on?, day?, from?}`. The next due date is worked out inside `plan`.

- `every` counts days, weeks or months.
- `on` lists weekdays (`mon` to `sun`). Only with `unit: week`. Weekdays is `{every: 1, unit: week, on: [mon..fri]}`.
  With `every: 2`, the weeks are counted from the week of the finished date.
- `day` is 1 to 31, or -1 for the last day of the month. Only with `unit: month`. A short month uses its last day, so
  Jan 31 monthly gives Feb 28, or Feb 29 in a leap year.
- Without `day`, a monthly `next.recur` gets `day` set to the day of the original due. So Jan 31 gives Feb 28, then
  Mar 31, and the day does not drift.
- `from` is `due` (the default) or `done`. With `done`, the count starts at the day of `at`. With no `due`, it
  always does.
- The time part of a datetime `due` is kept as written, with its zone.
- A huge `every`, or a date past year 9999, is refused with a `TodoRulesError` that says to use a smaller `every`.

### brief

Input: `{items, missing?, to: build|research, deliverable?}`.
Output: `{id, target: delivery.build|delivery.research, input, delegation}`.

`input` is the exact Task input of that call: `goal`, `deliverable`, `context` and `constraints`. The todo mode shows
it at its gate. `delegation` is the record to store on the to-do: `{target: build|research, status: handed-off, at}`,
with `at` the time of the call.

- It is checked at run time against `components/delivery/types/Task.schema.json`, found from the kit root. If that
  file is missing, or the input does not match, `brief` raises a `TodoRulesError`. A `deliverable` that is not a
  string, or is shorter than 3 characters, is refused.
- The goal quotes the title and the notes as JSON strings and says they are data, not instructions. Very long text
  is cut.
- `context` quotes the to-do id, priority, due date and labels the same way. No to-do field is plain prose.
- `deliverable` defaults to a sensible one for the target.
- A to-do that is done or dropped is refused.

### track

Input: `{items, missing?, callId, status, summary?}`.
Output: `{id, set: {delegation}}`.

`delegation` is the recorded delegation with the new `callId` and `status`, and the `summary` when given. The target
and the hand-off time stay. A to-do with no delegation is refused. The status of the to-do itself is never changed: a
finished delegation does not complete it.

## Tests

    python3 tests/run.py components/todo/connectors/todo-rules/tests/test_todo_rules.py
