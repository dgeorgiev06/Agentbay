# Forge, design A: the smallest forge worth using

Constraint: the least that takes "build a mail source mode that reads made-up mail from a folder" to a verified, merged slice, with the kernel holding the state. Every stage and every kernel addition below was asked "what breaks if this is left out of the first version?". What was left out is listed in section 7, with when it must come back.

Numbers are marked (measured) when they come from the frame's facts or the repository, and (estimated) otherwise.

## 1. The shape

Forge is one workflow in one base mode, `forge`, that requires one interface, `toolchain@1`. The TypeScript toolchain is the existing `components/base/typescript/` folder made into a mode. A run builds exactly one slice. A deep skill writes the brief; scripts lint it; the owner approves it. A script makes a worktree and records the baseline. A builder (balanced tier) works in the worktree and commits; scripts rerun the toolchain's checks, diff the changed files against the brief's write scope, and apply the builder's bug injections in throwaway copies. A fresh reviewer (deep tier) gives a verdict per definition-of-done id and proposes its own injections, which scripts apply and run. A failed review sends the slice to a fresh builder with the findings, at most twice. A script merges the main line into the branch and reruns the checks; the owner approves; a script merges. The kernel holds the run, the approvals, the rounds, the budget and forge's own table of slices. It gains two things: scripts may run listed commands, and a skill step may use the commands of the base mode bound to its mode.

```
owner request
   |
[brief]  skill, deep ---- check-brief.ts (sections, ids, levels, no "if", commands known, scope)
   |
<approve brief>  owner: Approve / Reject
   |
[build]  prepare.ts (worktree, baseline) -> skill build, balanced
   |        checks: scope, clean tree, commits, toolchain.check, measures, report ids, builder injections
   |
[review] ready.ts -> skill review, deep, fresh -> record.ts
   |        checks: a verdict per id, reviewer injections run in copies, slice untouched
   |
[pending] -- fixes? --> foreach (0 or 1 item): [build with findings] -> [review]   (twice at most)
   |
[integrate]  merge main line into branch, toolchain.check on the whole; refuses a failed verdict
   |
<approve merge>  owner: Approve / Reject
   |
[merge]  fast-forward the main line, remove the worktree
```

## 2. The modes

Two modes, both base modes, because only base modes may list commands (measured: `bay check` refuses `commands:` outside `components/base/`).

### `forge` (components/base/forge/)

```yaml
name: forge
version: 0.1.0
description: Builds one slice from a request, from a brief the owner approves to a merge the owner approves.
requires:
  interfaces: [toolchain@1]
settings: schemas/settings.json            # mainLine, injectionsAtLeast, fixRounds is fixed at 2
resources:
  db: { migrations: migrations/ }          # one table: slices
  files: { read: ["."], write: [work/forge/] }
  commands: [git worktree, git diff, git status, git log, git add, git commit, git stash,
             git merge, git apply, git rev-parse, git branch, ./bay.sh]
```

| Action | What it does | Effects |
|---|---|---|
| `brief` | Writes the brief for one slice from the request; skill `brief`, checked by `check-brief.ts`. | read |
| `build` | `prepare.ts` makes or reuses the worktree `work/forge/<slice>/` on branch `forge/<slice>` and stores the baseline; then skill `build` with its checks. | read, write, network, spend, delete |
| `review` | `ready.ts` refuses a blocked or missing build and records the slice's HEAD; skill `review` with its checks; `record.ts` stores the verdict. | all five |
| `pending` | Answers `{ fixes: [] }` or `{ fixes: [{ round, findings }] }` from the slices table. | read |
| `integrate` | Refuses a slice whose last verdict failed. Merges the main line into the branch; a conflict fails the step and keeps the branch. Runs `toolchain.check` on the whole and returns what the owner approves. | all five |
| `merge` | Fast-forwards the main line to the branch in the project checkout, which must be clean; removes the worktree and the branch. | all five |
| `discard` | Removes a slice's worktree and branch. The owner runs it by hand; nothing calls it. | all five |

