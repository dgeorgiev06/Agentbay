# Forge, whole: design A, the smallest change

Design A of the frame `0-frame.md`. Its stance: keep everything of today's forge, proof and kernel that can stay.
Drive new behaviour from forge's own scripts and workflow. Where a kernel change cannot be avoided, name the
smallest one and say why nothing less works. Words are used as `CONTEXT.md` defines them. It proposes; it
decides nothing.

Every file and line cited was read on branch `design/forge-whole-a` at `875d936`. Where a claim rests on
reading alone, with no test that holds it, the section on what was not verified says so.

## A in ten lines

1. The PM mode hands forge one YAML file: outcomes, each with conditions written as given, when, then.
   No kind of proof is named there; kinds belong to the plan.
2. System design writes `design.yaml` and the interface schema files. Designers submit values and write
   no file, so two designs are written apart with no kernel change. Small work is one design.
3. A plan gains `requirements`, `design` and each slice's `meets`. `forge.waves` checks every condition is
   met. A deep-tier challenger answers a balanced-tier planner.
4. One slice is a workflow of top-level steps: three rounds, unrolled. Each round step is a forge script
   that calls the test writer, the builder and the reviewer only when they are needed.
5. Tests are on disk only while the test writer works. `worktrees.set-aside` then takes them off disk.
   The builder never runs while they are there. This rests on the hook, and the card says so.
6. A failing case reaches the builder as its name and the first line of its message, from the toolchain,
   through proof. Nothing else of the test does.
7. Practices are read from the tables in the practices files. The reviewer gets the rows no check holds.
   The card counts them.
8. Proof runs everything but the whole suite in each round, about a minute. It runs the whole suite once
   per slice, at the end.
9. Kernel changes: none for the slice, the rounds or hiding the tests. Two later ones: tiers in the
   project's settings (TI1), and forge active outside the kit (OK1).
10. Build order: five small slices in wave 1, then forge's one round (FA1), rounds (FA2), the todo mode
    through it (TDX), then requirements, design and planning, and one slice in a project outside the kit.

## 1. The requirements document

**Conclusion.** One YAML file per piece of work, under `docs/requirements/`, checked by a new forge action
`forge.requirements`. An outcome is what a person sees working; a condition is one given, when and then.
The file names no kind of proof. The PM mode hands over this file and nothing else.

### Form

```yaml
title: A todo list kept by agentbay
outcomes:
  - id: O1
    says: A person adds a todo and sees it among the open ones.
    conditions:
      - id: O1-C1
        given: a project with no todo
        when: the person adds "buy milk", then lists the open todos
        then: one open todo is listed, with an id and the text "buy milk"
      - id: O1-C2
        given: two todos added, "a" then "b"
        when: the person lists the open todos
        then: they are listed in the order added
      - id: O1-C3
        given: any project
        when: the person adds a todo with an empty text
        then: it is refused with a sentence that says the text is empty
        example:
          run: [call, todo.add, '{"text":""}']
          prints: "The input of action add of mode todo does not match its schema: ..."
  - id: O2
    says: A person marks a todo done, or removes it.
    conditions: [...]
leftOut:
  - Due dates.
  - Sharing a list between projects.
```

### Schema

`components/base/forge/schemas/requirements.json`, in forge's folder, since forge is the one reader
(ADR 25, point 3). Its rules:

