# Design frame: proof, the form of a slice and a plan, and the card

ADR 15 decided that a proof mode with no model gives a verdict per item of a definition of done, that the owner
is stopped twice on honest cards, and that choices are named options. ADR 17 (items 1, 6, 8, 9) and ADR 18 decided
what a plan and a slice must state and that proof reads what a project declares. None of them decided the three
interfaces. Three designs follow (`A-smallest.md`, `B-caller.md`, `C-seams.md`) and `comparison.md` weighs them.
This frame is what all three are held to. Read on `pd1/proof-designs` at `d6cfb91`. Every claim about the code
below names a file and line opened for this round.

## The problem, with evidence

**Proof has nothing to call yet, and three things in its way.**

- A toolchain has three actions: `describe`, `check`, `test` (`components/base/interfaces/toolchain.yaml:3-15`).
  There is no action that makes bugs to inject or counts lines. The worktrees interface can copy a commit, put
  paths from another commit into a copy, and apply a patch to a copy (`worktrees.yaml:31-38`, `:51-54`). So proof
  can run tests on a copy of the base with the slice's tests laid over it, and on a copy with a bug patched in. Who
  writes the bug is not settled.
- A proof script cannot read the code it judges through a grant. Copies live in git-worktrees' throwaway folder
  `.forge/copies/` (`components/base/git-worktrees/mode.yaml:10`). A throwaway folder may not overlap any mode's
  read or write path, or the project does not load (`bay/policy.ts:333-350`). The kernel folders, `framework/`
  among them, may be named only by the base mode `forge`, for reading too (`policy.ts:67-72`, `:131-142`), and
  `forge` counts only when the project is the kit (`policy.ts:86-89`). So a proof mode cannot be granted the kit's
  own map `framework/features.yaml`. It can be granted `.forge/worktrees/`, where a slice's worktree is cut
  (`git-worktrees/mode.yaml:82`), and it can run listed commands in any folder of the project but `.agentbay/`
  (`bay/broker/command-operations.ts:112-123`).
- The kit's whole suite does not fit in one test call. A test call may ask for at most 420 seconds
  (`toolchain/test-request.json`, `timeLimitSeconds.maximum`) and the typescript mode's default is 420
  (`components/base/typescript/scripts/run-tests.ts:6`). The suite took about 12.5 minutes on 2026-11-17
  (`docs/research/2026-11-17-boundary-audit-after.md:23`); briefs say twelve to eighteen
  (`docs/briefs/WC-words-an-author-reads.md:53`). Today proof's "tests pass" on the kit would be inconclusive every
  time. Slice SP1, in flight, aims at half (`docs/briefs/SP1-the-suite-runs-in-half-the-time.md`).

**What the reviewer does by hand, and where a script could stand in.**

- Every brief since K1 has the same tail of items: tests written first and seen failing, a capture before and after
  that is the same, boundaries (sealed features, debt lists, detector count), bug injection with a count and a list,
  `npm run check`, size. TR2 is typical: eight items, `docs/briefs/TR2-the-broker-and-a-list-not-in-force.md:25-32`.
- The builder reports its own numbers: "Record test count, time, kernel line count, debt counts by rule, detector
  count" (`TR2` brief line 36, the same in every TR brief). The reviewer reruns them (`framework/practices.md:53`,
  P-23). The copy-paste detector is not part of `npm run check` (`package.json:15`), so its count is a habit.
- The capture script runs `bay check` and `bay new` in fresh projects and hashes the trees
  (`/home/claude/m5-capture/capture.sh:44-147`). It is one file outside the repository, with the kit's fixture
  projects beside it. ADR 18 says this becomes "a project's list of commands whose output must not change"
  (`docs/adr/0018-forge-builds-any-product.md:21`).
- Bug injection is a table in a script of the reviewer's own (`/home/claude/m5-capture/bugs/bugs.py:4-50`): a file,
  a line as it is, the line as broken, applied in a copy, the suite run, the result saved
  (`bugs/results.txt:1-26`). Two of 23 survived and got tests (`results.txt:11`, `:21`, then `:25-26`).
- Write scopes are prose with a tail: "Anything else is named at the top of the report with its reason" (`WC` brief
  line 51, `TR2` line 56). Two scopes running together both named `CONTEXT.md` and "tests" (`WC` line 51,
  `docs/briefs/TR1-trust-the-record-and-the-grant.md:59`).

**The card has no form in the kernel.**

- An approval step has a question and a reference to what it shows (`schemas/workflow.schema.json:98-115`). The
  owner approves or rejects (`bay/runs/runs.ts:70-75`). Approving makes the shown content the step's output; a
  rejection fails the run (`bay/runs/workflow-steps.ts:126-131`). There is no third answer and no way to read which
  of several was taken.
- The content is scrubbed and hashed with `hashOf` before it is shown (`bay/runs/scrubbed-store.ts:11-14`). A
  change after it was shown sends the step back to waiting with the old hash kept (`workflow-steps.ts:115-121`). An
  answer must name the hash shown (`bay/runs/engine.ts:184-190`).
