# Brief C1r: an approval names its choices, the kernel withholds one whose rule is false, and the kernel checks where each line of a card came from

Capability slice in runs. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `c1r/choices-and-card`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022` (the decision: questions 1 and 2), `docs/adr/0015` (two approvals on honest cards; choices are named options; a builder's own words never appear), `docs/adr/0009` (approvals, bound to the content shown), `docs/adr/0021`.
- `docs/designs/proof/0-frame.md` (properties V1 to V7 and S, M, T it restates), `C-seams.md` section 3 (the workflow's `choices`, `when` and `quotes`; what the kernel checks; the two cards drawn for slice TR2), `comparison.md` (question 2: the middle answer was chosen; the search of a command's output for a line's words was offered and not chosen), `A-smallest.md` section 3 for what an approval is today.
- `docs/plans/0022-forge-in-waves.md`: this is slice C1r. C1p (the command line prints a card as lines and `bay approve` takes the choice) and C3 come after it and are not built here. F1 is the first workflow that uses choices.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Today a workflow's approval step shows content and is approved or rejected, bound to the hash of what was shown. The runs feature is sealed behind its entry.

## Output

1. **Choices.** A workflow's approval step may name choices, each with an optional rule that refers to an earlier step's output and must be true or false. With no choices, an approval works exactly as today (approve, reject), and every existing workflow and test is unchanged. The schema's sentences say what a choice and a rule are.
2. **Withholding.** When the run reaches the approval, the kernel evaluates each rule. A choice whose rule is false is withheld. The shown content must then carry a reason for each withheld choice, a sentence a script wrote; a withheld choice with no reason fails the step. A rule that is not true or false, or refers to nothing, fails the step with a sentence: it is never treated as true.
3. **Deciding.** The runs entry takes a decision that names a choice. A withheld choice is refused with its reason and nothing changes. An unknown choice is refused with the names of those offered. The choice taken is recorded with the approval (who, how, when, the hash) and is readable by later steps of the workflow, so a workflow can branch on it. The hash binds what the design says it binds, and a decision whose hash is of other content is refused as today.
4. **A card and its lines.** The shown content of an approval may be a card: a title and lines, each with a mark (ran, computed, judged), words, and a source. Before the kernel shows a card it checks each line: a line marked computed cites a step of this run whose action ran no skill; a line marked judged cites a skill step that the approval lists as one it may quote, and the kernel itself adds which model that step ran with; a line marked ran cites a command the kernel recorded in this run or a run it called. A card that breaks a rule is not shown: the step fails and the sentence names the line and the rule. The kernel does not compare a line's words with a command's output. Use the design's names for the marks unless `CONTEXT.md` or the code's own words forbid them, and say which you chose.
5. What the kernel counted is part of what it shows: how many lines of each mark it checked. It is drawn by the kernel and is not part of the hash.
6. `CONTEXT.md` gains Choice, Withheld choice, Mark (of a card's line), with synonyms not to use. A short note in `docs/designs/proof/` for C1p and F1: the shape of the content a script hands the kernel, and what the entry returns for a card.
7. A report.

Out of scope: how the command line prints a card and `bay approve --choice` (C1p; until then the command line may print the card's content as it prints an approval's content today, and the entry is tested directly); the count of test runs (C3); any forge workflow.

## Definition of done

- [DOD-C1r-1] (must) Outputs 1 to 3, tests first and seen failing, through the runs entry with literal expected values: a workflow with four choices where two have rules; each choice taken and read by a later step; a withheld choice refused with its literal reason; an unknown choice; a rule that is a string, a number, missing, or refers to a step that did not run, each failing the step with its literal sentence; a withheld choice without a reason; a decision with a stale hash. An approval with no choices behaves as before: every existing approval test passes unchanged, listed.
- [DOD-C1r-2] (must) Output 4, tests first and seen failing, each with the literal sentence: a computed line citing a skill step; a judged line citing a skill step the approval does not list; a judged line citing a script step; a ran line citing no recorded command; a ran line citing a command of another run that this run did not call; a line with an unknown mark; a line citing a step that does not exist. The model's name on a judged line comes from the kernel and a name the script supplied is ignored or refused (say which, and why). A card with every line sound is shown with the kernel's counts.
- [DOD-C1r-3] (must) A builder's words cannot reach a card: a workflow test in which a skill step that the approval does not list returns text, and a script tries to put that text on a card as computed and as judged; both fail. State in the report what still could carry such words onto a card (for example a script step that copies a skill step's output into its own) and whether the kernel sees it; do not claim more than the check does.
- [DOD-C1r-4] (must) Durable: a run stopped at an approval with choices, the process ended, and resumed, offers the same choices with the same withheld reasons and the same hash; rules are not evaluated again against changed state. Test it.
- [DOD-C1r-5] (must) Nothing changes for the kit: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), shows no difference, or each differing file is named and explained.
- [DOD-C1r-6] (must) Boundaries: runs, manifests and broker stay sealed; what the workflow schema gains is the only change outside `bay/runs/` and the place workflows are loaded; neither debt list grows; the detector count does not rise; the limit on concepts holds.
- [DOD-C1r-7] (must) Bug injection (P-18, P-31): at least 14 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: a false rule offers the choice; a rule that is not a boolean counts as true; a withheld choice is accepted; the choice taken is not recorded; the choice is not readable by a later step; the hash ignores the withheld reasons; a computed line from a skill step is accepted; a judged line from an unlisted skill is accepted; a ran line with no command is accepted; the model's name is taken from the script; a broken card is shown anyway; rules are evaluated again on resume; an approval without choices changes behaviour. Each caught, or a test added.
- [DOD-C1r-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read the runs feature from its entry: how an approval step stops a run, what is stored, what the hash covers, how a decision resumes it, and how a step's kind and a recorded command are known to the engine. Write in the progress note the types for a choice, a card and a line's source, and where each check goes, before code (P-35). If the engine cannot tell whether a step's action ran a skill, or cannot see a called run's commands, stop and report what it would need.
3. Choices and withholding, tests first. Then deciding. Then the card's check. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/c1r-capture/`.