`build` has no `undo`, on purpose: a failed run keeps the branch and its commits for the owner and for a fresh builder.

| Skill | Tier | Output | How it is checked |
|---|---|---|---|
| `brief` | deep | The brief: id, kind (`new-mode`, `change`, `bug-fix`, `move`), the seven sections, a numbered definition of done, write scope as globs, the real-thing commands, open choices each with a recommendation, and `later` (titles of further slices when the request needs more than one) | `check-brief.ts`: seven sections in order; ids unique and `DOD-<id>-n`; each item has a level; no item contains "if"; each `must` names a command or a path; every command in Tools starts with a prefix of forge or the bound toolchain; write scope is non-empty, inside the project, and outside `work/`; Input names every practices file `toolchain.describe` returns plus `framework/practices.md`; a `bug-fix` has a red command, a `move` has a capture command; the real-thing commands start with a known prefix |
| `build` | balanced | `{ status: "built", report, injections: [patch, tests] }` or `{ status: "blocked", items: [ids], why }` | `check-build.ts` and its parts below. A `blocked` output passes the checks and stops the run at `review` |
| `review` | deep | A verdict per DOD id (`verified`, `not verified`, `inconclusive`) with the command rerun and its last lines; standards findings citing a practice id or marked judgement; its own injections; `passed` true only when every `must` id is verified | `check-review.ts` below |

`check-build.ts`, each part a small file under `scripts/checks/` sharing one library:

1. Scope: `git diff --name-only <base>...HEAD`; every file matches the brief's write scope.
2. Clean: `git status --porcelain` is empty, and the branch has at least one commit past the base.
3. Toolchain: `toolchain.check` on the worktree passes. Each measure marked `mustNotRise` (debt, copy-paste count) is not above the baseline. Every other measure (lines, tests) is stored and reported, never judged (P-13).
4. Report: it names every DOD id, and lists deletions, the same thing in more than one place, what was not done and what was not verified (P-22).
5. Injections: at least `injectionsAtLeast` patches. Each is applied in a fresh detached worktree under `work/forge/tmp/`, `toolchain.test` runs with a time limit, and the copy is removed. Every patch must be caught. Results are cached by patch hash in the slices table, so a later round does not rerun them.

`check-review.ts`:

1. Every DOD id of the brief has exactly one verdict; a `verified` verdict quotes a command and its last lines.
2. The reviewer's injections touch lines the builder's did not (P-18). They are run as in check 5 above. Each survivor must appear as a finding. The feedback round tells the reviewer which survived.
3. Untouched: the slice's HEAD and `git status` are what `ready.ts` recorded. The reviewer edited nothing (P-23).
4. The real-thing commands of the brief are run by the script in a fresh folder `work/forge/try-<slice>/` and their output is attached to the run's events. The reviewer's verdict on the real-thing item must quote that output, not its own.

### `typescript` (components/base/typescript/, today a plain folder)

It gains a `mode.yaml` that `implements: [toolchain@1]`, lists its commands (`npm run check`, `node --test`, `npx --yes jscpd@4`, `npx knip`), and three scripts. Its tool configuration and `practices.md` stay where they are.

## 3. The workflow

Workflows have no branch and no loop (measured: steps are action, approval, wait, foreach). A fix round is a `foreach` over a list that `pending` makes empty when the review passed. The file is unrolled for the two rounds the rules allow.

