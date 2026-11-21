# Plan 0024: forge, whole

The slices that build forge as decided in ADR 24 to 27. The file a script checks is `0024-forge-whole.yaml`; `forge.waves` accepts it with no problem. It starts from design A's plan (`docs/designs/forge-whole/A-plan.yaml`) and carries the owner's answers of 18 November.

## The order

22 slices in 10 waves. The longest chain is 10 slices: TF1, PF1, FA2, PT1, LK1, FC2, RQ1, DS1, PL1, WV1.

| Wave | Slices | What exists at its end |
|---|---|---|
| 1 | NT1, WC1, TF1, TI1, KC1, OK1 | The pieces the new flow stands on: a toolbox that hands out tokens, a commit action, failing cases named by the toolchain, tiers that name a model and an effort, the clearer card form, forge allowed outside the kit |
| 2 | PF1, HK1, WM1, FA1 | **Forge carries one slice under ADR 24, one round**: a test writer, a builder that never has the tests as files, proof. Also: with the hook or without, and a merge that fast-forwards the checked-out branch |
| 3 | FA2, RT1 | Rounds two and three, with the filter on what a failing case tells the builder. A project's own commands in proof |
| 4 | PT1, TDX | **The todo mode rebuilt through the new flow.** A planter writes the bugs |
| 5 | LK1, EX1 | The leak check. One slice built in a TypeScript project that is not the kit |
| 6 | FC2 | Forge's cards in the clearer form, with a failure's reason |
| 7 | RQ1 | The requirements file and its check |
| 8 | DS1 | System design as forge's first phase |
| 9 | PL1 | Planning from a design, challenged by another model |
| 10 | WV1, TDW | Forge runs a wave, the whole suite once. The todo mode's next outcome through the whole forge, from requirements |

Six slices come before the first that carries a slice under ADR 24 (FA1), and eleven before the todo mode is rebuilt (TDX).

## What changes in the kernel

| Slice | Change | Size, estimated |
|---|---|---|
| TI1 | A tier names a model and an effort in the config; the adapter writes both | about 60 lines |
| OK1 | Forge may be active outside the kit; activating it brings proof and worktrees | about 20 lines |
| KC1 | The card's printed form | about 30 lines |
| HK1 | The setting, and refusing a step's output the hook never saw | about 80 lines |

The rounds need no kernel change: slice SC1 (merged) showed that a script waiting on a skill resumes with its finished calls replayed.

## What needs the owner's machine

A real run of forge is a live Claude Code session. With the hook it is the only place the kernel takes a step's output. TDX, EX1 and TDW are such runs. Every other slice is built and tested with the test toolbox, where the test plays each model.

## Left out, and why

