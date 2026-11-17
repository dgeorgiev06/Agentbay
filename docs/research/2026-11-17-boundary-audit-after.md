# Boundaries, measured again after the work of ADR 17

Measured on `feat/0022-agentbay5` at `0cd0b86` (2026-11-17) by the reviewer, against the audit of the day before (`2026-11-16-boundary-audit.md`, at `e3d0469`). Each number below was read from the repository, not from a builder's report. Two slices that follow from later decisions (ADR 20) were still running.

## The numbers

| Measure | Before | After |
|---|---|---|
| Debt entries in the feature map, all | 49 | 26 |
| may-not-import | 12 | 7 |
| private-file | 14 | 3 |
| test-reaches-in | 23 | 16 |
| Sealed features | 2 (manifests, runs) | 3 (manifests, runs, broker) |
| Names the broker's entry exports | a class with 16 public methods, and two more entry files | 4 |
| Source files changed to add one operation to the toolbox | 6 to 9 | 3 (`bay/sdk.ts`, `bay/broker/operations.ts`, one file of entries), measured by adding a made-up `files.exists` |
| Schema files copied between an interface and its mode | 46 (2,677 lines) | 0; 11 schema files remain in modes, none a copy |
| Lists a new mode edits by hand | 3 (the feature map, two kit tests) | 0, held by `tests/new-mode-isolation.test.ts` |
| Kernel files a mode's tests could reach | 9, through the mode harness, with the kernel handed out | 0; one test toolbox, which hands out no kernel type, held by the feature map |
| Interfaces with a shared test | 0 of 4 | 4 of 4, each proved with a made-up second implementation |
| Effects on the worktrees mode's read-only actions | all five | read |
| Tests | 1,073 | 1,364 |
| Kernel lines | 15,714 | 16,618 |
| Full check, machine otherwise idle | about 6 minutes | about 12.5 minutes |

## Files changed outside the mode's own folder, per mode slice

The audit's complaint was that a slice which added one mode changed many shared files (14 of 45, 35 of 89, 6 of 43). The mode slices since, each of which worked on one mode and its interface:

| Slice | Files outside `components/` (docs aside) | All files |
|---|---|---|
| S1, the toolchain's shared test | 2 | 7 |
| S2, the worktrees' shared test | 7 | 21 |
| S3, the source's shared test | 2 | 6 |
| E1, the worktrees mode's true effects | 1 | 7 |

Every file outside `components/` in these four is a test that writes a made-up second implementation, or the one place the helpers for that were gathered. None is a kernel file and none is a list.

## The audit's ten changes

| # | Change | State |
|---|---|---|
| 1 | Broker, scripts and the effect rule as one sealed feature with a table of operations | Done (B1 to B7), with a ruling per operation |
| 2 | Grants built in one place | Done (K1), held by a test |
| 3 | The file port split | Done (K1) |
| 4 | The feature map covers modes by a rule | Done (I1) |
| 5 | No kit test lists the kit's modes | Done (I1) |
| 6 | Schemas come from the interface | Done (I2) |
| 7 | The toolbox's types in one file, its surface pinned | Done (B2) |
| 8 | A test toolbox for modes that hands out no kernel | Done (I3) |
| 9 | Effects per listed command | Done (B7), and the worktrees mode declares true effects (E1) |
| 10 | The kit's tool configuration out of the typescript mode | Done in part by decision: the dead-code configuration moved; lint and format stay as the standard that mode ships |

## What is not as good as it looks

- **The kernel grew by about 900 lines.** The entries name what each rule allows as a type of its own, and the checks for shared tests and listed commands are new. Places fell; lines did not.
- **The suite takes twice as long.** The tests that copy the whole kit to prove a made-up mode are most of it. A slice to cut that is queued.
- **26 debt entries remain.** 16 are tests that reach into features not yet behind an entry (check, secrets, platform, agent-tools, command-line). Those features were not part of this work.
- **Two shared-file habits remain in mode slices:** a made-up second implementation lives under the kit's `tests/`, and a new glossary word goes into `CONTEXT.md`.
- **Three effects are wider than their meaning** in the worktrees mode (`copy`, `overlay`, `cut`), because one listed command cannot be narrowed without a kernel capability.
- **A mode that lives in a project is still second-class:** it cannot list commands until trust is built (ADR 21), and the typescript mode does not yet work on a project that is not the kit.
- **`bay check` counts a type-only import of a shared test as running it.** Queued.