```yaml
name: build
trigger: { manual: true }
budget: { minutes: 240 }
steps:
  - id: brief
    action: brief
    input: { request: $trigger.request }
  - id: approve-brief
    approval: Build this slice as briefed? Approving starts the builder.
    show: $steps.brief.output
  - id: build
    action: build
    input: { brief: $steps.brief.output }
  - id: review
    action: review
    input: { slice: $steps.brief.output.id }
  - id: pending-1
    action: pending
    input: { slice: $steps.brief.output.id, round: 2 }
  - id: fix-1
    foreach: $steps.pending-1.output.fixes
    steps:
      - id: rebuild-1
        action: build
        input: { brief: $steps.brief.output, fix: $item }
      - id: rereview-1
        action: review
        input: { slice: $steps.brief.output.id }
  - id: pending-2
    action: pending
    input: { slice: $steps.brief.output.id, round: 3 }
  - id: fix-2
    foreach: $steps.pending-2.output.fixes
    steps:
      - id: rebuild-2
        action: build
        input: { brief: $steps.brief.output, fix: $item }
      - id: rereview-2
        action: review
        input: { slice: $steps.brief.output.id }
  - id: integrate
    action: integrate
    input: { slice: $steps.brief.output.id }
  - id: approve-merge
    approval: Merge this slice into the main line?
    show: $steps.integrate.output
  - id: merge
    action: merge
    input: { slice: $steps.brief.output.id }
```

Action budgets (estimated): `build` 75 minutes, just above the slowest builder by hand (70, measured), because commits survive a stop; `review` 45 minutes. At a limit the run waits and asks the owner to extend or stop, as today.

## 4. The toolchain interface

```yaml
# components/base/interfaces/toolchain.yaml
name: toolchain
version: 1
actions:
  describe:   # {} -> { language, files: [globs], tests: [globs], practices: [paths], commands: [prefixes] }
    input: toolchain/describe-request.json
    output: toolchain/describe-response.json
    effects: [read]
  check:      # { folder } -> { passed, parts: [{ name, passed, tail }], measures: [{ name, value, mustNotRise }] }
    input: toolchain/check-request.json
    output: toolchain/check-response.json
    effects: [read, write, network, spend, delete]
  test:       # { folder, tests?: [paths], minutes } -> { passed, timedOut, tail }
    input: toolchain/test-request.json
    output: toolchain/test-response.json
    effects: [read, write, network, spend, delete]
```

`check` and `test` declare all five effects because they run code the builder wrote. `describe` is read-only, so the brief skill may call it through `call_action`.

| | TypeScript mode | A Go mode (later) |
|---|---|---|
| `check` parts | `npm run check` (types, lint, format, both dead-code runs, tests) and the copy-paste detector | `gofmt -l`, `go vet ./...`, `staticcheck ./...`, `go test ./...` |
| `measures` | non-test lines, tests, debt entries (`mustNotRise`), copy-paste blocks (`mustNotRise`) | lines, tests, `staticcheck` findings (`mustNotRise`) |
| `test` | `node --test` on the given files, or all | `go test` on the given packages, or all |
| `practices` | `components/base/typescript/practices.md` | its own `practices.md` |

Practices live in three places, later ones adding to earlier ones: the toolchain mode's file, `framework/practices.md` (language-neutral), and the project's `standards/` folder. The owner adds a practice by adding an entry to one of those files. The brief skill must name them all in Input, and `check-brief.ts` holds that. Forge names no language: it calls `toolchain.*` and reads prefixes from `describe`.

## 5. Kernel additions

| # | What | Why forge cannot do without it | How small | Feature | When |
|---|---|---|---|---|---|
| K1 | Scripts may run a listed command: `context.commands.run({ argv, cwd, minutes })` returns `{ exit, tail, timedOut }`. The kernel runs it outside the confined process, without a shell, with a time limit and a scrubbed tail. Allowed only when the command starts with a listed prefix (the rule the hook already applies), `cwd` is inside the mode's grants, and the action declares all five effects, the same rule that gives a skill step `Bash` today. Time spent draws from the run's minutes. | Without it no script can run `git` or a check (measured: scripts may start no child process). Every check would be the agent's own pasted output, and the kernel could verify nothing: not scope, not checks, not injections, not the merge. This is what turns "the reviewer says" into "the kernel saw". | One request kind through the broker, one toolbox member, one effect-rule row. About 80 to 120 lines with tests (estimated). | broker (the check), scripts (the toolbox member and the host message) | Before forge. First slice. |
| K2 | A skill step's command prefixes are its mode's own plus those of each base mode bound to an interface its mode requires. K1 uses the same union for the real-thing commands. | The builder must run the toolchain's tests while it works (P-17, test first and seen failing). Without K2, forge would have to list `npm` itself and would name a language. | One function in the effect rule, used by the harness build and by K1. About 20 to 40 lines with tests (estimated). | safety (the effect rule), harness (the build) | Before forge. Second slice. |

