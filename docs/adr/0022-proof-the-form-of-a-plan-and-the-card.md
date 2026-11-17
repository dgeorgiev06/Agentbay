# 22. Proof, the form of a slice and a plan, and the card: the smallest design, with named choices and a kernel check of where a card's lines come from

Date: 2026-11-17. Status: accepted by the owner.

`0015` decided that forge proves by script and stops the owner twice on honest cards. `0017` and `0018` decided that a plan is cut along interfaces and worked in waves. Three designs for the interfaces this needs were written and compared (`docs/designs/proof/`). The owner was asked four questions, one at a time, and chose.

**Decision.**

- Design A is the base: the least that lets proof's verdicts replace the reviewer's hands.
  - Proof is a base mode behind `proof@1`, with one action and the kinds of proof as data. A verdict is passed, failed or inconclusive, and any inconclusive part makes its item inconclusive.
  - The form of a slice is part of `proof@1`'s request: kind, write scope, the slices it comes after with the reason, its definition of done with a kind of proof per item, and what the builder declares before it edits. No schema file is added to the kernel, so the limit on concepts holds.
  - Proof reaches code only through the worktrees interface and the toolchain, by copy, call, remove. It is never given a slice's worktree to write in.
- **The merge card offers named choices** (question 1): merge, send back, keep, discard. A workflow names the choices, each with a rule that a pure function of proof computes from the verdicts. The kernel withholds a choice whose rule is false, shows it with its reason, and refuses it if asked. `bay approve` gains the choice. This is what `0015` already said; design A alone would have offered one thing and a reject.
- **The kernel checks where each line of a card came from, by the kind of step** (question 2). A line marked as computed may come only from a step that ran no skill. A line marked as judged may come only from a skill the workflow lists, and the kernel adds the model's name. A line marked as run needs a recorded command. A card that breaks the rule is not shown. The kernel does not match a line's words against a command's output: that was offered and not chosen.
- **A plan is a YAML file that a script checks** (question 3). The owner reads what the script prints from it: the table of slices, the waves, the longest chain, and any refusal. The table is never edited by hand. The plan is a file of the forge mode, not a schema of the kernel.
- **A project says what proof reads in proof's own settings** (question 4), under `settings.proof` in the project's config: the commands whose output must not change, and the counts that may not rise. No kernel change. If a second mode needs the same facts they move to a shared place then.
- From design C: `proof@1` has a shared test, and wrong proofs that each fail one case; inside proof, gathering evidence and deciding the verdict are separate, so the rule on inconclusive is one function per kind.
- From design B: a kind of proof for the real thing, so that a new mode, which has no output at the base to compare with, is shown running in a fresh project with literal expected output on the merge card.

**What the design round found, and what follows.**

- The reviewer's plan would have been refused by its own rules: two forge slices shared a folder in one wave, and "beside the first after its first commit" is not an order between slices. The plan is redrawn with scopes named by file (`docs/plans/0022-forge-in-waves.md`).
- A test call may ask a toolchain for at most 420 seconds, and the kit's suite takes longer. The ceiling is raised in the slice that makes the typescript mode work from any project, by what the suite's measured time needs.
- Injecting a bug and running the whole suite would cost hours per slice. A bug's run names the test files that cover it; the plan's item says which.
- Forge is refused as an active mode in any project that is not the kit. `0018` needs it to run there. It is not needed for the todo mode, which is built in the kit, so it is a slice after that job and before the trial on another project.
- Running the head's tests and its `bay` runs code a builder wrote, unconfined, as the toolchain already does. A throwaway copy limits where it writes by convention only. No design closes this, and no sentence may say otherwise.

**What stays judgement, labelled so on every card.** Whether a test asserts what its item says; whether a sentence tells the owner what to do; whether a design is sound; which bugs are worth injecting.

**Cost.** Sixteen slices after the design round, about 130 kernel lines, eight waves counting the design, a longest chain of eight.
