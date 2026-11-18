# Forge, from here to the todo mode, as a plan in waves

Date: 2026-11-17. Written by the reviewer, by hand, in the form `docs/adr/0017` item 8 asks of every plan that forge will later write itself. Words are used as `CONTEXT.md` defines them. Redrawn the same day after the design round and the owner's four answers (`docs/adr/0022`). It replaces the flat list G4 to G8 of `docs/adr/0015` with slices that have a kind, a write scope and an order, so that two builders can work side by side.

## What is in place

- Commands for scripts, by name, with effects (`0019`). Throwaway folders. Trust for a project's modes (`0020`, `0021`).
- Four interfaces with shared tests: items-store, items-source, toolchain, worktrees. The typescript mode and the git-worktrees mode as base modes.
- The broker, manifests and runs sealed behind entries. The feature map with two debt lists that only shrink.
- The test toolbox, with trust for a mode's tests.

## What is still to build, and what each thing must be able to do alone

| Part             | What it is                                                                                                 | Seen working on its own when                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Proof            | A base mode, no model. Each kind of proof is a script that gives a verdict: passed, failed or inconclusive | A reviewer calls one kind on a hand-built slice's worktree and reads the verdict               |
| Plan             | The form of a plan and a slice, and the script that works out waves                                        | `bay call` on a plan file prints its waves, its longest chain, and refuses overlapping scopes  |
| Named choices    | An approval offers named options, and an option can be withheld                                            | A workflow stops with a card whose merge option is missing because evidence is missing         |
| Forge            | The stages, skills and workflows. It runs no command                                                       | An approved slice goes through build, proof, the merge card and the merge without the reviewer |
| Before the build | Restate, propose interfaces, plan in waves, challenge, the first card                                      | A request in prose becomes a card that shows interfaces, then a plan                           |

## Design first (P-35): done

Three designs were written and compared (`docs/designs/proof/`), and the owner chose (`docs/adr/0022`): the smallest design, with named choices on the merge card, a kernel check of where each line of a card came from, a plan as a YAML file a script checks, and a project's facts in proof's own settings.

## Slices

Kinds: **I** an interface, merged first, with its schemas and a test any implementation must pass. **C** a capability in one kernel feature. **M** a mode, changing only its folder and its interface (P-34). Scopes inside a shared folder are named by file in each brief.

| # | Slice | Kind | Write scope | After | Because |
|---|---|---|---|---|---|
| T1 | The kit's typescript and git-worktrees modes pass their shared tests from a project that is not the kit; the practices path is true in both places; the test time ceiling fits the measured suite; the capture's fixtures move into the repository | M | `components/base/typescript/`, `components/base/interfaces/toolchain/`, `tests/fixtures/` | - | - |
| I1 | `proof@1`: one action, the kinds as data, the form of a slice in its request, a shared test, a made-up proof that passes it and wrong proofs that each fail one case | I | `components/base/interfaces/proof/`, `tests/made-up-proofs*` | - | - |
| C1r | A workflow's approval names choices, each with a rule; the kernel withholds a choice whose rule is false and refuses it; the kernel checks where each line of a card came from by the kind of step | C, runs | `bay/runs/`, the workflow schema, its tests | - | - |
| C1p | A card is printed as lines, not JSON; `bay approve` takes the choice | C, command line | `bay/run-report.ts`, `bay/commands/approve.ts`, its tests | C1r | what a choice and a card are |
| C3 | The kernel counts the times a step asks for tests and refuses past the limit | C, runs | `bay/runs/`, `bay/broker/command-operations.ts`, its tests | C1r | both change runs, so one after the other |
| P1 | Proof: its folder, manifest and table of kinds; the checks pass; a test fails on the base and passes on the slice. Copy, call, remove | M | `components/base/proof/` manifest, table, lib, two kinds and their tests | I1, T1, KL1 | the interface; a ceiling the suite fits |
| W1 | Waves from a plan file: order, disjoint scopes, longest chain, builders per wave, the table drawn; a plan where every slice waits is sent back | M | `components/base/forge/` plan scripts and their tests | I1 | the slice's form |
| P2 | Proof: changes are in scope; files outside are untouched; what changed matches the declaration; size | M | one file per kind and its test | P1 | the folder and table |
| P3 | Proof: injected bugs are caught, in a throwaway copy, each run naming the test files that cover it, with a time limit | M | one kind file and its test | P1 | it calls tests as P1 does |
| P4 | Proof: output is unchanged, or changed only as the plan says; the real thing runs in a fresh project with literal expected output | M | two kind files and their tests | P1 | the folder and table |
| P5 | Proof: no new boundary break, duplicate or dead code; the counts that may not rise | M | one kind file and its test | P1 | the folder and table |
| F1 | Forge: one workflow from an approved slice through a builder in a worktree, proof, the merge card with its choices, and the merge | M | `components/base/forge/` workflow, build skill, card script | P1, P2, C1p, W1 | verdicts to show; a card to stop on; a slice to read |
| F2 | Forge: send back to a fresh builder with the findings; two rounds, then the owner; the card shows spill and cost | M | forge's round files, named | F1, C3, P3, P4, P5 | the workflow; the count; the rest of the verdicts |
| F3 | Forge: restate, propose interfaces, plan in waves, challenge by another model, the first card | M | forge's files for the stages before the build, named | F1 | the workflow it hands to |
| F4 | Forge runs a wave: two builders in two worktrees on disjoint scopes, merged in order | M | forge's wave workflow and its test | F2, F3 | one slice end to end, and a plan to take waves from |
| X1 | The todo mode, asked for in prose, built by forge | forge's job | `components/modes/todo/` and its interface | F4 | forge whole |

