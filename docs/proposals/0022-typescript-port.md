---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. The owner decided in chat on 2026-11-14 to port everything to TypeScript, to keep the work in this repository, and to have Opus builders reviewed by Fable. Every count cited was read on main at a7a425d (4.0.0). Where the plan and this proposal differ, the plan wins.
id: "0022"
status: draft
touches:
  - { path: bay/, reason: "every Python module is replaced by a TypeScript module of the same name; bay/templates/ emits TypeScript connectors; the Python files are deleted at cutover" }
  - { path: bay.sh, reason: "launches `node bay/cli.ts` instead of `python3 bay/cli.py`" }
  - { path: adapters/claude-code/, reason: "the adapter is ported; every generated hook, shim and launcher names node, not python3" }
  - { path: adapters/codex/, reason: "NEW in phase 2: a second adapter" }
  - { path: components/, reason: "all 26 Python files under components/ (connectors, checkers, derive scripts) are ported with their tests; connector.yaml `entry:` values change extension" }
  - { path: components/base/python/, reason: "replaced by components/base/typescript/ (tsconfig, eslint config, the typescript-check connector)" }
  - { path: components/base/typescript/, reason: "NEW: the TypeScript standards component" }
  - { path: schemas/, reason: "unchanged in the port; phase 2 adds `undo` to interface endpoints and nothing else" }
  - { path: framework/kernel.yaml, reason: "owns: and protected: name the new files (package.json, package-lock.json, tsconfig.json replace requirements*.txt)" }
  - { path: framework/limits.yaml, reason: "the Python-specific measures are redefined for TypeScript and written once at cutover" }
  - { path: framework/roles/builder.yaml, reason: "the check commands name tsc, eslint and the node test runner" }
  - { path: framework/rules/conformance.yaml, reason: "rules that name Python files or tools are reworded" }
  - { path: tests/, reason: "all 49 test files are ported to the node test runner; golden JSON files are kept byte for byte" }
  - { path: package.json, reason: "NEW: pinned runtime and dev dependencies, the test and check scripts" }
  - { path: package-lock.json, reason: "NEW" }
  - { path: tsconfig.json, reason: "NEW" }
  - { path: requirements.txt, reason: "deleted at cutover" }
  - { path: requirements-dev.txt, reason: "deleted at cutover" }
  - { path: conftest.py, reason: "deleted at cutover" }
  - { path: README.md, reason: "install and launch text; the folder map" }
  - { path: docs/DESIGN.md, reason: "the safety model names node; resume and undo in phase 2" }
  - { path: docs/INTERFACES.md, reason: "the connector contract in TypeScript; the skill contract and `undo` in phase 2" }
  - { path: CHANGELOG.md, reason: "release entries with an Upgrading section" }
exceptions:
  - { measure: bay_lines, to: "measured at cutover", reason: "the measure changes language; typed code is expected to be longer. The ceiling is written once from the real count and falls from there." }
  - { measure: kit_python_lines, to: "renamed kit_lines, measured at cutover", reason: "same" }
  - { measure: long_lines, to: "measured at cutover", reason: "same" }
  - { measure: top_level_folders, to: 7, reason: "unchanged: TypeScript lives in bay/, Node runs it without a build folder" }
---

# 0022: Port agentbay to TypeScript

## Summary

agentbay is 31 Python files in `bay/` (9,703 lines), one adapter (535 lines), 26 Python files under `components/` (6,415 lines) and 576 tests in 49 files. This proposal replaces all of it with TypeScript on Node, and then adds four features the current kernel lacks.

What you get:

- **One language.** Kernel, adapter, connectors, checkers and tests are TypeScript. Python is no longer needed to run or change agentbay.
- **The same behaviour.** Manifests stay `agentbay/v4`. Schemas, CLI commands, ledger events, call state files, store files and settings keys do not change. A project built on 4.0.0 needs a recent Node installed and one `bay build`; nothing else.
- **No build step.** Node runs `.ts` files directly (verified on 22.23.4). `bay.sh` runs `node bay/cli.ts`. There is no `dist/` folder and no bundler.
- **Four features, after the port:** a fixed structure for skills, resume after a crash, undo for failed calls, and a Codex adapter.

The port is release 5.0.0. Each feature is its own minor release after it (5.1 to 5.4).

What it costs, measured and stated plainly:

- About 16,650 lines of Python are rewritten. 87% of the tests call Python directly and are rewritten too; only the golden JSON files (283 KB) carry over unchanged.
- The guard, the SQL sandbox and the secret handling are security code. A port can weaken them silently. The plan treats them as their own slices with the golden guard matrix as the oracle.
- Three things are not known to work yet and are settled by spikes before any slice that depends on them: an SQLite binding for Node with an authorizer and a progress handler, YAML 1.1 parsing that matches PyYAML, and a Node equivalent of `python3 -E` for the use shims.
- Until cutover the branch holds both kernels. Nothing reaches main until the whole suite passes on TypeScript and the Python is deleted in the same pull request.

