# Plan 0022: port agentbay to TypeScript

## Summary

This plan is for proposal 0022 (main a7a425d, 4.0.0). It implements nothing. Three Opus agents read the whole repository on 2026-11-14: the static half of the kernel, the runtime half with the adapter, and the tests with the kit code. Their findings are the basis of the build order below. Where this plan and the proposal differ, the plan wins.

- **The port is 18 slices in 8 stages**, then 4 feature slices. At most three builders work at once; slices in one stage touch no common file.
- **Every builder is an Opus agent. Fable reviews every slice** against this plan, the proposal and the standards, one round, before the slice merges into the integration branch.
- **Stage 0 is spikes.** Three unknowns can each change the design. They are answered with running code before any dependent slice starts, and the answers come back to the owner if they change the proposal.
- **Nothing reaches main until cutover.** The integration branch is `feat/0022-typescript`. The cutover pull request deletes Python and is the owner's second gate.

## What was measured and how

All on main a7a425d, on Python 3.13.18 and Node 22.23.4.

| Fact | Value | How |
|---|---|---|
| Suite | 576 passed, 0 failed, 113 s | `python3 tests/run.py -q` |
| Kernel | 31 files, 9,703 lines | `git ls-files 'bay/*.py'`, `framework/limits.yaml` |
| Kit Python | 26 files, 6,415 lines | `git ls-files` under `components/`, tests excluded |
| Adapter | 535 lines | `adapters/claude-code/claude_code.py` |
| Tests by kind | about 300 call `bay.*` directly, 76 run the CLI, 200 test connectors | AST classification of each test function |
| Golden data | 283 KB in 6 files | `tests/golden`, `components/base/{improve,store}/tests/golden` |
| Node runs `.ts` | yes, no flag | `node a.ts` |
| Node 22 SQLite authorizer | absent | method list of `DatabaseSync` |
| Import cycles in `bay/` | 4 | model with config, rules, contenttypes; checks with lint |

Not measured: anything about the TypeScript that does not exist yet.

## Where the port is harder than it looks

1. **Connectors import the kernel.** `corpus_store.py` imports seven kernel modules, `pipeline.py` four, and the adapter five. Lint rule at `bay/lint.py:1105-1119` requires every `from bay import X` to resolve to `bay/X.py`, so it fails the moment a module is ported. The rule is switched to the TypeScript contract in stage 6, not before.
2. **Tests assert on Python formatting.** Messages contain `['a']` and `None` (`bay/model.py:126,311,623,634`, `bay/lint.py:279`). `bay/pytext.ts` reproduces it (proposal, section 6).
3. **Persisted ids depend on Python's JSON.** `util.short_hash` hashes `json.dumps(sort_keys=True, ensure_ascii=False, default=str)` (`bay/util.py:56`). The serializer must match byte for byte.
4. **YAML 1.1.** PyYAML reads `yes`, `on`, octal and timestamps differently from YAML 1.2 parsers and lets duplicate keys through. `rules._LineLoader` needs node line numbers (`bay/rules.py:50-60`).
5. **Schema error text.** `jsonschema` messages reach lint output and tests. Ajv words them differently. Either the messages are mapped per keyword in `spec.ts`, or the tests that quote them are edited; spike B decides by counting the affected tests.
6. **Checks that read Python source.** The dead-code graph (`bay/graph.py:118-122,267-352`), `effects_match_code` (`bay/conformance.py:197-257`), the stdlib-only check for `derive.py` (`bay/contenttypes.py:255-272`), B-7's import scan (`bay/lint.py:466-534`) and five of the nine limits (`bay/limits.py:25-86`). Each is rebuilt on the TypeScript compiler API or replaced by knip.
7. **The guard's Python semantics.** `shlex.split`, `fnmatchcase`, `casefold`, inode comparison, `O_NOFOLLOW` (`bay/guard.py:136-160,175-183,234-249`).
8. **Truthiness and ordering.** Empty lists and dicts are falsy in Python and the code relies on it. JavaScript objects move integer-like keys first. Builders use `Map` where key order is observable and never rely on `||` for empty collections.
9. **`python3` is baked into generated files** at `adapters/claude-code/claude_code.py:96,102,106,354,371`, `bay.sh:3` and `bay/guard.py:47,69,427`.

