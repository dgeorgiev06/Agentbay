# Proof, the form of a slice and a plan, and the card: the three designs compared

Read `0-frame.md` first. This weighs `A-smallest.md`, `B-caller.md` and `C-seams.md` against its criteria and ends
with a recommendation: A as the base, with C's way of offering and checking choices in a cheaper form, C's shared
test, and B's kind for the real thing.

## Where they agree

They agree on these, and the comparison stops there:

- Proof is a base mode behind an interface, `proof@1`, because a workflow may call only its own actions or an
  interface it requires (`schemas/workflow.schema.json:84`). It requires `toolchain@1` and `worktrees@1`.
- Proof reads code only as the output of a listed command run in a copy (`cat`, `wc`, `grep`, and `./bay.sh`),
  because no mode may hold a read path over `.forge/copies/` (`bay/policy.ts:333-350`). It lists no git command.
- Copy, call, remove, with remove on every path. The toolchain is never given a worktree (V4).
- Size is reported with every answer and is never a verdict (P-13).
- The declaration is a `declare` skill step's output, recorded before the build step starts. Names of a code entry
  stay judgement: proof names no language. Action names of manifests and interfaces are proven.
- Bugs to inject are patches written by the planner or the reviewer (judgement); whether each was caught is proof's.
- No file is added under `schemas/` (`concepts` stays 5) and no command is added (`cli_commands` stays 13).
- Written in any of the three forms, the plan's own table is refused: F2 and F3 share `components/base/forge/` in one
  wave (`docs/plans/0022-forge-in-waves.md:52-53`, `:66`), and P2's "beside P1 after its first commit" (`:55`) is
  not an order between slices. Named by file, the plan has eight waves and a chain of eight slices, not seven.
- K3: no card shows a builder's reason for a path outside the scope. The slice stops, and the plan gains a slice.
- K4: the plan is refused before anyone builds. `tests/**` and a shared `CONTEXT.md` cannot be in two scopes of one
  wave; glossary words go in with the slice merged first.
- K5: no field anywhere holds a builder's count. The count shown is the toolchain's.
- K6: proof works in the `sound` project and says inconclusive where it cannot know. Forge itself is refused there
  (`bay/manifests/activation.ts:32-35`, `bay/policy.ts:86-89`), and no slice of the plan changes that. It needs a
  slice before the trial outside the kit that ADR 19 names.
- The capture's fixtures move into the repository, since a copy of a commit holds only the commit.
- C3, the count of rounds and test runs, is as the plan has it.

## Against the criteria

