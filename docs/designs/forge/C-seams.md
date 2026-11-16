# Forge, design C: seams first, and every claim proven by a script or labelled judgement

Constraint of this design: put each job where it belongs, keep modes small behind interfaces, and treat a model's unverified statement as worth nothing. Words are as `CONTEXT.md` defines them. Numbers are marked (measured) when they come from the frame's facts and (estimated) otherwise.

## 1. The shape

Forge is four small base modes and a few kernel additions. `forge` holds the stages, the skills and the workflows; it names no language and runs no command. `proof` turns a brief's definition of done into a verdict per item by running scripts; it drives no model. `git-worktrees` is the only mode that may run `git`. `typescript` is the only mode that may run the TypeScript tools. Each definition-of-done item carries a **proof kind** from a closed set, and each kind has one script in `proof` behind it. A builder's report states no check results at all: `proof` produces them. What no script can decide is a `judgement` item, answered by a reviewer on a different model and shown to the owner with that label. The kernel holds the run; the harness adapter starts and confines agents; the owner approves what is built, the choices, and the merge to the main line.

```
owner sentence ─▶ restate (skill, fast) ─▶ owner picks the kind
  ▶ baseline (scripts: tree clean, all checks at base, measures, capture)
  ▶ propose (skill, deep) ─▶ [APPROVAL 1: what, with choices]
  ▶ plan (skill, deep) + proof.plan (script) ─▶ challenge (skill, deep, other model) + proof.demonstrate (script)
  ▶ [APPROVAL 2: slices, scopes, proof files, golden outputs, findings]
  ▶ foreach slice, in order:
       worktrees.cut ─▶ build (skill, balanced, fresh agent, write scope = slice scope)
                     ◀─ proof.slice as the step's check: failed items go back, 3 rounds at most (1 + 2 fixes)
       ─▶ review (skill, deep, other model, no write roots) + check-review (script)
       ─▶ integrate (script: merge into the run's integration branch, proof.slice on the whole)
  ▶ [APPROVAL 3: verdict table, judgement items, sizes, diff] ─▶ worktrees.merge into main ─▶ worktrees.remove
```

## 2. The modes, and what each claim is proven by

### 2.1 Who owns what

| Owner of the job | Its jobs | Not its jobs |
|---|---|---|
| Kernel | Runs, saving after each step, approvals with choices bound to content, budgets, task tokens, running a listed command for a script (K1), write roots per task (K2) | Any model call, any notion of git, a language, a slice or a brief |
| Harness adapter | Writing agent files with tier or model, the hook that enforces a task's write roots, later starting an agent itself (`run`) | Deciding what is built or whether it is good |
| `forge` | Stages, briefs, skills, workflows, what the owner is shown | Running commands; judging its own output |
| `proof` | Every scripted verdict; checking briefs and plans; running reviewer demonstrations | Choosing what to check: the brief says it |
| `git-worktrees` | Worktrees, branches, throwaway copies, overlays, diffs, merges, removal | Tests, languages |
| `typescript` (toolchain) | Type check, lint, format, dead code, tests, mutants, duplicates, the project's measures, its practices file | Scope, git, approvals |
| Owner | The three approvals, choices, practices files, the project's capture file | Typing commands |

### 2.2 Seams, and how many implementations each has today

| Seam | Implementations today | Status |
|---|---|---|
| `items-source@1` (used by the first job) | `fake-source`; `mail-folder` after the first job; Gmail later | Two real after the first job |
| How an agent is reached | Relay (coordinator hands a task to a subagent): real. Direct (`Adapter.run`): planned, not built | One real |
| Harness adapter | Claude Code. Codex is release 5.2 | One real; second hypothetical |
| `toolchain@1` | `typescript`. `go` is an owner requirement, not built | One real. Kept because forge must name no language (decided), not for a swap that may never come |
| `worktrees@1` | `git-worktrees` | One real. Kept as a mode because it is a seam of **grants**: only this mode may run `git`. The interface exists only because cross-mode calls go through interfaces; no second implementation is expected |
| Project measures and capture | agentbay's own and the demo project's | Two real |
| Planner, reviewer, challenger | Skills inside `forge`. The variation is the model, which is configuration | Not interfaces. A `reviewer@1` interface would have one implementation, so by P-10 it does not exist |

