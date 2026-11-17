# 20. A project's own mode may run commands when the owner trusts it by name; checks write only into a throwaway copy

Date: 2026-11-17. Status: accepted by the owner.

Four decisions, taken after the boundary work showed what stops forge from building outside the kit (`docs/designs/forge/modes-beside-the-kit.md`, `toolchain-open-questions.md`).

**1. A mode that lives in a project may list commands and name throwaway folders when the project's owner trusts it by name.**

- Until now only a mode under the kit's `components/base/` could. The reason stands: a listed command runs unconfined, and an agent can write a mode, so a mode must never be able to grant this to itself.
- The owner's trust names the mode and is bound to the exact commands and throwaway folders the mode lists. A change to that list is not trusted until the owner approves it again.
- Nothing an agent's step can do may give, widen or renew that trust: not a file write, not a command, not a tool.
- `bay check` shows every trusted mode with each of its commands and their effects, and reports a mode that lists commands without trust, or whose list has changed since it was trusted.
- A mode of the kit's base folder is trusted as before, with no entry needed.
- How the trust is given and where it is kept is designed three ways before it is built (P-35), because it is a surface the owner types and a boundary the kernel defends.

**2. A toolchain's check and test are given a throwaway copy, and may write inside it and nowhere else.**

- They are never given a slice's worktree. Whoever calls a toolchain makes a copy first (the worktrees interface's `copy`) and removes it afterwards.
- The toolchain interface says so in its own words, and its shared test holds it: nothing outside the folder given is written. The statement that nothing at all is written is withdrawn.
- Proof judges a builder's work in the worktree, which no tool touches, so what a tool wrote and what a builder changed can never be confused.

**3. A mode's author sees which field of a request was malformed.** The table's sentence for the field replaces the single sentence. The same for an answer the script cannot read.

**4. A mode may state once the words every one of its commands starts with.** One field in the manifest; each command's words follow it. The git-worktrees mode states its protections there, so a command cannot be listed without them.

**Order.** The two small ones (3, 4) are single slices. The toolchain change (2) is one slice in the interface, its shared test and the typescript mode. Trust (1) is designed, then built, then the typescript mode is made to work on a project that is not the kit, which `0018` already put before G7. G4 follows 1 and 2.

**Cost.** Trust adds one thing the owner must do once per project mode that runs commands, and again when its commands change. That friction is the point: it is the only moment a person looks at what a mode will be allowed to run.
