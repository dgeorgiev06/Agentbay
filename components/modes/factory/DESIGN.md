# factory: design

How the software factory is built: the shape of the component, the contracts between its parts, what each
feature does, and where the boundaries are. The user-facing description is in [README.md](README.md); this
document is for someone changing or extending the factory.

## 1. What it is

One agentbay mode that takes a requirements document to an integrated branch for one language, in stages the
project configures. Four properties drive every decision below:

| Property | How it is achieved |
|---|---|
| The workflow is configurable | Each stage is one endpoint. The order, the fan-out width, the lenses and the fix-round budget are settings (`modes.factory`), read at run time, never compiled in. |
| Work runs in parallel | A stage returns a *list* of calls. The coordinator runs them at once, each through the dispatcher on its own. |
| Parallel work is safe | One git worktree and branch per slice, a build env that can write nothing outside the worktree root, and a deterministic refusal of any slicing where two slices of one wave claim the same path. |
| Judgement is recorded, not implied | Acceptance criteria are data on the slice; a lens's verdicts become findings; a finding is open until that lens judges the slice again. |

## 2. Directory structure

```
components/modes/factory/
  mode.yaml                  the 11 features, their steps, roles, effects and types
  playbook.md                the coordinator's loop (dispatch a batch, record it, ask again)
  README.md  DESIGN.md       what it is / how it is built
  config.schema.json         the settings surface, with every default
  config.example.yaml        the same, as a project would write it
  interfaces/                factory.runs.v1.yaml  factory.slices.v1.yaml  factory.tree.v1.yaml
  types/                     StartReq RunRef ApproveReq SliceRef AuditRef StatusReq
                             RunState Spec Plan Slices Verdicts Result
  features/<feature>/        playbook.md (Purpose, Inputs, Steps, Definition of Done, Outputs, Failure handling)
                             rules.yaml  (R-n rules, each for the executor, the reviewer or both)
                             for spec, plan, slice, build, audit, fix
  envs/                      factory-local  factory-design  factory-build  factory-review
  languages/                 python.yaml  typescript.yaml  go.yaml
  skills/vertical-slicing/   how to cut slices and write the contract at an edge
  connectors/
    factory-store/           factory_store.py (endpoints) pipeline.py (stage engine) slicing.py (rules)
    factory-tree/            factory_tree.py (endpoints)   git_tree.py (the only place git runs)
  tests/test_factory.py      the stages end to end through the dispatcher
```

Run-time state lives outside the component: `.agentbay/data/factory/<runId>.json` (the run) and
`.factory/trees/<runId>/<sliceId>` (the worktrees), both under the project.

## 3. Component boundaries

```
coordinator (lead, main thread)
   │  bay call factory.<stage>
   ▼
dispatcher ──code step──> factory.runs/v1 ─┐
           ──code step──> factory.slices/v1┼─> factory-store ─> .agentbay/data/factory/
           ──code step──> factory.tree/v1 ─┘   factory-tree  ─> git worktrees, profile commands
           ──code step──> standards.check/v1 ─> python-check, comments-check
           ──role step──> analyst | builder | reviewer  (subagents, each in one env)
```

The rules that hold it together:

- **Modes name capabilities, never connectors.** `mode.yaml` names `factory.runs/v1`, and
  `envs/factory-local.yaml` is the only place that says which code serves it.
- **No connector loads another** (B-7). `factory-store` and `factory-tree` share no module; each reads the
  language profiles itself. The only shared code is the kernel (`bay.connect`).
- **One connector owns one concern.** `factory-store` never runs git; `factory-tree` never reads the run file.
  What a worktree operation needs about a run (its language profile) arrives as the `language` input of the
  call, put there by the slice brief, so there is no back channel between the two.
- **Agents reach no factory endpoint.** No role step has a use shim into `factory.*`: a worker is handed what
  it needs by the code step before it (`run`, `tree`, `brief`). Those briefs are the whole contract between the
  deterministic side and the agentic side.