| # | Criterion | A, smallest | B, caller | C, seams |
|---|---|---|---|---|
| 1 | K1 TR2 | 10 items, 8 by proof; offer `merge` | the same, from the brief; named choices | 11 items, 9 by proof; named choices; every line's source checked |
| 1 | K2 survivor | `bugs-caught` failed; offer `send back` | the same; `send-back` among four | the same; the survivor's `# fail 0` is a checked `ran` line |
| 1 | K7 suite over 420 s | inconclusive; T1 raises the ceiling | `tests-pass` halves the run until each part fits | inconclusive; T1 raises the ceiling |
| 2 | The reviewer types | `bay call proof.prove "$(cat slice.json)"`, after writing the slice once | `bay call proof.brief '{"brief":…}'` on the brief as it is | `bay call --workflow plan:workflows/prove.yaml '{…}'` |
| 3 | A builder is given | the slice as YAML | the brief, with a `proof:` after each item | the slice as YAML |
| 4 | The owner reads and answers | lines, then one offer: approve does it, reject stops | a card the kernel draws; one of four named choices, a withheld one with its reason | as B, plus a kernel line "checked: 12 ran, 11 calc, 4 judged" |
| 5 | A project that declares nothing | `same-output` inconclusive | card 1 says what cannot be known; two kinds inconclusive | as A |
| 6 | V2 (no builder's words) | held by forge's card script, by review | held by `proof.brief` drawing the card, by review | held by the kernel: a line may quote only a skill listed in `quotes` |
| 6 | V6 (merge withheld) | the script never offers it | the kernel refuses a withheld choice | the kernel withholds by a `when` from a pure function |
| 7 | Kernel slices, features | C1a (command line) | C1r (runs), C1c (command line), C2 (config, manifests, toolbox) | C1r (runs), C1e (broker), C1p (command line) |
| 8 | Kinds | 7, data, one action | 10, one action each, plus `brief` | 8, data, schemas published by `kinds` |
| 8 | Where a project declares | proof's settings | `project:` in the config, for every mode | the plan mode's settings, passed in each request |
| 8 | Form of a slice and a plan | the slice is `proof@1`'s request; the plan is forge's YAML | the brief with front matter; the plan's Markdown table | `plan@1` and a base mode `plan` |
| 8 | Kernel lines, estimated | about 30 | about 360 | about 280 |
| 8 | New sentences the owner reads | 9 | 13 | 12 |
| 10 | Slices, waves, chain | 16, 8, 8 | 19, 8, 8 | 19, 8, 8 |

## Where they truly differ

1. **What the owner may answer at the merge.** A: approve the one thing offered, or stop. B and C: one of four
   named choices, with any not offered shown and refused.
2. **What a card's marks rest on.** A and B: the script that drew the card, and review of forge's workflow. C: the
   kernel checks each line's source against the run before it shows the card.
3. **What a plan is.** A and C: a data file a script checks. B: the Markdown briefs and tables people read today,
   made strict enough to parse.
4. **Where a project declares.** A and C: one mode's settings. B: a section of the config, a kernel slice.
5. **How proof is cut.** A: one action, kinds as data. B: an action per kind. C: one `judge` action, a private seam
   between gathering and deciding, and a shared test with a wrong proof per case.

## Questions for the owner

**1. At the merge card, what may you answer?**

- [ ] A: approve or reject. The card offers one thing, which a script chose: merge, or send back, or stop. Reject
  always stops and keeps the branch. No change to runs.
- [x] B, C: tap one named choice: merge, send back, keep, discard. A choice not offered stays on the card with its
  reason, and the kernel refuses it. This is what ADR 15 decided ("choices are named options"). Cost: a runs slice
  of about 120 to 200 lines, and `bay approve` gains `--choice`.

**2. What should a card's marks rest on?**

- [ ] The script that drew the card, and review of forge's workflow (A, B). No kernel cost. A fault in forge's card
  script could mark a builder's words `calc`, and nothing would stop it.
- [x] The kernel checks each line's source by the kind of step it came from: `calc` only from a step that ran no
  skill, `judged` only from a skill the workflow lists, with the model's name added by the kernel; `ran` only with a
  recorded command event. About 100 kernel lines in runs. A card that breaks the rule is not shown.
- [ ] As above, and the kernel also checks that a `ran` line's words are words the command printed (C). The broker
  keeps the end of each command's output in its event. About 280 lines; lines read as commands print them
  ("# pass 1374"); a short line may be found by chance.

**3. When you read a plan, what do you read?**

- [ ] B: a Markdown table as today, which a script parses and refuses. Two parsers of prose, in proof and forge.
- [x] A or C: a YAML file a script checks, and what the script prints from it: the waves, the chain, the refusals.
  The table you read is drawn from the file and never edited by hand. Within this choice the recommendation is A's
  place for the form (the slice is `proof@1`'s request; the plan is forge's file): C's separate plan mode and
  interface test the waves without forge but add a mode and an interface that only forge uses.

**4. Where does a project say what proof reads?**

- [x] A: in proof's settings in `agentbay.config.yaml` (`settings.proof`): the commands whose output must stay and
  the counts that may not rise. No kernel change. Another mode that needs the same facts later reads them from its
  own settings, or the facts move to a shared place then.
- [ ] B: a `project:` section of the config that every mode reads, with the map, the practices and the commands.
  One place for forge, proof and the builder's task; a kernel slice across the config, manifests and the toolbox.

## Recommendation

Build A, with three things from the others.

1. **From C, named choices offered by a rule** (question 1). The workflow names the choices, each with a `when`
   that a pure function of proof computes from the verdicts. The kernel withholds a choice whose `when` is false and
   refuses it with the reason. The owner taps a name.
2. **From C, the check of sources by step** (question 2, the middle answer). Not the text search of `ran` lines:
   it needs the broker to keep output, it reads oddly, and it fails on a cut output. Lines may then say "checks: 5
   of 5 passed" as in A and B.
3. **From C, the shared test and the wrong proofs** of `proof@1`, with the `tally` and `shelf` variants that record
   what they are asked. The plan's I1 already asks for this. Also C's private seam inside proof between gathering
   and deciding, which costs nothing and keeps V1 in one function per kind.
4. **From B, the kind `real-thing`**, so that a new mode, which has no output at the base, is shown as it runs in a
   fresh project with literal expected output. The todo mode is a new mode; A alone would prove it with an
   end-to-end test and no excerpt for the merge card, which ADR 15 asks for.

Why not B as the base: its kinds as actions make `proof@1` eleven actions wide, its plan stays prose that two scripts
parse, and it costs about twelve times A's kernel lines for what the owner sees, which the hybrid gets for about a
third of B. Why not C whole: a second interface and mode for plans that only forge uses, and a text search that is
fragile. Why not A alone: one offer and reject is not what ADR 15 decided, and nothing but review keeps a mislabelled
line off a card.

The hybrid's migration: D1; T1 (with the fixtures and the ceiling); I1 (`proof@1` with the slice's form, the shared
test and wrong proofs); C1r (choices with `when`, `quotes`, the check of sources by step); C1p (lines printed as
lines, `--choice`, after C1r); C3; P1 to P5 with `real-thing` in P4; W1; F1 to F4; X1. Seventeen slices, eight
waves, a chain of eight. Kernel lines about 130 (C1r about 100, C1p about 30), estimated as in the designs.

## What I am unsure of, and what to try first

- **Reading YAML action names with `cat`** inside proof is a small parser of manifests in a mode. If it grows, the
  worktrees interface may need an action that reads a file at a commit. Try it on TR2's and G3's manifests first.
- **The suite's time.** Raising the ceiling to 1,800 seconds makes the kit's `checks` known, at 12 to 18 minutes a
  run; bug injection runs the suite once per bug. Ten bugs is two to three hours per slice unless a bug's run names
  only the test files that cover it. SP1's result decides how much this hurts. Not measured.
- **Running `./bay.sh` of the head** runs code the builder wrote, unconfined, as the toolchain already does with the
  tests. Copies limit where it writes only by convention. None of the designs closes this.
- **The declaration through a declared path.** A path the builder declares and did not change is the one place its
  free words could reach proof's answer. All three must show it only as a count; only C has a shared case for it.
- **The cards' numbers.** Test counts, captures, bug counts and debt entries on the TR2 cards are examples. TR2's
  real report and the reviewer's rerun numbers are not in the repository.
- **K5.** I found no record of a builder's wrong test count; reports are not committed. The case is kept as one
  every design must answer.
