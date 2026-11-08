# factory-store

Implements `factory.runs/v1` and `factory.slices/v1`: the record of a factory run and the rules on its slicing.

One JSON file per run under `.agentbay/data/factory/`, holding the run's goal, the requirements document, the
language profile it resolved, the pipeline from the project's settings, the slices and every stage record. Agents
never open it; they read it through `factory.runs/v1.status` and `factory.slices/v1.get`.

## What it decides

- **What to call next.** `stages` walks the configured pipeline and returns the calls whose work is not recorded
  yet, capped by that stage's `parallel`. It is read-only and idempotent: it never advances a cursor, so a lost
  answer costs nothing and asking twice gives the same answer. The coordinator records every call of a batch before
  asking again.
- **Whether a slicing may be built.** `propose` checks a slicing against the run's constraints: slice and path
  counts, acceptance criteria, forbidden paths, dependency cycles, the contract on both sides of every dependency,
  and two slices of one wave claiming the same path. One broken rule stores nothing and ends the call blocked with
  the slice and the rule named.
- **When a slice may integrate.** `findings` turns a lens's verdicts into findings. A fail on a `must` or `must_not`
  criterion, or any item rated `blocker`, is blocking while the lens is a blocking one. A fix round does not clear a
  finding; the next review by that lens replaces the lens's findings, which is why a slice is re-judged after every
  fix.

## Settings

It reads `modes.factory` from `agentbay.config.yaml` (`language`, `pipeline`, `reviewers`, `constraints`,
`worktreeRoot`, `branchPrefix`). A missing setting falls back to the default in the mode's `config.schema.json`, so
the connector and `bay config` always agree. `bay config` prints them all.

## What it does not do

It calls no endpoint, spawns no agent, runs no git command, reads no other connector's data and reaches no network.
