# Proof, the form of a slice and a plan, and the card: design A, the smallest

Constraint: the least that makes proof's verdicts replace the reviewer's hands, and nothing the todo mode does not
need. Read `0-frame.md` first; its words, cases and properties are used here without repeating them.

The idea in one paragraph. Proof is one action that takes a slice as data and gives a verdict per item. A slice is
the request of that action, so the form of a slice and proof's interface are one schema, in the interface's own
folder. A plan is a file of the forge mode that lists slices in that form. What a project declares goes in proof's
settings in `agentbay.config.yaml`, which a mode already receives (`schemas/config.schema.json:25-30`,
`bay/sdk.ts:105`), so the kernel gains nothing for it. The card is the content an approval already shows: lines a
forge script draws, and one offered choice that the script computes. The owner approves the offer or rejects, as
today (`bay/runs/runs.ts:70-75`). The kernel learns only to print those lines as lines.

## 1. Proof

### The entry, as a caller uses it

One interface, `proof@1`, with one action, `prove`. One mode implements it, `components/base/proof/`. The
interface exists because a workflow may call only its own actions or an interface it requires
(`schemas/workflow.schema.json:84`).

The reviewer by hand, on TR2's branch, writes the slice once (section 2) and runs:

```
$ bay call proof.prove "$(cat /tmp/tr2-proof.json)"
```

where the file holds the slice of section 2, plus:

```json
{ "base": "c7f0d13", "head": "c9bb216",
  "declared": { "files": ["bay/broker/list-in-force.ts", "bay/broker/command-operations.ts",
                          "bay/broker/file-operations.ts", "bay/broker/rule.ts", "bay/broker/step-broker.ts",
                          "framework/features.yaml", "tests/broker-list-trust.test.ts",
                          "tests/cli-trust-at-use.test.ts", "tests/script-commands.test.ts",
                          "tests/shared-tests-in-a-project.test.ts", "tests/system-fixture.ts"],
                "names": [] },
  "bugs": [ { "name": "the record is not read again", "patch": "diff --git a/bay/broker/list-in-force.ts …" } ] }
```

