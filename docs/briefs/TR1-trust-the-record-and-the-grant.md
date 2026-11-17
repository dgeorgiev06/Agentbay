# Brief TR1: trust, slice one: the record, and a project mode's list granted only when the owner trusts it

Capability slice in the kernel. For one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- Branch `tr1/trust-record`, cut from `feat/0022-agentbay5`, in the worktree you are given.
- `docs/adr/0020` (item 1) and `docs/adr/0021` (the decision), `docs/designs/trust/0-frame.md` (the threat model and what must stay true), `B-owner.md` (the design chosen as the base; this is slice 1 of its section 9, with every type and function it names), `C-defence.md` (the two things taken from it: the broker reads the record again before each command; an agent's own shell is given the commands of the kit's base modes only), `comparison.md`.
- `framework/practices.md`, `components/base/typescript/practices.md`, `framework/features.yaml`, `CONTEXT.md`, `docs/adr/0003`, `0005`, `0006`, `0009`, `0011`, `0013`, `0019`.
- Today: only a mode under the kit's `components/base/` may list commands, give the words its commands start with, or name throwaway folders; `bay/policy.ts` refuses any other mode that does, so the whole project fails to load. The words of a command are resolved in one place, `listedCommandsOf` in `bay/policy.ts`. A mode can be granted the project's `agentbay.config.yaml` as a write path, because the policy protects only `.agentbay/` and `.git/`.
- Where the owner's choices differ from design B as written, the ADR wins: the owner's word in chat may give trust as well as a terminal (slice TR3 builds the giving; this slice only reads the record), and a changed script is reported while the trust stands (slice TR4).

## Output

1. The vocabulary of trust, as types in the kernel where the design places them: a mode's list (its commands by name with their resolved words and effects, the words its commands start with, and the throwaway folders it names), the hash over that list, and the record of trust given (the mode, the list as trusted in full, its hash, when, and how it was given). The hash covers exactly what the design says and is computed in one place; the report states in a sentence what it covers and what it does not (a mode's scripts are not covered, by the owner's decision).
2. The record is a file in the kernel's own folder, `.agentbay/trust.json`, with a guard that reads it and refuses a file it cannot read with a sentence. Two pure functions add an entry and remove one. Nothing in this slice writes the file except tests; the command that writes it is slice TR3.
3. A project's mode that lists commands or names throwaway folders loads. Its list is granted when the record holds trust for that mode with the hash of the list as it stands now, and is empty otherwise, with the reason kept beside the grants (never trusted; trusted, and the list has changed since) so that later slices can say it. A mode under the kit's `components/base/` is granted its list as before, with no record. A project whose mode is not trusted loads and runs everything else.
4. The rules that existed only to refuse a non-base mode's list are deleted, with the sentences that said "only a mode under the kit's components/base/ may list commands" replaced where the same sentence is still needed for something true. `bay check`'s own findings for a waiting mode are slice TR4; in this slice `bay check` must not report an error merely because a project mode lists commands, and the report says what it prints in the meantime.
5. The project's config file joins the paths no mode may be granted to write, beside `.agentbay/` and `.git/`, with a test and a refusal sentence.
6. What the broker does with an empty list is today's behaviour for an unknown command name; the two new refusal sentences are slice TR2. What the harness is given is unchanged in this slice, except that it never includes a command of a project mode: an agent's own shell in a skill step is given the commands of the kit's base modes only, by the owner's decision, with a test.
7. The test toolbox and the kernel's test fixtures can say that a project mode is trusted, in the smallest way that lets this slice's tests be written; the test toolbox's own option for mode authors is slice TR5 and is not built here.
8. `CONTEXT.md` gains the words this adds (at least Trust, and the list a mode is trusted for), each with the synonyms not to use.
9. A report.

Out of scope, each a later slice: the broker's refusals and reading the record again before each command (TR2); `bay approve --trust` and the card (TR3); `bay check`'s findings (TR4); the test toolbox's option (TR5); the adapter's coordinator text (TR6); stopping an agent's file tools from writing into the kit's base folder.

## Definition of done