## Stage 0: spikes and toolchain (one builder)

Slice S0. It writes throwaway code under a scratch folder and commits only the toolchain and a one-page result in this plan's "Spike results" section.

| Spike | Question | Pass | If it fails |
|---|---|---|---|
| A. SQLite | Is there a Node binding with authorizer, progress handler, `setlimit` and `hard_heap_limit`? Candidates: the built-in module on a newer Node, the official SQLite WebAssembly build, a native binding. | `bay/sqlsandbox.py`'s tests can be expressed against it | Back to the owner with the worker-and-timeout design before S7 |
| B. YAML and schemas | Does `yaml` in 1.1 mode load every manifest in the kit to the same value as PyYAML, with line numbers? How many tests quote a `jsonschema` message? | A script compares both loaders over every `.yaml` in the repo; zero differences | Differences are listed; each gets a rule in `spec.ts` |
| C. Shim isolation | How does a Node launcher ignore `NODE_OPTIONS` and `NODE_PATH` and refuse to resolve modules from the project? | A shim started with hostile values of both loads nothing foreign | Back to the owner |

Toolchain committed by S0: `package.json`, lockfile, `tsconfig.json`, `components/base/typescript/` configs, the test script, the differential harness `tests/parity/run.ts`, and the Python-output corpora for `shlex`, `casefold`, `repr` and `json.dumps`.

## Build order

A slice is one builder, one branch from `feat/0022-typescript`, one pull request into it. Slices in the same stage run in parallel.

| Stage | Slice | Ports | Lines of Python |
|---|---|---|---|
| 1 | S1 | `spec` (new, out of `model`), `util`, `pytext` (new), `protocol`, `proposal`, `playbook` | about 300 |
| 1 | S2 | `secretscan`, `vault`, `ledger` | 491 |
| 1 | S3 | `ports` (new), `boundary`, `selector`, `workflows` | 1,003 |
| 2 | S4 | `rules`, `config`, `model` | 1,631 |
| 2 | S5 | `guard`, `hook`, `use_shim` | 743 |
| 3 | S6 | `lint`, `checks` | 1,243 |
| 3 | S7 | `sqlsandbox`, `contenttypes` | 1,005 |
| 3 | S8 | `graph`, `conformance`, `limits`, `standards` on the TypeScript compiler API and knip | 935 |
| 4 | S9 | `connect`, `adapter`, `registry`, `scaffold`, templates | 644 |
| 4 | S10 | `dispatch` | 868 |
| 5 | S11 | `cli`, `bay.sh` | 845 |
| 5 | S12 | `adapters/claude-code` | 535 |
| 6 | S13 | store connectors: `corpus-store`, `store`, the three `derive` scripts, `fake`, `fake-mail` | about 2,000 |
| 6 | S14 | source and mode connectors: `gmail-api`, `x-api`, `todo-rules`, `workflow-runner`, `delivery` | about 1,600 |
| 6 | S15 | framework connectors: the `improve` set, `scaffold`, `typescript-check` (replaces `python-check`), `comments-check` | about 2,800 |
| 7 | S16 | the remaining tests in `tests/` not ported with their module; the full suite green on TypeScript only | - |
| 8 | S17 | cutover: delete every `.py`, `requirements*.txt`, `conftest.py`, `tests/parity/`; `kernel.yaml`, `limits.yaml`, roles, conformance rules | - |
| 8 | S18 | docs, CHANGELOG with Upgrading, version 5.0.0 | - |

Notes on the order:

- `guard` (S5) needs only `secretscan` and `ledger`, so it starts early and has the longest review.
- `model` (S4) is one builder: it is the largest file and everything after it reads its types.
- A module's own test file is ported in the same slice as the module. S16 covers tests that span modules (`test_boundaries.py`, `test_protection.py`, the goldens).
- Until stage 6, ported kernel modules are exercised by their TypeScript tests and the harness; the Python connectors keep running on the Python kernel. Stage 6 is the first point where a full call runs on TypeScript end to end.

## Definition of done for every slice

A builder's pull request is ready for review when all of these hold, and it says so with the last line of each command:

- [DOD-1] (must) Every test function of the ported module's Python test file exists in TypeScript with the same name and the same assertions, and passes.
- [DOD-2] (must) `tsc --noEmit` and eslint report nothing on the files of the slice.
- [DOD-3] (must) No `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or non-null `!`.
- [DOD-4] (must) The differential harness shows no difference for every command the slice makes runnable.
- [DOD-5] (must) The Python suite still passes; no Python file is changed, except as this plan names.
- [DOD-6] (must) The slice changes only the files this plan lists for it.
- [DOD-7] (must) No comment lines in kit code; no line over 120 characters; no line packed to save lines.
- [DOD-8] (must_not) No new runtime dependency.
- [DOD-9] (should) Each exported function has the same name as its Python counterpart in camelCase, so the two files can be read side by side.
- [DOD-10] (must) Anything the builder could not verify is listed as unverified, not as done.

## Review

Fable reviews each pull request once and returns a verdict per DOD id plus these checks:

- R-1 The TypeScript does what the Python does, read function by function, including the error paths.
- R-2 Structure rules of the proposal, sections 2 and 3a: no cycle, effects only through `ports`, types generated not hand-written, and the class, function and module rules that no tool enforces.
- R-3 For S5, S7, S2 and S10: the security behaviour is unchanged, checked against the Safety model in DESIGN.md and, for the guard, the whole golden matrix.
- R-4 Tests assert behaviour, not implementation; a test weakened to pass is a blocker.
- R-5 The diff holds nothing the slice did not need.

A failed must item or a blocker goes back to the same builder once. A second failure stops the slice and goes to the owner.

## Phase 2 slices

Each gets its own short proposal and gate after 5.0.0, in the order the owner chooses.

| Slice | Feature | Main files |
|---|---|---|
| F1 | Skill contract | `lint.ts`, `scaffold.ts`, a skill template, the 8 `SKILL.md` files, INTERFACES.md |
| F2 | Resume | `dispatch.ts`, `util.ts` (lock), `cli.ts` (`call --resume`), DESIGN.md |
| F3 | Undo | `schemas/interface.schema.json`, `dispatch.ts`, `lint.ts`, `ledger.ts`, DESIGN.md |
| F4 | Codex adapter | adapter interface in `adapter.ts`; `dispatch`, `model`, `hook`, `guard`, `ledger`, `cli`, `conformance` lose their Claude Code names; `adapters/codex/` |

F4 starts with a research step on what Codex can enforce; its result is part of that proposal.

## Risks

| Risk | Why it matters | What limits it |
|---|---|---|
| The guard is weaker after the port | It is the main safety boundary for subagents | The golden matrix must match in full; own slice; R-3; fails closed |
| No SQLite binding has an authorizer | Agent SQL would lose its sandbox | Spike A before S7; owner decides on the fallback |
| A subtle YAML or ordering difference | Manifests resolve differently with no error | Spike B; the harness compares `describe` and `catalog` output for every mode |
| Tests are translated loosely | A green suite would prove nothing | DOD-1 same names and assertions; R-4; test count may not fall |
| The branch lives a long time | Main moves under it | No other framework change merges until cutover, or it is ported in the same pull request |
| Builders drift from the structure | The new kernel ends up as tangled as the old | eslint cycle and boundary rules from S0; R-2 |
| Agent-written code is larger than needed | The limits ratchet starts from a bloated count | R-5; DOD-9 keeps a one-to-one mapping; ceilings are written only at cutover after review |

## Cost against the ceilings

No ceiling is checked against the TypeScript until cutover, because five of the nine measures count Python. At cutover `bay check --limits --write` records the real counts once. `tests` must be at least 463 by the new definition. `top_level_folders` stays 7 and `schemas` stays 16 in the port.

## Release

- 5.0.0 at S18. Upgrading: install Node at or above the minimum spike C fixes, run `npm ci` in the kit, run `bay build` in each project. Python connectors outside the kit must be rewritten.
- 5.1 to 5.4, one per phase 2 slice.

## Where the builders need the owner

1. Approval of the proposal and this plan, with the five choices.
2. Spike results, if any spike fails or changes the proposal.
3. A second failed review on any slice.
4. The cutover pull request into main.
5. Each phase 2 proposal.

## Spike results

Empty until S0 finishes.