What the build needs from you: approval of this proposal and its plan, five choices (see Choices for you), and one more gate before cutover.

## What does not change

| Thing | Stays as it is |
|---|---|
| Manifests | `agentbay/v4`, every kind, every field |
| Schemas | every file under `schemas/`, byte for byte, in the port |
| CLI | the 16 commands, their flags and their output text |
| Ledger | `events.jsonl` line format and event types |
| Call state | `.agentbay/calls/<callId>.json` |
| Store | `corpus.db`, `state.json`, views, the SQL limits |
| Golden files | `tests/golden/*` and the three component goldens |
| Rules | B-1 to B-12, C-1 onward, the gate, plan approval, review |
| Layout | `components/base/`, `components/modes/`, seven top-level folders |

## The design

### 1. Where the code lives

Each `bay/<name>.py` becomes `bay/<name>.ts` with the same module name, so a reviewer reads the old and the new file side by side. During the build both sit in `bay/`. The cutover commit deletes every `.py` file.

Node runs TypeScript by stripping the types, so the code uses only syntax that can be stripped: no `enum`, no `namespace`, no constructor parameter properties. `tsconfig.json` sets `erasableSyntaxOnly` so the compiler rejects them. Imports name the `.ts` file.

### 2. Structure rules for the TypeScript

The Python kernel has four import cycles (model with config, rules and contenttypes; checks with lint). The port removes them and keeps them out by rule.

- **A `spec` core first.** `SpecError`, YAML loading, schema checking and path helpers move out of `model` into `bay/spec.ts`. Everything else imports it; it imports nothing from `bay/`.
- **Pure core, effects at the edges.** Reading files, running git, starting processes, HTTP and the clock go through five small interfaces in `bay/ports.ts`. `model`, `lint`, `workflows`, `selector`, `rules` and `playbook` take them as arguments and are tested with fakes. Only `cli.ts`, `guard.ts` and `hook.ts` create the real ones.
- **Types from the schemas.** The TypeScript types of manifests are generated from `schemas/*.json` by a script and committed. A check fails when they are stale. A manifest field cannot exist in code and not in a schema.
- **Gaps are values.** Functions that find problems return them; they do not throw. This is how `bay check` reports every gap at once today.
- **No cycles, no deep imports.** An eslint rule fails on an import cycle, on a core module importing `cli`, `guard`, `hook` or an adapter, and on a component importing anything from `bay/` outside the connector contract (section 4).

### 3. Standards, enforced by the existing standards step

`components/base/typescript/` replaces `components/base/python/`. It holds the configs and the `typescript-check` connector, which reports through the same `standards` step as today.

| Check | Tool | Setting |
|---|---|---|
| Types | `tsc --noEmit` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `erasableSyntaxOnly` |
| Lint | eslint with typescript-eslint | the `strict-type-checked` set, a complexity cap, no `any`, no non-null `!` |
| Escapes | `typescript-check` | a finding for every `@ts-ignore`, `@ts-expect-error` and `eslint-disable` |
| Dead code | knip | unused files, exports and dependencies; replaces the Python AST detector in `deadcode` |
| Comments | `comments-check` | unchanged rule: no comment lines in kit code; it already takes the comment syntax from `component.yaml` |
| Format | prettier | line width 120, as today |

Readable code is the rule, as decided for 0021: a line packed to meet a ceiling is a review failure.

### 3a. Code standards for classes, functions, modules and readability

TypeScript publishes no official style guide. What is official is the compiler's own options (the TSConfig reference marks `strict` and its family as recommended), the `erasableSyntaxOnly` rule set, and the handbook's "Do's and Don'ts". The rules below start from those and add the typescript-eslint rule that enforces each. A rule with no tool behind it is a review check (R-2).

