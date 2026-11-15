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

The kernel budgets add up to 3,800 lines and leave 200 spare. A budget is a signal, not a limit on quality: readable, well-structured code comes first (owner decision, 2026-11-14). A slice that needs more than its budget writes the code properly, reports the real count and the reason, and the reviewer checks whether the extra is needed design or avoidable bulk. Code is never shortened, packed or made less clear to meet a number.

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
- [DOD-5] (must) The slice reports its line count after prettier against its budget. Being over is not a failure when the report explains why; code made less readable to stay under is.
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
- 5.1: always-on in the cloud (a daemon with schedules and events, a headless agent adapter, a chat channel, one container per run). It gets its own proposal, starting with where it is hosted. Owner requirements of 2026-11-14 for that proposal: reached over Telegram; shared with anyone the owner invites; guests may only ask questions (actions with the `read` effect only, on modes the owner marks as shared, never approvals); each guest has a budget. Inviting guests broadly is the proposal's "public" audience, so its Safety gates apply before the first guest outside the owner's trusted circle.
- 5.2: the Codex adapter, starting with research on what Codex can enforce.
- `bay import-v4` is removed in 5.1.
- After the existing modes: a real estate mode (free state parcel and sales data, listings parsed from alert emails through the Gmail mode). Research: the owner has the report of 2026-11-14.

## Where the builders need the owner

1. Approval of the proposal and this plan.
2. Spike results, if a spike fails or changes the proposal.
3. The stage 4 checkpoint.
4. A second failed review on any slice, or a dropped behaviour the proposal does not name.
5. The cutover pull request into main.

## Spike results

Run by S0 on 2026-11-14 on Node 22.23.4 (SQLite 3.53.4) and Claude Code 2.1.325. The spike code lives outside the repository and is thrown away.

### A. SQLite: PARTIAL (everything holds, but the time limit needs a child process, not a worker)

What was run: two mode files (`store-mail.db`, `store-feed.db`), each query in a fresh process that opens its file with `readOnly: true`, sets `pragma query_only = on`, wraps the agent's text as `select * from (\n<text>\n)`, rejects it when `statement.sourceSQL` is shorter than the wrapped text (a second statement), and stops iterating at the row limit.

- A normal select and an FTS5 `match` work (`ENABLE_FTS5` is compiled in; `fts5 match OK rows=1 first={"hits":72}`).
- Refused: a second statement (`near ";": syntax error`, or `more than one statement` when the text closes the parenthesis first), `attach`, `pragma user_version = 7`, `pragma query_only = off`, `insert`, `with ... insert`, `create temp table`, `load_extension` (`not authorized`), a row-limit escape through an outer `limit`, and more than 100 rows (`row limit 100 exceeded`).
- `worker.terminate()` does not stop a query that runs in SQLite without returning rows: `with recursive r(n) as (... ) select count(*) from r` kept running, and `terminate()` had not returned after 11 seconds. It does stop a query that returns rows (5 ms). A child process killed with SIGKILL after 500 ms always stopped it: `endless recursive cte, no rows REFUSED time limit 500 ms (child SIGKILL)`.
- Killing 10 readers mid-query while another process committed 1,813,250 rows left the file intact: `integrity: ok`, and the next query and the next writer worked. Starting a child and running a query took 37 ms.
- Important: `attach` succeeds on a connection opened with `readOnly: true` even with `query_only` on, so it can read another mode's file. Only the `select * from (...)` wrapper keeps it out. The prepare call also silently ignores everything after the first statement, so the `sourceSQL` length check is needed to reject rather than ignore.

