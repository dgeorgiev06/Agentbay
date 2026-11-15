# Plan 0022: agentbay 5 in TypeScript

## Summary

This plan is for proposal 0022 (main a7a425d, 4.0.0). It implements nothing. Three Opus agents read the whole repository on 2026-11-14; their findings on what the Python kernel does, and where it is fragile, are the basis of this plan. Where this plan and the proposal differ, the plan wins.

- **14 slices in 8 stages.** At most three builders work at once; slices in one stage touch no common file.
- **Every builder is an Opus agent. Fable reviews every slice once** against the proposal, this plan and the code standards before it merges into the integration branch.
- **Stage 0 is spikes.** Three unknowns can each change the design. They are answered with running code first, and the answers come back to the owner if they change the proposal.
- **Stage 4 is a checkpoint.** One real mode runs end to end and the kernel is measured against its 4,000-line budget before the other modes are built.
- **Main stays on 4.0.0 until cutover.** The integration branch is `feat/0022-agentbay5`. The cutover pull request is the owner's last approval.

## What was measured

All on main a7a425d, Python 3.13.18, Node 22.23.4.

| Fact | Value |
|---|---|
| Suite | 576 passed, 0 failed, 113 s |
| Kernel | 31 files, 9,703 lines; 4 import cycles |
| Kit Python | 26 files, 6,415 lines |
| Adapter | 535 lines |
| Modes | 8 (cos, forge, improve, store, delivery, mail-briefing, feed-briefing, todo); 15 interface files |
| Node runs `.ts` with no flag | yes |
| Node 22 SQLite authorizer and progress handler | absent |

## What the inventory says to carry over, and what to leave

Behaviour worth keeping, each with where it lives today so a builder can read it with `git show main:<path>`:

| Behaviour | Today |
|---|---|
| `check` reports every gap at once, each naming the fix | `bay/model.py`, `bay/lint.py` |
| A gate binds the content it approved; a changed file returns the call to the gate | `bay/dispatch.py:395-399` |
| Secrets are scoped by name and every value seen is redacted | `bay/vault.py:86-87`, `bay/secretscan.py` |
| HTTP only to the declared hosts, https only | `bay/connect.py` |
| The store's scope rule, remembered deletions, spend saved before items are committed | `corpus_store.py:414-434` |
| One shared selector matcher so every source behaves the same | `bay/selector.py` |
| Review returns one verdict per Definition of done id; a failed must item halts | DESIGN.md, Features |
| The size ratchet: ceilings only fall | `bay/limits.py` |
| Atomic state writes | `bay/util.py:83-87` |

Known weaknesses the new design must not repeat:

| Weakness | Today | In agentbay 5 |
|---|---|---|
| A call that dies mid-step is lost | state saved only at pauses (`bay/dispatch.py:378,758`) | saved every step, with a lock |
| No lock on state files | none | one writer per run |
| Budget is enforced by one connector; a role's budget is prose | `corpus_store.py`, `claude_code.py:287-289` | the engine enforces it for every run |
| Code an agent runs is outside the guard | DESIGN.md, Safety model | scripts run confined |
| The kernel names Claude Code in a dozen places | `dispatch.py:93,650`, `model.py:37,464`, `hook.py:76`, `guard.py:15-19` | only adapters name a runtime |
| Connectors import about 20 kernel modules | `pipeline.py:13`, `corpus_store.py:16-19` | mode code imports only `bay/sdk.ts` |

## Stage 0: spikes and toolchain (one builder)

Slice S0 commits the toolchain and writes its findings into "Spike results" below. Spike code is thrown away.

| Spike | Question | Pass | If it fails |
|---|---|---|---|
| A. SQLite | Can Node's own SQLite give one file per mode, a read-only connection for agent queries, a hard time limit by ending a worker, a row limit, and full-text search? | A hostile query (endless recursion, a second statement, an attach) is stopped | A named third-party binding; owner decides |
| B. Agent steps | Can the Claude Code adapter give one skill step its own allow-list (tools, paths, command prefixes) through agent files, settings and one deny hook, and get the result back by `bay submit`? | A subagent asked to write outside its paths and to run an unlisted command is refused both | Owner decides what the hook must do |
| C. Script confinement | Can a script step run in a child Node process limited to the mode's paths, with no child processes and no direct network? What is the oldest Node that does this and runs `.ts`? | A script that tries each is refused | Owner decides; the fallback is scripts reviewed and run unconfined, as in agentbay 4 |

Toolchain committed by S0: `package.json` and lockfile, `tsconfig.json`, eslint, prettier and knip configs in `components/base/typescript/`, the test script, and the first commit of the integration branch, which removes the Python kernel, connectors and tests. Main and the `v4` branch keep them; builders read old code with `git show main:<path>`.

## Build order

A slice is one builder in its own worktree, on a branch from `feat/0022-agentbay5`, merged into it after review. Slices in the same stage run in parallel.

