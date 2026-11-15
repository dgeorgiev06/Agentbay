# agentbay 5: independent quality evaluation

Branch `feat/0022-agentbay5` at `ca8d95a`, read on 2026-11-15. Everything below is from the code on disk; the proposal and the plan were treated as claims. Experiments ran on a copy under `/tmp/quality-eval/` (the repository itself was not changed). Kinds used: **defect** (wrong against its own contract), **risk** (will bite under plausible conditions), **smell** (makes the code harder to change or read), **taste**. "Verified" means I ran the smallest thing that shows it.

## 1. Verdict

| Area | Grade | One sentence |
|---|---|---|
| Boundaries | B+ | The import graph is acyclic, adapters reach the kernel through one file, modes through one file, and nothing in `bay/` knows Claude Code; the layering is real but a few types and path conventions sit in the wrong place, and `bay check` and the kernel load through two different pipelines. |
| Interfaces | C+ | The edges are good discriminated unions, but the engine's own state is an untyped JSON bag addressed by string keys that four files parse by hand, there are about ten result shapes, and `effects` means two things and is enforced for one. |
| Readability | B- | Locally clean and well named, with excellent error messages; the engine's replay-and-charge logic is hard to follow, context objects are threaded everywhere, and the comment ban leaves the security-critical preload and the step-key grammar explained nowhere a maintainer would look. |
| TypeScript practice | A- | The strictness claims are true (typecheck, lint, knip, prettier, generated-types check all pass; zero `any`, `as`, `!`, `@ts-`, `eslint-disable`), but one promise is left unobserved and crashes the process, and several guards check less than their type says. |
| Tests | B+ | Behavioural, mostly through real processes and real SQLite, with a contract suite run against both run stores; my injection caught 13 of 16, and the misses and gaps cluster on error paths and on what `bay check` does not check. |
| Security as code | B | Policy, the hook's `decide`, URL and path checks are small, pure and isolated, and redaction of stored data is structural; but effects are not enforced outside SQL, `bay check` does not run the policy, and the kernel's limits are written only in the proposal. |
| Size | C | 12,995 lines is about three times the budget; roughly two thirds is earned by scope the budget never priced, and I estimate 2,000 to 2,500 lines could go in ways that make the code easier to read. |

**The single most important thing to fix:** make what a manifest declares the same as what the kernel enforces and what `bay check` reports. Today an action that declares `effects: [read]` can write files, call HTTP and spend (verified), the engine re-runs such actions after a crash "because they only read", and `bay check` prints "0 errors" for a manifest the kernel then refuses to load (verified). The cheapest urgent fix is separate: one unobserved promise in the script runner turns any file-system error into a process crash (verified, finding 1).

## 2. Top findings, ranked

### 1. A file-system error inside a broker request crashes the kernel process (defect, verified)

`bay/script-runner.ts:260`:

```ts
const answered = answerFor(started, message.request).then((answer) => {
  child.send(JSON.stringify({ type: "answer", id: message.id, answer }));
});
state.inFlight.push(answered);
```

The promise is only awaited at line 271, after the child has ended. If `answerFor` rejects, the child never gets its answer, so it never ends, so line 271 is never reached, and Node kills the kernel on the unhandled rejection. `bay/node-ports.ts:39` rethrows everything except "missing", so any `EISDIR`, `EACCES` or `ENOSPC` does it. I ran a script whose only line is `await context.files.read("out")` where `out` is a folder inside its paths: `bay call --json` printed a Node stack trace (`EISDIR ... at Broker.readFile (bay/broker.ts:226)`), no JSON object, exit code 1 (which the CLI contract defines as "problems were reported"), and the run stayed `running` with its lock held until it goes stale ten minutes later. The same exception through the MCP path (`bay/mcp.ts:52`) writes "internal error" and never answers the request, so the agent's tool call hangs.

Why it matters: it breaks three stated contracts at once (problems as values, one JSON object, exit codes), from a mistake any mode author will make. The lint rule for floating promises cannot see it because the promise is stored in an array.

