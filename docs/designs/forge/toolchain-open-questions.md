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
9. **The time limit.** Answered for the default; the ceiling stays as it is for now. Left out, a check may take 90 seconds and a test run 420 (slice T1; the typescript mode's `tests/time-limits.test.ts` pins both). A call may ask for at most 420 seconds. `docs/adr/0023` raises the ceiling to 1,000 seconds, because the kit's suite takes about 450 alone. T1 could not build that, for two reasons:
   - The kernel stops every script step after 8 minutes, whatever the budget: `maximumScriptMilliseconds` in `bay/runs/action-steps.ts`, line 43, used by `timeLimitOf` below it.
   - The broker gives a command at most what the script step has left: `bay/broker/script-runner.ts`, line 274, sets `commandMilliseconds` to the step's own limit, and `bay/broker/command-operations.ts`, line 89, takes the smaller of that and the time asked. Without a step's limit, the default is 10 minutes (`bay/broker/step-broker.ts`, line 51).

   So a test run asked for 1,000 seconds would be stopped at 8 minutes with its whole step, and the caller would get a failed run, not an inconclusive verdict. The ceiling rises in a later slice, once a step may run longer.
10. **A check the checkout is not set up for.** Answered by slice T1. Its verdict is inconclusive, with a sentence that names what the checkout lacks and says what to add, and `describe` lists it under `missing`. The shared test holds this for any toolchain, and the made-up `tally` passes it.