The glossary keeps "workspace" for nothing but forbids it for the project, so the frame's "workspace" is `worktrees@1` here. New terms to add to `CONTEXT.md` first (P-29): **proof kind**, **verdict** (verified, failed, not verified), **receipt** (the kernel's record of one command run), **throwaway copy**, **golden output**, **integration branch**.

### 2.3 `git-worktrees`, implements `worktrees@1` (grant: `commands: [git]`, writes `.forge/`)

| Action | Does | Effects |
|---|---|---|
| `cut` | Branch `forge/<run>/<slice>` from a commit, worktree at `.forge/worktrees/<run>/<slice>`; refuses if the branch exists with other commits | read, write |
| `status` | Head, commits since base, clean or the dirty paths, untracked paths | read |
| `changed` | Each path changed between two commits: added, modified, deleted, renamed from | read |
| `copy` | A throwaway copy of a commit's tree under `.forge/copies/` (`git archive`), `node_modules` linked | write |
| `overlay` | Puts named paths from one commit into a copy | write |
| `apply` | Applies a patch to a copy, never to a worktree | write |
| `set-aside` | Commits dirty work to `forge/wip/<slice>/<n>` and resets the worktree to its head | write |
| `merge` | Merges a branch; on conflict aborts, target unchanged, branch kept | write |
| `remove` | Removes a worktree or copy; a worktree only when clean and merged, or on the owner's choice | delete |

### 2.4 `proof` (grants: reads `.forge/`, commands: the project's `real` list, e.g. `./bay.sh`)

No skill. Every action returns, per item, `{ id, verdict, receipts, detail }`. "Not applicable" from a toolchain is **not verified**, never verified.

| Action | Does | Effects |
|---|---|---|
| `brief` | Parses a brief; checks form and typed items; finds contradictions between typed items | read |
| `plan` | `brief` for every slice; ids unique; dependencies acyclic; scopes disjoint; every proof file and golden output exists; each new-behaviour proof is red at base | read, write (copies) |
| `slice` | One verdict per definition-of-done item of a slice, by its proof kind | read, write, delete (copies) |
| `demonstrate` | Runs a reviewer's or challenger's demonstration (a test patch or a proof step) on a copy of head | read, write, delete |

**Proof kinds.** A brief item ends with `proof: <kind> <arguments>`. The closed set:

| Kind | The script does | Verified when |
|---|---|---|
| `passes <kinds>` | `toolchain.check` and `toolchain.test` on a copy of head | Every kind ran, no finding, at least one test ran |
| `test-first <test ids>` | Copy of base, overlay head's test files, run those tests; then on head | Each named test does not pass on base code and passes on head |
| `red-command <proof file>` | Runs the reproduction on base, then on head | Fails on base, passes on head, same both times twice |
| `in-scope` | `worktrees.changed(base, head)` against the slice's scope globs; `status` of the worktree and of the project root | Every changed path is in scope; worktree clean; project root unchanged |
| `untouched <paths>` | `changed` | None of the paths changed |
| `absent <patterns or paths>` | Search on head | Nothing found |
| `unchanged-output <capture file>` | Runs the capture twice on base and once on head, each in a fresh copy | Base runs equal each other (else not verified: the capture is unstable); head equals base byte for byte |
| `mutants-caught` | `toolchain.mutants` on changed lines plus the reviewer's patches; each applied in its own copy, selected tests run with a time limit, copy removed | Every mutant fails a test or times out; survivors listed by file and line |
| `ratchet <measures>` | `toolchain.measure` on base and head; renamed paths mapped through `changed` first | No entry on head that is not on base after renaming; the count may only fall |
| `real-thing <proof file>` | Copies the named fixture project to a temp folder; runs each listed command from the head copy; compares with golden output | Exit codes and outputs equal the golden files; on base the same file does not pass |
| `dropped-listed` | Test ids on base minus test ids on head, files deleted | Each appears in the builder's kept, changed, dropped list |
| `size` | Lines per changed file, base and head | Never a verdict: reported only (P-13). A `must` of this kind is refused by `proof.brief` |
| `judgement` | Nothing | Left to the reviewer, labelled as judgement |

