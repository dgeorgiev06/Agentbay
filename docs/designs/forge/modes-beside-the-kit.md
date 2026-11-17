# A mode that lives in a project, beside the kit: what does not work yet

Three slices ran into the same gap from different sides. `docs/adr/0018` aims forge at any project, and forge's first job outside the kit needs all three. Nothing here is decided, and none of it is started.

1. **The typescript mode works only when the project is the kit** (slice G2). It runs the checkout's own npm scripts, and a project beside the kit has none of them, so every check there is inconclusive.
2. **A project cannot have a toolchain of its own** (slice S1). Only a mode in the kit's base folder may list commands, and a toolchain's practices file is "relative to the kit". A second language could live only in the kit.
3. **A project's mode cannot run the shared test of a kit interface it implements** (slice S3). Every shared test opens a project made of the kit's modes only; it does not pass the test toolbox's `project` option. `bay check` is satisfied when the mode's test imports the shared test, but from the project that test fails with "not a mode of the kit or of the project".

Also: `bay check` counts a type-only import of a shared test as running it.

What a fix has to decide, for the owner: who may list commands when the mode is the project owner's own (today: nobody outside the kit), where a project's toolchain and practices live, and whether a shared test is given the project it runs in.
