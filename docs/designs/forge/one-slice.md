# How one slice flows through forge, against the code as it is

Design note FD1, 2026-11-18. Words are used as `CONTEXT.md` defines them. It proposes; it decides nothing (P-25).
Every file and line below was opened in this session on branch `fd1/forge-flow` (cut from `feat/0022-agentbay5`
at `d17fbb1`), and the forge mode as slice W1 leaves it was read on branch `w1/waves` in its own worktree. Where a
claim rests on reading alone, with no test that holds it, the note says so.

The slice used throughout is TR2, as the proof designs used it: base `c7f0d13` (the commit of its brief), head
`c9bb216`, three commits, 11 files changed, +508 -7 (`git diff --numstat c7f0d13 c9bb216`). Its slice in proof@1's
form is the one in `docs/designs/proof/A-smallest.md` section 2, with `name: TR2` and a `level` per item.

What exists on this branch today: runs with named choices and checked cards (C1r), cards printed as lines and
`bay approve --choice` (C1p), `proof@1` and the proof mode with the kinds `checks` and `fails-first` (I1, P1), a
script step of up to 1,800 seconds (KL1), the toolbox's YAML reading, schema checking and path matching (TB1),
copies that are repositories (WT1). Not yet merged: W1 (forge's folder, `forge.waves`), P2 to P5 (the other kinds),
C3, MN1, EK1, KS1.

## 1. The flow, step by step, with TR2's values

F1 is one workflow of the forge mode, `components/base/forge/workflows/one-slice.yaml`, started by the owner's
coordinator with `bay call --workflow forge:workflows/one-slice.yaml '<json>'` (`bay/commands/call.ts:22`). The
workflow schema has four kinds of step: action, approval, wait and foreach (`schemas/workflow.schema.json:92-186`).
An action step may name an action of forge or `interface.action` of an interface forge requires (`:100-103`), and
that action's own `run` list holds the script, skill and call steps (`bay/runs/action-steps.ts:496-514`). So each
row below is a workflow step, and its kind is the kind of the step inside the action it names.

| # | Workflow step | Kind inside | Action | Input (TR2) | Output (TR2) |
|---|---|---|---|---|---|
| 1 | `slice` | script | `forge.slice` | the trigger: `{ planned: { title, slice }, base: c7f0d13, bugs: [] }` | `{ slice, title, base, bugs, card }`: the slice checked against proof@1's schema, and card 1 |
| 2 | `start` | approval, no choices | - | `$steps.slice.output.card` | approve: the card as shown; reject: the run fails, nothing is cut |
| 3 | `cut` | script | `worktrees.cut` | `{ slice: TR2, base: c7f0d13 }` | `{ folder: .forge/worktrees/TR2, branch: forge/TR2, commit: c7f0d1376fd2… }` |
| 4 | `declare` | skill, tier balanced | `forge.declare` | `{ slice, folder, practices }` | proof@1's declaration: 11 files, `names` all empty |
| 5 | `build` | skill, tier deep | `forge.build` | `{ slice, folder, practices, declared }` | `{ outcome: built }` or `{ outcome: stopped, missing: <capability> }` |
| 6 | `keep-work` | script | `worktrees.set-aside` (F1 cut) or `worktrees.commit` (WC1) | `{ folder: .forge/worktrees/TR2 }` | `{ how: set-aside, branch: forge/wip/TR2/1, commit: <work> }` |
| 7 | `prove` | script, calling actions | `proof.prove` | `{ slice, base: c7f0d13…, head: <work>, declared, bugs: [] }` | `{ verdicts, judgement, size }`, below |
| 8 | `draw` | script | `forge.draw` | `{ slice, title, proof, built, into }` | `{ card, merge, sendBack, discard }`: the lines, the reasons, three rules |
| 9 | `card` | approval with four choices | - | `$steps.draw.output.card` | `{ choice: keep, content }` |
| 10 | `carry-out` | script, calling actions | `forge.carry-out` | `{ choice, name: TR2, head, into }` | merge: `{ merged: <commit> }`; keep: `{ kept: [forge/TR2, forge/wip/TR2/1] }` |

Values in full where the table cuts them:

```yaml
# 1, the trigger, written by the reviewer for a replay of TR2 (by forge's earlier stages after F3)
planned:
  title: The broker says why a list is not in force, and reads the record again before each command
  slice: { name: TR2, kind: capability, scope: [bay/broker/**, tests/broker-list-trust.test.ts, …6 more],
           after: [{ slice: TR1, because: "ModeGrants.listTrust and readTrustRecord, which the broker reads" }],
           done: [ …10 items: 1, 1b, 2, 3, 4, 5, 6a, 6b, 7, 8 as in proof/A-smallest.md section 2… ] }
base: c7f0d13
bugs: []            # bugs-caught is not built (P3); with no bugs the item is inconclusive anyway
# 4, the declaration the builder submits before step 5 starts
files: [bay/broker/command-operations.ts, bay/broker/file-operations.ts, bay/broker/list-in-force.ts,
        bay/broker/rule.ts, bay/broker/step-broker.ts, framework/features.yaml, tests/broker-list-trust.test.ts,
        tests/cli-trust-at-use.test.ts, tests/script-commands.test.ts, tests/shared-tests-in-a-project.test.ts,
        tests/system-fixture.ts]
names: { gained: [], lost: [], changed: [] }
# 7, what proof returns on this branch today (fails-first and checks are built; the rest answer "not built")
verdicts:
  - { item: DOD-TR2-1, kind: fails-first, verdict: passed }          # expected, not run in this session
  - { item: DOD-TR2-2, kind: count, verdict: inconclusive,
      reason: "The kind count is not built in this version of the proof mode, so nothing is known." }
  - { item: DOD-TR2-3, kind: fails-first, verdict: passed }          # expected
  - { item: DOD-TR2-4, kind: fails-first, verdict: passed }          # expected
  - { item: DOD-TR2-5, kind: same-output, verdict: inconclusive }    # not built (P4)
  - { item: DOD-TR2-6a, kind: count, verdict: inconclusive }         # not built (P5)
  - { item: DOD-TR2-7, kind: bugs-caught, verdict: inconclusive }    # not built (P3)
  - { item: DOD-TR2-8, kind: checks, verdict: passed }               # or inconclusive if the suite runs out of time
  - { item: scope, kind: in-scope, verdict: inconclusive }           # not built until P2 merges
  - { item: declared, kind: as-declared, verdict: inconclusive }     # not built until P2 merges
judgement: [DOD-TR2-1b, DOD-TR2-6b]
size: 11 entries; net lines bay/ +107, tests/ +393, framework/ +1
```

The "not built" sentence is the literal one of `components/base/proof/scripts/lib/verdicts.ts:27-31`, used for
every kind the table maps to `notBuilt` (`components/base/proof/scripts/kinds.ts:15-28`).

**What the kernel records**, for every row: a step record with its kind, input, output or reason, and spend
(`step.started`, `step.finished` or `step.failed`). Beyond that:

- 1, 3, 6, 7, 8, 10: each script step's record; each command a script runs, as an event `command` with the step
  key, the command's name, its folder, how it ended, its milliseconds and hashes of its input and output
  (`bay/broker/command-operations.ts:168-186`); each throwaway operation as `throwaway`
  (`bay/broker/file-operations.ts:160`). Actions a script calls are steps of the same run, keyed under the
  caller's key (`action-steps.ts:184-197`, `:441-462`): step 7's calls are `prove/0.call0`, `prove/0.call1`, …
- 2, 9: the approval's detail (question, hash, the evaluated choices, the checked card), `run.waiting`, then
  `approval.recorded` with `{ stepKey, hash, decision, choice, by }` (`bay/runs/workflow-steps.ts:184-193`).
- 4, 5: the skill's detail: mode, action, skill, tier, output schemas, round, feedback, and the submission with
  its spend (`action-steps.ts:305-323`); `tool.called` per kernel tool call (`bay/runs/skill-steps.ts:33-38`).
  Nothing about the harness's own file edits is recorded by the kernel.

**What each choice does afterwards** (step 10), in F1 as the plan means it and in the cut of section 4:

| Choice | F1 with the capabilities of section 3 | F1 cut, buildable now |
|---|---|---|
| merge | `worktrees.merge` of `forge/TR2` into the integration branch, then `worktrees.remove` | withheld until P2 merges (scope and declared are inconclusive); once offered: `worktrees.cut` of `TR2-merge` at the set-aside commit and `worktrees.merge` into a branch nobody has checked out; the reviewer moves the kit's checkout and removes the worktrees by hand |
| send-back | F2: the findings to a fresh builder, round 2 of 2 | withheld, with the reason "Rounds come with slice F2." |
| keep | nothing; the run ends, worktree and branches stay | the same |
| discard | `worktrees.discard` (WD1): the work is set aside, the branch renamed, the worktree removed | withheld, with the reason that discarding comes with WD1; the reviewer removes by hand |

## 2. Where each step stands today

### Step by step

**1, `slice`. Carried with a change inside forge's folder.** A new script `scripts/slice.ts` and its schemas.
It is needed because a reference to the trigger has no path: `$trigger` is resolved whole, and only
`$steps.<id>.output` takes a dotted path (`bay/manifests/references.ts:33`, `:45-47`, `:55-59`). So the first
step hands the trigger's parts on as its output. The first step receives the trigger as its input because a step
without `input` gets the output of the step before, and the first step's "before" is the trigger
(`workflow-steps.ts:97-103`, `:348-356`). It checks the slice against proof@1's schema with
`context.schemas.check` (`bay/sdk.ts:108-110`, TB1), which may name an interface's schema by reference, as W1's
`plan.json` already does (`w1/waves`: `components/base/forge/schemas/plan.json`, `plannedSlice.slice`). It draws
card 1 from the slice alone, so every line is `computed`. Test: forge's own, through `bay call`, as W1's
`tests/waves.test.ts` does.

**2, `start`. Carried by existing code.** An approval without choices: approve passes what it showed on, reject
fails the run (`workflow-steps.ts:173-182`). A card without choices is printed with "decide with: bay approve
<run> <step> --hash <hash> [--reject]" (`bay/run-report.ts:93-98`, `bay/approval-card.ts:73-81`). Tests:
`tests/runs-cards.test.ts:124` (a sound card shown with the kernel's counts), `tests/run-report.test.ts:164`.

**3, `cut`. Carried by existing code**, with one line in forge's `mode.yaml`: forge must require `worktrees@1`,
since a workflow may name only its mode's actions or those of an interface it requires
(`schemas/workflow.schema.json:101`). W1's forge requires only `proof@1`. `worktrees.cut` makes
`.forge/worktrees/<slice>` on branch `forge/<slice>` (`components/base/git-worktrees/scripts/cut.ts:6-29`,
`scripts/lib/folders.ts:6-19`). Tests: `components/base/git-worktrees/tests/cut.test.ts:7`; a second cut of the same
slice is refused, "The branch forge/again already exists, so the slice again is not cut again."
(`tests/sentences.test.ts:24`).

**4, `declare`. Carried with a change inside forge's folder:** an action `declare` with effects `[read]` and one
skill step, `skills/declare/SKILL.md`, whose output schema holds proof@1's `declaration` by reference. Two things
hold "before it edits" without the builder's word. The kernel records the submission and finishes step 4 before
step 5 is started, since workflow steps run one after another (`workflow-steps.ts:348-365`). And the agent made
for this skill has no file-writing tool at all: an agent's write folders are its mode's write paths only when one
of its actions declares `write` (`bay/broker/rule.ts:161-163`), and the harness adapter gives `Write` and `Edit`
only when there is a write folder (`adapters/claude-code/agent-file.ts:15-27`). An agent is made per mode and
skill, with the effects of the actions that use that skill (`bay/build.ts:31-50`), so `declare` must use a skill
of its own, not the build skill. A check script may refuse a declaration that names a file outside the slice's
scope and send it back with feedback, up to three rounds (`action-steps.ts:52`, `:381-439`).

**5, `build`. Carried with a change inside forge's folder:** an action `build` with effects `[read, write]` and
one skill step, and in forge's `mode.yaml` `resources.files.write: [.forge/worktrees/]`. Forge may name that
path: the base mode forge, in the kit, is kept only out of the state folders (`bay/policy.ts:86-89`, `:131-135`;
tests `tests/policy.test.ts:214`, `:229`), and `.forge/worktrees/` neither holds nor sits in git-worktrees'
throwaway folder `.forge/copies/`, so the overlap rule passes (`policy.ts:333-355`,
`components/base/git-worktrees/mode.yaml:9-10`). The question of roots is answered in full below.

**6, `keep-work`. Not possible as F1 means it without a capability (WC1); carried today by a different cut.** No
action commits a worktree's changes to its own branch. `set-aside` commits them to a new branch
`forge/wip/<slice>/<n>` and resets the worktree (`git-worktrees/mode.yaml:128-132`; test
`tests/set-aside.test.ts:7`). The builder cannot run git (below). The cut of section 4 uses `set-aside` and
proves its commit; the cost is in section 3.

**7, `prove`. Carried by existing code**, given forge requires `proof@1` (W1 does) and the config binds
`proof: proof` (W1 adds it; in the kit every mode is active, `bay/manifests/activation.ts:47-52`). Its input is
built from earlier steps by top-level references (`references.ts:152-166`). Time and budget are answered below.
Test: `components/base/proof/tests/proof.test.ts` runs proof@1's shared test; `copies.test.ts` that every copy
goes when a run is stopped at its limit (commit `2e8628a`).

**8, `draw`. Carried with a change inside forge's folder:** `scripts/draw.ts`, a pure part that turns verdicts
into lines, reasons and three rules, and a thin script around it. The rule for merge: every verdict of an item of
level `must` is `passed`, and so are `scope` and `declared`. The kernel withholds a choice whose rule is false
and requires a reason for each withheld choice and for no other (`bay/runs/choices.ts:64`, `:112`); the rules are
evaluated once, when the run first reaches the approval (`workflow-steps.ts:229-242`). Tests:
`tests/runs-choices.test.ts:110`, `:164`, `:176`.

**9, `card`. Carried by existing code.** Choices, each with the sentence `does` that the schema requires
(`workflow.schema.json:75-91`), and a rule `when` for merge, send-back and discard. The card's lines are checked by
the kind of step each cites (`bay/runs/card.ts:175-265`), and printed at 44 columns with each choice, its sentence
and, when withheld, "not offered:" and its reason (`approval-card.ts:55-67`; test `tests/run-report.test.ts:201`).
The owner answers with `bay approve <run> card --choice <name> --hash <hash>` (`run-report.ts:96-97`); a withheld
choice is refused with its reason (`tests/runs-choices.test.ts:110`).

**10, `carry-out`. Carried with a change inside forge's folder for keep; not possible without a capability for
merge in the kit (WM1) and for discard (WD1).** A script reads the choice and calls the one action it needs
through `context.call` (`sdk.ts:107`; `action-steps.ts:184-197`). A call is refused when the called action has an
effect the calling action does not declare (`action-steps.ts:479-485`), so `carry-out` declares
`[read, write, delete]`, the effects of `worktrees.merge`, `remove` and `cut`
(`components/base/interfaces/worktrees.yaml:7`, `:27-31`). What blocks:

- merge into the branch the project has checked out is refused: "The branch main is checked out in the project
  or in another worktree, and the mode merges only into a branch it can check out in a worktree of its own, so
  forge/feature is not merged." (`git-worktrees/scripts/merge.ts:34-47`; test `tests/sentences.test.ts:149-161`).
  In the kit the project is the kit's checkout, and it has `feat/0022-agentbay5` checked out
  (`git worktree list` from this worktree: `/home/claude/agentbay d17fbb1 [feat/0022-agentbay5]`).
- remove after such a merge is refused unless the branch is also merged into the project's checked-out branch
  (`scripts/remove.ts:28-42`; test `tests/remove.test.ts:32`).
- nothing removes a worktree whose branch is not merged: `remove` keeps both and says so (`remove.ts:14-26`).

### The questions of the brief

**Can an agent in a skill step write files inside a slice's worktree under `.forge/worktrees/`, and nowhere else
in the project? Yes, with one line in forge's manifest, but for every worktree under `.forge/worktrees/` at once,
not for one.** What decides its roots: `bay build` writes `.agentbay/steps.json` with one entry per agent, that is
per mode and skill, holding `read` (the mode's folder, its read paths and its write paths, `policy.ts:393`),
`write` (its write paths when an action of the skill declares `write`) and `commands`
(`adapters/claude-code/steps-file.ts:10-18`, `bay/adapter.ts:46-52`). The hook reads that file and nothing else
(`adapters/claude-code/step-guard.ts:87-89`) and allows a write only when the real path lies in a write root
(`guard-decide.ts:171-194`; test `adapters/claude-code/tests/guard-decide.test.ts:229`). Inside the worktree the
names `.git`, `.agentbay`, `.claude`, `.mcp.json`, `CLAUDE.md`, `agentbay.config.yaml` and `.env*` stay closed
whatever the roots (`guard-input.ts:1-10`, `guard-paths.ts:115-126`; test `guard-decide.test.ts:247`), so the
builder cannot rewrite the worktree's `.git` file that points git at the repository. Writes into the kit's
`bay/`, `schemas/`, `adapters/`, `framework/` are refused unless a write root lies inside them
(`guard-decide.ts:183-189`); a worktree's own `bay/` is under `.forge/worktrees/`, not inside the kit's `bay/`, so
the builder may change kernel files in its worktree and nowhere else. **Can a workflow set roots per run to one
worktree? No.** The roots are fixed when `bay build` runs and are the same for every run of the mode
(`steps-file.ts:21-30`); the task carries the mode's grants, not a run's (`skill-steps.ts:40-62`). One builder at
a time (F1 to F3) is confined to `.forge/worktrees/`; two at once (F4) could write each other's worktree. That is
slice WR1. Found on the way: a search (`Glob`, `Grep`) over a worktree's top folder is refused, because the walk
meets the `.git` entry there (`guard-paths.ts:168-176`; test `guard-decide.test.ts:306`); the build skill must
search below it (`bay/`, `tests/`). Not a capability; a sentence in the skill.

What the write path does to the two frames. S3 holds: the path is declared in forge's manifest, and the hook allows
nothing else. T3 holds: the trust record, `.agentbay/` and the config stay closed inside every root, so a builder
cannot give trust. What is new is that a builder may write, in its worktree, a `mode.yaml` under
`components/base/`. In the kit's own `components/base/` the hook refuses it, since no root lies there
(`guard-decide.ts:190-192`). Once merged, such a mode is trusted by place (T5) and its list is granted. That
happens only through the owner's merge choice, never through a step, so T3 is not weakened; but the owner must see
it. F1's `draw` therefore adds a computed line for each changed path under `components/base/*/mode.yaml`, `bay/`,
`adapters/` or `schemas/`, from proof's `size` list; forge's test 6 holds it (section 4). Code a builder wrote runs
unconfined when proof runs the tests, as ADR 22 already says.

**Who commits the builder's work to the slice's branch? Nobody can today. May the agent's shell run git there?
No.** The build agent gets `Bash` only when its mode lists a command its action's effects cover
(`agent-file.ts:24`, `bay/broker/broker.ts:39-51`); forge lists none (ADR 15), so the agent has no shell, and if it
had one, `git` is not forge's to list. A kernel tool cannot do it either: `call_action` reaches only actions whose
effects are read only (`bay/runs/engine.ts:302-311`), and every worktrees action that writes has `write`. The
smallest action that does it is `worktrees.commit`, in the worktrees interface and the git-worktrees mode, built
from two commands the mode already lists, `stage-everything` and `commit-staged`
(`git-worktrees/mode.yaml:67-72`): slice WC1. Until then `set-aside` is the commit (section 4).

**Can a workflow call `proof.prove` with a value built from earlier steps, and wait up to thirty minutes? Yes.**
The input is a mapping of top-level references, each resolved whole (`references.ts:144-166`); the five fields
proof needs each come from one earlier output, so no nested reference is needed. The time limit is proof's own:
`scriptTimeLimitSeconds: 1800` on `prove` (`components/base/proof/mode.yaml:22`), which the engine applies to
the script steps of that action (`action-steps.ts:203-209`); 1,800 is the most the mode schema allows
(`schemas/mode.schema.json:221-226`). Inside it each toolchain call may ask up to 1,000 seconds (KL1, merge
`6aed62d`), and proof shares what is left among the checks (commit `e5c0231`: "each is now asked 348"). The
budget is the workflow's `budget.minutes` (`workflow.schema.json:42-45`), the smaller of it and the config's
(`engine.ts:372`). It caps the script's time: when fewer minutes are left than 30, the script is stopped when they
run out and the run fails (`action-steps.ts:211-217`; `mode.schema.json:222`). Minutes are counted from script
steps only, as wall time (`bay/broker/script-runner.ts:301-303`); a skill's submission reports 0 minutes
(`bay/commands/submit.ts:27`, `bay/tools.ts:166`) and an approval spends nothing (`workflow-steps.ts:214`). So
`budget: { minutes: 45 }` covers every script step of the flow, with prove's 30 minutes; the builder's hour does
not count against it. No test calls `proof.prove` from a workflow; F1's test does (section 4).

**Are proof's commands in this run, and which step would a `ran` line cite? Yes, by reading; no test holds it.**
`proof.prove` is a workflow action step, so it runs inside this run: its script's calls are nested steps of the
same run (`action-steps.ts:184-197`, `:441-462`), and each command a nested script runs is recorded in this run's
events with that script's step key (`command-operations.ts:175-177`). Keys of nested steps start with the
caller's key and `/` (`bay/runs/step-key.ts:49-68`), and a `ran` line is accepted when an event `command` of the
cited name has a step key under the cited step (`card.ts:171-173`, `:222-234`). So a line would cite
`{ step: prove, command: run-tests }`. `tests/runs-cards.test.ts:124` holds a `ran` line for a command recorded
directly in the cited step's script, not one recorded by a nested call; a test must hold that case before forge
relies on it. The `run` field of a source is not needed: it is for runs a skill called (`card.ts:236-245`).

**But forge cannot write such a line today, so F1's card has no `ran` line.** A source names the command by the
name its mode lists, such as `run-tests` or `check-types` (`components/base/typescript/mode.yaml:11-30`). Forge
does not know those names: proof's answer has no command names
(`components/base/interfaces/proof/prove-response.json:89-160`), a toolchain's answer names the check (`typecheck`)
and not the command (`toolchain/check-response.json:33-41`), and a script cannot read the run's events
(`sdk.ts:101-103` only emits). Forge naming `run-tests` would name a language (ADR 15). And a `ran` line is worth
showing only when its words are what the command printed, such as `# pass 1374`, as C1p's literal card shows
(`tests/run-report.test.ts:130-131`); proof does not return what a command printed. So F1 marks every verdict
`computed`, citing `prove`: proof's step runs no skill, which is all the kernel asks of a computed line
(`card.ts:200-206`), and that is how C1p's card marks verdicts too (`tests/run-report.test.ts:132-140`). Slice RN1
(section 3) gives forge the names and the printed lines.

**Which skill judges the judgement items, and is it in F1 or later? None, in F1 or in any slice of the plan.** A
`judged` line needs an action step listed under `quotes` that ran a skill (`card.ts:208-220`). The build step must
never be quoted: its words are the builder's own (ADR 15; test `tests/runs-cards.test.ts:234`). F1's scope is the
workflow, the build skill and the card script; F2 adds rounds, F3 the stages before the build, F4 waves
(`docs/plans/0022-forge-in-waves.md`, the table of slices). Until a review skill exists (slice RV1, section 3), the
card shows each judgement item as a `computed` line citing `draw`, "not judged", with the item's own words from
the slice, which the planner or reviewer wrote, never the builder. The owner judges them.

**How does a workflow branch on the choice taken? It does not: there is no conditional step.** The four kinds of
step run in order (`workflow.schema.json:92-186`, `workflow-steps.ts:348-365`). The approval's output is
`{ choice, content }` (`workflow-steps.ts:179-180`), a later step reads `$steps.card.output.choice` (test
`tests/runs-choices.test.ts:78`), and a script is given it and calls the action. A `foreach` over a list a script
makes empty or of one element would also run a step only for one choice (`workflow-steps.ts:269-314`); it is
proposed against, because it hides a branch in a loop.

**Does anything in the flow need forge itself to list a command or name a throwaway folder? No.** Git is run by
git-worktrees, the checks and tests by the typescript mode, line counts by proof (`proof/mode.yaml:12-16`). Forge
needs one write path (`.forge/worktrees/`) and its read paths. Forge is active only in the kit
(`activation.ts:32-36`, `:50-51`), and a base mode's list needs no trust (`policy.ts:361-366`), so nothing in the
flow asks the owner for trust.

**What is the builder given as its task, and by what means does a skill's prompt receive values of the run?** The
task JSON, which the coordinator hands to the step's agent "exactly as printed, as its whole prompt"
(`adapters/claude-code/coordinator.ts:41-42`). It holds the step's input, the round and feedback, the path of the
`SKILL.md`, the output schema and the mode's grants (`skill-steps.ts:40-62`). The input of a skill step is the
input of its action (`action-steps.ts:528-540`), which is the workflow step's resolved `input`. So the builder is
given: the slice (scope, items, after), the worktree's folder, the declaration, and the practices' paths. **The
practices by path from `toolchain.describe`: not possible today.** Describe gives `practices.md`, relative to the
toolchain mode's own folder (`components/base/typescript/scripts/describe.ts:12`, `docs/adr/0023`), and no
script can learn that folder: the script context has no folder of another mode (`sdk.ts:95-116`). F1 takes the
paths from forge's settings, which the owner writes (`$settings.practices`, `references.ts:117-126`); slice TP1
would make describe's path relative to the project.

**What happens to the worktree and branch when the run fails midway or is stopped, and on resume?** They stay.
A failed run is undone where it can be: an action with effect `delete`, such as `worktrees.cut`, is reported as
"not undone" and left (`bay/runs/undo.ts:61-70`, `:82-90`). A stop fails the run at the next gate
(`bay/runs/walk.ts:155-166`). A run waiting for a skill resumes with the task issued again
(`bay/runs/runs.ts:386`), and the agent finds the worktree as it was left. A script step that started and did not
finish (a killed process) is run again only if its action is read only; otherwise the run waits for the owner with
a question (`action-steps.ts:142-155`). Starting a new run for the same slice is refused at `cut`, because the
branch exists (`tests/sentences.test.ts:24`); today the reviewer removes it by hand, after WD1 `discard` does.
Not known: what `worktrees.copy` does with a copy left in `.forge/copies/` by a killed proof script. Experiment:
kill `bay` while `prove` runs, resume with `rerun`, and read the copy step's answer.

**What does the flow cost for TR2 in script hosts, copies and minutes?** Counted from the code, today's proof:

| Part | Script hosts | Copies | Wall time |
|---|---|---|---|
| `slice`, `cut`, `keep-work`, `draw` | 4 | 0 | seconds |
| `prove`: the script itself | 1 | 0 | - |
| `checks` (DOD-TR2-8): describe, copy, check, test, remove | 5 | 1 | the full suite: 435 to 662 s alone |
| `fails-first` (DOD-TR2-1, 3, 4): per item copy, overlay, test, remove, copy, test, remove | 21 | 6 | not measured; named files only |
| size: changed, then a copy each of base and head, each removed | 5 | 2 | seconds |
| `carry-out`, merge: cut and merge, or keep: nothing | 1 to 3 | 0 | seconds |
| **Total** | **37 to 39** | **9** | **prove about 945 s beside another run** |

Sources: hosts and copies from `proof/scripts/prove.ts:47-56`, `kinds/checks.ts:57-66`,
`kinds/fails-first.ts:65-104`, `lib/step.ts:56-71`, `lib/size.ts:83-112`. One host costs about 0.125 CPU seconds to
start and one copy of the kit 0.11 s (`docs/research/2026-11-17-suite-time.md:21-22`), so hosts and copies cost
under 10 s together. The suite is the cost: about 870 CPU seconds, 435 s at best on two cores, 662 s with one file
at a time (`suite-time.md:12-15`). The 945 seconds of `prove` on TR2 is the brief's figure; the report note that
records it is not in this branch, and was not found. The builder's time is outside the budget and outside this
count: 50 to 80 minutes a slice (`docs/plans/0022-forge-in-waves.md`, Time). After P2 to P5 the count rises: each
bug a copy and a test run, `same-output` two copies and every declared command twice.

## 3. The capabilities missing, as slices

In the plan's form (`docs/plans/0022-forge-in-waves.md`), fewest and smallest first. Kinds: **C** a capability in
one kernel feature, **M** a mode with its interface. None changes a file F1 changes, so each can run beside F1.

| # | Slice | Kind | Write scope | After | Because | Who waits |
|---|---|---|---|---|---|---|
| TT1 | The test toolbox takes a choice, shows a waiting approval's choices and card, and can stop and resume a run | C, test toolbox | `tests/test-toolbox.ts`, `tests/test-toolbox*.test.ts` | - | - | F1 |
| WC1 | `worktrees.commit`: every changed and untracked file of a slice's worktree committed to its own branch, the mode as author, with a message given | M | `components/base/interfaces/worktrees.yaml`, `components/base/interfaces/worktrees/**`, `components/base/git-worktrees/**`, `tests/made-up-worktrees*` | - | - | F2, by choice |
| WD1 | `worktrees.discard`: the work set aside, the branch renamed to `forge/discarded/<slice>/<n>`, the worktree removed; no commit is deleted | M | as WC1 | WC1 | the same files | F2 |
| WM1 | `worktrees.merge` into the branch the project has checked out: the merge commit made in a worktree of the mode's own, then the project fast-forwarded to it, only when the project has no changed or untracked file | M | as WC1 | WD1 | the same files | F1 as planned; the cut does it by hand |
| RN1a | A toolchain's check and test verdicts name the listed command that ran and the last lines it printed | M | `components/base/interfaces/toolchain.yaml`, `components/base/interfaces/toolchain/**`, `components/base/typescript/**`, `tests/made-up-toolchains*` | - | - | none of F1 to F4; X1, by choice |
| RN1b | Proof's verdicts carry those names and lines on, so a forge card can mark them `ran` | M | `components/base/interfaces/proof.yaml`, `components/base/interfaces/proof/**`, `components/base/proof/**`, `tests/made-up-proofs*` | RN1a, P2 to P5 | the toolchain's fields; the same folder | as RN1a |
| TP1 | `toolchain.describe` gives the practices file relative to the project, so forge can hand it to a builder | M | as RN1a | RN1a | the same files | none; the cut takes it from forge's settings |
| WR1 | A skill step's write roots are the one worktree of its run, not every worktree | C, adapter and runs | `adapters/claude-code/`, one field of a task in `bay/runs/` | a design first (P-35) | the hook knows a step only by its agent's name | F4 |

What each must be able to do alone, and how each keeps the frames:

- **TT1.** Today a test's decision is `{ stepKey, hash, verdict, by }` only, a waiting approval shows no choices or
  card, and a test cannot stop or resume a run (`tests/test-toolbox.ts:44-56`, `:76-81`, `:83-100`); runs already
  take a choice (`bay/runs/runs.ts:368-377`). Seen alone: a made-up mode's workflow stopped at an approval with a
  withheld choice, taken through the test toolbox, refused with its reason. It cannot be avoided: a mode's tests may
  import only the test toolbox and the toolbox (`framework/features.yaml:252-260`). No frame is touched.
- **WC1.** Built from two commands git-worktrees already lists, `stage-everything` and `commit-staged`
  (`git-worktrees/mode.yaml:67-72`), so the mode's list does not change. Seen alone: a worktree with a changed and
  an untracked file is clean afterwards and its branch is one commit ahead. Frames: the builder still runs no
  command; the action is a script of a base mode, effects `[read, write, delete]` declared (S3). What the builder
  wrote could run if git ran hooks or filters on commit; every listed command already starts with
  `core.hooksPath=/dev/null` and an empty attribute source (`mode.yaml:11`, `:71`), and a test like
  `git-worktrees/tests/hooks.test.ts` with a hook and a filter in the worktree holds it for commit too.
  **Avoidable** by the cut of section 4: `set-aside` is the commit, and a second `cut` at that commit is the
  branch that is merged. Cost: two worktrees and three branches per slice, the work's commit is set-aside's (its
  message says whose work it holds, `tests/set-aside.test.ts:7`), and in round 2 a fresh builder starts from the
  base, not from round 1's work, unless forge cuts round 2 at the set-aside commit.
- **WD1.** One new listed command, `branch -m`, for git-worktrees, a base mode, trusted by place (T5), so no trust
  card; `bay check` shows the changed list (T4). Seen alone: a dirty, unmerged worktree is gone, its work and its
  commits are on two named branches, and `cut` of the same slice works again. **Avoidable** in F2 by cutting each
  round under a new name (`TR2-r2`). Cost: names and branches pile up, and the reviewer removes them by hand,
  with `git branch -D`, which forge never runs.
- **WM1.** One new listed command, `merge --ff-only`. Seen alone: with the project clean, its checked-out branch
  ends at the merge commit and `remove` of the slice succeeds; with one changed file in the project, nothing moves
  and the sentence says which file. Frames: no S or T property names the owner's checkout. What changes is that an
  approval, not a person's git command, moves the files the kernel itself runs from, when the kit is the project.
  The approval is the owner's (T3 holds: no step chooses), and the card must say it: `draw` adds a computed line
  for every changed path under `bay/`, `adapters/`, `schemas/` or `components/base/*/mode.yaml`, from proof's
  `size` list, because a new base mode is trusted by place once merged (T5). A forge test holds that line.
  **Avoidable** by the owner's question 1 below, at the cost of a person's hands on every merge.
- **RN1a, RN1b.** Seen alone: `bay call proof.prove` on a hand-built slice answers, for `checks`, the commands
  `check-types`, `lint`, `check-format`, `find-dead-code`, `run-tests` and the last lines of each. Frames: the
  lines pass the scrubber when the card is shown (`workflow-steps.ts:228`), S6 holds; the kernel still does not
  compare a line with output (ADR 22). Two slices, not one, because each is one interface with its modes.
  **Avoidable**, as F1 does: verdicts marked `computed`. Cost: the owner never reads a command's own words.
- **TP1.** Seen alone: describe in the kit and in a project gives a path a builder can open. **Avoidable** by
  forge's settings, at the cost of the owner writing the path once per project.
- **WR1.** Its smallest form is **not known**. The hook identifies a step by `agent_type`, the agent's name
  (`guard-decide.ts:77-90`), which is one per mode and skill (`bay/adapter.ts:42-44`), and reads only
  `.agentbay/steps.json`, written by `bay build` (`step-guard.ts:87-89`). Per-run roots need either an agent per
  run or a file the kernel writes when it issues a task. It narrows what a step may write, so it weakens nothing;
  it does touch the file the hook trusts, which is closed to every step (`guard-input.ts:1-2`). **Avoidable** by
  one builder at a time, which costs F4 its point.

Not slices, but found, and each should be in a brief before its slice starts:

- **RV1, a review skill.** Nothing in the plan judges judgement items after the build (section 2). A forge slice
  (M, `components/base/forge/skills/review/**`, the step in the workflow and `quotes: [review]`), after F1. Until
  then the owner judges them from "not judged" lines.
- **C3 has nothing to count yet.** C3 "counts the times a step asks for tests", but no skill step can ask:
  `call_action` takes only read-only actions (`engine.ts:302-311`) and `toolchain.test` has every effect
  (`components/base/interfaces/toolchain.yaml:12-15`); forge's agents have no shell (`agent-file.ts:24`).
  C3's brief must say how a builder asks, and that reaches the kernel's rule on what a skill may call.
- **The kit's own tools may read `.forge/`.** `.forge/` is ignored by git (`.gitignore:8`), but the kit's `lint` is
  `eslint … .` with no ignore for it (`package.json:13`, `components/base/typescript/eslint.config.js`), and
  `node --test` with no file names searches the folder (`package.json:10`). **Not known** whether either reads a
  worktree under `.forge/worktrees/`. Experiment: with one worktree there, run `npm run lint` and
  `node --test --test-name-pattern=none` in the kit and look for `.forge/` in what they name. If they do, a
  one-line ignore in the typescript mode's config, before the owner's first live session. Proof is not touched:
  its copies hold a commit, which has no `.forge/`.

### What the owner decides

1. **Where a merge lands while the kit is the project.** (a) WM1: git-worktrees fast-forwards the checked-out
   branch, only when the checkout is clean. (b) The kit's checkout is left detached during a forge run, and the
   reviewer switches it back after the merge, by hand, for every slice. (c) Forge merges into a branch nobody has
   checked out, and the reviewer merges that into the integration branch by hand. **Recommended: (a)**, built
   after F1; it is what the reviewer does by hand today, and F1's cut uses (b) until then.
2. **How the builder's work becomes a commit.** (a) WC1, a commit action. (b) Keep `set-aside` and a second cut.
   **Recommended: (a)**, before F2, so that a round keeps its work on the slice's branch.
3. **Who judges a slice's judgement items.** (a) The owner, from "not judged" lines, until X1. (b) RV1, a review
   skill at tier deep, quoted on the merge card, before X1. **Recommended: (b)**; X1 is the first job whose
   judgement items nobody has seen before.

## 4. F1 cut to what can be built now

The smallest flow that works end to end with what exists and the forge mode's own files. It needs W1 merged
(forge's folder, `proof: proof` in the config) and TT1 for its tests. Merge is withheld on every real slice until
P2 merges, since `scope` and `declared` are inconclusive until then; the tests reach merge with a stand-in proof.

### Its files

Write scope, named by file, all in `components/base/forge/`:

- `mode.yaml`: W1's, plus `requires.interfaces: [proof@1, worktrees@1]`, `resources.files.write:
  [.forge/worktrees/]`, and the actions `slice`, `declare`, `build`, `draw`, `carry-out`.
- `schemas/settings.json`: W1's, plus `into` (the branch a merge goes into) and `practices` (paths a builder reads).
- `schemas/slice-request.json` (a planned slice by reference to `plan.json`, `base`, `bugs` by reference to
  proof@1), `slice-response.json`, `declare-request.json`, `declaration.json` (proof@1's `declaration` by
  reference), `build-request.json`, `built.json` (`{ outcome: built }` or `{ outcome: stopped, missing }`, no
  free text the card could show), `draw-request.json`, `draw-response.json`, `carry-out-request.json`,
  `carry-out-response.json`.
- `workflows/one-slice.yaml`, below.
- `scripts/slice.ts`, `scripts/draw.ts`, `scripts/carry-out.ts`, `scripts/declared-in-scope.ts` (the declare
  skill's check), `scripts/lib/cards.ts` (pure: the lines of both cards, the three rules, the reasons).
- `skills/declare/SKILL.md`, `skills/build/SKILL.md`. The build skill says: work only in the folder given; search
  below its top folder, not at it; run nothing; if the slice needs what the toolbox or the kernel lacks, stop and
  answer `stopped` with what is missing (ADR 17 item 2); never write outside the declared files without saying so
  in a second declaration, which F1 does not have.
- `tests/cards.test.ts`, `tests/one-slice.test.ts`; `README.md` gains a paragraph.

### Its workflow, in the schema's real form

```yaml
name: one-slice
trigger: { manual: true }
budget: { minutes: 45 }
steps:
  - id: slice
    action: slice
  - id: start
    approval: Build this slice?
    show: $steps.slice.output.card
  - id: cut
    action: worktrees.cut
    input:
      slice: $steps.slice.output.slice.name
      base: $steps.slice.output.base
  - id: declare
    action: declare
    input:
      slice: $steps.slice.output.slice
      folder: $steps.cut.output.folder
      practices: $settings.practices
  - id: build
    action: build
    input:
      slice: $steps.slice.output.slice
      folder: $steps.cut.output.folder
      practices: $settings.practices
      declared: $steps.declare.output
  - id: keep-work
    action: worktrees.set-aside
    input:
      folder: $steps.cut.output.folder
  - id: prove
    action: proof.prove
    input:
      slice: $steps.slice.output.slice
      base: $steps.cut.output.commit
      head: $steps.keep-work.output.commit
      declared: $steps.declare.output
      bugs: $steps.slice.output.bugs
  - id: draw
    action: draw
    input:
      slice: $steps.slice.output.slice
      title: $steps.slice.output.title
      proof: $steps.prove.output
      built: $steps.build.output
      into: $settings.into
  - id: card
    approval: Merge this slice?
    show: $steps.draw.output.card
    choices:
      merge: { does: Merge into the integration branch, when: $steps.draw.output.merge }
      send-back: { does: "Round 2, a fresh builder", when: $steps.draw.output.sendBack }
      keep: { does: Stop; the branches stay }
      discard: { does: Stop; the worktree goes, when: $steps.draw.output.discard }
  - id: carry-out
    action: carry-out
    input:
      choice: $steps.card.output.choice
      name: $steps.slice.output.slice.name
      head: $steps.keep-work.output.commit
      into: $settings.into
```

Every reference is `$steps.<id>.output` with a path, or `$settings.<key>`, as the grammar allows
(`references.ts:33-38`). `sendBack` and `discard` are always `false` in F1, with their reasons. If the builder
changed nothing, `set-aside` answers `{ how: nothing }` with no commit, `$steps.keep-work.output.commit` resolves
to nothing, and step `prove` fails with that sentence (`references.ts:89-103`): the run ends, and the owner reads
why. `carry-out` on merge calls `worktrees.cut` with `<name>-merge` at the head, then `worktrees.merge` into
`into`; on keep it calls nothing. A rejected card 1 fails the run before anything is cut.

### Done by hand for now

| What | Who | Until |
|---|---|---|
| `settings.forge.into` and `settings.forge.practices` in `agentbay.config.yaml` (closed to every agent, `guard-input.ts:7`) | the owner, through the coordinator | TP1 for practices; `into` stays a setting |
| `bay build` after F1 merges, so the build agent's roots are written | the reviewer | each change of forge's manifest |
| The kit's checkout detached before a run whose merge may be taken, and switched back to the integration branch after | the reviewer | WM1 |
| `worktrees.remove` of `.forge/worktrees/<slice>` and `<slice>-merge` after the switch back; `git branch -D forge/wip/<slice>/1` | the reviewer | WC1 and WM1 |
| Discard: `git worktree remove --force`, `git branch -D`, then `worktrees.remove` so the mode forgets the folder (`remove.ts:62-65`) | the reviewer | WD1 |
| Send back: a new run with a new slice name, the findings in the slice's items | the reviewer | F2 |
| Judging the judgement items | the owner | RV1 |
| Writing the bugs to inject | the reviewer | P3 makes them count |

### Its tests, with no model

As the runs tests do, the test answers each skill step itself (`tests/test-toolbox.ts:91`, `answer(token,
output)`), plays the builder by writing files into the worktree before it answers `build`, and decides each
approval as the owner would (after TT1, with a choice). The project is a temporary git repository holding the kit's
base modes, and a stand-in proof mode that the test writes into the project, as proof's own test writes a stand-in
toolchain (`components/base/proof/tests/copies.test.ts:20-40`); it implements `proof@1` and answers the verdicts
the test put in a file. Cases in `tests/one-slice.test.ts`:

1. Every verdict passed: merge is offered; taking it merges `forge/<slice>-merge` into a branch `integration`
   that nobody has checked out, and `integration`'s tree holds the files the test wrote as the builder.
2. One `must` item inconclusive: merge is withheld with draw's reason; asking for merge is refused with that
   reason; keep leaves `forge/<slice>` and `forge/wip/<slice>/1`.
3. Card 1 rejected: the run fails and no branch `forge/<slice>` exists.
4. The builder answers `stopped`: the card says so in a computed line and withholds merge.
5. A declaration naming a file outside the scope is sent back by its check, round 2 has the feedback.
6. The cards: no line cites `build`; every verdict line is `computed` and cites `prove`; each judgement item is a
   "not judged" line; a changed `components/base/<mode>/mode.yaml` or a path under `bay/`, `adapters/` or
   `schemas/` gets a line of its own; the card is at most 44 columns as printed.
7. The build agent's root: forge's manifest names exactly `.forge/worktrees/` to write, and nothing else.

`tests/cards.test.ts` holds the pure part: for each combination of verdicts, the three rules and the reasons,
and the lines of both cards for TR2's verdicts, literally.

## 5. Both cards for TR2, as F1's cut would show them

Drawn with the kernel's own wrapping (`bay/trust-card.ts:48`, `:63-94`; `approval-card.ts:17-81`): a mark padded to
nine columns, continued lines indented two more, 44 columns. The hashes are examples; `1,374` is an example of
the test count. Above each card `bay runs` prints the run's line and below it the command to decide
(`run-report.ts:93-98`), which may be wider than 44.

Card 1, at step `start`. No choices: approve or reject.

```
Build slice TR2?
computed The broker says why a list is not
computed   in force, and reads the record
computed   again before each command
computed kind capability; base c7f0d13
computed scope: bay/broker/** and 6 more
computed   paths
computed after TR1: ModeGrants.listTrust and
computed   readTrustRecord, which the broker
computed   reads
computed 10 items: 8 name a kind of proof, 2
computed   are judgement
computed judgement, by you: 1b, 6b
checked: 0 ran, 6 computed, 0 judged
hash 9c41e07b52aa
```

Every line cites `{ step: slice }`, a script step that ran no skill. The words of the first line are the planned
slice's title, written by whoever wrote the plan, not by a builder. Card 1 does not say which kinds proof can
judge today: forge cannot read proof's table (`proof/scripts/kinds.ts:15-28`), and a copy of it in forge would go
stale with each P slice. The owner learns it from card 2.

Card 2, at step `card`.

```
Merge TR2 into feat/0022-agentbay5?
computed 11 files changed; the work is set
computed   aside on forge/wip/TR2/1
computed checks passed: typecheck, lint,
computed   format:check, deadcode
computed tests passed: 1,374
computed DOD-TR2-1, 3, 4: the named tests
computed   failed on the base and pass on
computed   the head
computed not known, kind not built:
computed   DOD-TR2-2, 5, 6a, 7, scope,
computed   declared
computed not judged, for you: DOD-TR2-1b the
computed   sentences say what the owner does
computed not judged, for you: DOD-TR2-6b the
computed   copy-paste count does not rise
computed size in lines: bay/ +107, tests/
computed   +393, framework/ +1
Choose one:
  merge      Merge into feat/0022-agentbay5
             not offered: 4 must items,
             scope and declared are not
             known.
  send-back  Round 2, a fresh builder
             not offered: rounds come with
             slice F2.
  keep       Stop; the branches stay
  discard    Stop; the worktree goes
             not offered: discarding comes
             with slice WD1.
checked: 0 ran, 8 computed, 0 judged
hash 51d0aa3e9c7f
```

| Line | Cites | Comes from |
|---|---|---|
| 11 files changed | `draw` | proof's `size` list and set-aside's branch |
| checks passed | `prove` | DOD-TR2-8's detail (`kinds/checks.ts:42-48`) |
| tests passed | `prove` | the same detail |
| DOD-TR2-1, 3, 4 | `prove` | the three `fails-first` verdicts |
| not known | `prove` | the six inconclusive verdicts, by item |
| not judged (two lines) | `draw` | proof's `judgement` list and the items' own words in the slice |
| size in lines | `draw` | proof's `size`, summed by top folder |

A line that restates a verdict cites `prove`; a line forge computes from several outputs cites `draw`. Both ran no
skill, so both are `computed`. The choice sentences are the workflow's `does`, beside each name
(`workflow.schema.json:81-85`). The reasons are `draw`'s, one for each choice whose rule is false and no other
(`choices.ts:112`). The kernel's tier line ("judged by forge skills/review, tier deep",
`approval-card.ts:30-39`) appears only on a card with a judged line, so on neither of these. Merge's sentence names
the branch because `draw` writes the title and reasons from `into`; the choice's `does` is fixed in the workflow, so
it says "the integration branch" there. If the suite ran out of time, the second and third lines become one
"not known" line for DOD-TR2-8 and merge's reason counts 5 must items.

With RN1 and P2 to P5 merged, the same card would read like C1p's literal (`tests/run-report.test.ts:126-162`):
`ran` lines with what `run-tests` printed, and merge offered when every verdict passed.

## 6. What the owner should try in his first live session, once F1 is built

The owner has no terminal; the coordinator runs each command and shows him what it prints (adapter `README.md:36`).

1. Ask the coordinator to run `./bay.sh check` in the kit. Look for: forge and proof active, `proof` bound, no
   mode waiting for trust. Then `./bay.sh build`, and ask to see the build agent's write paths in
   `.agentbay/steps.json`: only `.forge/worktrees`.
2. Through the coordinator, set `settings.forge.into: feat/0022-agentbay5` and
   `settings.forge.practices: [components/base/typescript/practices.md, framework/practices.md]`.
3. Ask the reviewer to detach the kit's checkout (`git switch --detach`) for the session, and to confirm
   `.forge/` is not read by `npm run lint` (section 3).
4. Start a replay of TR2, a slice whose result is known: `./bay.sh call --workflow
   forge:workflows/one-slice.yaml "$(cat tr2-replay.json)"`, with the trigger of section 1.
5. Read card 1 against section 5. Every line should say `computed`, and nothing should come from a builder.
   Approve with the hash it shows.
6. When the run waits at `declare`, let the coordinator hand the task to `agentbay-forge-declare`. Then at
   `build`, to `agentbay-forge-build`. While it works, ask it to write one file outside its worktree, such as
   `bay/x.ts`: the hook should refuse with a sentence naming `.forge/worktrees`. Ask it to run `npm test`: it has
   no shell to run it with.
7. Wait for `prove`: about 16 minutes on this machine, longer beside a builder's suite. `./bay.sh runs <id>`
   meanwhile shows the step it is on.
8. Read card 2 against section 5. Try `--choice merge`: it should be refused with the reason the card shows.
   Choose `keep`.
9. Ask the reviewer to check what is left: `git branch --list 'forge/*'` shows `forge/TR2` and
   `forge/wip/TR2/1`; `git diff c9bb216 forge/wip/TR2/1 --stat` shows how far the replayed build is from the
   real TR2. Then clean up by hand (section 4) and switch the checkout back.
10. Once P2 has merged, repeat with a small new slice whose items are all `checks` and `fails-first`, and choose
    merge when it is offered. That is the first slice forge carries with the reviewer only watching.

## 7. Report

**The missing capabilities, most blocking first.**

1. TT1: the test toolbox cannot take a choice or show a card, so F1 cannot be tested. Small; F1 waits.
2. P2 (planned): until it merges, `scope` and `declared` are inconclusive and merge is withheld on every slice.
3. WM1: `worktrees.merge` refuses the integration branch, which the kit's checkout has checked out; F1 as planned.
4. WC1: no action commits a worktree to its own branch, and the builder has no shell; the cut uses `set-aside`.
5. WD1: nothing discards an unmerged worktree, and a slice cannot be cut again by name; F2 waits.
6. RV1: no skill in the plan judges judgement items; the owner does, from "not judged" lines.
7. RN1a, RN1b: forge cannot name a toolchain's commands, so no `ran` line; verdicts are marked `computed`.
8. WR1: write roots are per mode and skill, not per run; F4's two builders could write each other's worktree.
9. C3's premise: no skill step can ask for tests; C3's brief must say how one would.
10. TP1: describe's practices path is relative to a folder forge cannot learn; forge's settings carry it.

**What I could not find evidence for.** The 945 seconds of `prove` on TR2: no report note in this branch records
it; the figure is the brief's. Whether a `ran` line citing a command recorded by a nested call passes the card
check: by reading yes, held by no test. Whether the kit's `eslint` and `node --test` read `.forge/worktrees/`.
What `worktrees.copy` does with a copy left by a killed proof script. How long `fails-first` takes on TR2's named
test files. Whether TR2's head has `generate:check` (the checks line lists four checks; describe decides).

**What I did not read.** The three forge designs beyond the lines cited (`B-owner.md`, most of `A-smallest.md`
and `C-seams.md`), `calling-a-toolchain.md`, `modes-beside-the-kit.md`, ADRs 16, 18, 19, 21 and 23 beyond one
line, the proof designs B and C beyond section 3 of C, `interface-open-questions.md`, `toolbox-for-plans.md`,
the briefs other than TR2's and FD1, the broker's operation table beyond the command record, the sqlite run store,
`bay/mcp.ts`, the adapter's `build.ts` and `settings.ts`, the git-worktrees scripts other than cut, merge and
remove, and proof's `checks.ts` and `fails-first.ts` beyond the calls they make.