A proof file and its golden outputs are written by the planner, approved at approval 2, and listed in the plan with their hashes. `proof` refuses to run one whose hash differs, so a builder cannot weaken its own proof. Golden outputs make a real-thing proof assert literal values (P-16); a proof that only checks an exit code is refused by `proof.plan`.

**Contradictions a script catches in a brief** (`proof.brief`): a `must` containing a choice left to the builder ("if", "unless", "either", "or ... at your choice"); a `size` item as `must`; a path both `untouched` and in an `absent` or `test-first` item; `untouched` on a path the scope needs changed; "no test added" with a `test-first` item; a `real-thing` item naming a command whose output an `unchanged-output` capture also pins; a `must` with no proof kind. Contradictions of meaning ("every export has a test" against "test only at the entry file") are left to the `challenge` skill.

### 2.5 Every claim, the script that proves it, and what the model is left

| Claim made today | Proven by | Left to a model |
|---|---|---|
| "The brief is consistent" | `proof.brief`, `proof.plan` | Pairs of items that cannot both hold in meaning (challenge, other model); the owner sees each finding |
| "The test fails first" | `test-first`: it fails on base code and passes on head. Stronger than "I saw it fail", and needs no commit order | Whether the test asserts the behaviour the item describes |
| "This bug is reproduced and fixed" | `red-command` | Whether the cause found is the cause |
| "Nothing outside my scope changed" | `in-scope`, plus the hook refusing writes outside the task's roots (K2) | Nothing. Whether the scope was right was approved by the owner |
| "Output is unchanged" | `unchanged-output` with a stable capture | Nothing |
| "Every injected bug is caught" | `mutants-caught` | Where the reviewer injects its own (it submits patches; the script applies them); whether a survivor is equivalent, labelled judgement and shown to the owner |
| "No new boundary break", "no new copy-paste", "no dead code" | `ratchet boundary-debt duplicates dead-code` | The same rule written twice in different words (P-12) |
| "`npm run check` passes" | `passes` on a copy of head, rerun by `proof`, never read from a report | Nothing |
| "Proven on the real thing" | `real-thing` against approved golden output | Quality of a skill's output (a digest's prose), beyond the mode's own check script |
| "I deleted what I replaced" | `absent`, `ratchet dead-code`, `dropped-listed` | The deletion test: would complexity reappear in callers |
| "The working tree is clean; no injected bug left" | `in-scope` reads `status`; mutants live only in copies under `.forge/copies/`, removed per mutant | Nothing |
| "The reviewer did not edit" | Review task has no write roots (K2); `status` of head equal before and after review | Nothing |
| "The reviewer is a different model" | `proof.plan` reads the config: builder and reviewer, planner and challenger, resolve to different models | That the harness honoured the model, in relay. In direct mode the adapter records it |
| "A fresh builder took the fix round" | Direct mode: a new process per task, recorded. Relay: not provable, held by the coordinator's protocol | Stated as not verified in relay |
| "My report is true" | The builder's output schema has no field for a check result. It holds the kept, changed, dropped list (checked by `dropped-listed`), notes per `judgement` item, and questions | The notes, read by the reviewer as claims, not evidence |
| "The design is sound, modules deep, names right" | `ratchet`, lint and the toolchain's rules hold the checkable part | The reviewer, citing a practice id and file and line |

**What a reviewer's own statement is worth.** Its output schema has two kinds of finding. A **demonstrated** finding carries a test patch or a proof step; `proof.demonstrate` runs it on head and keeps it only if it fails there. A **judgement** finding carries a practice id and anchors; `check-review.ts` refuses an anchor that is not a changed line. A verdict on a scripted item is not accepted from the reviewer at all: it may only attach a demonstration. Estimated from brief M2: 8 of its 11 items become scripted kinds, 3 stay judgement.

