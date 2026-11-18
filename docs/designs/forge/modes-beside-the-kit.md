# A mode that lives in a project, beside the kit: what works and what does not yet

Three slices ran into the same gap from different sides. `docs/adr/0018` aims forge at any project, and forge's first job outside the kit needs all three. All three are now answered. What is still open is at the end.

1. **The typescript mode worked only when the project was the kit** (found in slice G2). Answered by slice T1 (`docs/adr/0023`). The mode runs the project's own `package.json` scripts by agreed names. A required script the checkout lacks makes that check inconclusive, with a sentence saying what to add. `generate:check` runs only where the checkout has it. `describe` says which agreed scripts the project has and lacks. `components/base/git-worktrees/tests/typescript-in-a-project.test.ts` proves it in a project that is not the kit, on a throwaway copy that the git-worktrees mode made.
2. **A project could not have a toolchain of its own** (found in slice S1). Answered in two parts. A mode outside the kit may list commands while the owner trusts it (`docs/adr/0020`, item 1, slices TR1 to TR6). A toolchain's practices file is relative to the mode's own folder (`docs/adr/0023`, slice T1). The made-up toolchain `tally`, placed in a project and trusted, now passes every case of `toolchain@1`'s shared test (`tests/shared-tests-in-a-project.test.ts`).
3. **A project's mode could not run the shared test of a kit interface it implements** (found in slice S3). Answered by the slice of brief `P1-a-shared-test-runs-where-the-mode-lives`: a shared test takes the project it runs in.

Still open:

- Forge itself is refused as an active mode in a project that is not the kit (`docs/adr/0022`). It is a slice after the todo mode.
- `bay check` counted a type-only import of a shared test as running it. T1 did not look at this again.
- A test call may ask for at most 420 seconds, because the kernel stops a script step after 8 minutes (`toolchain-open-questions.md`, question 9). The kit's suite can take longer.
