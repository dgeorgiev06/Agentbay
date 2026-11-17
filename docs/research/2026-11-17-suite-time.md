# The suite's time, measured per file

Measured on `sp1/suite-time` (cut from `feat/0022-agentbay5` at `79d2a13`) on 2026-11-17 by the builder of slice SP1. The machine has 2 cores (`nproc`, `os.availableParallelism()`). Nothing else ran tests during any timed run; `pgrep -f "node --test"` was checked before each.

## The numbers

| Measure | Before | After |
|---|---|---|
| Files run at once by `npm test` | 1 (node's default: cores minus one) | 3 (cores plus one) |
| `npm test` wall time, three runs alone | 622.3, 645.1, 663.5 s | 447.7, 452.0, 453.0 s |
| Median | 645.1 s | 452.0 s (70 per cent of before) |
| CPU time of one run (user and system, all processes) | 879.5 s | 864.1 s |
| Tests | 1,503 | 1,503 |

The suite does not run in half the time. It is bound by CPU. One run needs about 870 CPU seconds whatever the number of files at once, and the machine gives 2 CPU seconds per second. The floor is about 435 s. Measured with the same command and only the number of files at once changed: 1 file 661.9 s, 2 files 471.0 s, 3 files 449.2 s, 4 files 451.4 s. Three is past the knee; four gains nothing.

Half (322 s) needs the CPU time cut to about 600 s. The tests do not hold that much to cut without proving less: the CPU is spent in processes the kernel starts and in work the kernel repeats. The two kernel costs below hold most of it.

## What the time is spent on

- **Copying the kit is not the cost.** One copy of the kit (635 files) takes 0.11 s. The tests that copy it are slow because of what they run inside the copy.
- **A script host per step.** Every script step starts a node process with the permission model, the preload and the host (`bay/broker/script-runner.ts`). One start costs about 0.125 CPU seconds before the script itself loads. One run of the suite starts 2,307 script hosts: about 290 CPU seconds, a third of the suite.
- **A database process per opened step broker.** One run starts 1,105 database processes (`bay/broker/database-child.ts`), about 0.075 CPU seconds each to start: about 80 CPU seconds.
- **A new Ajv compile per checked value.** `checkValue` in `bay/manifests/spec.ts` builds a new Ajv instance and compiles the schema for every value it checks, with no cache. In the test files' own processes alone this is 118.7 CPU seconds of the run (profiled with `--cpu-prof`). Kernels started by nested runs, such as the made-up modes' shared tests, were not profiled, so the true figure is higher.
- **Waiting is small.** The time limits the tests wait for are already 2 s (the toolchain shared test's two cases). The rest of the wall time is CPU.

Counts of processes come from one run in a throwaway copy whose `bay/node-ports.ts` appended one line per start to a file. The repository's `bay/` was not changed.

## What fixing each kernel cost would save

| Kernel cost | Measured | A fix | Saving, estimated |
|---|---|---|---|
| Ajv compile per checked value | at least 118.7 CPU s per run | keep one compiled validator per schema for the kernel's life | about 110 CPU s, about 55 s of wall time at 3 files at once |
| A script host process per step | 2,307 starts, about 290 CPU s | a host that starts faster, or one host kept for the steps of a run | half the start cost saves about 145 CPU s, about 70 s of wall time |
| A database process per step broker | 1,105 starts, about 80 CPU s | one database process per mode and run | about 60 CPU s, about 30 s |

With the first two fixed the CPU time falls to about 600 s and half is within reach at 3 files at once.

## The twenty slowest files

Each file alone, the median of three runs, and its CPU time (user and system, with every process it starts) from one more run alone. No adapter test is among them.

| Rank | File | Alone, median s | CPU s | What it spends its time on |
|---|---|---|---|---|
| 1 | `tests/shared-tests-in-a-project.test.ts` | 73.5 | 137.5 | Starts processes: three projects, then six `node --test` runs of made-up modes' shared tests at once, and `bay check`. Inside them, a script host per step. |
| 2 | `tests/new-mode-isolation.test.ts` | 48.0 | 67.3 | Starts processes: `tsc` and `knip` twice on a copy of the kit, `bay check` three times, five test files, a git commit of the whole kit. The copy itself takes 0.1 s. |
| 3 | `components/modes/feed-briefing/tests/feed-briefing.test.ts` | 43.6 | 57.4 | Opens a project per test (each test writes), and a script host per step of sync, digest and ask. |
| 4 | `tests/made-up-worktrees.test.ts` | 41.6 | 54.2 | Starts processes: `bay check`, then two worktrees shared tests one after the other, each case opening a project with a git repository. |
| 5 | `components/base/git-worktrees/tests/worktrees.test.ts` | 32.4 | 36.6 | Opens a project and a git repository per case, as the shared test's design says (cases write); git commands and a script host per step. |
| 6 | `components/base/typescript/tests/kit.test.ts` | 30.3 | 45.7 | Runs the TypeScript mode's checks on a copy of the kit: `tsc`, `eslint`, `prettier`, `knip`. This is `npm run check` without its tests. |
| 7 | `components/base/store/tests/items-store.test.ts` | 29.8 | 39.5 | One opened project for 23 cases; a script host and a database process per action; an Ajv compile per checked value. |
| 8 | `tests/made-up-toolchains.test.ts` | 27.9 | 52.2 | Starts processes: six toolchain shared tests at once; two cases in each wait for a 2 s time limit. |
| 9 | `tests/made-up-sources.test.ts` | 24.6 | 32.2 | Starts processes: two items-source shared tests, one after the other. |
| 10 | `components/modes/feed-briefing/tests/monthly-cap.test.ts` | 18.5 | 23.6 | Opens a project per test (each test writes) and syncs through script hosts. |
| 11 | `tests/script-runner.test.ts` | 15.1 | 17.9 | Starts a script host for each of 47 tests. |
| 12 | `components/base/typescript/tests/toolchain.test.ts` | 14.9 | 13.7 | The toolchain shared test on real tools in small checkouts; two cases wait for a 2 s time limit. |
| 13 | `components/modes/fake-source/tests/items-source.test.ts` | 11.9 | 15.9 | The items-source shared test; opens three projects by its design. |
| 14 | `components/base/git-worktrees/tests/sentences.test.ts` | 11.9 | 16.2 | Opens a repository project per test and runs git through script hosts. |
| 15 | `components/modes/feed-briefing/tests/session.test.ts` | 10.7 | 15.6 | Starts `bay` processes in a fresh project: check, build, sync, digest, workflow. |
| 16 | `components/modes/feed-briefing/tests/two-briefings.test.ts` | 10.5 | 14.8 | Starts `bay` processes in a project with two briefings. |
| 17 | `tests/tools.test.ts` | 8.2 | 10.2 | Opens a kernel per test; the agent's tools run steps through script hosts. |
| 18 | `tests/cli-runs.test.ts` | 8.1 | 9.8 | Starts a `bay` process per command. |
| 19 | `components/base/typescript/tests/test.test.ts` | 8.0 | 5.2 | Runs `node --test` inside small checkouts; one waits for its time limit. |
| 20 | `components/base/git-worktrees/tests/with-typescript.test.ts` | 8.0 | 10.6 | Copies a commit of the kit into a worktree and runs `tsc` on it. |

## Ways the brief listed, and what came of each

- **Share one copied kit among a file's tests.** Already so: each file that copies the kit copies it once, in `before`. The copy costs 0.1 s.
- **Share one opened project among cases that share it by design.** Already so for the items-store, items-source and toolchain shared tests. The worktrees shared test opens a project per case because its cases write; sharing it would share written state.
- **Run a wrong made-up mode only against the cases it fails plus one.** Every such test claims the mode fails only those cases (`assert.deepEqual` on the failed list, and the count of passes). No cheaper proof of "only" was found, so they are left as they are. The forgetful store already runs only its one case, because its claim is only that it fails that case.
- **Shorten waits.** The waits are 2 s already. A lower limit would apply to every check in the case and risk a check stopped under load.
- **Run more files at once.** Done: `npm test` runs cores plus one files at once. The suite passed three times with its 130 files in shuffled order at 3 at once (462.3, 447.3, 455.5 s) and once at 1 at once (691.7 s). The kit's tree was unchanged after each run.

## How to measure again

`npm run test:times` runs every test file alone, one after another, and prints the table below from that one run, slowest first, with the test count and the wall time.

## Every file alone, before

Three runs of `npm run test:times` before the change, median per file. Wall times of the three runs: 648.3, 642.9, 636.3 s.

| Rank | Median s | Runs s | Tests | File |
|---|---|---|---|---|
| 1 | 73.5 | 74.0 / 72.1 / 73.5 | 5 | tests/shared-tests-in-a-project.test.ts |
| 2 | 48.0 | 50.2 / 48.0 / 47.2 | 5 | tests/new-mode-isolation.test.ts |
| 3 | 43.6 | 43.6 / 45.0 / 42.7 | 13 | components/modes/feed-briefing/tests/feed-briefing.test.ts |
| 4 | 41.6 | 44.4 / 40.0 / 41.6 | 3 | tests/made-up-worktrees.test.ts |
| 5 | 32.4 | 32.7 / 32.4 / 31.7 | 32 | components/base/git-worktrees/tests/worktrees.test.ts |
| 6 | 30.3 | 27.8 / 30.3 / 31.5 | 2 | components/base/typescript/tests/kit.test.ts |
| 7 | 29.8 | 29.6 / 34.7 / 29.8 | 23 | components/base/store/tests/items-store.test.ts |
| 8 | 27.9 | 29.7 / 26.5 / 27.9 | 6 | tests/made-up-toolchains.test.ts |
| 9 | 24.6 | 26.2 / 24.3 / 24.6 | 2 | tests/made-up-sources.test.ts |
| 10 | 18.5 | 18.6 / 18.5 / 17.9 | 8 | components/modes/feed-briefing/tests/monthly-cap.test.ts |
| 11 | 15.1 | 15.1 / 15.1 / 15.3 | 47 | tests/script-runner.test.ts |
| 12 | 14.9 | 14.9 / 14.8 / 15.6 | 16 | components/base/typescript/tests/toolchain.test.ts |
| 13 | 11.9 | 11.2 / 13.1 / 11.9 | 13 | components/modes/fake-source/tests/items-source.test.ts |
| 14 | 11.9 | 11.9 / 11.9 / 13.0 | 9 | components/base/git-worktrees/tests/sentences.test.ts |
| 15 | 10.7 | 10.4 / 10.7 / 11.3 | 1 | components/modes/feed-briefing/tests/session.test.ts |
| 16 | 10.5 | 10.5 / 11.2 / 10.1 | 2 | components/modes/feed-briefing/tests/two-briefings.test.ts |
| 17 | 8.2 | 9.1 / 7.9 / 8.2 | 15 | tests/tools.test.ts |
| 18 | 8.1 | 8.7 / 8.1 / 8.0 | 15 | tests/cli-runs.test.ts |
| 19 | 8.0 | 7.9 / 8.0 / 8.4 | 11 | components/base/typescript/tests/test.test.ts |
| 20 | 8.0 | 8.1 / 7.9 / 8.0 | 1 | components/base/git-worktrees/tests/with-typescript.test.ts |
| 21 | 7.2 | 7.2 / 7.4 / 7.0 | 6 | components/base/store/tests/store-sql.test.ts |
| 22 | 6.6 | 7.0 / 5.6 / 6.6 | 18 | tests/test-toolbox.test.ts |
| 23 | 6.6 | 6.6 / 6.7 / 6.0 | 2 | tests/end-to-end.test.ts |
| 24 | 5.9 | 6.3 / 5.8 / 5.9 | 4 | components/base/store/tests/store-items.test.ts |
| 25 | 5.5 | 6.0 / 5.4 / 5.5 | 23 | tests/script-commands.test.ts |
| 26 | 5.5 | 5.5 / 5.5 / 5.1 | 1 | tests/first-session.test.ts |
| 27 | 5.0 | 5.0 / 4.9 / 5.3 | 1 | tests/check-equals-load.test.ts |
| 28 | 4.9 | 5.6 / 4.9 / 4.8 | 9 | tests/mcp.test.ts |
| 29 | 4.5 | 4.5 / 4.7 / 4.1 | 24 | tests/broker-database.test.ts |
| 30 | 4.3 | 4.3 / 4.5 / 4.0 | 5 | components/base/typescript/tests/check.test.ts |
| 31 | 3.9 | 4.1 / 3.9 / 3.5 | 24 | tests/approve-trust.test.ts |
| 32 | 3.9 | 3.7 / 4.3 / 3.9 | 5 | components/base/git-worktrees/tests/hooks.test.ts |
| 33 | 3.4 | 3.4 / 3.5 / 3.3 | 4 | tests/bindings-per-requirer.test.ts |
| 34 | 3.3 | 3.3 / 3.3 / 3.6 | 7 | tests/inside/runs/engine-crash.test.ts |
| 35 | 3.1 | 3.0 / 3.1 / 3.3 | 3 | components/base/git-worktrees/tests/merge.test.ts |
| 36 | 3.0 | 3.2 / 3.0 / 2.8 | 11 | tests/cli-owner.test.ts |
| 37 | 3.0 | 2.4 / 3.5 / 3.0 | 11 | adapters/claude-code/tests/step-guard.test.ts |
| 38 | 2.9 | 2.9 / 3.5 / 2.8 | 1 | components/modes/feed-briefing/tests/database-files.test.ts |
| 39 | 2.7 | 2.9 / 2.7 / 2.5 | 10 | tests/unexpected-errors.test.ts |
| 40 | 2.6 | 2.6 / 2.7 / 2.5 | 10 | tests/node-ports-broker.test.ts |
| 41 | 2.5 | 2.7 / 2.5 / 2.3 | 3 | tests/kit-check.test.ts |
| 42 | 2.4 | 2.4 / 2.4 / 2.6 | 1 | tests/runs-processes.test.ts |
| 43 | 2.4 | 2.4 / 2.4 / 2.7 | 30 | tests/runs-actions.test.ts |
| 44 | 2.4 | 2.3 / 2.4 / 2.4 | 1 | tests/grants-in-one-place.test.ts |
| 45 | 2.4 | 2.4 / 2.4 / 2.2 | 13 | tests/broker-effects.test.ts |
| 46 | 2.4 | 2.3 / 2.4 / 2.4 | 3 | components/base/git-worktrees/tests/apply.test.ts |
| 47 | 2.2 | 2.3 / 2.2 / 2.0 | 23 | tests/runs.test.ts |
| 48 | 2.2 | 2.7 / 2.2 / 2.0 | 22 | tests/check-imports.test.ts |
| 49 | 2.2 | 2.1 / 2.4 / 2.2 | 2 | components/base/git-worktrees/tests/listed-commands.test.ts |
| 50 | 2.1 | 2.2 / 2.1 / 1.9 | 23 | tests/runs-workflows.test.ts |
| 51 | 2.0 | 2.0 / 2.2 / 2.0 | 6 | components/modes/fake-source/tests/fake-source.test.ts |
| 52 | 1.9 | 1.9 / 2.0 / 1.9 | 16 | tests/check-skills.test.ts |
| 53 | 1.7 | 2.0 / 1.6 / 1.7 | 7 | tests/kernel.test.ts |
| 54 | 1.7 | 1.6 / 1.8 / 1.7 | 23 | tests/check.test.ts |
| 55 | 1.7 | 1.7 / 2.0 / 1.6 | 4 | tests/actions-tool.test.ts |
| 56 | 1.7 | 1.6 / 1.7 / 1.8 | 3 | components/base/git-worktrees/tests/cut.test.ts |
| 57 | 1.6 | 1.6 / 1.5 / 2.0 | 11 | tests/cli-actions.test.ts |
| 58 | 1.6 | 1.8 / 1.6 / 1.6 | 12 | tests/check-layout.test.ts |
| 59 | 1.5 | 1.6 / 1.5 / 1.4 | 6 | tests/script-command-listing.test.ts |
| 60 | 1.4 | 1.4 / 1.4 / 1.4 | 3 | tests/inside/broker/proofs.test.ts |
| 61 | 1.4 | 1.4 / 1.4 / 1.2 | 1 | components/base/store/tests/store-query.test.ts |
| 62 | 1.3 | 1.4 / 1.3 / 1.2 | 69 | tests/manifests.test.ts |
| 63 | 1.3 | 1.1 / 1.4 / 1.3 | 1 | components/base/typescript/tests/listed-commands.test.ts |
| 64 | 1.2 | 1.2 / 1.1 / 1.3 | 9 | tests/runs-caller.test.ts |
| 65 | 1.2 | 1.2 / 1.2 / 1.1 | 2 | tests/database-files.test.ts |
| 66 | 1.1 | 1.2 / 1.0 / 1.1 | 14 | tests/runs-scrub.test.ts |
| 67 | 1.1 | 1.4 / 1.1 / 1.1 | 8 | tests/cli-project.test.ts |
| 68 | 1.1 | 1.1 / 1.0 / 1.1 | 7 | tests/broker-partitions.test.ts |
| 69 | 1.1 | 1.0 / 1.1 / 1.1 | 1 | components/base/git-worktrees/tests/set-aside.test.ts |
| 70 | 1.1 | 1.0 / 1.1 / 1.3 | 1 | components/base/git-worktrees/tests/remove.test.ts |
| 71 | 1.0 | 1.0 / 1.1 / 1.0 | 5 | tests/check-limits.test.ts |
| 72 | 1.0 | 1.0 / 1.0 / 1.1 | 1 | adapters/claude-code/tests/end-to-end.test.ts |
| 73 | 0.9 | 1.1 / 0.9 / 0.9 | 1 | tests/toolbox-surface.test.ts |
| 74 | 0.9 | 0.9 / 0.9 / 0.9 | 44 | tests/manifests-load.test.ts |
| 75 | 0.9 | 0.9 / 0.9 / 0.9 | 26 | tests/manifests-grants.test.ts |
| 76 | 0.9 | 0.8 / 0.9 / 0.9 | 1 | components/base/git-worktrees/tests/changed.test.ts |
| 77 | 0.8 | 0.9 / 0.8 / 0.8 | 1 | tests/effects.test.ts |
| 78 | 0.7 | 0.7 / 0.7 / 0.7 | 3 | tests/script-throwaway.test.ts |
| 79 | 0.7 | 0.7 / 0.6 / 0.7 | 4 | tests/runs-tokens.test.ts |
| 80 | 0.7 | 0.7 / 0.7 / 0.6 | 14 | tests/new.test.ts |
| 81 | 0.7 | 0.7 / 0.7 / 0.7 | 1 | tests/cli-trust-at-use.test.ts |
| 82 | 0.7 | 0.7 / 0.7 / 0.7 | 2 | tests/broker-commands.test.ts |
| 83 | 0.6 | 0.6 / 0.6 / 0.6 | 21 | tests/manifests-schemas.test.ts |
| 84 | 0.6 | 0.6 / 0.7 / 0.6 | 2 | tests/cli-commands-measure.test.ts |
| 85 | 0.6 | 0.5 / 0.6 / 0.6 | 7 | tests/check-trust.test.ts |
| 86 | 0.6 | 0.6 / 0.5 / 0.6 | 6 | tests/build.test.ts |
| 87 | 0.5 | 0.5 / 0.5 / 0.5 | 2 | tests/runs-writers.test.ts |
| 88 | 0.5 | 0.6 / 0.5 / 0.5 | 12 | tests/manifests-folders.test.ts |
| 89 | 0.5 | 0.5 / 0.4 / 0.5 | 9 | tests/manifests-bindings.test.ts |
| 90 | 0.5 | 0.5 / 0.5 / 0.6 | 34 | tests/feature-map.test.ts |
| 91 | 0.5 | 0.5 / 0.6 / 0.5 | 1 | components/base/typescript/tests/describe.test.ts |
| 92 | 0.4 | 0.4 / 0.5 / 0.4 | 3 | tests/script-runner-folders.test.ts |
| 93 | 0.4 | 0.4 / 0.4 / 0.4 | 12 | tests/manifests-interface-schemas.test.ts |
| 94 | 0.4 | 0.4 / 0.4 / 0.4 | 9 | tests/broker-list-trust.test.ts |
| 95 | 0.3 | 0.3 / 0.2 / 0.3 | 0 | tests/test-toolbox.ts |
| 96 | 0.3 | 0.3 / 0.3 / 0.3 | 1 | tests/run-report.test.ts |
| 97 | 0.3 | 0.3 / 0.2 / 0.3 | 15 | tests/inside/runs/run-store.test.ts |
| 98 | 0.3 | 0.3 / 0.3 / 0.3 | 4 | tests/generate-types.test.ts |
| 99 | 0.3 | 0.3 / 0.3 / 0.3 | 3 | tests/config-approvals.test.ts |
| 100 | 0.3 | 0.3 / 0.3 / 0.3 | 8 | tests/command-line.test.ts |
| 101 | 0.2 | 0.1 / 0.2 / 0.2 | 19 | tests/secrets.test.ts |
| 102 | 0.2 | 0.2 / 0.2 / 0.1 | 194 | tests/inside/broker/operations.test.ts |
| 103 | 0.2 | 0.2 / 0.2 / 0.1 | 1 | tests/inside/broker/agent-query.test.ts |
| 104 | 0.2 | 0.2 / 0.2 / 0.2 | 13 | tests/broker-throwaway.test.ts |
| 105 | 0.2 | 0.2 / 0.2 / 0.2 | 9 | tests/broker-files.test.ts |
| 106 | 0.2 | 0.2 / 0.2 / 0.2 | 21 | adapters/claude-code/tests/build.test.ts |
| 107 | 0.2 | 0.2 / 0.2 / 0.2 | 18 | adapters/claude-code/tests/agent-file.test.ts |
| 108 | 0.1 | 0.1 / 0.1 / 0.1 | 1 | tests/version.test.ts |
| 109 | 0.1 | 0.1 / 0.1 / 0.1 | 21 | tests/trust.test.ts |
| 110 | 0.1 | 0.1 / 0.1 / 0.1 | 10 | tests/sdk.test.ts |
| 111 | 0.1 | 0.1 / 0.1 / 0.1 | 31 | tests/policy.test.ts |
| 112 | 0.1 | 0.1 / 0.1 / 0.1 | 7 | tests/node-ports.test.ts |
| 113 | 0.1 | 0.1 / 0.1 / 0.1 | 6 | tests/layout.test.ts |
| 114 | 0.1 | 0.1 / 0.1 / 0.1 | 5 | tests/json.test.ts |
| 115 | 0.1 | 0.1 / 0.1 / 0.1 | 3 | tests/inside/runs/task-tokens.test.ts |
| 116 | 0.1 | 0.1 / 0.1 / 0.1 | 1 | tests/inside/broker/spending.test.ts |
| 117 | 0.1 | 0.1 / 0.1 / 0.1 | 7 | tests/inside/broker/script-protocol.test.ts |
| 118 | 0.1 | 0.1 / 0.1 / 0.1 | 3 | tests/inside/broker/script-command.test.ts |
| 119 | 0.1 | 0.1 / 0.1 / 0.1 | 9 | tests/inside/broker/helpers.test.ts |
| 120 | 0.1 | 0.1 / 0.1 / 0.1 | 1 | tests/inside/broker/database-process.test.ts |
| 121 | 0.1 | 0.1 / 0.1 / 0.1 | 6 | tests/inside/broker/context.test.ts |
| 122 | 0.1 | 0.1 / 0.1 / 0.1 | 52 | tests/import-scanner.test.ts |
| 123 | 0.1 | 0.1 / 0.1 / 0.1 | 3 | tests/fakes.test.ts |
| 124 | 0.1 | 0.2 / 0.1 / 0.1 | 15 | tests/broker-http.test.ts |
| 125 | 0.1 | 0.1 / 0.1 / 0.1 | 3 | tests/broker-helpers.test.ts |
| 126 | 0.1 | 0.1 / 0.1 / 0.1 | 3 | tests/agent-commands.test.ts |
| 127 | 0.1 | 0.1 / 0.1 / 0.1 | 6 | components/modes/feed-briefing/tests/citations.test.ts |
| 128 | 0.1 | 0.1 / 0.1 / 0.1 | 2 | components/base/store/tests/store-schemas.test.ts |
| 129 | 0.1 | 0.1 / 0.1 / 0.1 | 8 | components/base/git-worktrees/tests/root-guard.test.ts |
| 130 | 0.1 | 0.1 / 0.1 / 0.2 | 39 | adapters/claude-code/tests/guard-decide.test.ts |
