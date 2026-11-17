# Calling a toolchain: copy, call, remove

For proof and forge, which will call `toolchain@1`. Decided in `docs/adr/0020`, item 2. G4 builds it this way.

Every call to `check` or `test` goes through three steps.

1. **Copy.** Call the worktrees interface's `copy` with the commit to be judged and a new name. Name in `links` the ignored paths the checks need, such as a folder of installed packages. The copy's folder is the one the toolchain is given.
2. **Call.** Call `check` or `test` with that folder. Its tools may write inside it, such as a build output or a cache, and write nothing outside it. A second call on the same copy gives the same verdicts, so `check` and `test` may share one copy.
3. **Remove.** Call the worktrees interface's `remove` with the copy's folder. Do this after every call, whatever the verdict, and also when the call failed or was stopped.

A toolchain is never given a slice's worktree. Proof judges a builder's work in the worktree, through the worktrees interface's `changed`, and no tool touches it. What a tool wrote stays in the copy and goes with it, so it is never mistaken for the builder's work.