- `title`: one line. `outcomes`: at least one. `leftOut`: a list of sentences, may be empty.
- An outcome: `id` (`O` and a number), `says` (one sentence), `conditions` (at least one).
- A condition: `id` (the outcome's id, `-C` and a number), `given`, `when`, `then` (each one sentence), and
  an optional `example`: the words of one command and the exact text it prints. An example is what the
  owner wants literally. The planner turns it into a `real-thing` item.

### What a condition is

A condition is one thing a person could do and see. It is written so that a test writer can turn it into a
test case without reading any code. It says nothing of how it is built.

### Kind of proof: only in the plan

The requirements name no kind. The kinds are forge's, and a PM mode for a team that builds another way
should not have to know them (ADR 25, point 3). The plan links each item back to conditions (section 3).

### What the PM mode hands over

The file's path, and nothing more. `forge.requirements '{"file":"docs/requirements/todo.yaml"}'` checks it,
as `forge.waves` checks a plan: every problem with its line. A person may write the file by hand.

Forge's read paths today are `docs/plans/` and `framework/features.yaml`
(`components/base/forge/mode.yaml:12`). Slice RQ1 adds `docs/requirements/` and `docs/designs/`. This design
met that limit itself: `forge.waves` refused `docs/designs/forge-whole/A-plan.yaml` (section 10).

## 2. System design as forge's first phase

**Conclusion.** A workflow `design.yaml`. Each designer submits its design as a value and has no write tool,
so nothing is on disk until the owner chooses. Two designers are written apart with no kernel change. The
owner picks one design or two on a first card; one design still writes its interfaces.

### Steps, in the workflow's real form

```yaml
name: design
trigger: { manual: true }
budget: { minutes: 30 }
steps:
  - id: read
    action: requirements-card
  - id: start
    approval: How many designs?
    show: $steps.read.output.card
    choices:
      one: { does: "One design: small work" }
      two: { does: Two designs written apart, then compared }
  - id: first
    action: design
    input:
      requirements: $steps.read.output.requirements
      stance: $steps.read.output.stanceA
  - id: second
    action: second-design
    input:
      requirements: $steps.read.output.requirements
      stance: $steps.read.output.stanceB
      choice: $steps.start.output.choice
  - id: compare
    action: compare-designs
    input:
      first: $steps.first.output
      second: $steps.second.output
  - id: draw
    action: draw-design
    input:
      requirements: $steps.read.output.requirements
      first: $steps.first.output
      second: $steps.second.output
      compared: $steps.compare.output
  - id: card
    approval: Approve the design?
    show: $steps.draw.output.card
    quotes: [first, second, compare]
    choices:
      a: { does: Commit design A to the integration branch }
      b: { does: Commit design B to the integration branch, when: $steps.draw.output.two }
      stop: { does: Stop; nothing is committed }
  - id: commit
    action: commit-design
    input:
      choice: $steps.card.output.choice
      first: $steps.first.output
      second: $steps.second.output
      into: $settings.into
```

- `design`: one skill step, tier deep. Effects `[read]`, so its agent gets no `Write` or `Edit`
  (`adapters/claude-code/agent-file.ts:15-27`). It reads the project and submits a value in
  `schemas/design.json`.
- `second-design` and `compare-designs`: script steps that call `design` and the skill action `compare`
  only when the owner chose `two`. A script may call its own mode's actions by name
  (`bay/manifests/manifests.ts:336-338`). When no second design is written, both return
  `{ "written": false }`. This is the same device the slice uses for rounds; section 4 grounds it.
- `draw-design`: a script. It checks each design and draws the card.
- `commit-design`: a script. It cuts `<work>-design`, writes the chosen design's files there, commits them
  with `worktrees.commit` (slice WC1) and merges into `into`, as `carry-out` merges a slice today
  (`components/base/forge/scripts/carry-out.ts:39-42`).

### Outputs as files

The chosen design becomes these files, committed before any slice is planned:

- `docs/designs/<work>/design.yaml`: the modules, each with its entry and what it hides; the data model, each
  store with its owner; the decisions, each with what was decided, why, and the alternatives turned down;
  what is left out on purpose; and `meets`, which names, for each condition, the actions that serve it.
- The interface schema files at their final paths, such as `components/modes/todo/schemas/add-request.json`,
  or `components/base/interfaces/<name>.yaml` and its folder for a kit interface. They are schema files,
  not prose (ADR 25, point 6).

Decisions are records inside `design.yaml`, not separate files: one file that a script can check.

### Written apart, and compared

The second designer's input holds the requirements and its stance, never the first design. That input is
built by a script, so no model chooses it. Neither designer can write a file, so neither can leave anything
on disk for the other to read. The submissions are kept in the kernel's database, under `.agentbay/`, which
every step is closed to (`adapters/claude-code/guard-input.ts:1-10`).

`compare` is a skill at tier deep. It reads both values and submits the differences that matter, each with
the design that handles it better. Its words reach the card as judged lines.

### What the design card shows

Computed: the requirements' counts, whether each interface schema is a valid schema, the conditions the
interface names, the counts of decisions and of what is left out. Judged: what each module hides, the
decisions, and, with two designs, the comparison. Section 7 prints it for the todo mode.

### Small work

On the first card the owner chooses `one`. Then no second design and no comparison run. The design still
writes the interfaces as schema files, and `draw-design` refuses a design whose actions have no schema
file. So small work skips the second opinion, not the interfaces.

## 3. Planning

**Conclusion.** A workflow `plan.yaml`: a planner at tier balanced writes the plan as a value; the kernel's
own check rounds send `forge.waves`'s problems back to it; a challenger at tier deep, another model, attacks
it once and the planner answers once. The plan form gains three optional fields, and `forge.waves` gains
three checks.

### How slices are cut

- Every interface in the design is fixed by the design's commit, before any slice. That is stage 0.
- A kit interface with a shared test is a slice of kind `interface`, and every slice that builds against it
  comes after it.
- Every other slice meets at least one condition: it is vertical, something a person can see working.
- A slice's write scope is its module's folder, from `design.yaml`. Modules are the scopes (ADR 25,
  point 7), so slices of different modules can run side by side.
- Each `fails-first` item names the test files the test writer will write. These and the slice's schema
  files are the slice's fixed files: its builder may not change them (section 4).

### Who challenges

`challenge` is a skill at tier deep, Opus. The planner is tier balanced, Sonnet. So the challenger is another
model (practices P-27, `framework/practices.md`). It submits findings; the planner answers them in one more
round; a second challenge reads the answer. The same device as the slice's rounds: `plan-2` and
`challenge-2` are scripts that call their skill only when the first challenge found something.

### What changes in the plan form

In `components/base/forge/schemas/plan.json`, all optional, so plans 0022 and 0023 stay valid:

- top level `requirements`: the requirements file's path;
- top level `design`: the design file's path;
- in each planned slice, beside `title` and `slice`, `meets`: the condition ids it makes true.

The slice itself stays `proof@1`'s slice by reference (`plan.json:43-45`). Proof is not touched.

### What changes in `forge.waves`

When `requirements` is set, three new problems, each with its sentence:

- a condition that no slice meets;
- a slice that names a condition the requirements do not hold;
- a slice that changes a fixed file of another slice.

`scripts/lib/plan-waves.ts` and `scripts/lib/problems.ts` stay. The new checks are added beside them.

## 4. One slice under ADR 24

**Conclusion.** The workflow `one-slice` keeps its first four steps and its last three. Between them are six
top-level steps, `round-1`, `review-1` to `round-3`, `review-3`, then one full `prove`. Each round step is a
forge script that calls skill actions only when needed. The workflow form needs no loop and no conditional
step. The tests leave the disk before the builder starts.

### The workflow, in the schema's real form

```yaml
name: one-slice
trigger: { manual: true }
budget: { minutes: 120 }
steps:
  - id: slice
    action: slice
  - id: start
    approval: Build this slice?
    show: $steps.slice.output.card
  - id: cut
    action: worktrees.cut
    input:
      slice: $steps.slice.output.slice.name
      base: $steps.slice.output.base
  - id: declare
    action: declare
    input:
      slice: $steps.slice.output.slice
      fixed: $steps.slice.output.fixed
      folder: $steps.cut.output.folder
      practices: $settings.practices
  - id: round-1
    action: round
    input:
      slice: $steps.slice.output.slice
      fixed: $steps.slice.output.fixed
      cut: $steps.cut.output
      declared: $steps.declare.output
      practices: $settings.practices
      before: null
  - id: review-1
    action: review-round
    input:
      slice: $steps.slice.output.slice
      practices: $settings.practices
      round: $steps.round-1.output
  - id: round-2
    action: round
    input:
      slice: $steps.slice.output.slice
      fixed: $steps.slice.output.fixed
      cut: $steps.cut.output
      declared: $steps.declare.output
      practices: $settings.practices
      before: $steps.review-1.output
  - id: review-2
    action: review-round
    input:
      slice: $steps.slice.output.slice
      practices: $settings.practices
      round: $steps.round-2.output
  - id: round-3
    action: round
    input:
      slice: $steps.slice.output.slice
      fixed: $steps.slice.output.fixed
      cut: $steps.cut.output
      declared: $steps.declare.output
      practices: $settings.practices
      before: $steps.review-2.output
  - id: review-3
    action: review-round
    input:
      slice: $steps.slice.output.slice
      practices: $settings.practices
      round: $steps.round-3.output
  - id: prove
    action: proof.prove
    input:
      slice: $steps.slice.output.slice
      base: $steps.cut.output.commit
      head: $steps.review-3.output.head
      declared: $steps.review-3.output.declared
      bugs: $steps.review-3.output.bugs
  - id: draw
    action: draw
    input:
      slice: $steps.slice.output.slice
      proof: $steps.prove.output
      rounds: $steps.review-3.output
      into: $settings.into
  - id: card
    approval: Merge this slice?
    show: $steps.draw.output.card
    quotes: [review-1, review-2, review-3]
    choices:
      merge: { does: Merge into the integration branch, when: $steps.draw.output.merge }
      keep: { does: Stop; the branches stay }
      discard: { does: Stop; the worktrees go, when: $steps.draw.output.discard }
  - id: carry-out
    action: carry-out
    input:
      choice: $steps.card.output.choice
      name: $steps.slice.output.slice.name
      head: $steps.review-3.output.head
      into: $settings.into
```

Every input value is one reference, resolved whole, as the kernel requires
(`bay/manifests/references.ts:152-166`). The literal `null` is a value, not a reference
(`references.ts:144-147`).

### Why rounds need no kernel change

Three facts of the code:

1. A script may call an action, including its own mode's skill actions by bare name
   (`bay/runs/action-steps.ts:184-197`, `bay/manifests/manifests.ts:336-338`).
2. When a called action waits, for a skill or anything else, the script's answer says so, the script's step
   waits too, and on resume the script runs again with its finished calls replayed
   (`action-steps.ts:157-172`, `:236-241`, `:258-262`). A test holds this for a wait on budget
   (`tests/runs-caller.test.ts:110`). No test holds it for a wait on a skill. Slice SC1 adds that test
   first, and changes no kernel file; if the test fails, SC1 stops and names what is missing.
3. A card's judged line cites a top-level action step, and the kernel lists every skill that ran under it
   (`bay/runs/card.ts:175-198`). So `review-n` must be top-level, and only the reviewer may run under it.

So each round is a pair of top-level steps. A round step that is not needed calls nothing and passes its
input on. A `foreach` over a list of none or one could do the same, but its inner steps cannot be cited by
the card, since a foreach's inner keys are not kept outside it (`bay/runs/workflow-steps.ts:298`). And the
kernel's own check rounds (`action-steps.ts:52`, `:381-439`) fail the run after the third round
(`:430-434`), so the owner would never see the merge card. Neither fits; the unrolled pair does.

### Every step, its inputs and its outputs

| Step | Kind inside | Input | Output |
|---|---|---|---|
| `slice` | script | the trigger: `{ planned, base }` | `{ slice, base, fixed, card }`. `fixed` is every `fails-first` test path and every schema file in the scope that the design fixed |
| `start` | approval | the start card | approve passes on; reject fails the run, nothing is cut (`workflow-steps.ts:173-182`) |
| `cut` | script | slice name, base | `{ folder, branch, commit }` (`git-worktrees/scripts/cut.ts:6-29`) |
| `declare` | skill, balanced; check `declared-in-scope.ts` | slice, fixed, folder, practices | proof@1's declaration. The check now also refuses a fixed file |
| `round-n` | script calling actions | slice, fixed, cut, declared, practices, before | `{ round, ran, head, testsBranch, tests, declared, built, proof, changedFixed, before }` |
| `review-n` | script calling actions | slice, practices, round | `{ round, done, head, declared, bugs, findings, judged, toTests, toBuilder, reviewedAt }` |
| `prove` | script | the slice whole, base, head, declared, bugs | proof's answer (`components/base/interfaces/proof/prove-response.json`) |
| `draw` | script | slice, proof, rounds, into | `{ card, merge, discard }` |
| `card` | approval, three choices | the merge card | `{ choice, content }` |
| `carry-out` | script calling actions | choice, name, head, into | as today (`carry-out.ts:39-49`) |

### Inside `round-1`

The script `scripts/round.ts` makes these calls, in this order:

1. `worktrees.cut { slice: "<S>-tests", base }`: the test writer's own worktree.
2. `write-tests { slice, folder, tests, schemas, practices }`: skill, tier balanced, effects `[read, write]`.
   It writes only the named test files. It submits `{ written, cases }`: the paths and the case names.
3. The script reads each written test file with `context.files.read`; forge may read what it may write
   (`bay/policy.ts:393`). A written path outside the named tests ends the round with that reason.
4. `worktrees.set-aside { folder }` commits the tests to `forge/wip/<S>-tests/1` and switches the folder
   back to the base (`git-worktrees/scripts/set-aside.ts:23-29`). From here the tests exist only in git.
5. `build { slice, folder, practices, declared, feedback: [] }`: skill, tier balanced, effects
   `[read, write]`. The task holds no test text: the script builds its input, and it holds paths only.
6. `worktrees.commit { folder, message }` (slice WC1): the work is committed to `forge/<S>`, and the files
   stay in the folder for the next round.
7. `worktrees.changed { base, head }`: any fixed file the builder changed is a finding for the card.
8. `worktrees.merge { folder: <builder's folder>, into: "forge/wip/<S>-tests/1" }`: one commit holding the
   tests and the code (`git-worktrees/scripts/merge.ts:198-213`). This is the head proof judges.
9. `proof.prove` with the slice less its `checks` items, the head from step 8, and as declared the
   builder's files with the test files added. The test writer declares its files by writing them; the
   script adds them, so proof's `declared` item covers both (ADR 24, consequences).

The output keeps the test text, for the reviewer only. It is in the kernel's records; no step can read them.

### Inside `round-2` and `round-3`

When `before.done` is true, the script calls nothing and returns `before`'s round with `ran: false`.
Otherwise:

- When `before.toTests` holds findings: cut `<S>-tests-r<n>` at the base; write the last tests into it with
  `context.files.write`; call `write-tests` with the findings; read; set aside. The new tests branch is the
  one the round merges into.
- When `before.toBuilder` holds feedback: call `build` with it.
- Then commit, changed, merge and prove, as in round 1.

### Inside `review-n`

The script `scripts/review-round.ts`:

- When the round did not run, it returns the review before it, unchanged.
- When a `fails-first` item failed on the head and this is not round 3, it calls no model. The round's
  `toBuilder` is the failing cases, each a name and a message, from proof (slice PF1). That is all of the
  test the builder is told (ADR 24, point 5).
- Otherwise it calls `review`, a skill at tier deep, and sets `done` when no finding goes to the test writer
  or the builder, or when this is round 3. `reviewedAt` names this step, so the card cites the step under
  which the reviewer ran.

### Where the tests live, and what that rests on

They live on disk only in `.forge/worktrees/<S>-tests`, and only while the test writer works. After
`set-aside` they are in git alone. The builder's step starts after that, since a workflow's steps, and a
script's calls, run one after another (`workflow-steps.ts:348-365`).

Every forge agent can read all of `.forge/worktrees/`: a mode's read roots are its folder, its read paths and
its write paths, the same for each of its skills (`bay/policy.ts:393`). So the hiding rests on time, not on
roots. It also rests on:

- the builder having no shell: forge lists no command (`agent-file.ts:24`);
- `.git` being closed to every step, so git's objects cannot be read (`guard-input.ts:1-10`);
- the builder's task holding paths, never test text (`bay/runs/skill-steps.ts:40-62`);
- the hook being active. In a session without it, nothing confines the builder (ADR 24, consequences).

Forge cannot see whether the hook is active. So no card says the builder was confined. The start card says
the builder works without the tests "only while the agentbay hook is on". The coordinator's protocol already
stops a session where `bay check` reports no hook (`CLAUDE.md`, the agentbay block). Section 11 asks whether
to make the kernel record it (slice HK1).

### How the kernel runs the tests, and what reaches the builder

Proof runs them, in throwaway copies, through the toolchain (`components/base/proof/scripts/kinds/fails-first.ts:128-146`).
Today the toolchain's failed run names the failing tests (`components/base/interfaces/toolchain/test-response.json:72-80`),
read from TAP's `not ok` lines (`components/base/typescript/scripts/lib/tap.ts:10`, `:38-43`). Proof does not
carry them on: its detail is one sentence (`fails-first.ts:86-97`).

- Slice TF1: the toolchain's failed answer gains `failures`, each a case's name and the first line of its
  error, cut at 200 characters. No stack, no location, no expected or actual value.
- Slice PF1: proof's failed `fails-first` verdict carries those as `cases`.
- The test writer's skill says: give each assertion a message in plain words that says what should hold,
  without the expected value. With node's default messages, the first line holds no value either
  ("Expected values to be strictly equal:").

### The reviewer: input, categories, output

Input: the slice, the test files' text (from the round's output), the builder's folder (on disk), proof's
verdicts, the practices it holds (section 5), the findings of earlier rounds, and the builder's answers to
them. The `build` output gains an optional `answers`: one sentence per finding. That is the discussion.

