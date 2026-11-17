# Brief PD1: three designs for the interfaces forge is cut along: proof, the form of a slice and a plan, and the card

A design round. Documents only: no code, no tests, no schema is changed. For one designer. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `pd1/proof-designs`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/plans/0022-forge-in-waves.md` (this round is its slice D1; everything after is cut along what the owner chooses here).
- `docs/adr/0006` (deep modules), `0009` (approvals), `0013`, `0015` (forge: proof by script, two approvals on honest cards), `0016` (a mode from prose), `0017` (all twelve items of "How forge keeps boundaries"), `0018` (forge builds any product; design of interfaces before the plan), `0019`, `0020`, `0021`.
- `docs/designs/forge/` (the three designs forge itself was chosen from, and `calling-a-toolchain.md`, `modes-beside-the-kit.md`, the open questions), `docs/designs/operations/` and `docs/designs/trust/` (two earlier rounds in the form this one follows: a frame, three designs, a comparison).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- The code as it is: the four interfaces under `components/base/interfaces/` with their shared tests; the typescript and git-worktrees modes; `bay/runs/` (how a workflow stops for an approval and what the approval is bound to), `bay/commands/approve.ts`, the workflow and config schemas; the toolbox `bay/sdk.ts`; the test toolbox.
- The record of how slices were reviewed by hand, which proof replaces: the briefs in `docs/briefs/` (their definitions of done), `docs/research/2026-11-16-boundary-audit.md` and `2026-11-17-boundary-audit-after.md`, and the capture script at `/home/claude/m5-capture/capture.sh` (read only).

## Output

Under `docs/designs/proof/`:

1. `0-frame.md`: what every design is held to. The problem with evidence from the code and the briefs (file and line). Who calls each interface (the reviewer by hand, forge's workflow, a builder's skill step, the owner reading a card) and what each needs. What must stay true (every security property of `docs/designs/operations/0-frame.md` and `docs/designs/trust/0-frame.md`; a verdict is passed, failed or inconclusive and inconclusive is never a pass; a builder's own words never reach a card; proof uses no model; a toolchain is never given a slice's worktree). The words this adds to `CONTEXT.md`, with synonyms not to use. The limits the kit already keeps (`bay check`'s limits on concepts and commands) and where each design stands against them. A list of concrete cases every design must answer, taken from real past slices: at least a slice that passed, one sent back for a surviving mutant, one that changed a file outside its scope for a good reason, one whose two builders met in one file, one where the builder's test count was wrong, and one in a project that is not the kit with no map of modules yet.
2. Three designs, each complete enough to cut slices from, each under a different constraint: `A-smallest.md` (the least that makes proof's verdicts replace the reviewer's hands; nothing that is not needed for the todo mode), `B-caller.md` (what fits the commonest caller best: the definition-of-done item that names a kind of proof, and the owner reading a card on a phone), `C-seams.md` (the seams placed for testing: every kind of proof testable alone against a made-up toolchain and worktrees mode, a shared test any proof must pass, wrong proofs that fail one case each). Each design covers all three interfaces:
   - **Proof.** The entry as a caller uses it, written as calls with real inputs and the output they give. The closed set of kinds and what each one's request and verdict hold. Whether kinds are actions or data. What a project declares and where (its map of modules, its practices, its commands whose output must not change or must change as the plan says) and what proof does in a project that declares none. How proof reaches the toolchain (copy, call, remove) and the worktrees interface. What is behind the entry that callers never see, and what would be lost if the module were deleted (`0006`). What the feature map says afterwards.
   - **The form of a slice and a plan.** A slice: kind, write scope, the slices it comes after with the reason, the interface it builds against, its definition of done with a kind of proof per item, the declaration a builder makes before it edits (`0017` item 9). A plan: slices, and what a script works out from them (waves, the longest chain, builders per wave, disjoint scopes). One real slice and one real plan written out in the form: use slice TR2 and `docs/plans/0022-forge-in-waves.md`. Where the form lives (a schema of the kernel, or files of the forge mode) and what that costs against the limits.
   - **The card.** What an approval with named choices holds. How a script withholds a choice and what the owner then reads. The two cards of a job (what will be built; the merge) drawn as the owner would see them, 44 columns wide, for one real past slice, with every line marked by where it came from (the kernel ran it; a script computed it; a named model judged it). What is bound by the hash.
   Each design ends with: its migration as slices with kind, write scope and order (so it can replace the table in the plan); what it trades away; its risks; a count of new concepts, kernel lines (estimated, with the basis) and new owner-facing sentences.
3. `comparison.md`: the three side by side on the frame's cases and on cost; where they agree (say so and stop comparing there); the questions that are the owner's to decide, each with a recommendation and what it costs him; a recommended design or hybrid, with the reason. No more than four questions for the owner.
4. A report.

## Definition of done

- [DOD-PD1-1] (must) Every claim about the code as it is carries a file and line that the designer opened. No claim from memory of an earlier round.
- [DOD-PD1-2] (must) Each design answers every case in the frame, in a table, with what the caller would see.
- [DOD-PD1-3] (must) Each design's slices have disjoint write scopes within a wave, shown as a table, and no slice's scope is a whole kernel feature unless the design says why (`0017` item 8).
- [DOD-PD1-4] (must) The cards are drawn, not described. No line on a card is a builder's words.
- [DOD-PD1-5] (must) No security property of the two earlier frames is weakened by any design; the frame lists them and each design says how it holds each.
- [DOD-PD1-6] (must) The comparison names at most four questions for the owner, each answerable by choosing one option.
- [DOD-PD1-7] (should) Each design says what the reviewer by hand still does after it, and what stays a model's judgement, labelled as judgement.

## Instructions

1. Read before writing: the ADRs, the two earlier design rounds for their form, then the code. Take notes with file and line.
2. Write the frame first and commit it. Then the three designs, one commit each, each written as if the other two did not exist: a design is not the previous one with changes.
3. Then the comparison. Then the report.

## Tools

Read-only use of the repository: reading files, `grep`, `git log`, `git show`. No test runs, no `npm run check`, no builds: another builder is measuring the suite's time on this machine and must have it quiet. If a claim needs a command's real output (for example what `bay check --json` prints), take it from the capture outputs already saved under `/home/claude/m5-capture/` or from a test's literal expectation, and say which.

## Rules and constraints

- Plain English, short sentences. Follow the project's writing guide if `framework/` has one; write for an owner who was not in the room.
- P-25: if the three constraints cannot yield three really different designs for one of the interfaces, say so in the frame and write two for that one; do not pad.
- P-28: every sentence and card the owner would read is drawn in full.
- P-33, P-34, P-35 hold for the slices each design proposes.
- A design proposes; it does not decide. Nothing under `bay/`, `schemas/`, `components/`, `adapters/`, `tests/` or `CONTEXT.md` changes in this round.
- Write scope: `docs/designs/proof/` only.
- Swamp (github.com/swamp-club/swamp) is AGPL: ideas already recorded in this repository's ADRs may be used; do not open or copy its code.
- Commit after each document; keep `/tmp/pd1-progress.md` current. The session may be stopped without warning.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report: where the designs really differ, in ten lines; the questions for the owner with recommendations; what you could not find evidence for; what you did not read.
