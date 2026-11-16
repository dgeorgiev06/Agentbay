# 15. Forge: proof by script, two approvals on honest cards, and no more than it needs

Date: 2026-11-16. Status: accepted by the owner.

Three designs were written under different constraints and compared (`docs/designs/forge/`). The owner chose the hybrid.

**Decision.**

- Forge is small modes behind interfaces, not one large mode:
  - a **toolchain** interface, with the existing TypeScript setup as its first mode; forge names no language;
  - a **worktrees** mode, the only mode that may run git: a worktree and branch per slice, merged back by a script;
  - a **proof** mode that uses no model: each definition-of-done item names a kind of proof from a closed set, and a script gives the verdict. A builder's report has no field for check results. A verdict is passed, failed or inconclusive, and inconclusive is never a pass;
  - **forge** itself: the stages, skills and workflows. It runs no command.
- One kernel addition comes first, because every design needs it: a script of a base mode may run a command its mode lists. The kernel runs it, as an argument list with no shell, with a time limit, scrubbed output and a record of each run.
- The owner is stopped twice on a job. Once on what will be built, shown as the output he would see. Once on the merge, shown as real output from a fresh project and a verdict table. Each stop is a short card: every line says what the kernel ran or which model judged it, a builder's own words never appear, and the choice to merge is not offered when evidence is missing. Choices are named options.
- A slice sent back goes to a fresh builder with the whole scope and the findings. Two rounds at most, then the owner decides.
- Left until after forge's first real job: a first step per kind of work (a pinned behaviour before a refactor, one failing command before a bug fix, three designs before a wide interface), write scope enforced while a builder works, a model per skill, a check that is itself a skill, unattended runs, and a Go toolchain.

**Forge's first real job is the todo mode.** The owner chose it because it is easier to test. The mail and X modes are paused. The order after forge: todo, then the home mode (`docs/proposals/0023`), then the rest. This replaces the order in `0014`.

**Unattended runs** were not decided. They stay where the recommendation put them, after the first real job, until the owner says otherwise. In the workspace this is built in, work stops when the session stops; unattended runs need the kit running on a machine that stays up.

**Build order, by hand until forge can carry it.**

1. G1: commands for scripts.
2. G2: the toolchain interface and the TypeScript mode.
3. G3: the worktrees mode.
4. G4: proof, part one (checks pass, changes are in scope, files are untouched, a test fails first, size). From here the reviewer uses it on hand-built slices.
5. G5: proof, part two (injected bugs caught, output unchanged, the real thing, no new boundary break, duplicate or dead code).
6. G6: approvals with named choices; a slice out of rounds waits for the owner.
7. G7: forge, one workflow from an approved brief through build, review and merge. Forge builds its next slice itself.
8. G8: the stages before it (restating the request, the plan, a challenge by a second model) and the two cards.
9. The todo mode, through forge.

**How this meets `0014`.** That record says a slice that touches a feature not yet behind an entry file brings it behind one first. G1 touches broker, scripts and safety, which are not. Deepening them first would put a design round and several slices ahead of forge. So for the groundwork slices the rule is narrower: a slice adds no boundary break and no duplicate, and puts what it adds where the feature map says it belongs. Deepening broker with scripts becomes one of forge's own early jobs.

**Why.** By hand, five briefs carried contradictions, three builders were stopped mid-run, and the reviewer's own bug injection found something in about one slice in three. Design A alone would have recorded the same process without improving it. Design B alone invites approval by reflex. Design C alone proves the claims that were rarely false and asks the owner six times. Together: scripts prove what scripts can, cards show only what was proven, and nothing is built before it is needed.

**Cost.** About eight slices before forge builds a real mode. What a model must still judge stays a model's word: whether a test asserts the right thing, whether a design is sound. Those are labelled as judgement wherever they are shown.