- **Deterministic decisions stay in code.** Whether a slicing is admissible, which calls come next, whether a
  finding blocks, whether a merge stands: `slicing.py`, `pipeline.py` and `factory_tree.py`. Agents write specs,
  plans, slicings, code and verdicts; they never decide what runs next.

## 4. Interfaces

`factory.runs/v1` — the run and the stage cursor (connector: factory-store).

| Endpoint | In | Out | Effects |
|---|---|---|---|
| `open` | goal, requirements?, language? | the run: id, stage, pipeline, language profile, lenses, constraints, calls | read, write |
| `stages` | runId | the same shape: what to call now | read |
| `record` | runId, stage, status, sliceId?, lens?, summary?, artifacts?, artifact?, approved?, by? | the run, advanced | read, write |
| `status` | runId?, open? | runs with their stages, slices and finding counts | read |

`factory.slices/v1` — the tasks of a run (connector: factory-store).

| Endpoint | In | Out | Effects |
|---|---|---|---|
| `propose` | runId, slices[] | accepted[], rejected[{id, problems[]}], waves[][], `stopped` when any is rejected | read, write |
| `brief` | runId, sliceId, lens?, kind? | the slice, acceptance, interfaces, paths, practices, commands, lens, open findings, rounds | read |
| `get` | runId, sliceId? | slices with state, findings and rounds; waves | read |
| `findings` | runId, sliceId, lens, items[] | open[], blocking, recorded, `stopped` when an id is missing | read, write |

`factory.tree/v1` — the subtree a slice is built in (connector: factory-tree).

| Endpoint | In | Out | Effects |
|---|---|---|---|
| `open` | runId, sliceId | path, branch, base, head, created | read, write |
| `checks` | runId, sliceId, language?, only? | ran[{name, command, ok, exitCode, tail}], failed[], changedFiles[], `stopped` | read, write |
| `integrate` | runId, sliceId | merged, branch, commit, conflicts[], checks, `stopped` | read, write |
| `trees` | runId | the run's worktrees and its integration worktree | read |

`stopped` is the kernel's contract for a code step that ends its call blocked: the dispatcher copies it into the
call's reason. The factory uses it for the three refusals that must not be negotiable — a slicing that breaks a
constraint, a verdict set that misses an id, and a check that fails in a worktree.

## 5. Features

| Feature | In | Steps | Role, env | Effects |
|---|---|---|---|---|
| `start` | StartReq | open | — | read, write |
| `next` | RunRef | stages | — | read |
| `spec` | RunRef | run → **draft** → record | analyst, factory-design | read, write |
| `plan` | RunRef | run → **draft** → record | analyst (deep, high), factory-design | read, write |
| `approve` | ApproveReq | gate (`approves: $in.plan`) → record | the owner | read, write |
| `slice` | RunRef | run → **propose** → validate → record | analyst, factory-design | read, write |
| `build` | SliceRef | tree → brief → **implement** → standards → checks → record | builder, factory-build | read, write |
| `audit` | AuditRef | brief → **judge** → findings → record | reviewer, factory-review | read, write |
| `fix` | SliceRef | tree → brief → **fix** → standards → checks → record | builder, factory-build | read, write |
| `integrate` | SliceRef | merge → record | — | read, write |
| `status` | StatusReq | show | — | read |

Role steps are in bold; every other step is deterministic code. Each role step's output is typed (`Spec`, `Plan`,
`Slices`, `Result`, `Verdicts`) and validated by the dispatcher before the next step runs.

Reviews are reviewer *steps*, not the framework's injected `review` block, and every feature says
`review: { when: never }` to make that explicit. The reason is mechanical: a failed injected review halts its call
before the steps after it, and the factory has to record verdicts exactly when they fail, because the fix round
reads them. The verdict content is still the framework's (`review.verdict/v1` items) and the reviewer is the
framework's `reviewer` role with its own prompt and rules.

## 6. Data model