## Resources

`bay/runs/` (entry `runs.ts`, the engine, the store), `schemas/workflow.schema.json` and its generated types, `bay/manifests/` where a workflow is loaded and its references checked, `bay/commands/approve.ts` and `bay/run-report.ts` (read only: C1p changes them), `bay/contracts.ts`, the tests of approvals and of runs, `tests/system-fixture.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: marks, sources and the outcome of a decision are closed sets, matched exhaustively. P-11 replace and delete. P-12 one place: the check of a card. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if you must change course, stop and report. P-28: every sentence here is read by the owner or a workflow's author. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- Fail closed: any doubt about a rule or a line's source fails the step. Nothing is shown that was not checked.
- The kernel's own words claim only what the check does: it knows the kind of step a line cites. It does not know whether the words are true.
- No security property of `docs/designs/operations/0-frame.md` or `docs/designs/trust/0-frame.md` is weakened. An approval remains the owner's decision; nothing here lets a script or an agent decide one.
- Write scope: `bay/runs/`, `schemas/workflow.schema.json` and generated types, the place in `bay/manifests/` that checks a workflow's references, `bay/contracts.ts` for shared types, tests, the feature map, `CONTEXT.md`, the one note. Nothing under `components/`, `adapters/`, `bay/commands/` or `bay/broker/`. Anything else is named at the top of the report with its reason.
- Other builders may be working in different worktrees on `components/base/interfaces/proof/`, `tests/made-up-proofs*`, the typescript mode, `adapters/claude-code/coordinator.ts` and `bay/broker/other-operations.ts`. Do not edit those. Two of you may add rows to `CONTEXT.md`; add yours at the end of the table.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/c1r-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with every new sentence; where the design did not fit the engine; each DOD item with pasted output; the bug-injection table; what C1p, C3 and F1 need to know; what you did not do; what you did not verify.
