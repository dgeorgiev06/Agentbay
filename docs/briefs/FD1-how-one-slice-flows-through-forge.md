# Brief FD1: how one slice flows through forge, written down against the code as it is, with every missing capability named

A design note. Documents only: no code, no tests, no schema is changed. For one designer. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Why

Slice F1 is next on the longest chain: forge carries one approved slice through a builder in a worktree, proof, the merge card and the merge. Three slices this week stopped, correctly, because a capability they needed did not exist (a step longer than eight minutes; a copy that is a repository; a toolbox that reads a plan). Each stop cost a builder's hour before it was found. This note finds them for F1 before a builder starts (P-35, P-33), by walking the flow against the code, step by step, and saying for each step exactly which existing action, operation or workflow feature carries it, with file and line, or that none does.

## Input

- Branch `fd1/forge-flow`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0015` (forge: small modes behind interfaces; proof by script; two approvals on honest cards; a slice sent back goes to a fresh builder; forge runs no command), `0016`, `0017` (all twelve items), `0018`, `0019`, `0021`, `0022`, `0023`.
- `docs/plans/0022-forge-in-waves.md` (slices F1 to F4 and what each waits for), `docs/designs/proof/A-smallest.md` (sections 2 and 3: the declaration as a skill step before the build step; the card; what the reviewer still does), `C-seams.md` section 3, `C1r-what-an-approval-shows.md`, `interface-open-questions.md`, `toolbox-for-plans.md`, `docs/designs/forge/` (the three designs forge was chosen from, `calling-a-toolchain.md`, the open-questions notes).
- The code: the workflow schema and how runs walk a workflow (`bay/runs/`: script steps, skill steps with their tier, checks and rounds, `call:` steps, `foreach`, approvals with choices and a card, how a later step reads a choice, budgets); how a skill step is handed to the harness and what the agent in it may touch (`adapters/claude-code/`: the step guard, roots, the commands a step's shell is given, `bay submit`); the worktrees interface and the git-worktrees mode (cut, status, changed, copy, overlay, remove, merge, set-aside, apply); `proof@1` and the proof mode; the forge mode as slice W1 leaves it (if W1 is not merged when you read, read its branch `w1/waves` in `/home/claude/wt-w1`, read only); `bay/policy.ts` and `bay/manifests/activation.ts` for forge's own rules; the toolbox.
- How slices were carried by hand this week, which is the flow forge replaces: the briefs in `docs/briefs/` and the reviewer's steps (a worktree per slice; a builder with a brief; the builder commits; the reviewer injects bugs, merges with a merge commit, regenerates the debt list, runs the full check, pushes, removes the worktree).

## Output

One file, `docs/designs/forge/one-slice.md`:

1. **The flow as a table of steps**, from "an approved slice and a base commit" to "merged, kept or discarded": for each step, what it is (script, skill, call, approval), which mode's action it is, its input and output as real values for one real past slice (use TR2, as the proof designs did), and what the kernel records. Include at least: making the worktree and branch; the builder's declaration before it edits; the build itself; how the builder's work becomes commits on the slice's branch; calling proof; working out which choices are offered; drawing the card; the approval; and what each of the four choices does afterwards.
2. **For every step, where it stands today**: carried by existing code (name the action or feature, file and line, and a test that shows it), or carried with a change inside the forge mode's own folder (say what), or **not possible without a capability** (say exactly what is missing, in which kernel feature or which other mode, the smallest form of it, and whether it weakens any property of `docs/designs/operations/0-frame.md` or `docs/designs/trust/0-frame.md`). Questions this must answer with evidence, not belief:
   - Can an agent in a skill step write files inside a slice's worktree under `.forge/worktrees/`, and nowhere else in the project? What decides its roots, and can a workflow set them per run to one worktree?
   - Who commits the builder's work to the slice's branch? The worktrees interface has no action that commits a worktree's changes to its own branch (`set-aside` commits them to another). May the agent's shell run git there? If not, what is the smallest action that does it, and whose is it?
   - Can a workflow call `proof.prove` with a value built from earlier steps (the slice, base, head, the declaration, the bugs), and wait up to thirty minutes for it? What time limit and budget does that need, and where is each declared?
   - A card's `ran` line must cite a command the kernel recorded in this run or in a run a skill of the cited step called. Proof is called by the workflow, not by a skill. Are its commands in this run? Which step would a `ran` line cite?
   - A judged line needs a skill the approval lists under `quotes`. Which skill judges the judgement items of a slice, and is it in F1 or later? What does the card show for judgement items until then?
   - How does a workflow branch on the choice taken (merge, send back, keep, discard)? Does the workflow schema have a conditional step, or is a script given the choice and does it call the action?
   - Forge runs no command and may be active only in the kit. Does anything in the flow need forge itself to list a command or name a throwaway folder?
   - What is the builder given as its task (the slice, the practices by path from `toolchain.describe`, the scope), and by what means does a skill's prompt receive values of the run?
   - What happens to the worktree and branch when the run fails midway or is stopped, and on resume?
   - What does the flow cost in script hosts, copies and minutes for TR2, from the measured numbers in `docs/research/2026-11-17-suite-time.md` and the real runs recorded in the reports' notes (`prove` on TR2 took about 945 seconds beside another run)?
3. **The capabilities missing, as slices**: each with kind, write scope, what it must be able to do alone, and which of F1 to F4 waits for it, in the plan's form, so the reviewer can add them to the plan and brief them. Fewest and smallest first; say which could be avoided by a different cut of the flow, and what that cut costs.
4. **F1 cut to what can be built now**: the smallest version of the flow that works end to end with only what exists plus the forge mode's own files, even if a step is done by hand by the owner or the reviewer for now (say which), so that F1 can start beside the capability slices and not after them. Its files, named, and its tests: how the flow is tested with no model (skill outputs submitted by the test, as the runs tests do).
5. **Both cards drawn** for TR2 as F1 would really show them with today's kernel (marks, the kernel's tier line and not a model's name, choices with their sentences, a withheld choice with its reason), 44 columns, each line with the step it would cite.
6. **What the owner should try in his first live session**, as numbered steps, once F1 is built.
7. A report: the missing capabilities in ten lines, most blocking first; what you could not find evidence for; what you did not read.

## Definition of done

- [DOD-FD1-1] (must) Every claim about the code carries a file and line the designer opened in this session.
- [DOD-FD1-2] (must) Every question of output 2 is answered yes or no with the evidence, or "not known" with what experiment would settle it. No answer is "should".
- [DOD-FD1-3] (must) Each missing capability is one slice with a write scope no wider than one kernel feature or one mode, or the note says why it cannot be.
- [DOD-FD1-4] (must) The cut of output 4 is concrete enough to brief: its files, its workflow written out in the workflow schema's real form, and the list of what is done by hand for now.
- [DOD-FD1-5] (must) No security property of the two frames is weakened by anything proposed; where a capability touches one (an agent writing in a worktree; an action that commits), say how the property still holds and what test would hold it.

## Tools

Read-only use of the repository: reading files, `grep`, `git log`, `git show`. No test runs, no `npm run check`, no builds: builders are running suites on this two-core machine. If a claim needs a command's real output, take it from a test's literal expectation or from the fixtures under `tests/fixtures/`, and say which.

## Rules and constraints

- Plain English, short sentences, for an owner who was not in the room.
- P-25: a design proposes; it does not decide. Where the owner must choose, give at most three questions, each answerable by choosing one option, with a recommendation.
- P-33, P-34, P-35 hold for every slice proposed.
- Nothing under `bay/`, `schemas/`, `components/`, `adapters/`, `tests/` or `CONTEXT.md` changes.
- Write scope: `docs/designs/forge/one-slice.md` only.
- Commit when the note is complete enough to be useful, and again at the end; keep a progress note in the one scratch folder you are given. The session is restarted from outside about every 45 minutes.
- Never read or print real secrets. Never push. Never touch `main` or another worktree (reading `/home/claude/wt-w1` is allowed).