| Area | Rule | Enforced by |
|---|---|---|
| Modules | ES modules only; no `namespace`, no `import =` | `erasableSyntaxOnly` |
| Modules | Named exports only; no default export; no file that only re-exports | eslint `no-restricted-exports`, review |
| Modules | `import type` for anything used only as a type | `verbatimModuleSyntax` |
| Modules | One responsibility per module; no import cycle; core never imports an edge module | eslint import rules |
| Functions | Exported functions state their parameter and return types | `explicit-module-boundary-types` |
| Functions | `unknown`, never `any`; no `Object`, `String`, `Number`, `Boolean` wrapper types | `no-explicit-any`, `no-wrapper-object-types` |
| Functions | A callback whose result is ignored returns `void`; callbacks have no optional parameters | review |
| Functions | A union type or an optional parameter instead of overloads | `unified-signatures` |
| Functions | At most three positional parameters, then one options object; a complexity cap | `max-params`, `complexity` |
| Functions | Parameters are not reassigned; array and object parameters are `readonly` where the function does not change them | `no-param-reassign`, `prefer-readonly-parameter-types` (kernel only) |
| Classes | A class only for something with state and a lifecycle (dispatcher, guard, ledger, store). Data is a `readonly` type and the code that works on it is functions | review |
| Classes | No inheritance between classes; a class may implement an interface | eslint `no-restricted-syntax` on `extends` |
| Classes | Fields declared in the body, `readonly` unless reassigned, private state as `#name`; no parameter properties | `erasableSyntaxOnly`, `prefer-readonly` |
| Types | No `enum`; a union of string literals, or an `as const` object | `erasableSyntaxOnly` |
| Types | A closed set is a discriminated union, and every `switch` over it is exhaustive | `switch-exhaustiveness-check` |
| Types | No type assertion (`as`) except `as const`; no non-null `!` | `consistent-type-assertions`, `no-non-null-assertion` |
| Readability | Prettier formats everything; width 120; no nested ternary; full words in names | prettier, `no-nested-ternary`, review |
| Readability | No comment lines in kit code: a reason goes in a name, an error message or the README | `comments-check`, unchanged |

### 4. Connectors

Connectors stay in-process. A connector is a TypeScript module that exports `create(ctx)`; the dispatcher loads it with `import()` and calls its endpoints as today.

Today connectors import about 30 kernel modules directly (`bay.model`, `bay.boundary`, `bay.sqlsandbox` and more). The port narrows this to one module, `bay/connector.ts`, which exports the `Context` type, `ConnectorError`, and the helpers connectors really use (`parseTime`, `inWindow`, `shortHash`, the selector matcher, the secret scrub, the SQL sandbox). The four kit connectors that are part of the framework itself (`corpus-store`, `improve-detect`, `improve-store`, `scaffold`) are protected paths and may import the kernel modules they wrap; every other connector may import only `bay/connector.ts`. Lint rule B-7 is extended to enforce it.

### 5. Dependencies

Runtime: `yaml`, `ajv` with `ajv-formats`, and one SQLite binding chosen by spike. Development: `typescript`, `eslint` with `typescript-eslint`, `knip`, `prettier`. All pinned, lockfile committed. Tests use Node's built-in runner; there is no test framework dependency. Adding a dependency is a `forge.extend` proposal.

### 6. Proving it behaves the same

Three layers, strongest first:

1. **A differential harness.** A script runs `python3 bay/cli.py` and `node bay/cli.ts` on the same fixture projects for `check`, `describe`, `catalog`, `config`, `build` and the fake-source calls, and compares output, exit code and written files byte for byte. It exists only on the branch and is deleted at cutover.
2. **The golden files.** The guard matrix records every guard decision for every unit, Bash spelling and file tool. The TypeScript guard must reproduce all of it. The stages, improve and briefing goldens work the same way.
3. **The ported tests.** Each Python test function becomes a TypeScript test of the same name with the same assertions. The count may not fall: 576 before, 576 or more after.

Two things must match Python byte for byte and get a dedicated helper each, with tests generated from Python output:

- **Message text.** Lint and resolve messages print lists and missing values the Python way (`['a']`, `None`), and tests assert on them. `bay/pytext.ts` reproduces that formatting. Simplifying the messages is a later proposal, not part of a port.
- **Hashes.** Finding ids hash `json.dumps(sort_keys=True)` output. `bay/pytext.ts` also holds a serializer with Python's separators and key order, or every stored finding id changes.

### 7. The security code

- **Guard.** It parses shell commands with POSIX `shlex` rules, compares paths case-folded and by inode, and fails closed. The port carries its own `shlex` split and Unicode case folding, each tested against a corpus produced by Python. The guard matrix must match exactly.
- **Use shims.** `python3 -E` ignores environment variables that could load foreign code. The Node shim must do the same for `NODE_OPTIONS` and `NODE_PATH` and must not resolve modules from the project. The spike decides how; the reviewer checks it against the threat model in DESIGN.md.
- **SQL sandbox.** It depends on SQLite's authorizer, progress handler, limits and `hard_heap_limit`. Node 22's built-in SQLite exposes none of the first two (checked on Node 22.23.4). The spike picks a binding that does. If none does, the sandbox runs each query in a short-lived worker with a hard timeout and an allow-list check on the parsed statement, and that design comes back to you before it is built.
- **Secrets.** `vault` and `secretscan` are ported first and their tests run against the Python regexes' behaviour (`\Z`, `re.S`).

### 8. Limits

