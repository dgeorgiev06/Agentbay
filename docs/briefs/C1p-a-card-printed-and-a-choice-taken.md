# Brief C1p: the command line prints an approval's card as lines, and `bay approve` takes a choice

Capability slice in the command line. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `c1p/card-printed`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0022` (questions 1 and 2), `0015` (two approvals on honest cards), `0009`, `0021` (the trust card: 44 columns, a long word wrapped and never cut, characters that could redraw a terminal shown harmlessly).
- `docs/designs/proof/C1r-what-an-approval-shows.md` (what the runs entry returns for a waiting approval: `card`, `choices`, `content`, the hash; what a decision takes), `C-seams.md` section 3 (the two cards drawn for slice TR2: the form to print), `docs/plans/0022-forge-in-waves.md` (this is slice C1p; F1 is the first workflow whose card an owner reads).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- Slice C1r is merged. A waiting approval may carry a checked `card` (title, lines with mark, words and source, the kernel's counts, and for a judged line the skill and tier the kernel added) and `choices` (each offered, or withheld with a reason). The runs entry takes a decision with a `choice`. Today the command line prints an approval's content as indented JSON (`bay/run-report.ts`), and `bay approve <run> <stepKey> --hash …` sends approve or reject, so an approval with choices cannot be answered from the command line: it is refused with "offers choices, so a decision names one of them".
- `bay/trust-card.ts` already wraps lines to 44 columns and shows unsafe characters harmlessly.

## Output

1. **A card is printed as a card.** Where a run waits on an approval whose content is a checked card, every place the command line shows that run (`bay call`, `bay resume`, `bay runs show`, `bay approve` when it changes nothing) prints: the title; each line with its mark in a fixed left column and its words; for the lines of one judged step, one line after them saying which skill judged and at which tier, in the kernel's words; the choices, each with its name and what it does, a withheld one with "not offered:" and its reason; the kernel's counts of lines checked per mark; the hash in its short form; and the command to decide. At most 44 columns; a long word is wrapped and never cut; characters that could redraw a terminal are shown harmlessly. One function draws it, and the wrapping and the harmless showing are the trust card's, shared, not copied (P-12).
2. **Only the card is printed.** The raw content beside a card is never printed in the human form. An approval with choices and no card prints its content as today, then the choices. An approval with neither prints exactly as today.
3. **What a choice does.** The line beside each choice's name comes from the workflow: decide where (a sentence per choice in the workflow file, beside `when`), add it to the schema with its sentence, and require it for every choice, so that an owner never reads a bare name. If that needs a change in runs beyond passing the sentence through, stop and report (runs is another slice's this wave).
4. **`bay approve` takes the choice**: `bay approve <run> <stepKey> --choice <name> --hash <hash>`, at a terminal with the owner's typed confirmation as today, or from chat under the same rules approvals already have. A withheld or unknown choice prints the kernel's sentence and exits non-zero. `--reject` with `--choice`, `--choice` on an approval without choices, and no `--choice` on one with choices each have a sentence. `--json` gives the card, choices and hash in the shape the runs entry returns, with no drawing.
5. **The coordinator's text** (`adapters/claude-code/coordinator.ts`) says how an approval with choices is answered: show the owner every line of the card unchanged and whole, wait, pass on the choice the owner names in his own words; never choose for him, never pass a withheld choice. `tests/coordinator-commands.test.ts` runs the new command as written against a real stopped run.
6. Usage and `--help` name the new form. `CONTEXT.md` only if a word is added.
7. A report.

Out of scope: any forge workflow; the model's name on a judged line (the kernel does not know it yet; print the skill and the tier and never a model); `bay/runs/` beyond output 3's note.

## Definition of done

- [DOD-C1p-1] (must) Output 1: the merge card of `C-seams.md` section 3, rebuilt as a fixture with this kernel's field names, printed and pinned as one literal string, and pasted at the top of the report (P-28). Tests, first and seen failing: no line over 44 columns for a line of 200 characters with every word present in order; a withheld choice's reason wrapped; escape characters shown harmlessly in words, title, a choice's sentence and a reason; the short hash is a prefix of the full hash; the judged line's skill and tier come from the kernel's field and a card whose line lacks them prints what the kernel gave and invents nothing.
- [DOD-C1p-2] (must) Output 2: the three forms pinned as literals; a test that a marker string placed only in the raw content of an approval with a card appears nowhere in the human output of any of the four commands.
- [DOD-C1p-3] (must) Outputs 3 and 4, tests first and seen failing, through the command line with literal output and exit status: each choice taken; withheld; unknown; the three misuse sentences; a stale hash; not a terminal; chat off; chat with the owner's words recorded. Every existing approve test passes unchanged, listed.
- [DOD-C1p-4] (must) Output 5: the coordinator's new lines pasted; the test fails when the sentence loses `--choice`.
- [DOD-C1p-5] (must) Nothing else changes: the capture, start and final back to back with a copy of the script under your scratch folder (its `here=` line pointing at /home/claude/m5-capture), differs only in usage text; every differing file named.
- [DOD-C1p-6] (must) Boundaries: runs, manifests and broker stay sealed; the card's drawing is a private file of the command-line feature; neither debt list grows; the detector count (your own before and after with one command, pasted) does not rise; no new command (the limit on commands holds).
- [DOD-C1p-7] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy that is a git repository: the raw content is printed beside the card; a withheld choice is printed as offered; a withheld choice's reason is dropped; a line's mark is dropped; a long word is cut; an escape character is printed raw; the judged line names a model; `--choice` is ignored and the first choice taken; a withheld choice is sent to the kernel as approve; approve without `--choice` takes a default; the hash printed is of the card and not of the content the kernel bound. Each caught, or a test added.
- [DOD-C1p-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count with its command.
2. Read how a run's waiting state reaches each of the four commands, and how the trust card is drawn. Write in the progress note the one drawing function's input and where the shared wrapping lives, before code (P-35).
3. The card's drawing as a pure function, tests first. Then the four commands. Then the choice's sentence in the workflow. Then `bay approve --choice`. Then the coordinator. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools".

## Resources

`bay/run-report.ts`, `bay/commands/approve.ts`, `call.ts`, `resume.ts`, `runs.ts`, `bay/trust-card.ts`, `bay/runs/runs.ts` (the entry's types for a waiting approval and a decision; read only), `schemas/workflow.schema.json`, `adapters/claude-code/coordinator.ts`, `tests/coordinator-commands.test.ts`, `tests/approval-card-kit.test.ts`, `tests/runs-cards.test.ts`, `tests/runs-choices.test.ts`, `tests/approve-trust.test.ts`, the tests of `bay approve`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05: what a command decided is a closed set, each with its sentence. P-11 replace and delete. P-12 one place: the drawing; the wrapping; the harmless showing. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-19: say in the report exactly what the owner should try at a terminal and from his phone. P-25: if you must change course, stop and report. P-28: every line here is read by the owner. P-29, P-30. P-35.
- TypeScript: `components/base/typescript/practices.md`.
- The command line draws only what the kernel checked. It adds no words of its own to a line, reorders nothing, and drops nothing. It never prints a model's name it was not given by the kernel.
- An approval remains the owner's decision. Nothing here lets a script or an agent decide one; the rules for a terminal and for chat are the ones approvals already have, reused and not copied.
- Write scope: `bay/run-report.ts`, `bay/commands/` (approve, and the three that show a run only where they call the report), a new private file for the card's drawing, `bay/trust-card.ts` only to share the wrapping, `schemas/workflow.schema.json` and generated types for the choice's sentence, the place in `bay/manifests/` that checks a workflow if the sentence is required there, `adapters/claude-code/coordinator.ts` and its tests, tests, the feature map. Anything else is named at the top of the report with its reason.
- Other builders are working in different worktrees on `bay/runs/action-steps.ts`, `bay/broker/`, `schemas/mode.schema.json`, the typescript mode and the toolchain interface. Do not edit those.
- Keep every scratch file of yours under one new folder, `/tmp/c1p/`. Do not create, overwrite, move or delete anything else under `/tmp`. If a command is refused or asks for permission, choose another way and note it.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- Start long runs with nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/c1p/progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the card as printed and every new sentence; each DOD item with pasted output; the bug-injection table; what the owner should try; what F1 needs to know; what you did not do; what you did not verify.
