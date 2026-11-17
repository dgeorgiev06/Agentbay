# Brief TR6: trust, slice six: the coordinator knows how trust is given, the session agent's file tools cannot write a mode into the kit's base folder, and the adapter speaks of commands by name

For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr6/adapter-trust`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0006` (the harness adapter), `docs/adr/0019` (commands by name), `docs/adr/0021` (the decision, "What trust is and is not", and "Closed with it": an agent's file tools are stopped from writing into the kit's base folder when the project is not the kit, since a mode placed there needs no trust), `docs/designs/trust/0-frame.md` (the table of who can do what; rows b and c), `B-owner.md` (sections 1 and 6, slice 6 of section 9), the briefs TR3 and TR4.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `adapters/claude-code/README.md`.
- Slices TR1 to TR4 are merged. `bay approve --trust <mode>` without `--via`, where the shell is not a terminal, changes nothing, exits 1, and with `--json` gives the card's lines and the full hash. With `--via chat --hash <full hash> --quote "<the owner's exact words naming the mode>"` it gives trust when the project's config lists chat; `--reject` withdraws the same way. A trusted mode whose scripts changed gets a card of its own with its own hash. `bay check` warns for each mode that waits for trust. An agent's own shell in a skill step is given the commands of base modes only.
- Today the coordinator's text (`adapters/claude-code/coordinator.ts`) tells the session agent how a run's approval is given and says nothing of trust. The guard (`guard-decide.ts`, `guard-paths.ts`) stops the session agent's `Write` and `Edit` into the kit's `bay/`, `schemas/`, `adapters/` and `framework/`, and not into the kit's `components/base/`. Three sentences in the adapter still say "prefix" or "start with" for listed commands, which have been commands by name since ADR 19.

## Output

1. The coordinator's text gains a short block on trust: a mode that waits for trust is the owner's to decide, never the agent's; how the agent shows the owner the card (run the command, show every line of the card unchanged and whole); how the owner's answer is passed on (his exact words, which must name the mode; never words he did not write; never a summary of the card in place of the card); what the agent never does (give trust on its own, write the trust record, edit a mode's list to match a trusted one, suggest the owner skip reading the card). It follows the shape and voice of the block on approvals beside it, and shares its words where the rule is the same.
2. When the project is not the kit, the session agent's `Write` and `Edit` and every other file tool the guard decides for are refused inside the kit's `components/base/`, with a sentence that says why (a mode placed there is granted its list with no trust) and what to do instead (make the mode in the project; the owner trusts it). When the project is the kit, nothing changes: building base modes is the kit's own work.
3. The three sentences that say "prefix" or "start with" say what is true now: a step may run the commands its mode lists by name, each with its listed words followed by plain arguments. No behaviour of the command guard changes; if you find its behaviour no longer matches commands by name, stop and report.
4. The adapter's README says, in its section on what the guard does and does not stop: what the new rule closes; what stays open by design (the session agent's shell is not checked; a pseudo-terminal passes the terminal check; a quote can be invented), in the plain words ADR 21 uses.
5. A report.

Out of scope: any change under `bay/`; a Codex adapter; closing the session agent's shell.

## Definition of done

- [DOD-TR6-1] (must) Output 1: the block pasted at the top of the report (P-28: the owner reads what his coordinator is told). A test pins the block as a literal inside the built coordinator text, and a test shows the built file changes when `bay build` runs again on a project built before this slice.
- [DOD-TR6-2] (must) Output 2, tests first and seen failing, through the guard's entry with literal decisions: `Write`, `Edit` and each other file tool into the kit's `components/base/<new mode>/mode.yaml`, into an existing base mode's script, by a relative path, by a path with `..`, and through a symlink that points there, each refused with the literal sentence when the project is not the kit; each allowed as today when the project is the kit; reads allowed as today in both.
- [DOD-TR6-3] (must) Output 3: `grep -n "prefix\|start with" adapters/claude-code/` pasted, with a line on each remaining hit saying why it is still true. The old and new sentences side by side.
- [DOD-TR6-4] (must) Output 4 pasted. `grep` the adapter's new sentences for "secure", "safe", "cannot", "prevents", "guarantee" and paste the result with a line on each hit.
- [DOD-TR6-5] (must) Nothing else changes: the capture, start and final back to back with a copy of the script that has a scratch folder of your own (and its `here=` line pointing at /home/claude/m5-capture), differs only in the built coordinator text and the built agent files; every differing file named.
- [DOD-TR6-6] (must) Boundaries: the adapter imports the kernel only through the entries the feature map allows; neither debt list grows; the detector count does not rise.
- [DOD-TR6-7] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: the base folder is open when the project is not the kit; it is closed when the project is the kit; a path with `..` gets through; a symlink gets through; `Edit` is checked and `Write` is not; reads are refused; the trust block is missing from the built text; the block tells the agent it may give trust. Each caught, or a test added.
- [DOD-TR6-8] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Read the guard from its entry to its decision, and how it already closes the kit's other folders; the new rule is one more closed area decided in the same place, not a second mechanism (P-12).
3. The guard rule, tests first. Then the coordinator's block. Then the three sentences. Then the README. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr6-capture/`.

## Resources

`adapters/claude-code/coordinator.ts`, `guard-decide.ts`, `guard-paths.ts`, `guard-input.ts`, `guard-commands.ts`, `agent-file.ts`, `README.md`, the adapter's tests under `tests/`, `bay/commands/approve.ts` (read only: the words and flags of the trust command), `bay/layout.ts` (`isProjectTheKit`).

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place. P-15, P-16 literal expected values. P-17 test first, seen failing, before the code. P-25: if you must change course, stop and report. P-28: the coordinator's text and the README are read by the owner. P-29, P-30.
- TypeScript: `components/base/typescript/practices.md`.
- The adapter's words never claim more than the guard does (ADR 21). The guard is a help against mistakes by an agent that means well, and a barrier to a step's agent; it is not a barrier to an agent with the owner's shell.
- The coordinator's text must not teach a way around the card: no example of a filled-in quote that an agent could copy, beyond a placeholder for the owner's words.
- Write scope: `adapters/claude-code/` and its tests. Nothing under `bay/`, `components/` or `schemas/`. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `tests/test-toolbox.ts`, the shared tests and `bay/check-imports.ts`. Do not edit those.
- To stop a check of your own, kill it by its process id. Never use `pkill` or `killall` with a pattern.
- The full check takes thirteen to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr6-progress.md` current. Never pipe a check whose exit status you rely on. Remove anything you make under /tmp that is not named in the report.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the coordinator's block and the refusal sentence; each DOD item with pasted output; the bug-injection table; what the owner should try in his first live session; what you did not do; what you did not verify.
