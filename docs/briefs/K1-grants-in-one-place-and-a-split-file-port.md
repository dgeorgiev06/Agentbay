# Brief K1: the grants shape is built in one place, and the file port is split

Capability slice in the kernel, for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `k1/grants-and-file-port`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0017` (the decision; this is its slice K1) and `docs/research/2026-11-16-boundary-audit.md` (changes 2 and 3).
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0006`, `0009`, `0011`.
- The audit's finding: when throwaway folders were added, the grants shape (`ModeGrants` in `bay/contracts.ts`) gained one field and had to be edited where it is written out as a literal, in about 12 places across the kernel, the adapter's fixture and six test files. The `FileSystem` port (`bay/ports.ts`) gained three methods that only the broker uses, and every fake of the port had to carry them, with stand-ins that reject.

## Output

1. One place in the kernel builds a mode's grants. Every other kernel file that needs grants gets them from there or is handed them. No kernel file outside that place writes the shape out as a literal.
2. One builder for tests gives grants with sensible empty defaults and takes only the fields a test cares about. Every test and fixture that wrote the shape out uses it. Adding a field to the grants shape afterwards changes the place of Output 1, the builder, and the tests that care about the new field, and nothing else. The report proves it by adding a made-up field in a throwaway copy and listing what fails to typecheck.
3. The file port is split along who uses what: the operations only the broker needs for throwaway folders are a port of their own, and a consumer that only reads, lists and writes depends on a port that has no more than that. No fake carries a method its consumer never calls; the stand-ins that reject are deleted.
4. Behaviour is unchanged: the capture is identical.
5. A report.

Out of scope: restructuring broker, scripts or the effect rule (K2 designs that); changing what any grant allows; the toolbox.

## Definition of done

- [DOD-K1-1] (must) Output 1, shown by a search pasted in the report: every place in `bay/` and `adapters/` (tests aside) that constructs grants, before and after.
- [DOD-K1-2] (must) Output 2: the made-up-field experiment in a throwaway copy, with the compiler's list of files, before this slice (on the starting commit) and after.
- [DOD-K1-3] (must) Output 3: each port, its methods, and each consumer and fake of it, as a table. `grep -rn neverUsedByTheAdapter` finds nothing.
- [DOD-K1-4] (must) A test that fails if a kernel file outside the one place writes the grants shape as a literal, or the report shows why the type system already makes that impossible. Written first and seen failing where it is a test.
- [DOD-K1-5] (must) The capture script, run on the starting commit and on your final commit, shows no difference. `diff -r` is pasted, empty.
- [DOD-K1-6] (must) No test is weakened: the report lists every test file edited and, for each, that its assertions are unchanged. No test is deleted unless what it tested no longer exists, and then the report says what.
- [DOD-K1-7] (must) Boundaries: neither debt list grows, and the report says whether either shrank. Every new file is placed in the feature map where it belongs. The copy-paste detector count for non-test TypeScript does not rise above your starting measure.
- [DOD-K1-8] (must) Bug injection (P-18, P-31): at least 8 bugs, one at a time, in a throwaway copy, with time limits and results saved as you go, each in code this slice moved or rewrote. Each is caught, or a test is added, or the report proves no test can catch it. The working tree is clean at the end.
- [DOD-K1-9] (must) `npm run check` passes. Size before and after is reported per file and never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit, in the foreground, and wait for it. Record test count, time, kernel line count, both debt counts by rule, and the detector count. Run the capture on the starting commit and keep it outside the repo.
2. Find every place grants are constructed and every consumer and fake of the file port. Write the two lists in the progress note.
3. Grants: the one place, then the test builder, then each call site, a commit per group.
4. The file port: the split, then each consumer and fake. Commit.
5. The experiment of DOD-K1-2. Regenerate the debt lists and read the diff. Inject the bugs in a copy. Capture and diff. `npm run check`. Commit. Report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule: <name>" framework/feature-map-debt.yaml` counts a rule.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- A throwaway copy: `git archive <commit> | tar -x -C <new folder>`, then link `node_modules` into it, and `git init` it if needed.
- The capture: `/home/claude/m5-capture/capture.sh <kit folder> <output folder>`; read the script first. Write your outputs under `/tmp/k1-capture/`.

## Resources

`bay/contracts.ts`, `bay/policy.ts`, `bay/ports.ts`, `bay/node-ports.ts`, `bay/broker.ts`, `bay/check-context.ts`, `bay/commands/secret.ts`, `bay/manifests/grants.ts`, `tests/fakes.ts`, `tests/broker-fixture.ts`, `tests/policy.test.ts`, `adapters/claude-code/tests/`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types. P-11 replace and delete: no old shape kept beside the new one. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing, for anything new. P-25: if you must change course, stop and report. P-29 one meaning per word. P-30 plain prose.
- TypeScript: `components/base/typescript/practices.md`. A port is justified only by its consumers; do not add a port nobody needs.
- This slice changes only kernel and adapter code and their tests. It changes no mode and no interface under `components/`. If it seems to need to, stop and say so at the top of the report.
- Another builder is working in a different worktree on the feature map, `tests/build.test.ts`, `tests/kit-check.test.ts`, `package.json` and the modes' tests. Do not edit those files; if you must, make the smallest edit and name it at the top of the report.
- The machine is shared with that builder, so runs are slower. A test that fails on a time limit is run again alone before it is believed.
- The session has been stopped without warning several times. Commit after every step that passes typecheck and its tests, and keep `/tmp/k1-progress.md` current: what is done, what is next, each decision. Run long commands in the foreground. Never pipe a check whose exit status you rely on.
- Small commits, each passing typecheck, lint, format and both dead-code runs.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; items that could not both be met; each DOD item with pasted command output as evidence; the bug-injection table; what you did not do; what you did not verify.