| Measure today | After |
|---|---|
| `bay_lines` (lines in `bay/*.py`) | lines in `bay/*.ts`, generated type files excluded |
| `kit_python_lines` | `kit_lines`: `.ts` lines in protected `components/` and `adapters/` paths, tests excluded |
| `cli_commands` (regex on argparse) | entries in the command table in `bay/cli.ts` |
| `tests` (`^def test_`) | `test(` calls in protected test files |
| `long_lines` | lines over 120 characters in the same `.ts` files |
| `comment_lines` | comment lines found by the TypeScript scanner |
| `framework_folders`, `schemas`, `top_level_folders` | unchanged |

Ceilings are written once at cutover from the real counts and only fall afterwards.

## Phase 2: the four features

Each is designed in full in its own short proposal after 5.0.0. The shape is fixed here so the port leaves room for it.

- **5.1 Skill contract.** A `SKILL.md` has seven sections in this order: Input, Output, Definition of done, Instructions, Tools, Resources, Rules and constraints. Lint rejects a skill that lacks one. Tools and Resources may only name endpoints the feature's `uses:` grants. `bay new` gains the kind `skill`. The eight shipped skills are rewritten to it. Playbooks already have a fixed structure and do not change.
- **5.2 Resume.** Today a call's state is saved only at pauses, so a process that dies mid-step loses the call. The dispatcher will save state before the first step and after every step, and take a lock on the call file. A call found with a started, unfinished step is resumed by `bay call --resume <callId>`: a step with only `read` effects is run again; any other step stops as `blocked` and asks you. No new command.
- **5.3 Undo.** An interface endpoint may name `undo: <endpoint>` of the same interface. When a call fails after write steps, the dispatcher runs the undo endpoints of finished steps in reverse order and records each in the ledger. A step with no undo is listed in the result. `delete` effects are never undone automatically.
- **5.4 Codex adapter.** First the kernel stops assuming Claude Code: runtime names, hook payload fields, tool names and `CLAUDE_PROJECT_DIR` move behind the adapter interface (about a dozen places in `dispatch`, `model`, `hook`, `guard`, `ledger`, `cli` and `conformance`). Then `adapters/codex/` is built. Whether Codex can enforce the guard before every tool call is not known; if it cannot, the adapter says so in its profile and `bay check` refuses roles that need the guard on that runtime.

## Compatibility and safety

- A user project keeps its `agentbay.config.yaml`, data and settings. After upgrading it needs a recent Node (the spike fixes the minimum version) and one `bay build`, because every generated hook and shim changes from `python3` to `node`.
- A third-party connector written in Python stops working. The upgrade note says so and gives the TypeScript contract. No Python bridge is kept (B-12).
- The macOS keychain provider is unchanged (`security`).
- Main is never in a mixed state. The branch holds both kernels; the cutover pull request deletes Python in the same change that makes TypeScript the launcher.

## Out of scope

- Any change to manifest formats, schemas (before phase 2), CLI text or ledger format.
- Simplifying messages, merging duplicated code, or dropping features. Four unused items found by the inventory (`model.LEVEL_RANK`, `Protection.covers`, `proposal.load_touches`, `model.item_kinds`) are simply not ported.
- Token budgets, cloud drivers, interfaces between modes, a mode index. They are in the design document and come after phase 2.

## Measured and estimated

Measured on main a7a425d: 576 tests pass in 113 s; 31 files and 9,703 lines in `bay/`; 26 files and 6,415 lines of Python under `components/`; 535 lines in the adapter; test classes 52% direct calls, 13% CLI, 35% connector; Node 22.23.4 runs `.ts` directly and its SQLite has no authorizer.

Estimated, not measured: the size of the TypeScript; the oldest Node release that runs `.ts` without a flag (the TypeScript documentation names 23.6; 22.23.4 works here; the spike fixes the minimum); whether a Node SQLite binding offers an authorizer and progress handler; whether `yaml` in 1.1 mode matches PyYAML on every manifest in the kit; what Codex's hook system can enforce.

## Choices for you

1. **Message text.** Keep Python-style message text exactly (recommended: it makes the byte-for-byte comparison possible), or switch to JSON-style text now and edit the tests.
2. **Connector imports.** Narrow unprotected connectors to `bay/connector.ts` (recommended), or let them import any kernel module as today.
3. **No build step.** Require a recent Node and run `.ts` directly (recommended), or add a build step and support older Node.
4. **How builders run.** Opus builders started from this chat with Fable reviewing each slice, as you asked (recommended for the port, because the guard and `forge.extend` are themselves being replaced), or through `forge.extend` and the Chief of Staff.
5. **Phase 2 order.** Skill contract, resume, undo, Codex (recommended: smallest first, Codex last because it needs the kernel changes), or another order.