Smallest fix: catch in `answerFor` (or in `Broker`'s file methods) and turn the error into `failed(message)`; add a test that reads a folder. Then decide whether ports should return errors as values for user-fixable conditions.

### 2. `effects` is enforced only for SQL writes; the engine trusts it everywhere (defect, verified)

`bay/broker.ts:151` is the only run-time use: `const writable = this.#permissions.effects.includes("write");`. `writeFile` (`broker.ts:230`), `request` (`broker.ts:259`) and spend (`bay/script-runner.ts:96`) never look at effects. I ran an action declared `effects: [read]` in a mode with a write path and a host: it wrote `out/written-by-read-only-action.txt`, recorded `usd: 5`, and its `POST` was handed to the network port (it failed only because the sandbox has no network). Only `create table` was refused.

Why it matters: three kernel rules assume the label is true. `mayRerun` (`bay/action-steps.ts:143`) re-runs an unfinished "read" step without asking; `call_action` (`bay/tools.ts:157`) lets a skill start any "read" action, each as a fresh run with its own budget (`tools.ts:165`), up to 200 times a round; undo classifies by effects (`bay/undo.ts:67`). The proposal says effects are "declared and checked".

Smallest fix: three checks in the broker (`write` for file writes, `network` for HTTP, `spend` for spend) with the existing refusal wording, and three tests. Also charge `call_action` runs to the calling run's budget, or say plainly that they are not.

### 3. `bay check` does not run the policy (defect, verified)

`bay/check.ts:77-92` loads the registry and runs the skill, layout, import, command and kit checks. `policyFor` is called only from `bay/kernel.ts:132`. With `files.write: [.agentbay/, ../outside/]`, `secrets: [lower-case]` and `network: ["https://Example.com/path"]` in a project mode, `bay check` printed `bay check: 0 errors, 0 warnings.` and exit 0; `bay call` on the same project then refused to load with four problems.

Why it matters: `check` is the command that promises "every problem at once", and it is what a mode author runs before building. The policy problems also carry no line numbers (`bay/policy.ts:176-183` builds `Problem` by hand with a JSON pointer but no `line`), unlike every registry problem.

Smallest fix: call `policyFor` in `checkSystem` when the system loads, and give `permissionsFor` the `Loaded<Mode>` so it can use `problemAt`.

### 4. The engine's state is a JSON bag and a string key, each parsed by hand in several files (smell, the main one)

`StepRecord.detail` is `Json` (`bay/run-store.ts:42`). The engine keeps its real state there under about 15 field names read with `fieldOf(record.detail, "round")`-style calls: `round`, `feedback`, `schemas`, `submitted`, `submittedSpent`, `earlierSpent`, `stoppedForCall`, `stoppedSpent`, `mode`, `action`, `caller`, `hash`, `previousHash`, `decision`, `by`, `until`. The step key is a composed string with five separators, built in one place and taken apart in others:

| Piece | Built | Parsed back |
|---|---|---|
| `a/b/3` (nested action step) | `action-steps.ts:121` | `waiting.ts:27` `positionOf` |
| `key#2` (skill round) | `action-steps.ts:125` | `engine.ts:143`, `waiting.ts:56` |
| `key#2.check0` | `action-steps.ts:129` | (by prefix only) |
| `key.call0` (script call) | `action-steps.ts:187` | (none) |
| `loop[0].step` (foreach) | `workflow-steps.ts:215` | `waiting.ts:84` `stepIdOf` |
| `undo[0]` | `undo.ts:116` | `undo.ts:48`, `undo.ts:103` by prefix |

The same `SkillTask` is assembled twice, once going forward (`action-steps.ts:310`) and once by reverse-engineering the key and the bag (`waiting.ts:55-82`). Nothing states the grammar; the schema's kebab-case pattern for ids is what keeps `.`, `#`, `/` and `[` out, and nothing says so.

Why it matters: this is the part a maintainer must understand to change resume, rounds or budgets, and the compiler cannot help with any of it. It is also where "illegal states are unrepresentable" stops being true.

Smallest fix: a `step-key.ts` with `build` and `parse` functions and a typed union for `detail` per step kind (`SkillDetail`, `ApprovalDetail`, `ScriptDetail`, `NestedDetail`, `WaitDetail`), decoded once in the run store. Estimated effect: about 150 to 200 lines fewer and one `SkillTask` builder.

### 5. Ten result shapes with different field names, and five kinds of "done or failed" (smell)

`{ ok: true }` unions: `Outcome` (`value` / `problems`), `Answer` (`value` / `refused` or `failed`), `EngineResult` (`run` / `problems`, which is `Outcome<RunView>` under another name), `ToolResult` (`value` / `refusal`), `TokenCheck` (`place` / `reason`), `Resolution`, `ParsedReference`, `JsonArgument`, `OptionToken`, plus 25 functions that return `T | string` with the string as the error. Separately, a finished step is `StepOutcome` (`status: "done"`), `Settled` (`kind: "done"`), `StepEnd` (`status: "finished"`), `StepRecord` (`status: "finished"`), and a run is `Progress`, `RunStatus` and `StoredState`. The discriminator is `ok`, `status`, `kind`, `state`, `how`, `type` or `verdict` depending on the file. About 90 lines exist only to convert between these (`settledOf`, `calledOutcome`, `statusOf`, `storedStateOf`, `stepEndOf`, `storedSettled`, `concludeComposite`).

Smallest fix: one `Result<T, E>` in a leaf module with `value` and `error`; fold `Settled` into `StepOutcome`; keep `Answer` (its three-way split is meaningful).

### 6. `Permissions.effects` means two different things (smell)

`bay/policy.ts:248` fills it with the union over every action of the mode; `bay/action-steps.ts:199` and `bay/waiting.ts:77` overwrite it with the running action's; `bay/build.ts:87` with the union over the actions that use a skill. The broker cannot tell which it was given. `bay/commands/secret.ts:22` builds a `Permissions` by hand with `effects: ["read"]`.

Smallest fix: take `effects` out of `Permissions` (what the mode may touch) and pass the action's effects beside it in `ScriptRequest` and `SkillTask`.

### 7. The security-critical preload and the three hand-written wire protocols have no explanation next to them (risk)

`bay/script-preload.ts:104-118` patches `bind`, `listen`, `connect` and `open` on the prototype of the standard streams' handles. Nothing in the file, in a README under `bay/`, or in the plan says why (the plan's spike C records what was found, not which line answers it). The same holds for `bay/database.ts:214-224` (see finding 15) and for the rule that `filesTheHostReads` (`bay/script-runner.ts:55`) must list exactly the files `script-host.ts` imports by value, or every script fails under `--permission`.

The repository's fallback for the comment ban is "the README", and the root `README.md`, `docs/DESIGN.md`, `docs/INTERFACES.md` and `HANDOFF.md` all still describe agentbay 4 (Python, roles, connectors). `adapters/claude-code/README.md` shows what the kernel is missing: it states what the hook does, what it does not stop, and which documentation it relied on.

Where the proposal's rule and good practice disagree, I think the rule is wrong for these files. Smallest fix: a `bay/README.md` with the same three sections as the adapter's, written before stage 5; or allow a "why" comment in the four files that hold security invariants.

### 8. The item envelope is copied into ten schema files (risk for third-party authors)

An implementing mode must hold schemas deep-equal to the interface's (`bay/registry.ts:589`), so `components/base/store/schemas/` is a byte-identical copy of all 16 files of `components/base/interfaces/items-store/`, and `fake-source` copies `items-source`. `$defs.item` appears in 10 files (one distinct definition today, kept so by hand); nothing checks the source's item against the store's. Gmail and X will add two more copies each.

