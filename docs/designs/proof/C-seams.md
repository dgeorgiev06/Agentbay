# Proof, the form of a slice and a plan, and the card: design C, the seams placed for testing

Constraint: place the seams so that every kind of proof can be tested alone against a made-up toolchain and a
made-up worktrees mode; write a shared test any proof must pass; write wrong proofs that each fail one case. Read
`0-frame.md` first; its words, cases and properties are used here without repeating them.

The idea in one paragraph. Proof is split at one private seam: a part that gathers evidence by calling the
toolchain and the worktrees mode, and a part that decides a verdict from evidence alone, with no call. The second is
a pure function per kind, tested with literal evidence. The first is tested through `proof@1`'s shared test, with
the kit's made-up toolchain `tally` and made-up worktrees mode `shelf` (`tests/made-up-toolchains.ts`,
`tests/made-up-worktrees.ts`) bound in its place. A verdict carries its evidence: which commands ran, by the event
the kernel recorded for each. The plan is its own interface, `plan@1`, served by a small base mode `plan`, so waves
are tested without forge. The card is data whose every line names its source, and the kernel checks each source
against the run before it shows the card: a `ran` line against what the kernel recorded that the command printed, a
`calc` line against a script step, a `judged` line against a skill step the workflow allows to be quoted. A card
that cites a builder cannot be shown.

## 1. Proof

### The entry, as a caller uses it

`proof@1` has two actions. `kinds` lists each kind with its request schema; `judge` judges one item. The reviewer
by hand, for one item of TR2:

```
$ bay call proof.judge '{"base":"c7f0d13","head":"c9bb216","item":"DOD-TR2-1","proof":{"kind":"fails-first","tests":["tests/broker-list-trust.test.ts"]}}'
```

```json
{ "item": "DOD-TR2-1", "kind": "fails-first", "verdict": "passed",
  "evidence": [
    { "said": "the named tests on the base, with them laid over it", "verdict": "failed",
      "command": { "name": "run-tests", "event": "evt-41-0007", "stdoutHash": "5a1c…" }, "lines": ["# fail 9"] },
    { "said": "the named tests on the head", "verdict": "passed",
      "command": { "name": "run-tests", "event": "evt-41-0011", "stdoutHash": "e09b…" }, "lines": ["# pass 9"] } ] }
```

Event ids and hashes are examples. Each `lines` entry is a line the command printed, as the kernel recorded it
(section 3). For a whole slice, forge's workflow runs `judge` once per item in a `foreach`, and the plan mode's
`items` action (section 2) turns a slice into that list. The reviewer by hand does the same with one command:

```
$ bay call --workflow plan:workflows/prove.yaml '{"plan":"docs/plans/trust.yaml","slice":"TR2","base":"c7f0d13","head":"c9bb216"}'
```

The workflow is the plan mode's, not proof's: the plan mode requires `proof@1`, and proof requiring `plan@1` back
would be a cycle through bindings, which a load refuses (`bay/manifests/binding-problems.ts:168`).

### The closed set of kinds

Kinds are data. `judge` takes one, and its arguments are checked against the schema `kinds` publishes for it, in the
interface's folder (`components/base/interfaces/proof/kinds/<kind>.json`). Eight kinds, each with a pure rule:

| Kind | Evidence gathered | Rule, from evidence alone |
|---|---|---|
| `checks` | `toolchain.check` on a copy of head | passed if every check passed; inconclusive if any was; else failed |
| `tests` | `toolchain.test` on a copy of head | the toolchain's verdict; carries `passed` and `failed` counts |
| `fails-first` | `test` with the named files on a copy of base overlaid from head, then on head | passed if base failed and head passed; inconclusive if either was |
| `in-scope` | `worktrees.changed` | passed if every path, and the old path of every move, matches a pattern |
| `as-declared` | `changed`; action names of changed manifests, printed in copies | passed if the two sets are equal; the card shows only counts of declared names (V2) |
| `bugs-caught` | per bug: `apply` to its own copy, `test` with a limit | passed if every run failed; failed with each survivor; inconclusive if any run was |
| `same-output` | each declared command on copies of base and head | passed if equal but for those named to differ, which must differ |
| `count` | the listed `count-matches` command on head, and on base for `noRise` | passed if within `most`, or no more than base |

