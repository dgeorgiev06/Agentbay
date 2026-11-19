# Forge, whole: the frame two designs answer

Two designs are written from this frame, each without sight of the other, then compared. The owner decides. Words are used as `CONTEXT.md` defines them.

## What is decided, and not open

- ADR 24: a slice has a test writer, a builder who never sees the tests, and a reviewer. On a failing test the builder is told the failing cases' names and messages only. The reviewer discusses with the implementers for at most three rounds, then the owner. Implementers run Sonnet at medium effort, the reviewer Opus at medium effort.
- ADR 25: requirements are a PM mode's. System design, planning, and building with proof and review are forge's. Forge reads one requirements document that a script can check. Proof and the worktrees mode come with forge. What keeps a builder from the tests is forge's.
- ADR 22, 20, 21, 17, 15: proof and its verdicts, the card and its marks, trust, approvals as the owner's. No security property of `docs/designs/operations/0-frame.md` or `docs/designs/trust/0-frame.md` is weakened.
- What exists: `components/base/forge/` (`waves`, the `one-slice` workflow with `slice`, `declare`, `build`, `draw`, `carry-out`), `components/base/proof/` with eight kinds, `docs/designs/forge/one-slice.md`, plans as YAML that `forge.waves` checks.

## What the first real runs showed (18 November)

- A model built a small mode in three minutes; proof took seventeen, nearly all of it the whole suite.
- Two builds of one slice made different storage choices and proof passed the weaker one: nothing had fixed the design.
- Two of three declarers guessed, since none read an existing mode.
- The merge card said an item failed and not why; the owner asked what a card was, and for a clearer one.
- The session that ran it had no hook and no submit tool: a builder was not confined there.
- The workflow form has no loop and no conditional step.

## What a design must answer

1. **The requirements document**: its form and schema, what a condition is, and whether it names its kind of proof there or only in the plan. What the PM mode hands over and nothing more.
2. **System design as forge's first phase**: its steps, its outputs as files (modules and what each hides, interfaces as schema files, the data model, decisions with alternatives, what is left out), how two designs are written apart and compared, what the owner's card for it shows, and how small work skips most of it without skipping the interfaces.
3. **Planning**: how slices are cut from the design, how vertical stages are formed with the interfaces first, who challenges a plan, and what changes in the plan form and in `forge.waves`.
4. **One slice under ADR 24**: every step with its inputs and outputs in the workflow's real form; where the tests live so the builder cannot read them, and what that rests on; how the kernel runs the tests and what of a failing case reaches the builder without carrying the test's text; rounds, and whether they need a loop in the workflow form (a kernel change) or can be driven by forge; the reviewer's input, its categories, and its output's form; who writes the bugs to plant.
5. **Practices**: how each practice in `framework/practices.md` is held: by a tool, by proof, or by the reviewer's judgement; how that is recorded so the reviewer's list is drawn from the file and the card can show it; how a project's own practices are added.
6. **Tiers**: how a tier names a model and an effort in the project's settings, and what the card says of a judged line.
7. **The cards**: start, design, plan, merge, in at most 44 columns, answer first, a failure with its reason, the choices with why one is not offered, and where a line came from. Show each as printed for the todo mode.
8. **Time**: what proof runs for a slice and what it runs once for a wave, given a suite of 555 seconds, and what is lost by each saving.
9. **Outside the kit**: what forge needs to build a project that is not agentbay and not TypeScript: the toolchain, the commands `same-output` and `real-thing` run, forge active outside the kit, and what the builder may read.
10. **The order to build it in**: slices in waves, the smallest forge that carries one slice under ADR 24 first, with the todo mode rebuilt through it as the test; what is thrown away of today's forge and what stays.

## What a design must not do

- Decide an approval for the owner, or let a judged line offer or withhold merge.
- Say a builder is confined where the hook is not active.
- Add a capability without naming the slice that uses it first.
- Leave a question it could answer by reading the code as an open question.

## Form of each design

One file, `A.md` or `B.md`, in this folder: the answer to each of the ten in order, each grounded in the code with file and line; the cards as printed; the slices as a plan file that `forge.waves` accepts (paste its output); what was read and what was not verified; and at most seven questions only the owner can answer, each with a recommendation.
