# Brief F1: forge builds one slice: from a plan's slice to a merge card, with the owner's two approvals

A mode slice (P-34). Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

The forge mode today prints a plan's waves. This slice gives it its first workflow, `one-slice`: read one slice from a plan, ask the owner whether to build it, cut a worktree, let a builder declare and build, prove the result with the proof interface, draw the merge card, and carry out the owner's choice. It is the cut the design note drew as buildable with what exists; nothing beyond that cut is built here.

## Input

- Your branch, cut from `feat/0022-agentbay5`, in the worktree you are given. Slices W1 (forge's folder and `forge.waves`), P2 (`scope` and `declared`) and TT1 (the test toolbox takes a choice, shows a card, ends and opens the kernel again) are merged before you start.
- **The authority for this slice: `docs/designs/forge/one-slice.md`, section 4 ("F1 cut to what can be built now") and section 5 (both cards for TR2, literally).** Sections 1 and 2 say where each step stands in the code, with file and line. Section 3 lists what is missing and is built by other slices; do not build any of it.
- `docs/adr/0022` (proof, the form of a plan, the card: named choices, each with `does` and `when`; card line marks `ran`, `computed`, `judged`), `0017`, `0015`, `0020` and `0021` (trust), `0023`.
- `components/base/forge/` as W1 left it; `components/base/interfaces/proof/` and `worktrees/`; `components/base/proof/tests/copies.test.ts` (how a test writes a stand-in mode into its project); `tests/test-toolbox.ts` and TT1's `tests/test-toolbox-approvals.test.ts` (how a test answers a skill step and decides an approval with a choice).
- `bay/runs/choices.ts`, `bay/runs/card.ts`, `bay/approval-card.ts`: read, not changed.
- `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`.

## Output

All under `components/base/forge/`, the files section 4 names under "Its files", and no others:

- `mode.yaml`: W1's, plus the required interfaces, the write root `.forge/worktrees/`, and the actions `slice`, `declare`, `build`, `draw`, `carry-out`.
- `schemas/`: the settings (plus `into` and `practices`) and the request and response of each action, as the note lists them. `built.json` holds an outcome and, when stopped, what is missing as a closed set or a name, and no free text a card could show.
- `workflows/one-slice.yaml`, as the note gives it. Where the kernel's workflow schema refuses the note's text, the schema wins: change the workflow, not the kernel, and say what differed.
- `scripts/slice.ts`, `scripts/draw.ts`, `scripts/carry-out.ts`, `scripts/declared-in-scope.ts`, `scripts/lib/cards.ts`.
- `skills/declare/SKILL.md`, `skills/build/SKILL.md`.
- `tests/cards.test.ts`, `tests/one-slice.test.ts`; a paragraph in `README.md`.

Outside the folder, exactly these and nothing else: one row in `CONTEXT.md` for each new word (expect "merge card", "start card" if not there); the forge mode's entry in `features.yaml` if its file list is by name. `agentbay.config.yaml` is not yours: the two settings are written by the reviewer after the merge.

## Definition of done

- [DOD-1] (must) Pure part first. `scripts/lib/cards.ts` is a pure function from the slice, the proof's verdicts and the builder's outcome to: the lines of both cards, the three `when` answers (merge, send back, discard) and each one's reason. `tests/cards.test.ts`, written first and seen failing, holds every combination of verdicts against the three rules, and the two cards for TR2's verdicts literally as section 5 prints them.
- [DOD-2] (must) Merge is offered only when every `must` item's verdict is passed. One failed or one inconclusive verdict withholds it, and so does a builder that answered `stopped`. Asking for a withheld choice is refused with the reason `draw` gave. `send-back` and `discard` are withheld in this slice, each with a reason that says a later slice builds it.
- [DOD-3] (must) The card's sources. Every verdict line is marked `computed` and cites the step `prove`. No line cites the step `build` or shows anything a builder or a model wrote, other than a path or a name. Each judgement item is a line that says it was not judged. A changed `components/base/<mode>/mode.yaml`, and a changed path under `bay/`, `adapters/` or `schemas/`, each get a line of their own. A card is at most 44 columns as printed.
- [DOD-4] (must) The seven cases of section 4's "Its tests, with no model" in `tests/one-slice.test.ts`, each through the real kernel with the test toolbox: the test answers each skill step, plays the builder by writing files into the worktree, and decides each approval. Proof is a stand-in mode the test writes, which answers the verdicts the test put in a file. The worktrees mode is the real `git-worktrees`.
- [DOD-5] (must) What a run leaves behind, for each case, asserted: which branches exist, which worktrees exist, and that the branch a merge goes into holds the builder's files only in case 1. A rejected start card leaves no branch and no worktree.
- [DOD-6] (must) The build skill's words. It says: work only in the folder given; run nothing; search below the folder's top, not at it; when the slice needs what the toolbox or the kernel lacks, stop and answer `stopped` with what is missing; never write outside the declared files. It claims no confinement the kernel does not give (ADR 20 item 2): the write root is the agent's root, and the skill says a builder that ignores it is caught by proof's `scope`, not stopped.
- [DOD-7] (must) The forge mode stays active only when the project is the kit. If that stands in the way of DOD-4 (the toolbox opens a project that is not the kit), use what TT1's report said; if TT1 left it open, run the cases in a copy of the kit through `bay`, as W1's tests do, and say so first in the report.
- [DOD-8] (must) A mode's folder is all this changes (P-34), bar the rows named under Output. Nothing under `bay/`, `schemas/`, `adapters/` or an interface's folder. `tests/new-mode-isolation.test.ts` passes unchanged. Neither debt list grows. The detector count does not rise. `bay check` on the kit has no new error; any new warning is pasted with why it is true.
- [DOD-9] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy that is a git repository. Among them: an inconclusive `must` verdict offers merge; a failed `should` verdict withholds merge; a verdict line marked `ran`; a builder's free text on the card; `carry-out` merges on `keep`; `carry-out` merges a head other than the one proved; the merge goes into the checked-out branch; a rejected start card still cuts a worktree; the declaration's check accepts a file outside the scope; a card line of 45 columns passes. Each caught, or a test added.
- [DOD-10] (must) `npm run check` passes. Size per file, never targeted (P-13). No test waits real minutes; your two test files' time alone.
- [DOD-11] (should) The real thing (P-19), as far as it goes without a model: `./bay.sh run one-slice` on the kit for a slice of plan 0022 up to the start card, the card pasted as printed, then rejected. Nothing is cut.

## Instructions

1. Read the note's sections 4 and 5, then the code it cites. In the progress note, before code (P-35): the type of the cards' input, the three rules as a table, and anything in section 4 that the code no longer matches.
2. `cards.ts` and its tests. A commit.
3. Schemas and `mode.yaml`, then `slice`, `draw`, `carry-out` and the declaration's check, each with its case. A commit each.
4. The workflow and the skills; the seven cases. A commit.
5. Regenerate the debt lists. Inject the bugs. `npm run check`. Commit. Report.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: outcomes, choices and reasons are closed sets in types. P-12: the copy and worktree lifecycle is the worktrees interface's, the verdict rule is proof's; use them, write none of your own. P-15, P-16, P-17. P-25: if the kernel, an interface, the toolbox or the test toolbox lacks what the cut needs, stop and report what is missing with its signature; none of them is yours. P-28: every sentence on a card is read by the owner; write each as he would want to read it on a phone. P-32.
- TypeScript: `components/base/typescript/practices.md`.
- Inconclusive is never a pass. The owner's choice is the owner's: no script decides an approval, and no test helper that decides one may be reachable from a mode's script.
- Forge never gives a toolchain or a command a slice's worktree; proof makes its own copies.
- The merge in a test goes into a branch nobody has checked out. Nothing in this slice merges into, resets or switches the checked-out branch of a project (slice WM1 decides that, after the owner answers).
- No security property of `docs/designs/operations/0-frame.md` or `docs/designs/trust/0-frame.md` is weakened. No sentence of yours says a builder is confined beyond its write root.
- Keep every scratch file under the one folder you are given under `/tmp`. Inject bugs only in a throwaway copy. Never run prettier with `--write` on a folder. Stop a process of your own only by its process id. Commit after every step; keep the progress note current. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; where the note and the code differed; each DOD item with pasted output; the bug table; both cards as printed in case 1; what is done by hand until the later slices, as a table; what you did not do or verify.
