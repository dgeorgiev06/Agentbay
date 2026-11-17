# Proof, the form of a slice and a plan, and the card: design B, from the commonest caller

Constraint: fit the two callers that come most often. The first is a line in a brief: a definition-of-done item
that names a kind of proof. The second is the owner, reading a card on a phone and tapping a choice. Read
`0-frame.md` first; its words, cases and properties are used here without repeating them.

The idea in one paragraph. A brief stays what builders, the reviewer and the owner already read: seven sections in
Markdown. It gains a short front matter, as a `SKILL.md` has, with its kind, scope and order, and each item of its
definition of done ends with the kind that proves it, in words. Proof reads the brief itself, so the reviewer types
one line and a workflow passes one path. Each kind is an action of its own, with a typed request, so a caller that
needs one verdict calls one action. A plan stays a Markdown table, made strict enough for a script. What a project
declares (its map, its practices, its commands whose output must stay) goes in one section of the config that every
mode can read, because proof, the builder's task and forge's plan stage all need it. The card is drawn by the kernel
from data, 44 columns wide like the trust card, with named choices; a choice may be shown as not offered, with its
reason, and the kernel refuses it.

## 1. Proof

### The entry, as a caller uses it

The reviewer by hand, with TR2's brief and branch:

```
$ bay call proof.brief '{"brief":"docs/briefs/TR2-the-broker-and-a-list-not-in-force.md","base":"c7f0d13","head":"c9bb216"}'
```

The brief is read from the base commit, so a builder cannot change the items it is judged by. The answer holds a
verdict per item, the declaration's verdict, the sizes, and the merge card's data, so the reviewer sees what the
owner would. Numbers marked `e.g.` are examples:

```json
{ "items": [
    { "item": "DOD-TR2-1", "level": "must", "kind": "fails-first", "verdict": "passed",
      "detail": "tests/broker-list-trust.test.ts failed on the base and passes on the head" },
    { "item": "DOD-TR2-2", "level": "must", "kind": "count", "verdict": "passed",
      "detail": "listTrust.state in bay/broker/: 2, at most 2" },
    { "item": "DOD-TR2-6", "level": "must", "kind": "map-holds", "verdict": "passed",
      "detail": "known breaks 26 before, 26 after (e.g.); every new file in the map" },
    { "item": "DOD-TR2-8", "level": "must", "kind": "tests-pass", "verdict": "passed",
      "detail": "1,374 passed in 3 parts (e.g.)" } ],
  "scope": { "verdict": "passed", "outside": [] },
  "declared": { "verdict": "inconclusive", "reason": "No declaration was given, so nothing is known." },
  "size": [ { "path": "bay/broker/list-in-force.ts", "base": 0, "head": 91 } ],
  "card": { "title": "Merge TR2 into feat/0022-agentbay5?", "lines": [], "choices": [] } }
```

The call gave no `declared`, so that verdict is inconclusive; forge passes the builder's declaration from its run.

One kind alone, as forge's workflow or a skill step's check calls it:

```
$ bay call proof.fails-first '{"base":"c7f0d13","head":"c9bb216","tests":["tests/broker-list-trust.test.ts"]}'
{ "verdict": "passed", "base": { "verdict": "failed", "failed": 9 }, "head": { "verdict": "passed", "passed": 9 } }
```

`bay actions proof` lists every kind with its one-sentence description, so a skill finds the kind it needs the way
it finds any action (ADR 12).

### The closed set of kinds

Kinds are actions of `proof@1`, each with its own request and verdict schema in the interface's folder. Ten, named
as briefs already name them:

