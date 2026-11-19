# Forge, whole: design B

Design B answers `0-frame.md` in this folder. Its stance: forge written today, for the decisions as they now stand, for an owner who builds products outside this kit and in languages other than TypeScript. It keeps proof's interface and the kernel's security properties. It is not bound by today's forge workflow, steps or card texts. Words are used as `CONTEXT.md` defines them; new words are marked **new** where they first appear.

Every claim about the code cites a file and line read on branch `design/forge-whole-b` at `875d936`. Where a claim rests on reading alone, with no test that holds it, it says so.

## Forge in five minutes

A job has three kinds of run. The owner reads three cards to agree what is built, one merge card per wave, and a slice card only when a slice failed.

1. **What to build.** The owner, or the PM mode, writes one requirements file: outcomes a person could see working, each with conditions written as "given, when, then". Forge reads that file and nothing else of the PM mode.
2. **The job run** (one per job). Forge checks the file and shows the **start card**. One or two designers write designs apart; a third model compares them. The owner picks on the **design card**. The chosen design is merged: its interfaces as schema files, its data model, its decisions, what it leaves out. A planner cuts slices along the design's modules; a second model challenges the plan. The owner approves on the **plan card**.
3. **The slice run** (one per slice). Two rooms. In the **tests room** (new: the folder `.forge/tests/`, where only the tests mode's agents can reach) a test writer writes the slice's tests. In the **build room** (new: `.forge/worktrees/`) a builder writes the code and never sees the tests. When the tests fail, the builder hears only the failing cases' names and messages that share no text with the tests. A planter writes bugs to plant. Proof judges by script. A reviewer reads everything and sends findings back for up to three rounds. A **slice card** appears only when a must item did not pass.
4. **The wave run** (one per wave). The whole suite runs once on the wave's joined commit. The owner reads the **merge card** and chooses.

Two kernel additions make this read top to bottom: a workflow step may run only when an earlier output is true (`when`), and a block may repeat a counted number of times (`repeat`). A third makes the card say whether the hook confined every skill step.

## 1. The requirements document

**Conclusion.** One YAML file per job, `docs/forge/<job>/requirements.yaml`, checked by a script against `components/base/forge/schemas/requirements.json`. A condition is "given, when, then" with literal values, and says only how a person would see it: by running something, or by judging. It never names a kind of proof; the plan does.

### Its form

```yaml
job: todo
title: A todo list kept by agentbay
for: The owner, who keeps short tasks beside his work.
outcomes:
  - id: O1
    says: A person adds a todo and sees it among the open ones.
    conditions:
      - id: O1-1
        given: no todos
        when: the person adds "Buy milk"
        then: the open list shows one todo, "Buy milk", open
        seen: run
      - id: O1-2
        given: no todos
        when: the person adds a todo with an empty text
        then: it is refused, with a sentence that says the text is empty
        seen: run
  - id: O2
    says: A person finishes or removes a todo.
    conditions:
      - { id: O2-1, given: one open todo, when: it is marked done,
          then: it is not in the open list and is in the full list, seen: run }
      - { id: O2-2, given: one todo, when: it is removed, then: it is in no list, seen: run }
      - { id: O2-3, given: no todo with id 7, when: the person marks 7 done or removes 7,
          then: it is refused, with a sentence that names the id, seen: run }
constraints:
  - Runs inside the kit, as a mode under components/modes/.
  - No network.
leftOut:
  - Due dates.
  - Sharing a list with another person.
```

The schema's rules, all checkable by script:

- `job` is a slice-like name (`^[a-z][a-z0-9-]*$`), and the folder name must equal it.
- Every outcome has an id `O<n>`, a sentence, and at least one condition. Every condition id is `<outcome>-<n>` and unique in the file.
- `given`, `when` and `then` are each one sentence of at most 300 characters. Quoted values in them are literal: `"Buy milk"` is the text a test and a real-thing run will use.
- `seen` is `run` (a person could run something and watch it happen) or `judged` (a person must read and decide, such as "the sentences are plain").
- `constraints` and `leftOut` are lists of sentences, possibly empty.

### Kind of proof: in the plan, not in the requirements

The requirements say how a person would see a condition, not how proof would. The plan picks the kind, per item, and says which conditions each slice covers. Three reasons:

- The PM mode writes for a team that may build another way (ADR 25 item 3). Proof's eight kinds are forge's vocabulary (`components/base/proof/scripts/kinds.ts:17-30`).
- The kind depends on the design. `real-thing` needs the command a person types; that command is a design decision, not a requirement (`components/base/interfaces/proof/prove-request.json`, the real-thing runs, field `bay`).
- A condition that is `seen: run` can be covered by `fails-first`, `real-thing`, or both; a script can check coverage without knowing which.

What a script holds: `forge.waves` refuses a plan in which a `seen: run` condition is covered by no slice, or covered only by judgement items (slice FP1).

### What the PM mode hands over

The file's path, and nothing else. Forge reads no other output of the PM mode: no chat, no notes, no priority list. A person can write the file by hand; `forge.open-job` checks it the same way. If the PM mode's notes matter, they belong in an outcome's sentence or in `constraints`.

## 2. System design as forge's first phase

**Conclusion.** Designers write their designs as skill output, not as files, so two designers cannot read each other: the kernel keeps outputs in its own database, which no step can open. A script lays the chosen design out as files and merges them before planning. Small work gets one design, never fewer interfaces.

### The steps, in the job run

| Step | Kind | Who | Output |
|---|---|---|---|
| `open` | script `forge.open-job` | - | the requirements, checked; the start card; `small`: true when there are at most 3 conditions and 1 outcome |
| `start` | approval | owner | `two-designs`, `one-design` (withheld unless small), `stop` |
| `route` | script | - | `{ two: bool }` from the choice; on `stop` it ends the run with a sentence saying nothing was designed |
| `room` | `worktrees.cut` | - | a worktree of the base, `<job>-design`, which designers read |
| `design-a` | skill `forge.design`, tier deep | designer A | a design, as JSON |
| `design-b` | skill `forge.design`, tier deep, `when: two` | designer B | a design, as JSON |
| `compare` | skill `forge.compare`, tier deep, `when: two` | comparer | where they agree, where they differ, a recommendation, and a mixed design if it recommends one |
| `check` | script `forge.check-designs` | - | facts for the card; the rules for `a`, `b`, `mix` |
| `design-card` | approval, `quotes: [design-a, design-b, compare]` | owner | `a`, `b`, `mix`, `stop` |
| `lay` | script `forge.lay-design` | - | on `stop`, ends the run; otherwise the files, committed and merged into the setting `into` |
| `plan` | skill `forge.plan`, tier balanced | planner | a plan, as JSON; its check runs forge's waves logic on it, three rounds |
| `challenge` | skill `forge.challenge`, tier deep | challenger | `asks`, `changes`, `notes` |
| `replan` | skill `forge.plan`, `when: asks` | planner | the plan again, with the changes |
| `write-plan` | script | - | `docs/forge/<job>/plan.yaml` committed; the plan card |
| `plan-card` | approval, `quotes: [challenge]` | owner | `build` (withheld on any problem), `stop` |
| `keep-plan` | script | - | on `stop`, ends the run; otherwise the plan merged, and the command for wave 1 |

Two designs differ by **stance**, as the hand-written designs of proof and trust did (`docs/designs/proof/comparison.md`): A is told "the smallest that meets every condition", B "the one a new user understands fastest". Stances are forge settings, so a project may change them.

### Why the designs are apart, and what that rests on

Both designers are agents of one skill of forge, so they share read and write roots: roots are set per mode and skill (`bay/policy.ts:393`, `adapters/claude-code/README.md:12`). If they wrote files, B could read A's. So the design skill's action declares `effects: [read]`: its agent gets no `Write` or `Edit` (`adapters/claude-code/agent-file.ts:23`). A design is the skill's submitted output, stored by the kernel in `.agentbay/`, which is closed to every step whatever its roots (`adapters/claude-code/README.md:26`). The workflow runs `design-a` to its end before `design-b` starts (`bay/runs/workflow-steps.ts:348-365`), and `design-b`'s input does not carry A's output. So B never sees A, and that rests on the hook. Where the hook is not active nothing confines either designer, and the kernel line on the card says so (section 7).

### The outputs, as files

The design's JSON (schema `components/base/forge/schemas/design.json`) and the files `lay` writes from it, in the design worktree, then commits:

| Part | In the JSON | As files |
|---|---|---|
| Modules and what each hides | `modules: [{ name, paths, hides, offers, like }]`; `like` names an existing folder to copy the shape of | `docs/forge/<job>/design/modules.yaml` |
| Interfaces | `interfaces: [{ path, schema }]`: a JSON Schema per action request and response, at the path it will live at | each schema at its own path, such as `components/modes/todo/schemas/add-request.json` |
| Data model | `data: [{ name, fields, owner, where }]`: who owns what is stored, and where | `docs/forge/<job>/design/data.yaml` |
| Decisions | `decisions: [{ title, chose, over, because }]` | `docs/forge/<job>/design/decisions/<n>-<title>.md`, one short record each |
| What is left out | `leftOut: [sentence]` | `docs/forge/<job>/design/left-out.md` |
| The design in prose | `summary`: at most 12 sentences | `docs/forge/<job>/design/README.md` |

`like` answers a finding of the first runs: two of three declarers guessed because none read an existing mode. The design names the folder to follow, and the declare and build skills are given it.

`data` answers another: two builds of one slice made different storage choices, and proof passed the weaker. The design fixes where data lives and who owns it before anyone builds, and the reviewer checks the code against `data.yaml`.

`check-designs` refuses, with a sentence each, a design whose schema is not JSON Schema (checked against the draft 2020-12 meta-schema, kept as a schema file of forge, with the toolbox's `schemas.check`, `bay/sdk.ts:108-110`; not tried: whether that check loads the meta-schema's vocabularies), a module with no paths, two modules whose paths overlap (forge's own `scripts/lib/scopes.ts`), a data entry with no owner, and an interface path outside every module. A refused design is sent back to its designer as a check failure, up to three rounds (`bay/runs/action-steps.ts:52`, `:381-439`).

### How the two are compared

`compare` gets both designs and the requirements. Its output: `agree` (sentences), `differ: [{ topic, a, b, recommend }]`, `recommend: a | b | mix`, and `mixed`, a full design, when it recommends a mix. `check-designs` checks `mixed` the same way. The rule for the choice `mix` is computed: offered only when `mixed` exists and passed the check. The comparer's recommendation is printed, judged, and offers or withholds nothing (frame, "must not do").

### The design card

Shown as printed in section 7. Answer first: did both designs pass their check. Then, judged, only where they differ, with the recommendation. Then the chosen design's size: schema files, data records, decision records. The owner reads at most 30 lines; the full designs are files he can open.

### How small work skips most of it

The start card offers `one-design` only when the requirements are small (at most three conditions, one outcome; a forge setting). Then `design-b` and `compare` are skipped by `when`, and the design card offers `a` and `stop`. What is never skipped: the interface. `check-designs` refuses a design with no interface unless it names existing schema files the work meets at, each present at the base. A one-line bug fix still names the schema of the action it fixes.

Smaller still: a person may write a plan by hand and run slices without a job run, as ADR 25 item 3 allows. Each slice must then name the interface files it meets at (section 3, `meets`), and `open-slice` refuses one whose files do not exist at the base.

## 3. Planning

**Conclusion.** A planner cuts one slice per module per outcome, with the module's paths as the write scope and the design's schema files as `meets`. The interfaces are already merged by the design card, so they are stage one of every plan by construction. A second model challenges the plan once. `forge.waves` learns four new checks; proof's slice is unchanged.

### How slices are cut

The planner (skill `forge.plan`, tier balanced) gets the requirements and the merged design. Its rules, held by `forge.waves` where a script can hold them:

- A slice's code scope lies inside one module's paths. A slice that needs two modules is two slices with an order and a reason. (Script: problem "TD1's scope leaves module todo".)
- A slice's tests scope (new field `tests`) lies inside the same module and shares no path with any code scope. (Script.)
- A slice names the schema files it meets at (`meets`); each is a file the design merged. (Script.)
- A slice names the conditions it covers (`covers`); every `seen: run` condition is covered by some slice with a `fails-first` or `real-thing` item. (Script.)
- A slice delivers something that can be seen working on its own (ADR 17 item 8). (Judgement: the challenger's.)

### Vertical stages, interfaces first

Stage one is the design's merge: every schema file is at the base before any slice is cut. A slice then has a code scope and a tests scope inside its module, and both the test writer and the builder read `meets`. Slices of different modules meet only at merged schema files, so they have no order between them and fall in one wave. This is what ADR 25 item 7 asks, held by the design merge and by `meets`, not by a planner remembering it.

When a later slice changes an interface (a new action), the plan must hold an interface slice first, kind `interface`, whose scope is the schema files and the interface's shared test; the slices that use it come after it with the reason. `forge.waves` refuses a slice whose code scope holds a `meets` path (it would change the interface it is built against).

### Who challenges the plan

The skill `forge.challenge`, tier deep: a different model from the planner (balanced), as P-27 asks (`framework/practices.md`, P-27). It reads the requirements, the design and the plan, and answers `changes: [{ slice, says }]` and `notes`. When it asks for changes, the planner runs once more with them (`when: $steps.challenge.output.asks`), and the plan is checked again by script. What the challenger said is printed on the plan card as judged lines; it offers and withholds nothing. Only `forge.waves` problems withhold `build`.

### What changes in the plan form and in `forge.waves`

The plan stays `components/base/forge/schemas/plan.json`, and a planned slice keeps `slice` as proof@1's slice by reference (`plan.json`, `plannedSlice`). The wrapper gains four fields:

```yaml
- title: The todo mode adds a todo and lists the open ones
  module: todo
  covers: [O1-1, O1-2]
  meets: [components/modes/todo/schemas/add-request.json, components/modes/todo/schemas/list-response.json]
  tests: [components/modes/todo/tests/**]
  slice: { name: TD1, kind: mode, scope: [components/modes/todo/mode.yaml, components/modes/todo/scripts/**, components/modes/todo/README.md], after: [], done: [...] }
```

All four are optional, so every plan that is accepted today is accepted tomorrow; a slice without `tests` and `meets` is built the old way, with no test writer, and its card says so. `forge.waves` gains four problems: a `seen: run` condition no slice covers; a tests path inside a code scope; a slice outside its module; a `meets` path inside a code scope. A slice's tests scope counts as part of its scope for waves (`scripts/lib/plan-waves.ts`), so two slices that write one test file are never in one wave.

The plan card is shown as printed in section 7.

## 4. One slice under ADR 24

**Conclusion.** A slice run has two rooms that the kernel's roots keep apart: the test writer and reviewer live in a new base mode, `forge-tests`, whose folder `.forge/tests/` no agent of forge can reach. Rounds are one `repeat` block of at most four passes, counted by the kernel; each pass fixes, joins, plants, proves and reviews. The builder hears failing case names, and messages only when they share no text with the tests.

### Two modes, because roots are per mode

An agent's read roots are its mode's folder, its read paths and **all** its mode's write paths (`bay/policy.ts:393`); write roots are the mode's write paths when the skill's action declares `write` (`adapters/claude-code/README.md:12`). Today forge's one write path `.forge/worktrees/` is readable by every forge agent (`components/base/forge/mode.yaml:13`). So a test writer inside forge would write where the builder reads. The tests must be in another mode.

| | `forge` (build room) | `forge-tests` (tests room), new |
|---|---|---|
| Implements | - | `slice-tests@1`, new interface |
| Write path | `.forge/worktrees/` | `.forge/tests/` |
| Read paths | `docs/forge/`, `docs/plans/`, `framework/features.yaml`, `framework/practices.yaml` | `.forge/worktrees/`, `docs/forge/`, `framework/practices.yaml` |
| Skills | design, compare, plan, challenge, declare, build, plant | write (the test writer), review |
| Scripts | open-job, check-designs, lay-design, open-slice, rooms, join, draw, carry-out, draw-wave, waves | fails-on-base (a check), run, no-quotes (a check) |
| Commands | none | none |

`slice-tests@1` has three actions: `write` (effects all five, since its check commits and copies), `run` (a script: copy a builder's commit, lay the slice's tests over it, run them, answer failures; effects all five), `review` (effects read). Forge requires it; the kit binds `slice-tests: forge-tests`. ADR 25 item 4 says activating forge brings proof and worktrees; it brings forge-tests too (slice KA1).

Why an interface and not one mode calling another: a workflow may name only its own mode's actions or those of an interface it requires (`schemas/workflow.schema.json:101`).

### The rooms

`worktrees.cut` gains an optional `room: tests` (slice WK1). Today every worktree is `.forge/worktrees/<slice>` (`components/base/git-worktrees/scripts/lib/folders.ts:6-8`). With `room: tests` it is `.forge/tests/<slice>` on branch `forge/tests/<slice>`. Two more worktrees actions come in WK1: `commit` (a worktree's changes to its own branch; designed as WC1 in `docs/designs/forge/one-slice.md`, section 3) and `combine` (a new branch whose commit holds two commits' trees, refused when both changed one path; no worktree, so nobody can write in it).

### The workflow, in the form KR1 gives

```yaml
name: slice
trigger: { manual: true }
budget: { minutes: 120 }
steps:
  - id: open
    action: open-slice          # script: the planned slice, its views, the base
  - id: rooms
    action: rooms               # script: cuts both rooms; checks every meets file is there
    input:
      slice: $steps.open.output.name
      base: $steps.open.output.base
      meets: $steps.open.output.meets
  - id: tests
    action: slice-tests.write   # the test writer, tier balanced
    input:
      slice: $steps.open.output.forTests
      folder: $steps.rooms.output.tests
      findings: []
  - id: declare
    action: declare             # tier balanced, no write tools
    input:
      slice: $steps.open.output.forBuilder
      folder: $steps.rooms.output.build
      feedback: []
  - id: build
    action: build               # the builder, tier balanced
    input:
      slice: $steps.open.output.forBuilder
      folder: $steps.rooms.output.build
      declared: $steps.declare.output
      failures: []
      findings: []
  - id: rounds
    repeat: { most: 4, until: $steps.review.output.settled }
    steps:
      - id: fix-tests
        action: slice-tests.write
        when: $steps.review.output.forTests
        input:
          slice: $steps.open.output.forTests
          folder: $steps.rooms.output.tests
          findings: $steps.review.output.toTests
      - id: redeclare
        action: declare
        when: $steps.review.output.forCode
        input:
          slice: $steps.open.output.forBuilder
          folder: $steps.rooms.output.build
          feedback: $steps.review.output.toCode
      - id: fix-code
        action: build
        when: $steps.review.output.forCode
        input:
          slice: $steps.open.output.forBuilder
          folder: $steps.rooms.output.build
          declared: $steps.redeclare.output
          failures: $steps.join.output.failures
          findings: $steps.review.output.toCode
      - id: join
        action: join            # script: commits, joins, runs the tests, checks each room
        input:
          open: $steps.open.output
          rooms: $steps.rooms.output
          declared: $steps.declare.output
          redeclared: $steps.redeclare.output
          before: $steps.join.output
      - id: plant
        action: plant           # the planter, tier balanced
        input:
          slice: $steps.open.output.forBuilder
          folder: $steps.rooms.output.build
          tests: $steps.join.output.testFiles
      - id: prove
        action: proof.prove
        input:
          slice: $steps.join.output.slice
          base: $steps.rooms.output.base
          head: $steps.join.output.head
          declared: $steps.join.output.declared
          bugs: $steps.plant.output.bugs
      - id: review
        action: slice-tests.review   # the reviewer, tier deep
        input:
          open: $steps.open.output
          proof: $steps.prove.output
          join: $steps.join.output
          practices: $steps.open.output.practices
  - id: draw
    action: draw
    input:
      open: $steps.open.output
      proof: $steps.prove.output
      review: $steps.review.output
      join: $steps.join.output
  - id: card
    approval: Add this slice to its wave?
    when: $steps.draw.output.ask
    show: $steps.draw.output.card
    quotes: [review]
    choices:
      add: { does: Put the slice on the wave branch, when: $steps.draw.output.add }
      again: { does: "End; forge next starts the slice afresh with the findings" }
      keep: { does: "End; both rooms stay" }
      discard: { does: "End; branches renamed, nothing deleted" }
  - id: carry-out
    action: carry-out
    input:
      choice: $steps.card.output.choice
      add: $steps.draw.output.add
      join: $steps.join.output
      wave: $steps.open.output.wave
```

Every `input` maps a key to one reference or a literal, as references are resolved today: whole, with an optional dotted path after `$steps.<id>.output` (`bay/manifests/references.ts:33`, `:45-59`). The comments are for this document; the file has none (P-01).

What KR1 must give this file, and nothing more: `when` on an action or approval step; `repeat` with `most` (at most 5) and `until`; a step skipped by `when` outputs null; a reference to a step that has not run yet resolves to null; inside and after a `repeat`, `$steps.<id>` names that step's output in the latest pass that reached it, so `quotes: [review]` cites the last review. Section 4's "without KR1" says what can be had today.

### Every step, its inputs and outputs

| Step | Kind | Input | Output |
|---|---|---|---|
| `open` | script, forge | `{ plan, slice }` | `name`, `base` (the integration branch's commit), `meets`, `wave`, `practices`; `forTests`: name, every done item whole, the conditions it covers with given, when, then, `meets`, its tests scope; `forBuilder`: name, code scope, each done item's id, level and sentence with no test path, `meets`, the design's `like` and `data` paths |
| `rooms` | script, forge | name, base, meets | `{ build: .forge/worktrees/TD1, tests: .forge/tests/TD1, base }`; refused when a `meets` file is missing in the build room |
| `tests` | skill, forge-tests `write` | forTests, folder, findings | `{ files, cases }`. Check `fails-on-base`: commits the room, copies the base, lays the test files over it, runs them; feedback when a case passes on the base or a file is outside the tests scope. Three rounds, kernel-counted (`bay/runs/action-steps.ts:52`) |
| `declare`, `redeclare` | skill, forge | forBuilder, folder, feedback | proof@1's declaration; check `declared-in-scope` (exists today, `components/base/forge/mode.yaml:30-38`) |
| `build`, `fix-code` | skill, forge | forBuilder, folder, declared, failures, findings | `{ outcome: built }` or `{ outcome: stopped, missing }` (`components/base/forge/schemas/built.json`) |
| `join` | script, forge | open, rooms, both declarations, its own last output | commits both rooms; joins them on `forge/judged/TD1`; calls `slice-tests.run` on that commit; checks the build room changed no tests path and the tests room only tests paths. Answers `head`, `slice` (scope = code and tests), `declared` (the builder's latest, with the test writer's files added), `testFiles`, `failures`, `roomsKept`, `codeChanged` |
| `plant` | skill, forge | forBuilder, folder, test file paths | proof@1's `bugs`, each with the slice's test files as its covering tests. Check: each patch applies to a copy of the head (`worktrees.copy`, `worktrees.apply`) |
| `prove` | proof@1 | as today | `{ verdicts, judgement, size }` (`components/base/interfaces/proof/prove-response.json`) |
| `review` | skill, forge-tests `review` | open, proof, join, practices | findings, items, practices, `settled`, `forTests`, `forCode`, `toTests`, `toCode`. Check `no-quotes`, below |
| `draw` | script, forge | open, proof, review, join | `{ card, ask, add }` |
| `card` | approval, only when `ask` | the card | `{ choice, content }` (`bay/runs/workflow-steps.ts:173-182`) |
| `carry-out` | script, forge | choice or null, add, join, wave | add: `worktrees.combine` of the wave branch and the judged commit; keep: nothing; discard: branches renamed |

`ask` is true when `add` is false. `add` is computed from proof alone: every `must` item passed, `scope` and `declared` passed, and `roomsKept`. No judged line offers or withholds it.

### Where the tests live, and what keeps the builder from them

The tests are written in `.forge/tests/TD1` and committed on `forge/tests/TD1`. The builder's room is `.forge/worktrees/TD1`, cut from the base, which has no test of this slice. They meet only on `forge/judged/TD1`, a branch with no worktree. What that rests on:

1. **Roots.** No forge agent has a root under `.forge/tests/`: forge's manifest names none, and roots are the mode's own (`bay/policy.ts:393`). The hook allows a read only inside a read root (`adapters/claude-code/guard-decide.ts:171-194`).
2. **No shell, no git.** Forge lists no command, so its agents get no `Bash` (`adapters/claude-code/agent-file.ts:24`). `.git` is closed to every step (`adapters/claude-code/README.md:26`), so no agent reads objects from the repository.
3. **No action that returns the tests.** A skill may call only actions whose effects are all `read` (`bay/runs/engine.ts:305-313`). `slice-tests.write` and `run` have every effect. `slice-tests.review` is read-only but runs a skill, and an action called from a skill that stops for a skill is refused (`tests/tools.test.ts:330`). The read-only actions of `worktrees@1`, `status` and `changed`, answer where a worktree stands and which paths differ, never a file's text (their response schemas).
4. **What reaches the builder is filtered by a script of the tests room.** `slice-tests.run` answers each failing case's name, and its message only when no run of 20 characters of the message appears in any test file of the slice. The run's script can read the tests; forge's cannot. A message such as `Expected values to be strictly equal: 'Buy milk' !== ''` shares `'Buy milk'` with the test and is dropped; `TypeError: list is not a function`, which comes from the builder's own code, is kept. The rule is one function, the same for every language.
5. **The reviewer's words to the builder are checked the same way.** The review skill's check `no-quotes` refuses a finding sent `to: code` that shares 20 characters with a test file, and sends it back to the reviewer, three rounds at most.
6. **After the fact.** `join` checks by script that the build room's commits changed no path of the tests scope, so a builder that wrote a test file of its own name is caught. Proof's `scope` holds the joined commit to code and tests scopes together.
7. **The hook must be active.** Everything above is the hook's. Where it is not active, nothing confines a step, and the card must say so (ADR 24, Consequences). Slice KH1 makes the kernel refuse a skill's output when the adapter's hook saw no call of that agent since its task was issued, and add one line to every card saying which skill steps the hook saw. An agent in a session with no hook could write the hook's own record; that is stated on the line's help, not hidden.

Test names reach the builder. They are the test writer's words, and the test writer is told to write each name as the behaviour it checks.

### What the test writer may read

ADR 24 left it open. Design B: the test writer reads its own room, a full checkout of the project at the base, so it sees the existing code and the merged interfaces; the slice's done items and the conditions they cover, with their literal values; and the design. In the first pass the build room holds nothing new, because the builder starts after the tests are committed. From the second pass on, the test writer can read the builder's room: forge-tests' read paths hold `.forge/worktrees/` so that the reviewer can read the code, and roots are per mode. A test rewritten to match the code is the reviewer's to catch, under the category `test`. Keeping the test writer from the code in later passes would need a third mode for the reviewer alone; design B does not add it.


### How the kernel runs the tests, and what reaches the builder

No step agent runs anything. Tests run in three places, each a script calling the toolchain on a throwaway copy, never on a room (ADR 20 item 2):

| Where | Who calls | What runs | What comes out |
|---|---|---|---|
| `tests`' check | forge-tests `fails-on-base` | the slice's test files on the base with them laid over | per case, passed or failed; feedback to the test writer only |
| `join` | `slice-tests.run` | the slice's test files on the joined commit; the toolchain's static checks | failures (names, filtered messages), static findings (file and line from the checker, about code the builder wrote); to the builder in the next pass |
| `prove` | proof | the kinds the slice names, as today | verdicts with detail |

Messages need one field the toolchain lacks: a failed run answers names only, `failedTests` (`components/base/interfaces/toolchain/test-response.json`, `failed`), parsed from `not ok` lines (`components/base/typescript/scripts/lib/tap.ts:10`). Slice TM1 adds `failures: [{ name, message }]`, the first line of each failure's error, at most 300 characters.

### Rounds

| Pass | Runs | Ends when |
|---|---|---|
| 1 | join, plant, prove, review (`fix-*` are skipped: no review yet) | review is `settled` |
| 2 to 4 | the fixes the last review asked for, then join, plant, prove, review | review is `settled`, or pass 4 ends |

So: one review and up to three rounds of correction, as ADR 24 item 7 asks. The kernel counts the passes; forge's skills cannot add one. `settled` is held by the review's check, not the reviewer's word: the check refuses `settled: true` while `join` has failures or any must verdict did not pass, and refuses `forCode: false` while there are failures. The reviewer cannot hide a failing test from the builder.

A fresh agent every time: each task is handed to a new subagent by the coordinator (`adapters/claude-code/coordinator.ts:41-42`), so a correcting builder is fresh, with the whole scope and the findings (ADR 15).

Worst case per slice: 4 test-writer passes, 4 declarations and builds, 4 plantings, 4 proofs, 4 reviews. The implementers are the cheap model (ADR 24 item 8).

### Without KR1: what can be had today, and what it costs

| Today's means | What it gives | What it costs |
|---|---|---|
| A skill's check rounds (`bay/runs/action-steps.ts:52`, `:381-439`) | builder against tests, three rounds, counted by the kernel | the third failure fails the run (`:430-434`): the owner reads a run's reason, not a card |
| A forge script that calls actions in a loop | reviewer rounds | the limit lives in forge's script, not the kernel, against ADR 17 item 10. It rests on a script stopping when its call waits for a skill and running again with finished calls replayed (`action-steps.ts:184-197`, `:157-171`, `:258`); no test was found that holds the resume. A judged line citing that script step is printed with every skill under it, the builder's included (`bay/runs/card.ts:187-201`) |
| A `foreach` over a list of none or one | a `when` | steps inside cannot be quoted after it: their outputs and keys are copies (`bay/runs/workflow-steps.ts:298`), and a foreach step cannot be cited (`bay/runs/card.ts:181-182`) |

KR1's cost: about 140 kernel lines (the schema, `workflow-steps.ts`, `step-key.ts`, the load check in `workflow-problems.ts`, null for a step not yet run in `references.ts`) and its tests, in one capability slice that touches two kernel features, runs and manifests. Recommended (question 1).

### The reviewer

**Input.** The slice whole (`open`), proof's answer, `join`'s answer (failures, static findings, rooms kept, size), the practices it must judge (section 5), the design's `data.yaml` and `modules.yaml`. It reads both rooms: forge-tests' read paths hold `.forge/worktrees/`.

**Categories**, every one the kit holds (ADR 24 item 6):

| Category | What the reviewer looks for |
|---|---|
| `proof` | a verdict that passed but should not have: a test that asserts nothing, a bug planted where no test looks |
| `test` | a test that checks something other than its item, passes on empty code (P-16), or mirrors the code |
| `scope`, `declared` | a change the declaration hid in a file it did name |
| `design` | code against the design: data stored elsewhere, an action not in `meets` |
| `boundary` | an import across the feature map (`framework/features.yaml`) or across the design's modules |
| `duplicate` | the same code or rule twice (P-12) |
| `size` | growth with no reason (P-13) |
| `practice` | a practice held by review that does not hold, by id |
| `cheating` | code that treats the tests' inputs as special |

**Output** (schema `components/base/interfaces/slice-tests/review-response.json`):

```yaml
findings:
  - { id: R1, to: code, category: practice, practice: P-05, path: components/modes/todo/scripts/add.ts,
      says: A todo's state is two booleans; a closed set is a union. }
items:      # the judgement items, each judged
  - { id: DOD-TD1-3, holds: yes, why: The README says what the mode does in 4 lines. }
practices:  # every practice held by review, once each
  - { id: P-05, holds: no, finding: R1 }
settled: false
forTests: false
forCode: true
toTests: []
toCode: [R1]   # with the finding's words, checked by no-quotes
```

`to` is `tests`, `code` or `owner`. A finding to the owner goes straight to the card. The check refuses an `items` list that misses a judgement item, a `practices` list that misses or repeats a practice, and the flags that disagree with the findings and failures.

### Who writes the bugs to plant

The planter: a skill of forge, tier balanced, in the build room. It reads the code and the done items, not the tests, and writes one patch per must item that breaks it. It is not the test writer, who gains when its tests catch them; not the reviewer, who has read the tests and would aim at what they cover; not the builder, whom proof@1 forbids (`components/base/interfaces/proof/prove-request.json:29`). Its patches name the slice's test files as their covering tests, so a bug costs a run of a few files, not the suite. Question 4 asks the owner to confirm.

## 5. Practices

**Conclusion.** Practices become YAML: one entry per practice, saying whether a tool, proof or the reviewer holds it and, for a tool or proof, what holds it. A script draws the reviewer's list from the files, the reviewer must judge every entry on it, and the card counts both. A project adds its own file by naming it in forge's settings.

### The form

`framework/practices.yaml` replaces `framework/practices.md` (slice PX1). Schema `components/base/forge/schemas/practices.json`:

```yaml
practices:
  - id: P-01
    says: No comments in code. A name says what; a decision record says why.
    held: tool
    by: the lint rule agentbay/no-comments
    applies: [code, tests]
  - id: P-05
    says: Model the domain in types; a closed set is a union with one shape per case.
    held: review
    applies: [code]
  - id: P-16
    says: A test asserts literal expected values; a test that passes on empty code is rewritten.
    held: proof
    by: bugs-caught
    applies: [tests]
```

- `held` is `tool`, `proof` or `review`. A practice held partly by each is split into two entries; today's "check: compiler and lint for most; review for the rest" (P-02, `framework/practices.md`) becomes two ids.
- `by` is required for `tool` and `proof`: the lint rule, the test, the kernel rule or the kind of proof. A script checks that a `proof` entry names one of the eight kinds (`components/base/proof/scripts/kinds.ts:17-30`).
- `applies` is any of `code`, `tests`, `plan`, `design`, `prose`, so the reviewer of a slice judges only what applies to a slice.

### How each is held under ADR 24

ADR 24 moves several practices from review to proof or to forge's shape. Examples; PX1 classifies all 35 and the owner reads its table:

| Practice | Today | Under design B |
|---|---|---|
| P-17 the builder writes the test first and sees it fail | review | proof: `fails-first`, and the test writer's check `fails-on-base` |
| P-18 the reviewer injects bugs of its own | review | proof: `bugs-caught`, with the planter's bugs |
| P-19 done means proven on the real thing | review | proof: `real-thing` |
| P-23 the reviewer never builds the slice it reviews | review | tool: the two modes' roots |
| P-25 a fresh builder, never redirected | review | tool: each task is a fresh subagent |
| P-27 an agent that did not see the build evaluates, a different model | review | tool: the reviewer is a deep tier in the tests room |
| P-34 a mode slice changes only its folder | plan, build, review | proof: `in-scope` |
| P-05, P-06, P-12, P-13, P-30 | review | review |

P-22 (a builder's report with evidence per item) goes: the builder writes no report, since its words never reach a card (ADR 15).

### How it is recorded, so the reviewer's list comes from the file

`open-slice` reads every practices file named in forge's setting `practices`, as the files are at the base, in the build room. It refuses two entries with one id. It hands the reviewer the entries with `held: review` whose `applies` meets the slice. The review's check refuses an answer that judges an entry twice or misses one (section 4, the reviewer's output). `draw` counts, computed: in force, by a tool, by proof, by the reviewer; and, judged, how many held and which did not, by id.

### A project's own practices

A file in the same form, such as `docs/forge/practices.yaml`, named in forge's setting `practices` beside the kit's and the toolchain's. Ids must not repeat across files; a project uses its own letter, such as `X-01`. The setting exists today (`agentbay.config.yaml`, `forge.practices`) and the builder already gets those paths.

## 6. Tiers

**Conclusion.** The project's config maps each tier to a model and an effort. A skill still names a tier. The kernel records the model and effort a step ran with, and a judged line on a card names them.

```yaml
tiers:
  fast:     { model: haiku,  effort: low }
  balanced: { model: sonnet, effort: medium }
  deep:     { model: opus,   effort: medium }
```

Today a skill names `fast`, `balanced` or `deep` (`schemas/mode.schema.json:246-250`), the claude-code adapter fixes the model per tier in code (`adapters/claude-code/agent-file.ts:5-9`, `:64`), there is no effort, and the config has no tiers (`schemas/config.schema.json:1-78`). Slice KT1 adds `tiers` to the config schema, has the adapter write the model and effort into each agent file, and has the kernel record both in the skill step's detail when the task is issued, so a card still names what ran after the config changes. Not verified: whether Claude Code's agent file accepts an effort. If it does not, the adapter writes the model only and records the effort as not set, and the card says "effort not set by this harness".

ADR 24's models fall out: the test writer, the builder, the declarer and the planter are `balanced`; the reviewer is `deep`. Designers, the comparer and the challenger are `deep`; the planner is `balanced`, so the challenger is another model (P-27).

What the card says of a judged line: today the kernel adds "by forge review, tier deep" (`bay/approval-card.ts:30-39`). After KT1 and KC1: the step's mode and skill, then the model and effort, under the run of judged lines they belong to:

```
-- judged: forge-tests review --
DOD-TD1-3 holds: the README says what
the mode does in 4 lines.
  (forge-tests review: opus, medium
  effort)
```

## 7. The cards

**Conclusion.** Four cards for a job, and a fifth only when a slice fails. Each starts with the answer, prints a mark once above the lines it covers with the step they came from, gives a failure with its reason, and shows each choice not offered with why. All are printed below for the todo job, at most 44 columns.

### What changes in printing, and what does not

Today a card prints the mark in a column of 9 before every row (`bay/approval-card.ts:17`, `:25-28`), so the words get 35 columns, and today's start card is 50 rows of "computed" (`components/base/forge/tests/one-slice.test.ts:587-638`). The owner asked what a card was. Slice KC1 changes only the printer: a heading `-- <mark>: <mode> <step> --` above each run of lines with one mark and one source step, and the words use the full width. Each line is still checked by its own mark and source (`bay/runs/card.ts:248-265`); nothing in what the kernel accepts changes. The last heading before the choices is the kernel's own line from KH1, on what the hook saw.

The cards below are printed as KC1 would print them. Every row was checked to be at most 44 columns. Hashes are examples.

### Start card (job run, step `start`)

```
Design the job todo?
-- computed: forge open-job --
Ready to design: the requirements file
passed its check.
docs/forge/todo/requirements.yaml
2 outcomes, 5 conditions, 0 judged
O1 A person adds a todo and sees it
  among the open ones.
  O1-1 add "Buy milk": the open list
    shows "Buy milk", open
  O1-2 add "": refused, with a sentence
    that says the text is empty
O2 A person finishes or removes a todo.
  O2-1 done: not open; in the full list
  O2-2 remove: in no list
  O2-3 an unknown id: refused, with a
    sentence that names the id
Left out on purpose: due dates, sharing.
Next: the design card. Then the plan
card. Then a merge card per wave.
Choose one:
  two-designs  Two designs, written apart,
               then compared
  one-design   One design, for small work
               not offered: 5 conditions,
               and small work has at most
               3
  stop         Nothing is designed
checked: 0 ran, 19 computed, 0 judged
hash 3f9a1c2e7b10
```

### Design card (job run, step `design-card`)

```
Which design of todo?
-- computed: forge check-designs --
Both designs passed their check: every
schema file is JSON Schema, every module
has its own paths.
A: 1 module, 4 actions, 1 table
B: 1 module, 4 actions, 1 table
They differ in 2 places, below.
-- judged: forge compare --
1. Where todos are kept. A: the mode's
  own database, one table. B: one file
  per todo. A is what feed-briefing
  does; B needs a write path.
2. What list returns. A: open todos by
  default, all with all: true. B: two
  actions, list-open and list-all.
Recommended: A on both.
  (forge compare: opus, medium effort)
-- judged: forge design-a --
A says: one table, todos(id, text,
done, added), owned by todo alone.
  (forge design: opus, medium effort)
-- computed: forge check-designs --
The one you choose is merged before any
slice: A as 8 schema files, 1 data
record, 3 decision records.
-- computed: kernel --
The hook saw every skill step of this
run.
Choose one:
  a     Design A, as written
  b     Design B, as written
  mix   The mix compare recommends
        not offered: compare
        recommends A whole
  stop  Nothing is merged
checked: 0 ran, 4 computed, 3 judged
hash 8b20d4e19c3a
```

### Plan card (job run, step `plan-card`)

```
Build todo in these slices?
-- computed: forge write-plan --
Ready: the plan has no problem.
2 slices in 2 waves; longest chain 2.
wave 1: TD1  add and list
wave 2: TD2  done and remove
Every condition is covered:
  O1-1, O1-2 by TD1
  O2-1, O2-2, O2-3 by TD2
Each slice meets the interface first:
  components/modes/todo/schemas/
TD2 waits for TD1: it adds two
actions to the mode TD1 makes.
-- judged: forge challenge --
No change asked. One note: TD1's
refusal sentence should name the field.
  (forge challenge: opus, medium effort)
-- computed: kernel --
The hook saw every skill step of this
run.
Choose one:
  build  Build wave 1 now
  stop   The plan stays a file
checked: 0 ran, 11 computed, 2 judged
hash 51c7e0a9d2f4
```

### Merge card, passing (wave run, step `card`)

```
Merge wave 1 of todo into main?
-- computed: forge draw-wave --
Yes, merge is offered: every must item
passed, and every check and the whole
suite passed on the wave's commit.
TD1  add and list  4 of 4 must passed
Rounds: 1 review, nothing sent back.
Size: components/modes/todo +212 lines
  in 12 new files.
-- judged: forge-tests review --
DOD-TD1-3 holds: the README says what
the mode does in 4 lines.
Practices for review: 18 hold, 0 not.
  (forge-tests review: opus, medium
  effort)
-- computed: kernel --
The hook saw every skill step of this
job's runs: the builder was confined.
Choose one:
  merge  Merge into main
  keep   Stop; the wave branch stays
checked: 0 ran, 5 computed, 3 judged
hash 0d93be71aa45
```

### Merge card, failing (wave run, step `card`)

The whole suite failed on the wave's commit though each slice passed alone, which is what a wave saves time on and what it costs (section 8):

```
Merge wave 1 of todo into main?
-- computed: forge draw-wave --
No: merge is not offered. The whole
suite failed 2 tests on the wave's
commit; each slice passed alone.
Failed:
  store: lists every mode's tables
  kit check: no mode adds a table
    outside its own partition
Each named test is outside every
slice's scope.
Choose one:
  merge  Merge into main
         not offered: 2 tests failed
  find   Prove each slice alone with
         the whole suite, to find which
  keep   Stop; the wave branch stays
checked: 0 ran, 6 computed, 0 judged
hash 92ab0f4c11e8
```

### Slice card, only when a must item did not pass (slice run, step `card`)

```
Add TD1 to wave 1 of todo?
-- computed: forge draw --
No: adding is not offered. 1 must item
failed, after 3 rounds.
DOD-TD1-2 failed: the run on the base
  passed, so the test does not show the
  change.
  components/modes/todo/tests/
  todo.test.ts
3 other must items passed.
-- judged: forge-tests review --
Open after 3 rounds, for you:
R2 to tests: the list test adds no
  todo before it lists, so it passes
  on an empty mode.
  (forge-tests review: opus, medium
  effort)
-- computed: kernel --
The hook saw every skill step of this
run: the builder was confined.
Choose one:
  add      Put TD1 on the wave branch
           not offered: DOD-TD1-2
           failed
  again    End; forge next starts TD1
           afresh with R2 given
  keep     End; both rooms stay
  discard  End; branches renamed,
           nothing deleted
checked: 0 ran, 5 computed, 4 judged
hash 6e1f2c08b7d3
```

### What each card answers

| Card | First line after the title | What withholds a choice | Judged lines |
|---|---|---|---|
| Start | ready or not, and why | `one-design`: the size rule | none |
| Design | both designs passed their check, or which failed and why | `mix`: compare did not recommend one, or it failed its check | the comparison, the chosen design's summary |
| Plan | ready, or every `forge.waves` problem | `build`: any problem | the challenge |
| Merge | yes, or the failing item with proof's detail | `merge`: a must item, the checks or the suite | the reviewer's items and practices |
| Slice | no, and the failing item with its detail | `add`: a must item, scope, declared or rooms kept | what stayed open after three rounds |

The first runs' merge card said an item failed and not why. Here the reason is proof's own `detail` (`components/base/interfaces/proof/prove-response.json`, `detail`), which holds no builder's words.

Not in design B: `ran` lines with a command's own last lines, such as `# pass 1509`. They need proof to answer which command ran and what it printed (slices RN1a and RN1b in `docs/designs/forge/one-slice.md`, section 3). Every verdict line is computed, citing the step that called proof, as today.

## 8. Time

**Conclusion.** A slice's proof runs only the slice's own test files, its bugs and its scope checks: seconds to a few minutes. The whole suite (555 seconds) and every static check run once per wave, on the wave's joined commit. The cost is that a break in another module's test is found at the wave, not the slice.

### What runs where

| When | What proof runs | Measured or estimated |
|---|---|---|
| Each pass of a slice (`join`) | the slice's test files on one copy; the toolchain's static checks | test files: seconds each, not measured for todo; static checks on the kit: not measured |
| Each pass of a slice (`prove`) | `fails-first`: two copies, the item's test files twice; `bugs-caught`: one copy and the covering files per bug; `in-scope`, `as-declared`, size: copies and reads, seconds; `real-thing`: one copy and the runs | about 1 to 3 minutes for a todo slice, estimated, not measured |
| Once per wave | `checks`: every static check and the whole suite on the wave's joined commit | 555 s for the suite (the frame); 447 to 663 s measured alone (`docs/research/2026-11-17-suite-time.md`) |

`open-slice` moves a slice's `checks` items to the wave: the slice's request to proof omits them, and the wave's request holds every slice's `checks` items. The wave's merge rule counts them as must items of the slices they came from.

The first real run took 17 minutes of proof for one slice, nearly all the suite (frame). Under design B the todo job of two slices in two waves costs two suites, as before, but a wave of three slices costs one suite where today it costs three.

### What each saving loses

| Saving | What is lost | How it shows |
|---|---|---|
| No whole suite per slice | a break in another module's test is found at the wave | the merge card lists the failing tests; the choice `find` proves each slice alone with the suite, one suite per slice, paid only on failure |
| Only the slice's tests in a pass | the builder may break another test and not hear of it in the slice | as above |
| A bug runs only its covering files | a bug another file would catch counts as survived | the bugs-caught item fails; the owner sees which bug, by name |
| Static checks are feedback in the slice, a verdict only at the wave | a slice card cannot say the slice type-checks | the merge card does |
| Up to four proofs per slice | time, when rounds are needed | the merge card says how many rounds ran |

Not measured, and needed before FS1 is merged: the static checks of the kit on one copy. A check script keeps the kernel's eight minutes whatever its action declares (`tests/runs-actions.test.ts:521`); `join` is a script step and may declare more (`schemas/mode.schema.json:221-226`, at most 1,800 seconds).

## 9. Outside the kit

**Conclusion.** Forge runs in any project whose language has a toolchain mode bound to `toolchain@1`. For a language the kit does not ship, the project writes its own toolchain mode listing its own commands, and the owner trusts it on the trust card: that card is where he sees what will run. Proof's `real-thing` and `same-output` reach a project's own commands through a new toolchain action, `run`. Forge stops being refused outside the kit.

### What forge needs

| Need | Today | Design B |
|---|---|---|
| Forge active | refused when the project is not the kit (`bay/manifests/activation.ts:32-37`, `:54`) | KA1 lifts it; listing `forge` brings `forge-tests`, `proof` and `git-worktrees` (ADR 25 item 4) |
| A toolchain | `typescript` runs the project's agreed scripts (ADR 23; `components/base/typescript/mode.yaml:11-31`) | the same for TypeScript. For another language, a mode in the project that implements `toolchain@1` and lists the project's own commands, such as `pytest -q` and `ruff check`, trusted by the owner (ADR 20, 21). It passes the interface's shared test (`components/base/interfaces/toolchain/tests/shared.ts`) |
| The real thing | `real-thing` and `same-output` run `./bay.sh` in a copy, proof's listed command `bay` (`components/base/proof/mode.yaml:20-22`) | TR1: `toolchain.run { folder, name, args }` runs a project command by agreed name in a throwaway copy (TypeScript: `npm run <name>`). PR1: a real-thing run may say `run: demo` where today it says `bay: [...]`, and `sameOutput` in proof's settings may name toolchain runs. Both are additions; every request valid today stays valid and means the same |
| `.forge/` kept out of git | the kit's lint ignores `.forge/`; node's test search skips dot folders (`docs/designs/forge/one-slice.md`, section 3) | `open-job` asks git-worktrees whether `.forge/` is ignored (its listed command `is-ignored`, `components/base/git-worktrees/mode.yaml:37-39`) and refuses with a sentence saying which line to add to `.gitignore` |
| Packages in copies | proof's setting `links: [node_modules]` (`agentbay.config.yaml`) | the same setting; a Python project links `.venv` |
| The hook | written by `bay build` into the project's `.claude/settings.json` (`adapters/claude-code/README.md:13`) | the same, and KH1 refuses a skill's output the hook did not see |

PR1 is the one change to proof@1, and it adds; nothing is removed or changed in meaning. ADR 25 item 4 decided that these two kinds run a project's own commands; this is its smallest form.

### What the builder may read, outside the kit

Its room: a full checkout of the project at the base, which holds the merged design, the interfaces and the practices files. Forge's own folder in the kit, for its skill file (`bay/policy.ts:393` gives every agent its mode's folder). `docs/forge/<job>/`. Nothing else: not `.forge/tests/`, not the kit's other folders, not the project's own checkout outside its room. A builder of a Python product never needs the kit's toolbox; a builder of an agentbay mode reads it in its room, where the kit is a dependency or a copy.

### What does not change outside the kit

The kernel's security properties hold the same way: S3, the manifest decides (`docs/designs/operations/0-frame.md:39`); T3, nothing a step does gives trust (`docs/designs/trust/0-frame.md:52`). A project toolchain mode's commands run unconfined once trusted, as ADR 22 says of every toolchain: proof runs code a builder wrote. No sentence of forge's may say otherwise.

## 10. The order to build it in

**Conclusion.** Twenty-one slices in nine waves. The smallest forge that carries one slice under ADR 24 is waves 1 to 5 up to FW1; the todo mode's first slice, TD1, built through it in wave 6, is its test. The design and plan phases follow, and the todo mode's second slice, TD2, built through the whole of forge, tests them.

### The plan

The plan is `docs/designs/forge-whole/B-plan.yaml`, in today's plan form, so today's forge can read it. `forge.waves` reads plans only under its read paths (`components/base/forge/mode.yaml:12`), and asked for this file where it lies, it refused: "the mode forge may read only: components/base/forge, docs/plans, framework/features.yaml, .forge/worktrees". So it was copied for one run to `docs/plans/zz-design-b-check.yaml`, checked, and the copy removed. What `forge.waves` printed:

```
Forge, whole: design B, from requirements to merge, built smallest first
21 slices in 9 waves. Longest chain, 9 slices: KR1, KT1, KC1, FS1, FR1, FD1, FP1, TD2, XP1.

Waves
wave 1: KR1, WK1, TM1, ST1, PX1 (5 builders)
wave 2: KT1, FT1, KA1, TR1 (4 builders)
wave 3: KC1, KH1, PR1 (3 builders)
wave 4: FS1 (1 builder)
wave 5: FW1, FR1, WR1 (3 builders)
wave 6: TD1, FD1 (2 builders)
wave 7: FP1 (1 builder)
wave 8: TD2 (1 builder)
wave 9: XP1 (1 builder)

Problems
No problems.
```

### The smallest forge, and its test

| Wave | Slices | What it brings |
|---|---|---|
| 1 | KR1, WK1, TM1, ST1, PX1 | `when` and `repeat`; commit, the tests room, combine, discard; failure messages; `slice-tests@1`; practices as YAML |
| 2 | KT1, FT1, (KA1, TR1) | tiers with model and effort; the forge-tests mode |
| 3 | KC1, KH1, (PR1) | the printer; the kernel refusing an unconfined step |
| 4 | FS1 | the slice run |
| 5 | FW1, (FR1, WR1) | the wave run and the merge card |
| 6 | TD1 | the test: the todo mode's first slice, built by a test writer, a builder who never sees the tests, a planter and a reviewer |

Slices in brackets run beside them and are not needed for TD1. Until FR1, FD1 and FP1 exist, TD1's slice is written by hand into a plan, as `docs/plans/0023-todo-mode.yaml` was, with `tests` and `meets` added and its schemas merged by hand first. TD2 is planned by forge itself, from a requirements file, through a design and a plan card.

The wave run that FW1 builds: `gather` (script: the slices on the wave branch and their requests), `prove` (proof.prove on the wave's joined commit with every slice's `checks` items), `draw-wave` (script: the card and the rule for `merge`), `card` (approval: `merge`, `find`, `keep`), `find` (`when` the choice is `find`: each slice proved alone with the suite), `carry-out` (merge into the setting `into`, a branch nobody has checked out, as today; `docs/designs/forge/one-slice.md`, owner question 1, still decides where a merge lands in the kit).

Two builders at once in one wave need WR1: today any build agent may write anywhere under `.forge/worktrees/`, since roots are per mode and skill, not per run (`docs/designs/forge/one-slice.md`, section 2). Until WR1, forge builds one slice at a time and says so; its smallest form is not designed (one-slice.md, WR1).

### Kernel changes

| Slice | Kernel feature | What | Size, estimated |
|---|---|---|---|
| KR1 | runs, manifests, the workflow schema | `when`, `repeat`, null for a step not yet run | about 140 lines |
| KT1 | config schema, the adapter, runs | tiers with model and effort, recorded per step | about 60 lines |
| KC1 | the card printer | a heading per run of one mark and step | about 30 lines |
| KH1 | the adapter, kernel tools, runs | a skill's output refused when the hook did not see its agent; the kernel's line on each card | about 80 lines |
| KA1 | manifests | forge active outside the kit, bringing its modes | about 20 lines |
| WR1 | the adapter, runs | roots per run | not known; a design first |

KR1 and KH1 each touch more than one feature, which ADR 17 item 4 says the merge card shows and records as a finding.

### What is thrown away of today's forge, and what stays

| Part of `components/base/forge/` | Fate |
|---|---|
| `waves` and `scripts/lib/plan-waves.ts`, `scopes.ts`, `problems.ts`, `reading.ts`, `lines.ts` | stay; `problems.ts` and `plan.json` grow four problems and four optional fields (FP1) |
| `declare` and `scripts/declared-in-scope.ts` | stay; the skill gets `like` and feedback |
| `build` and its skill | stay as an action; the skill is rewritten: no test, the findings and failures as feedback |
| `slice` (`scripts/slice.ts`) and the start card per slice | thrown away: the plan card approves every slice; `open-slice` replaces it with no card |
| `workflows/one-slice.yaml` | thrown away; `slice.yaml` and `wave.yaml` replace it |
| `keep-work` through `worktrees.set-aside` | thrown away; `worktrees.commit` replaces it |
| `draw`, `carry-out`, `scripts/lib/cards.ts` | rewritten: the rules `add` and `ask`, the wave branch, KC1's headings |
| `tests/one-slice.test.ts`, `cards.test.ts` and their examples | rewritten with the workflow |
| proof, its eight kinds, `proof@1` | stay; PR1 adds the toolchain run |
| git-worktrees | stays; WK1 adds commit, the tests room, combine and discard |

## What was read, and what was not verified

**Read**, in this worktree: `0-frame.md`; ADRs 15, 17, 20 to 25; `docs/designs/forge/one-slice.md`; `docs/designs/proof/` (headings of `0-frame.md` and `comparison.md`, `interface-open-questions.md` by heading, the start of `C1r-what-an-approval-shows.md`); `docs/designs/operations/0-frame.md` (the S properties) and `docs/designs/trust/0-frame.md` (the T properties and the table of who can do what); `framework/practices.md`; `CONTEXT.md`; `components/base/forge/` (mode, workflow, README, the printed cards in its tests, `plan.json`); `components/base/proof/` (mode, README, `kinds.ts`, the request and response schemas); the toolchain and worktrees interfaces' YAML and the schemas named above; `components/base/typescript/mode.yaml` and where it parses failures; `components/base/git-worktrees/scripts/lib/folders.ts` and its manifest's start; `bay/runs/action-steps.ts`, `workflow-steps.ts`, `card.ts`; `bay/approval-card.ts`; `bay/policy.ts` (grants); `bay/adapter.ts`; `bay/manifests/activation.ts`, `references.ts` (patterns); `bay/sdk.ts` (the script context); `bay/runs/engine.ts` (what a skill may call); `adapters/claude-code/agent-file.ts`, `guard-decide.ts`, `README.md`; `schemas/workflow.schema.json`, `config.schema.json`, `mode.schema.json` (the skill step and time limit); `docs/plans/0022-forge-in-waves.yaml` (by its slices), `0023-todo-mode.yaml`; `tests/affected.ts`; `docs/research/2026-11-17-suite-time.md` (its numbers).

**Not read:** the proof designs A, B and C in full; `components/base/proof/scripts/lib/`; the worktrees and toolchain shared tests; `bay/runs/runs.ts` and `skill-steps.ts` beyond what `one-slice.md` cites.

**Not verified:**

- That a script whose call waits for a skill runs again with its finished calls replayed. Read in `action-steps.ts`; no test found. It matters only for the "without KR1" path.
- Every time in section 8 except the suite's: the todo test files, the static checks on one copy, a slice's proof.
- KR1's and the other kernel slices' sizes: estimates from the files they touch.
- Whether Claude Code's agent file takes an effort.
- Whether the toolbox's `schemas.check` loads the JSON Schema meta-schema.
- That git's `merge-tree --write-tree`, which `combine` would use, behaves under the mode's protections; git here is 2.43.0, which has it.
- The 20-character rule on real failure messages: not tried on the kit's tests.
- The cards were printed by hand to KC1's design, not by code. Each row was checked to be at most 44 columns.
- `bay check` in this worktree reported 0 errors and 42 warnings and said nothing of the hook; whether the hook is registered here was not checked further.

## Questions only the owner can answer

1. **Rounds in the kernel or in forge?** (a) KR1: `when` and `repeat` in the workflow form; the kernel counts the rounds, as ADR 17 item 10 says. (b) A forge script drives the rounds; no kernel change for rounds, the limit lives in forge, and a judged line names every skill under that step, the builder's too. **Recommended: (a).**
2. **The whole suite once per wave, not per slice.** (a) Yes: a slice's proof is its own tests, bugs and scope; the merge card is per wave. (b) No: the suite per slice, as today, 555 seconds each. **Recommended: (a).** A break found at the wave costs one suite per slice to find.
3. **What of a failing case reaches the builder.** (a) The name, and the message when it shares no 20 characters with the tests. (b) The name only. **Recommended: (a).** The messages worth having come from the builder's own code.
4. **Who writes the bugs to plant.** (a) A planter in the build room, who has not seen the tests. (b) The reviewer, who has. **Recommended: (a).**
5. **A step the hook did not see.** (a) The kernel refuses its output (KH1), so an unconfined builder's work never reaches proof. (b) The kernel accepts it and the card says it was not confined. **Recommended: (a).**
6. **Stopping you per slice.** (a) A slice card only when a must item, scope, declaration or the rooms did not pass; otherwise the slice goes onto the wave branch, which reaches main only on your merge card. (b) A card for every slice. **Recommended: (a).**
7. **Does a condition name its kind of proof?** (a) No: it says only `seen: run` or `seen: judged`; the plan picks the kind. (b) Yes, in the requirements. **Recommended: (a).** The PM mode then writes nothing that only forge understands.
