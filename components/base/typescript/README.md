# typescript

The mode `typescript` implements `toolchain@1`. It checks and tests TypeScript code in a checkout, and it holds the lint and format configuration that is its standard for TypeScript code. The kit uses that configuration as any project would.

## Actions

| Action | What it does |
|---|---|
| `describe` | Names the language, the patterns of its source and test files, its practices file and its checks, and which agreed scripts the project's `package.json` has and lacks. It reads that file and runs nothing. |
| `check` | Runs each check, or the named ones, in the folder it is given, one after another, and gives each a verdict. |
| `test` | Runs `npm test` in the folder it is given with the TAP reporter, on every test or on named files, and gives one verdict with the counts; a failed run also names its failing cases and the test files that did not load. |
| `run` | Runs one script of the checkout's own `package.json`, by its name, in the folder it is given, with the words it is given, and says how it ended, what it printed to its standard output, and how long it took. |

The folder given to `check`, `test` and `run` is a throwaway copy of the code. The caller makes it for the call and removes it afterwards; it is never a worktree a builder works in. The checkout's own scripts may write inside it, such as a cache or a build output, and must write nothing outside it. The mode cannot stop them: they run as listed commands, unconfined. A second call on the same folder gives the same verdicts.

A check is the checkout's own `package.json` script of the same name. The mode brings no compiler, linter or formatter settings to a project: the project keeps its tools and their settings. The agreed scripts are `typecheck`, `lint`, `format:check`, `deadcode` and `test`, which every project needs, and `generate:check`, which only the kit has. The mode runs `npm run <name> --`. To change what a check does, change that script in `package.json`; in the kit `npm run check` runs the same scripts, so a person and the mode run the same thing. The list of agreed scripts, and what to add for each, is in `scripts/lib/checks.ts`.

Before it runs anything, `check` and `test` read the checkout's `package.json` with `cat` and keep only the names of its scripts. `cat` is not the project's code, and the mode returns none of the file. `describe` reads the project's own `package.json` through its granted read. A required script the checkout lacks, or whose value is not text or is blank, is not set up: its verdict is inconclusive, with a sentence that names the script and says what to add, and npm is not run for it. A `package.json` that is missing or is not JSON makes every required check inconclusive in the same way. `generate:check` runs only where the checkout has the script, and `describe` lists it only where the project has it.

A verdict is `passed`, `failed` or `inconclusive`:

- `passed`: the check ended with exit code 0. For `test`, the run also ended with exit code 0, reported at least one test, and no test failed or was cancelled.
- `failed`: the check ended with an exit code its tool uses for a finding (1; for `typecheck` also 2, which `tsc` uses for a type error). For `test`, exit code 1 with at least one failed test.
- `inconclusive`: anything else. The checkout is not set up for the check, the folder does not exist, the time limit was hit, a signal stopped it, the exit code is one the mode does not know, or the test run printed no summary or reported no tests. An inconclusive verdict is never a pass.

## Running a script by its name

`run` takes the name of a script of the checkout's `package.json`, such as `demo`, never a command line. It reads the checkout's `package.json` with `cat` first, as `check` and `test` do. A name the checkout's `package.json` does not have, or a `package.json` that is missing or is not JSON, is not set up: the answer says so in a sentence and npm is not run. Otherwise the mode runs `npm run --silent -- <name> <words>`. Each word reaches the script as one argument, exactly as written: npm quotes it for the shell that runs the script, so no shell splits it or reads what it holds. A word holds no control character, such as a new line; the request's schema refuses one. `--silent` keeps npm's own lines out of the standard output, so the output is what the script printed.

The answer's `ended` is `exited`, with the exit code; `timed-out`, when the script did not end within its time limit and was stopped; `signalled`, when a signal stopped npm; `not set up`; or `not started`, such as in a folder that does not exist. A script that ran gives its standard output as the kernel keeps it: when it printed more than the kernel keeps, `stdout` holds the end and `stdoutCut` is true. Its standard error is not given. Left out, the time limit is 90 seconds; a call may ask for at most 3,600.

The script is the project's own code. It runs unconfined, in the folder it is given, exactly as the project's checks and tests do: the copy limits where it writes by convention only.

## Failing cases

A failed test run names what failed, read from node's TAP output:

