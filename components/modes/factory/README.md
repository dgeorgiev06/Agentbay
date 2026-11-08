# factory (mode)

A software factory for one language: a requirements document becomes a spec, a technical plan the owner approves, a
set of vertical slices, parallel implementations in their own git worktrees, reviews by several lenses, fix rounds,
and an integration branch.

Every stage is one endpoint of this mode, and the order of the stages is a setting. The workflow is configuration,
not code: drop a stage, reorder the stages, widen the fan-out, add or remove a review lens, or tighten the slice
constraints in `agentbay.config.yaml`, and the factory runs differently without a line of this component changing.

```
factory.start  -> F-20261108-ab12         the run: goal, requirements, language profile, pipeline, constraints
factory.next   -> what to call now        read-only; several calls at once when the stage fans out
  spec         analyst  docs/factory/<run>/spec.md     outcomes + acceptance criteria
  plan         analyst  docs/factory/<run>/plan.md     components + the contract between them
  approve      owner    gate bound to the plan file's sha256
  slice        analyst  vertical slices, refused by code when they break a constraint
  build        builder  one worktree per slice; slices of a wave run in parallel
  audit        reviewer one call per (slice, lens); correctness, structure, quality, performance, security
  fix          builder  only what the findings ask for, then the lenses judge again
  integrate    code     merge into factory/<run>, run the checks there, roll back on failure
```

## Run it

```bash
.agentbay/bay call factory.start '{"goal": "Add CSV export to the reports page", "requirements": "docs/requirements/export.md"}'
.agentbay/bay call factory.next  '{"runId": "F-20261108-ab12"}'      # -> calls: [...]
# run every call it returns, in parallel; then ask again
.agentbay/bay call factory.status '{"open": true}'
```

Or ask the Chief of Staff for it: it runs the loop from this mode's coordinator playbook.

## The parts

| Part | Is |
|---|---|
| **Run** | one requirements document on its way to an integration branch. State in `.agentbay/data/factory/`. |
| **Stage** | one endpoint in the pipeline. `spec`, `plan`, `approve`, `slice`, `build`, `audit`, `fix`, `integrate`. |
| **Slice** | one vertical task: an outcome, acceptance criteria, the contracts at its edges, the paths it may touch, its dependencies. |
| **Wave** | the slices that depend on nothing still unbuilt. A wave's slices claim no path in common, so they are built in parallel. |
| **Lens** | one kind of reviewer. Each lens reviews each slice in its own call, with its own checks. |
| **Finding** | a failed verdict. Blocking findings keep a slice out of integration until a fix round clears them. |
| **Language profile** | `languages/<name>.yaml`: the file globs, the check commands and the practices every builder is held to. |

## Parallelism

`factory.next` returns a list of calls. They are independent: the coordinator dispatches them at the same time, each
through the dispatcher on its own, so each keeps its own grants, effects, budget and gates, and nothing recurses.
Two things make that safe rather than hopeful:

- **Subtrees.** A slice is built in its own git worktree on its own branch, and the build env can write nothing
  outside `.factory/trees`. Two builders cannot touch the same file.
- **Disjoint paths.** `factory.slices/v1.propose` refuses a slicing where two slices of one wave claim the same
  path, before anything is built.

`factory.next` is read-only and computes the batch from what has been recorded, so it never advances past work that
was not recorded. Ask again only when every call of the previous batch has been recorded: while a call is out, its
work is not recorded, and you would be handed the same call twice.

## Reviews

A lens is `{id, title, focus, ignores, checks, blocking}` in `modes.factory.reviewers`. Five ship as the default:
correctness, structure (boundaries and contracts), quality, performance and security. Each lens's call gets the
slice, its acceptance criteria and its own checks, and must return a verdict with evidence for every acceptance
criterion id and every check id of the lens; `factory.slices/v1.findings` refuses a set that misses one. `ignores`
is how two lenses are kept from reporting the same finding.

Reviews here are reviewer **steps**, not the framework's injected `review` block, for one reason: a failed injected
review halts its call before the steps after it, and the factory has to record the verdicts precisely when they
fail, because the fix round reads them. The verdict shape is the framework's (`review.verdict/v1` items) and the
`reviewer` role is the framework's, with its own rules; what changes is that the factory keeps the result.

## Fixes

A slice with blocking findings open goes to `fix`, which may change only what the findings ask for. The lenses then
judge the slice again: a lens's record counts only when it is newer than the slice's last build or fix, so the
review automatically reopens after a fix. A slice that is still blocking after `maxFixRounds` rounds stops the run
and names itself, for the owner to decide.

## Constraints

`modes.factory.constraints` is the deterministic gate on a slicing, checked by code before any work starts:
`maxSlices`, `maxPaths`, `maxAcceptance`, `maxDeps`, `requireInterfaces`, `disjointPaths`, `forbiddenPaths` and
`maxFixRounds`. A broken constraint stores nothing and ends the `slice` call blocked, naming the slice and the rule,
so the slicing is fixed rather than reviewed around. Capability limits (turns, minutes) stay where the framework
keeps them: in this component's envs.

## Another language

Add `languages/<name>.yaml` (globs, `commands`, `practices`, `slicing` hints) and set `modes.factory.language`. The
commands run inside a slice's worktree and come only from that file, never from a call's input, so a worker cannot
choose the checks it is held to. If the builder should also run a command while it iterates, add its prefix to
`workspace.write/v1` in `envs/factory-build.yaml`: the three profiles that ship (python, typescript, go) are
already there. The standards step covers the languages a `language:` component declares (Python today).

## Envs

| Env | Reads | Writes | For |
|---|---|---|---|
| `factory-local` | the project | `.agentbay/data/factory`, `.factory` | the coordinator, and every code step |
| `factory-design` | the project | `docs/factory/<runId>/` | spec, plan, slicing: no code, ever |
| `factory-build` | the project | `.factory/trees` | implementing and fixing a slice |
| `factory-review` | the project | nothing | the lenses: read-only, so a reviewer cannot fix what it finds |

## Honest limits

- The `standards` step of `build` and `fix` runs over the project's own tree against the call's start commit, where
  the slice's change is not: the slice's own lint and typecheck run inside its worktree, through
  `factory.tree/v1.checks`, and `integrate` runs them again on the integration branch. The standards step still
  earns its place: it catches a write that escaped the worktree.
- The build env's write path is `.factory/trees`, not one slice's tree, so the guard stops a builder from leaving
  the worktrees but not from writing in a sibling slice's tree. The structure lens checks the slice's declared
  paths, and `checks` reports every file the slice changed.
- Nothing here merges into your branches and nothing removes a worktree. A finished run leaves `factory/<runId>`
  for you to merge, and its trees under `.factory/trees/<runId>/` for you to remove with `git worktree remove`.
- The factory is offline: no env has network or secrets. Research belongs to another mode.
- `factory.runs/v1` and `factory.slices/v1` re-read the run's file on every call. That is deliberate: parallel calls
  record into the same run, and `factory.next` has to see what a sibling call recorded a moment ago. The kit's audit
  reports those four read endpoints as `inefficient-store-read`, and the improve golden counts them as expected.

How it is built, part by part: [DESIGN.md](DESIGN.md). Contracts: `interfaces/factory.runs.v1.yaml`,
`interfaces/factory.slices.v1.yaml`, `interfaces/factory.tree.v1.yaml`. Settings: `config.schema.json`, with an
example in `config.example.yaml`.
