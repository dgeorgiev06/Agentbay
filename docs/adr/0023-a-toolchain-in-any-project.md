# 23. A toolchain in any project: the project's own scripts by agreed names, and practices beside the mode

Date: 2026-11-17. Status: accepted by the owner.

`0018` aims forge at any project. The typescript mode worked only in the kit, because it runs the scripts of the checkout's own `package.json` and a project beside the kit has none of them; and `toolchain@1` said a toolchain's practices file is "relative to the kit". The owner was asked two questions and chose.

**Decision.**

- **The project provides the checks.** The typescript mode runs scripts of the project's `package.json` by agreed names: `typecheck`, `lint`, `format:check`, `deadcode` and `test`. It brings no compiler, linter or formatter settings of its own to a project. The project keeps its tools, their versions and their settings.
- A required script the project lacks makes that check inconclusive, with a sentence that names the script and says how to add it. Inconclusive is never a pass.
- A check that only the kit has (`generate:check`) is optional: `describe` lists it only where the project has the script.
- `describe` says which agreed scripts a project has and which it lacks, so that forge's first job in a new project can set them up (`0018`, "Cost").
- **A toolchain's practices file is relative to the mode's own folder.** That is true in the kit and in a project. The typescript mode's file stays where it is.

**Not chosen.** The mode running its own tools with the kit's settings in every project: nothing to set up, but every project would get the kit's choices, and a project with rules of its own could not use them.

**With it, in the same slice.** A test call may ask for up to 1,000 seconds, because the kit's suite takes about 450 alone and more beside another run (`docs/research/2026-11-17-suite-time.md`). The fixtures the reviewer's capture uses move into the repository, since proof judges a commit from a copy of it and a copy holds only what the commit holds (`0022`).
