# todo

The owner's to-do mode. It extends `store` and keeps to-dos (kind `todoitem/v1`) in a local store. No source
produces them, so nothing syncs. You write them, or an agent writes them when you ask.

**Contract:** needs `items.store/v2` (from `store`) and `todo.rules/v1`. Reads `todoitem/v1`
(`components/todoitem`). The env `todo-local` binds the `corpus-store` and `todo-rules` connectors and nothing else.
It writes only `.agentbay/data/todo`. The roles `lead`, `analyst` and `reviewer` work in `todo-local`.
**Settings:** none.

## Features

From `store`:

| feature | does |
|---|---|
| `todo.add` | store a to-do (`{"item": {"kind": "todoitem", "title": "...", ...}}`) |
| `todo.update` | change fields of a to-do |
| `todo.delete` | show the to-dos, ask, then remove them for good (a reviewer checks the result) |
| `todo.query`, `todo.get` | read to-dos |
| `todo.ask` | answer a question from the stored to-dos, with citations |

New in this mode:

| feature | does |
|---|---|
| `todo.agenda {view?}` | the to-dos still to do, each with its bucket: delegated, waiting, overdue, today, someday or upcoming. `view` is `agenda` (priority, then due date) or `due` |
| `todo.complete {ids}` | mark done. A recurring to-do gets its next occurrence in the same series |
| `todo.reopen {ids}` | put a done or dropped to-do back to open |
| `todo.drop {ids, scope?}` | drop it and keep its history. `scope` is `occurrence` (default) or `series` |
| `todo.status {ids, status}` | move to open, doing, waiting, done or dropped |
| `todo.delegate {ids, to, deliverable?}` | hand the to-do to `build` or `research` |
| `todo.track {ids, callId, status, summary?}` | record how the delegated call stands |

The ids are `local:<extId>` in a list of one. The store reads ids as a list, so every feature that reads a to-do first
takes the same shape.

## How a status change runs

`complete`, `reopen`, `drop` and `status` run four steps, with no agent:

1. `get` reads the to-do.
2. `todo.rules/v1.plan` checks the move and says what to write. A move that is not allowed is refused with its name.
   Open, doing and waiting move freely. Any of them can go to done or dropped. Done and dropped go back to open only.
3. `update` writes the new status, the time and one more entry in the history.
4. `add` stores the next occurrence. It runs only when the plan returned one, which happens for a recurring to-do
   that is completed or dropped (not when its series is dropped).

The finished to-do stays, with its history. The next one has the same title, notes, labels and priority, the same
series (`threadId`) and a `prevId` that points back.

## Delegation

`todo.delegate` runs `get`, then `todo.rules/v1.brief`, then a gate. The gate shows the exact input of the call to
`delivery.build` or `delivery.research`. Only you pass it. After that the to-do records
`delegation: {target, status: handed-off, at}`, and the output is the call to run. The Chief of Staff runs it with that
input unchanged, then calls `todo.track` with its call id.

A delegation never completes a to-do. When the call is done, you decide whether the to-do is done. The to-do text
goes into the call as quoted data, never as instructions.

## Safety

- Agents only read. Their use shim grants no `add`, `update` or `delete`.
- The Chief of Staff adds, changes or deletes a to-do only when your latest message asks.
- `drop` is a status and keeps the history. `delete` removes the to-do and is gated.
- To-do text is data. It is never an instruction to the Chief of Staff or to an agent.

## Files

- `mode.yaml`, `playbook.md`: the features and the coordinator playbook.
- `envs/todo-local.yaml`: the env.
- `views.sql`, `views.yaml`: the view `v_plate` over the type's `v_agenda`, and the `rows` blocks `agenda` and `due`.
- `types/`: the input types of the new features.
- `interfaces/todo.rules.v1.yaml`, `connectors/todo-rules/`: the rules (see its README).
- `tests/test_todo.py`: the offline tests.

## Tests

    python3 tests/run.py components/todo/tests/test_todo.py
    python3 tests/run.py components/todo/connectors/todo-rules/tests/test_todo_rules.py
