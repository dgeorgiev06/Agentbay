# Brief F1: enforce the feature map

Slice for one builder. Words are used as `CONTEXT.md` defines them.

## Input

- Branch `f1/feature-map`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `framework/features.yaml`: the reviewer's proposed map of 14 kernel features and what sits outside the kernel.
- `CONTEXT.md` and `docs/adr/0006`, `0007`, `0009`.
- `docs/plans/0022-typescript-port.md`: DOD-1 to DOD-11 (near line 101) and "Features are deep modules".
- `docs/proposals/0022-typescript-port.md`: "Code standards".

## Output

1. A test, `tests/feature-map.test.ts`, that reads `framework/features.yaml` and the real import statements and fails when the map is broken.
2. `framework/feature-map-debt.yaml`: the list of imports that break the map today, each as `from`, `to` and `rule`.
3. The dead-code configuration with no exemptions, and a second dead-code run that does not count tests as users.
4. The stored step status `finished` replaced by `done` everywhere, with no translation left.
5. A report (see Rules).

No file moves into a folder in this slice. No feature is deepened in this slice.

## Definition of done

- [DOD-F1-1] (must) The test fails when a kernel file under `bay/` is in no feature or in two.
- [DOD-F1-2] (must) The test fails when a file imports from a feature its own feature may not import.
- [DOD-F1-3] (must) The test fails when a file imports another feature's private file.
- [DOD-F1-4] (must) The test fails when anything outside the kernel imports a kernel file other than the one named in `imports_kernel_through`, and when a kernel file imports from `adapters/` or `components/`.
- [DOD-F1-5] (must) An import listed in the debt file does not fail the test. An entry in the debt file that no longer matches a real import fails the test, so the list can only shrink.
- [DOD-F1-6] (must) The debt file is produced by the test's own scan, not by hand. Its count is in the report, split by rule.
- [DOD-F1-7] (must) The import scan reuses `bay/import-scanner.ts`. No second scanner is written.
- [DOD-F1-8] (must) `ignoreIssues` is gone from the dead-code configuration. Whatever it then reports is deleted, not exempted.
- [DOD-F1-9] (must) `npm run check` runs dead-code detection a second time with test files not counted as users. Whatever only tests use is deleted together with those tests, or listed in the report with the reason it is a private seam.
- [DOD-F1-10] (must) No code path maps `finished` to `done` or back. The stored value is `done`.
- [DOD-F1-11] (must) The kernel's line count (`bay/`, generated types excluded) is lower at the end than at the start. The report gives both numbers and the lines deleted per file.
- [DOD-F1-12] (must) DOD-1, 2, 4, 7, 8, 9 and 11 of the plan hold.
- [DOD-F1-13] (must_not) No change to what any `bay` command does or prints, other than `done` already being shown.
- [DOD-F1-14] (should) Where you believe the map is wrong rather than the code, say so in the report with the import and your reason. Do not edit `framework/features.yaml`.

## Instructions

1. Read the inputs. Run `npm run check` and record the test count and the kernel line count.
2. Write the test first, with small made-up maps and file sets as its cases, so each rule is shown failing. Then point it at the real kit.
3. Generate the debt file. Read it. Note where the map looks wrong.
4. Remove the dead-code exemptions. Delete what is reported. Add the second run. Delete what it reports, or justify it.
5. Change the stored status to `done`. Delete the translation.
6. Inject at least 12 bugs, one at a time, into the test's rules and into the status change. Record which test caught each. Add a test for any survivor.
7. Run `npm run check`. Commit. Write the report.

## Tools

`npm run check` and its parts, `node --test <file>`, `git` (commit only; never push, never touch `main` or another worktree).

## Resources

`bay/import-scanner.ts`, `components/base/typescript/knip.json`, `package.json` scripts, `bay/sqlite-run-store.ts`, `bay/step-detail.ts`.

## Rules and constraints

- Replace and delete, never layer (`docs/adr/0009`). No shim, alias or re-export.
- Readability before line counts. Never pack lines or drop handling to reach DOD-F1-11; reach it by deleting what is unused.
- Code standards: no `any`, no `as` except `as const`, no `!`, no enum, no inheritance, named exports, at most three parameters, complexity 10, problems as values, no comments.
- Small commits. Any change to a shared type goes in its own commit and is listed first in the report.
- Never read or print secrets.
- Report, in plain English and short sentences: each DOD item with pasted command output as evidence; changed shared types as code; every existing test file edited or deleted and why; deletions with line counts; the bug-injection table; ways each new rule can still be got around; what you did not do; what you did not verify.
