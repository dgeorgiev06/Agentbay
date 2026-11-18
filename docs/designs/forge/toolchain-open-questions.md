# `toolchain@1`: what the interface leaves undefined

Found while writing its shared test (slice S1). A second language would trip on each. Question 2 is decided, and question 9's ceiling; the others are not. The first two shape forge and are for the owner before G4.

1. **A project's own toolchain cannot exist today.** `practices` is "relative to the kit", and only base modes may list commands. A toolchain for a second language can therefore live only in the kit, never in a project. `docs/adr/0018` aims at any project.
2. **Writing into the checkout.** Decided in `docs/adr/0020`, item 2. The folder given to `check` and `test` is a throwaway copy the caller made and will remove. The toolchain's tools may write inside it and nowhere else, and the shared test holds that. What callers must do is in `calling-a-toolchain.md`.
3. **Order of running.** `describe` says "in the order check runs them" and the response says "in the order describe lists". May a toolchain run its checks at the same time, as long as the verdicts come back in order?
4. **The end of the output.** How much is promised? Does a check stopped at its limit keep what it wrote before it was stopped?
5. **The refusal of an unknown check name.** Must its reason name the unknown check?
6. **A wrong folder.** What do `check` and `test` give for a folder outside the project, or one that is not a checkout?
7. **Patterns and named files.** Which dialect do `sourceFiles` and `testFiles` use? Must the files named to `test` match `testFiles`, and what of a named file that does not exist?
8. **Failed test names.** How is a test inside a group named? Is a run where every test was skipped one that ran no tests?
9. **The default time limit** applies when none is given, and its value is not stated. The most a call may ask for is decided: 1,000 seconds for `check` and `test`, since a whole suite may need it (slice KL1; it was 420). A toolchain's action must declare `scriptTimeLimitSeconds` to give its script step that long, and a command it runs gets what is left of the step less the time kept for the script to answer: 30 seconds, or half the step when that is less. The typescript mode declares 1,030.