| Kind | Request | Passed when |
|---|---|---|
| `checks-pass` | `head`, optional `checks` | Every named check passed on a copy of head |
| `tests-pass` | `head`, optional `files` | Every test passed. Run in parts that each fit the time limit: on a time-out the part is halved, at most twice. Carries the count |
| `fails-first` | `base`, `head`, `tests` | The named tests fail on a copy of the base with them laid over it (`worktrees.overlay`), and pass on head |
| `in-scope` | `base`, `head`, `scope` | Every changed path matches a pattern |
| `as-declared` | `base`, `head`, `declared` | Changed files equal declared files; changed action names of manifests and interfaces equal declared names |
| `bugs-caught` | `head`, `bugs`, `seconds` | Each patch, applied to its own copy, makes the tests fail |
| `same-output` | `base`, `head`, `differ` | Each command the project declares prints the same on base and head, except those named, which must differ |
| `real-thing` | `head`, `commands`, `expect` | Each command, run in a fresh copy of a fixture project, prints the expected text and exit code |
| `map-holds` | `base`, `head` | The project's known breaks did not grow, and every new file of a module is in the map |
| `count` | `head`, `pattern`, `paths`, `most` or `base` | The count is at most `most`, or no more than at the base |

Plus one action that is not a kind, `brief`, which reads a brief, calls each item's kind, and draws the merge card's
data. Size is in `brief`'s answer and never a verdict (P-13). An item marked `proof: judgement` is not proof's; the
card shows it as judgement.

`real-thing` is what `same-output` cannot be for a new mode, which has no output at the base to compare with: the
brief writes the expected output, and proof compares literal text (P-16).

### What a project declares, and where

One section of `agentbay.config.yaml`, `project:`, checked against the config schema and handed to every mode's
scripts as `context.project` (slice C2). For the kit:

```yaml
project:
  map: { modules: framework/features.yaml, breaks: framework/feature-map-debt.yaml }
  practices: [framework/practices.md]
  keep:
    fixtures: tests/fixtures
    bay:
      - [check, --project, sound]
      - [check, --project, sound, --json]
      - [new, mode, alpha, --project, newtext]
```

Why the config and not proof's settings: three readers need it. Proof reads the map and the commands to keep. The
builder's task names the practices files by path (`0018`, "a builder is given them by path"). Forge's plan stage
reads the map to propose scopes. One place (P-12). The toolchain's own practices file still comes from
`toolchain.describe`.