- What the owner reads is JSON. `bay runs` prints the content with `JSON.stringify(value, null, 2)`
  (`bay/run-report.ts:86-99`); `bay approve` at a terminal does the same (`bay/commands/approve.ts:153-161`).
- `CONTEXT.md:27` defines **Card** as the trust card only. That card is drawn by the kernel, 44 columns wide
  (`bay/trust-card.ts:48`), and a test holds the width (`tests/approve-trust.test.ts:507`).
- A workflow has four kinds of step and no branch (`workflow.schema.json:75-153`). A `foreach` may hold any step,
  an approval included (`:136-152`), so a list of none or one is the only way to skip a step today.

**Forge cannot leave the kit yet.** `forge` is refused as an active mode when the project is not the kit
(`bay/manifests/activation.ts:32-35`). The typescript mode's practices path is relative to the kit
(`components/base/typescript/scripts/describe.ts:9`) and it runs the checkout's npm scripts
(`typescript/mode.yaml:8-26`), which a project beside the kit does not have
(`docs/designs/forge/modes-beside-the-kit.md:91`). Slice T1 of the plan covers the second; nothing in the plan
covers the first. Every design says how it treats it.

## Who calls each interface, and what each needs

| Caller | Calls | Needs |
|---|---|---|
| The reviewer by hand, from wave 3 on | Proof, on a hand-built slice's branch | One command per kind or per slice; a verdict it can paste into a report; the same answer twice |
| Forge's workflow | Proof after the build; the plan's waves before it; the card at two stops | A verdict per item in a shape a script reads; which choices to offer; the owner's choice as data |
| A builder's skill step | The slice it builds and its own declaration | Its scope, its items and their kinds in its task; a way to declare before it edits; no way to report a result |
| Forge's plan stage (a skill) and W1's script | The form of a slice and a plan | A file a script can refuse with a sentence; waves, the longest chain, disjoint scopes |
| The owner, mostly on a phone | The card | 44 columns; every line marked by where it came from; named choices; no builder's words |
| A project that is not the kit | Proof, through its own declarations | Proof that says what it cannot know there, as inconclusive, never as passed |

## What must stay true

No design may weaken these. A design that trades one away says so in a section of its own.

From `docs/designs/operations/0-frame.md:36-43`: **S1** every operation passes through one rule; **S2** a script
runs confined in a child process and the kernel does the operation; **S3** nothing is allowed that the manifest does
not declare; **S4** a refusal is a sentence with what was asked, what is declared and what to change; **S5** a
guarded operation that matters is recorded as an event, today's five kinds the floor; **S6** secrets are scrubbed
from every answer, refusal, event and stored value; **S7** data from outside is parsed once, at the edge.

From `docs/designs/trust/0-frame.md:151-161`: **T1** trust names the mode and is bound to its exact list; **T2** a
changed list is not trusted until the owner approves again; **T3** nothing an agent's step can do gives, widens or
renews trust; **T4** `bay check` shows every trusted mode and reports one waiting; **T5** a mode under the kit's
`components/base/` is trusted as before. And from ADR 13: **M1** `bay check` and a load come from one inspection.

Added by this round, from ADR 15, 17, 18 and 20:

- **V1.** A verdict is `passed`, `failed` or `inconclusive`. Inconclusive means nothing is known and is never a
  pass, on a card or in a workflow's decision.
- **V2.** A builder's own words never reach a card. No field a builder fills is shown as evidence.
- **V3.** Proof uses no model. A judgement is a model's, named and labelled as judgement.
- **V4.** A toolchain is never given a slice's worktree. Proof copies, calls and removes
  (`docs/designs/forge/calling-a-toolchain.md:5-11`).
- **V5.** An approval is bound to the hash of exactly what was shown, choices included. A change sends it back.
- **V6.** The choice to merge is not offered when evidence is missing (ADR 15, line 15).
- **V7.** Limits on rounds and on test runs are counted by the kernel, never by an instruction (ADR 17, item 10).

## Fixed for all three designs

- Proof is a base mode, `components/base/proof/`, as ADR 15 and the plan say. It requires `toolchain@1` and
  `worktrees@1` and lists no git command: git stays the worktrees mode's.
- The example slice is TR2 and the example plan is `docs/plans/0022-forge-in-waves.md`. The cards are drawn for TR2
  as if forge had carried it. Every number on a TR2 card that is not in the repository is marked as an example.
- Every line of a card carries one of three marks: `ran` (the kernel ran a command or a step and recorded it),
  `calc` (a script computed it from what was run), `judged:<model>` (a named model judged it). A line with none of
  the three is the card's own frame: the question, a choice, a heading.
- Cards are at most 44 columns, as the trust card is.

## Words this adds to `CONTEXT.md`

Proposed in every design, so the designs differ in substance and not in names. Each goes into `CONTEXT.md` with
the slice that first needs it (P-29).

