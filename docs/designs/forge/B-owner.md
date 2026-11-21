# Forge, design B: from the owner's seat and from the kinds of work

Design only. Words as `CONTEXT.md` defines them. Numbers are marked (measured) when they come from the frame's facts or the repository, and (estimated) otherwise.

## 1. The shape

The owner types one sentence. Forge restates it, decides its kind of work, and does the first step that suits that kind before any plan: an example of what he will see for a new mode, a capture of today's output for a behaviour change, a pin for a refactor, one failing command for a bug fix, three designs for a wide interface. The owner is then shown one card, a fixed shape of at most 15 lines (estimated, one phone screen), with what he asked, what will be built, what he will type or see afterwards, and the evidence the kernel produced. He answers with one tap. Builders work slice by slice in worktrees while he is away. Every check is rerun by scripts. A reviewer on another model reads the diff. At the end he gets a second card that shows the real thing running, not a description of it, and taps Merge, Keep or Discard. Between the two cards he need not be attached. At any moment he can ask "where is it?", "why did it fail?", "show me" or "stop", and each has one fixed answer. One workflow serves every kind. What differs between kinds lives in small kind modes behind one interface, so a new kind is a new mode and the workflow does not change.

```
 owner types ──> restate (skill) ──> baseline (scripts) ──> FIRST STEP of the kind (kind mode)
                                                                  │
            plan + briefs (skill) ── check-brief (script) ── challenge (skill, other model)
                                                                  │
                         CARD 1 "Build this?"  [Build] [Stop]  <──┘          owner, one tap
                                                                  │
   foreach slice, in order:  open worktree ─> build (skill) ─> checks: scope, toolchain, claims rerun,
                             bug injection in a copy, kind proof, review (skill, other model)
                             ─> integrate into forge/<run>      (2 rounds, then the run waits for him)
                                                                  │
            prove: the real thing in a fresh project + evaluate (skill, fresh, other model)
                                                                  │
          CARD 2 "Merge?"  [Merge] [Keep the branch] [Discard]  <─┘          owner, one tap
                                                                  │
                                      land (script): merge to main or keep or delete
```

## 2. The owner's seat

### What he types
One sentence, in his words, to his harness session: "forge: build a mail source mode that reads made-up mail from a folder". The session runs `bay call --workflow forge:workflows/build.yaml '{"request":"<his words>"}'`. His words are stored verbatim and open every card, every brief and every report.

### The card
Every approval forge raises is a card. `forge` renders it from kernel output only; a script (`check-card.ts`) refuses a card that breaks the shape.

```
FORGE run 41 · new mode · card 1 of 2 · hash 9f3a
You asked: "build a mail source mode that reads made-up mail from a folder"
I will build: a mode mail-folder that serves items-source@1 from a folder of .eml files.
You will type: bay call mail-folder.fetch '{"since":"2026-11-01"}'   (new)
You will see:  [ran] example output from 3 made-up mails (details: 3 items, 41 lines)
Slices: 2 · touches only components/modes/mail-folder/ · one-way door: no
Checked: [ran] brief check 0 problems · [judged:model-B] challenge found 1 conflict, fixed
Not shown: nothing
Spent 6 min of 4 h · next card in about 1 h (estimated)
Choose: (1) Build it (recommended)  (2) Stop
```