- [DOD-TR1-1] (must) Output 1 and 2: the types and the guard pasted; tests, written first and seen failing, with literal expected values: the hash of a small list as a literal; the hash changes when a command's name, any word, any effect, the starting words or a throwaway folder changes, and does not change when the order of commands in the manifest changes or when a script changes; a record file that is not JSON, or lacks a field, is refused with its sentence; adding and removing an entry give the literal file text.
- [DOD-TR1-2] (must) Output 3, tests through the manifests entry (`loadSystem`) with literal expected values: a project mode with trust for its current list is granted it; with no record it loads with an empty list and the reason "never trusted"; with a record for an older list it loads with an empty list and the reason that says the list changed; a base mode needs no record; a record for a mode that does not exist changes nothing and is not an error; the rest of the project is granted as before in every case.
- [DOD-TR1-3] (must) Output 4: `grep` for the deleted rules and sentences pasted, empty; every test that expected a non-base mode's list to stop the project is rewritten to what is now true, each listed with its old and new expectation.
- [DOD-TR1-4] (must) Output 5 and 6: the tests, written first and seen failing.
- [DOD-TR1-5] (must) Nothing changes for the kit: the capture, start and final back to back with a copy of the script that has a scratch folder of your own, differs only where a fixture has a non-base mode that lists commands; every differing file named and explained.
- [DOD-TR1-6] (must) Boundaries: manifests, runs and broker stay sealed; every new file is in the feature map where it belongs, and the report argues which feature the record and the hash belong to; neither debt list grows; the copy-paste detector count does not rise.
- [DOD-TR1-7] (must) Bug injection (P-18, P-31): at least 12 bugs, one at a time, in a throwaway copy with time limits and results saved as you go. Include: a project mode with no record is granted its list; a record for an older list grants the new one; the hash ignores effects; the hash ignores the starting words; the hash ignores throwaway folders; a record for another mode grants this one; a record file a mode's script could write is read (the record is read from somewhere other than `.agentbay/`); a mode is granted the config file as a write path; the harness is given a trusted project mode's command; an unreadable record grants everything; an unreadable record stops base modes too. Each caught, or a test added, or the report proves no test can catch it.
- [DOD-TR1-8] (must) `npm run check` passes. Size before and after reported per file, never targeted (P-13).

## Instructions

1. Run `npm run check` before any edit and wait for it (nohup and poll). Record test count, time, kernel line count, both debt counts by rule, and the detector count.
2. Read the design's slice 1 against the code as it is now (slices W2 and B7 merged after parts of the design were written: commands are listed by name, and their words are resolved by `listedCommandsOf`). Write in the progress note where each named type and function goes and anything in the design that no longer fits, before code (P-35).
3. Types, hash and record, tests first. Then the grant through `loadSystem`. Then the deletions. Then the config path and the harness rule. A commit each.
4. Regenerate the debt lists. Inject the bugs. Capture and diff. `npm run check`. Commit. Report.

## Tools

As in `docs/briefs/K1-grants-in-one-place-and-a-split-file-port.md` under "Tools", with outputs under `/tmp/tr1-capture/`.

## Resources

`bay/policy.ts`, `bay/contracts.ts`, `bay/manifests/` (entry `manifests.ts`, `grants.ts`, `loaded.ts`), `bay/layout.ts`, `bay/broker/broker.ts` (`reachOf`), `bay/check.ts` and the check feature, `bay/owner-only.ts` and `bay/secrets.ts` (how the kernel keeps a file of its own), `tests/policy.test.ts`, `tests/manifests-grants.test.ts`, `tests/grants-fixture.ts`, `tests/system-fixture.ts`, `tests/shared-tests-in-a-project.test.ts` (its fourth test pins that a project's toolchain and worktrees modes are refused today; it changes with this slice), `tests/agent-commands.test.ts`, `framework/features.yaml`.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05 model the domain in types: why a list is not in force is one of a closed set. P-11 replace and delete. P-12 one place: the hash, and the decision whether a list is in force. P-15 the interface is the test surface. P-16 literal expected values. P-17 test first, seen failing. P-25: if you must change course, stop and report. P-28: nothing the owner reads changes in this slice except sentences that are no longer true. P-29, P-30. P-35 interfaces first.
- TypeScript: `components/base/typescript/practices.md`.
- The kernel's own words never claim more than trust gives. It stops a mode's script and an agent inside a run's step from granting commands to themselves. It does not stop an agent that has the owner's shell.
- Fail closed: whenever the record cannot be read, is for another list, or is in doubt, a project mode's list is not in force. A base mode's list never depends on the record.
- Write scope: `bay/policy.ts`, `bay/contracts.ts`, a new private file for the record and hash, `bay/manifests/` where grants are built, `bay/broker/broker.ts` for what the harness is given, the check feature only to stop it reporting what is no longer an error, tests, the feature map, `CONTEXT.md`. Nothing under `components/` or `adapters/`. Anything else is named at the top of the report with its reason.
- Another builder may be working in a different worktree on `bay/broker/operations.ts`, `bay/check-imports.ts` and their tests, and on the toolchain interface and the typescript mode's tests. Do not edit those.
- The full check takes twelve to eighteen minutes: nohup and poll. Never run `node --test` with an empty file list. A check that ends "Terminated" or exit 143 was stopped from outside; run it again. Run a copy of the capture script with a scratch folder of your own.
- Commit after every step that passes typecheck and its tests; keep `/tmp/tr1-progress.md` current. Never pipe a check whose exit status you rely on.
- Formatting uses the project's configuration; never run prettier without `--config components/base/typescript/prettier.json`, and never with `--write` on a folder.
- Never read or print real secrets. Never push. Never touch `main` or another worktree.
- Report (P-22), in plain English and short sentences: anything beyond the brief first; where the design no longer fitted the code; what the hash covers; each DOD item with pasted output; the bug-injection table; what slices TR2 to TR6 need to know; what you did not do; what you did not verify.
