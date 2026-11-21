# A clock and random a script may use that are safe to replay (KW3)

The owner chose this idea on 19 November (plan 0024, "After RQ1 and KP2"; research note
`docs/research/2026-11-20-codemod.md`, idea 4). A step that runs again after a crash, a stop for a called action
or the owner's `--rerun` must make the same decisions it made the first time. Today a script that reads the
time or draws a random value decides afresh, and forge's leak check keeps its planted mark in its own rows to get
around that (plan 0024, "After LK1").

## How a script step runs today

- `runScript` (`bay/runs/script-steps.ts`) replays a finished record and runs nothing. A record that started and
  did not finish is run again when the action only reads, when the owner gave `--rerun`, or when the step stopped
  because an action it called waits (`stoppedForCall`). Otherwise the run waits for the owner.
- Running again reuses the record: same key, same input, same detail. A new `step.started` event says `rerun`.
- A step's record holds its key, kind, input, output or reason, spend and a detail. A script's detail is
  `{ script, stoppedForCall? }` (`bay/runs/step-detail.ts`), a JSON column of `steps`.
- The calls a script makes are steps of their own, keyed `<step>/<n>` by the order they are made, and a call that
  finished is replayed by that key when the script runs again.
- `context.now()` is the time the runner started the child, sent in the start message
  (`bay/broker/script-runner.ts`). It does not move while the script runs.

## What is recorded, and where

Both values are kept with the script step's own record:

- The time: the record's `startedAt`, written when the record is created and never changed by an attempt.
  `context.now()` returns it on every attempt of that record. It does not move within a step, as today, and as
  Codemod's clock, which moves only when a step finishes. Nothing new is stored for it.
- `drawn`, a new optional field of a script's detail beside `script`: the values `context.random(bytes)` gave, in
  the order asked, each as lowercase hex. The kernel draws a fresh value with `node:crypto`, writes the detail
  with the value appended, and only then answers the script. A value the script has seen is therefore always in
  the record. A step that draws nothing stores the same detail as before.

`drawn` is stored packed, as a kept output is (`bay/runs/packed-output.ts`), so a text search of `kernel.db`
does not find a value, and a run shows only how many values a step drew (`drawnValues`), never the values. A
value may be a secret of the mode's own, such as forge's leak mark, which a builder must not find in the project
(forge's leak tests look for it in every file). Packing is not encryption: it keeps a value out of a search and
out of `bay runs`, as it does a kept output, and nothing more. No migration is needed: a detail is JSON and
`drawn` is optional when read.

## Replay or a fresh value

The values belong to one record, so the rule is the rule for finished calls: same key, replayed; new key, fresh.

| Case | Key | Values |
|---|---|---|
| The step started and did not finish, and is run again (read-only action, the owner's `--rerun`, a resume after a called action waited) | same | replayed |
| A skill's next round: its checks run again | new (`#<round>`) | fresh |
| A foreach item's new attempt after the owner's `--rerun` | new (`~<attempt>`) | fresh |
| A workflow step or a called action run after another step | new | fresh |
| The undo of an action | new (an undo key) | fresh |
| The same key, run again by another script or mode than the one that drew (the action was changed between the two attempts) | same | dropped, fresh |

Values are replayed only to the script that drew them: the detail records `mode` beside `drawn`, and a rerun
compares the recorded script and mode with the step's. When they differ, the kernel drops the values, writes
the detail with the script that runs now, and says so in the rerun's `step.started` event, in a field
`changed`: "Step 0 ran scripts/log.ts of mode notes before and runs scripts/double.ts of mode notes now, so its 1
recorded random value is dropped and fresh ones are drawn." With none drawn, the sentence ends "so it had drawn
no random values." The run does not stop to ask the owner: the owner has already chosen to run the step again
(or the action only reads), and the only other answer, replaying the old values, would hold the new script to
values another script drew for its own decisions; a question would offer the owner nothing worth choosing.
Calls a script made are still replayed by key whatever script runs (see "Not done here").

## Asking for more, or other, values on replay

- More values than were recorded: those recorded are replayed in order, and the rest are drawn fresh and recorded.
  The earlier attempt never saw them, so nothing it did depends on them.
- A value of another size than the one recorded at that place: the call fails with "Random value 2 of step
  each[0].do/0 was drawn as 16 bytes when the step first ran, and 8 are asked now; a step that runs again asks
  for its values in the same order and sizes." The script did not make the same decisions, and a value cut or
  padded would hide it.

## Bounds

- One value is a whole number of 1 to 64 bytes. Another size is refused by the broker's rule before the kernel
  is asked: "The step <key> asked for 100 random bytes in one value, but a value is a whole number of 1 to 64
  bytes. Ask for at most 64, and ask again for more."
- One step records at most 64 values, so a detail grows by at most about 64 × 130 characters. The 65th call fails:
  "Step <key> has drawn 64 random values, the most one step records."

## The lint rule

The kit's eslint config refuses, in every TypeScript file under `components/` that is not a test (not under a
`tests/` folder and not `*.test.ts`), so a helper a script imports from beside `scripts/` is held too:

- the clock: `Date.now()`, also as `Date["now"]()` and `globalThis.Date.now()`; `Date()`; `new Date()` and
  `new globalThis.Date()` with no arguments; `Date` or `globalThis.Date` given to a variable or taken apart
  (`const D = Date`, `const { now } = Date`);
- random: `Math.random()`, also computed and through `globalThis`; `Math` given to a variable or taken apart;
  `randomBytes`, `randomUUID`, `randomInt`, `randomFill`, `randomFillSync` and `getRandomValues`, called by name,
  through an object or computed, imported from `crypto` or `node:crypto`, or taken apart from `crypto` or
  `globalThis.crypto`.

The messages point at `context.now()` and `context.random(bytes)`. `new Date(value)` and `Date.UTC(...)` are
untouched. A selector reads the syntax of one file and nothing else, so the rule cannot see: an alias made any
other way (`Date` handed to a function, a property of an object that holds it, `Reflect.get`); `Intl` formatting
with no date, such as `new Intl.DateTimeFormat().format()`, which reads the clock inside; `performance.now()` and
`process.hrtime()`, left alone by design because they measure and decide nothing; and code outside `components/`
that a script reaches. It is a guard against the plain mistake, not a proof.

## Why the frames still hold

`docs/designs/operations/0-frame.md`:

- S1: `random` is an operation like the others: the child asks, one rule decides (the size), the kernel answers.
- S2: the child gains no file and no code that does an operation; the generator runs in the kernel.
- S3: a random value needs no effect and grants nothing; no grant or effect is read differently.
- S4: the refusal of a size says what was asked, what is allowed and what to change.
- S5: no guarded operation loses an event; the values are in the step's record.
- S6: the detail is written through the scrubbed store, as every stored value.
- S7: the request is read by the operations table's reader before the rule sees it.

`docs/designs/trust/0-frame.md`: nothing here reads or writes trust, a mode's commands or throwaway folders, so
T1 to T5 are untouched. An agent's tools do not gain `random`, so an agent's step can do nothing it could not.

## Not done here

- A finished call of a script is replayed by its key even when the script that runs again is another one. That
  is older than KW3 and not changed here.

- A clock that moves within a step. No script in the kit needs one; a step's time limits are the kernel's.
- `performance.now()` and `process.hrtime()` are not refused: they measure, and no kit script uses them.