A project that declares nothing: `map-holds` and `same-output` are inconclusive with one sentence each ("This project
declares no map of modules, so nothing is known about its boundaries."), and card 1 says so before anything is built
(`0018`, cost).

### How proof reaches the toolchain and the worktrees

Copy, call, remove, with remove on every path (`docs/designs/forge/calling-a-toolchain.md`). Proof reads files only
as command output in a copy, because no mode may hold a read path over `.forge/copies/` (`bay/policy.ts:333-350`).
Its listed commands: `print` (`cat --`), `count-lines` (`wc -l --`), `count-matches` (`grep -r -c -e`), and `bay`
(`./bay.sh`), read except `bay`, which writes in its copy. No git.

### Behind the entry

Parsing a brief and refusing a malformed item with the line it is on; the copy lifecycle; splitting a test run to
fit the limit; overlaying tests on the base; one copy per bug; reading a map's breaks; comparing output; one rule
for V1; drawing the merge card's data and computing which choices are offered. Deleted, forge would parse briefs
and the reviewer would keep doing the rest by hand.

### The feature map afterwards

Proof is a mode and `proof@1` an interface, covered by the patterns (`framework/features.yaml:243-258`). C2 adds
`project` to what manifests reads from the config and to the toolbox's surface (`bay/sdk.ts:80-110`), which the
toolbox's pinning test then names. C1 adds to runs and command-line, inside their folders. No new feature and no
new entry file.

## 2. The form of a slice and a plan

### A slice is a brief

Front matter, then the seven sections as `docs/briefs/TEMPLATE.md` has them. The front matter's schema is
`components/base/interfaces/proof/brief.json`, since `proof.brief` is what reads it. Each item of the definition of
done ends with its proof in backticks. TR2 in the form; the seven sections are TR2's as they are, so only the
front matter and the definition of done are shown:

```markdown
---
slice: TR2
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
  TR1: ModeGrants.listTrust and readTrustRecord, which the broker reads
against: none
---

## Definition of done

- [DOD-TR2-1] (must) A command and each throwaway operation, in each of three states, is refused with its literal
  sentence. `proof: fails-first tests/broker-list-trust.test.ts`
- [DOD-TR2-1b] (must) The sentences say what the owner does, beside the design's. `proof: judgement`
- [DOD-TR2-2] (must) One function decides; `reachOf` is the only other reader of `listTrust.state`.
  `proof: count "listTrust.state" bay/broker/ most 2`
- [DOD-TR2-3] (must) A run loaded with trust is refused once the record changes; the command never starts.
  `proof: fails-first tests/broker-list-trust.test.ts`
- [DOD-TR2-4] (must) `bay call` runs a trusted project mode's command, and is refused once trust is withdrawn.
  `proof: real-thing tr2-withdrawn`
- [DOD-TR2-5] (must) Nothing changes for the kit but where a fixture's project mode lists a command.
  `proof: same-output differ grants-check grants-check-json`
- [DOD-TR2-6] (must) No feature's private file is reached from outside; neither list of known breaks grows.
  `proof: map-holds`
- [DOD-TR2-6b] (must) The copy-paste detector's count does not rise. `proof: judgement`
- [DOD-TR2-7] (must) Each bug of the list below is caught. `proof: bugs-caught`
- [DOD-TR2-8] (must) The checks and the tests pass. `proof: checks-pass` `proof: tests-pass`
```

`tr2-withdrawn` names a block under the brief's Tools section: the commands, in a copy of a fixture project, and
the expected output, literal. For TR2 it is the sentence of `tests/cli-trust-at-use.test.ts:64-68`. The bugs are a
list under Tools too, each a patch, written by the planner or the reviewer.

`proof.brief` refuses a brief whose must item has no `proof:`, whose `count` has neither `most` nor `base`, whose
`real-thing` names no block, or whose scope does not name the slice's feature when its kind is capability
(`0017` item 1), each with the line it is on.

**The declaration** is the builder's first skill output, before the build step, as in any design that records it in
the run; a builder working by hand writes it to the progress note and the reviewer passes it in `declared`. Names of
a code entry stay judgement, as in A: proof names no language.

### A plan is a Markdown table

The table of `docs/plans/0022-forge-in-waves.md:47-62` is already nearly the form. Made strict: the columns are `#`,
`Slice`, `Kind`, `Write scope`, `After`, `Because`; a scope cell holds only paths and patterns in backticks; `After`
holds ids; `Because` one reason per id, in the same order. Below it, a section `## Waves` that the script writes and
then checks: a plan whose own Waves section differs from what the script works out is refused.

The plan's table in this form, rows whose scope was prose rewritten as paths (rows not shown are as in the plan):

| # | Slice | Kind | Write scope | After | Because |
|---|---|---|---|---|---|
| I1 | `proof@1`: ten kinds and `brief` | I | `components/base/interfaces/proof.yaml`, `components/base/interfaces/proof/*-request.json`, `components/base/interfaces/proof/*-response.json`, `tests/made-up-proofs*` | D1 | the chosen interface |
| I2 | The brief's form | I | `components/base/interfaces/proof/brief.json`, `components/base/interfaces/proof/tests/brief.ts` | D1 | the chosen form |
| C1r | Approvals with choices, in runs | C | `bay/runs/**`, `schemas/workflow.schema.json`, `bay/generated/workflow.ts`, `tests/runs-choices*` | D1 | the chosen card |
| C1c | The card drawn, and `--choice` | C | `bay/run-card.ts`, `bay/run-report.ts`, `bay/commands/approve.ts`, `tests/run-card*` | C1r | the choices it draws |
| C2 | `project:` in the config | C | `schemas/config.schema.json`, `bay/generated/config.ts`, `bay/manifests/**`, `bay/sdk.ts`, `tests/project-declares*` | D1 | what proof reads |
| P1 | `checks-pass`, `tests-pass`, `fails-first`; the folder | M | `components/base/proof/**` | I1 | the interface |
| P2 | `in-scope`, `as-declared`, `brief` | M | `components/base/proof/scripts/{in-scope,as-declared,brief}.ts`, `components/base/proof/tests/{in-scope,as-declared,brief}.test.ts` | P1, I2 | the folder; the form |
| P4 | `same-output`, `real-thing` | M | `components/base/proof/scripts/{same-output,real-thing}.ts`, their tests | P1, C2 | the folder; what to keep |
| P5 | `map-holds`, `count` | M | `components/base/proof/scripts/{map-holds,count}.ts`, their tests | P1, C2 | the folder; the map |

P1 writes every action of the manifest with a script that answers inconclusive, "This kind is not built yet", so
the later kind slices change only their own files. C3 cannot run beside C1r: both are in `bay/runs/`.

`bay call forge.waves '{"plan":"docs/plans/0022-forge-in-waves.md"}'` then writes the Waves section (worked out by
hand here, as the script would):

```
19 slices, 8 waves. Longest chain, 8:
D1, I1, P1, P2, F1, F2, F4, X1.
wave 0  D1 T1
wave 1  I1 I2 C1r C2
wave 2  C1c C3 P1 W1
wave 3  P2 P3 P4 P5
wave 4  F1
wave 5  F2 F3
wave 6  F4
wave 7  X1
Refused as the plan was written: F2 and
F3 share components/base/forge/ in one
wave (plan lines 52, 53, 66).
```

### Where the form lives, and its cost

The brief's front matter in `proof@1`'s folder; the plan's rules in forge's `waves` script. No file under
`schemas/`: `concepts` stays 5. The cost: a Markdown parser in proof and another in forge, each with its own
refusals; a plan's prose and its table can disagree in ways the script does not see.

## 3. The card

### What an approval holds

An approval step names its choices in the workflow file, so the set is fixed where it can be reviewed:

```yaml
- id: merge-card
  approval: Merge this slice?
  show: $steps.prove.output.card
  choices: [merge, send-back, keep, discard]
```

The shown content has the card's shape: a title, lines each with a mark and words, and for each choice its words
or the reason it is withheld. The kernel checks the shape when the step starts and refuses a step whose content
names a choice the workflow does not list. The kernel draws it: words wrapped at 44 columns after a seven-column
margin for the mark, as `bay/trust-card.ts:48` wraps the trust card. `bay runs` and `bay approve` print the drawing,
never the JSON. The owner answers with `bay approve <run> <step> --hash <h> --choice merge`, or from chat with
`--via chat --quote "<his words>"`, where the quote must name the choice. The step's output is
`{ choice, content }`, so the next step reads `$steps.merge-card.output.choice`. A withheld choice is refused:
"merge is not offered on this card: 1 must item is inconclusive. Choose send-back, keep or discard." `--reject`
stays, and means the same as a choice named `stop` where one is listed.

### How a script withholds a choice

`proof.brief` computes the choices from its verdicts, and nothing else does. `merge` is offered when every must item
passed, `in-scope` passed and the declaration passed. `send-back` is offered while a round is left. `keep` and
`discard` are always offered. A withheld choice keeps its line, with its reason in place of its words, so the owner
sees what he cannot do and why.

### The two cards for TR2

Numbers marked `e.g.` in these notes are examples; the rest come from TR2's commits and tests. Card 1, before the
build. `proof.brief` without a head checks the brief's form and draws it. The `judged` lines are the brief's own
words, written by the reviewer, Claude Fable 5.2.

```
Build slice TR2?
judged The broker says why a list is
judged not in force, and reads the
judged record again before each command.
calc   kind capability, feature broker
calc   scope bay/broker/** and 6 files
calc   after TR1: the record it reads
calc   beside TR3: no path shared
calc   10 must items: 8 by proof,
calc     2 by judgement
calc   the project declares a map,
calc     practices, 3 outputs to keep
judged When a list is not trusted,
judged bay call will print:
judged "… but the owner does not trust
judged the list of mode command-
judged prober, so none of its commands
judged or throwaway folders is
judged granted. The owner reads the
judged list and decides with: bay
judged approve --trust command-prober."
judged  by Claude Fable 5.2

Choose one:
  build  Build it
  stop   Stop; nothing is built
hash 9c41e07b52aa
```

Card 2, the merge, round 1:

```
Merge TR2 into feat/0022-agentbay5?
calc   round 1 of 2, 11 files changed
ran    checks: 5 of 5 passed
ran    tests: 1,374 passed, 0 failed,
ran      in 3 parts
ran    new tests failed on the base,
ran      pass on the head: 2 files
calc   in scope: 11 of 11 paths
calc   as declared: 11 of 11 files
ran    bugs caught: 10 of 10
ran    same output: 29 of 29; 2 differ
ran      as the brief says
calc   known breaks: 26, before 26
ran    bay call printed, as expected:
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

Choose one:
  merge      Merge into
             feat/0022-agentbay5
  send-back  Round 2, a fresh builder
  keep       Stop; forge/tr2 stays
  discard    Stop; forge/tr2 is removed
hash 3f9c2a71d0be
```

1,374, 3, 29, 2, 10 and 26 are e.g. The same card with one inconclusive item shows, in place of the merge choice:

```
  merge      not offered: 1 must item
             is inconclusive
```

### What the hash binds

`hashOf` over the scrubbed card data: title, every line with its mark, and every choice with its words or its
reason. The choices listed in the workflow are part of the step, not of the content, and are fixed by the workflow
file. A changed verdict, line or reason sends the step back to waiting (`bay/runs/workflow-steps.ts:115-121`).

## 4. The cases

| # | Case | What the caller sees in B |
|---|---|---|
| K1 | TR2 | Every proof item passed; the cards as drawn; `merge` offered. The reviewer by hand reads the same card data from `proof.brief` |
| K2 | G2's surviving bug | `bugs-caught` failed: "1 of 9 survived: exit code 0 with a failed test in the summary" (9 is e.g.). Merge withheld; `send-back` offered with the survivor as the finding for round 2 |
| K3 | WC and the typescript mode's file | `in-scope` failed: "1 path outside the scope: components/base/typescript/scripts/lib/commands.ts (2 lines)". Merge withheld. The owner reads the path, not the builder's reason, and chooses `keep`; the plan gains a mode slice first. B shows the path and the size of the change; it cannot show why |
| K4 | TR1 and WC in `CONTEXT.md` | `forge.waves` refuses the plan: "TR1 and WC are in wave 1 and share CONTEXT.md and tests/**." With the form, `tests/**` is not a scope; each slice names its test files |
| K5 | A wrong test count | `tests-pass` carries the count the toolchain gave. A brief has no field where a builder states one; forge never reads the builder's report. By hand, the reviewer compares the report with `proof.brief`'s answer |
| K6 | The `sound` project | Card 1 says: "this project declares no map, no practices, no outputs to keep: 8 of 10 kinds can give a verdict here". `checks-pass` and `tests-pass` are inconclusive: the typescript mode finds no `package.json` scripts (`typescript/scripts/lib/commands.ts:65-66`). Forge is not active outside the kit (`activation.ts:32-35`); B leaves that to T1's successor |
| K7 | The suite over 420 seconds | `tests-pass` runs in parts; a part that times out is halved, at most twice. The kit's suite passes in three or four parts. A single test file over 420 seconds stays inconclusive |

## 5. Migration

| Wave | Slices | Kind | Write scope | Disjoint because |
|---|---|---|---|---|
| 0 | D1, T1 | D, M | docs; typescript mode, `toolchain@1`'s folder, `tests/fixtures/` | different trees |
| 1 | I1, I2 | I | interface files named per slice in section 2 | named files |
| 1 | C1r | C, runs | `bay/runs/**`, the workflow schema and its type | runs only |
| 1 | C2 | C, manifests | config schema and type, `bay/manifests/**`, `bay/sdk.ts` | three places, one reason; see below |
| 2 | C1c | C, command-line | `bay/run-card.ts`, `run-report.ts`, `commands/approve.ts` | command-line only |
| 2 | C3 | C, runs | `bay/runs/**`, `bay/broker/command-operations.ts` | after C1r |
| 2 | P1, W1 | M | `components/base/proof/**`; `components/base/forge/**` | different modes |
| 3 | P2, P3, P4, P5 | M | named script and test files of proof | named files |
| 4 | F1 | M | `components/base/forge/**` | alone |
| 5 | F2, F3 | M | named files of forge | named files |
| 6 | F4 | M | `components/base/forge/workflows/wave.yaml` and its test | alone |
| 7 | X1 | forge's job | `components/modes/todo/` | alone |

C2 touches the config schema (vocabulary), manifests and the toolbox. It is one capability that a caller sees in
one place, `context.project`; splitting it would leave a field nobody reads. The plan says why (`0017` item 8).
`bay/runs/**` is a whole feature for C1r and C3 because both change the engine's handling of a step; they run one
after the other.

## 6. How each property holds

| Property | How it holds in B |
|---|---|
| S1 to S7 | Unchanged. `context.project` is parsed with the config at load (S7) |
| M1 | The `project:` section is checked where the config is, so `bay check` and a load agree |
| T1 to T5 | Unchanged |
| V1 | One rule in proof; `merge` is computed only from passed verdicts |
| V2 | The card is `proof.brief`'s output. Its inputs are the brief at the base commit, the commits, and verdicts. The workflow passes it unchanged; that is held by review of forge's workflow file, not by the kernel |
| V3 | Proof has no skill step |
| V4 | Proof gives the toolchain only folders from `worktrees.copy` |
| V5 | The hash covers lines, marks and each choice's words or reason; the set of choices is in the workflow file |
| V6 | The kernel refuses a withheld choice |
| V7 | C3, as planned |

## 7. What the reviewer still does, and what stays judgement

By hand, from wave 3: writes briefs in the form, with each item's proof and the bug list; runs `proof.brief`;
reads the judgement items. Judgement, marked on every card: whether a test asserts what its item says; whether
sentences tell the owner what to do (P-28); the design; which bugs to inject; whether a path outside the scope had a
good reason (K3); the detector's count.

## 8. What B trades away, its risks, and its counts

**Trades away.** Kernel size: three capability slices where A has one. The plan's format stays prose-shaped, so a
script parses Markdown in two places. Kinds as actions make `proof@1` wide: eleven actions and 22 schema files.

**Risks.** Splitting the suite can hide a test that passes only with another file run first, or fail one that
needs a file run before it. Easy approval invites reflex: a phone and a recommended-looking first choice is the
failure `docs/designs/forge/B-owner.md` warned of. A card drawn by the kernel is still copied into chat by the
coordinator, a model; the kernel cannot see what the owner's phone shows.

**Counts.** New things to learn: `proof@1` with ten kinds and `brief`, the brief's front matter and `proof:`
suffix, the strict plan table, `project:` in the config, `context.project`, choices on an approval, `--choice`: 7.
Files under `schemas/`: 0. Commands: 0; `bay approve` gains an option. Kernel lines, estimated: C1r about 120 (the
approval record gains a choice, a check of the shape and a refusal; basis: `workflow-steps.ts:99-152` is 54 lines
for today's approval), C1c about 160 (basis: `bay/trust-card.ts` is 317 lines for a card with two layouts and a
difference), C2 about 80 (a field read, typed and handed out): about 360. New sentences the owner reads: the two
titles, "Choose one:", six choice lines, the withheld reason, the refusal of a withheld choice, the K6 line, and the
hash line: 13.