Size is gathered with every `judge` that has `base` and `head`, as evidence, and never decides (P-13).

### The seam inside, and why it is not an interface

`gather(kind, request, context)` returns evidence; `decide(kind, evidence)` returns a verdict. Only `decide` holds
V1: no rule may return passed from evidence with an inconclusive part, and a test feeds each rule every mix of
passed, failed and inconclusive parts. The seam is private to the mode (P-10: one adapter on each side, so no port).
It exists so that the rule of each kind is tested in milliseconds, and so that a reviewer reads one short file per
kind to know what passed means.

### The shared test, and the wrong proofs

`components/base/interfaces/proof/tests/shared.ts` opens a project where `toolchain@1` is bound to a `tally`
variant and `worktrees@1` to `shelf`, both of which record what they were asked. Its cases:

| # | Case | Made-up behaviour used |
|---|---|---|
| 1 | Any part inconclusive gives inconclusive, for every kind | `tally` "stops a check at its limit" |
| 2 | A test run that ran nothing is never passed | `tally` with no test files |
| 3 | `fails-first`: a test that also passes on the base is failed | a checkout whose test passes on both |
| 4 | `bugs-caught`: a survivor is named by its bug; a run stopped at its limit is inconclusive, not caught | a patch the tests miss; a patch that loops |
| 5 | `in-scope`: a move from inside the scope to outside is failed | `shelf` reports a rename |
| 6 | The toolchain is never given a folder that is not a copy proof made | `tally` records each folder it gets |
| 7 | Every copy proof made is removed, after a pass, a failure and a stop | `shelf` counts its copies |
| 8 | The base commit's slice is judged, not the head's | a head that edits its own slice file |
| 9 | Evidence names the command event of each run it cites | the run's events |
| 10 | A declared path that did not change appears in the answer, and on no card line, only as a count | a declaration with a path of free words |

A made-up proof that passes all ten lives in `tests/made-up-proofs.ts`. Wrong proofs beside it, each failing one
case: reads inconclusive as passed (1); passes an empty test run (2); passes `fails-first` on head alone (3);
counts a timed-out bug as caught (4); checks only the new path of a move (5); hands the toolchain the worktree (6);
leaves its copy when the call fails (7); reads the slice from head (8). Cases 9 and 10 have a wrong proof each too.

### What a project declares, and where

Nothing is read by proof from the project: everything a kind needs is in its request, so a test gives it there.
The project's declarations are the plan mode's settings (`schemas/config.schema.json:25-30`), and the plan mode puts
them into each item it hands out. For the kit:

```yaml
settings:
  plan:
    keep: { fixtures: tests/fixtures, bay: [[check, --project, sound], [check, --project, sound, --json]] }
    counts: { debt: { pattern: "rule:", paths: [framework/feature-map-debt.yaml] } }
```

A project that declares none: `plan.items` gives a `same-output` item no commands, and `decide` makes it
inconclusive: "The project declares no commands whose output must stay, so nothing is known." The map is held by the
project's own test, as in the kit.

### How proof reaches the toolchain and the worktrees

Copy, call, remove in `gather`, with remove on every path; held by shared cases 6 and 7. Proof reads code only as
command output in a copy (`bay/policy.ts:333-350`). Listed commands: `print` (`cat --`), `count-lines` (`wc -l --`),
`count-matches` (`grep -r -c -e`), `bay` (`./bay.sh`). No git.

### Behind the entry, and the feature map