Smallest fix: let an action name the interface's schema instead of a copy (`input: interface` or resolve the path against the interface folder), and allow one shared `$defs` file per interface.

### 9. `bay check` and the kernel load the system twice, differently (smell)

`checkSystem` calls `loadSystemReport`, then `loadCheckContext` (`bay/check-context.ts:93-131`) finds the mode folders again, parses every `mode.yaml` again and loads the interfaces again. Two exported types are both called `ModeFolder` (`bay/registry.ts:48`, `bay/check-context.ts:17`) with different fields; `kitInterfacesFolder` is declared in both files. `bay/registry.ts` (1,136 lines) both loads and applies about 25 cross-file rules, while more rules live in `check-*.ts` and in `policy.ts`. Finding 3 is a direct result.

Smallest fix: split `registry.ts` into loading (about 300 lines) and rules; have `check` take the loaded sources from the registry report.

### 10. `Workflow.trigger` is in the public schema and nothing reads it (smell)

`schemas/workflow.schema.json:13` defines `event`, `schedule` (a cron expression) and `manual`. No file under `bay/` reads `workflow.trigger`. A mode author who writes `trigger: { schedule: "0 7 * * *" }` gets a valid manifest and no schedule.

Smallest fix: remove it until something runs it, or have `bay check` warn that triggers are recorded but not acted on.

### 11. Manifests carry no format version (risk)

`mode.yaml`, the config, interfaces and workflows have no `apiVersion` or schema version field, and `additionalProperties: false` everywhere means any added field is a breaking change for older kits. The proposal dropped the v4 `kind` on purpose; the cost arrives at 5.1.

Smallest fix: an optional `agentbay: 5` field now, required later.

### 12. The broker's refusal logging depends on every method calling `#settle` (smell)

`bay/broker.ts` wraps each return in `this.#settle(...)` 30 times; that call is what writes the `refused` event and redacts the message. `emit` (`broker.ts:303`) returns without it (harmless there). A new method that forgets it returns an unredacted, unlogged refusal. The check itself does not depend on memory; the audit trail does.

Smallest fix: make the public methods thin wrappers generated from one `#audited(fn)` helper, as `bay/scrubbed-store.ts` already does for the store.

### 13. Small leaks past `ports.ts` (smell)

See the table in section 3: `process.execPath` in three core files, kit-relative file paths computed from `import.meta.url` in three core files instead of from `Layout`, `randomBytes` in `task-tokens.ts`, `FileListing` (a port) declared in `check-context.ts` so that `node-ports.ts` and `kernel.ts` import a check module, and `SqliteRunStore` sharing a file with the `RunStore` type, so 13 modules that want the type import a file that loads `node:sqlite`.

### 14. Mode scripts have no clock, no transaction and no JSON readers (interface gap)

`ScriptContext` (`bay/sdk.ts:31`) offers neither time nor a way to run several statements atomically. The store calls `new Date()` directly (`store/scripts/put.ts:5`, `delete.ts:17`, `update.ts:16`; `feed-briefing/scripts/sync.ts:37`, `select.ts:10`), and `put` of up to 500 items is one broker round trip per item with no transaction (`store/scripts/lib/put.ts:154-167`). Each mode re-implements the same `isFields`, `textOf`, `textsOf` (`store/scripts/lib/json.ts`, `feed-briefing/scripts/lib/json.ts`, `fake-source/scripts/lib/feed.ts:50`) and re-parses input that its schema has already validated, with silent defaults such as `textOf(fields.source) ?? ""` (`put.ts:45`).

Smallest fix: add `context.now`, `db.batch(statements)` and four reader functions to the SDK; later, generate input types from action schemas with the generator that already exists.

### 15. `ModeDatabase.#classifiedWithoutFile` guesses by running the statement on an empty database (smell, clever)

`bay/database.ts:214-224` opens `:memory:` read-only and runs the caller's SQL to learn whether it would have been a write. An `insert into items` fails with "no such table" before SQLite reports read-only, so the answer is `missing`, not `writes-on-read-only`; the trick works only for statements that need no table. `leadingKeyword` (`bay/sql-statements.ts:31`) already gives the answer.

### 16. The import scanner is a regular expression and is easy to miss (defect, low; verified)

`bay/check-imports.ts:38-43`. Checked with the patterns copied out: `await import/**/("../../other/x.ts")`, `import {a}from"../x.ts"`, `import /* c */ { a } from "../x.ts"` and `import { "string name" as a } from "../x.ts"` are all invisible to it. Kit modes are also covered by eslint; project modes are covered only by this. At run time the permission model still limits what a script can read, so this is a hole in the check, not in the confinement.

Smallest fix: strip comments first and loosen `\s+` to `\s*` around `from`; or parse with TypeScript's own scanner, which is already a dev dependency.

### 17. `bay check` fails in the kit's own folder (risk)

The kit has no `agentbay.config.yaml`, so `node bay/cli.ts check` in the repository reports `1 error` ("The project config ... does not exist") before the two size warnings. `npm run check` does not include `bay check`, and no test runs the real check on the real kit, so the kit-only checks (limits, kernel import cycles, layout) run in CI only against fixtures.

### 18. Fake-async store, real `try`/`catch` (smell)

`SqliteRunStore.#write` (`bay/run-store.ts:588`) returns `Promise.resolve(this.#transaction(body))`, so every "async" method throws synchronously. `acquire` (`run-store.ts:500-509`) catches the busy error with a plain `try` around a call that returns a promise; it works only because of that. Losing the lock (`run-store.ts:617`), an expected event after a ten-minute stall, is an exception that surfaces as "internal error", exit 70.

### 19. Guards that check less than their type says (smell)

