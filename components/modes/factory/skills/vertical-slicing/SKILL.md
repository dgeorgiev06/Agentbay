---
name: vertical-slicing
description: How to cut a technical plan into vertical slices with boundaries and contracts that hold while several builders work at once. Use when writing a spec, a plan or a slicing in the factory mode.
---

# Vertical slicing

A slice is vertical when it delivers something observable on its own. "Add the users table" is horizontal: nothing
can be seen until three other slices land. "Create a user and read it back through the API" is vertical: it crosses
every layer it needs, thinly.

## Cutting

1. Start from the acceptance criteria of the spec, not from the components of the plan. Each slice takes a group of
   criteria that are true together or not at all.
2. Walk the criteria end to end and write down every file the walk touches. That list is the slice's `paths`.
3. Where two slices want the same file, you have found an edge, not a slice. Either make it one slice, or move the
   shared part into the earlier slice and give it a contract the later one consumes.
4. Keep the first slice the thinnest end-to-end path that works. Later slices widen it.

## Contracts at the edges

A contract is what lets two slices be built at the same time. State it precisely enough to build against without
reading the other side's code:

- the exact name and signature, schema or payload, with the types;
- what it guarantees (ordering, idempotence, what it does with bad input);
- the stub the consumer uses while the publisher is unfinished, and which slice deletes that stub.

The publisher declares it as `publishes`, the consumer as `consumes`, under the same name. If you cannot write the
shape, the slicing is not ready: the edge is still a design question, and it belongs in the plan.

## Acceptance criteria

Each one is observable, in one sentence, and fails loudly when it is not met:

- good: "POST /users with a duplicate email returns 409 and writes no row".
- bad: "duplicate emails are handled correctly".

Use `must` for what the slice is for, `should` for quality bars, and `must_not` for what it may not do (the ones
that catch a builder taking the easy way). Name the command or test that shows each one wherever there is one.

## Signs the cut is wrong

- A slice's outcome needs the word "and" twice: split it.
- Two slices in one wave list the same path: merge them or add a contract.
- A slice has more than a handful of dependencies: it is last, not independent; or the plan is layered, not sliced.
- A slice has no `must` criterion: it is a refactor with no observable outcome. Attach it to the slice that needs it.
