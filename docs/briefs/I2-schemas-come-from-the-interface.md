# Brief I2: an action that implements an interface takes its schemas from the interface

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `i2/interface-schemas`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (this is its slice I2), `docs/adr/0013` (manifests is one sealed feature), `docs/research/2026-11-16-boundary-audit.md` (change 6), `docs/adr/0009`, `0011`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`.
- The audit's finding: 46 schema files, 2,677 lines, are the same byte for byte in `components/base/interfaces/<name>/` and in the `schemas/` folder of each mode that implements the interface. `bay/manifests/implements-problems.ts` requires the two to be equal, so every change to an interface is made twice.

## Output

1. When a mode implements an interface, each of its actions that the interface names takes its input and output schemas from the interface. The mode's manifest does not give `input` or `output` for such an action, and `bay check` reports an error with a fix if it does. An action the interface does not name gives its own schemas, as today.
2. Everything that reads an action's schemas gets them through the manifests feature's entry exactly as before (`system.action(...)`, its `input` and `output` with `check`): callers do not learn where a schema came from. No file outside `bay/manifests/` changes for this, except where the report shows it had to.
3. Every mode of the kit that implements an interface has its copied schema files deleted and its manifest changed to match. The equality check and its wording are deleted, since there is nothing left to compare (P-11).
4. `bay new` makes a mode or action that follows the rule when it is given an interface to implement.
5. What an owner or an agent sees is unchanged apart from the rule itself: `bay actions`, a run's input and output checks, refusal sentences. The capture differs only in the kit's own files and in the removed finding kind.
6. A report.

This slice is the kernel's manifests feature together with a mechanical change to every implementing mode. They go in one slice because the rule and the copies cannot be both present and absent in one commit that passes the kit's check; the report says how the commits are ordered so that each passes.

## Definition of done

- [DOD-I2-1] (must) Tests through the manifests entry, each written first and seen failing, with literal expected values: an implementing action with no schemas of its own has the interface's input and output, and its `check` refuses and accepts as the interface's schema says; an implementing action that gives `input` or `output` is an error with the literal message and fix; an action the interface does not name keeps its own; a mode implementing two interfaces takes each action's schemas from the right one; an interface file missing its schema is reported once, at the interface.
- [DOD-I2-2] (must) `find components -path '*/schemas/*.json' | wc -l` before and after, and a list of every schema file still in a mode's folder with why it stays (its action is not named by an interface, or it is settings).
- [DOD-I2-3] (must) `git grep -n "differs from"` and a search for the equality check show it is gone from `bay/`, with its tests deleted or rewritten; the report names each.
- [DOD-I2-4] (must) Output 2: `git diff --stat` for `bay/` outside `bay/manifests/`, with each file explained, or empty.
- [DOD-I2-5] (must) Output 4: a test of `bay new` for an action of an implemented interface, with the literal manifest text it writes.
- [DOD-I2-6] (must) Every mode's own tests pass unchanged in what they assert. A mode test that read a schema file from the mode's folder now reads it from where it is; the report lists each such edit.
- [DOD-I2-7] (must) The capture script, run on the starting commit and on your final commit: the report names every file that differs and explains it. `bay actions` output for every mode is identical.
- [DOD-I2-8] (must) Boundaries: manifests stays sealed (the feature-map test passes with no new entry); neither debt list grows; the copy-paste detector count does not rise above your starting measure.
- [DOD-I2-9] (must) Bug injection (P-18, P-31): at least 10 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: an implementing action takes another action's schema; input and output are swapped; a mode's own `input` wins silently over the interface's; the error for giving a schema is dropped; `bay new` writes schemas for an implementing action. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-I2-10] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, the detector count, and the schema file count. Run the capture on the starting commit and keep it outside the repo.
2. Read `bay/manifests/` whole, starting from its entry. Write in the progress note where an action's schemas are resolved today and the smallest place the rule can live.
3. The rule, tests first, accepting both forms for now only inside your branch's early commits if that is the only way each commit passes; say so. Then the modes, one commit per mode: delete the copies, change the manifest. Then make giving a schema an error and delete the equality check. Then `bay new`.
4. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/i2-capture/`. Also `./bay.sh check`, `./bay.sh actions <mode>`, `./bay.sh new --help`.

## Resources

`bay/manifests/` (entry `manifests.ts`, `implements-problems.ts`, and the files that resolve schemas), `schemas/mode.schema.json`, `bay/generated/` (regenerated by `npm run generate`, never edited by hand), `components/base/interfaces/`, every mode under `components/`, `bay/commands/new.ts` and the scaffold feature, `tests/manifests*.test.ts`, `tests/inside/manifests/`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete: at the end there is one way, not two. P-12 one place. P-15 the interface is the test surface: tests go through the manifests entry or live under `tests/inside/manifests/`. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose in every sentence an owner reads.
- TypeScript: `components/base/typescript/practices.md`.
- Write scope: `bay/manifests/`, `schemas/mode.schema.json` and what is generated from it, the scaffold and `bay new`, each implementing mode's manifest and schema copies, and tests. Anything else is named at the top of the report with its reason.
- Another builder may be working in a different worktree on `bay/command-line.ts` and the tests of the command line. Do not edit those.
- The machine is shared, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/i2-progress.md` current: what is done, what is next, each decision. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