| Term | Meaning | Do not say |
|---|---|---|
| **Proof** | The base mode that turns one item of a definition of done into a verdict by script, with no model | review, QA, verification mode |
| **Kind** (of proof) | One of a closed set of ways to prove an item, each a script | check type, rule, assertion |
| **Verdict** (widened) | What a toolchain says of a check or test run, or what proof says of one item: passed, failed or inconclusive | result, status, outcome |
| **Write scope** | The paths a slice may change, as patterns | allowed files, ownership |
| **Declaration** | What a builder states it will change before its first edit: files, and names an entry gains, loses or changes | plan of change, intent, manifest |
| **Plan** | A list of slices, each with its kind, scope, order and definition of done | roadmap, backlog |
| **Wave** | Slices with disjoint write scopes and no order between them, run side by side | batch, phase, sprint |
| **Card** (widened) | What the owner reads to answer an approval or `bay approve --trust`: at most 44 columns, every line marked by where it came from | prompt, dialog, summary |
| **Choice** | One named answer a card offers; a choice may be withheld with its reason | button, option (in prose "option" is fine) |

## The limits the kit keeps

| Limit | Ceiling | Today | Counted by |
|---|---|---|---|
| `concepts` | 5 | 5: config, interface, mode, skill, workflow | files `schemas/*.schema.json` (`bay/check-limits.ts:49-51`) |
| `cli_commands` | 13 | 13, two not built (`bay/commands.ts:15-29`, `bay/commands/not-built.ts:9-25`) | entries of the command table (`check-limits.ts:58-66`) |
| `kernel_lines` | 4,000 | about 18,300 by `wc -l` over `bay/` less `bay/generated/` | over its ceiling already; a warning, never a failure (`check-limits.ts:136-147`, `:163`) |
| `top_level_folders` | 7 | 7 | `check-limits.ts:53-56` |

So a new file under `schemas/` raises `concepts` past its ceiling, and a new `bay` command raises `cli_commands`.
Both are warnings, but each design says plainly what it adds and asks the owner if it passes a ceiling. The plan's
slice I2 names `schemas/plan.schema.json` and `schemas/slice.schema.json`, which would make `concepts` 7.

## Can each interface take three really different designs? (P-25)

Yes for all three. For proof: kinds as one action each against one action that takes a kind, and declarations in
mode settings against a kernel field. For the form: forge's own files, the brief itself, or an interface any planner
implements. For the card: approve or reject of one offered choice, named choices the kernel draws, or a card as
data whose marks the kernel enforces. Where two designs land on the same answer for one part, they say so and do
not pad it.

## Cases every design must answer

Taken from real slices. Each design answers every case in a table, with what the caller would see.

| # | Case | Source |
|---|---|---|
| K1 | A slice that passed: TR2, a capability in the broker, eight must items, 11 files | brief `TR2` lines 25-32; merge `1b0cc2a` |
| K2 | A slice sent back for a surviving bug: in G2 the reviewer's injected bug, "exit code 0 with a failed test in the summary", survived every test | commit `fe5214c`; also merge `66a3716` (3 of 13 survived) and `bugs/results.txt:11`, `:21` |
| K3 | A file outside the scope, for a good reason: WC changed `components/base/typescript/scripts/lib/commands.ts`, because the broker now refused the extra field the typescript mode sent | commit `ba55622`; WC brief line 51 (scope) |
| K4 | Two builders met in one file: TR1 and WC both had `CONTEXT.md` in scope and ran together; the merge conflicted there | merge `59abd01`; TR1 brief line 59; WC brief line 51 |
| K5 | The builder's test count was wrong: the report's number differs from the run's | no record found in the repository (see below) |
| K6 | A project that is not the kit, with no map: the capture's `sound` project, two modes, no tests, no `package.json`, no map | `/home/claude/m5-capture/fixtures/sound/`; `capture.sh:21-25` |
| K7 | A run that cannot finish: the kit's suite against the 420-second ceiling | `toolchain/test-request.json`; audit after, line 23 |

For K5 the repository holds no report with a wrong count: builders' reports are not committed, and merge messages
give only the reviewer's rerun ("checks rerun (707 pass)", merge `867dc99`). The case is kept because every brief
asks the builder to record the count, and a design must say what happens when it is wrong. It is listed in the
report as a claim without evidence.

## How the designs are compared

| # | Criterion |
|---|---|
| 1 | The answer to each case K1 to K7, as the caller sees it |
| 2 | What the reviewer by hand types, and what it still does by hand afterwards |
| 3 | What a builder's skill step is given and may declare; what it cannot say |
| 4 | What the owner reads on each card, and what he can choose |
| 5 | What proof does in a project that declares nothing |
| 6 | How each security property above is held |
| 7 | Kernel slices before the todo mode, and features touched |
| 8 | New concepts, `schemas/` files, commands, estimated kernel lines, owner-facing sentences |
| 9 | What stays a model's judgement, labelled as such |
| 10 | Migration: slices, waves, longest chain; whether it can replace the plan's table |
