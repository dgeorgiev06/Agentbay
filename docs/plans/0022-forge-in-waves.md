# Forge, from here to the todo mode, as a plan in waves

Date: 2026-11-17. Written by the reviewer, by hand, in the form `docs/adr/0017` item 8 asks of every plan that forge will later write itself. Words are used as `CONTEXT.md` defines them. It replaces the flat list G4 to G8 of `docs/adr/0015` with slices that have a kind, a write scope and an order, so that two builders can work side by side.

## What is in place

- Commands for scripts, by name, with effects (`0019`). Throwaway folders. Trust for a project's modes (`0020`, `0021`).
- Four interfaces with shared tests: items-store, items-source, toolchain, worktrees. The typescript mode and the git-worktrees mode as base modes.
- The broker, manifests and runs sealed behind entries. The feature map with two debt lists that only shrink.
- The test toolbox, with trust for a mode's tests.

## What is still to build, and what each thing must be able to do alone

| Part | What it is | Seen working on its own when |
|---|---|---|
| Proof | A base mode, no model. Each kind of proof is a script that gives a verdict: passed, failed or inconclusive | A reviewer calls one kind on a hand-built slice's worktree and reads the verdict |
| Plan | The form of a plan and a slice, and the script that works out waves | `bay call` on a plan file prints its waves, its longest chain, and refuses overlapping scopes |
| Named choices | An approval offers named options, and an option can be withheld | A workflow stops with a card whose merge option is missing because evidence is missing |
| Forge | The stages, skills and workflows. It runs no command | An approved slice goes through build, proof, the merge card and the merge without the reviewer |
| Before the build | Restate, propose interfaces, plan in waves, challenge, the first card | A request in prose becomes a card that shows interfaces, then a plan |

## Design first (P-35)

One design round, no code, before any slice below. Three designs under different constraints (the smallest; the one that fits the commonest caller; the one that places the seams for testing), compared, and the owner chooses. It settles three interfaces that more than one caller will depend on:

1. **Proof's interface.** How a caller asks for a kind of proof and what a verdict holds. Whether the kinds are one action each or one action with a kind. Where the project says what proof reads: its map of modules, its practices, its commands whose output must not change. How proof reaches the toolchain (copy, call, remove) and the worktrees interface without being given a slice's worktree to write in.
2. **The form of a slice and a plan.** Kind, write scope, the slices it comes after with the reason, the interface it builds against, its definition of done with a kind of proof per item, and the declaration a builder makes before it edits (`0017` item 9).
3. **The card.** What an approval with named choices holds, and how a script withholds a choice.

Output: `docs/designs/proof/` with a frame, three designs, a comparison and a recommendation; an ADR when the owner has chosen.

## Slices

Kinds: **I** an interface, merged first, with its schemas and a test any implementation must pass. **C** a capability in one kernel feature. **M** a mode, changing only its folder and its interface (P-34). **D** design, documents only.