- `failures`: each failing case, in the order of the output, at most 50. A case is a `not ok` entry: a test, a hook's or a group's own failure, or a test cancelled with it. Not a case: a group or a test that failed only because a case under it did (node's `subtestsFailed`), a test marked to do, or a whole test file.
- A case is its `name`, its `file` and its `message`. The file is where node locates the case, relative to the folder given: the file that declares the test, which for a shared test is the shared file. It is empty when node gives no location.
- The message is the first line of node's error for the case that is not blank, with the spaces around it removed. For node's own assertions that line holds no value, such as "Expected values to be strictly equal:". The later lines hold the expected and actual values, or the source of an `assert.ok`; they, the stack, and the line and column are never given.
- A message longer than 200 characters keeps its first 200, and `charactersCut` says how many were cut, counting those node itself left out of a very long line.
- `failuresNotListed` counts the cases past the first 50. When the kernel cut the output, it also counts the failures node's summary counts beyond the `not ok` entries the kept end shows: a group that failed only because a case under it did is among them when the cut took it.
- `notLoaded`: each test file node reports as failed as a whole, with an exit code: it did not parse, an import was missing, or it threw outside its cases. Such a file is never a case. Node reports a file this way only when no case of it failed.

To make the paths relative, the mode runs `pwd -P` in the folder after a failed run. If that gives no answer, a path is given in full, as node gives it.

## Commands

The mode lists exactly the commands its scripts run, in `resources.commands`. Each runs code from the checkout it is given; that is its purpose.

| Prefix | Run by |
|---|---|
| `cat -- package.json` | `check`, `test` and `run`, before anything else |
| `npm run generate:check --` and the four other checks | `check` |
| `npm test -- --test-reporter=tap` | `test`, followed by the named test files |
| `pwd -P` | `test`, after a run that failed, to name each file relative to the folder |
| `npm run --silent --` | `run`, followed by the script's name and the words it is given |

## Configuration

`mode.yaml` lists these files under `extraFiles`, so the mode-folder layout accepts them at the top of the folder. The scripts in the root `package.json` pass them with `--config`, so no copy sits at the repository root. `tsconfig.json` stays at the root because the compiler and the type-checked lint rules look for it there. The kit's dead-code configuration, `knip.json`, is not part of this mode: it names the kit's own entry files, so it sits at the kit's root and `npm run deadcode` passes it with `--config`.

| File | Used by | Enforces |
|---|---|---|
| `eslint.config.js` | `npm run lint` | typescript-eslint `strictTypeChecked`; no `any`; no non-null `!`; private members never reassigned are `readonly`; no type assertion except `as const`; every `switch` over a union is exhaustive; exported functions state their parameter and return types; at most three parameters; complexity at most 10; no nested ternary; no reassigned parameter; no default export; no `enum`; no class `extends`; no `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; inline `eslint-disable` comments have no effect and are reported, and `--max-warnings 0` fails on them; files under `components/` import from `bay/` only `bay/sdk.ts`, import no file of another mode folder (`components/<tier>/<mode>/`, checked to six folder levels inside a mode) except an interface's shared test (`interfaces/<name>/tests/shared.ts`) and use no dynamic `import()`; files under `components/` that are not tests read no clock and draw no random value themselves (`Date.now()`, `Date()`, `new Date()` with no arguments, `Math.random()`, and `randomBytes`, `randomUUID`, `randomInt`, `randomFill`, `randomFillSync` or `getRandomValues`, called, computed, through `globalThis`, taken apart or imported from `crypto`, and `Date` or `Math` given to a variable), and are pointed at `context.now()` and `context.random(bytes)`, which a step run again gets back unchanged; the rule cannot see other aliases, `Intl` formatting with no date, `performance.now()` or `process.hrtime()`; files under `adapters/` import from `bay/` only `bay/sdk.ts` and `bay/adapter.ts`; files under `bay/` other than `cli.ts` and `mcp.ts` import neither `cli.ts`, `mcp.ts` nor anything under `adapters/` |
| `prettier.json` | `npm run format:check` | Prettier with a line width of 120 |
| `practices.md` | builders and reviewers; `describe` names it | The TypeScript practices TS-01 to TS-27 |

Not enforced here: import cycles and files that only re-export (they need an eslint plugin, so `bay check` will do it), and comment lines in kit code (a `bay check` measure).

## Time limits

Left out, a check may take 90 seconds and a test run 420. A call may ask for at most 3,600 seconds, the most `toolchain@1` allows. The `check`, `test` and `run` actions declare `scriptTimeLimitSeconds: 3630`: the 3,600 a call may ask for, and 30 seconds for the script to answer. All the checks of one call must end within that step limit; a check that starts late gets only what is left, and one with no time left is inconclusive.