## Slices added since the plan was drawn

Each was found by a builder or in review, and none was in the designs.

| # | Slice | Kind | Write scope | After | Because |
|---|---|---|---|---|---|
| KL1 | An action may let its script steps run longer than eight minutes, up to 1,800 seconds; commands get what is left; `toolchain@1`'s ceiling rises to 1,000 seconds | C, runs and broker | `bay/runs/`, three broker files, the mode schema, the toolchain's request schemas | T1 | T1 found that a script step is stopped at eight minutes, so the kit's own suite could not be judged through its toolchain. P1 needs it |
| EK1 | The broker reserves the event kinds the kernel itself reads (`run.asked-by`, `tool.called`, `budget.exceeded`) | C, broker | `bay/broker/other-operations.ts`, its tests | C1r | C1r found that a script can write them; one changes what the owner reads while a run waits for budget |
| MN1 | The adapter tells the kernel which model each tier is, so a judged line on a card names the model | C, adapter and runs | `adapters/claude-code/`, the config, one field in runs | C1p | The owner chose that the kernel adds the model's name; the kernel does not know it today and shows the skill and tier |
| KS1 | The kernel compiles each schema once; the cost of starting a script host is measured and cut where it is safe | C, manifests and broker | `bay/manifests/spec.ts`, the script runner | - | SP1 measured it: at least 119 of the suite's 870 processor seconds |

KL1 runs in wave 1 beside T1. EK1 and MN1 run in wave 2 or 3 where a seat is free; F1 needs MN1. KS1 runs when the machine is quiet, since it times the suite.

## Waves

| Wave | Slices | Note |
|---|---|---|
| 0 | SP1 (the suite's time), SM1 (three small faults) | in flight |
| 1 | T1, I1, C1r | three disjoint scopes; two builders at a time |
| 2 | P1, W1, C1p, C3 | C1p and C3 touch different files; P1 lays out proof's folder |
| 3 | P2, P3, P4, P5 | one kind file each; from here the reviewer uses proof on every slice |
| 4 | F1 | alone |
| 5 | F2, F3 | named files of forge |
| 6 | F4 | alone |
| 7 | X1 | forge's first real job |

Longest chain: I1, P1, P2, F1, F2, F4, X1. Sixteen slices after the design.

## What each wave proves before the next starts

- After wave 2: a made-up proof passes the shared test; a plan file prints its waves or is refused with a sentence; a run stops on a card with a withheld choice; proof gives its first two verdicts on a past slice.
- After wave 3: every verdict the reviewer gets by hand today, proof gives by script, and the two agree on three past slices replayed: one that passed, one sent back, one with a surviving bug.
- After wave 4: forge carries one small slice with the reviewer only watching.
- After wave 7: the todo mode works in a fresh project, and the owner was stopped twice.

## What the owner decides, and when

- With T1: where a project toolchain's practices file lives. Recommended: relative to the mode's own folder, true in the kit and in a project.
- Before F3: which other Claude model challenges a plan.
- After X1: unattended runs.

## After the todo mode, before the trial on another project

- Forge may be active in a project that is not the kit (`0018`; the kernel refuses it today).
- The home mode, Chief of Staff, improve and delivery; the trial on a new small TypeScript project; the independent evaluation; the cutover to `main`. Each is planned then, by forge.

## Time

Slices so far have taken 50 to 80 minutes of a builder and 30 to 40 of review, two at a time. Sixteen slices at that rate is about 9 hours of building and about 9 of review and full checks, less whatever SP1 saves on each check. The todo mode through forge adds about 3. So about 21 hours of machine time to the todo mode, in a range of 17 to 30.