- Per-run folders for two builders at once (design B's WR1): not designed; WV1 says what it needs when it gets there.
- A PM mode: ADR 25 gives it the requirements. Forge reads a requirements file a person can write by hand, so the PM mode is its own plan.
- Slices noted earlier and still wanted, outside this plan: a toolchain names test files that did not load (TN1), a command stopped when its output passes its limit (CO1), three more test cuts.

## Found while building wave 1

- **AC1, not yet in the plan file:** `bay check` cannot refuse a tier's unknown model or say that the built agents are stale, since the kernel never calls the adapter during a check (TI1's report). The slice: `Adapter.check(request) => Problem[]` in `bay/adapter.ts`, called by `checkSystem`. `bay build` already refuses an unknown model.
- **When an interface gains an action, every mode that implements it must follow,** also the made-up ones written inside other tests (proof's shared test has a recorder that implements worktrees@1), and `tests/shared-tests-in-a-project.test.ts` pins how many shared cases pass. A builder of such a slice runs those files.
- TF1: the dedupe of files that did not load is held by no test (the reviewer's bug survived); the response schema's `uniqueItems` would refuse a duplicate. Fold a case into PF1.
- KC1: the coordinator's text still says "a choice the card shows as not offered"; the card now says "Not available". The sentence is in the adapter's text, read by the owner, and pinned by tests: FC2 changes it with forge's cards.

## After wave 1 and FA1 (19 November)

Merged: NT1, WC1, TF1, TI1, KC1, PF1, WM1, FA1. The plan file now holds the 16 slices that remain; `forge.waves` accepts it.

FA1 built the round and pinned two gaps it could not close inside forge, each now a slice before FA2:

- **KP1 (kernel):** the kernel saves every step's output as text in its own database, so the test writer's tests lie there while a builder works. With the hook a builder cannot read that file; without it nothing stops a read. An action may say its skill's output is kept packed.
- **WX1 (worktrees):** the worktree in which the tests are committed cannot be removed until its branch is merged, so the tests stay as files after the run. A worktree can be removed while its branch is kept.

Until both merge, no card may say the tests were kept from the builder in a run without the hook.

## State on 19 November, 04:10 owner's time

Merged and pushed, in order: NT1, TI1, WC1, TF1, KC1, PF1, WM1, FA1, OK1, WX1, HK1. The last full check: 2,009 of 2,014, the five failures all in forge's old one-slice test, whose kit copy did not yet say that skill steps run without the hook; fixed and passing alone. The plan file holds the 13 slices that remain.

Next, in this order: KP1 (the kernel keeps a skill's output packed) and RT1 (a project's own commands in proof) side by side; then FA2 (rounds two and three, and the reviewer that FA1 left out), PT1, LK1, FC2. RQ1 waits for the owner's answer on where the requirements file's form lives (the PM mode's design, question 1). TDX, EX1 and TDW are live runs and wait for the owner.

What the owner has not yet seen and must: the sentences HK1 changed (the coordinator's block, the refusal, `bay check`'s line); HK1's limit (code that runs as the same user, such as a listed command that runs tests, can write a sighting; closing that needs separation by the operating system); that the kit's own config now runs skill steps with the hook, so a session without the hook cannot run forge until he sets `skillSteps.run: without-the-hook`.

Open with the owner, one at a time: the todo rebuild here without the hook first; the PM mode's five questions; the home mode's six, first which counties; the research's ten changes to the practices; WM1's choice that a merge which does not land is refused with a sentence.
- 05:00: KP1 merged and pushed (2,025 pass). FA2 started; RT1 in flight. A kept output's check feedback is shown as written: forge's checks must never quote a test (FA2 holds it with a test).
- 06:05: RT1 merged and pushed. Thirteen slices merged; eleven remain (FA2 in flight).

## After FA2 (19 November, about 06:45 owner's time)

FA2 is merged: rounds two and three, and the reviewer. Twenty of the builder's bugs and four of the reviewer's own were caught.

Found while building it, each still open:

- **A called action's answer is text in the kernel's database.** Forge calls proof inside the round's script, and only a skill's output can be kept packed. Proof's raw messages, which may quote a test, sit in `.agentbay/kernel.db` while later builders work. With the hook a builder cannot read that file; without it nothing stops the read. Needs a kernel slice (KP2): an action may say the answers of the actions it calls are kept packed. Must land before a no-hook run is called leak-free.
- **The card has no line for whether the hook saw each step.** A mode's script cannot read a run's events. Needs a kernel change (a script reads its own run's events of one kind), then FC2 adds the line.
- **A round keeps the kernel's 480 seconds.** Proof runs inside the round's script. A longer limit adds a `bay check` warning that kit tests pin. A slice whose named tests run longer fails the run. To decide: raise the limit and change the pinned warning, or have proof run as its own workflow step.
- **A wrong test is not caught until round three.** When a round's tests fail and it is not the last round, the reviewer is skipped and only the builder goes again. If the test is what is wrong, the builder fails three times and the reviewer first sees it at the end. The owner decides: the reviewer reviews a failing round too (one more deep call per failing round), or stays as is.
- **Kept tests stay until the rounds end.** A run that fails midway leaves the rows in forge's partition.
- For PT1: cut the planter a worktree at the builder's last commit, never `<S>-tests-n`. For LK1: reuse `quotesAny`; run before `review-round` forgets the kept tests.

## After PT1 (19 November, about 08:15 owner's time)

PT1 is merged: the planter. Open from it:

- Each run with a planter leaves a branch `forge/<S>-planter` at the builder's commit (no tests in it). `worktrees.remove` deletes a branch only when it is merged. Needs a worktrees change: delete an unmerged branch on request, or read a file at a commit without a worktree (which would also let the kept tests be forgotten earlier).
- The start card says "no bugs given to inject" when the owner names none, though the planter will write some. For FC2.
- Not verified: that a planted patch applies under real proof (tests use a stand-in).
- The filter in `scripts/lib/code.ts` keeps a test file the builder wrote against its instructions out of the code handed to the reviewer and the planter.

## After LK1 (19 November, about 09:20 owner's time)

LK1 is merged: the leak check. Open from it:

- The mark does not cover the test writer's stored output in `.agentbay/kernel.db` (forge cannot change a skill's stored output); a copy from there is caught only by the shared-text rule.
- Known misses of the shared-text rule: a copied line that was cut or joined; a line under 40 characters once the given words are out; files past the 200 handed on; a builder that read a test and wrote its own code from it. Known false alarm: a long line both sides wrote on their own in a new file.
- A forge script is run again from its start when a run resumes: anything random or timed in one must be stored or safe to repeat (the mark is reused from the kept rows).
- For FC2: a leaking run's card says "rounds: 1 of at most 3" and has no judged lines; no line is printed when no leak was found (and none may claim there was none).

## After FC2 (19 November, about 10:50 owner's time)

FC2 is merged: forge's cards in the clearer form. Seventeen slices of this plan are merged; the full check passed 2,146 of 2,146. Open from it:

- No hook line on the card: a script has no way to read its own run's events of one kind (kernel piece missing).
- Failing cases on the merge card are names only: the kept tests are forgotten before the card is drawn, so a message cannot be checked against them.
- `scripts/lib/cards.ts` is about 700 lines and should be split.
- The pinned cards in `cards.test.ts` come from the test's own copy of the kernel's print layout; the end-to-end tests go through the real print.
- What is left needs the owner: RQ1 waits for the PM mode's first question; TDX, EX1 and TDW are live runs.

## The first live run of the rounds (TD1, 19 November, evening)

The owner set `skillSteps.run: without-the-hook` in his own words; the run was relayed step by step (the kit's own step agents have no `submit` tool in this cloud session). Three rounds ran with real models; the final proof did not pass; the card offers only keep and still waits (run 773f1ac3, step card).

Causes found:

- **A kernel bug the hidden test found.** Two actions started at the same moment that both open a mode's database for the first time: `bay/broker/database.ts` opens the file and sets `journal_mode = wal` with no wait on a lock, so one fails with "database is locked". The todo test fails 3 runs in 8. Slice KB1: wait on a busy database when opening, with a test of two first uses at once.
- **The whole-suite run did not finish within the toolchain's 1,000 seconds** in proof's copy. The card printed only "the test run is not known" and dropped that reason. To fix: the limit or the suite's time in a copy, and the card keeps proof's reason.
- **The slice had no interface.** Plan 0023 was written by hand for the old flow. The rounds must not start on a slice with no interface files unless the owner says so on the start card.
- **The card:** the reviewer's "held by" lines stand beside proof's failed verdict with no word that they were judged earlier; each remaining finding prints its case's name, not what was asked, so three findings read the same.
- **No round after the card:** a test added in round three is proved once in that round and once in the final proof; a flaky one fails only at the end.
- **A long step outlives the coordinator's turn here:** the final proof died once with the turn and was run again with `bay resume --rerun`.

The owner then asked for the missing pipeline to be built (requirements, design, planning, waves) and chose the shared interface `requirements@1` for the requirements file's form. RQ1 and KP2 (called answers kept packed) are building.

## Quality held at every step (ADR 28, 19 November, late)

The owner: "Ensure code quality and readability and modularity grounded in best practices as we discussed. Engrave this goal into the pipeline." ADR 28 says how each step holds it. For the briefs:

- **DS1** builds ADR 28 point 2: the design names modules, what each hides and each interface first; a script refuses a module with no interface, an interface nobody implements, a table with two owners; the challenger answers each design-held practice by id; the design card shows it.
- **PL1** builds point 3: every slice names its interface files and keeps to one module where it can; `forge.waves` refuses a slice with no interface (this is also the trial's finding) or a scope across modules with no reason; the challenger answers each plan-held practice by id.
- **QL1 (new, after the stage-0 forge fixes):** `bay check` names every practice whose holder is planned and the list only shrinks; proof holds types, lint, format, dead code and "the count of duplicated blocks does not rise" on every slice whether or not its plan lists them; the reviewer answers every review-held practice by id and a script sends back a review that leaves one out; the merge card gets one practices block and withholds merge while a must practice is not held.
- Every builder's brief keeps: no comments, readable code, small pure functions, deep modules with small interfaces, delete what is unused, no duplicated blocks, and a file that grows past a few hundred lines is split by what it hides (cards.ts, about 700 lines, is due).
- The owner agreed to the research note's ten practice changes (19 November, 23:01). They are in the practice files: P-10 and P-16 extended, TS-05 and TS-16 extended, TS-23 to TS-27 added, three differences recorded under "Considered and not adopted". P-52 added after his question on business logic: the rules of the work are pure functions, with reading and writing in a thin function around them (TS-21 already said so for TypeScript). For QL1: turn on the linter's `no-empty` (the kit passes it today) so TS-24's empty catch is held by a check.
- Research on Specter (devagrawal09/specter, MIT; ideas only): `docs/research/2026-11-20-specter.md`. Seven ideas; the owner decides which. The reviewer recommends for DS1: worked examples on each interface action checked against its schemas (this closes the trial's missing-interface gap in a form the test writer and builder both get), and coverage both ways between conditions and actions; for proof and the cards: interface files' hashes recorded at the start and compared at the merge card; for WV1: every slice's failure reported, not the first.
- The owner chose the recommended four of the Specter ideas (19 November, 23:40): for DS1, worked examples on each interface action checked against its schemas, and coverage both ways between conditions and actions; for proof and the cards, interface files' hashes recorded when a slice starts and compared at the merge card (goes with QL1); for WV1, every slice's failure reported. The leak check must count the design's examples as words both sides were given.
- Research on Codemod (codemod/codemod, Apache 2.0; ideas only): `docs/research/2026-11-20-codemod.md`. Its conclusion: keep YAML workflows; three kernel additions close the gaps (steps side by side with a cap, `$trigger` with a path, a bounded repeat whose inner steps a card can cite).
- The owner chose the recommended four of the Codemod ideas (19 November, 23:45), all in the kernel: KW1 a `foreach` may run its items side by side up to a cap, all finish when one fails, every failure is named, a resume runs only the failed ones (WV1 builds on it); KW2 `$trigger` with a path; KW3 a replay-safe clock and random in the toolbox, recorded per call and replayed on resume, with a lint rule against `Date.now` and crypto random in mode scripts (the leak check's mark then uses it); KW4 `given` and `until` in the test toolbox, a given output checked against the action's output schema (forge's end-to-end tests then get shorter). Later: a bounded repeat, a confinement table per harness, verified-source publishing.

## After RQ1 and KP2 (20 November, about 00:15 owner's time)

Merged and pushed; the full check passed 2,206 of 2,206.

- **RQ1:** `requirements@1`, the base mode `requirements` (forge brings it bound), `docs/requirements/todo.yaml`. Forge has no action of its own for it: a workflow step names `requirements.check`. A refused file is a finished run with `answer: "refused"`; the design step must stop on it. On acceptance `output.requirements` is the whole file. Words inside a quoted value are not judged vague. Not held: that a version follows the last signed one (needs the earlier version).
- **KP2:** `calledOutputs: kept-packed` on an action packs every call under it at any depth, with inputs, outputs and reasons; a failure under it reaches the level above as a sentence that quotes nothing. Forge's `round` is marked. Cost: under a kept call the owner no longer sees a script's own message, a time limit included. Open: the final `prove` step's answer is still text after the run, readable by a later slice's builder without the hook; closing it needs a forge action around the final prove (goes into the forge fixes). `components/base/forge/README.md` line 80 is stale.

Two lanes from here, one builder each: forge's folder (S0 fixes, DS1, PL1, QL1, WV1) and the kernel (KB1, then KW2, KW1, KW3, KW4).

## After KB1 and S0's report (20 November, about 01:50 owner's time)

- **KB1 merged and pushed** (full check 2,215 of 2,215): database openers wait up to 3,000 ms on a lock; first-use migrations run once across processes (mode databases and the kernel's own); a lock that outlasts the wait is a sentence naming the database and saying to run the action again. The trial's todo tests then passed 12 runs of 12 (before: 3 failures in 8).
- **S0 reviewed** (reviewer's four bugs caught); sent back once to make the final proof's filter fail closed when no kept tests are found. Done in it: no rounds without an interface unless the owner picks `build-without-interface` on the start card (an approval with choices can no longer be answered with reject; `stop` takes its place); proof's reason on the card; findings print the fix; the reviewer's block says its round and "before the final proof"; a forge action `final-proof` keeps proof's answer packed and filters it, then forgets the kept tests; cards.ts split into eight parts, the largest 194 lines. Note: proof's own reason, which can carry a toolchain's text, now reaches the card as a computed line.
- **Stopped in S0, now their own slices:** TL1 (building): the whole-suite run's 1,000 seconds is capped in three places (the toolchain interface, proof's longest call, the kernel's 1,800 maximum for a script); WB1 (queued): `worktrees@1` cannot delete a named unmerged branch, so earlier rounds' branches stay after keep and merge, and the planter's branch too.
- Kernel lane order now: TL1, then KW2, KW1, WB1, KW3, KW4.
- 03:10 owner's time: S0 merged and pushed (full check 2,232 of 2,233, the one failure a pinned warning count in the broken-overlay fixture that S0's long final-proof step moved from 38 to 39; fixed, verified alone, pushed). The filters fail closed when no kept tests are found. DS1 and TL1 are building (both were stopped by a server restart at about 07:19 UTC and resumed on their own). With two builders running tests, a full check takes about 45 minutes on this 2-core machine: start one only when a batch is ready.

## After DS1 (20 November, about 04:10 owner's time)

DS1 is merged locally (the full check runs with TL1's batch): forge's `design` workflow. Open from it:

- **Worked examples are not checked against their schemas.** The toolbox checks a value only against a schema file of the mode or an interface, and a design hands its schemas in as data. Kernel slice SV1: a toolbox call that checks a value against a schema given as a value, with the kernel's own validator; then forge's design check uses it and the card's line changes. The owner chose this idea, so SV1 goes first in the kernel lane after TL1.
- No practice is marked must in the practice files; the design step treats every practice held by design (P-32, P-35, P-52) as must. For the owner to confirm.
- The first step takes the trigger whole (`$trigger.file` waits on KW2). A failed challenge leaves the worktree `<job>-practices`; the branches `forge/<job>-practices` and `forge/<job>-design` stay after every run (WB1).
- `design.yaml` is written as JSON, which is valid YAML: the toolbox has no YAML writer.
- PL1 (planning) is building from this head.

## After TL1 and PL1 (20 November, about 05:40 owner's time)

- **Pushed:** DS1 and TL1 (full check 2,271 of 2,271). **Merged locally, check pending:** PL1.
- **TL1:** a copy is not slower than a direct run (3,856 s against 3,857 s side by side, file by file within 3%); the suite's own time grows with whatever shares the two cores. Forge's end-to-end tests are eight of the ten slowest files. Limits: `toolchain@1` allows a call of 3,600 s; proof's `stepSeconds` (default 1,800) and `longestCallSeconds` (default 1,000) are settings, and the kit sets 4,200 and 3,400; the kernel's longest script step is 7,200 s; a run stopped at its limit names the setting that raises it. A real `proof.prove` on the kit finished its whole test run in a copy in 2,292 s beside other builders' runs. Two tests fail only under heavy load (`broker-database.test.ts` an agent query at its 1,500 ms limit; `step-time-limits.test.ts` once). The lasting fix is a shorter suite: KW4 and cutting forge's end-to-end tests.
- **PL1:** forge's `plan` workflow (planner balanced, challenger deep, second round only on findings), new plan fields `requirements`, `design`, `meets`, `interface`, `crossesModulesBecause`, rules for a plan cut from a design, plan card, the plan committed as the next free number with wave one's slice requests in the output. Shared with the design step: reading requirements and stopping on refused, practice answers and their check, reading files on a branch, committing through worktrees. Open: `forge.waves` reads the design from the project's folder while the workflow reads it from `into`; branches `forge/<job>-plan-reading` and `forge/<job>-plan` stay, so a second plan run for the same job fails at the cut until WB1; the design's requirements version is not compared with the file's.
- Reviewer's bugs: DS1 two of three caught, the third closed with tests; TL1 four of four; PL1 three of three.
- Next: forge lane QL1, then WV1 (needs KW1). Kernel lane SV1, KW1, WB1 (now blocking second runs of design and plan for one job), KW4, KW2, KW3.

## After QL1 (20 November, about 07:25 owner's time)

- **Pushed:** PL1 and QL1 (full check 2,332 of 2,332).
- **QL1:** the reviewer answers each practice it holds by id (65 for the kit's two files) and a script sends back a review that leaves one out; the merge card's practices block; `settings.forge.mustPractices` (the kit sets P-12, P-52, TS-17, TS-21, TS-25, for the owner to confirm; he asked on 20 November which and why, and was shown eight more to consider, P-44 first); forge adds a `checks` item when a plan lists none; interface files pinned by hash in a step `pin` after the cut and compared at the card, a file not compared withholds merge; `framework/practices-debt.yaml` with nine practices held only by a planned check, held by a test; the linter's `no-empty` on.
- **Stopped in QL1:** "duplicated blocks do not rise" needs a duplicate detector as a toolchain check (a new dependency and script); `bay check` printing the practices debt is kernel work.
- **To settle:** the rounds withhold merge only for `mustPractices`; the design and plan steps withhold approve for every practice they hold.
- KW1 reported and waits for review. Then WV1.

## After KW1 (20 November, about 08:45 owner's time)

- **KW1 pushed.** The full check ran 2,360 tests under a load of 20 and more (two builders testing): 2,354 passed and six failed, all in two files that hold wall-clock limits, `tests/broker-database.test.ts` (an agent query killed at its time limit, five cases) and `tests/step-time-limits.test.ts` (one case). Both files passed alone twice right after (28 of 28), and TL1 had reported the same two as failing only under heavy load. Not caused by KW1. A slice FL1 is owed: those tests must not depend on the machine being quiet.
- **KW1:** `foreach` gains `sideBySide: 2..8`; a run may wait on several steps (`waiting` and `alsoWaiting`, a token per task, `bay runs --new-token --step <key>`); when items fail the others finish and the run waits for the owner with every failure named, `resume --rerun` runs only the failed items under new keys, `--stop` fails it; each item draws the budget through its own frame; minutes are summed across items. The coordinator's steps 2 and 3 changed (shown to the owner on 20 November). The coordinator has no instruction yet for a run that waits for the owner at a foreach. A submit while another call advances the run is refused with "try again": two builders work at once but hand in one after the other (KW5: record a submission under a short lock).
- **The owner agreed to the PM design's recommendations for questions 2 to 5** (recorded in `docs/designs/pm-mode/design.md`).
- Building: WV1 (forge's wave) and WB1 (worktrees drops a named branch).

## After WB1 (20 November, about 10:40 owner's time)

- **WB1 pushed** (full check 2,380 of 2,380): `worktrees@1.drop-branch` drops a named branch the mode made (`forge/<slice>` or `forge/wip/<slice>/<n>`), merged or not; it keeps the branch named as `into`, the branch checked out in the project's folder and a live worktree's branch, and answers the commit it pointed at; `not-there` is an answer; `cut` over a leftover says the branch and its commit; `remove` with a detached head whose commit its branch does not hold now refuses. Its report lists where forge should call the drop (rounds' earlier branches, planter, leak base, merge, design and plan helpers, and before each cut of the same name): a forge slice LB1 after WV1.
- **The owner on 20 November:** "Go with the 5 you set": the kit's must practices are P-12, P-52, TS-17, TS-21 and TS-25, as set in `agentbay.config.yaml`. He asked for the home mode's questions and was shown the six.
- A fourth server restart stopped WV1 and SV1 as each was about to report; both were resumed from clean, committed trees.

## The pipeline is whole (20 November, about 11:40 owner's time)

- **Pushed:** WV1 (full check 2,412 of 2,412) and SV1 (2,438 of 2,438). Plan 0024's build slices are all merged; what is left in its yaml are the live runs TDX, TDW and EX1, which need the owner at the cards.
- **WV1:** the `wave` workflow. Its three kernel gaps: an approval after a foreach cannot quote a skill step inside its items, so the wave's merge card leaves the reviewer's and builder's sentences off; `sideBySide` must be a number in the workflow, so the setting `settings.forge.sideBySide` is held by batches; a submit that arrives while another call advances the run is refused and its token removed (KW5). Also: proof names its copies by millisecond, so two proofs starting together can clash; a builder may write under another slice's worktree and only proof's scope catches it afterwards; branches pile up until forge calls `drop-branch` (LB1). Not verified: a live run, a real merge conflict in the combined head, more slices than the cap end to end.
- **SV1:** `context.schemas.checkAgainst(schema, value)` with bounds on a given schema (65,536 characters, 64 levels, references only to its own parts, `$id` only at the top, 65,536 parts unfolded); a schema that refers to itself without stepping into the value no longer overflows the stack; forge's design check holds each example with an answer, and each earlier call, to its action's schemas; a refusal's input is not checked. `bay/given-schema.ts` holds the bounds; `bay/value-check.ts` is still 421 lines and its problem wording would split out cleanly.
- **The full check took about 28 minutes with no builder running.** The suite has grown with forge's end-to-end tests (`wave.test.ts` alone is about seven minutes under load). KW4 (given and until in the test toolbox) and cutting forge's end-to-end tests are now the first thing to do for speed.
- **The owner answered the home design's six questions** (recorded in `docs/designs/home-mode/design.md`): all seven counties; both the typed plan and the look-up; no quotes available, so public data only; the three recommendations agreed.
- Asked of the owner at 11:10: the first whole run now, or first LB1, KW5 and shorter tests.

## After KW4 (20 November, about 13:50 owner's time)

- **KW4 merged locally** (its full check runs with LB1's): `Runs.startPart` in the kernel, `runWorkflowPart` in the test toolbox and the bridge `tests/start-part.ts` (it refuses any folder outside the temporary folder); the shipped CLI, the workflow schema and the toolbox for modes know nothing of it; a run started this way is marked (`target.part`, a `step.given` event per given step). A run stopped by `until` is "waiting for owner" with its own question, since a new status needs a table-rebuild migration. Reviewer's two bugs caught.
- **Its measurements change the plan for speed.** A `bay` call costs about 1.05 s fixed on a quiet machine, and each skill answer in forge's end-to-end tests costs four processes (`runs`, `runs --new-token` twice, `submit`); that fixed cost is 45 to 66 per cent of each slow file's call time. All forge files that drive `bay` add up to 1,681 s one after another (wave 388, tests-kept-packed 256, rounds 204, planter 151, design 122). Three mirrored card cases run in 7 to 14 s against 27 to 75 s. Cutting the one fully redundant wave case and the card parts of rounds B1 and planter P2 saves about three minutes of 28. The larger gain: (1) convert more card cases to given outputs; (2) have the players answer a skill step in fewer processes (one `runs --new-token` and one `submit`); (3) let forge's tests drive the kernel in process through the test toolbox where a case does not need the CLI.
- Redundant now: `wave.test.ts` "two slices that pass alone but fail the checks combined…" (whole case); the card assertions of `rounds.test.ts` B1 and `planter.test.ts` P2. Must stay end to end: rounds' "tests that fail in round 1…", C1 and "the tests' text…"; all three leak cases; planter P1; the wave's first case, NA and SA; one-slice, design, plan.

## After LB1 and FX1 (20 November, about 15:15 owner's time)

- **Pushed:** KW4, LB1 and FX1 together (full check 2,482 of 2,482, about 30 minutes, no builder running).
- **LB1:** forge drops the branches it no longer needs. After merge nothing of the slice is left; after keep, a leak or a stopped build the tests-and-work branch and the builder's own stay, and the card names both. A second design or plan run for a job starts clean. An earlier run's branches that may hold undecided work are listed on the start card with their commits, and only the owner's choice `build-over` (or `build-over-without-interface`) drops them, printing each commit in full. The wave's fresh-name workaround, its code and its table are gone. Reviewer's three bugs caught.
- **LB1's open points.** `worktrees@1` has no action that only reads where a branch points; LB1 calls `drop-branch` with `into` set to the branch itself, which refuses and answers the commit. A read action is owed. Stopping at the start card now ends the run "undone", where it ended "failed". The start card can show four go-aheads besides stop, one offered and the rest under Not available. The end-to-end files got 3 to 31 s slower.
- **FX1:** LB1 added the first step `look` and changed outputs, so KW4's three given-output tests no longer started, as the kernel is meant to refuse. The files were recaptured, and `node components/base/forge/tests/recapture.ts [given-<name>.json …]` now remakes them from the whole cases in a copy of the kit (about two and a half minutes for all three). **The helper depends on the three source cases** (`rounds.test.ts` "a slice still failing after round 3", `planter.test.ts` "a builder that stopped gets no planter", `wave.test.ts` "two slices that pass alone but fail the checks combined"): SP1 may take them out of the everyday suite but must leave them runnable for the recapture.
- **The owner sent the essay "From Loop Engineering to Graph Engineering?"** and asked for a reading against agentbay. Shown to him: agentbay already pairs each maker with a watcher, anchors on tests that ran and frozen rules, and takes its targets from him at the cards. Exposed: every watcher is the same model family, so live runs and the outside trial are the anchors that count; the reviewer's own bug injection has no stand-in once forge runs alone (a fixed set of known bugs the pipeline never sees); no count of defects found after merge; the improve mode must propose on a card and never change practices, proof or its own measure. He was offered a research note with these as slices; not yet answered.
- Building next: SP1 (forge test speed) and KW5 (a submit while the run advances).

## After KW5 and SP1 (20 November, about 17:10 owner's time)

- **Pushed:** KW5 and SP1 together (full check 2,501 passed, 2 skipped by design, 0 failed; 28 minutes with no builder running). A fifth server restart stopped both builders; both were resumed from committed work.
- **KW5:** a submit records its answer and takes the run's lock in one short transaction (table `answers`, migration 6). If another call holds the lock the answer stays recorded and the submit is answered as accepted (`recordedAnswers` on `bay runs`, event `answer.recorded`); any call that holds the lock takes recorded answers before it lets go, so each is applied once. A token is no longer removed while its run is running; a refused submit keeps its token. An answer whose step no longer waits when it is taken is dropped with an `answer.dropped` event. Reviewer's bugs: four caught, two survived (the round check and the waiting check of `answerableSkill` had no test), sent back, now held by a table test of the rule and tests through `Runs.submit` and the engine. The README and the submit tool's description changed (shown to the owner). **Owed:** the coordinator has no sentence for a run shown as `running` after a recorded hand-in; its block is at 49 of 50 lines. Found outside: while a run advances an agent's other kernel tools are still refused, and a `call_action` made then runs but its cost cannot be charged to the run.
- **SP1:** forge's players answer a skill step in two processes; the wave's combined case and one-round case 7 run only when `FORGE_RECAPTURE` is set, as `recapture.ts` sets it; rounds B1 and planter P2 lost their card checks to the given-output tests; a fourth given file `given-r7-failed.json`. CPU time of the four slowest files fell by about a quarter (959 to 709 s), **but the whole check still takes 28 minutes**: each file runs its cases at once, so the slowest case sets the wall time. In-process driving was skipped with reason (forge's tests need a cloned kit that is a git repository, and read the card as the CLI prints it). A real gain now needs a different cut: split the slowest files so the runner spreads them, or run the forge end-to-end files only when forge or the kernel's run code changed (the `affected` test already knows what a change touches).
- **Owed from SP1's report:** the recapture can pass without writing a file (nothing checks each file was rewritten); `one-slice.test.ts` has its own copy of `answered`; the wave's `mostAtOnce` is now held every day only as "at least 2"; one-round case 4 could be converted if the branch helpers of `wave-combined-given` were shared.
- Building next: the kernel piece so an approval after a foreach quotes inner skill steps and `sideBySide` comes from a setting; a `worktrees@1` read action for a branch with forge using it, plus SP1's owed items and FL1.

## After KW6 and WR1 (20 November, about 21:30 owner's time)

- **Pushed:** KW6 and WR1 together (full check 2,538 passed, 2 skipped by design, 0 failed). A sixth and a seventh server restart stopped agents; reports were read from their transcripts.
- **KW6:** an approval after a foreach may quote a step the foreach runs in each item (`source: { step, item }`, the kernel finds the item's last attempt and adds the skill, tier and foreach); `sideBySide` may be a reference, resolved and checked each time the foreach starts or resumes; **a waiting item now keeps its side-by-side place** (before, the cap never counted waiting items, which forge's batches had hidden), and an item that had started before a resume always goes on; forge's batches are gone and the wave's merge card shows each slice's judged lines; `bay/runs/cited-step.ts` split out of `card.ts`. Reviewer's bugs: five of seven caught, two sent back (an unfinished cited step; a stored line half in an item), then three more against the place-holding rule, all caught.
- **WR1:** `worktrees@1.find-branch {branch}` → `found` with the commit, `not-there`, or `refused` without reading; forge's `leftovers` uses it and declares only `read`, so stopping at the rounds' start card ends the run "failed" again with its reason (the "undone" after LB1 was a side effect of declared write effects). The recapture fails naming each given file it did not write. FL1: the agent-query and step-time tests no longer race the machine (limits widened, the kill asserted by its timeout and reason, proved under 40 pinned spinners). The wave's first case holds `mostAtOnce` at exactly 3. Reviewer's bugs: three of four caught, one sent back (nothing held that the command fails), now caught.
- **Owed:** `one-slice.test.ts` still copies helpers from `kit-copy.ts`; the agent-query kill case has no test timeout; the owner's question when foreach items fail still names them by position ("item 0 (each[0])"); a card drawn from given steps shows judged lines with no "by" row; the rounds' merge card has no slice title.
- **The owner on 20 November, evening.** Standing instructions: "don't block the main thread. Dispatch long taking tasks" (full checks and reviews by bug injection now run as background agents that report); "Instead of just ids like td1 also use a short description to make it clear". He found "item 0 of slices" on the wave card "Very unclear": CL1 makes a foreach name its items (`itemName: { id, title }`), built, under independent review. Asked whether the workflow manager should be a graph: answered no (ordered steps keep cards, resume and tests checkable; a small "together" block if a workflow needs different steps at once; slice dependencies stay in forge). Card length: no preference, left until a real run.
- **Roles (his idea):** "well defined rolls like reviewer lead builder etc that map to platform agents like Claude and define platform specific params like model effort etc." Design at `docs/designs/roles/design.md` on branch `rl1/slice` (not merged). It keeps one agent file per skill step and a fresh agent per step, and found two gaps: "a builder has no tool that runs a command" holds only because forge lists no commands, and the planter's agent can read `.forge/worktrees/`. His answers so far: a role's model and effort come through its tier; the builder runs on Sonnet everywhere. Open: how much to build (names first then limits, names only, or not now); the card's "by" line wording; the two smaller questions (feed briefing's skills; the word "lead").

## After CL1 (20 November, about 22:45 owner's time)

- **Pushed:** CL1. Its full check ran 2,563 tests: 2,560 passed, 2 skipped by design, and one failed, a sentence pinned in `tests/runs-cards.test.ts` that CL1 had reworded (the kernel's refusal of a line that brings its own fields); the pinned sentence was updated and that file passes alone (11 of 11). No second full check was run for a one-sentence change in a test.
- **CL1:** a foreach may declare `itemName: { id, title }` as `$item` or `$item.<path>` (so `$item` takes a dotted path everywhere); the kernel reads the name from the foreach's recorded input, makes it one line, removes control and format characters, turns parentheses into brackets, cuts the id at 40 and the title at 80, and shows it in a card's "by" row as `for <id> (<title>)` and in the owner's question when items fail; without a name it says "the 1st of 3 items", never "item 0". A line that brings its own name or count is refused; a stored name the kernel could not have written is refused. `bay/runs/item-name.ts` and `bay/item-words.ts` are new. The wave declares the name and titles left-out and conflicting slices in its answer.
- **The review was done by a separate background agent for the first time** (the owner's rule not to block the main thread): 15 bugs, 8 survived the builder's own tests although the builder had caught 10 of its own. The first builder could not be resumed after a restart; a second closed all eight and four more findings. Keep reviews independent.
- **Owed:** the rounds' merge card has no slice title; a card drawn from given steps shows no "by" row.
- **CO1 (built, not merged):** the coordinator's block gains step 6 (a question for the owner: show it whole, wait, then `resume --rerun` or `--stop`) and what to do with a run shown as `running`; its limit rose from 50 to 56 lines; shown to the owner. It found that `resume --rerun` and `--stop` record nobody's words and are not limited by `approvals.from`: **RS1** (building on CO1's branch) makes them take `--via` and `--quote` as `approve` does, prints both answers in `bay runs`, and corrects the README on `--stop`.
- **SW1 (building):** measures where the full check's 28 to 31 minutes go, then cuts.
