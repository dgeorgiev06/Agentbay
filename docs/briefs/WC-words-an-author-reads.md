# Brief WC: words a mode's author reads: the field's sentence, a shared test that is really run, and two descriptions

Four small outputs, one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `wc/author-words`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0019`, `docs/adr/0020` (item 3 is output 1; items 2 and 4 explain outputs 3 and 4), `docs/designs/operations/B-mode-author.md` (what a mode's author reads when a request is malformed), `framework/practices.md`, `components/base/typescript/practices.md`, `CONTEXT.md`.
- Today, `shownToAuthor` in `bay/broker/operations.ts` answers a malformed request with one fixed sentence and an unread answer with another, whatever was wrong. The misreading it is given already carries the problem.
- Today, `bay check` (in `bay/check-imports.ts`) counts a test of a mode as running its interface's shared test when the test imports the shared test's file, even when the import is type-only and nothing is called.
- `schemas/mode.schema.json` describes a command's `run` as "the program, then its fixed arguments", which is no longer true for a mode that gives `commandsStartWith`.
- `CONTEXT.md` defines Throwaway folder and does not define the throwaway copy that `toolchain@1` now speaks of.

## Output

1. A script that sends a malformed request reads which field was wrong and what was expected of it, in a sentence: the field's path as the author wrote it, and the expectation from the shape in the table of operations. The same for an answer the toolbox could not read. No value from the request is echoed (a value may be a secret); the report states how that is held by a test. The two fixed sentences are deleted unless one is still the right words for a case with no field.
2. `bay check` counts a shared test as run only when a test of the mode imports a value from it (not a type-only import, not `import type`, not an import whose every name is marked `type`). Its fix sentence says what running the shared test needs: a test file that calls the shared test's function with the mode. A side-effect import (`import "…/shared.ts"`) is not a call either; say in the report how you treat it and why.
3. The description of `run` in `schemas/mode.schema.json` is true for both cases: with and without `commandsStartWith`. The owner reads this sentence; propose it at the top of the report with the old one beside it. Generated types follow.
4. `CONTEXT.md` gains Throwaway copy (the folder a caller makes for a toolchain's check or test and removes afterwards), with what it is not (a Throwaway folder; a worktree a builder works in) and the synonyms not to use.
5. A report.

## Definition of done

- [DOD-WC-1] (must) Output 1, tests first and seen failing, literal expected sentences: for at least one operation of each of the five entry files, a missing field, a field of the wrong type, an unknown field and a nested field each give their literal sentence; a request whose wrong value is a marker string never shows the marker anywhere the author or the journal reads; an unread answer gives its literal sentence.
- [DOD-WC-2] (must) Output 2, tests first and seen failing: a made-up mode whose only use of the shared test is `import type` gets the finding, with the literal fix sentence; so does one that imports only names marked `type`; one that imports the function and calls it gets none; every mode in the kit still gets none. Say whether the check can tell "imported the function and never called it" and, if not, say so in the fix sentence's test rather than pretending.
- [DOD-WC-3] (must) Outputs 3 and 4 pasted in the report. `bay check` on the kit prints the same findings as before.
- [DOD-WC-4] (must) Nothing else changes: the capture, start and final back to back with a copy of the script that has a scratch folder of your own, differs only where a fixture sends a malformed request; each differing file named.
- [DOD-WC-5] (must) Boundaries: manifests, runs and broker stay sealed; neither debt list grows; the detector count does not rise.
- [DOD-WC-6] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy that is a git repository, with time limits and results saved as you go. Include: the sentence names the wrong field; the sentence echoes the value; the nested path loses its parent; an unread answer shows the request's sentence; a type-only import counts as run; names marked `type` count as run; a value import stops counting. Each caught, or a test added.
- [DOD-WC-7] (must) `npm run check` passes. Size before and after per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, debt counts by rule, detector count.
2. Output 1, tests first. Output 2, tests first. Outputs 3 and 4. A commit each.
3. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/wc-capture/`.

## Resources

`bay/broker/operations.ts` (`shapes`, `shownToAuthor`, `Misreading`), `bay/guards.ts` or wherever the problem of a misreading is made, `bay/sdk.ts`, `tests/toolbox-surface.test.ts`, the broker's tests, `bay/check-imports.ts`, `bay/import-scanner.ts`, their tests, `tests/made-up-*.ts`, `schemas/mode.schema.json`, `bay/generated/`, `CONTEXT.md`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-11 replace and delete. P-12 one place: the sentence for a field is made in one function. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-28: the sentences in outputs 1 to 3 are read by an author or the owner; propose them at the top of the report.
- TypeScript: `components/base/typescript/practices.md`.
- Never echo a request's values in a sentence, a journal entry or a log.
- Write scope: `bay/broker/operations.ts` and the file where a misreading's problem is made, `bay/check-imports.ts`, `bay/import-scanner.ts`, `schemas/mode.schema.json`, generated types, tests, `CONTEXT.md`. Anything else is named at the top of the report with its reason.
- Another builder is working in a different worktree on `bay/policy.ts`, `bay/contracts.ts`, `bay/manifests/`, `bay/broker/broker.ts` and the check feature's findings about listed commands. Do not edit those; if `bay/check-imports.ts` is not enough for output 2, stop and report.
- The full check takes twelve to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again.
- Commit after every step that passes typecheck and its tests; keep `/tmp/wc-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first, with the proposed sentences; each DOD item with pasted output; the bug-injection table; what you did not do; what you did not verify.
