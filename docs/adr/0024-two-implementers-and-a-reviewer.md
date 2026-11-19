# ADR 24: a slice has a test writer, a builder who never sees the test, and a reviewer

Status: accepted, 18 November 2026. Decided by the owner.

## Context

Forge's first real run built the todo mode's first slice with one model writing both the test and the code. Proof showed that the test failed without the code and passed with it, that the change stayed in its scope and was as declared. None of that shows the test checks the right thing: the party that wrote the test is the party that benefits when it passes.

Published practice points the same way. Tests are written from the expected behaviour before the code and committed; faults are planted to see whether the tests notice; the tests that judge an agent's work are kept where the agent cannot change them; a second model that reads the work finds cheating in clear cases.

## Decision

The owner's words: "One agent writes the test another agent builds without seeing the test after it is done it runs the test. Reviewer runs the test and reviews both across all categories we have implemented and discusses. Implementers run sonnet medium and reviewer runs opus medium."

1. **The interface comes first.** A slice's action names and schemas are fixed from the plan before either implementer starts, since the test and the code must meet there and nowhere else.
2. **A test writer** writes the slice's tests from its definition of done and the interface. The tests are committed before the build is proved.
3. **A builder** writes the code from the same definition of done and interface. It never sees the tests: they are not in what it can read, and the test files are outside what it may change.
4. **The tests are run on the builder's work by the kernel**, through proof. A step agent runs nothing.
5. **When a test fails, the builder is told the names of the failing cases and their messages, and nothing else of the test.** The owner chose this over pass-or-fail only and over showing the test after a first round.
6. **A reviewer** receives the tests, the code and proof's verdicts, and reviews both against every category the kit holds: the kinds of proof, scope and declaration, the feature map's boundaries, duplicated code, size, and the practices.
7. **The reviewer discusses with the implementers first, then the owner.** A finding goes back to the test writer or the builder as a round; each corrects its own part, the builder still without the tests. After at most three rounds, what remains is shown to the owner on the merge card as judgement. The owner chose this over findings going to him only, and over the reviewer and implementers settling it alone.
8. **Models.** The two implementers run Sonnet at medium effort. The reviewer runs Opus at medium effort. A skill names a tier; the project's settings say which model and effort a tier is.

## What does not change

- Proof's verdicts are computed by script and a reviewer's findings are judgement. The card marks which is which. A reviewer's finding never offers or withholds merge on its own; only a `must` item's verdict does.
- An approval is the owner's. No agent decides one.
- Inconclusive is never a pass.

## Consequences

- Forge needs: a step that fixes the interface; a test-writing step with its own worktree; a build step whose read and write roots hold no test of the slice; rounds (slice F2), with a failing run's case names and messages as the only feedback from tests; a review skill (slice RV1); tiers that name a model and an effort in the project's settings.
- Hiding the tests from the builder rests on the kit's hook confining a step agent's reads. In a session where the hook is not active the builder is not confined, and the card must say so rather than claim the tests were hidden.
- The builder writing no test means a slice's `fails-first` item names tests the test writer declared.
- A reviewer that is a model is one more party that can be wrong. Planted bugs written by a party other than the builder remain the script's own check that the tests have teeth.
- Cost: three model steps a slice in place of two, and more rounds. The implementers are the cheaper model.

## Open

- What the test writer may read of the existing code beyond the interface.
- Whether the reviewer or a fourth party writes the bugs to plant.
- How a round's feedback is kept from carrying the test's text in a failing case's message.