Categories, the kit's (ADR 24, point 6): `checks`, `fails-first`, `bugs-caught`, `same-output`, `count`,
`real-thing`, `scope`, `declared`, `boundaries`, `duplicates`, `size`, `practice`.

Output, `schemas/review.json`:

```json
{
  "findings": [
    { "to": "builder", "category": "practice", "practice": "P-05",
      "says": "list sorts by text, not by the time a todo was added",
      "where": "components/modes/todo/scripts/list.ts" }
  ],
  "judged": [ { "item": "DOD-TD1-3", "holds": true, "because": "two actions, each with ..." } ],
  "bugs": [ { "name": "list drops the last todo", "patch": "diff --git ...", "tests": ["components/modes/todo/tests/todo.test.ts"] } ]
}
```

`to` is `test-writer`, `builder` or `owner`. The `review` skill step has a check script,
`scripts/no-test-text.ts`. It refuses a finding for the builder that holds any line of a test file, with
feedback to the reviewer. That uses the kernel's own check rounds (`action-steps.ts:381-439`), which give a
check script the skill's input (`:387`), here the test text.

### Who writes the bugs to plant

The reviewer, in its output, from round 1 on (practices P-18 already says the reviewer injects bugs of its
own). They are written against the last head, which the reviewer has read. They are proved once, in the full
`prove`. Not the builder, whose tests they would judge (`prove-request.json`, `bugs`), and not the test
writer, whose tests they test.