From docs, not run (https://nodejs.org/download/release/v24.17.0/docs/api/sqlite.html): `setAuthorizer` arrives in Node 24.10.0 and `database.limits` in 24.15.0; no Node version has a progress handler or a way to interrupt a running query; the `timeout` option is a busy timeout for locks.

Consequences: the proposal's "in a worker with a time and row limit" becomes "in a child process with a time and row limit". No third-party binding is needed. `node:sqlite` prints an experimental warning on Node 22.

### B. Per-step allow-lists in Claude Code: PARTIAL (the hook passes every case; no end-to-end run)

`claude --version` works, but a model call fails here (`Authentication error`), so Claude Code itself did not run a subagent, and `bay submit` was not tried. What was run: a 96-line `step-guard.ts`, started as `node step-guard.ts`, that reads the hook payload from stdin and a per-step policy (`tools`, `read`, `write`, `commands`) keyed by `agent_type`. It resolves the path with `path.resolve` and `realpath`, matches a command to an exact prefix, and allows only the characters `[A-Za-z0-9 _./=:,@%+-]` after the prefix. It does not parse shell. Results from piped sample payloads:

- Denied with exit 2 and a `permissionDecision: "deny"`: a Write to `bay/sdk.ts`, a Write through `../..`, a Write through a symlink in the write folder, a Write into a read-only folder, a Read of `.agentbay/steps.json`, a Grep with no path from the project root, a Glob pattern with `..`, an unlisted tool, `npm install left-pad`, `node --testx`, `node --test && rm -rf x`, `node --test ; curl https://evil.example`, `git status | sh`, `node --test $(curl evil)`, a newline after the prefix, `git status > bay/x`, an unknown subagent, invalid JSON on stdin, and a missing policy file.
- Allowed: a Write inside `out/digests/`, a Read in the read folder, a listed MCP tool, `node --test` and `node --test tests/digest.test.ts`. A call with no `agent_id` and no `agent_type` (the main thread) passes through untouched. One hook call takes about 60 ms.
- Gap, shown: `node --test out/digests/evil.test.ts` and `node --test --import=./out/digests/evil.mjs` are allowed, and both run any code the agent wrote, outside the hook and outside the settings rules.

From docs, not run (https://code.claude.com/docs/en/hooks, /sub-agents, /permissions):

- The hook payload carries `agent_id` (the subagent instance) and `agent_type` (the agent file's name, also set on the main thread when the session uses `--agent`), plus `tool_name`, `tool_input` and `cwd`. Write, Edit and Read give an absolute `file_path`; Glob and Grep give an optional `path`.
- Exit 2 blocks the call even when an allow rule matches. A hook "allow" never overrides a deny rule. A hook that crashes, exits with another code or times out lets the call through unless it is registered with `"onFailure": "block"` (Claude Code 2.1.295 or later).
- A subagent file's `tools:` takes tool names only. `permissions.allow` and `deny` in settings apply to the whole session, not to one subagent, so the per-step list can only live in the hook. Bash rules split `&&`, `;`, `|` and newlines, but the permissions page says they are not a security boundary around a program, and Read and Edit rules do not reach a Node script that opens files itself.
- A subagent can start its own subagents unless `Agent` is left out of `tools:`. When the parent session runs in `bypassPermissions` or `acceptEdits`, the subagent's `permissionMode` is ignored. Hooks in a project subagent's front matter run only after the workspace trust prompt, so the hook belongs in `.claude/settings.json`.

Consequences: K6 writes one agent file per skill step (name = step, `tools:` without `Agent`), one settings hook for all tools with `onFailure: block`, deny rules for the kernel folders, and the policy file the hook reads.

### C. Script confinement: PARTIAL (files, processes and workers are confined; network and SQLite are not)

What was run: a `.ts` script started as `node --permission --allow-fs-read=<script> --allow-fs-read=mode/ --allow-fs-write=mode/out/ script.ts`.

- Type stripping works together with `--permission` with no extra flag.
- Denied with `ERR_ACCESS_DENIED`: reads outside `mode/` (including `/etc/passwd` and a `..` path), writes outside `mode/out/`, `spawnSync`, `execSync`, a Worker, `process.binding`, and `process.dlopen` (`ERR_DLOPEN_DISABLED`).
- Not denied: `net.connect` to 127.0.0.1 (`ALLOWED (connected)`), `http.request` (`ALLOWED status 200`) and a UDP send. Node 22.23.4 has no network flag (`node --help` lists none).
- Not denied: `node:sqlite` created and wrote `secret/x.db` outside every granted folder.
- Not denied: reading through a symlink inside a granted folder that points outside it.
- `process.env` is fully readable.
- Hostile environment: with an inherited `NODE_OPTIONS="--require evil.cjs --allow-fs-read=*"` and `NODE_PATH`, the preload ran, the secret was read and a module loaded from `NODE_PATH`. With `env: { PATH }` only, all three failed. The launcher must build the child's environment from nothing; there is no flag that makes Node ignore `NODE_OPTIONS`.
- Fallbacks that were run: a `--import` preload using `module.registerHooks` that refuses `node:net`, `node:http`, `node:sqlite`, `node:child_process` and the like, and replaces `process.getBuiltinModule` and `fetch`, stopped every import route tried. It runs inside the script's own process, so it is a guard against mistakes and not a boundary. Also, `unshare -n` (Linux network namespace) gave `ENETUNREACH`; that works here as root, is Linux only and needs user namespaces elsewhere.

From docs, not run:

- The permission model has been stable since 22.13.0 and 23.5.0 (https://nodejs.org/download/release/v26.7.0/docs/api/permissions.json). It "does not provide security guarantees in the presence of malicious code" and "does not guarantee that users will not be able to access the file system through other means, such as through the `node:sqlite` module" (https://nodejs.org/download/nightly/v27.0.0-nightly20261018f88a1d25e9/docs/api/permissions.md).
- `--allow-net` is documented from the Node 25 line (https://nodejs.org/download/nightly/v25.0.0-nightly202507028173d9d72b/docs/api/permissions.html). One secondary source says it landed in 25.0.0 and was not backported to 24 (https://dev.to/mr_manushukla/nodejs-25-permission-model-scope-allow-net-and-allow-fs-for-production-2026-745). Newer Node also has `--allow-env`.
- Type stripping is on by default from 22.18.0 (https://nodejs.org/blog/release/v22.18.0). The oldest Node with both is 22.18.0, and `engines.node` is set to `>=22.18.0`.

Consequences: on Node 22 a script step is confined for files, processes and workers only. To keep the rest of the promise, K3's runner must: start the child with a clean environment; block `node:sqlite` and the network modules with the preload; and refuse granted folders that contain symlinks. Real network isolation needs Node 25 or later, or an OS sandbox.

### Decisions for the owner

1. Spike A: accept a child process per agent query (about 40 ms each) instead of a worker.
2. Spike B: decide what a skill step may do with a command that runs code, such as `node --test`. One choice is to forbid such commands in `commands:`. Another is to have the adapter route them through the confined runner of spike C, which has its own gaps.
3. Spike C: choose one of these. Stay on Node 22.18 with the in-process preload as a guard against mistakes, and treat scripts as reviewed code without a network boundary. Require Node 25 or later for `--allow-net`. Or add an OS sandbox, which is Linux only and outside Node.
4. Separately: the proposal calls script confinement a closed bypass. The Node documentation calls the permission model a seat belt for trusted code, so the Safety section should not claim it stops a hostile script.

### Decided by the owner on 2026-11-14

1. Agent SQL runs in a child process per query.
2. No shell for agents by default. A mode may list command prefixes; in 5.0.0 only `forge` does. The owner uses agentbay alone for now, then a team, then the public; the proposal's Safety section lists what is added before each.
3. Scripts run with the Node 22 seat belt (clean environment, file and process limits, the preload). A container per run comes with the cloud stage.
4. The proposal no longer says confinement closes the bypass.

Reviewer's note on S0: the checks were rerun and pass; the worker and permission-model findings were reproduced independently. Spike B was not run inside a live Claude Code session, so K6's hook is verified on the owner's machine at the stage 4 checkpoint. Two rules are still missing from the lint config and go to K1: `prefer-readonly`, and a ban on one mode importing another mode's files.

## Stage 2 contracts (written by the reviewer before K2, K3 and K4 start)

K3 and K4 are built in parallel and meet at `bay/contracts.ts` (types only). Neither edits that file; a needed change is reported, not made.

**Who owns what in stage 2**

| Slice | Files |
|---|---|
| K2 | `bay/check.ts`, `bay/new.ts`, `bay/templates/`, their tests. No schema changes |
| K3 | `bay/policy.ts`, `bay/broker.ts`, `bay/sdk.ts`, `bay/script-runner.ts`, `bay/script-host.ts`, `bay/script-preload.ts`, `bay/query-child.ts`, `bay/secrets.ts`, their tests |
| K4 | `bay/engine.ts`, `bay/run-store.ts`, `bay/references.ts`, `schemas/workflow.schema.json`, `schemas/mode.schema.json`, the regenerated types, and the registry rules those schema changes need, their tests |

**Where state lives.** The kernel database is `.agentbay/kernel.db` in the project (tables `runs`, `steps`, `events`). Each mode's own database is `.agentbay/data/<mode>.db`. Both are SQLite through `node:sqlite`.

**How an action runs.** The steps of an action form a pipeline: the action's input goes to the first step, each step's output is the next step's input, and the last output is checked against the action's output schema. A `script` step goes to the `ScriptRunner` (K3). A `call` step runs the bound mode's action through the engine, with the callee's permissions. A `skill` step saves a `SkillTask` and puts the run in `waiting`; `submit` brings the output back, which is checked against the schema before the run continues.

**Skill checks.** A skill step may list `checks:` (script paths). After a submitted output passes its schema, the engine runs each check script with that output as input. A check returns `{ "passed": true }` or `{ "passed": false, "feedback": "..." }`. On a failure the same skill step returns to `waiting` with the feedback and `round` raised by one. After round 3 fails, the run fails. K4 adds `checks` to the mode schema.

**Workflow steps.** K4 adds an optional `input:` to `action` steps and an optional `show:` to `approval` steps. A value in `input` that is a string starting with `$` is a reference, resolved whole (no string interpolation): `$trigger` (the workflow's input), `$steps.<id>.output` with an optional dotted path after it, `$item` (inside `foreach`), `$settings.<key>`. Anything else is a literal. `foreach` takes one such reference that must resolve to a list; its nested steps run once per element, in order, and are saved under `<foreach id>[<n>].<step id>`. `wait` is a duration (`30m`, `2h`, `3d`). An `approval` records the SHA-256 of the canonical JSON of what `show` resolved to; `approve` must name that hash, and a run whose shown content has changed returns to the approval.

**Run states.** `running`, `waiting` (for `skill`, `approval`, `time` or `budget`), `done`, `failed`, `undone`. Every step's input and output is saved before the next step starts. One writer per run: the engine takes a lock row before it advances a run and refuses a second writer.

**Resume.** `resume` continues from the first step with no saved output. A step that had started and not finished is run again only when its action's effects are `read` only; otherwise the run stays `waiting` for the owner to say rerun or skip.

**Budget.** The budget of a run is the smallest of the workflow's, the action's and the project default, per measure. Every `StepOutcome` reports what it spent; nested calls draw from the caller's remaining budget. When a measure would go below zero the run goes to `waiting` for `budget`.

**Undo.** When a run fails after steps with `write` effects finished, the engine runs the `undo` action of each finished action, newest first, each with that action's output as input, and ends `undone`, listing the actions that had no undo. Actions with the `delete` effect are never undone automatically.

**Scripts.** A script is a `.ts` file whose only export is `run`, made with `defineScript` from `bay/sdk.ts`: `export const run = defineScript(async (input, context) => output)`. `context` gives `db`, `files`, `secrets`, `http`, `events`, `call`, `settings` and `spend`. The script runs in a child process with the seat belt from spike C; every resource request crosses to the parent as one JSON line and is checked there against the run's `Permissions`.

**Secrets.** Looked up by name, first in the environment as `AGENTBAY_SECRET_<NAME>`, then in the macOS keychain through the processes port. Never listed; every value handed out is remembered and redacted from outputs, events and error text.

### Contract changes after the first stage 2 review (2026-11-14)

- `Permissions.effects` is what the ACTION being run declares, not the union over the mode. The engine sets it for each script request; the broker's write check relies on it.
- `Permissions.migrationsFolder` is the mode's migrations folder.
- `StepPlace.stepKey` is the engine's key for the step, which also identifies nested steps; adapters and events use it.
- `ScriptRequest.timeLimitMilliseconds` is set by the engine: the smaller of the remaining minutes and eight minutes. The run lock goes stale after ten minutes, and the store refreshes the lock on every write, so a live engine never looks dead.
- `Submission` carries a skill step's output and what the agent spent; `submit` takes it and charges the spend to the budget.
- `Scrubber` is what the engine uses to redact secrets from submitted outputs, failure reasons and event details before they are stored. The secret store implements it.
- `StepOutcome.spent` is what the step itself spent and excludes its nested calls; the engine adds those from their own records.
- Only the base mode `forge` may declare write paths inside `bay/`, `schemas/`, `adapters/`, `framework/` and other modes' folders. No mode may declare a write path that contains its own `mode.yaml`, `scripts/` or `skills/`, except `forge`.

## Stage 3 contracts (written by the reviewer before K5 and K6 start)

K5 and K6 are built in parallel and meet at `bay/adapter.ts` (the reviewer's file; neither edits it) and at the rules below.

**Who owns what**

| Slice | Files |
|---|---|
| K5 | `bay/cli.ts`, `bay/mcp.ts`, `bay/kernel.ts` (the one place that wires registry, policy, broker, runner, engine and stores together), `bay/build.ts`, `bay/task-tokens.ts`, additions to `bay/run-store.ts` for tokens, `schemas/config.schema.json` (approvals), `bay.sh`, their tests |
| K6 | everything under `adapters/claude-code/`, their tests under `adapters/claude-code/tests/` |

**Commands (twelve, the ceiling).** `check`, `new`, `call`, `submit`, `runs`, `approve`, `resume`, `build`, `secret`, `auth`, `config`, `import-v4`. `auth` and `import-v4` are registered and answer "not built yet" until their mode slices. `build --clean` removes what a build wrote. `resume --due` wakes runs whose wait has elapsed. Every command takes `--project <folder>` (default: the current folder) and `--json`; with `--json` it prints exactly one JSON object and nothing else. Exit code 0 means done, 1 means problems were reported, 2 means the command line was wrong.

**A waiting skill, as the commands show it.** `call`, `submit`, `resume` and `runs <id>` print the run. When it waits for a skill the output carries a `task` with: `agent` (the name from `agentName(mode, skill)`), `token`, `runId`, `stepKey`, `skillFile`, `input`, `outputSchema`, `round`, `feedback`. A coordinator starts the agent of that name and gives it the task as its prompt.

**Task tokens.** A token is 32 random bytes, shown once when a task is first printed and stored only as a SHA-256 hash in `kernel.db` with the run, step key and round. It dies when the step finishes or the round changes. Every kernel tool call and every `submit` must carry it. The token is what ties a tool call to one step's permissions, so an agent cannot use another step's.

**Kernel tools for agents.** `bay/mcp.ts` serves them over MCP on stdio (server name `agentbay`), and `bay tool <name> '<json>'` is NOT a thirteenth command: instead `bay call --tool <name> '<json>'` reaches the same tools for a harness without MCP. The tools: `db_query` (the broker's agent query on the mode's own database), `files_read`, `files_list`, `files_write` (inside the step's paths), `call_action` (an `interface.action` or own action that the skill's Tools section lists and whose effects are `read` only), `submit` (the step's output, with optional `tokens` and `usd` spent; the answer is either accepted, or the schema problems or check feedback so the agent can correct and submit again in the same session). A skill gets only the tools its Tools section names, plus `submit`.

**Approvals from chat.** The owner works without a terminal. The project config gains `approvals: { from: [terminal, chat] }` (default `[terminal]`). From a terminal, `approve` needs an interactive stdin. From chat, `approve --via chat --quote "<the owner's words>"` is accepted only when the config lists `chat`; the quote and the channel are recorded in the approval event. `approve` always needs `--hash`.

**What the Claude Code adapter writes.** One agent file per `SkillAgent` at `.claude/agents/<agent>.md` (tools: the harness file tools the step's paths allow, the `mcp__agentbay__*` tools it may use, no shell unless the mode lists commands, never the tool that starts other agents; model by tier); `.agentbay/steps.json` (the per-agent policy the hook reads); the hook registration and deny rules merged into `.claude/settings.json`; the `agentbay` server merged into `.mcp.json`; a marked block in `CLAUDE.md` that tells the coordinator how to run a call, hand a task to its agent and read the run afterwards; and `.agentbay/build.json`, the record of everything written or merged, from which `clean` restores the project exactly. The hook is `adapters/claude-code/step-guard.ts`, registered to fail closed.