### 2.6 `forge` (base; grants: writes the kit and `.forge/`; no commands; requires `worktrees@1`, `toolchain@1`, `proof@1`)

`proof@1`, like `worktrees@1`, has one implementation. It exists only because cross-mode calls go through interfaces.

| Action | Run | Effects |
|---|---|---|
| `restate` | skill `restate` (fast); check: four fields, kind in the closed set | read |
| `baseline` | script: `worktrees.status` clean, `proof.slice` with `passes` and the project's measures on head, capture at base; cuts the integration branch | read, write |
| `propose` | skill `propose` (deep); check: sections present, every choice has a recommended option, no "do not say" word | read |
| `plan` | skill `plan` (deep); check: `proof.plan` | read, write (`.forge/proofs/`) |
| `challenge` | skill `challenge` (deep, a different model); check: each finding is demonstrated (`proof.demonstrate`) or names two item ids | read |
| `build-slice` | skill `build` (balanced), `writes: $input.scope` (K2); check: `scripts/prove-slice.ts` calls `proof.slice` and returns failed and not-verified items as feedback | read, write |
| `review-slice` | skill `review` (deep, other model), no write roots; check: `scripts/check-review.ts` | read |
| `integrate` | script: `worktrees.merge` into the integration branch; `proof.slice` with `passes`, `ratchet`, `unchanged-output` on the whole | read, write |

Skills keep the seven sections. Their Rules sections carry the hard lines: report no check result; never edit a proof file or golden output; when the brief is wrong, stop and say which items. The builder runs tests while it works through the kernel tool `call_action` on `toolchain.test`, so no agent has a shell.

## 3. Workflows

One workflow per kind, sharing actions; the kernel's workflows have no branches, and a no-op step per kind would hide what each kind does. `restate` recommends the kind and the coordinator starts its workflow.

```yaml
name: new-mode
trigger: { manual: true }
budget: { minutes: 480 }
steps:
  - id: baseline
    action: baseline
    input: { request: $trigger }
  - id: proposal
    action: propose
  - id: what
    approval: Build this? Pick an option for each choice.
    show: $steps.proposal.output
    choices: $steps.proposal.output.choices
  - id: plan
    action: plan
    input: { proposal: $steps.proposal.output, chosen: $steps.what.output, base: $steps.baseline.output }
  - id: challenge
    action: challenge
  - id: slices
    approval: Build these slices, proven by these files?
    show: $steps.challenge.output
    choices: $steps.challenge.output.choices
  - id: build
    foreach: $steps.plan.output.slices
    steps:
      - id: cut
        action: worktrees.cut
        input: { slice: $item.id, from: $steps.baseline.output.integration }
      - id: built
        action: build-slice
        input: { brief: $item.brief, scope: $item.scope, worktree: $steps.cut.output }
      - id: reviewed
        action: review-slice
      - id: merged
        action: integrate
  - id: merge
    approval: Merge into the main line?
    show: $steps.build.output
  - id: main
    action: worktrees.merge
    input: { from: $steps.baseline.output.integration, into: main }
```

The others differ only in their first stages and required kinds. `change`: as above; `proof.brief` requires a `test-first` item. `fix`: `reproduce` (skill, balanced, its output a red command proven by `red-command` on base) replaces `propose`; approval 1 shows the red command and its output. `refactor`: `baseline` also runs the capture; every slice must carry `unchanged-output` and `ratchet`; approval 1 is skipped when the scope is inside one feature (reversible, P-28), so the workflow `refactor-inside` has no `what` step. `design`: three `candidate` skill runs under different constraints and tiers, `proof.screen` for importable internals, a `compare` skill on a rubric written before the candidates, approval of the recommendation; it ends with a decision record and slices, not code.

## 4. The toolchain interface