Rules of the card, each held by `check-card.ts`:
- Every evidence line carries one tag: `[ran]` (the kernel ran it; the output is in the details), `[judged:<model>]` (a model's judgement, with the model named), or `[missing]`. There is no tag for a builder's statement, so a builder's words cannot reach a card.
- "Not shown" is always present. A `[missing]` item is listed there.
- The recommended choice is computed by a script from the tags, never by a model. A card with any `[missing]` must item has no recommended choice, and Merge is not offered at all.
- Where the work changes what he sees, the card holds an excerpt of the real output, cut from a run in a fresh project. He sees the thing, not a sentence about it.
- The hash covers the card and its choices. If anything changes after he saw it, the run returns to the card (proposal 0022, "Approval binds content").
- At most one card is pending per run. Cards do not queue up while he is away.

The harness session presents the choices as selectable options. His tap is recorded with `bay approve <run> <step> --hash <h> --choice <id> --via chat --quote "<the option he tapped>"`.

### What he can ask at any moment

| He asks | The session runs | He gets |
|---|---|---|
| "where is it?" | `bay runs <run> --brief` | Five lines: kind, stage, slice k of n, the latest headline (a verified fact), spent against budget, and who it waits for |
| "why did it fail?" | `bay runs <run> --brief` on a waiting or failed run | The failing check's name, its last 10 lines as the kernel saw them, the rounds tried, and choices: one more round with a fresh builder, or stop |
| "show me" | `bay runs <run> --full` | The pending card with its details, or the latest card |
| "stop" | `bay resume <run> --stop [--via terminal \| --via chat --quote "<the owner's exact words>"]` | The run stops. Branches with commits are kept and the reply says how to discard them. Nothing on main changes |
| "go on" | `bay resume <run>` | The run continues from its last finished step |

### When he is away and the session stops
The run is in the kernel database. Each verified unit is a commit. Nothing lives in the session. In relay mode, work pauses until a session is open again; the session's protocol starts with `bay runs --brief` and reissues the waiting task to a fresh builder. In direct mode (kernel addition 9) the kernel starts builders itself, so only the two cards need him.

## 3. The kinds of work

The `restate` skill picks one kind from a closed set. A feature added to an existing mode is a behaviour change: its "before" shows the action missing, its "after" shows it working. So the frame's "new feature" folds into "behaviour change".

| Kind | First step, before any plan | Evidence on card 1 | Kind proof per slice | Evidence on card 2 |
|---|---|---|---|---|
| New mode | `example`: made-up input fixtures and the exact command and output the owner should see, written as a demo script | The demo script and its expected output | The demo passes in the slice's worktree | The demo run in a fresh project, its real output excerpted |
| Behaviour change | `capture`: the named commands run on the base commit, outputs stored; then the intended change written as a diff of those outputs | Today's output and the intended diff | Captured output after equals the intended diff; every other line byte-for-byte the same | Before and after side by side |
| Refactor or move | `pin`: full capture of the project's capture script and every check, byte for byte; for a move, the move script (P-24) | The pin's size and what it covers; target shape; sizes now | Pin identical; the move script reproduces the tree from the base commit | "Pin identical" `[ran]`, sizes before and after, what was deleted, whether reader load fell `[judged]` |
| Bug fix | `reproduce`: one command, run by the kernel, that fails and asserts the owner's symptom; then `diagnose`: ranked causes, each with a prediction | The failing command and its output; the surviving cause `[judged]` | The command passes; the regression test fails on the parent commit and passes on the fix | Red then green, both `[ran]`; no debug prefix left |
| Design round | `ground` then `candidates`: a rubric written first, then three designs under different constraints, each with the caller's usage first | Three designs, one screen each, plus the judge's scores against the rubric; choices A, B, C | Not applicable: the slice writes a decision record | The decision record and the follow-up requests it creates |

Approvals are the same two cards for every kind. What differs is what the cards hold. A bug fix with no red command never reaches card 1: the run waits with "could not reproduce", the commands tried, and choices to give more detail or stop.

## 4. The modes

Small modes behind interfaces. All are base modes in `components/base/`, because only base modes may list commands.

**`forge`** (workflow `build`; commands: none of its own)

| Action | Does | Effects |
|---|---|---|
| `restate` | Skill `restate` (balanced): goal, kind, smallest change, what the owner will type and see. Checked by `check-restate.ts`: the four fields present, kind in the closed set | read |
| `first-step` | Calls `work-kind.first-step` on the kind's mode | read, write |
| `plan` | Skill `plan` (deep): slices, scopes, blockers, one brief each. Checks: `check-plan.ts`, `check-brief.ts`, skill `challenge` (deep, other model) | read, write |
| `card` | Renders a card from kernel outputs; checked by `check-card.ts` | read |
| `build-slice` | Skill `build` (balanced) in the slice worktree. Checks: `forge-git.scope`, `forge-proof.toolchain`, `forge-proof.claims`, `forge-proof.inject`, `work-kind.prove`, skill `review` (deep, other model). Rounds: 2 | read, write |
| `prove` | `forge-proof.real-thing`, then skill `evaluate` (deep, fresh, other model), then the merge card | read, write |
| `land` | Acts on the merge card's choice through `forge-git` | write, delete |

**`forge-git`** (implements `workspace@1`; commands: `git`)
`base` (create `forge/<run>` from main and record its commit), `open` (worktree and branch per slice, a lock file with the run id), `scope` (changed files against the slice's scope; the main checkout's status unchanged), `integrate` (merge a slice into `forge/<run>`; a conflict aborts and fails the step with the two slices named), `pickup` (on a reissued task: save a dirty tree as a patch in the run's folder, reset, list commits since base), `land` (merge to main only if main has not moved since card 2, else a fresh card), `clean` (remove clean worktrees; keep branches with commits).

**`forge-proof`** (commands: the kit's `bay.sh`, and through `toolchain@1` the language's)
`baseline` (every check, test count, sizes, debt and copy counts on the base), `toolchain` (routes changed files to `toolchain@1` and merges findings), `claims` (reruns each command the builder cited per definition-of-done id, stores the output; an id with no rerun is `[missing]`), `inject` (copies the worktree to a throwaway folder, applies each `toolchain.mutants` patch, runs tests with a time limit, deletes the copy, then asserts the worktree is clean), `real-thing` (a fresh project under `/tmp`, the brief's real command, output kept), `counts` (before and after, never a target).

**Kind modes** (each implements `work-kind@1`: `first-step` and `prove`)
`forge-new-mode` (skill `example`, script `check-demo.ts`), `forge-change` (scripts `capture.ts`, `compare.ts`), `forge-refactor` (scripts `pin.ts`, `compare.ts`, `replay-move.ts`), `forge-bugfix` (skills `reproduce` and `diagnose`, scripts `red.ts`, `red-green.ts`, `no-probe.ts`), `forge-design` (skills `ground` and `candidate`, skill `judge` on another model, script `screen.ts` for importable internals and lists kept twice).

**Toolchain modes** (implement `toolchain@1`): `typescript` now, `go` later.

Nine modes for TypeScript work (measured from the list above), ten with Go. The mail mode needs five of them: `forge`, `forge-git`, `forge-proof`, `forge-new-mode`, `typescript`.

### Skills, each with the seven sections

| Skill | Tier | Output | Checked by |
|---|---|---|---|
| `restate` | balanced | goal, kind, smallest change, owner-visible change | `check-restate.ts` |
| `example`, `reproduce`, `ground`, `candidate` | balanced, balanced, deep, deep | the kind's first evidence | the kind's script runs it: the demo runs, the red command fails, each candidate has its five parts |
| `diagnose` | deep | causes with predictions; the survivor with its probe output | each prediction names a command; the survivor's command was run |
| `plan` | deep | slices with scope, blockers, a brief each | `check-plan.ts` (no cycle, disjoint scopes, ids unique), `check-brief.ts` |
| `challenge` | deep, other model | pairs of items that cannot both hold, each quoting both | every finding quotes two existing ids; a must-pair blocks card 1 until fixed |
| `build` | balanced | commits; per id the command that shows it | rerun by `forge-proof.claims` |
| `review` | deep, other model | a verdict per id, standards findings citing practice ids, its own injections | covers every id; cites a rule or says `judgement`; the worktree diff is empty after it |
| `evaluate` | deep, fresh | ranked findings with file and line | file and line exist |
| `judge` | deep, other model | scores per rubric line | the rubric's hash predates the candidates |

Where brief contradictions are caught: `check-brief.ts` catches the mechanical part (each id has a level, no "if" or "or" in a must, each must names a command from Tools or a file, every Tools command answers `--help`). `challenge` catches pairs that cannot both hold. Both run before card 1, so the owner never approves a brief with a known contradiction, and the card says what was found.

## 5. The workflow

```yaml
name: build
trigger: { manual: true }
budget: { minutes: 240, usd: 40, rounds: 4 }
steps:
  - id: restate
    action: restate
    input: { request: $trigger.request }
  - id: baseline
    action: forge-proof.baseline
  - id: first
    action: first-step
    input: { restated: $steps.restate.output, baseline: $steps.baseline.output }
  - id: plan
    action: plan
  - id: what
    approval: Build this?
    show: $steps.plan.output.card
    choices: $steps.plan.output.choices
  - id: base
    action: forge-git.base
  - id: slices
    foreach: $steps.plan.output.slices
    steps:
      - id: open
        action: forge-git.open
        input: { slice: $item, choice: $steps.what.output.choice }
      - id: build
        action: build-slice
        input: { slice: $item, worktree: $steps.open.output }
      - id: integrate
        action: forge-git.integrate
  - id: prove
    action: prove
  - id: merge
    approval: Merge to main?
    show: $steps.prove.output.card
    choices: $steps.prove.output.choices
  - id: land
    action: land
    input: { choice: $steps.merge.output.choice }
```

One workflow, because the format has no branches and the kinds differ in steps, not in order. `first-step` and `build-slice` reach the kind through `work-kind@1`. For a design round, `choices` are A, B, C and the one slice writes the record for the chosen design. Exhausted rounds make the run wait like an exhausted budget (addition 4), which is where "why did it fail?" is answered.

## 6. The toolchain interface

```yaml
name: toolchain
version: 1
actions:
  describe:       { effects: [read] }
  check-types:    { effects: [read] }
  lint:           { effects: [read] }
  check-format:   { effects: [read] }
  find-dead-code: { effects: [read] }
  find-copies:    { effects: [read] }
  test:           { effects: [read] }
  mutants:        { effects: [read] }
  standards:      { effects: [read] }
```

Every action takes `{ folder, files }`. `describe` returns the language, its file patterns, its commands and its practice files. The checks return findings as `{ file, line, rule, message }`, or "not applicable" where the language has no tool. `find-copies` returns each copied block with both places. `test` returns the tests run and failed with output, under a time limit. `mutants` returns patches for the given lines. `standards` returns the practice entries that apply to the given paths. Inputs and outputs have schemas under `components/base/interfaces/toolchain/`.

| Action | `typescript` supplies | `go` supplies |
|---|---|---|
| check-types | `tsc --noEmit` | `go vet ./...` |
| lint | eslint with the kit's config | `staticcheck` |
| check-format | prettier `--check` with its config | `gofmt -l` |
| find-dead-code | knip, twice | `deadcode` from golang.org/x/tools |
| find-copies | jscpd | `dupl` |
| test | `node --test` | `go test -json` |
| mutants | a script with operators over TS lines | a script with operators over Go lines |
| standards | `practices.md` (TS-01 to TS-17) | its own `practices.md` |

Practices come from the toolchain mode, from `forge` (language-neutral ones), and from the project's `standards/` folder, each entry with `Applies to` and `Enforced by`. The owner adds one with `bay new practice`. The `review` skill cites the ids.

## 7. Kernel additions

| # | Addition | Why forge cannot do without it | Smallest form | Feature | When |
|---|---|---|---|---|---|
| 1 | Approval choices | One tap needs named choices; Merge, Keep, Discard and A, B, C are not approve or reject | `choices` on an approval (list or reference); the hash covers them; the step's output is the choice; `bay approve --choice` | runs, schemas, command-line | Before the first job |
| 2 | Commands for scripts | Worktrees, toolchains and the fresh project need `git`, `tsc`, `bay.sh` | `context.commands.run(prefix, args)` for a base mode's listed prefixes, run by the kernel, time limit, output scrubbed | scripts, broker | Before |
| 3 | A check may be a skill | Review must send a slice back like a script check does | `checks` takes `skill:`; each round is a new task with the whole scope and every finding, so a fresh agent takes it (P-25); `rounds` settable | runs | Before |
| 4 | Rounds wait like a budget | After two rounds the owner decides; today the step fails | `rounds` is a budget measure; at the limit the run waits; `--extend rounds=1` or `--stop`, each with `[--via terminal \| --via chat --quote "<the owner's exact words>"]` | runs | Before |
| 5 | A headline per run | "Where is it?" on a phone needs one verified line | toolbox `context.say(text)` writes a `run.headline` event; `bay runs --brief` shows the latest | runs, command-line | Before |
| 6 | Write scope per task | Stop writes outside scope instead of catching them after | a skill step's `writes: $input.scope` narrows the grant; the adapter's hook enforces it | harness | After; `forge-git.scope` catches it meanwhile |
| 7 | Binding to a list, call by name | Five kinds and several toolchains behind one interface | as plan 0022's addition | manifests, broker | After, with the second kind |
| 8 | A model per skill | `challenge` and `plan` are both deep; `judge` must differ from `candidate` | `skills: { forge.challenge: { model } }` in the config | manifests, harness | After; cards tag the model, so a same-model check is visible |
| 9 | Direct mode | The owner is away and the session stops | `Adapter.run(task)` as in plan 0022 | harness, runs | After the mail mode, before the home mode |

Nine additions, five before the first job (measured from this table). Images as skill input are needed by the home mode, not by forge.

## 8. Worked example: "build a mail source mode that reads made-up mail from a folder"

Times are estimated, from 15 to 70 minutes per slice measured by hand.

1. **He types** the sentence. The session starts the workflow and says "Started run 41. I will show you a card in about 10 minutes."
2. **restate** (balanced): kind new mode; goal "the mail briefing can be tested without a real mailbox"; smallest change "a mode `mail-folder` that serves `items-source@1` from `.eml` files"; he will type `bay call mail-folder.fetch`. Headline: "Restated as a new mode."
3. **baseline**: every check on main, 0 failures, counts stored.
4. **first step, `example`**: three made-up mails (one plain, one HTML, one with an attachment) in `fixtures/`, and a demo script: in a fresh project, `bay call mail-folder.fetch '{"since":"2026-11-01"}'` must list three items with sender, subject, date and a text body. The kernel runs the demo against nothing yet: it fails as expected, which proves the demo can fail.
5. **plan** (deep): slice 1 "fetch and describe read a folder" (scope `components/modes/mail-folder/`), slice 2 "the HTML and attachment cases" (same scope, blocked by 1). `check-brief.ts` finds one must without a command and the planner fixes it. `challenge` finds that DOD-2 says "bodies are plain text" and DOD-5 says "HTML is kept"; the planner rewrites DOD-5 as "HTML is converted to text and the original is stored". Headline: "Plan checked: 2 slices, 1 conflict fixed."
6. **Card 1** reaches his phone (the card in section 2). It shows the demo's expected output, not a summary of it. **He taps "Build it".**
7. **Slice 1**: worktree `forge/41/s1`. The builder writes the demo's first test, sees it fail, builds, commits per green unit with `DOD-41-1-n` in each message. The checks run: scope clean, typescript clean, each cited command rerun, 12 injected bugs in a throwaway copy with 1 surviving (estimated), so the slice goes back. The session stops at this point. He is at a site visit.
8. **Pickup**: he opens a session that evening. The protocol runs `bay runs --brief`, which says "slice 1, round 2 waiting for a builder". `forge-git.pickup` finds the tree clean; a fresh builder gets the brief, the review findings and the commits. It adds a test for the surviving bug. Review (another model) gives a verdict per id. Integrated.
9. **Slice 2** the same way, first round. He asks "where is it?" on his phone and gets: "new mode · slice 2 of 2 · review passed · 1 h 50 m of 4 h · next: proof in a fresh project".
10. **prove**: a fresh project in `/tmp`, the kit's `bay.sh`, the demo command. The real output is kept. `evaluate` (fresh, other model) finds one should-item: the date has no time zone.
11. **Card 2**: "You asked ... You will type: bay call mail-folder.fetch ... You will see: [ran] (the first 8 lines of the real output) · Checked: [ran] 41 tests, 0 failed · [ran] 24 injected bugs, 0 survived (numbers illustrative) · [judged:model-C] 1 should: dates lack a time zone · Not shown: nothing · Choose (1) Merge (recommended) (2) Keep the branch (3) Discard". **He taps Merge.** `land` checks main has not moved, merges, cleans the worktrees. Headline: "Merged."

He typed one sentence and tapped twice. He was attached for about 3 minutes in all (estimated).

## 9. Answers to the remaining questions

- **Stages (Q2).** As section 1. A failed check returns the slice to a fresh builder with the whole scope; after two rounds the run waits for him with "why did it fail?" already answered.
- **Slicing (Q3).** `plan` cuts; `check-plan.ts` holds disjoint scopes, no cycle, and a slice sized to finish in under 30 minutes (estimated, below the stops that briefs M4 to M6 record about 35 minutes in, measured). Slices run in order (`foreach` stays sequential). Shared types are a slice of their own, first.
- **Isolation (Q4).** A worktree and branch per slice under `.forge/worktrees/`, created and removed by `forge-git`, locked by run id. "Touched nothing outside scope" is `git diff --name-only` against the scope plus an unchanged `git status` in the main checkout, both after every round.
- **Starting agents (Q5).** Relay: the session hands each task to a subagent, as today. Direct: `Adapter.run`. What survives: the run, the commits, the patch of a dirty tree. A fresh builder starts from the brief, `git log` since base and the findings. Commit messages carry the id and the evidence command, so the trail is the branch.
- **Review (Q6).** Scripts: rerun checks, scope diff, captures and pins, bug injection, copies, counts, red then green. Model: does a test assert the right thing, is the design sound, does the code match the brief. A claim is tied to evidence by the id and its command: the kernel reruns it, and only the kernel's output reaches a card.
- **Models (Q7).** Skills name tiers. Build is balanced and review deep, so they differ wherever the config maps tiers to different models; `bay check` warns when they do not. Addition 8 gives the challenger and the judge their own model. Cards name the model behind every `[judged]` line.
- **What can go wrong (Q12).** A builder that lies: its words never reach a card; its claims are rerun. A builder that loops: the minute budget per slice and the round limit. A vacuous check: the demo, the red command and every injected bug must be seen failing first. A merge conflict: integrate aborts, names the two slices, and the run waits, because the plan said their scopes were disjoint. A stopped session: durable runs and pickup. A budget overrun: the run waits; "why?" shows what was spent where. A stale approval: `land` refuses when main moved and raises a fresh card.

## 10. Trade-offs

- Two cards per request is few. He approves the restatement, the evidence and the slice count, not each brief. A bad slicing is caught by the challenge and by review, not by him. "Show me" gives the briefs if he wants them.
- Kinds behind an interface keep one workflow, but a reader cannot see the bug-fix path in one YAML file. He must read the kind mode.
- Nine modes and nine kernel additions are more parts to build and to learn than one large forge mode.
- Relay mode stalls while he is away, until direct mode exists.

**The strongest argument against this design.** It makes approving easy, and easy approval invites approving by reflex. A recommended button on a phone screen will be tapped without reading, which is the failure the design set out to prevent. The tags, the "Not shown" line and the rule that Merge disappears when evidence is missing make the card honest. They do not make him read it. If the card renderer or the recommendation script has a bug, it is hidden behind the very trust the cards build.

## 11. Build order

By hand, through the current process, one builder each:

1. H1 approval choices (addition 1).
2. H2 commands for scripts (addition 2).
3. H3 a check may be a skill, a fresh task per round (addition 3).
4. H4 rounds wait like a budget (addition 4).
5. H5 headline and `bay runs --brief` (addition 5).
6. H6 `toolchain@1` and the `typescript` mode, replacing the config folder `components/base/typescript/`.
7. H7 `forge-git`.
8. H8 `forge-proof`.
9. H9 `forge`: the workflow, `restate`, `plan`, `challenge`, `build`, `review`, `evaluate`, the card and its check. `work-kind` bound to one mode.
10. H10 `forge-new-mode`.

**Forge first builds something itself:** F1, a throwaway `echo` mode in a fresh project, to walk both cards once. Then F2, the mail source mode, its first real job.

By forge, each a new mode or a kernel change:

11. H11 by hand: binding to a list (addition 7), because forge cannot yet choose a kind.
12. F3 `forge-bugfix`, F4 `forge-change`, F5 `forge-refactor`, F6 `forge-design`, each built by forge as a new mode.
13. F7 write scope per task, F8 a model per skill, F9 direct mode, each built by forge as a behaviour change of the kit.
14. F10 the home mode (proposal 0023), starting with a design round for its plan model.