### What is thrown away in this workflow

`keep-work` (set-aside of the builder's work) goes; `worktrees.commit` takes its place. The choice
`send-back` goes: rounds happen before the card, and after round 3 the owner merges, keeps or discards
(ADR 24, point 7). The `build` skill's "write each item's test first" goes, and its tier becomes balanced
(today deep, `components/base/forge/mode.yaml:46`).

## 5. Practices

**Conclusion.** Forge reads the practices tables as they are. The first words of "Held by" say who holds a
row: a check, proof, or the reviewer. The reviewer gets the rows no check holds; the card counts the three.
A project adds its own file to the setting `practices`.

- Today each row is `| Id | Practice | Held by |`, and "Held by" starts with `check`, `review`,
  `planned check`, `plan` or `design` (`framework/practices.md`). A script reads every row whose first cell
  is an id such as `P-16` or `TS-04`, from each file in the setting `practices`
  (`components/base/forge/schemas/settings.json:69-79`).
- Held by a tool: rows starting `check`. Proof's `checks` item holds them.
- Held by proof: rows starting `proof:` and a kind. FA1 changes two rows: P-17 becomes "The test writer's
  tests fail on the base and pass on the head", held by `proof: fails-first`; P-18 becomes "The reviewer
  writes bugs of its own", held by `proof: bugs-caught; review`.
- Held by the reviewer's judgement: every other row. These are the reviewer's list, given whole in its
  input. A finding names the id.
- The card shows one computed line of counts, and each finding as a judged line with its id.
- A project's own practices: a file with the same table, named in `practices`. Two rows with one id are a
  problem `forge.waves` names.

Nothing moves to a new file. That keeps one place for each practice (ADR 11).

## 6. Tiers

**Conclusion.** The kit's config gains `tiers`, each a model and an effort. The adapter writes both into
each step agent. That is a kit schema and adapter change (TI1), and nothing less works: the map from tier
to model is a constant in the adapter today.

- Today: `fast` haiku, `balanced` sonnet, `deep` opus, fixed in `adapters/claude-code/agent-file.ts:5-9`,
  with no effort. The models already match ADR 24; the effort cannot be set.
- TI1: `schemas/config.schema.json` gains

  ```yaml
  tiers:
    balanced: { model: sonnet, effort: medium }
    deep: { model: opus, effort: medium }
  ```

  and the adapter writes the agent's `model` from it, and its effort. Left out, the agents are as today.
- Skills: `write-tests`, `build`, `declare` and `plan` at balanced; `review`, `design`, `compare` and
  `challenge` at deep.
- The card: the kernel already adds the skill and its tier under each judged step, "by forge
  skills/review, tier deep" (`bay/approval-card.ts:30-38`). Slice MN1 of plan 0022 adds the model's name.
  A adds nothing to that line.

## 7. The cards

**Conclusion.** Four cards, each answer first, each line ≤ 44 columns, every line computed by script except
the reviewer's, designer's and challenger's words, which are judged and cite their step. A failed item shows
its reason; a withheld choice shows why.

What changes from today's `scripts/lib/cards.ts`:

- The merge card starts with the answer: merge offered, or not and why.
- A failed item shows proof's sentence and its failing cases, not only its id (today
  `cards.ts:441-454` prints "failed, kind fails-first: <ids>").