Behind `judge`: the copy lifecycle, eight gatherers, eight rules, the evidence's event references. Deleted, each
caller repeats them and each decides V1 again. The feature map: two modes (`proof`, `plan`) and two interfaces
(`proof@1`, `plan@1`), all under their patterns. Runs gains the card check inside its folder; broker records one
more field per command event (section 3).

## 2. The form of a slice and a plan

### `plan@1`, and the plan mode

The form is an interface, so any planner (forge's plan stage, a later improve mode, a person with an editor) writes
the same file and one mode checks it. Its folder holds `slice.json` and `plan.json`. The base mode `plan` implements
three actions: `check` (a plan or one slice; each problem a sentence with its line), `waves`, and `items` (one
slice's items, each with its project declarations filled in, ready for `proof.judge`). `check` calls `proof.kinds`
and checks every item's arguments against its kind's schema, so the plan and proof agree on kinds without a copy of
any schema (P-12).

The shared test of `plan@1` gives plans that must be refused (a cycle; two slices in one wave sharing a path by
pattern, such as `tests/**` and `tests/a.ts`; a capability slice whose scope is outside its feature; every slice
waiting with no reason) and plans whose waves and chain are literal. Wrong planners fail one each: one compares
scopes as strings, not patterns; one counts the chain in edges.

### A slice: TR2

```yaml
id: TR2
title: The broker says why a list is not in force, and reads the record again before each command
kind: capability
feature: broker
scope: [bay/broker/**, tests/broker-list-trust.test.ts, tests/cli-trust-at-use.test.ts,
        tests/script-commands.test.ts, tests/shared-tests-in-a-project.test.ts, tests/system-fixture.ts,
        framework/features.yaml]
after: [{ slice: TR1, because: ModeGrants.listTrust and readTrustRecord, which the broker reads }]
against: none
done:
  - { item: DOD-TR2-1, level: must, says: Each of three states refuses a command and each throwaway operation with its literal sentence,
      proof: { kind: fails-first, tests: [tests/broker-list-trust.test.ts] } }
  - { item: DOD-TR2-1b, level: must, says: The sentences say what the owner does, beside the design's, judgement: sentences }
  - { item: DOD-TR2-2, level: must, says: One function decides; reachOf is the only other reader,
      proof: { kind: count, pattern: listTrust.state, paths: [bay/broker/], most: 2 } }
  - { item: DOD-TR2-3, level: must, says: A run loaded with trust is refused once the record changes; the command never starts,
      proof: { kind: fails-first, tests: [tests/broker-list-trust.test.ts] } }
  - { item: DOD-TR2-4, level: must, says: bay call runs a trusted project mode's command and is refused once trust is withdrawn,
      proof: { kind: fails-first, tests: [tests/cli-trust-at-use.test.ts] } }
  - { item: DOD-TR2-5, level: must, says: Nothing changes for the kit but where a fixture's project mode lists a command,
      proof: { kind: same-output, differ: [grants-check, grants-check-json] } }
  - { item: DOD-TR2-6, level: must, says: Neither list of known breaks grows, proof: { kind: count, use: debt } }
  - { item: DOD-TR2-6b, level: must, says: The detector's count does not rise, judgement: detector }
  - { item: DOD-TR2-7, level: must, says: Every listed bug is caught, proof: { kind: bugs-caught } }
  - { item: DOD-TR2-8a, level: must, says: The checks pass, proof: { kind: checks } }
  - { item: DOD-TR2-8b, level: must, says: The tests pass, proof: { kind: tests } }
```

A judgement item names what is judged; the workflow names which skill judges it. The declaration is the output of a
`declare` skill step before the build step, as in the other two designs; the three agree on this and on leaving
names of code entries to judgement.

### A plan: 0022 in the form

The same slices as the plan's table, with scopes as paths, in `docs/plans/0022-forge-in-waves.yaml`. Against the
table: I1 is `proof@1` with its shared test and wrong proofs; I2 is `plan@1` with its own; W1 becomes PL1, the plan
mode; C1 is split by feature into C1r (runs), C1e (broker) and C1p (command line); C2 goes, since the plan mode's
settings carry the declarations. `bay call plan.waves '{"plan":"docs/plans/0022-forge-in-waves.yaml"}'` (worked out
by hand, as the script would):

```
19 slices, 8 waves. Longest chain, 8:
D1, I1, P1, P2, F1, F2, F4, X1.
wave 0  D1 T1
wave 1  I1 I2 C1r C1e
wave 2  C1p C3 P1 PL1
wave 3  P2 P3 P4 P5
wave 4  F1
wave 5  F2 F3
wave 6  F4
wave 7  X1
C3 is put after C1r and C1e: it
shares bay/runs/ with one and
command-operations.ts with the other.
```

### Where the form lives, and its cost

In `components/base/interfaces/plan/`, beside `proof/`. No file under `schemas/`: `concepts` stays 5. The cost: a
second interface and a second base mode, whose only implementation is in the kit, and a shared test for each.

## 3. The card

### What an approval holds

The workflow names the choices, when each is offered, and which skill steps a card may quote:

```yaml
- id: merge-card
  approval: Merge this slice?
  show: $steps.draw.output
  choices:
    merge: { when: $steps.offer.output.merge }
    send-back: { when: $steps.offer.output.sendBack }
    keep: {}
    discard: {}
  quotes: [review, plan]
```

`offer` is a script of proof, `offer(verdicts, round)`, pure and tested with the rules. `draw` is a forge script that
lays out the lines. The shown content is `{ title, lines: [{ mark, words, source }], withheld: { choice: reason } }`.
Each `source` is one of: `{ event }` for `ran`, a command event of this run or a run it called; `{ step }` for
`calc`, a step whose action runs only scripts; `{ step }` for `judged`, a skill step named in `quotes`.

### What the kernel checks before it shows a card

- A `ran` line's words, less the margin, are a line the cited command printed. For this, the broker keeps in the
  command event the scrubbed end of what the command printed, as the script was given it
  (`bay/broker/command-operations.ts:127-133`), beside the hashes it keeps today (`:142-152`). A script cannot write
  a `command` event (`bay/broker/other-operations.ts:27`).
- A `calc` line's step ran no skill. A `judged` line's step is listed in `quotes`; the build skill never is. The
  kernel adds the model's name from the project's tier for that skill.
- Every choice whose `when` is false is withheld, and its reason must be given. A withheld choice is refused with
  the reason.

A card that fails a check is not shown; the step fails with the line that broke the rule, which forge's tests then
catch. The command line prints the lines as they are, with the kernel's own last line: how many lines it checked of
each mark.

### The two cards for TR2

Numbers marked `e.g.` in these notes are examples; the rest come from TR2's commits and tests. Card 1, before the
build:

```
Build slice TR2?
judged The broker says why a list is
judged not in force, and reads the
judged record again before each command.
calc   kind capability, feature broker
calc   scope bay/broker/** and 6 files
calc   after TR1: the record it reads
calc   beside TR3: no path shared
calc   11 must items: 9 by proof, 2 by
calc     judgement
judged When a list is not trusted,
judged bay call will print:
judged "… but the owner does not trust
judged the list of mode command-
judged prober, so none of its commands
judged or throwaway folders is
judged granted. The owner reads the
judged list and decides with: bay
judged approve --trust command-prober."
judged  by Claude Fable 5.2, plan
Choose one:
  build  Build it
  stop   Stop; nothing is built
checked: 0 ran, 6 calc, 12 judged
hash 9c41e07b52aa
```

Card 2, the merge, round 1:

```
Merge TR2 into feat/0022-agentbay5?
calc   round 1 of 2, 11 files changed
calc   checks: 5 of 5 passed
ran    # pass 1374
ran    # fail 0
calc   new tests failed on the base,
calc     pass on the head: 2 files
calc   in scope: 11 of 11 paths
calc   as declared: 11 of 11 files
calc   bugs caught: 10 of 10
calc   same output: 29 of 29; 2 differ
calc     as the slice says
ran    framework/feature-map-debt.yaml:26
calc   known breaks: 26, before 26
ran    The step 0 of action go asked to
ran    run the listed command leave
ran    with [] in ., but the owner does
ran    not trust the list of mode
ran    command-prober, so none of its
ran    commands or throwaway folders is
ran    granted. The owner reads the list
ran    and decides with: bay approve
ran    --trust command-prober.
judged the sentences tell the owner
judged what to do; the tests assert
judged what each item says
judged  by Claude Fable 5.2, review
calc   size: bay/ +110 -3, tests +397 -4
Choose one:
  merge      Merge into
             feat/0022-agentbay5
  send-back  Round 2, a fresh builder
  keep       Stop; forge/tr2 stays
  discard    Stop; forge/tr2 is removed
checked: 12 ran, 11 calc, 4 judged
hash 3f9c2a71d0be
```

1374, 29, 2, 10 and 26 are e.g. The `ran` lines are words as the commands printed them: TAP's summary
(`components/base/typescript/scripts/lib/tap.ts`) and the line `grep -r -c` prints for the debt list. Where a `ran` line is wrapped,
the kernel checks the joined words. A withheld choice reads:

```
  merge      not offered: 1 must item
             is inconclusive
```

### What the hash binds

The scrubbed content: title, lines with marks and sources, and the withheld reasons. The choices and `quotes` are
fixed by the workflow file. The kernel's own "checked" line is drawn after the hash is taken and is not part of it.

## 4. The cases

| # | Case | What the caller sees in C |
|---|---|---|
| K1 | TR2 | Eleven verdicts passed and two judgement items; the cards as drawn; `merge` offered |
| K2 | G2's surviving bug | `bugs-caught` failed; evidence: the patch's name and the test run's event, whose summary shows `# fail 0`. Card: `ran  # fail 0` under `calc  survived: 1 of 9` and the bug's name as `judged` (the reviewer wrote it). `merge` withheld; `send-back` offered |
| K3 | WC and the typescript mode's file | `in-scope` failed, the path in the evidence and on the card as `calc`. `merge` withheld. As in A and B, the reason a builder had is not shown; the owner chooses `keep` and the plan gains a mode slice |
| K4 | TR1 and WC in `CONTEXT.md` | `plan.check` refuses: "TR1 and WC are in one wave and both may change CONTEXT.md." The case is in `plan@1`'s shared test, with patterns, so a planner that compares strings fails it |
| K5 | A wrong test count | The count on the card is a `ran` line, TAP's `# pass` line as the test command printed it, checked by the kernel against the recorded output. No builder's number reaches anything |
| K6 | The `sound` project | `checks` and `tests` inconclusive (no `package.json` scripts, `typescript/scripts/lib/commands.ts:65-66`); `same-output` inconclusive (no declarations); the rest give verdicts. Forge is not active there (`activation.ts:32-35`); C leaves that to the slice that makes forge leave the kit |
| K7 | The suite over 420 seconds | `tests` inconclusive, from `tally`'s "stops at its limit" behaviour in the shared test and from the real run alike. T1 raises `timeLimitSeconds`' ceiling to 1,800 |

## 5. Migration

| Wave | Slice | Kind | Write scope | Disjoint because |
|---|---|---|---|---|
| 0 | D1 | D | `docs/designs/proof/`, one ADR | docs |
| 0 | T1 | M | the typescript mode, `toolchain@1`'s folder, `tests/fixtures/` | no kernel |
| 1 | I1 | I | `components/base/interfaces/proof.yaml`, `proof/`, `tests/made-up-proofs*`, `tests/recording-modes.ts` | own files; the recording variants in a new file, not in `made-up-toolchains.ts` |
| 1 | I2 | I | `components/base/interfaces/plan.yaml`, `plan/`, `tests/made-up-plans*` | own files |
| 1 | C1r | C, runs | `bay/runs/**`, `schemas/workflow.schema.json`, `bay/generated/workflow.ts`, `tests/runs-cards*` | runs |
| 1 | C1e | C, broker | `bay/broker/command-operations.ts`, `tests/command-events*` | one broker file |
| 2 | C1p | C, command-line | `bay/run-report.ts`, `bay/commands/approve.ts`, `tests/run-report-cards*` | command line |
| 2 | C3 | C, runs | `bay/runs/**`, `bay/broker/command-operations.ts` | after C1r and C1e |
| 2 | P1 | M | `components/base/proof/**` | proof |
| 2 | PL1 | M | `components/base/plan/**` | plan |
| 3 | P2, P3, P4, P5 | M | one gatherer, one rule and their tests each, by file | named files |
| 4 | F1 | M | `components/base/forge/**` | alone |
| 5 | F2, F3 | M | named files of forge | named files |
| 6 | F4 | M | forge's wave workflow and its test | alone |
| 7 | X1 | forge's job | `components/modes/todo/` | alone |

`bay/runs/**` is a whole feature for C1r and C3; both change how the engine settles a step, and they run one after
the other (`0017` item 8).

## 6. How each property holds

| Property | How it holds in C |
|---|---|
| S1 to S7 | Unchanged, with one addition to S5: a command event holds the scrubbed end of what was printed (S6 holds: scrubbed as the script's copy is) |
| M1 | Unchanged |
| T1 to T5 | Unchanged |
| V1 | In `decide` only; shared case 1 for every kind; wrong proof 1 |
| V2 | The kernel refuses a card line whose source is a skill not in `quotes`; shared case 10 for declared names |
| V3 | Proof and plan have no skill step |
| V4 | Shared case 6; wrong proof 6 |
| V5 | The hash covers lines, sources and reasons; choices and quotes are in the workflow file |
| V6 | `merge`'s `when` comes from `offer`, a pure function with its own tests; the kernel withholds it |
| V7 | C3 |

## 7. What the reviewer still does, and what stays judgement

By hand, from wave 3: writes slices in `plan@1`'s form and its bugs; runs `plan:workflows/prove.yaml`; reads the
judgement items. A reviewer of a new kind reads one rule file and its shared case. Judgement, quoted only from the
skills a workflow lists: whether a test asserts what its item says; the owner's sentences; the design; which bugs to
inject; the detector's count.

## 8. What C trades away, its risks, and its counts

**Trades away.** Size: two modes and two interfaces where A has one of each; four kernel slices. The reviewer runs a
workflow, not one call. The card's lines are plainer: `ran` lines must be words a command printed, so "checks: 5
of 5 passed" is `calc`, and "1,374 passed" is written as TAP prints it.

**Risks.** Keeping printed output in events makes the database larger: a test run prints thousands of lines, and the
kept end is cut at the broker's limit (`commandOutputCharacters`), so a `ran` line from early output cannot be
checked and must be `calc`. The check of `ran` words is a text search; a short line ("26") can be found by chance
in a long output. Two shared tests and ten wrong proofs are about 1,200 lines of tests before proof does anything
(estimated from `components/base/interfaces/worktrees/tests/shared.ts`, 981 lines).

**Counts.** New things to learn: `proof@1` (`kinds`, `judge`), eight kinds with schemas, the evidence's event
reference, `plan@1` and the plan mode, card sources and `quotes`, `when` on a choice: 6. Files under `schemas/`: 0.
Commands: 0; `bay approve` gains `--choice`. Kernel lines, estimated: C1r about 200 (choices, `when`, `quotes`, the
source checks; basis: today's approval code is 54 lines in `workflow-steps.ts:99-152`, and each check is a lookup in
the run's records), C1e about 20 (two fields in one event), C1p about 60 (print lines, the checked line, `--choice`):
about 280. New sentences the owner reads: two titles, "Choose one:", six choice lines, the withheld reason, the
refusal of a withheld choice, the "checked:" line, the hash: 12.
