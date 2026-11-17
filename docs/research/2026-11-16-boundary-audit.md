# Boundary audit, 2026-11-16

A read-only audit of `feat/0022-agentbay5` at `e3d0469` by a second reviewer. The owner asked whether boundaries are preserved, after seeing that slices which added one mode also changed many shared files.

**Verdict.** Runs and manifests are real boundaries (5 and 20 exports over 3,759 and 2,802 lines, nothing private reached from outside). Mode source imports only the toolbox. The area a new mode leans on is not a module: toolbox, script protocol, script runner, broker, effect rule, shared types and ports. One toolbox operation is spelled out by hand in six files (`sdk.ts`, `script-host.ts`, `script-protocol.ts`, `script-runner.ts`, `broker.ts`, `effect-rule.ts`), and its shapes sit in `contracts.ts`, `ports.ts` and `answers.ts`. 18 of the 26 kit entries in the debt file touch this area.

**What the feature-map test does not see.** How wide an entry is; types that reach the toolbox through other files; mode tests importing kit test helpers; names in strings and literal lists; the copied schemas.

**Files changed outside the mode's folder and its interface.** G1 29 of 29 (a capability, no mode); G2 14 of 45; G3 35 of 89; G3b 6 of 43. Throwaway folders in G3 touched 14 kernel files in 8 features: the six-file chain, a grants shape written as a literal in 12 places, and a file port that gained three methods every fake had to carry.

**Lists a new mode edits by hand.** `framework/features.yaml` (one entry per mode); `tests/build.test.ts` (the kit's inactive modes); `tests/kit-check.test.ts` (every listed command of every mode, with its line number).

**Also found.** 46 schema files, 2,677 lines, are copied byte for byte between an interface and the mode that implements it. Every action that runs a command must declare all five effects, so effects say nothing for those modes. Mode tests import `tests/mode-harness.ts`, which hands out the kernel. The kit's lint, format and dead-code configuration lives inside the typescript mode, and `package.json` points into it.

## Changes, ranked

| # | Change | Size | Enforced by a test after |
|---|---|---|---|
| 1 | Broker, scripts and the effect rule become one sealed feature; one table per operation, from which host, protocol, runner and rule derive | large | yes |
| 2 | The grants shape is built in one place, with one builder for tests | small | yes |
| 3 | The file port is split; only the broker needs make-folder, link and remove | small | review |
| 4 | The feature map covers modes by a pattern, not an entry each | small | yes |
| 5 | No kit test lists the kit's modes or their manifest lines; fixture projects instead, and a mode's own warnings in its own tests | small | yes |
| 6 | A mode's action takes its schemas from its interface; the copies are deleted | medium | yes |
| 7 | The toolbox's types are declared in `sdk.ts` alone, and a test pins its surface | medium | yes |
| 8 | The mode harness becomes a declared test toolbox that does not hand out the kernel | medium | yes |
| 9 | Effects for a command are scoped per listed command | medium | yes |
| 10 | The kit's tool configuration moves out of the typescript mode | small | yes |

**Leave as they are.** Runs, manifests, mode source imports, interfaces and `context.call` as the only path between modes, command-line as a leaf, and a capability slice kept apart from a mode slice as G1 did.
