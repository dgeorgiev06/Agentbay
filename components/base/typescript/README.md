# typescript

The mode `typescript` implements `toolchain@1`. It checks and tests TypeScript code in a checkout, and it holds the lint and format configuration that is its standard for TypeScript code. The kit uses that configuration as any project would.

## Actions

| Action | What it does |
|---|---|
| `describe` | Names the language, the patterns of its source and test files, its practices file and its checks, and which agreed scripts the project's `package.json` has and lacks. It reads that file and runs nothing. |
| `check` | Runs each check, or the named ones, in the folder it is given, one after another, and gives each a verdict. |
| `test` | Runs `npm test` in the folder it is given with the TAP reporter, on every test or on named files, and gives one verdict with the counts. |

The folder given to `check` and `test` is a throwaway copy of the code. The caller makes it for the call and removes it afterwards; it is never a worktree a builder works in. The checkout's own scripts may write inside it, such as a cache or a build output, and must write nothing outside it. The mode cannot stop them: they run as listed commands, unconfined. A second call on the same folder gives the same verdicts.

A check is the checkout's own `package.json` script of the same name. The mode brings no compiler, linter or formatter settings to a project: the project keeps its tools and their settings. The agreed scripts are `typecheck`, `lint`, `format:check`, `deadcode` and `test`, which every project needs, and `generate:check`, which only the kit has. The mode runs `npm run <name> --`. To change what a check does, change that script in `package.json`; in the kit `npm run check` runs the same scripts, so a person and the mode run the same thing. The list of agreed scripts, and what to add for each, is in `scripts/lib/checks.ts`.

Before it runs anything, `check` and `test` read the checkout's `package.json` with `cat` and keep only the names of its scripts. `cat` is not the project's code, and the mode returns none of the file. `describe` reads the project's own `package.json` through its granted read. A required script the checkout lacks, or whose value is not text or is blank, is not set up: its verdict is inconclusive, with a sentence that names the script and says what to add, and npm is not run for it. A `package.json` that is missing or is not JSON makes every required check inconclusive in the same way. `generate:check` runs only where the checkout has the script, and `describe` lists it only where the project has it.

A verdict is `passed`, `failed` or `inconclusive`:

- `passed`: the check ended with exit code 0. For `test`, the run also ended with exit code 0, reported at least one test, and no test failed or was cancelled.
- `failed`: the check ended with an exit code its tool uses for a finding (1; for `typecheck` also 2, which `tsc` uses for a type error). For `test`, exit code 1 with at least one failed test.
- `inconclusive`: anything else. The checkout is not set up for the check, the folder does not exist, the time limit was hit, a signal stopped it, the exit code is one the mode does not know, or the test run printed no summary or reported no tests. An inconclusive verdict is never a pass.

## Commands

The mode lists exactly the commands its scripts run, in `resources.commands`. Each runs code from the checkout it is given; that is its purpose.

| Prefix | Run by |
|---|---|
| `cat -- package.json` | `check` and `test`, before anything else |
| `npm run generate:check --` and the four other checks | `check` |
| `npm test -- --test-reporter=tap` | `test`, followed by the named test files |

## Configuration

`mode.yaml` lists these files under `extraFiles`, so the mode-folder layout accepts them at the top of the folder. The scripts in the root `package.json` pass them with `--config`, so no copy sits at the repository root. `tsconfig.json` stays at the root because the compiler and the type-checked lint rules look for it there. The kit's dead-code configuration, `knip.json`, is not part of this mode: it names the kit's own entry files, so it sits at the kit's root and `npm run deadcode` passes it with `--config`.

| File | Used by | Enforces |
|---|---|---|
| `eslint.config.js` | `npm run lint` | typescript-eslint `strictTypeChecked`; no `any`; no non-null `!`; private members never reassigned are `readonly`; no type assertion except `as const`; every `switch` over a union is exhaustive; exported functions state their parameter and return types; at most three parameters; complexity at most 10; no nested ternary; no reassigned parameter; no default export; no `enum`; no class `extends`; no `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; inline `eslint-disable` comments have no effect and are reported, and `--max-warnings 0` fails on them; files under `components/` import from `bay/` only `bay/sdk.ts`, import no file of another mode folder (`components/<tier>/<mode>/`, checked to six folder levels inside a mode) except an interface's shared test (`interfaces/<name>/tests/shared.ts`) and use no dynamic `import()`; files under `adapters/` import from `bay/` only `bay/sdk.ts` and `bay/adapter.ts`; files under `bay/` other than `cli.ts` and `mcp.ts` import neither `cli.ts`, `mcp.ts` nor anything under `adapters/` |
| `prettier.json` | `npm run format:check` | Prettier with a line width of 120 |
| `practices.md` | builders and reviewers; `describe` names it | The TypeScript practices TS-01 to TS-17 |

Not enforced here: import cycles and files that only re-export (they need an eslint plugin, so `bay check` will do it), and comment lines in kit code (a `bay check` measure).

## Time limits

Left out, a check may take 90 seconds and a test run 420. A call may ask for at most 1,000 seconds. The `check` and `test` actions declare `scriptTimeLimitSeconds: 1030`: the 1,000 a call may ask for, and 30 seconds for the script to answer. All the checks of one call must end within that step limit; a check that starts late gets only what is left, and one with no time left is inconclusive.