```ts
type Finding = { readonly file: string; readonly line: number; readonly rule: string; readonly message: string };
type Ran<T> = { readonly status: "ran"; readonly value: T } | { readonly status: "not-applicable" } | { readonly status: "errored"; readonly output: string };
type TestResult = { readonly id: string; readonly file: string; readonly status: "passed" | "failed" | "errored" | "timed-out" };

type Toolchain = {
  describe: (input: {}) => { language: string; claims: string[]; tests: string[]; practices: string[]; measures: string[] };
  check: (input: { root: string; kinds: ("types" | "lint" | "format" | "dead-code")[] }) => Record<string, Ran<Finding[]>>;
  test: (input: { root: string; select?: string[]; files?: string[]; timeoutSeconds: number }) => Ran<TestResult[]>;
  mutants: (input: { root: string; changes: { file: string; lines: number[] }[] }) => { id: string; file: string; line: number; operator: string; patch: string }[];
  measure: (input: { root: string; names: string[] }) => Record<string, Ran<string[]>>;
  practices: (input: { paths: string[] }) => { file: string; ids: string[] }[];
};
```

Each action is a script that runs its tools through K1 in `root`, which must be the project or a throwaway copy. `mutants` always includes an "empty body" operator, so a test that passes when the code returns nothing is found (P-16). `measure` runs the project's named measures, so a project-specific check such as agentbay's feature-map debt file is a toolchain setting, not forge code.