- Rounds get one line; findings left for the owner are judged lines citing `review-n`.
- The start card says who writes the tests and what hiding them rests on.

Each card below is printed as `bay runs <id>` prints it (`bay/approval-card.ts:73-81`): the title, the
lines, the choices, the kernel's counts and the hash. The kernel also prints a first line naming the run and
a last line with the command to decide; both are over 44 columns today (`bay/run-report.ts:93-98`) and are
left out here.

### Start card, slice TD1 of plan 0023

```
Build slice TD1?
computed A todo mode that adds a todo and
computed lists the open ones
computed kind mode; base 875d936
computed scope: components/modes/todo/**
computed after no other slice
computed tests: components/modes/todo/
computed tests/todo.test.ts
computed the test writer writes them first;
computed the builder works without them
computed only while the agentbay hook is
computed on: run bay check if unsure
computed fixed, the builder may not change:
computed the tests and 4 schema files
computed DOD-TD1-1, must: The kit's checks
computed and its whole test run pass with
computed the todo mode in it.
computed held by: checks, once, at the end
computed DOD-TD1-2, must: The mode's own
computed test fails without the mode's
computed code and passes with it. ...
computed held by: a test fails first
computed DOD-TD1-3, should: The actions are
computed add and list and nothing else; ...
computed held by: your reviewer, then you
computed rounds: at most 3; test writer and
computed builder tier balanced, reviewer
computed tier deep
checked: 0 ran, 27 computed, 0 judged
hash 41c0e9a27b3d
```