| # | Slice | Kind | Write scope | After | Because |
|---|---|---|---|---|---|
| D1 | The design round above | D | `docs/designs/proof/`, an ADR | - | - |
| I1 | `proof@1`: schemas for a request and a verdict, the closed set of kinds, a shared test, a made-up proof that passes it and wrong ones that fail one case each | I | `components/base/interfaces/proof/`, `tests/made-up-proofs*` | D1 | the chosen interface |
| I2 | The form of a plan and a slice: schemas, examples, a guard | I | `schemas/plan.schema.json`, `schemas/slice.schema.json`, generated types, tests | D1 | the chosen form |
| C1 | An approval with named choices; a choice can be withheld with its reason; the workflow reads which was taken | C, runs | `bay/runs/`, `bay/commands/approve.ts`, the workflow schema, tests | D1 | the chosen card |
| C2 | A project says where its map, practices and unchanged-output commands are; modes read them through the toolbox | C, manifests | config schema, `bay/manifests/`, the toolbox, tests | D1 | what proof reads |
| C3 | The kernel counts rounds of a slice and the times a step asks for tests, and refuses past the limit | C, runs | `bay/runs/`, `bay/broker/` for the count at a command, tests | D1 | `0017` item 10 |
| T1 | The kit's typescript and git-worktrees modes pass their shared tests from a project that is not the kit; the practices path is true in both places | M | `components/base/typescript/`, `components/base/interfaces/toolchain/`, tests | - | `0018`, before forge builds anything outside the kit |
| P1 | Proof: the checks pass; a test fails on the base and passes on the slice. Copy, call, remove | M | `components/base/proof/` files for these two kinds | I1 | the interface |
| P2 | Proof: changes are in scope; files outside are untouched; what changed matches the declaration; size | M | `components/base/proof/` files for these kinds | I1, I2 | the interface; the slice's scope and declaration |
| P3 | Proof: injected bugs are caught, in a throwaway copy, with a time limit each | M | `components/base/proof/` files for this kind | P1 | it calls the tests the way P1 does |
| P4 | Proof: output is unchanged, or changed only as the plan says; the real thing was run in a fresh project | M | `components/base/proof/` files for these kinds | I1, C2 | the interface; the project's list of commands |
| P5 | Proof: no new boundary break, duplicate or dead code; the counts of `0017` item 7 | M | `components/base/proof/` files for these kinds | I1, C2 | the interface; the project's map |
| W1 | Waves from a plan: order, disjoint scopes, longest chain, builders per wave; a plan where every slice waits is sent back | M | `components/base/forge/` plan scripts | I2 | the form |
| F1 | Forge: one workflow from an approved slice through a builder in a worktree, proof, the merge card and the merge | M | `components/base/forge/` workflow, skills, cards | P1, P2, C1, W1 | verdicts to show; a card to stop on; a slice to read |
| F2 | Forge: a slice sent back goes to a fresh builder with the findings; two rounds, then the owner; the card shows spill and cost | M | `components/base/forge/` | F1, C3, P3, P4, P5 | the workflow; the count; the rest of the verdicts |
| F3 | Forge: restate, propose interfaces, plan in waves, challenge by another model, the first card | M | `components/base/forge/` stages before the build | F1, I2, W1 | the workflow it hands to |
| F4 | Forge runs a wave: two builders in two worktrees on disjoint scopes, merged in order | M | `components/base/forge/` | F2 | one slice working end to end first |
| X1 | The todo mode, asked for in prose, built by forge | forge's job | `components/modes/todo/` and its interface | F3, F4, T1 | forge whole |

Proof's kinds share a folder, so their write scopes are named by file in each brief and checked to be disjoint before two run together. The first of them (P1) lays out the mode's folder and its manifest; P2 runs beside it only after P1's first commit has done that.

## Waves

| Wave | Slices | Builders | Note |
|---|---|---|---|
| 0 | SP1 (the suite's time), then SM1 (three small faults) | 1, then 1 | in flight; SP1 needs a quiet machine |
| 1 | D1 beside T1 | 2 | D1 writes documents only; the owner chooses at its end |
| 2 | I1, I2, then C1, C2, C3 | 2 at a time | I1 and I2 first; C1 and C3 both change runs, so they do not run together: C1 beside C2, then C3 |
| 3 | P1, then P2 beside P4, then P3 beside P5; W1 beside any of them | 2 | from P1 on, the reviewer uses proof on each later slice |
| 4 | F1, then F2 beside F3, then F4 | 2 | F1 is the first slice forge then carries for itself |
| 5 | X1 | forge | the first real job |

Longest chain: D1, I1, P1, P3, F2, F4, X1: seven slices. Eighteen slices in all, about ten sittings of two builders.

## What each wave proves before the next starts

- After wave 2: a made-up proof passes the shared test; a plan file loads or is refused with a sentence; a run stops on a card with a withheld choice.
- After wave 3: every verdict on a slice of this kit that the reviewer today gets by hand, proof gives by script, and the two agree on three past slices replayed (one that passed, one sent back, one with a survivor).
- After wave 4: forge builds one small slice of its own (a kind of proof or a sentence) with the reviewer only watching.
- After wave 5: the todo mode works in a fresh project, and the owner has been stopped twice.

## What the owner decides, and when

- At the end of D1: the three interfaces.
- With T1: where a project toolchain's practices file lives. Recommended: relative to the mode's own folder, true in the kit and in a project.
- Before F3: which other Claude model challenges a plan (decided in principle; the model is named then).
- After X1: unattended runs.

## What is not in this plan

The home mode, Chief of Staff, improve and delivery; the trial on a new small TypeScript project; the independent evaluation; the cutover to `main`. Each is planned when X1 is done, by forge.

## Time

Slices so far have taken 50 to 80 minutes of a builder and 30 to 40 of review, two at a time. Eighteen slices at that rate is about 10 hours of building and about 10 of review and full checks, less whatever SP1 saves on each check. The design round adds about 2, and the todo mode through forge about 3. So about 25 hours of machine time to the todo mode, in a range of 20 to 35.
