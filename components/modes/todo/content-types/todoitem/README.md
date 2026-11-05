# todoitem

A to-do: the item kind `todoitem` (`todoitem/v1`). No source produces it. The owner or an agent writes it with source
`local`. Modes that read it declare `reads: [todoitem/v1]`.

- `fields.schema.json`: the fields a to-do adds to the base item. The base `title` is the to-do, `text` its notes,
  `labels` its tags and `threadId` the series of a recurring to-do. New fields:
  - `due`, `start`, `completedAt`, `droppedAt`: ISO dates or datetimes.
  - `priority`: 1 urgent, 2 high, 3 normal (the default), 4 someday.
  - `status`: open, doing, waiting, done or dropped (default open).
  - `recur`: `{every, unit: day|week|month, on?, day?, from?}`. `on` lists weekdays (mon to sun). `day` is 1 to 31,
    or -1 for the last day of the month. `from` is `due` or `done`.
  - `prevId`: the occurrence before this one.
  - `delegation`: `{target: build|research, callId, status, summary, artifacts, at}`.
  - `history`: a list of `{at, field, from, to}`.
- `content-type.yaml`: the version, the `history` child table (one row per change, columns `at`, `field`,
  `from_value`, `to_value`) and what `describe` tells agents about each view column.
- `views.sql`:
  - `v_todos`: every `v_items` column, then the to-do fields, `isOverdue` and `dueToday`. The last two are computed
    per query with `date('now','localtime')` against `dueDay`, the local day of `due` (a value with `Z` or an offset
    is converted to local time). They are 0 for done and dropped to-dos.
  - A to-do whose delegation is done or failed but whose status is still open, doing or waiting falls back to the
    other buckets: the owner decides when it is done.
  - `v_agenda`: open, doing and waiting to-dos with a `bucket` (delegated, waiting, overdue, today, someday,
    upcoming), ordered by priority and then due date.
- `fixtures/items.json`: sample to-dos the contract tests validate and run the views against.

There is no `derive.py`. Every field is stored as written, and the two date flags depend on today, so they cannot
be stored.
