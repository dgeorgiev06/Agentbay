# Brief S1: the scrubber knows every declared secret from the start

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `s1/scrubber-knows-secrets`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0003`, `docs/adr/0005`, `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml` (the `secrets` feature).
- The fault, found in slice R5a: a kernel process redacts only the secrets it has handed out to a script in that same process. Each `bay` command is a fresh process. So a process that shows or stores text holding a secret, without a script having asked for that secret first, shows and stores it in clear. Seen with `bay approve` on an approval whose content is a setting that holds a secret's text: `bay call` and `bay runs` printed `[redacted:NOTES_TOKEN]`, `bay approve` printed the value, and stored it.
- The reviewer's decision: the scrubber learns the value of every secret that an active mode declares in `resources.secrets`, before any text is shown or stored. Redaction no longer depends on what happened earlier in the process. Settling an approval from the stored copy was rejected, because it loses the check that catches changed content.

## Output

1. When a kernel is opened, the secrets feature knows the value of every secret declared by an active mode that is set. A secret that is declared and not set is skipped without a problem.
2. Redaction of text, JSON values and JSON keys uses that full set, in every process.
3. Handing a secret to a script is unchanged: only a mode that declares it may get it, through the broker.
4. A report.

## Definition of done

- [DOD-S1-1] (must) A test at the command line, written first and seen failing: a workflow whose approval shows a setting holding a secret's text is run with `bay call`, shown with `bay runs <id>`, and approved with `bay approve`. No output of the three holds the secret's text, and the run ends done. Each command is a separate kernel in the test, as it is for an owner.
- [DOD-S1-2] (must) A test at the secrets feature's entry file: a fresh secret store over an environment that holds two declared secrets redacts both in text, in a JSON value and in a JSON key, with no hand-out first.
- [DOD-S1-3] (must) A declared secret that is not set does not stop the kernel from opening and is reported by `bay secret check` exactly as today. A test shows both.
- [DOD-S1-4] (must) A secret no active mode declares is not read. A test shows the store asked only for declared names.
- [DOD-S1-5] (must) A value too short to redact safely keeps today's behaviour: it is refused at hand-out with the same sentence. The test that shows this passes without an edit to its assertion.
- [DOD-S1-6] (must) Where the set of known secrets is built is one place (P-12). The report names it. The two `redactJson` functions (`bay/secrets.ts` and `bay/runs/scrubbed-store.ts`) become one, owned by the secrets feature and reached through its entry file; the report shows the other is deleted.
- [DOD-S1-7] (must) The cost is measured and reported: the time of `bay runs` in a project with 0, 1 and 5 declared secrets, before and after, on this machine with secrets in the environment. The report says what the cost would be on macOS, where each secret is one keychain call, as an estimate labelled as one.
- [DOD-S1-8] (must) `npm run check` passes. Neither debt list grows; if moving `redactJson` removes a debt entry, the report says which. The copy-paste detector count for non-test TypeScript (20 at the start) does not rise. Size before and after is reported and never targeted (P-13).
- [DOD-S1-9] (must) Proven on the real thing (P-19): in a fresh project under `/tmp`, a mode that declares `NOTES_TOKEN`, a made-up value set in the environment variable the kernel reads, a setting that holds that value's text, and a workflow whose approval shows the setting. Run `bay call`, `bay runs <id>`, `bay approve`, then `bay runs <id> --events`. Paste commands and output. The value's text appears nowhere. Delete the project.
- [DOD-S1-10] (must_not) The kernel never writes a secret's value to a file, a database, an event or a log, and never passes it to a child process that did not ask for it through the broker. The report says how each was checked.

## Instructions

1. Run `npm run check` before any edit. Record test count, kernel line count, both debt counts, the detector count, and the timings for DOD-S1-7.
2. Write the tests for DOD-S1-1 and DOD-S1-2 and see them fail.
3. Make the secret store learn the declared set when the kernel opens. Keep hand-out as it is.
4. Move JSON redaction to one function in the secrets feature. Delete the other.
5. Write the tests for DOD-S1-3 to DOD-S1-5.
6. Inject at least 10 bugs, one at a time. Record what caught each. Add a test for any survivor, or prove none can.
7. Measure. Walk the real thing. Run `npm run check`. Commit. Write the report.

## Tools

- `npm run check` and its parts; `node --test <file>`; `git` (commit only; never push).
- Kernel line count: `find bay -name '*.ts' -not -path 'bay/generated/*' | xargs cat | wc -l`
- Debt: `FEATURE_MAP_DEBT=write node --test tests/feature-map.test.ts` regenerates the file; `grep -c "rule:" framework/feature-map-debt.yaml` counts entries.
- Copy-paste detector: `npx --yes jscpd@4 bay adapters components --format typescript --ignore "**/generated/**,**/tests/**,**/node_modules/**,**/templates/**" --min-tokens 35 --min-lines 4 --reporters console` (the last line gives the count).
- The kit's command from inside a project folder: the full path to `bay.sh` in your worktree.
- Timing: `time` around the command, five runs each, report the middle value.

## Resources

`bay/secrets.ts`, `bay/secret-patterns.ts`, `bay/kernel.ts`, `bay/policy.ts`, `bay/runs/scrubbed-store.ts`, `bay/commands/secret.ts`, `tests/secrets.test.ts`, `tests/runs-scrub.test.ts`, `tests/runs-fixture.ts`, `tests/cli-owner.test.ts`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-08 the secrets feature is reached through its entry file. P-11 replace and delete. P-12 one place. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report.
- TypeScript: `components/base/typescript/practices.md`. A private class member is written `#name`.
- In tests and in the report, use made-up secret values. Never read or print a real secret. On this machine secrets come from environment variables named `AGENTBAY_SECRET_<NAME>`; set only made-up values, only in the test's or the walk's own environment.
- Small commits, each passing typecheck, lint, format and both dead-code runs. Say in the report if any commit does not pass the full suite on its own.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`.
- Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: each DOD item with pasted command output as evidence; every test file edited and why; the same thing in more than one place; the bug-injection table; ways a secret could still be shown or stored; what you did not do; what you did not verify.