The "..." stands for the rest of each item's sentence, which the card prints whole (FC1, merge `aa8ff33`).

### Design card, the todo mode, one design

```
Approve the design of the todo mode?
computed requirements: docs/requirements/
computed todo.yaml: 2 outcomes, 7
computed conditions
computed one design: you chose small work
computed on the start card
computed module todo, entry mode.yaml
computed interface: 4 actions, 8 schema
computed files, each a valid schema:
computed add, list, done, remove
computed data: table todos, owned by todo
computed conditions the interface names:
computed 7 of 7
computed decisions: 2; left out: 3
judged   todo hides how todos are kept; ids
judged   are whole numbers given in order
judged   decided: one table, not a file;
judged   turned down: a JSON file, which
judged   cannot be undone with the run
judged   left out: due dates, sharing,
judged   editing a todo's text
judged    by forge skills/design, tier deep
Choose one:
  a     Commit design A to the integration
        branch
  b     Commit design B to the integration
        branch
        not offered: one design was asked
        for.
  stop  Stop; nothing is committed
checked: 0 ran, 13 computed, 7 judged
hash 2b81d07e9a4f
```

### Plan card, plan 0023

```
Approve the plan for the todo mode?
computed plan: docs/plans/0023-todo-mode.
computed yaml
computed 2 slices, 2 waves; longest chain:
computed TD1, TD2
computed wave 1: TD1 (mode)
computed wave 2: TD2 (mode)
computed TD2 after TD1: It adds two
computed actions to the mode TD1 makes.
computed conditions met: 7 of 7
computed fixed first: 8 schema files, by
computed the design
computed problems: none
judged   TD2's item 3 is judgement only;
judged   its sentences could be a count of
judged   refusals that name the id
judged    by forge skills/challenge, tier
judged      deep
Choose one:
  approve  Commit the plan to the
           integration branch
  stop     Stop; nothing is committed
checked: 0 ran, 12 computed, 3 judged
hash c05a3e7f19d2
```

### Merge card, slice TD1, after three rounds, with a failure

```
Merge TD1 into feat/0022-agentbay5?
computed merge is not offered: DOD-TD1-2
computed failed after 3 rounds
computed failed DOD-TD1-2, a test fails
computed first: the named tests fail on the
computed head; 1 of 6 cases:
computed lists the open todos in the order
computed added: the list is in the order
computed the todos were added
computed checks passed: typecheck, lint,
computed format, deadcode
computed tests passed: 1,431
computed scope, declared: passed
computed bugs caught: 3 of 3
computed 7 files changed; the work is on
computed forge/wip/TD1-tests/1 at 9e41c2a
computed size in lines: components/ +312
computed rounds: 3; round 2 the builder
computed (1 failing case), round 3 the
computed builder (1 finding)
judged   DOD-TD1-3 holds: two actions,
judged   each with a description, schemas
judged   and an example; the README says
judged   what the mode does
judged   for you: list sorts by text, not by
judged   time added; the builder was told
judged   twice (P-05, fails-first)
judged    by forge skills/review, tier deep
computed practices: 35; a check holds 6,
computed proof 2, your reviewer 27
Choose one:
  merge    Merge into feat/0022-agentbay5
           not offered: DOD-TD1-2 failed.
  keep     Stop; the branches stay
  discard  Stop; the worktrees go
           not offered: discarding comes
           with slice WD1.
checked: 0 ran, 21 computed, 7 judged
hash 7d2f10b6c4e8
```

Where each line came from: `computed` lines cite `draw` or `prove`, steps that ran no skill
(`bay/runs/card.ts:200-206`); `judged` lines cite `review-3`, the step under which the reviewer last ran,
listed under `quotes`; the kernel adds the "by" line (`approval-card.ts:34-39`). The case line, "lists the
open todos in the order added: the list is in the order the todos were added", is the case's name and its
message, both written by the test writer. No `ran` line: forge still cannot name a command (one-slice.md,
section 2, RN1).

## 8. Time

**Conclusion.** Each round's proof leaves out the `checks` items, the only ones that run the whole suite: a
round costs about a minute of proof. The whole suite runs once per slice, at the end. Nothing extra runs per
wave in A's first build.