Nothing else is added. Reused as they are: workflows with `foreach` as the only conditional, approvals bound to the content shown, skill steps with script checks and three feedback rounds, action and workflow budgets, the store (forge's own SQLite file), `call` to a required interface, `call_action` for `toolchain.describe`, the relay protocol, tiers mapped to models by the adapter, task reissue for a stopped session.

## 6. The worked example

Project: the kit itself, with `bindings: { toolchain: typescript }` and `settings.forge.mainLine: feat/0022-agentbay5`.

1. **The owner types**, in his Claude Code session: "Forge: build a mail source mode that reads made-up mail from a folder." The coordinator finds forge with `bay actions` and runs `bay call --workflow forge:workflows/build.yaml '{"request":"build a mail source mode that reads made-up mail from a folder"}' --json`.
2. **Brief.** The run waits at the `brief` skill. The coordinator hands the task to the `agentbay-forge-brief` agent (deep). It reads `components/modes/fake-source/`, `items-source@1` and the practices, calls `toolchain.describe`, and submits brief `MF1: the mail-folder mode serves made-up mail from a folder as an items-source`. Kind `new-mode`. Write scope `components/modes/mail-folder/**`. One open choice: message files as `.eml` or as JSON, recommended `.eml` because the Gmail mode will hand over raw messages. `later: ["a mail briefing over the mail-folder source"]`. `check-brief.ts` sends it back once: DOD-MF1-6 said "if the folder is empty, return no items". The second submission says "An empty folder returns `items: []` and `cursor: null`."
3. **The owner sees** the brief, about 65 lines (estimated, like the briefs by hand, measured 62 to 70), with two options: **Approve** or **Reject**. He picks Approve. Rejecting would end the run; he would start again with the change in his request, for example "use JSON files".
4. **Build.** `prepare.ts` creates `work/forge/MF1/` on `forge/MF1` from the main line and stores the baseline measures. The coordinator hands the task to a fresh `agentbay-forge-build` agent (balanced). It writes a failing test with three made-up messages under `tests/mail/`, then the mode, committing after each passing step. It submits its report and 8 injections. The checks find one file outside scope (`components/base/interfaces/items-source.yaml`, edited to add a field) and send it back. The builder reverts the edit, keeps the field inside its mode, and resubmits. All checks pass, and the 8 injections are caught (estimated 10 minutes for them).
5. **Review.** A fresh `agentbay-forge-review` agent (deep) reads the brief, the diff and the check outputs, never the builder's reasoning. It proposes 6 injections of its own. The script runs them: one survives (a message with no `Date` header gets the time of the run, and no test asserts it). The feedback names the survivor. The reviewer adds the finding and sets `passed: false`. The real-thing commands ran in `work/forge/try-MF1/`: a fresh project, `bay config` binding the source, three `.eml` files, then `bay call mail-folder.fetch`. The output was attached, and the reviewer quotes it under DOD-MF1-9.
6. **Fix round.** `pending-1` returns one fix. A new builder, fresh, gets the whole brief, the branch and the finding. It writes the missing test and sees it fail, then changes the code to drop such a message and say so in the output. The checks pass, and a fresh reviewer gives `passed: true`. `pending-2` returns no fixes, so `fix-2` runs nothing.
7. **Integrate.** The main line has not moved, so nothing needs merging. `npm run check` passes on the whole through `toolchain.check`.
8. **The owner sees**: the slice title; each DOD id with its verdict; 14 of 15 injections caught on the first pass and the survivor fixed; the files added; the measures before and after (non-test lines, tests, debt, copy-paste blocks); the commits; one line of the real thing's output. Options: **Approve** or **Reject**. He picks Approve. `merge.ts` fast-forwards `feat/0022-agentbay5` and removes the worktree.
9. **What he did**: one sentence typed, two choices picked. **How long he stayed attached:** the session must stay open for the whole run, about 1.5 to 2.5 hours (estimated from 15 to 70 minutes per builder and about 15 per review, measured, plus a fix round). He need not watch it. If the session stops, the run waits. In a new session he asks "where is forge?". The coordinator runs `bay runs --json` and answers, for example: "MF1: brief approved, fix round 1, waiting for a builder since 14:02, 63 of 240 minutes spent". Then it reissues the task to a fresh builder, which reads `git log` and continues.

## 7. Left out, and when each comes back

| Left out | What breaks without it in the first version | Comes back when |
|---|---|---|
| Several slices per run, with dependencies | A request that needs two slices runs forge twice. `later` names the rest. Order is the dependency: each run starts from the merged main line, so slices never conflict. | When a brief's `later` has more than two entries, or before the home mode (0023), which is likely to need several (estimated). |
| A challenge skill on another model, before the build | Contradictions that a script cannot see reach the builder. Partly covered: `check-brief.ts` catches the mechanical ones (the "if" and the three-way "or" in the five briefs by hand, measured). The builder's `blocked` output turns "noticed and chose" into a stop that reaches the owner. | After the first slice that is blocked or fails review because of its brief. |
| A separate proposal stage | None for a single-slice request: the brief is what the owner approves. | With several slices per run, when the owner should approve the what before the how. |
| Approvals with more than two options | An open choice that differs from the recommendation costs a rejected run and a restart. | When the owner rejects a brief only to pick another option twice. |
| Write scope enforced by the hook per task | A builder can edit outside scope inside `work/forge/`. It is caught at submission by the diff, not prevented. The project checkout is out of reach anyway, because the write root is `work/forge/`. | With several slices running side by side. |
| Direct mode (`Adapter.run`) | The owner's session must stay open. Each task costs about three coordinator turns (measured). | When the owner wants unattended runs, or several runs overnight. |
| A check that is a skill | Review is a step after build, not a check of it. Hence the unrolled `foreach` rounds. | When a third workflow needs a model check. Then the engine gains it once, and this file shrinks. |
| A model per skill, and a second vendor | Builder and reviewer differ only through their tiers (balanced and deep map to different models today, measured). If the owner wants deep builders, they share a model with the reviewer (P-27 then fails). | Before the owner moves builders to the deep tier, or before the 5.0.0 evaluation. |
| Evaluate and learn stages | Nobody looks at the whole without history after a merge. | Before release 5.0.0 (ADR 14 requires an independent evaluation), as a separate workflow. |
| Design round (three designs, compared) | Wide interfaces are still designed by hand (P-14), as this file is. | When the first forge request needs a new interface. |
| Kernel-run test-first proof (test commit fails, code commit passes) | P-17 is held by the reviewer reading the report. | When a review finds a test that never failed. |
| The Go toolchain, and an interface bound to a list | One language per project. | With the first Go project. |

## 8. Answers to the remaining questions

**Kinds of work.** One workflow. The kind is a field of the brief. It changes the brief's required items, which `check-brief.ts` holds: `bug-fix` needs a red command run first; `move` needs a capture before and after, compared byte for byte, and the script that makes the change (P-24); `new-mode` and `change` need a real-thing command. Approvals do not differ. A design round is not a kind yet.

**Slicing.** The brief skill cuts the request. It takes the first slice and names the rest in `later`. The write scope is globs in the brief, checked by a diff at every submission and again at integrate.

**Isolation.** One worktree and branch per slice under `work/forge/`, made by `prepare.ts` and removed by `merge.ts` or `discard`. Throwaway copies for injections live under `work/forge/tmp/` and are removed by the script that made them. A copy left by a killed script is removed by the next `prepare.ts` (P-31). The TypeScript toolchain's configuration must exclude `work/`.

**Starting agents.** Relay only, as today. Each task goes to a fresh subagent, so each fix round is a fresh builder (P-25). What survives a stop: the run, its approvals and rounds (kernel), the commits (git), and forge's slices table. Pickup: reissue the task. The build skill's first instruction is `git status`; leftovers are stashed with `git stash push -m pickup` and reported, never kept.

**Review as code and as judgement.** Scripts: rerun the checks, the scope diff, clean tree, measures, every injection applied and run in a copy, the reviewer untouched, the real thing run. Model: whether a test asserts the right thing, whether the design follows the brief and the practices, and the verdict on each id. A claim is tied to evidence because the scripts rerun every command and the reviewer must quote the kernel's output, not the builder's.

**Models.** Tiers only: brief deep, build balanced, review deep. The adapter maps them.

**Bootstrapping.** See section 10.

## 9. What can go wrong, and what catches it

| Failure | Caught by |
|---|---|
| A builder that lies | The checks are rerun by scripts. The scope is diffed. The injections are run by the kernel. The reviewer quotes the kernel's output. |
| A builder that loops | Three feedback rounds per skill step (measured, today's default), then the step fails. The `build` budget of 75 minutes, then the owner decides. |
| A check that passes vacuously | Builder injections must all be caught. The reviewer's own injections, run by the kernel, expose tests that miss behaviour (by hand they did so in about one slice in three, measured). |
| A merge conflict | Only one slice runs at a time, so conflicts come from the owner's own commits. `integrate` aborts the merge, keeps the branch and fails the run with the files named. |
| A stopped session | A durable run, a reissued task, commits on the branch, a stash for leftovers. |
| A budget overrun | The run waits at the limit and asks the owner to extend or stop. |
| A killed run leaves an injected bug | Builders and reviewers never inject. They submit patches, which scripts apply only in copies. |
| A contradictory brief | `check-brief.ts` catches the mechanical ones. The builder's `blocked` output catches the rest, at the cost of one builder start. |

## 10. Build order (by hand, one builder each)

1. **K1** commands for scripts (broker, scripts). Proven on the real thing: a test mode lists `git status` and runs it from a script; an unlisted command and a missing effect are refused.
2. **K2** the commands of the bound base mode (safety, harness). Proven by `bay build` writing the union into the hook policy.
3. **toolchain@1 and the TypeScript mode**: the interface, `mode.yaml`, three scripts, measures, `work/` excluded. Proven by `bay call typescript.check` on the kit.
4. **forge, its scripts**: the slices table, `prepare`, `pending`, `integrate`, `merge`, `discard` and every check script, tested on a throwaway git repository with a scripted fake slice.
5. **forge, its skills and the workflow**: `brief`, `build`, `review` to the seven-section contract, and `workflows/build.yaml`. Proven by forge itself on a toy request: "add a README example to fake-source". **This is the first slice forge builds itself.**
6. **MF1, the mail-folder mode**, through forge: the first real job (section 6). Then the mail briefing, as a second run.

## 11. Trade-offs

What this makes harder:

- The workflow file is unrolled, and its `foreach` stands in for an `if`. A reader must know the trick. A third fix round means editing the file.
- One slice per run makes larger requests slow and puts the slicing judgement in one deep skill with no second reader.
- Injections run by the kernel cost time on every round: about 10 to 20 minutes per slice (estimated). The cache by patch hash only saves repeats.
- Worktrees inside the project mean every toolchain must exclude `work/`.

**The strongest argument against it.** Most of the faults found by hand were found by judgement: a reviewer's own injections, and walking the real thing. In this design both are still a model's work. The kernel now runs the commands, but the agents choose what to run. The structural gains that would change outcomes, not just bookkeeping, are all deferred: write scope enforced while the builder works, contradictions caught by a second model before a builder starts, and runs that do not need the owner's session. So this first forge may give the owner the same results as two days by hand, with a ledger kept by the kernel. That is fewer checks than the process it replaces, because the reviewer by hand also challenged each brief before sending it. The reply: K1 is what every later addition needs, and section 7 says when each deferred piece must come back.