```
run      runId goal requirements status seq language{} lenses[] constraints{} pipeline[] worktreeRoot branch
         slices[] waves[][] records[]
slice    id title outcome acceptance[{id level statement check}] paths[] interfaces[{name role shape stub}]
         deps[] notes state(planned|built|reviewed|blocked|integrated) rounds findings[]
finding  lens id level severity evidence suggestion blocking round open
record   seq stage status at sliceId? lens? summary artifacts[] approved? by?
```

`seq` is a monotonic counter over records. It is what makes review rounds work: a lens's judgement counts only
while its record is newer than the slice's last `build` or `fix` record, so a fix automatically reopens the review.

## 7. The stage engine

`pipeline.plan(run)` walks the enabled pipeline entries in order and returns at the first one with work:

| Stage kind | Complete when | Calls it emits |
|---|---|---|
| spec, plan, approve, slice | one record with status `done` | one call; `approve` carries the plan file the plan stage recorded |
| build | every slice has a `done` build record | one per slice whose dependencies are all built |
| audit | every (slice, lens) is judged after the slice's last change | one per unjudged (slice, lens) |
| fix | no slice has a blocking finding open | one per slice with blocking findings and rounds left |
| integrate | every slice has a `done` integrate record | one per slice that is built, clean, judged by every blocking lens, and whose dependencies are integrated |

Each batch is capped by that stage's `parallel`. A non-`done` record on a single stage blocks the run with the
reason; a slice out of fix rounds blocks it with the slice named; integration that waits on earlier stages reports
`waiting`.

The engine is read-only and holds no cursor. The run's recorded facts are the state, so `stages` is idempotent: a
lost answer costs nothing and a crashed coordinator resumes by asking again. The price is that a call which is
out but not yet recorded still looks like work to do — hence the one rule in the coordinator's playbook: record
every call of a batch before asking for the next one.

## 8. Isolation

| Boundary | What it stops |
|---|---|
| `factory-design` writes only `docs/factory/<runId>/` | a spec, plan or slicing step touching code |
| `factory-build` writes only `.factory/trees` | an implementation escaping its worktree into the project |
| `factory-review` writes nothing | a reviewer fixing what it found |
| one worktree and branch per slice | two parallel builders writing the same working tree |
| `disjointPaths` on a wave | two parallel builders writing the same file |
| commands come only from `languages/*.yaml` | a worker choosing the checks it is held to |
| `integrate` aborts a conflict and rolls back a failed check | a half-merged integration branch |
| nothing pushes, nothing merges into the owner's branches, nothing removes a worktree | the factory touching work it was not given |

The gaps are stated in the README's *Honest limits*: the build env's write path is the worktree root rather than
one slice's tree; the `standards` step sees the project tree rather than the worktree (the worktree's own lint,
typecheck and tests run through `checks`, and `integrate` runs them again on the integration branch); and a test
the builder runs is code running outside the guard, as everywhere in agentbay.

## 9. Extension points

| To add | Do this | No change to |
|---|---|---|
| a language | `languages/<name>.yaml` (files, commands, practices, slicing hints), set `modes.factory.language`; add the builder's own command prefixes to `envs/factory-build.yaml` | mode.yaml, connectors, playbooks |
| a review lens | an entry in `modes.factory.reviewers` with its checks | the component |
| a different workflow | reorder or drop `modes.factory.pipeline` entries, change `parallel`, `lenses`, `maxRounds` | the component |
| a tighter cut | `modes.factory.constraints` | the component |
| a new stage | one feature in `mode.yaml` (+ playbook and rules if it runs a role), one branch in `pipeline.plan`, one stage name in `STAGES` and in the config schema's enum | the other stages |

## 10. Tests

`components/modes/factory/tests/test_factory.py` drives the stages end to end through the real dispatcher with the
worktree connector played by the test: the gate, the fan-out, a blocking verdict, a fix round and the re-review, a
refused slicing, a failing check, and the env and shim boundaries.
`connectors/factory-store/tests/` covers the constraints, the stage engine and the findings;
`connectors/factory-tree/tests/` covers worktrees, checks, a conflict and a rolled-back merge against a real
git repository.
