# 18. Forge is the way this kit was built, as a mode, for any product or feature

Date: 2026-11-16. Status: accepted by the owner.

The owner asked that the way of working reached while building agentbay 5 (requirements, plan, slices, work side by side, every quality control) become a mode that builds any product or feature, not only modes of this kit.

**Decision.**

- Forge is that mode. Its scope is any project in a git repository, in any language that has a toolchain mode. A mode of this kit is one kind of thing it builds, not the only one.
- Everything that today is a habit of the reviewer or a file of this kit becomes something a project declares and forge reads. Forge's own code names none of them:

| Today, in this kit | In forge, for any project |
|---|---|
| The owner's request in conversation | The request in prose (`0016`) |
| `CONTEXT.md` | The project's glossary; forge starts one if there is none |
| `docs/adr/` | The project's decision records; forge writes one per decision the owner makes |
| `framework/practices.md` and the language's practices | The project's practices and its toolchain's; a builder is given them by path |
| `framework/features.yaml`, its test and its debt lists | The project's map of modules: entry files, who may import what, known breaks that may only shrink. Forge proposes a first map for a project that has none, and the owner accepts it |
| `docs/briefs/` and the brief template | Slices of a plan, each with a definition of done whose items name a kind of proof |
| The reviewer rerunning checks, diffing output, injecting bugs | The proof mode, by script |
| The capture script | A project's list of commands whose output must not change, or must change only as the plan says |
| `npm run check` | The toolchain's checks and tests |
| Worktrees and merges by hand | The worktrees mode |
| Two builders on disjoint scopes | Waves worked out from the plan (`0017`, item 8) |
| The audit by a second reviewer | The counts of `0017` item 7 on every merge, and a full audit as a job the owner can ask for |

- Kinds of slice are general: a module of the project (one entry in its map), a capability another slice needs, and the project's own shared files. "A mode of the kit" is the first of these in this project.
- What stays a model's judgement stays labelled as judgement: whether a design is sound, whether a test asserts the right thing, what needs a model at all.

**What this adds to the build order.**

1. The typescript mode works on a project that is not the kit. Without it forge can build only the kit. This comes before G7.
2. The proof kinds of G4 and G5 read the project's map, practices and list of commands from the project, never from fixed paths of this kit.
3. After the todo mode, forge is tried on a project that is not agentbay, as part of the evaluation before 5.0.0. Until that has worked, "any product" is a design aim and not a tested claim.

**Not decided.** A second language. `0015` leaves a Go toolchain until after the first real job, and that stands.

**Cost.** A project with no tests, no map and no practices gets little from proof until it has them, so forge's first job there is to set them up, and that job is mostly judgement. Forge will say so on the first card.