`isResponse` (`bay/script-host.ts:91`) claims `HttpResponse` after checking `status` and `body` only, so `response.headers` can be `undefined` in a script. `isRows` and `isExecuteResult` exist twice (`broker.ts:59-63`, `script-host.ts:85-89`). `canonicalJson` exists twice with different code (`bay/json.ts:26`, `bay/sdk.ts:85`); approvals hash with one and the store's page ids with the other. `redactJson` exists twice (`secrets.ts:109` redacts keys, `scrubbed-store.ts:6` does not). `fieldOf` (`bay/json.ts:47-52`) deep-copies the value on every read because `isRecord` narrows to `unknown` values and `as` is banned; `canonicalJson` in the same file re-validates at every level.

### 20. Things that must change together and nothing says so (risk)

- `tool-definitions.ts:31` says "At most 200 rows and 2 seconds"; the numbers live in `broker.ts:41-44`.
- `policy.ts:45` `kernelFolders` and `adapters/claude-code/guard-input.ts:12` `kitFolders` are the same list.
- The kebab-case pattern is spelled out in five schemas, `references.ts:37`, `broker.ts:53`, `new.ts` and the store's schemas. Its `constructor` exclusion (a JavaScript detail in a public contract) is in each.
- SQL `check (status in (...))` in `run-store.ts:170-190` repeats `runStatuses`, `waitingReasons`; `kind` is unchecked.
- `mcp.ts:12-18` repeats `cli.ts:7` and has its own `--project` parser, the third argument parser in the tree after `command-line.ts` and `step-guard.ts`.
- `"mode.yaml"` is spelled in 7 kernel files, `"SKILL.md"` in 7, `.agentbay` in 8.

## 3. Import graph

Built with `/tmp/quality-eval/graph.mjs` over `bay/`, `adapters/` and the mode scripts (production files only).

**Layers, as the code has them:**

1. Leaves: `ports.ts`, `generated/*`, `contracts.ts`, then `spec.ts`, `layout.ts`, `json.ts` (types, parsing, paths).
2. Services: `registry`, `policy`, `run-store`, `broker`, `script-runner`, `engine` and its parts; `kernel.ts` is the one place that wires them and the only importer of `node-ports.ts` besides the type generator.
3. Shell: `tools`, `mcp-server`, `command-*`, `commands/*`, and the two entry points `cli.ts` and `mcp.ts`. Child-process entry points (`script-host`, `script-preload`, `query-child`, `database-child`) are imported by nobody.

The code obeys this. **Cycles: none**, with or without type-only imports. Adapters import only `bay/adapter.ts` (11 of 11 edges). Mode scripts import only `bay/sdk.ts`. `grep -i claude bay/` returns nothing.

**Hubs**

| Most imported | In | Most importing | Out |
|---|---|---|---|
| `contracts.ts` | 38 | `engine.ts` | 16 |
| `spec.ts` | 27 | `kernel.ts` | 14 |
| `ports.ts` | 26 | `broker.ts`, `tools.ts`, `run-report.ts`, `commands.ts` | 12 |
| `sdk.ts` (by mode scripts) | 26 | `spec.ts` | 11 |
| `layout.ts` | 17 | `walk.ts`, `undo.ts`, `workflow-steps.ts` | 10 |
| `json.ts` | 15 | | |
| `kernel.ts` | 12 | | |

`spec.ts` is a hub for the wrong reason: `Problem`, `Outcome` and `isRecord` live in the module that also loads ajv, yaml and the five schemas, and `json.ts` imports `isRecord` from it by value, so every user of a JSON helper loads the validator. `Kernel` is passed whole to `tools.ts`, `run-report.ts` and the commands; it is a service locator with 12 fields.

**Odd edges** (not violations of a rule, but pointing the wrong way): `node-ports.ts` and `kernel.ts` import `FileListing` from `check-context.ts`; `skill-tools.ts` (run time) imports the Markdown section parser from `check-skills.ts`; `secrets.ts` imports a pattern from `policy.ts`; `engine.ts` imports wording from `policy.ts`; `sdk.ts` takes its public types from `agent-query.ts`, `answers.ts` and `database.ts`, so an internal change to `Answer` or `Row` is an SDK change.

**Direct effects outside `node-ports.ts`**

| File | What | Verdict |
|---|---|---|
| `bay/cli.ts`, `bay/mcp.ts`, `bay/generate-types.ts` | `process`, `import.meta.url` | Legitimate: entry points |
| `bay/script-host.ts`, `script-preload.ts`, `query-child.ts`, `database-child.ts` | `process`, `node:sqlite`, `node:net`, `node:module` | Legitimate: they are the child side of a process boundary |
| `adapters/claude-code/step-guard.ts` | `node:fs`, `process` | Legitimate: the hook's entry point; `decide` takes its facts as an argument |
| `bay/database.ts` | `node:fs` (`existsSync`, `mkdirSync`), `node:sqlite` | Legitimate (runs only in the database child), but its types are imported by the SDK and the broker |
| `bay/run-store.ts` | `node:sqlite` | Mild leak: the `RunStore` type and its SQLite implementation share a file |
| `bay/agent-query.ts:63`, `database-process.ts:84`, `script-runner.ts:247` | `process.execPath` | Leak: belongs on the `ChildProcesses` port |
| `bay/agent-query.ts:30`, `database-process.ts:18`, `script-runner.ts:49` | `import.meta.url` to find sibling files | Leak: the kit folder is known to `Layout`; these ignore it |
| `bay/task-tokens.ts:41` | `randomBytes` | Leak: not injectable, so token tests cannot fix the value |
| `bay/engine.ts:288` | `randomUUID` | Fine: default behind an injectable `newId` |
| `bay/json.ts`, `sdk.ts`, `adapters/.../build-record.ts` | `createHash` | Fine: pure |
| `bay/run-store.ts:363`, `workflow-steps.ts:167,171`, `engine.ts:276`, `sdk.ts:106,153` | `new Date(text)` | Fine: conversion, not the clock. The clock is read only at `node-ports.ts:87` |
| Mode scripts: `store/scripts/put.ts:5`, `delete.ts:17`, `update.ts:16`, `feed-briefing/scripts/sync.ts:37`, `select.ts:10` | `new Date()`, `Date.now()` | Leak caused by the SDK: it gives scripts no clock |

