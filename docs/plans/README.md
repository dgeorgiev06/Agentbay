# Plans

A plan is a YAML file of the forge mode under `docs/plans/`, named `<number>-<job>.yaml`. Its form is
`components/base/forge/schemas/plan.json`. `forge.waves` works out its table, its waves and its longest chain;
nobody edits those by hand. Forge's workflow `plan` writes a plan from a committed design and commits it with
the next free four-digit number. A plan written by hand uses the same form.

```
bay call forge.waves '{"plan":"docs/plans/0023-todo-mode.yaml"}'
```

## The form

- `title`: what the plan builds, in a few words.
- `slices`: each a `title` and a `slice`, the slice as `proof@1` judges it: its name, kind, write scope, the
  slices it comes after with the reason, and its definition of done.
- `oneAfterAnotherBecause`: why no other order exists, when every slice waits for the one before.

These fields are optional, so a plan written before them stays valid:

- `requirements`: the requirements file the plan was cut from, such as `docs/requirements/todo.yaml`.
- `design`: the design file the plan was cut from, such as `docs/designs/todo/design.yaml`.
- In each planned slice, beside `title` and `slice`:
  - `meets`: the condition ids of the requirements the slice makes true.
  - `interface`: the interface files it builds against, from the design's commit: the design file and the
    schema files of the actions it serves or calls.
  - `crossesModulesBecause`: why the slice must reach more than one module of the design, in one sentence.

## What forge.waves checks

Always: an after that names no slice; a cycle; two slices that nothing orders whose scopes share a path; a
scope that admits every private file of a kernel feature, as a warning; every slice waiting for the one before
with no `oneAfterAnotherBecause`; and a slice that changes a fixed file of another slice it does not come
after. A slice's fixed files are the tests its `fails-first` items name and its interface files. A slice
changes a file the plan names for it: a scope entry with no `*`, or a test its `fails-first` item names. A
scope pattern that only admits a file is not counted, and two slices in order may name one test file.

When the plan names `requirements`: a condition no slice meets, and a slice that meets a condition the file
does not hold. The file must pass `requirements.check`.

When the plan names `design`: a slice that names no interface file; a slice that names a file the design did
not commit; a slice that reaches two modules of the design with no `crossesModulesBecause`; a slice of kind
`mode` that meets no condition. A slice reaches a module when it names an interface file of an interface the
module implements, or when its scope admits a file the module owns.

Every problem comes at once, each with its sentence. A plan with an error is sent back.