| | `typescript` (from `components/base/typescript/`, which it replaces) | `go` (hypothetical) |
|---|---|---|
| check | `tsc --noEmit`, eslint, prettier `--check`, knip twice | `go vet`, staticcheck, `gofmt -l`, `deadcode` |
| test | `node --test`, results from the TAP reporter | `go test -json -run` |
| mutants | operators over the changed lines: flip a comparison, negate a condition, drop a statement, return empty | the same operators over Go syntax |
| measure | `duplicates` (jscpd), `boundary-debt` (the project's command and file) | `duplicates` (dupl), the project's own |
| practices | `practices.md` (TS-01 to TS-17) | its own file |

Practices are files with `Applies to` and `Enforced by` per entry. They come from the toolchain, from `forge` (language-neutral ones), and from the project's `standards/` folder; the owner adds one with `bay new practice`. The builder's brief gets the files `practices` returns for its scope; the reviewer cites ids.

## 5. Kernel additions

| # | What | Why forge cannot do without it | How small | Feature | When |
|---|---|---|---|---|---|
| K1 | `context.commands.run({ command, args, cwd, timeoutSeconds })` for scripts of a base mode that lists the command. Argument list, no shell. `cwd` inside the project or `.forge/`. Output scrubbed. A receipt event per run: command, exit, minutes, hash of output | Toolchain and worktree modes are scripts; today only an agent's shell can run `git` or `tsc` | One toolbox call over the existing `Processes` port; one row in the effect rule. Then **delete** agent command grants: `grantedCommands`, `agentCommands`, the hook's prefix matching (`guard-commands.ts`) and the README's "a listed command runs code" hole | scripts, broker, safety; harness and adapter lose code | Before the first job |
| K2 | A skill step may say `writes: $input.scope`: roots inside the mode's own write grant. The task carries them; the hook asks the kernel, through `bay/adapter.ts`, for the open task's roots | Builders write in a worktree whose path exists only at run time; review must have none | One field in the skill step, one function in the harness interface, one lookup in the hook | runs, harness, adapter | Before the first job |
| K3 | An approval may carry `choices`: questions, each with options and one recommended. `bay approve --choose q1=a,q2=b`. The choice is the step's output, bound to the hash. A skill step whose rounds are spent waits on such an approval (one more fresh round with a note, or stop with the branch kept) instead of failing | The owner decides by selecting options; and "after two fix rounds the owner decides" | A field on the approval step and on a decision | runs, command-line | Before the first job |
| K4 | A model per skill in the config: `skills: { forge.challenge: { model: … } }` | Planner and challenger are both deep; without it they resolve to one model | A config key read by the adapter's build | manifests (config schema), adapter | Before the first job |
| K5 | A check may be a skill, run after every script check passed, answering `passed` or `feedback` | Lets review send a slice back inside the rounds. Before it, a failed review waits on the owner through K3 | A check entry of a second shape | runs | After the first job |
| K6 | `Adapter.run(task)` (direct mode), with an idle timeout | Unattended runs; the owner can leave | As planned in 0022 | harness, adapter | After the first job |
| K7 | A binding may be a list; `context.call` names the server | Two toolchains in one repository | As planned | manifests, scripts | When `go` is built |

## 6. Worked example: "build a mail source mode that reads made-up mail from a folder"

1. **Owner types**, in chat: *build a mail source mode that reads made-up mail from a folder.* The coordinator calls `forge.restate`. He sees: goal, problem, smallest change, kind. Options: **new mode (recommended)**, change. He taps one. The coordinator starts `new-mode`.
2. **Baseline** (scripts, about 5 minutes, estimated): tree clean, every check green at base, measures recorded: test count, duplicates, debt entries, sizes.
3. **Approval 1.** Shown: a mode `mail-folder` implementing `items-source@1`, serving messages from files in a folder of the project; nothing changes in what he types except a new binding. Three choices: file format **.eml (recommended: the raw form Gmail returns later)** or one JSON file per message; briefing **bind feed-briefing to it (recommended: one place, ADR 11)** or a new mail-briefing mode now; made-up mail **twelve messages written as fixtures (recommended)** or a generator script. Three taps.
4. **Plan and challenge.** Two slices. S1 `mail-folder`: scope `components/modes/mail-folder/**`; items `test-first` (named tests for paging, a malformed header, an empty folder), `in-scope`, `passes`, `mutants-caught`, `ratchet boundary-debt duplicates dead-code`, `real-thing proofs/s1.yaml` (`bay check`, `bay call mail-folder.fetch '{"limit":3}'` on the fixture project, golden JSON), `judgement` "headers are parsed once at the edge into a typed message (P-06)". S2: a demo project binding feed-briefing to it; `real-thing` on `feed-briefing.sync` with golden output; the digest itself `judgement` plus the mode's own `check-citations.ts`. The challenger demonstrates one finding: a golden file lists messages oldest first while S1's item says newest first; `proof.demonstrate` shows the mismatch.
5. **Approval 2.** Shown: both slices, scopes, the proof files and golden outputs in full, the finding with its demonstration and the planner's fix. Options: **build both (recommended)**, build S1 only, send back with a note.
6. **Build**, nothing shown. Per slice: cut, a fresh builder, `proof.slice` as the check; a failed item goes back with the scope and findings to a fresh builder, at most two times; review; merge into the integration branch. Each slice took a builder 15 to 70 minutes by hand (measured); proofs add 5 to 15 (estimated; mutation dominates).
7. **Approval 3.** Shown per slice: each item id with **verified** and its receipt, or **judgement** with the reviewer's model and anchors; survivors, if any; sizes before and after; the changed files. Options: **merge into main (recommended)**, hold.
8. **Status at any time:** he asks "how is forge doing"; the coordinator runs `bay runs <id>`: the stage, slice 1 of 2, round 2 of 3, items verified so far, who the run waits for, minutes spent of 480.

He types one sentence and taps six options over four moments. In relay mode the chat session must stay open while builders run, about 1 to 3 hours for two slices (estimated from the measured slice times); with K6 he can leave.

## 7. The remaining questions

- **Kinds** (Q1): new mode, change, fix, refactor, refactor-inside, design. They differ by first stage, the kinds `proof.brief` requires, and whether approval 1 exists (section 3).
- **Stages** (Q2): section 1. Every stage's output is checked by a script; contradictions are caught by `proof.brief` and the challenger before any builder starts, and the owner sees both.
- **Slicing** (Q3): the planner cuts; `proof.plan` refuses overlapping scopes and cycles. Scope is enforced twice: the hook prevents (K2), `in-scope` proves. Dependent slices run in plan order, each cut from the integration branch after the previous merge.
- **Isolation** (Q4): a worktree and branch per slice under `.forge/worktrees/`, made and removed by `git-worktrees` only. Bug injection only in `.forge/copies/`.
- **Starting agents** (Q5): relay today, direct with K6; the engine sees no difference. A stopped session leaves the run waiting and the branch with its commits. `bay resume` reissues the task to a fresh builder; its first instruction is `worktrees.status`, then `set-aside` if dirty. Its trail is the commits and the run's events, not a note in `/tmp`.
- **Review** (Q6): section 2.5.
- **Models** (Q7): skills name tiers; K4 pins one skill's model; `proof.plan` refuses a config where builder and reviewer, or planner and challenger, resolve to one model.
- **Language** (Q8): section 4.
- **Bootstrapping** (Q11): section 9.

**What can go wrong** (Q12)

| Failure | What catches it |
|---|---|
| A builder that lies | Nothing it says is evidence; `proof.slice` reruns everything |
| A builder that loops | Tool calls per round (exists), the run's minute budget, the idle timeout in direct mode |
| A check that passes vacuously | "Not applicable" is not verified; zero tests run fails `passes`; the empty-body mutant; an unstable capture is not verified; proofs must be red at base and compare golden output; `proof`'s own tests include a corpus of lying slices (out of scope, a test green on base, a changed golden file, a dirty tree) |
| Merge conflict between slices | Scopes are disjoint by script, so a conflict means the main line moved. `merge` aborts, target unchanged; the run waits with choices: re-cut on the new base with a fresh builder, or stop |
| A stopped session | Durable run, committed work, `set-aside`, a fresh builder on resume |
| A budget overrun | The run waits; the owner extends or stops |
| Proof files weakened | Hashes approved at approval 2; `proof` refuses a changed file |

## 8. Trade-offs

This makes harder: writing a brief (every item needs a kind, and a planner must write golden output before the code exists); adding a new kind of evidence (a new script in `proof`, reviewed like kernel code); and run time, since mutation and capture on copies of the real kit are slow. It moves the judgement the owner cares most about (deep modules, tests that test the right thing, the same rule in two words) into a labelled minority that is still a model's word.

**The strongest argument against it.** Four modes and four kernel additions, about twelve slices (estimated), stand before the mail mode, while the hand process already works and found faults in about one slice in three (measured). The script apparatus proves the claims that were rarely false (scope, check results, clean trees) and leaves to a model the claims that were (whether a test asserts the right thing, whether a design is deep). And "red at base" is weak for a new mode: every proof fails on a base where the mode does not exist. Golden output and mutants answer this only in part.

## 9. Build order

Each slice is one builder, by hand until forge can carry it.

1. K1 commands for scripts, with receipts. Proven on a script that runs `node --version`.
2. `toolchain@1` and `typescript`: `describe`, `check`, `test`. `components/base/typescript/` becomes the mode's folder.
3. `worktrees@1` and `git-worktrees`.
4. `proof` part 1: `passes`, `in-scope`, `untouched`, `absent`, `test-first`, `size`, with the lying-slice corpus. **From here the hand reviewer runs `bay call proof.slice` on hand-built slices**, the first payoff.
5. `typescript.mutants` and `measure`; `proof` part 2: `mutants-caught`, `ratchet`, `unchanged-output`, `red-command`, `real-thing`, `dropped-listed`.
6. `proof.brief`, `proof.plan`, `proof.demonstrate`.
7. K2 write roots per task, with the hook.
8. K3 approval choices, and spent rounds waiting on the owner.
9. K4 model per skill.
10. `forge` part 1: `build-slice`, `review-slice`, `integrate`, and a workflow `slice` that takes an approved hand-written brief. **Forge first builds something itself here**: slice 11, from a hand-written brief.
11. `forge` part 2: `restate`, `baseline`, `propose`, `plan`, `challenge`, the `new-mode` and `change` workflows. Built by forge's `slice` workflow.
12. Delete agent command grants and `guard-commands.ts` (K1's deletion), through forge.

Then the first real job, the mail mode, through `new-mode`. After it: K5, K6, `fix`, `refactor` and `design` workflows, `evaluate`, then `go` with K7, then side-by-side slices.
