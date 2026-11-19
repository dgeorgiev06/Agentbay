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