**Kit and project.** `Layout` is used consistently by the registry, policy, broker, check, `new`, build and the hook. What is left of the single-root assumption: `Layout` has three fields and knows none of the conventions (`.agentbay/data`, `kernel.db`, the mode tiers, `mode.yaml`), which are spelled where needed; the main test fixtures (`tests/system-fixture.ts:8`, `tests/engine-fixture.ts:303`, `tests/policy.test.ts:10`) still default to one folder for both, with two-folder cases added in separate files; and the kit cannot pass its own `bay check` (finding 17).

**SDK.** 15 exports (`defineScript`, `fail`, four small utilities, nine types). Small. Reachability is enforced three ways: eslint for kit modes, the regular-expression scanner for project modes (finding 16), and at run time a resolve hook plus Node's permission model. It is coherent except for the grab-bag (`canonicalJson`, `shortHash`, `parseIsoTime`, `isWithinWindow`), which exists because modes cannot share code, and for what is missing (finding 14).

**`contracts.ts`.** A real contract: 91 lines, types only, 14 names that are exactly what the engine, runner, broker and adapter exchange. Not a dumping ground. It duplicates `Effect` and `Tier` from the generated types, and other shared types live elsewhere (`Answer`, `Problem`, `RunStore`).

## 4. Interface review

| Type | Where | Judgement |
|---|---|---|
| `System` | `registry.ts:34` | Minimal and read-only. `bindings` is keyed by reference string (`name@major`), parsed with `indexOf("@")` and `startsWith` in three places; slice K8 will change its shape, and every resolver uses it directly. |
| `LoadedMode` | `registry.ts:21` | Good. `settings` is `Record<string, unknown>` and crosses to scripts as `Json` through `toJson` at each use. |
| `Layout` | `layout.ts:6` | Precise and tiny, with pure helpers. Too thin to hold the conventions (section 3). |
| `Permissions` | `contracts.ts:16` | Flat and readable. `effects` does not belong (finding 6). `readPaths` silently includes the mode folder and all write paths (`policy.ts:243`). |
| `ScriptRequest` | `contracts.ts:39` | Takes what it needs. Two optional fields (`caller`, `skillInput`) where a union of "step script" and "check script" would say which may appear. |
| `StepOutcome` | `contracts.ts:52` | Good two-case union; one of five for the same idea (finding 5). |
| `SkillTask` | `contracts.ts:60` | `outputSchema` is a path string, and `""` when a skill has no schema (`action-steps.ts:318`); a last skill step is validated against two schemas (`action-steps.ts:300-308`) but the agent is shown only the first. Suspected defect: an agent can pass the schema it sees and be told its output is wrong. |
| `RunStore` | `run-store.ts:133` | A clear port with a contract test run against two implementations. Every write takes `events`, which keeps event and state in one transaction; good. `detail: Json` is the weak point (finding 4). |
| `Engine` | `engine.ts:280` | Seven public methods, each one sentence. `resume(id, { rerunUnfinished })` is a boolean that means "the owner accepts repeated effects"; a named decision would read better. `tick(now)` takes time as an argument while the others read the clock. |
| `Broker` | `broker.ts:81` | One method per resource, each returning `Answer<T>`. `partition?: string` is threaded as an optional third argument through four methods; `report()` exists only so the script runner can log through it. |
| `ScriptContext` | `sdk.ts:31` | Readable for an author. Gaps in finding 14. `Answer<T>` exposes `asked`, `declared`, `change`, which is generous and good. |
| `Adapter`, `BuildRequest` | `adapter.ts:20-38` | The best interface in the tree: two functions, effects passed in, `Outcome` back. `BuildRequest.system` hands the whole `System` to an adapter that needs only `agents` and `layout`. |
| `Problem`, `Outcome` | `spec.ts:15-37` | `Problem` with `file`, `path`, `line`, `message`, `fix` is right, and the `fix` discipline is kept. Hand-built problems use `file: ""`, `path: ""` as "no place" (5 sites). |
| Kernel tool definitions | `tool-definitions.ts` | Six tools, clear descriptions written for an agent. Limits repeated as text (finding 20). `submit` returns `ok: true` with `accepted: false` for schema problems, which is right for an agent that must retry. |
| `mode.schema.json` | | Strict, every field described, good patterns. `step` is a `oneOf` told apart by which key is present, which forces `"script" in step` chains and two hand-written re-taggers (`action-steps.ts:133`, `workflow-steps.ts:226`). `secrets`, `network` and file paths are plain strings validated later by the policy, which `check` does not run. No version field. |
| `workflow.schema.json` | | Four step kinds as promised. `trigger` is dead (finding 10). `input` values are `unknown` and any string starting with `$` is a reference, so a literal `"$5"` cannot be passed. |
| `config.schema.json` | | Small. `bindings` is one mode per interface, already known to be wrong (K8). |
| `interface.schema.json`, `skill.schema.json` | | Fine. Skill `metadata.input` and `output` are unpatterned strings. |
| `items-source@1`, `items-store@1` | | Thoughtful contracts with descriptions that explain intent ("recorded once per page, before the items are stored, so a retried put never counts it twice"). Painful later: the copies (finding 8); `sql` exposes the store's table layout as public interface; `delete` and `prune` declare `delete`, which callers must then declare too. |