and reads (numbers marked `e.g.` are examples; the rest follow from TR2's commits):

```json
{ "verdicts": [
  { "item": "DOD-TR2-1", "kind": "fails-first", "verdict": "passed",
    "detail": "tests/broker-list-trust.test.ts: failed on the base with its tests laid over it, passes on the head" },
  { "item": "DOD-TR2-2", "kind": "count", "verdict": "passed",
    "detail": "listTrust.state under bay/broker/: 2 matches, at most 2 allowed" },
  { "item": "DOD-TR2-5", "kind": "same-output", "verdict": "passed", "detail": "31 of 31 outputs equal (e.g.)" },
  { "item": "DOD-TR2-6a", "kind": "count", "verdict": "passed", "detail": "rule: in framework/feature-map-debt.yaml: 26 at the base, 26 at the head (e.g.)" },
  { "item": "DOD-TR2-7", "kind": "bugs-caught", "verdict": "passed", "detail": "10 of 10 caught (e.g.)" },
  { "item": "DOD-TR2-8", "kind": "checks", "verdict": "inconclusive",
    "reason": "test did not finish in 420 seconds, so nothing is known." },
  { "item": "scope", "kind": "in-scope", "verdict": "passed", "detail": "11 of 11 changed paths in scope" },
  { "item": "declared", "kind": "as-declared", "verdict": "passed", "detail": "11 files changed, 11 declared" } ],
  "tests": { "passed": 0, "failed": 0, "known": false },
  "size": [ { "path": "bay/broker/list-in-force.ts", "base": 0, "head": 91 } ] }
```

The `checks` verdict is inconclusive on the kit today: that is case K7 (section 4). `scope` and `declared` are
not items of the brief: proof adds them to every slice, because ADR 17 items 1 and 9 ask them of every slice.

### The closed set of kinds

Kinds are data: one action, a `kind` field, and one script per kind behind a table in the mode. Seven kinds:

| Kind | Request holds | The script does | Passed when |
|---|---|---|---|
| `checks` | nothing | Copy of head; `toolchain.check`, then `toolchain.test`; remove | Every check passed and the test run passed. Any inconclusive makes it inconclusive |
| `fails-first` | `tests`: test files | Copy of base; `overlay` the named files from head; `toolchain.test` with those files; then a copy of head, the same files | Failed on the base (not inconclusive) and passed on the head |
| `in-scope` | (the slice's `scope`) | `worktrees.changed(base, head)`; match each path against the patterns | Every changed path matches |
| `as-declared` | (the request's `declared`) | `changed`; for names, reads the `actions:` keys of each changed `mode.yaml` and interface `.yaml` on both sides with the listed `print` command in two copies | Changed files equal declared files; gained and lost action names equal declared names |
| `bugs-caught` | `bugs`: name and patch each | For each: copy of head, `worktrees.apply`, `toolchain.test` with a time limit, remove | Every run failed. One that passed is a survivor and fails the item; a run that ended inconclusive makes it inconclusive |
| `same-output` | `commands` from settings; `differ`: outputs allowed to differ | Copies of base and head; runs each command with the listed `bay` command in each; compares output and exit code | Each equal, except those named in `differ`, which must differ |
| `count` | `pattern`, `paths`, and `most` or `noRise` | Runs the listed `count-matches` command in a copy of head (and of base for `noRise`) | Head's count is at most `most`, or at most the base's |

Size is not a kind. Every response carries lines per changed file at base and head, counted with the listed
`count-lines` command in the two copies. It is reported and never a verdict (P-13).

An item with no kind is a judgement item. Proof does not touch it. The card shows it as judgement.

### What a project declares, and where

In proof's settings, in `agentbay.config.yaml`, checked against `components/base/proof/schemas/settings.json`. For
the kit:

```yaml
settings:
  proof:
    sameOutput:
      - name: sound-check
        fixture: tests/fixtures/sound
        bay: [check, --project, .]
      - name: sound-check-json
        fixture: tests/fixtures/sound
        bay: [check, --project, ., --json]
    noRise:
      - name: debt
        pattern: "rule:"
        paths: [framework/feature-map-debt.yaml]
```

Items name these by `name`. A project that declares none still gets `checks` (when a toolchain is bound),
`fails-first`, `in-scope`, `as-declared`, `bugs-caught` and `count` with a pattern given in the item. An item of
`same-output` there is inconclusive: "This project declares no commands whose output must not change, so nothing
is known." A map of modules is not read: in the kit the map is held by a test (`tests/feature-map.test.ts`), which
`checks` runs, and its debt list by `count`. Practices are not read by proof at all: the builder is given them by
path, from `toolchain.describe`.

The capture's fixtures live outside the repository today (`/home/claude/m5-capture/fixtures/`). A copy of a commit
holds only what the commit holds, so they move into `tests/fixtures/` first (section 5, slice T1).

### How proof reaches the toolchain and the worktrees

Every run is copy, call, remove, in that order, with remove in a `finally` (`docs/designs/forge/calling-a-toolchain.md`).
Copies are named `proof-<item>-<n>` and made by `worktrees.copy` with `links: [node_modules]`. Proof never names a
worktree to the toolchain (V4). It reads code only through command output in a copy, because no mode may hold a
read path over the throwaway folder `.forge/copies/` (`bay/policy.ts:333-350`).

Proof's manifest lists four commands, as a base mode may: `print` (`cat --`, read), `count-lines` (`wc -l --`,
read), `count-matches` (`grep -r -c -e`, read), `bay` (`./bay.sh`, read and write). No git: the worktrees mode
keeps that.

### Behind the entry

The copy lifecycle and its cleanup on every path; overlay for `fails-first`; one copy per bug with its own time
limit; matching paths against patterns; reading action names out of YAML; comparing outputs; turning the
toolchain's verdicts into an item's verdict with V1's rule (any inconclusive part makes the item inconclusive,
never passed). Deleted, each caller (forge's workflow, the reviewer's script, a later improve mode) would do all of
this itself, and each would decide "inconclusive" again. That is the complexity that would reappear (`0006`).

### The feature map afterwards

No kernel feature is added or changed for proof. Proof is a mode under the `modes` pattern and `proof@1` an
interface under the `interfaces` pattern (`framework/features.yaml:243-258`). Nothing is added to either list.

## 2. The form of a slice and a plan

### A slice

A slice is `proof@1`'s request without `base`, `head`, `declared` and `bugs`. Its schema is
`components/base/interfaces/proof/prove-request.json`. Not a file under `schemas/`: `concepts` stays 5. TR2:

```yaml
id: TR2
title: The broker says why a list is not in force, and reads the record again before each command
kind: capability
feature: broker
scope:
  - bay/broker/**
  - tests/broker-list-trust.test.ts
  - tests/cli-trust-at-use.test.ts
  - tests/script-commands.test.ts
  - tests/shared-tests-in-a-project.test.ts
  - tests/system-fixture.ts
  - framework/features.yaml
after:
  - slice: TR1
    because: ModeGrants.listTrust and readTrustRecord, which the broker reads
against: none
done:
  - item: DOD-TR2-1
    says: Each of three states refuses a command and each throwaway operation with its literal sentence
    proof: { kind: fails-first, tests: [tests/broker-list-trust.test.ts] }
  - item: DOD-TR2-1b
    says: The sentences say what the owner does, beside the design's, with a reason for each difference
  - item: DOD-TR2-2
    says: One function decides whether a list is in force; reachOf is the only other reader
    proof: { kind: count, pattern: listTrust.state, paths: [bay/broker/], most: 2 }
  - item: DOD-TR2-3
    says: A run loaded with trust is refused once the record changes, and the command never starts
    proof: { kind: fails-first, tests: [tests/broker-list-trust.test.ts] }
  - item: DOD-TR2-4
    says: bay call runs a trusted project mode's command and is refused after the trust is withdrawn
    proof: { kind: fails-first, tests: [tests/cli-trust-at-use.test.ts] }
  - item: DOD-TR2-5
    says: Nothing changes for the kit but where a fixture's project mode lists a command
    proof: { kind: same-output, commands: all, differ: [grants-check, grants-check-json] }
  - item: DOD-TR2-6a
    says: Neither debt list grows
    proof: { kind: count, use: debt }
  - item: DOD-TR2-6b
    says: The copy-paste detector's count does not rise
  - item: DOD-TR2-7
    says: Every injected bug is caught
    proof: { kind: bugs-caught }
  - item: DOD-TR2-8
    says: The checks and the tests pass
    proof: { kind: checks }
```

Three items stay judgement: 1b (P-28, words the owner reads), 6b (the detector is not one of the toolchain's checks,
`package.json:15`), and the part of every test-first item that a script cannot see: whether the test asserts what
the item says. The brief's "manifests, runs and broker stay sealed" is held by the feature-map test inside `checks`.

**The declaration** (`0017` item 9) is the output of a skill step `declare` that comes before the build step, with
the schema `{ files, names }`. The kernel records the submission before the build step starts, so "before it edits"
is held by the order of steps, not by the builder's word. Names are action names of a `mode.yaml` or an interface,
which proof can read without knowing a language. Names of a code entry, such as a kernel feature's exports, are not
proven in A: the declaration may list them and the card shows them as judgement. For TR2 the broker's entry gained
nothing, so `names` is empty.

**The bugs** are not part of the slice. The plan's challenge stage, or the reviewer, writes them as patches (P-18).
Writing a bug is judgement; whether a bug was caught is proof's.

### A plan

A plan is a file of the forge mode, `docs/plans/<name>.yaml`, with the schema `components/base/forge/schemas/plan.json`:
a title and a list of slices in the form above. The action `forge.waves` reads it and prints what it works out:
waves, the longest chain, builders per wave, and every pair of slices in one wave whose scopes share a path. It
refuses a plan where an `after` names no slice, where the order has a cycle, or where every slice waits for the one
before and the plan gives no `because` for that (`0017` item 8).

Plan 0022 in the form, each slice with its scope and order (the `done` lists are each slice's brief):

```yaml
title: Forge, from here to the todo mode
slices:
  - { id: D1, kind: design, scope: [docs/designs/proof/**, docs/adr/0022-*.md] }
  - { id: T1, kind: mode, scope: [components/base/typescript/**, components/base/interfaces/toolchain/**,
      tests/fixtures/**, tests/typescript-beside-the-kit*.ts] }
  - { id: I1, kind: interface, scope: [components/base/interfaces/proof.yaml, components/base/interfaces/proof/**,
      tests/made-up-proofs*.ts], after: [{ slice: D1, because: the chosen interface }] }
  - { id: C1a, kind: capability, feature: command-line, scope: [bay/run-report.ts, bay/commands/approve.ts,
      tests/run-report*.ts], after: [{ slice: D1, because: the chosen card }] }
  - { id: C3, kind: capability, feature: runs, scope: [bay/runs/**, bay/broker/command-operations.ts,
      tests/runs-rounds*.ts], after: [{ slice: D1, because: 0017 item 10 }] }
  - { id: P1, kind: mode, scope: [components/base/proof/mode.yaml, components/base/proof/schemas/**,
      components/base/proof/scripts/prove.ts, components/base/proof/scripts/lib/**,
      components/base/proof/scripts/kinds/checks.ts, components/base/proof/scripts/kinds/fails-first.ts,
      components/base/proof/tests/prove.test.ts, components/base/proof/tests/checks.test.ts,
      components/base/proof/tests/fails-first.test.ts], after: [{ slice: I1, because: the interface }] }
  - { id: P2, kind: mode, scope: [components/base/proof/scripts/kinds/in-scope.ts,
      components/base/proof/scripts/kinds/as-declared.ts, components/base/proof/tests/in-scope.test.ts,
      components/base/proof/tests/as-declared.test.ts], after: [{ slice: P1, because: the mode's folder and table }] }
  - { id: P3, kind: mode, scope: [components/base/proof/scripts/kinds/bugs-caught.ts,
      components/base/proof/tests/bugs-caught.test.ts], after: [{ slice: P1, because: the mode's folder and table }] }
  - { id: P4, kind: mode, scope: [components/base/proof/scripts/kinds/same-output.ts,
      components/base/proof/tests/same-output.test.ts], after: [{ slice: P1, because: the mode's folder and table }] }
  - { id: P5, kind: mode, scope: [components/base/proof/scripts/kinds/count.ts,
      components/base/proof/tests/count.test.ts], after: [{ slice: P1, because: the mode's folder and table }] }
  - { id: W1, kind: mode, scope: [components/base/forge/**], after: [{ slice: I1, because: the slice's form }] }
  - { id: F1, kind: mode, scope: [components/base/forge/**], after: [{ slice: P2, because: verdicts on scope },
      { slice: C1a, because: a card the owner can read }, { slice: W1, because: the forge mode and the plan }] }
  - { id: F2, kind: mode, scope: [components/base/forge/workflows/build.yaml, components/base/forge/scripts/rounds.ts,
      components/base/forge/scripts/merge-card.ts, components/base/forge/tests/rounds.test.ts],
      after: [{ slice: F1, because: the workflow }, { slice: C3, because: the count },
              { slice: P3, because: bugs }, { slice: P4, because: output }, { slice: P5, because: counts }] }
  - { id: F3, kind: mode, scope: [components/base/forge/workflows/before.yaml, components/base/forge/skills/**,
      components/base/forge/scripts/plan-card.ts, components/base/forge/tests/before.test.ts],
      after: [{ slice: F1, because: the workflow it hands to }] }
  - { id: F4, kind: mode, scope: [components/base/forge/workflows/wave.yaml, components/base/forge/tests/wave.test.ts],
      after: [{ slice: F2, because: one slice end to end first }] }
  - { id: X1, kind: forge-job, scope: [components/modes/todo/**, components/base/interfaces/todo*],
      after: [{ slice: F3, because: forge whole }, { slice: F4, because: forge whole }, { slice: T1, because: 0018 }] }
```

`bay call forge.waves '{"plan":"docs/plans/0022-forge-in-waves.yaml"}'` prints (worked out by hand from the
above, as the script would):

```
16 slices in 8 waves. Longest chain,
8 slices: D1, I1, P1, P2, F1, F2, F4, X1.
wave 0  D1 T1              2 builders
wave 1  I1 C1a C3          3 builders
wave 2  P1 W1              2 builders
wave 3  P2 P3 P4 P5        4 builders
wave 4  F1                 1 builder
wave 5  F2 F3              2 builders
wave 6  F4                 1 builder
wave 7  X1                 forge
No two slices in one wave share a path.
```

Two things the form shows that the table in prose hid. The table's P2 runs "beside P1 only after P1's first commit"
(`docs/plans/0022-forge-in-waves.md:55`); an `after` is between slices, not commits, so here P2 waits for P1 and the
chain is 8, not the plan's 7. And the table gives F2 and F3 both the scope `components/base/forge/` in one wave
(`:52-53`, `:66`); as written, `forge.waves` refuses that pair. Above, each is named by file, and F1 declares every
action of forge in its `mode.yaml` so that F2 and F3 add only their own files.

### Where the form lives, and its cost

The slice's schema lives in `proof@1`'s folder; the plan's in the forge mode. No file under `schemas/`, so
`concepts` stays 5 and the plan's I2 is not needed. The cost: a slice's shape changes only with a new major of
`proof@1`, and forge's plan schema names a schema of an interface it requires, which it may read.

## 3. The card

### What an approval holds

Nothing new in the kernel's run. An approval shows a step's output, as today (`workflow-steps.ts:134-152`). Forge's
card script returns `{ lines, offer }`: the lines of the card, and the one choice it offers, one of `build`,
`merge`, `send back`, `stop`. Approving makes that output the step's output (`workflow-steps.ts:130`), so the next
step reads `$steps.card.output.offer` and a script carries it out. Rejecting fails the run, which is "stop; the
branch stays": nothing removes a branch unless asked.

The kernel change is in the command line only: when shown content has `lines`, a list of strings, `bay runs` and
`bay approve` print the lines as they are, then the hash and the command to answer, instead of the JSON
(`bay/run-report.ts:94-99`, `bay/commands/approve.ts:153-161`). Slice C1a.

### How a script withholds a choice

The card script computes the offer, and only it. Merge is offered when every must item has a verdict of passed and
`in-scope` and `as-declared` passed. Otherwise, with a round left, the offer is `send back`, with every failed item.
With an inconclusive item, or no round left, the offer is `stop`. Then the card says, in the frame lines: "Merge is
not offered: 1 must item is inconclusive." or "Merge is not offered: 1 must item failed."

### The two cards for TR2

Numbers marked `e.g.` on these notes are examples; the rest come from TR2's commits and tests. The owner sees what
is in the boxes, nothing else.

Card 1, before the build (`judged` lines were written by the plan's model; the TR2 brief was written by the
reviewer, Claude Fable 5.2):

```
Build slice TR2?
judged The broker says why a list is
judged not in force, and reads the
judged record again before each command.
calc   plan trust, wave 1
calc   kind capability, feature broker
calc   scope bay/broker/** and 6 files
calc   after TR1: the record it reads
calc   beside TR3: no path shared
calc   10 items: 8 by proof, 2 judged
judged When a list is not trusted, you
judged would read:
judged "… but the owner does not trust
judged the list of mode notes, so none
judged of its commands or throwaway
judged folders is granted. The owner
judged reads the list and decides with:
judged bay approve --trust notes."
judged  by Claude Fable 5.2
Approve: build it.
Reject: stop. Nothing is built.
hash 9c41e07b52aa
```

Card 2, the merge, round 1:

```
Merge TR2 into feat/0022-agentbay5?
calc   round 1 of 2, 11 files changed
ran    checks: 5 of 5 passed
ran    tests: 1,374 passed, 0 failed
ran    new tests failed on the base
ran      and pass on the head: 2 files
calc   in scope: 11 of 11 paths
calc   as declared: 11 of 11 files
ran    bugs caught: 10 of 10
ran    same output: 29 of 29; 2 differ
ran      as the slice says
calc   debt entries: 26, before 26
ran    A refused step now reads:
ran    "The step 0 of action go asked
ran    to run the listed command leave
ran    with [] in ., but the owner does
ran    not trust the list of mode
ran    command-prober, so none of its
ran    commands or throwaway folders is
ran    granted. The owner reads the list
ran    and decides with: bay approve
ran    --trust command-prober."
judged the sentences tell the owner
judged what to do; the tests assert
judged what each item says
judged  by Claude Fable 5.2
calc   size: bay/ +110 -3, tests +397 -4
Approve: merge.
Reject: stop. forge/tr2 stays.
hash 3f9c2a71d0be
```

Notes on card 2: 1,374, 29, 2, 10 and 26 are e.g.; the sentence is the literal expectation of
`tests/cli-trust-at-use.test.ts:64-68`, cut from a run of that test's project. The same card on the kit today, with
the suite over its limit (K7), reads in place of the second line and the offer:

```
ran    checks: 5 of 5 passed
ran    tests: not known; the run did
ran      not finish in 420 seconds
Merge is not offered: 1 must item is
inconclusive.
Approve: stop. forge/tr2 stays.
Reject: stop. forge/tr2 stays.
hash 51d0aa3e9c7f
```

### What the hash binds

The hash is `hashOf` over the scrubbed `{ lines, offer }` (`bay/runs/scrubbed-store.ts:11-14`). The owner's yes is
bound to every line and to the one offer. A changed verdict changes a line, so the card goes back to waiting with
the old hash kept (`workflow-steps.ts:115-121`).

## 4. The cases

| # | Case | What the caller sees in A |
|---|---|---|
| K1 | TR2 | All proof items passed once the suite fits (K7). Card 2 as drawn; offer `merge`. The reviewer still reads items 1b and 6b and the test-asserts part |
| K2 | G2's surviving bug | The reviewer's patch is one of `bugs`. `bugs-caught` failed: "1 of 9 survived: exit code 0 with a failed test in the summary" (9 is e.g.). Offer `send back`, round 2 |
| K3 | WC changed the typescript mode's file | `in-scope` failed: "components/base/typescript/scripts/lib/commands.ts is outside the scope". Merge withheld; offer `send back`. A fresh builder cannot fix it inside the scope, so it stops (`0017` item 2); the owner rejects and the plan gains a mode slice first. The good reason costs a new card 1 |
| K4 | TR1 and WC in `CONTEXT.md` | `forge.waves` refuses the plan before anyone builds: "TR1 and WC are in one wave and share CONTEXT.md and tests/**." The words go into `CONTEXT.md` in the interface slice merged first, or the two run one after the other |
| K5 | A wrong test count | The builder's report has no field for a count (ADR 15). Proof's count is the toolchain's `passed` (`toolchain/test-response.json`). The reviewer by hand sees proof's number beside the report's; forge never reads the report's |
| K6 | The `sound` project | `checks`: inconclusive, "The checkout's package.json has no script typecheck, so it could not be started" or the npm error for no file (`typescript/scripts/lib/commands.ts:65-66`). `same-output`: inconclusive, no commands declared. `in-scope`, `as-declared`, `bugs-caught` with a hand-written test: work. Forge itself cannot run there (`activation.ts:32-35`); A does not change that |
| K7 | The suite over 420 seconds | `checks` inconclusive; merge withheld; card as drawn above. T1 raises the ceiling of `timeLimitSeconds` in `toolchain@1` to 1,800 |

## 5. Migration

Section 2 is the plan's table in this design's form, with its waves. Against the plan's table: I2 goes (the slice's
form is in I1); C1 becomes C1a, in the command line only; C2 goes (settings); T1 also moves the capture's fixtures
into `tests/fixtures/` and raises the test ceiling. Sixteen slices, eight waves, chain of eight.

| Wave | Slice | Kind | Write scope, in short | Disjoint from the rest of its wave because |
|---|---|---|---|---|
| 0 | D1 | design | `docs/designs/proof/`, one ADR | docs only |
| 0 | T1 | mode | the typescript mode, `toolchain@1`'s folder, `tests/fixtures/` | no kernel, no proof |
| 1 | I1 | interface | `proof.yaml`, `proof/`, `tests/made-up-proofs*` | interfaces folder, own test files |
| 1 | C1a | capability | `bay/run-report.ts`, `bay/commands/approve.ts`, its tests | command-line only |
| 1 | C3 | capability | `bay/runs/`, `bay/broker/command-operations.ts`, its tests | runs and one broker file |
| 2 | P1 | mode | proof's manifest, table, lib, two kinds, their tests | proof only |
| 2 | W1 | mode | `components/base/forge/` | forge only |
| 3 | P2, P3, P4, P5 | mode | one kind file and its test each | named files |
| 4 | F1 | mode | `components/base/forge/` | alone |
| 5 | F2, F3 | mode | named files of forge | named files |
| 6 | F4 | mode | `wave.yaml` and its test | alone |
| 7 | X1 | forge's job | `components/modes/todo/` and its interface | alone |

No slice's scope is a whole kernel feature except C3, which is `bay/runs/` because counting rounds is in the engine
and the plan already places it there; the plan says so (`0017` item 8).

## 6. How each property holds

| Property | How it holds in A |
|---|---|
| S1 to S7 | Unchanged. Proof's scripts are confined; its four commands are listed and recorded as `command` events (`command-operations.ts:142-152`); settings are parsed against its schema at load |
| M1 | Unchanged. Proof's settings are checked where every mode's are |
| T1 to T5 | Unchanged. Proof is a base mode, trusted by place (T5). It adds no trust path |
| V1 | One rule in proof: any inconclusive part makes the item inconclusive. The card script offers merge only on passed |
| V2 | The card script's input is proof's verdicts and the slice. The builder's `declare` output is compared, never shown; its report is not an input |
| V3 | Proof has no skill and no agent step. Bugs are written by a model, but run and judged by script |
| V4 | Proof calls the toolchain only with a folder it got from `worktrees.copy` |
| V5 | The hash covers lines and offer |
| V6 | Merge is never the offer without every must passed |
| V7 | Rounds: the workflow's `foreach` over a fixed list of two. Test runs: C3 |

What A weakens, plainly: `0017` item 9's names of a code entry are judgement, not proof. ADR 15's "choices are named
options" becomes one named offer and a reject. Running `./bay.sh` and the tests of the head runs code the builder
wrote, unconfined; the toolchain already does this and copies limit what it can reach only by convention.

## 7. What the reviewer still does, and what stays judgement

The reviewer by hand, from wave 3: writes the slice file once per brief and its bug patches; runs one command; reads
the judgement items. Judgement, labelled so on every card: whether a test asserts what its item says; whether the
sentences tell the owner what to do (P-28); whether the design is sound; which bugs are worth injecting; the
detector's count until a toolchain runs it.

## 8. What A trades away, its risks, and its counts

**Trades away.** Named choices beyond one offer: the owner cannot pick "send back" when merge is offered, or
"discard". Names of code entries in the declaration. Reading a map of modules: in a project without a map test,
boundaries are not proven. A plan form any other planner could share: the plan schema is forge's.

**Risks.** An approve that means "stop" reads oddly; owners may approve by reflex and be surprised by an offer they
did not read. Seven kinds may not cover the todo mode's real-thing proof: `same-output` compares two copies, and a
new mode has no base output to compare with, so "the real thing" for a new mode is `fails-first` on an end-to-end
test, not a run in a fresh project. Reading YAML action names with `cat` is a parser inside proof.

**Counts.** New things to learn: `proof@1` with one action, seven kinds, the slice form, the plan file, the
declaration step, card lines with an offer: 6. Files under `schemas/`: 0. Commands: 0. Kernel lines: about 30, in
the command line only (basis: `run-report.ts:94-99` is six lines; a guard for `lines` and the same in
`approve.ts:153-161`, about 25 more; tests not counted). C3 is the plan's and the same in every design. New
sentences the owner reads: 9 frame lines across the two cards and the withheld one ("Build slice …?", "Approve:
build it.", "Reject: stop. Nothing is built.", "Merge … into …?", "Approve: merge.", "Reject: stop. … stays.",
"Merge is not offered: …", "Approve: stop. … stays.", "hash …").
