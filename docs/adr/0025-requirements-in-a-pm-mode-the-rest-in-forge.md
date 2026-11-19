# ADR 25: requirements are a PM mode's; plans, tests, building and review are forge's

Status: accepted, 18 November 2026. Decided by the owner.

## Decision

The owner's words: "Pm mode for requirements and the test is in forge mode."

1. **A PM mode owns requirements.** It turns what the owner asks for into outcomes a person could see working, each with conditions that can be checked. It writes no plan of slices, no test and no code.
2. **Forge owns everything from there.** It cuts outcomes into slices, groups them into vertical stages with the interfaces fixed first, works out the waves, and for each slice runs the test writer, the builder who never sees the tests, proof and the reviewer (ADR 24).
3. **The two meet at one document:** the requirements, in a form a script can check, as a plan is. Forge reads it and nothing else of the PM mode. Either mode can be used without the other: forge on requirements a person wrote by hand in that form, the PM mode for a team that builds another way.
4. **Proof and the worktrees mode come with forge.** Activating forge brings them, with nothing more to set up. Proof is the same for every language; what differs by language is the toolchain behind it. The kinds `same-output` and `real-thing` run a project's own commands, not only the kit's.
5. **What keeps a builder from the tests is forge's.** Forge sets the folders a builder may read and write and leaves the slice's tests out of both; the kernel's hook holds it while the builder works, and proof's scope check confirms it after.

## Open

- The form of the requirements document and its schema.
- Whether a condition names its kind of proof in the requirements or only in forge's plan.
- Who challenges a plan before the owner approves it (another model, as the plan for slice F3 says).
