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