| Stage | Slice | Builds | Budget |
|---|---|---|---|
| 1 | K1 | `schemas/` for manifest, interface, skill, workflow, config; generated types; `spec.ts`, `ports.ts`, `registry.ts` (load, validate, bind interfaces, reject cycles) | 700 lines |
| 2 | K2 | `check.ts` (manifest, skill sections, workflow wiring, effects, imports, limits) and `new.ts` with templates for mode, action, skill, workflow, interface | 900 |
| 2 | K3 | `broker.ts`, `policy.ts`, `sdk.ts`; the resources db, files, secrets, http, events; the confined script runner | 800 |
| 2 | K4 | `engine.ts`: the `runs` and `events` tables, steps, `call`, approval, wait, foreach, resume, budget, undo | 900 |
| 3 | K5 | `mcp.ts` and `cli.ts`: check, new, call, submit, runs, approve, resume, build, secret, auth, config | 500 |
| 3 | K6 | `adapters/claude-code`: agent files, settings, the deny hook, the coordinator document, tier-to-model table | 800 (adapter) |
| 4 | M1 | `base/interfaces` (`items-store`, `items-source`), `store`, a fake source, and one briefing action run end to end through Claude Code | - |
| 5 | M2 | `gmail`, `mail-briefing` | - |
| 5 | M3 | `x`, `feed-briefing` | - |
| 5 | M4 | `todo`, and `bay import-v4` for local items | - |
| 6 | M5 | `cos` | - |
| 6 | M6 | `forge`, with the standards, limits and boundary checks as its scripts | - |
| 6 | M7 | `improve`, `delivery` | - |
| 7 | C1 | README, DESIGN.md, INTERFACES.md, CHANGELOG with Upgrading, `kernel.yaml`, `limits.yaml` written from real counts, version 5.0.0, the cutover pull request | - |

The kernel budgets add up to 3,800 lines and leave 200 spare. A slice that needs more than its budget says so before writing the extra, and the reviewer decides whether another part gives it up.

After stage 4 the work stops for the owner: the mode runs, the kernel line count is reported, and the owner says continue or change course.

## What every builder is told

- The proposal and this plan are the spec. Where they are silent, choose the smaller design and say so in the report.
- Read the old code for the behaviour being rebuilt (`git show main:<path>`) and its old tests. Report each behaviour as **kept**, **changed** (how) or **dropped** (why). Nothing is dropped silently.
- Write the tests first for anything in the Safety section.
- Change only the files of your slice.
- Report with the last line of each check, and list anything not verified as not verified.

## Definition of done for every slice

- [DOD-1] (must) `tsc --noEmit`, eslint, prettier and knip report nothing on the slice.
- [DOD-2] (must) No `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, type assertion other than `as const`, or non-null `!`.
- [DOD-3] (must) Every exported function and every manifest rule has a test; every refusal in the Safety section has a test that shows it refusing.
- [DOD-4] (must) `node --test` passes for the whole branch, not just the slice.
- [DOD-5] (must) The slice is within its line budget, counted after prettier.
- [DOD-6] (must) The kept, changed and dropped list covers every test function of the old files named for the slice.
- [DOD-7] (must) No comment lines in kit code; no line over 120 characters; no line packed to save lines.
- [DOD-8] (must_not) No new dependency.
- [DOD-9] (must_not) No name of a runtime (Claude Code, Codex) outside `adapters/`.
- [DOD-10] (must) For a mode slice: `bay check` is clean, every action has example inputs and expected outputs in `tests/`, every skill has the seven sections, and mode code imports only `bay/sdk.ts`.

## Review

Fable reviews each slice once and returns a verdict per DOD id, plus:

- R-1 The code does what the proposal says, read against it section by section.
- R-2 The code standards that no tool enforces: classes only where there is state and a lifecycle, effects only through `ports`, problems returned as values, names in full words.
- R-3 For K3, K4, K6 and M6: each refusal in the Safety section is attempted by hand, not only by the builder's tests.
- R-4 Tests assert behaviour, not implementation. A test written to pass rather than to check is a blocker.
- R-5 The dropped list: each dropped behaviour is either named in the proposal as dropped or comes back to the owner.
- R-6 The diff holds nothing the slice did not need.

A failed must item or a blocker goes back to the same builder once. A second failure stops the slice and goes to the owner.

## Risks

| Risk | Why it matters | What limits it |
|---|---|---|
| The new safety model has a hole the old one did not | It protects your secrets and your files | Spikes B and C before any mode; tests first; R-3 by hand; 4.0.0 stays available |
| A behaviour is lost without anyone deciding to drop it | No old test will catch it | DOD-6 and R-5 |
| The kernel does not fit 4,000 lines | The design's main promise | Budgets per slice; the stage 4 checkpoint |
| Builders drift from the structure | The new kernel becomes as tangled as the old | Cycle and boundary rules from S0; R-2 |
| Claude Code cannot express a per-step allow-list | Agent steps would be less confined than today | Spike B decides before K6 |
| The branch is long-lived | Main moves under it | Framework changes wait for cutover |
| Your to-dos are lost | No source can re-create them | `bay import-v4` in M4, tested on a copy of the real store before cutover |

## Release

- 5.0.0 at C1. Upgrading is in the proposal.
- 5.1: the Codex adapter, starting with research on what Codex can enforce.
- `bay import-v4` is removed in 5.1.

## Where the builders need the owner

1. Approval of the proposal and this plan.
2. Spike results, if a spike fails or changes the proposal.
3. The stage 4 checkpoint.
4. A second failed review on any slice, or a dropped behaviour the proposal does not name.
5. The cutover pull request into main.

## Spike results

Empty until S0 finishes.
