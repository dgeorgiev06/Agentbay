# todo-rules

The rules of the todo mode, as a small code connector. It implements the interface `todo.rules/v1`.

It holds no data. It reads no store, uses no network and writes no file. Every endpoint is a pure function of its
input, so every endpoint has the effect `read`. The caller reads the to-do first and writes the result afterwards.

It works on `todoitem/v1` items (see `components/todoitem`).

## Files

- `interfaces/todo.rules.v1.yaml`: the three endpoints, with input and output schemas.
- `connector.yaml`: the connector manifest.
- `todo_rules.py`: the code. Python standard library only.
- `tests/test_todo_rules.py`: the tests.

## Endpoints

### plan

Input: `{item, action: complete|reopen|drop|status, status?, scope?: occurrence|series, at?}`.
Output: `{set, next}`.

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
`status: done` or `dropped` does the same as `complete` or `drop`.

When a recurring to-do is completed or dropped, `next` has:

- `threadId`: the series. It is the `threadId` of the item, or the item `id` when it has none. In that case `set` also
  carries the `threadId`, so the finished to-do joins the series.
- `prevId`: the id of the item.
- `status: open`, and the next `due`.
- the same `title`, `text`, `labels`, `priority` and `recur`. No history, no delegation.

`drop` with `scope: series` ends the series, so `next` is null. `scope: series` is refused for any other action.

### recurrence

Input: `{recur, due?, doneAt?}`. Output: `{next}`, the next due date.

`recur` is `{every, unit: day|week|month, on?, day?, from?}`.

- `every` counts days, weeks or months.
- `on` lists weekdays (`mon` to `sun`). Only with `unit: week`. Weekdays is `{every: 1, unit: week, on: [mon..fri]}`.
  With `every: 2`, the weeks are counted from the week of the finished date.
- `day` is 1 to 31, or -1 for the last day of the month. Only with `unit: month`. A short month uses its last day, so
  Jan 31 monthly gives Feb 28, or Feb 29 in a leap year. Without `day`, the day of the month of the finished date
  is used.
- `from` is `due` (the default) or `done`. With `done`, the count starts at the day of `doneAt`. With no `due`, it
  always does.
- The time part of a datetime `due` is kept as written, with its zone.

### brief

Input: `{item, to: build|research, deliverable?}`.
Output: `{target: delivery.build|delivery.research, input}`.

`input` is the exact Task input of that call: `goal`, `deliverable`, `context` and `constraints`. The todo mode shows
it at its gate. It is checked against `components/delivery/types/Task.schema.json`.

- The goal quotes the title and the notes as JSON strings and says they are data, not instructions. Very long text
  is cut.
- `deliverable` defaults to a sensible one for the target.
- `context` names the to-do id, its priority, due date and labels.
- A to-do that is done or dropped is refused.

## Tests

    python3 tests/run.py components/todo/connectors/todo-rules/tests/test_todo_rules.py
