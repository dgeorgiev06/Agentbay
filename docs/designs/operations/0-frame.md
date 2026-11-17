# Design frame: broker, scripts and the effect rule as one sealed feature

ADR 17 decided that broker, scripts and the effect rule become one sealed feature with one table per operation.
It did not decide the design. Three designs follow (`A-smallest.md`, `B-mode-author.md`, `C-seams.md`) and
`comparison.md` weighs them. This frame is what all three are held to. Measured on `k2/broker-designs` at `a473446`.

## The problem, measured

- The area is 15 files and 3,209 lines: `broker.ts` (916), `script-runner.ts` (354), `effect-rule.ts` (261),
  `script-protocol.ts` (258), `database.ts` (248), `script-host.ts` (212), `sdk.ts` (172), `script-preload.ts` (146),
  `database-process.ts` (134), `file-access.ts` (93), `agent-query.ts` (90), `database-child.ts` (88),
  `http-access.ts` (82), `query-child.ts` (81), `sql-statements.ts` (74). The map calls them three features.
- One operation is written by hand in six files. `files.remove`: `sdk.ts:41`, `script-host.ts:138`,
  `script-protocol.ts:22` and `:144`, `script-runner.ts:142`, `broker.ts:95` and `:324`, `effect-rule.ts:22`, `:53`,
  `:96` and `:168`. That is 11 places. `commands.run` has 18, and its shapes are in `contracts.ts:36-58`.
- The list of operations exists three times and the copies differ. `script-protocol.ts:10-29` has 16 cases,
  `effect-rule.ts:12-28` has 16 kinds, `script-runner.ts:111-168` has three switches. `call` is only in the first;
  `skill.submit` is only in the second.
- Result guards are written twice: rows and execute results at `broker.ts:111-118` and `script-host.ts:85-92`.
- The toolbox takes its types from five other files (`sdk.ts:2-6`). Commit `616e674` gave a command an `input`
  field by editing `contracts.ts`, `script-protocol.ts` and `broker.ts`. The toolbox changed; `sdk.ts` did not.
- Commit `801e406` (commands) changed 8 files under `bay/`. Commit `5f1b960` (throwaway folders) changed 13, in
  the features broker, scripts, safety, vocabulary, platform, check and command-line. (The audit counts 14 files
  in 8 features over the whole slice.)
- 18 of the 26 kit entries in the debt file have an end in this area, and 8 of the 23 test entries.
  `tests/broker-helpers.test.ts` alone imports five private files.
- Running a command needs all five effects (`effect-rule.ts:61-64`, `:221-224`). All 9 actions of git-worktrees and
  2 of 3 of typescript declare all five. Also: no rule ever asks for `read` (`effect-rule.ts:86-103`).
- Only five kinds of event are written by the broker: `refused`, `http`, `redacted`, `command`, `throwaway`
  (`broker.ts:109`). Reads, statements and `secrets.get` leave no event unless refused.

## What must stay true

No design may weaken these. A design that trades one away says so in a section of its own.

- S1. Every operation passes through one rule. There is one function that decides, and no path round it.
- S2. The script runs confined in a child process. The kernel does the operation. The child can read five kernel
  files today (`script-runner.ts:68-74`); that set may change but holds no code that does an operation.
- S3. Grants and effects decide. Nothing is allowed that the manifest does not declare.
- S4. A refusal is a sentence with what was asked, what is declared and what to change (`answers.ts`).
- S5. Every guarded operation that matters is recorded as an event. Today's five kinds are the floor.
- S6. Secrets are scrubbed from every answer, refusal, event and stored value.
- S7. A request from the child is `unknown` until one function has parsed it (P-06).

Effects per listed command (ADR 17) change what S3 means for commands. Today the kernel assumes the worst of a
command. Afterwards the mode's author declares what each listed command does and the owner reviews it; the kernel
cannot check it in a child process. Every design states this the same way and none hides it.

## Callers

| Caller | Uses today |
|---|---|
| Mode scripts, through the toolbox | `ScriptContext`: 16 operations, plus `settings`, `now`, `caller`, `skillInput`; 56 files in the kit's modes import `sdk.ts` |
| Runs | `ScriptRunner.run` (through `kernel.ts:134`); `effectRefusal` for `skill.submit` (`runs/skill-steps.ts:92`) |
| Agent tools | Four broker methods through `kernel.brokerFor` (`tools.ts:50-85`, `kernel.ts:136`) |
| Harness | `writableFolders`, `grantedCommands` (`adapter.ts:46-52`) |
| Check and scaffold | `sdkSpecifier` (`check-imports.ts:6`, `new.ts:6`); the listed commands (`check.ts:32`) |
| Kernel wiring | `createScriptRunner`, `new Broker` |
| Tests | 7 `broker-*` files (1,539 lines), 4 `script-*` files (1,581), `effects`, `tools`, `sdk`, mode tests |

## Fixed for all three designs

So that the designs differ in substance and not in names.

- The feature is called **broker** and lives in `bay/broker/`. The toolbox stays at `bay/sdk.ts`, as the glossary
  says, and is the feature's second entry file. `bay/policy.ts` stays the safety feature: it turns a manifest into
  grants and knows nothing of operations.
- A new word is proposed for `CONTEXT.md`: **Operation**, one thing a script or an agent's tool asks the broker to
  do, named `resource.verb`, such as `files.read`. Do not say: resource request, call.
- `Json` and `Answer` stay vocabulary. Every other type a mode's author can reach is declared in `sdk.ts`.
- Guards are written by hand. A guard built from a description of a shape needs a type assertion, and TS-03
  forbids one. A sketch of a table keyed by operation name, with host, runner and rule reading it, type-checks
  under the kit's compiler flags with no assertion (tried outside the tree, 180 lines).
- The child may read only files that hold shapes: names, guards and types. This is S2, and it splits every
  definition into a part both sides read and a part only the kernel reads.

## Questions every design must answer

1. What are the entry files and what do they export? Who may import them?
2. What is the definition of one operation, and where do its request shape, result shape and guard, needed
   effects, grant check, refusal wording, event record and handler live? Shown in full for `commands.run` and one
   of `db.query` or `files.read`.
3. How is `ScriptContext` produced? Is `sdk.ts` written by hand or derived? What test pins its surface?
4. How is the protocol between child and kernel derived?
5. How does the effect rule read the definition? Where do `call`, `spend` and `skill.submit` go?
6. How do effects per listed command work in the manifest and in the rule? Shown for the `status` and `remove`
   actions of git-worktrees.
7. What is the file layout after, what is deleted, and what does the feature map say?
8. In what order is it built, in slices with write scopes, and which run side by side (P-33, P-34, P-35)?

## How the designs are compared

| # | Criterion |
|---|---|
| 1 | Files touched to add one operation |
| 2 | Files touched to add one field to an existing operation |
| 3 | What a mode's author sees: the toolbox, a refusal, the manifest |
| 4 | What a reviewer of a new operation must read |
| 5 | What cannot be got wrong, by construction, and what is held only by a test or by review |
| 6 | What a test of one operation looks like |
| 7 | Migration: number of slices, longest chain, what runs side by side, expected values that change |
| 8 | What is deleted |
| 9 | Exported names and importers after; debt entries that go |
| 10 | New concepts a builder must learn |
| 11 | What a second transport would cost (ADR 5) |
| 12 | Size after, as an estimate. Reported, never a target (P-13) |
