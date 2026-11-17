# typescript

The mode `typescript` implements `toolchain@1`. It checks and tests TypeScript code in a checkout, and it holds the lint and format configuration that is its standard for TypeScript code. The kit uses that configuration as any project would.

## Actions

| Action | What it does |
|---|---|
| `describe` | Names the language, the patterns of its source and test files, its practices file and its checks. It runs nothing. |
| `check` | Runs each check, or the named ones, in the folder it is given, one after another, and gives each a verdict. |
| `test` | Runs `npm test` in the folder it is given with the TAP reporter, on every test or on named files, and gives one verdict with the counts. |

The folder given to `check` and `test` is a throwaway copy of the code. The caller makes it for the call and removes it afterwards; it is never a worktree a builder works in. The checkout's own scripts may write inside it, such as a cache or a build output, and must write nothing outside it. The mode cannot stop them: they run as listed commands, unconfined. A second call on the same folder gives the same verdicts.

A check is the checkout's own `package.json` script of the same name: `generate:check`, `typecheck`, `lint`, `format:check`, `deadcode`. The mode runs `npm run <name> --`. To change what a check does, change that script in `package.json`; `npm run check` runs the same scripts, so a person and the mode run the same thing. The mode's list of names is in `scripts/lib/checks.ts`.

A verdict is `passed`, `failed` or `inconclusive`:

- `passed`: the check ended with exit code 0. For `test`, the run also ended with exit code 0, reported at least one test, and no test failed or was cancelled.
- `failed`: the check ended with an exit code its tool uses for a finding (1; for `typecheck` also 2, which `tsc` uses for a type error). For `test`, exit code 1 with at least one failed test.
- `inconclusive`: anything else. The script is missing, the folder does not exist, the time limit was hit, a signal stopped it, the exit code is one the mode does not know, or the test run printed no summary or reported no tests. An inconclusive verdict is never a pass.

## Commands

The mode lists exactly the commands its scripts run, in `resources.commands`. Each runs code from the checkout it is given; that is its purpose.

| Prefix | Run by |
|---|---|
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

## Limits

The folder given to `check` and `test` must be a checkout of the kit, or of a project that is the kit: its `package.json` must have the five check scripts and `test`. A project beside the kit has none of them, so every check is inconclusive there.