| When | What proof runs | Cost, from the code |
|---|---|---|
| each round | `fails-first`, `count`, `same-output`, `real-thing`, `scope`, `declared`, size | two copies and two runs of the named test files per `fails-first` item (`fails-first.ts:128-158`); a copy is 0.11 s and a script host 0.125 s (`docs/research/2026-11-17-suite-time.md:21-22`); seconds per named file, not measured |
| once per slice, `prove` | the whole slice, with the reviewer's bugs | the toolchain's checks, then the whole suite (`kinds/checks.ts:57-67`): 555 s as the frame gives it; plus one copy and the named files per bug (`kinds/bugs-caught.ts`) |
| once per wave | nothing more | - |

The first real run spent seventeen minutes in proof for one round, nearly all of it the suite (the frame).
Under A, three rounds cost about three minutes of proof and one suite, not three suites.

What each saving loses:

- **No `checks` in rounds.** A type or lint fault is found only at the end, after the rounds, so it reaches
  the owner, not the builder. A could add a proof option to run the checks without the suite; that changes
  `proof@1` and is not in this plan.
- **The suite once per wave, not per slice.** Saves (n − 1) × 555 s for a wave of n slices. Loses which slice
  broke the suite, and each slice's own merge: no slice could be offered merge before the wave's run. Not
  chosen; section 11 asks.
- **Only the tests a change affects** (`tests/affected.ts`). Loses whatever the map misses; the file itself
  says "The whole suite still runs on the merged branch" (`tests/affected.ts:50-51`). Not chosen.

## 9. Outside the kit

**Conclusion.** Three things: forge may be active in any project (OK1, a kernel change, since the kernel
refuses it today); a toolchain mode for the project's language; and `same-output` and `real-thing` running
the project's commands, not only the kit's `bay` (RT1, proof and toolchain, no kernel change).

- **Forge active.** Refused today: "modes lists forge, which can be active only when the project is the kit
  itself" (`bay/manifests/activation.ts:32-36`, and for bindings `:65`, `:82`). OK1 lifts that, and
  activates proof and git-worktrees with forge, bound to them, since each is the only base mode for its
  interface (ADR 25, point 4). The toolchain is not chosen for the owner: the project binds one.
  `bay/policy.ts:86-89` grants forge's special place only in the kit; outside it, forge's one write path
  `.forge/worktrees/` is an ordinary project path.
- **The toolchain.** A mode implementing `toolchain@1` for the language. A project's own mode is not trusted
  by place, so its list needs the owner's trust card (ADR 21). The kit has one, `typescript`.