**Generated types.** They are derived (`npm run generate:check` passes) and used directly: `registry.ts`, `policy.ts`, `targets.ts`, the engine and `spec.ts` import `Mode`, `Action`, `Step`, `Workflow`, `Config`. Shadows: `StepOf` and `WorkflowStepOf` (tagged copies), `Effect` and `Tier` in `contracts.ts`, and `Budget` generated three times and used across files by structural luck. The generator (`generate-types.ts`, 150 lines) supports a subset and throws on anything else (`type: ["string","null"]`, `allOf`, remote `$ref`), which is honest; it will need care the first time a schema wants one of those.

## 5. Readability

Files read in full: `registry.ts` (three quarters), `run-store.ts`, `action-steps.ts`, `broker.ts`, `engine.ts`, `spec.ts`, `tools.ts`, `script-runner.ts`, `policy.ts`, `walk.ts`, `workflow-steps.ts`, `budget.ts`, `undo.ts`, `waiting.ts`, `references.ts`, `check-imports.ts`, `script-protocol.ts`, `database.ts`, `command-line.ts`, `task-tokens.ts`, `secrets.ts`, `layout.ts`, `sdk.ts`, `kernel.ts`, `mcp-server.ts`, and in the adapter `guard-decide.ts`, `guard-paths.ts`, `build.ts`, `clean.ts`, `build-record.ts`; in the store `put.ts`, `selector.ts`, `partition.ts`, `query.ts`, `delete.ts`.

**What reads well.** Validation code (`registry.ts`, `policy.ts`, `references.ts`) is a list of small functions each returning problems, each with a message and a fix; a newcomer can read it top to bottom. `broker.ts` reads as a table of resources. `engine.ts` public methods are short. The adapter is the most readable code in the tree. 755 functions with a median of 9 lines; only 9 are longer than 30.

**What does not.**

- **The engine is a replay machine and nothing says so.** Every `advance` re-walks the whole run from step 0; finished steps return their saved result. That design is sound and simple to state, but it is stated nowhere, and the function that implements it hides a side effect behind a noun: `replayed(budget, record)` (`walk.ts:174`) both returns the saved result and charges the budget. Budget accounting across skill rounds needs five detail fields and four charge sites (`action-steps.ts:336-368`).
- **Context threading.** `walk`, `frame` and a third bag named `at` go through almost every engine function (`walk: Walk` is a parameter 44 times). The third bag exists because of the three-parameter rule: `at: { leaf, record }`, `at: { skill, record }`, `at: { scriptKey, held }`, `at: { index, target, input, caller }`. `at`, `leaf`, `frame`, `held`, `place`, `found`, `shown` name a role in the call, not a thing. Many of the 313 type declarations are argument bags of this kind (my estimate: 30 to 40).
- **A wait is reported to a script as a failure.** `calledOutcome` (`action-steps.ts:167-182`) turns "the called action is waiting" into `status: "failed"` with a sentence explaining that the script will run again, while a mutable `held` box carries the real wait back out. It works and is tested; it is the cleverest thing in the engine and has no explanation.
- **Short because of the rule, not the design:** `script-protocol.ts:81-149` splits one parser into `partitionRequestOf`, `databaseRequestOf`, `fileRequestOf`, `secretOrEventRequestOf`, `callOrSpendRequestOf` to stay under the complexity cap; the names describe the split, not the protocol.

**Best examples**

`bay/http-access.ts:33-51`, a security check that can be reviewed in one look:

```ts
if (url.protocol !== "https:") {
  return { status: "not-https", url };
}
if (url.username !== "" || url.password !== "") {
  return { status: "credentials-in-url", url };
}
if (!hostAllowed(url.hostname, hosts)) {
  return { status: "undeclared-host", url };
}
```

`bay/answers.ts:35-42`, every refusal says what was asked, what is declared and what to change:

```ts
export function refused(wording: RefusalWording): Refusal {
  return {
    ok: false,
    kind: "refused",
    ...wording,
    message: `${wording.asked}, but ${wording.declared}. ${wording.change}`,
  };
}
```

`adapters/claude-code/guard-decide.ts:331-343`, the whole decision as one exhaustive switch over who is calling (`owner`, `unverifiable`, `stranger`, `step`).

**Worst examples**

`bay/action-steps.ts:358-367`, state read from a bag while charging as it goes:

```ts
const before = frame.budget.spent;
const round = numberField(record.detail, "round") ?? 1;
chargeEarlierRounds(walk, frame, { skill, round });
charge(frame.budget, spendFromJson(fieldOf(record.detail, "earlierSpent") ?? {}));
const submitted = fieldOf(record.detail, "submitted");
if (submitted === undefined) {
  return skillWaiting(walk, frame, { skill, record });
}
charge(frame.budget, submittedSpent(record));
```

`bay/waiting.ts:27-33`, the step key taken apart with no statement of its grammar:

```ts
function positionOf(key: string): StepPosition {
  const slash = key.lastIndexOf("/");
  if (slash < 0) {
    return { parentKey: undefined, index: Number(key) };
  }
  return { parentKey: key.slice(0, slash), index: Number(key.slice(slash + 1)) };
}
```

`bay/json.ts:47-52`, a field read that deep-copies to satisfy the type checker:

```ts
export function fieldOf(value: Json, name: string): Json | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, name)) {
    return undefined;
  }
  return toJson(value[name]);
}
```

**Does the comment ban hurt?** In most files, no: names and error messages carry the reason. It hurts in four places: `script-preload.ts` (why each patch), the step-key grammar, the replay model of the engine, and `filesTheHostReads`. None of these is in a README or in the plan in a form a maintainer could find from the file.

## 6. Tests

63 test files, about 11,800 lines. I read `tools.test.ts` in full, `fakes.test.ts`, `version.test.ts`, `cli-commands-measure.test.ts`, and the first part of `run-store.test.ts`, `registry-folders.test.ts`, `first-session.test.ts` and `engine-workflow.test.ts`; I surveyed assertion styles across all files and saw the names of the tests that caught each mutation. That is fewer than the ten I was asked to sample; treat the judgement below as well founded for kernel tools, the run store, the registry and the adapter, and thinner for check, `new` and the store.

