# `toolchain@1`: what the interface leaves undefined

Found while writing its shared test (slice S1). A second language would trip on each. Questions 1, 2, 9 and 10 are answered; the others are not.

1. **A project's own toolchain.** Answered. Only base modes could list commands, and `practices` was "relative to the kit". A mode in a project may now list commands while the owner trusts it (`docs/adr/0020`, item 1). `practices` is relative to the toolchain mode's own folder, in the kit and in a project alike (`docs/adr/0023`, slice T1).
2. **Writing into the checkout.** Decided in `docs/adr/0020`, item 2. The folder given to `check` and `test` is a throwaway copy the caller made and will remove. The toolchain's tools may write inside it and nowhere else, and the shared test holds that. What callers must do is in `calling-a-toolchain.md`.
3. **Order of running.** `describe` says "in the order check runs them" and the response says "in the order describe lists". May a toolchain run its checks at the same time, as long as the verdicts come back in order?
4. **The end of the output.** How much is promised? Does a check stopped at its limit keep what it wrote before it was stopped?
5. **The refusal of an unknown check name.** Must its reason name the unknown check?
6. **A wrong folder.** What do `check` and `test` give for a folder outside the project, or one that is not a checkout?
7. **Patterns and named files.** Which dialect do `sourceFiles` and `testFiles` use? Must the files named to `test` match `testFiles`, and what of a named file that does not exist?
8. **Failed test names.** How is a test inside a group named? Is a run where every test was skipped one that ran no tests?
9. **The time limit.** Answered. Left out, a check may take 90 seconds and a test run 420 (slice T1; the typescript mode's `tests/time-limits.test.ts` pins both). A call may ask for at most 1,000 seconds, since a whole suite may need it (`docs/adr/0023`; slice KL1; it was 420). A toolchain's action must declare `scriptTimeLimitSeconds` to give its script step that long; without it the kernel stops the step after 480 seconds. A command the script runs gets what is left of the step less the time kept for the script to answer: 30 seconds, or half the step when that is less. So a call that runs out of time gets an inconclusive verdict, not a failed run. The typescript mode's `check` and `test` declare 1,030.
10. **A check the checkout is not set up for.** Answered by slice T1. Its verdict is inconclusive, with a sentence that names what the checkout lacks and says what to add, and `describe` lists it under `missing`. The shared test holds this for any toolchain, and the made-up `tally` passes it.