- **The commands.** Today `same-output` and `real-thing` run only the copy's `./bay.sh`
  (`components/base/interfaces/proof/prove-request.json`, `real-thing`'s `bay`; `proof/schemas/settings.json:20-32`).
  RT1 lets a run name a command the bound toolchain lists, through a new toolchain action. Proof still runs
  no command of its own for it.
- **What the builder may read.** Its worktree, which holds the whole project at the base; forge's own folder;
  forge's read paths. Never `.git`, `.agentbay`, `.claude`, `.env` files or the config, whatever the roots
  (`guard-input.ts:1-10`). The practices files are read inside the worktree. A toolchain's practices file is
  named by forge's setting `practices`, since `describe` gives its path relative to the toolchain's own
  folder (one-slice.md, section 2, TP1).
- **What stays kit-only and does no harm.** The card's watched paths, `bay/`, `adapters/`, `schemas/`,
  `components/base/*/mode.yaml` (`cards.ts:140-145`), match nothing in another project.

## 10. The order to build it in

**Conclusion.** Fifteen slices in seven waves. Wave 1 is five small slices that each stand alone. FA1 is the
smallest forge that carries one slice under ADR 24; FA2 adds rounds; TDX builds the todo mode through it, as
the test. Design and planning come after; EX1 is the first use of OK1 and RT1.

What stays of today's forge: `waves` and its libraries; `slice`, `declare`, `draw`, `carry-out`; the card
functions and the wrapping at 35 columns; `plan.json`. What goes: `keep-work` by set-aside; the `send-back`
choice; the build skill's "test first". Proof stays whole, with one field added (PF1). The kernel is not
changed for the slice.

The plan is `docs/designs/forge-whole/A-plan.yaml`. `forge.waves` refused it where it lies, because forge
may read only `docs/plans/` (`components/base/forge/mode.yaml:12`):

```
docs/designs/forge-whole/A-plan.yaml is not a plan forge can read, for 1 reason:
The step 0 asked to read /home/claude/wt-design-a/docs/designs/forge-whole/A-plan.yaml, but the mode forge may read only: components/base/forge, docs/plans, framework/features.yaml, .forge/worktrees. ...
```

So it was checked through an identical copy at `docs/plans/zz-design-a-check.yaml`, removed afterwards and
never committed. Its output, the table of slices cut here, then whole from "Waves":

```
Forge, whole, design A: the smallest change; one slice under ADR 24 first, the todo mode through it, then design and planning
15 slices in 7 waves. Longest chain, 7 slices: TF1, PF1, FA2, RQ1, DS1, PL1, TDW.

Waves
wave 1: SC1, WC1, TF1, TI1, OK1 (5 builders)
wave 2: PF1, FA1 (2 builders)
wave 3: FA2, RT1 (2 builders)
wave 4: TDX, RQ1 (2 builders)
wave 5: DS1, EX1 (2 builders)
wave 6: PL1 (1 builder)
wave 7: TDW (1 builder)

Problems
No problems.
```

| Slice | Kind | What | Kernel? |
|---|---|---|---|
| SC1 | capability | a test that a script's call waiting for a skill resumes and replays | no: a test only |
| WC1 | mode | `worktrees.commit` | no |
| TF1 | mode | the toolchain names failing cases with their first message line | no |
| TI1 | capability | tiers name a model and an effort in the settings | yes: kit schema, adapter |
| OK1 | capability | forge active outside the kit | yes: activation |
| PF1 | mode | proof carries the failing cases | no |
| FA1 | mode | forge, one round under ADR 24 | no |
| FA2 | mode | rounds two and three | no |
| TDX | mode | the todo mode through forge | no |
| RQ1 | mode | the requirements file and its check | no |
| DS1 | mode | system design | no |
| PL1 | mode | planning | no |
| RT1 | mode | a project's own commands in `same-output` and `real-thing` | no |
| TDW | mode | the todo mode's next outcome through the whole forge | no |
| EX1 | mode | one slice in a TypeScript project outside the kit; the first use of OK1 and RT1 | no |

Forge's slices FA1, FA2, RQ1, DS1 and PL1 run one after another: each changes `components/base/forge/`.
That costs the plan its width at the end; the forge folder is one mode, and P-34 keeps a mode slice to its
folder.

## 11. Questions only the owner can answer

1. **Who writes the bugs to plant?** (a) The reviewer, in its output. (b) A fourth skill.
   **Recommended: (a).** P-18 already says so, and it costs no model step.
2. **May the test writer read the builder's code in rounds 2 and 3?** In A it can: the builder's worktree
   is on disk. (a) Yes. (b) No: set the code aside too, and give the builder its work back each round.
   **Recommended: (a).** ADR 24 hides the tests from the builder, not the code from the test writer.
3. **What of a failing case may the builder read?** (a) Its name and the first line of its message.
   (b) Also the expected and actual values. **Recommended: (a).** It is what ADR 24, point 5 says, and it
   keeps the test's values out.
4. **The whole suite: once per slice, or once per wave?** **Recommended: once per slice,** for now. Each
   slice keeps its own merge and its own reason.
5. **Small work: who decides?** (a) You, on the design's first card. (b) A rule, such as one outcome.
   **Recommended: (a).**
6. **Should the kernel record whether a step's output came from a step agent or from the main thread?**
   Slice HK1, after TDX: the merge card could then say "submitted by the main thread, not confined".
   **Recommended: yes.** Today the card can only say what hiding rests on.
7. **Where does a merge land?** The setting `into` is `feat/0022-agentbay5`, and `worktrees.merge` refuses a
   branch checked out anywhere (`git-worktrees/scripts/merge.ts:157-168`). (a) Keep a branch nobody has
   checked out. (b) Build WM1 (one-slice.md, section 3). **Recommended: (a)** until TDX; then (b).

## 12. What was read, and what was not verified

Read: the frame; ADRs 24 and 25 whole; `CONTEXT.md`; `framework/practices.md`;
`docs/designs/forge/one-slice.md` (sections 1 to 3); all of `components/base/forge/` except its tests;
proof's `mode.yaml`, `scripts/kinds.ts`, `kinds/fails-first.ts`, `kinds/checks.ts`, `lib/toolchain.ts`;
`proof@1`'s request and response schemas; `toolchain@1`'s test schemas; `worktrees@1`'s list and the
git-worktrees scripts `cut`, `merge`, `remove`, `set-aside`, `lib/folders.ts`; the typescript mode's
`lib/tap.ts`; `bay/runs/action-steps.ts`; the workflow schema and `bay/runs/workflow-steps.ts` (approvals and
foreach); `bay/runs/card.ts` (marks and citations); `bay/approval-card.ts`; `bay/tools.ts` and
`bay/skill-tools.ts`; `bay/sdk.ts` (the script context); `bay/policy.ts` (roots and forge's place);
`bay/manifests/activation.ts`, `references.ts` and `manifests.ts` (action references);
`adapters/claude-code/README.md`, `agent-file.ts`, `guard-input.ts`; plans 0022 and 0023;
`tests/affected.ts` (its start).

Skimmed or not read: ADRs 15, 17, 20, 21, 22 and 23 were not reread; their rules are cited through
`CONTEXT.md` and the frame. The proof designs (`docs/designs/proof/`), the operations and trust frames,
`tests/affected.ts` past its start, and every test file were not read. No claim above rests on them alone.

Not verified:

- That a script's call waiting for a skill resumes with the skill's task and replays. Read in the code;
  no test holds it. SC1 exists for that.
- That `worktrees.merge` works into a branch with slashes, `forge/wip/TD1-tests/1`, whose target folder is
  then `.forge/targets/forge/wip/TD1-tests/1` (`git-worktrees/scripts/lib/folders.ts:14-16`). No test uses
  such a branch.
- That a Claude Code agent file can set an effort. TI1 must read the harness's documentation first.
- The time of a round's proof, and of the toolchain's checks on the kit. Not measured.
- That a toolbox call can tell whether a design's schema file is a valid schema.
- That outside the kit, `bay/policy.ts` lets forge write `.forge/worktrees/` with no change. Read only;
  OK1's scope holds `bay/policy.ts` in case it does not.
- The hook in a live session (the adapter's README says the same).
- That card lines in section 7 print exactly so: they were wrapped by hand to the rules of `cards.ts` and
  `approval-card.ts`, and each was measured at 44 columns or fewer. The hashes are made up.