**Quality.** Tests assert what a caller can observe: tool results, stored runs, events, files on disk, refusal wording. `tools.test.ts` builds a real project, a real kernel, real SQLite and real child processes for each case. `run-store.test.ts:49` defines `runStoreContract` and runs it against both the in-memory fake and SQLite, which is exactly the answer to "fixtures that encode the code's assumptions". Engine tests take a `storeKind`. Five files spawn the real CLI or the real MCP server (`first-session`, `end-to-end`, `feed-briefing-session`, `kernel.test`, `mcp.test`); the `cli-*.test.ts` files drive `runCommandLine` in-process. The overlap between unit and end-to-end is moderate and looks deliberate. About 1,500 `equal`/`deepEqual`/`match` assertions against 300 `assert.ok`, and most `assert.ok(x)` are narrowing steps followed by real assertions. No snapshots, no assertion on a mock's own return value.

The cost of this style: about a third of assertions match message text, so rewording a message breaks tests. For a tool whose messages are its interface I think that is acceptable.

**Cannot fail, or nearly**

- `tests/version.test.ts:5`: `assert.equal(VERSION, "5.0.0-dev")` restates the constant.
- `tests/fakes.test.ts`: three tests of the test doubles themselves.
- `tests/tools.test.ts:50`: `assert.match(refusalOf(refused), /refused|read-only|select/i)` passes for any refusal that mentions "select", which the tool's standard wording does.

**Behaviours I looked for and did not find a test for**

1. `bay check` reporting a policy problem (it does not; finding 3).
2. The broker refusing a file write, an HTTP request or a spend for an action without that effect (not implemented; finding 2).
3. A broker request that throws (a folder read, a full disk); this is the crash in finding 1.
4. The database child dying mid-request (`database-process.ts:44`, "The database process stopped").
5. An undo action that itself has to wait (`undo.ts:139-140` returns `waiting`; no test resumes from there).
6. What `bay runs` and the `approve` prompt show after an approval's content changed (see M14 below). Suspected defect: `waiting.ts:114` then shows `null` as the content, so the owner is asked to confirm "null (hash ...)".
7. `bay check` passing on the real kit (finding 17).
8. Import forms the scanner misses (finding 16).

**Bug injection** (each applied alone to the copy, only the listed files run, then reverted; script at `/tmp/quality-eval/mutate.py`)

| # | Mutation | Result | Caught by |
|---|---|---|---|
| M1 | `layout.isInsideOrEqual` loses the `/` boundary | Caught | 5 tests in layout, broker-files, policy |
| M2 | `layout.homeOf` prefers the kit when the project lies inside it | Caught | 1 unit test; no CLI test nests a project in a kit |
| M3 | `task-tokens.isWaitingAt` ignores the step key | Caught | 1 test (earlier-round token) |
| M4 | `checkTaskTokenFor` compares only the run | Caught | 1 test |
| M5 | `tools.overLimit` allows one call too many | Caught | 1 test |
| M6 | `tools.capped` does not redact refusal text | **Missed** | Partly redundant with the broker's own redaction, but not for engine problems that echo input |
| M7 | Store `delete` remembers a deletion only if the item existed | Caught | 1 test |
| M8 | Store `put` skips the cost record when only one of items/usd is zero | **Missed** | Every test cost has both non-zero |
| M9 | Store selector includes an item exactly at `until` | Caught | 1 test written for the boundary |
| M10 | Adapter build forgets folders an earlier build created | Caught | "building twice ... clean still restores" |
| M11 | Adapter rebuild records a merged file as pre-existing | Caught | 2 tests |
| M12 | Registry activation does not follow a bound mode's own bindings | Caught | 2 tests |
| M13 | MCP server answers a notification | Caught | 1 test |
| M14 | Stored approval view shows content whose hash no longer matches | **Missed** | No test covers the stored view after a change |
| M15 | Redirect keeps credential headers across hosts | Caught | 1 test |
| M16 | Secrets: base64 at a byte offset not remembered | Caught | 1 test |

**13 of 16 caught.** Most catches rest on a single test, which is normal for boundary conditions and means the suite is specific, not redundant.

## 7. Size

12,995 lines in 75 files, 755 functions, 313 type declarations. By reading plus a rough classifier (`/tmp/quality-eval/size2.py`):

| Share | What | Comment |
|---|---|---|
| about 40% | Essential logic | Engine, broker, runner, registry rules, CLI |
| about 13% (1,700 lines, 108 functions) | Building problems and refusals: wording plus the code that picks it | Earned; this is the product's user interface. `registry.ts` alone is half of it |
| about 11% (1,500 lines) | Type declarations | About a third are argument bags and re-tagged copies induced by the lint rules and the stringly state |
| about 16% | Blank lines, imports, closing braces | Formatting at width 120 |
| about 6% (700 to 800 lines) | Hand-written validators of internal data: `script-protocol.ts` (213), the database and query child protocols, row readers in `run-store.ts`, JSON field readers, the guards in `script-host.ts` | Half of this validates data from a trusted peer |
| about 2% (250 to 300 lines) | Duplication | Finding 19 and 20, plus double loading in `check-context.ts` |
| about 5 to 8% | Structure imposed by rules | Helper splits for the complexity cap, bag types for the parameter cap, `toJson` copying for the `as` ban, shape converters (finding 5) |
| about 5% | Scope the proposal put outside the kernel budget or did not foresee | `new.ts` and templates (366), `generate-types.ts`, the hand-written MCP server and argument parser, `task-tokens.ts`, `tools.ts` |

**Is the size justified?** The 4,000-line figure was never realistic for a durable engine with budgets and undo, a broker that runs SQLite in child processes, a confined script runner, a registry with this quality of diagnostics, twelve commands and a tool server. A lean version of the same behaviour is, in my estimate, 9,500 to 10,500 lines. So: about three quarters justified; the rest is the price of the stringly state, the shape zoo and validation on the wrong side of trust boundaries. The owner's decision to accept the size and review after 5.0.0 is reasonable; the density (765 functions, 313 types) is the better thing to watch than the line count.

**Three reductions that would improve readability**

1. **Typed step state and one step-key module** (finding 4). Saves about 150 to 200 lines (`waiting.ts` reverse-engineering, the field readers, the second `SkillTask` builder) and removes the largest implicit convention. Needs: a `detail` union decoded in the run store, `step-key.ts`, edits to `action-steps.ts`, `workflow-steps.ts`, `waiting.ts`, `engine.ts`, `undo.ts`.
2. **Validate only at trust boundaries, from one description.** The parent must validate what a script sends; the child need not validate what the kernel sends (`parentMessageOf`, `answerOf`, `refusalOf` and nine guards in `script-host.ts`, about 120 lines), nor the kernel what its own database child returns (`resultOf`, `isRows`, `isExecuteResult`, `isNames`). Describe the remaining child-to-parent messages as a JSON Schema and check them with ajv, which is already loaded, generating the types with the existing generator. Saves about 250 to 300 lines and replaces five split parser functions with one schema.
3. **Collapse the result shapes** (finding 5). One `Result`, one "finished step" type, `EngineResult` as `Outcome<RunView>`. Saves about 120 to 150 lines of declarations and converters and, more usefully, one vocabulary.

Smaller: `node:util`'s `parseArgs` in place of the 130-line parser in `command-line.ts` (about 90 lines); loading once for `check` (about 80); SDK readers in place of three per-mode `json.ts` files (about 80 lines of mode code).

## 8. Done well; keep as it is

- **The strictness is real.** `npm run typecheck`, `lint`, `deadcode`, `format:check` and `generate:check` all exit 0. In production code there is no `any`, no `as` other than `as const`, no `!`, no `@ts-` comment, and `noInlineConfig` makes `eslint-disable` impossible. `Reflect.get` appears twice, both for good reason.
- **The adapter boundary.** One contract file, effects passed in, a pure `decide(setup, payload, facts)`, a build record that makes `clean` exact, and a README that states what the hook does not stop and what was never run live.
- **Error messages.** Every `Problem` has a place and a `fix`; every `Refusal` says what was asked, what is declared and what to change. This is rare and worth its lines.
- **`scrubbedStore`** (`bay/scrubbed-store.ts`): redaction of everything stored is a wrapper around the store, so no caller has to remember it.
- **`policy.ts`**: 299 lines, pure, one place for "what may a mode name". **`http-access.ts`** and **`file-access.ts`**: small, pure, discriminated results.
- **Discriminated unions at process and file-system edges**: `ChildEnd`, `PathCheck`, `UrlCheck`, `LockResult`, `Waiting`, `DatabaseResult`.
- **The run-store contract suite** and the engine tests parametrised by store kind.
- **Tokens** are stored as hashes, die with the step, and are tested for both. (The constant-time loop over all tokens in `task-tokens.ts:46-58` is more than a lookup by hash needs; taste.)
- **Limits are warnings.** `bay check` reports the kernel at 12,995 over 4,000 as a warning with the sentence "A line budget never outranks readability", which is the owner's rule in code.
- **Classes only where there is state and a lifecycle** (six of them), no inheritance, `#private` fields; the rule is followed.

**Where the proposal's Code standards and the code disagree**

| Standard | Code | Who is right |
|---|---|---|
| "No comment lines in kit code" | Obeyed | The rule is wrong for four files (finding 7); either allow "why" comments there or require a README per security-critical module |
| "Problems a user can fix are returned as values" | Not for file-system errors or a lost lock | The standard |
| "The clock [goes] through `bay/ports.ts`" | In the kernel yes; mode scripts read it directly | The standard; the SDK should offer it |
| "`yaml`, `ajv` and the MCP SDK at run time" | No MCP SDK; a 126-line server | The code, for six tools over stdio; pin and test the protocol versions as it does |
| "At most three positional parameters" | Obeyed, with `at:` bags | The rule is fine; the bags need real names |
| "Effects ... declared and checked" | Checked statically and for SQL only | The standard |

## 9. What I did not look at, and confidence

Not read: `check-skills.ts`, `check-layout.ts`, `check-limits.ts`, `new.ts`, `run-report.ts`, `settings-listing.ts`, `folder-links.ts`, `terminal.ts`, the commands other than `approve`, `call` and `check`; in the adapter `agent-file.ts`, `coordinator.ts`, `settings.ts`, `mcp-config.ts`, `root-scan.ts`, `guard-input.ts`, `guard-commands.ts`; the scripts of `fake-source` and `feed-briefing`; about 55 of the 63 test files beyond their names and assertion counts. I did not run the whole test suite (only about 25 files, in the mutation runs, all green before mutation). I did not look at performance, at a live Claude Code session, at the `wt-k8` worktree, or redo any penetration testing.

| Section | Confidence | Why |
|---|---|---|
| Boundaries and import graph | High | Computed, and the key files read |
| Verified defects (findings 1, 2, 3, 16, 17) | High | Each reproduced |
| Interfaces | High for the kernel types; medium for the store interfaces | Read the two YAML files and one request schema in full, the rest by size and diff |
| Readability | High for engine, broker, registry, runner, adapter core; none for the unread files | |
| TypeScript practice | High | Tools run, patterns searched across all production code |
| Tests | Medium | Small reading sample; the injection is the stronger evidence |
| Security as code | Medium | Read for structure, not attacked |
| Size | Medium | The classifier is rough; shares are within a few points, savings are estimates |
| Suspected, not verified | | `SkillTask.outputSchema` showing one of two schemas; the approval prompt showing `null` after a content change |
