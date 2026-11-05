---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Decisions 1 to 6 were taken by the owner in chat on 2026-11-04, the answers to the three open questions and decisions 7 to 12 on 2026-11-05; all are followed here as given. On 2026-11-05 the owner also dropped the earlier decision on Opus builders for sensitive paths, so the decisions below are numbered 1 to 12 with no gap. Every line cited was read on feat/prevention at 4.0.0 (main a7a425d, branch head ca75d96; the lines cited in decisions 10 and 11 were read at branch head ebc1427, those in decision 12 at b961bd6; no code changed between these commits). Counts marked measured were run on that commit; line costs and the two exceptions are the plan's measurements on scratch copies of 90cd9a1 (docs/plans/0022-prevention.md), each exception being the measured readable cost plus a stated 20% buffer (see Measured and estimated).
id: "0022"
status: draft
touches:
  - { path: bay/dispatch.py, reason: "sensitive. The executor brief (:715-728) gains `envelope` built from the plan step; submit (:76-108) refuses a result whose selfCheck misses an acceptance id or an applicable DoD id; _require_plan (:130-143) also refuses a plan that lacks an acceptance id as done or skipped (decision 9); _accept_review (:629-636) no longer counts a nit as a failure (decision 7); _review_brief (:698-713) gains `earlier`; _prior_review (:679-696) is split so both use one reader of earlier reviews; _require_plan_file (:110-113) validates the plan's steps, blastRadius included, for a plan the plan step writes; _gate_subject (:419-426) and approve do the same for the forge plan, which `_require_plan_file` does not cover; the envelope is built only for a planned proposal and for a fix round; the envelope's `stop` always ends with the two standing stop conditions of decision 11, and `fix` is copied from the failed item with its `reproduce` and `rootCause` (decision 10) (+119 lines, measured in the plan)" }
  - { path: bay/proposal.py, reason: "plan_steps(text) reads and checks the plan's front matter next to front_matter (:13) and touches (:30), including blastRadius and the limits on acceptance text and count (+40 lines, measured)" }
  - { path: bay/cli.py, reason: "sensitive. `bay check --standards`: the standards step run by hand, read-only, so a plan can dry-run it; `bay plan <taskId> --skip <n> '<reason>'` beside `--done` in cmd_plan (:459-469) and its parser (:821-823). With `--base` it also runs the boundary check, which `--base` turns on. `_system` gains a type annotation. No new command, cli_commands stays 16 (+24 lines, measured)" }
  - { path: bay/ledger.py, reason: "record_plan (:83-103) accepts an optional `id` on a to-do item; record_done (:106-113) takes the skip reason, stored as `data.skip` of an `agent.plan.done` event: no record_skip and no new event type, so schemas/event.schema.json is unchanged; plans() (:150-162) folds the skip reason (+8 lines, measured)" }
  - { path: bay/guard.py, reason: "sensitive. _plan_command (:504-523) also allows `bay plan <taskId> --skip <n> '<reason>'` and nothing else new (+2 lines, measured)" }
  - { path: schemas/task.schema.json, reason: "TaskEnvelope (:6-24) gains optional scope, acceptance, dod, fix, limits, stop, blastRadius; Result (:26-40) gains selfCheck, checked, planStep. Additive; stays v1" }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "a failed item must carry weakness, places and ways (decision 6), and reproduce and rootCause (decision 10); additive for passes. It applies to every mode: the schema is shared by every review step and by `bay note review`, so a digest or triage reviewer writes the five fields on a fail too" }
  - { path: components/base/forge/types/Result.schema.json, reason: "the forge step output type gains selfCheck, checked, planStep, the same three keys as task.schema.json" }
  - { path: framework/roles/builder.yaml, reason: "prompt (:12-29): the limits rule (decision 3), the selfCheck and checked report (decision 2), the to-do that starts from the acceptance list verbatim (decision 9), reproduce the failure first and name the root cause, never silence it (decision 10), the plain statement that pushing back is expected, with the stop-and-report rule (decision 11), and that the builder implements briefs and plan steps only, never proposals or plans (decision 12); the access comment (:10) no longer names the lead's plan step. Text only" }
  - { path: framework/roles/lead.yaml, reason: "the subagent rule (:20) says `write only the files the task names`, and the access comment (:10) names forge.extend's propose and plan steps (decision 12). Text only" }
  - { path: framework/roles/reviewer.yaml, reason: "prompt (:13-36): do not stop at a few findings; for every failure search the same weakness across the change and report the class as one item; read `earlier` (decision 6); a nit is only a style or wording point with no effect on behaviour or a contract (decision 7); fail a fix that silences instead of fixes (decision 10); an honest fail is expected, agreement is not the default (decision 11). Text only" }
  - { path: components/base/forge/mode.yaml, reason: "the propose step (:37) runs as the lead in env framework-dev on the deep tier, high effort (decision 12); the plan task (:39) asks for the plan format and the dry-run, and to amend the proposal so the two agree, listing both files in artifacts (decisions 4 and 12); the release task (:46) lists the review's nits in followups (decision 7)" }
  - { path: components/base/forge/features/extend/rules.yaml, reason: "R-8 (:8) says a nit never makes the result partial, even on a must item (decision 7)" }
  - { path: components/base/cos/playbook.md, reason: "the source of the Chief of Staff text in the generated .agentbay/COORDINATOR.md (built by adapters/claude-code/claude_code.py:425-431). Loop step 3 (:22-26) gains the diff-against-acceptance read and the one-line result (decision 8) and the fresh-dispatch rule (decision 9); the task block (:49-58) gains the new fields. .agentbay/COORDINATOR.md is regenerated by the build, not edited by hand" }
  - { path: components/base/forge/features/extend/playbook.md, reason: "step 1 (propose: the lead writes it, decision 12), step 3 (plan: the plan format, and the lead amends the proposal, decisions 4 and 12), step 5 (implement) and step 10 (release) text. No new DoD ids: the new checks are covered by DOD-3 and DOD-17" }
  - { path: components/base/python/connectors/python-check/python_check.py, reason: "two new row kinds beside _reachability_rows (:227-244) and _token_rows (:247-255): a comprehension with more than one `for` or inside another comprehension, and a one-line string literal of two or more Python statements in a test file (+46 lines of protected kit code, measured)" }
  - { path: components/base/python/connectors/python-check/README.md, reason: "the two new rules and how to write the code instead" }
  - { path: tests/test_dispatch.py, reason: "cases added to existing tests: the envelope and blastRadius, the selfCheck refusal, the `earlier` verdicts, the nit that does not make a call partial, the plan-format refusal, the failed item without reproduce and rootCause, the standing stop lines, the propose step run by the lead on opus (:211) (no test function added)" }
  - { path: tests/test_submit_needs_plan.py, reason: "cases in the submit-refusal test (:14): a result without selfCheck for every acceptance id and DoD id; a plan that lacks an acceptance id as done or skipped" }
  - { path: tests/test_ledger.py, reason: "cases in test_bay_plan_records_scrubbed_size_limited_append_only_events (:189): an item with an id, a skip with its reason" }
  - { path: tests/test_boundaries.py, reason: "cases in test_bay_plan_is_the_only_bay_command_a_subagent_may_run (:938): `--skip` is allowed for the agent's own task and nothing else is" }
  - { path: adapters/claude-code/tests/test_adapter.py, reason: "a case in test_adapter_round_trip (:24): the generated COORDINATOR.md holds the diff rule and the fresh-dispatch rule" }
  - { path: tests/test_roles.py, reason: "a case in test_shipped_roles_are_five_generic_framework_roles_without_data_access (:51): the builder and reviewer prompts carry the new rules, including the root-cause rule and the pushback sentences (decisions 10 and 11), and the builder and lead prompts carry the role split (decision 12)" }
  - { path: tests/test_cli_commands.py, reason: "a case: `bay check --standards` takes no boundary options and writes nothing" }
  - { path: components/base/python/tests/test_python_check.py, reason: "cases in the one test (:309), written one source line per line" }
  - { path: tests/golden/guard-matrix.json, reason: "the guard's deny reason for `bay plan` names `--skip`: 15 reasons change text, 0 of 1217 decisions change" }
  - { path: tests/test_review_record.py, reason: "its failed verdict fixtures carry the five fix fields (`bay note review` validates against the shared schema)" }
  - { path: components/base/improve/tests/test_improve.py, reason: "its failed verdict fixtures carry the five fix fields (the improve triage review uses the shared schema)" }
  - { path: README.md, reason: "DOD-13: the brief format, selfCheck, `check --standards`, `plan --skip`" }
  - { path: docs/DESIGN.md, reason: "DOD-13: a paragraph on prevention; at its 3000-word budget, so the words are paid for by cuts in the same file" }
  - { path: docs/INTERFACES.md, reason: "DOD-13: the envelope fields, the plan front matter, selfCheck, the verdict fields; at its 3000-word budget, paid for by cuts" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines and kit_python_lines written down to the real counts" }
  - { path: bay/__init__.py, reason: "release step: version 4.1.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading note" }
exceptions:
  - { measure: bay_lines, to: 9935, reason: "9703 is the ceiling and the count. Measured in the plan on a scratch copy of 90cd9a1, as readable typed code: +193 (dispatch.py 119, proposal.py 40, cli.py 24, ledger.py 8, guard.py 2), plus a stated buffer of 39 (20% of 193 is 38.6, rounded to the nearest line): 9703 + 193 + 39 = 9935. Decisions 10 and 11 (root causes, say no) are inside the 193; their prompt and schema changes are not counted by bay_lines. Decision 12 (the role split) adds 0: it is YAML and prompt text." }
  - { measure: kit_python_lines, to: 5331, reason: "5276 is the ceiling and the count. Measured in the plan: +46 (python_check.py 46; the plan's measured +52 also held scaffold.py +6, which served only the dropped Opus-builder decision, so scaffold.py is not touched), plus a stated buffer of 9 (20% of 46 is 9.2, rounded to the nearest line): 5276 + 46 + 9 = 5331. Decision 12 adds 0. Test fixtures for the new rules are written one source line per line, as the owner decided on 2026-11-04." }
---

# 0022: Prevention

## Summary

Two framework changes took many rounds to land. 0011 (standards) needed seven fix rounds, and 0021 (component layout) needed three, plus two limit re-approvals. When I read what happened, the rounds were not caused by hard code. They were caused by gaps in how work is handed out and checked:

- A fix brief named one instance of a problem, the builder fixed that one, and the next review found its sibling.
- The builder never compared its own work with the acceptance criteria, so the reviewer was the first to do it.
- A plan could call a step green without running anything. 0021 step 1 was called "trivially green" (`docs/proposals/0021-component-layout.md:198`) and still changed 18 guard decisions. The standards step could not run once its config folder moved (`python_check.py:21` names the folder).
- Builders packed code onto long lines or into one-line test fixtures to fit a limit. You call that cheating, and 0021 records your decision (`0021-component-layout.md:48`).
- A review stopped after a few findings.
- Each of these was found late, in review.

This proposal moves the checking earlier and makes it mechanical. The ideas come from Lauren Tan's pstack skill stack (cursor/plugins pstack): its blast-radius skill, poteto-mode's verbatim playbook steps and "you own every subagent's work", its bugbot triage, and its rules to find the root cause and to say no. Decision 12, the role split, is yours. The twelve decisions, in plain words:

1. **One brief format.** Every builder brief has the same fields: outcome, context, scope, numbered acceptance criteria with the evidence each needs, the Definition-of-Done ids that apply, limits in numbers, stop conditions, what else the step can break, and the report format. For a fix round it also lists the weakness, every place it can happen, every way to trigger it, how to reproduce the failure and its root cause (decision 10). The stop conditions always include the two standing ones of decision 11. The plan step writes these for each step in a small YAML front matter, you approve them with the plan, and bay builds each brief from it, so no criterion is dropped on the way.
2. **A self-review in every result.** The builder reports one line of evidence per acceptance id and per applicable DoD id. In a fix round it reports what it did at every listed place and way. bay refuses a result that leaves one out.
3. **A limit is your question, not a target.** If readable code goes over a ceiling, the builder stops, reports the measured value and what it pays for, and never compresses code.
4. **Plans prove their steps.** A plan runs the real suite, the limits check and the standards step (by hand, with `./bay.sh check --standards`) on a scratch copy for every step it calls green. A limit exception is the readable estimate plus a stated buffer.
5. **A check for packed code**, in the Python checker the standards step already runs: a comprehension with more than one `for` or inside another comprehension, and test fixtures that hold source code as one line with `\n`. Cases already in the tree are the baseline and block nothing.
6. **Reviews that find the class.** For every failure, the reviewer searches the same weakness across the whole change and reports the class as one item, and it sees the verdicts of earlier reviews of the same proposal. A failed item carries five fix fields (weakness, places, ways, reproduce, rootCause) in every mode: the shared review schema and `bay note review` require them, not only forge.extend.
7. **Nits never block.** A review item with severity `nit` never ends a call `partial`, even on a must item. Nits go into the release Result's followups, and you can still ask for them to be fixed now. This holds for every mode's review.
8. **Blast radius and diff ownership.** Each plan step, and so each brief, says what else the step can break, and the plan's dry-run confirms it. Before it submits a step, the coordinator reads the diff against the brief's acceptance list and writes its own one-line result: the coordinator owns every agent's work.
9. **Verbatim steps and fresh agents.** An agent's to-do starts from the brief's acceptance list, word for word, one item per acceptance id; a dropped item stays in the list as `skip: <reason>`, and bay refuses a submit whose plan lacks an acceptance id that is neither done nor skipped. When a task changes, the coordinator dispatches a fresh agent with the full brief and never resumes one with new directives.
10. **Root causes, no silencing.** A fix brief must say how to reproduce the failure and name its root cause, and the builder reproduces the failure before it changes anything. A fix that only hides the symptom is refused: a `None` check, a `try`/`except`, a guard or a `# type: ignore` that covers the bug instead of fixing why it happens. The reviewer fails such a fix.
11. **Say no.** The builder and reviewer prompts say in plain words that pushing back is expected. A builder that finds the brief wrong, or in conflict with the proposal, stops and reports instead of coding around it. A reviewer gives an honest fail, not agreement by default.
12. **The lead designs, the builder implements.** The lead writes proposals and amends them; the builder only implements briefs and plan steps. The propose step moves from the builder to the lead, on Opus. The plan step writes the plan and amends the proposal so the two agree, so a plan that finds the proposal wrong fixes it instead of listing amendments for someone else.

What stays the same: the steps of forge.extend, the approval gate, the one review round, the Result and verdict contracts (all additions are optional keys, so `agentbay/v4` stays), every limit except the two exceptions below, and the rule that you alone pass the gate. There is no compatibility code. A plan written in the old free-form way is refused at the plan step with a message that names the missing field.

What it costs: `bay_lines` 9703 to 9935 (measured +193 and a 20% buffer of 39) and `kit_python_lines` 5276 to 5331 (measured +46 and a buffer of 9), both as exceptions sized from readable code plus a buffer. Decision 12 adds no counted line. `tests` stays 463: the new checks are cases inside existing tests. Builders stay on Sonnet for every proposal, this one included. The lead writes proposals and plans on Opus (decision 12), and reviews stay on Opus.

What you decided on 2026-11-05, and where it is written: the plan gets YAML front matter, validated at the plan step (decision 1); the dry-run command is `./bay.sh check --standards` (decision 4); selfCheck covers acceptance ids and DoD ids (decision 2); decisions 7 to 12 are sections below. Decisions 10 and 11 are mostly prompt and template text: they add 4 lines of `bay/` code, counted inside the 193, and no new test function. The required fix fields on a failed review item apply in every mode, through the shared review schema and `bay note review` (decision 6). The lead writes and amends proposals and the builder only implements (decision 12). Opus builders on sensitive paths and a two-model review panel were considered and not chosen (Out of scope). No open question remains.

## The design

### 1. One brief format, built from the plan

**Where it is today.** The step plan the dispatcher returns for a builder holds the task text, playbook, rules, DoD, input and previous outputs (`bay/dispatch.py:715-728`). The coordinator then writes a TaskEnvelope by hand around it. `TaskEnvelope/v1` has `goal`, `context`, `inputs`, `constraints`, `deliverable` and `budget` and allows no other key (`schemas/task.schema.json:6-24`). Nothing says what a brief must contain, so a criterion can be dropped or never written.

**The change.**

- `schemas/task.schema.json` gives TaskEnvelope seven optional keys: `scope`, `acceptance`, `dod`, `fix`, `limits`, `stop`, `blastRadius`. The brief's outcome is `goal`; its context is `context` and `inputs`; its report format is `deliverable`. Nothing else is renamed.
- **Decided by the owner on 2026-11-05 (the owner's question 1, answered):** the plan file starts with a YAML front matter, a small block that lists its steps. It is read by a new `plan_steps(text)` in `bay/proposal.py` beside `front_matter` (:13) and validated at the plan step, at the gate and at approval (see the bullet on the plan step's submit). It holds a `steps:` list. Each plan step has the fields below. The alternative I raised, leaving plans free-form and copying acceptance by hand, is not taken: copying by hand is what dropped criteria.
- `bay/dispatch.py` adds `envelope` to the executor brief (`_executor_brief`, :715-728) for the implement step of a forge.extend proposal that has an approved plan, and for a fix round. It is the TaskEnvelope for the current plan step, without the `taskId`, which the coordinator still mints. The coordinator renders it as the task block; it adds nothing. A proposal without a plan gets no envelope, except in a fix round. In a fix round the envelope has `acceptance: []`, `dod` the failed DoD ids, `fix` copied from the failed items, and `stop` the two standing lines of decision 11; there is no plan step counter, and bay finds the round with the same reader of earlier reviews as `recheck` (decision 6).
- `plan_steps` validates the plan at three points. At the plan step's submit, in `_require_plan_file` (:110-113), which today only insists that the plan file exists and is listed, and only for an `approve.plans` plan. When the gate subject is built, in `_gate_subject` (:419-426): forge.extend's gate approves the proposal and finds the plan by name, so `_require_plan_file` does not cover it. And again at approval, because a plan edited while the gate waits was otherwise approved and then crashed the implement brief. Every step needs an outcome, scope, at least one acceptance entry with text and evidence, DoD ids that exist in the feature, limits, stop conditions, a `blastRadius` and the dry-run of decision 4, including its `blastRadius` key (decision 8). A missing field is refused with the step number and the field name.
- The gate already binds the plan's exact content with the proposal (`bay/dispatch.py:419-426`), so approving the plan approves its acceptance criteria and evidence.
- Briefs for steps that have no plan (the propose step, the plan step itself, the release step) are still written by the coordinator, in the same fields. The playbook says so and the schema describes them. bay builds only what it has a plan for: forge.create, delivery.build and a forge.extend proposal without a plan get no envelope, except in a fix round.

**The plan step list.** In the plan's front matter, one entry per plan step (one commit each):

```yaml
steps:
  - id: 1
    outcome: <what exists when the step is done, one sentence>
    context: [<path#heading of the proposal or plan to read>]
    scope: { in: [<paths or areas>], out: [<what must not change>] }
    acceptance:
      - { id: A1, text: <checkable statement>, evidence: <what to show: command and output, file:line, test name>, dod: [DOD-n] }
    limits: { lines: <budget, readable code>, tests: <rule>, style: [<rules>] }
    stop: [<conditions that mean: stop and report, do not improvise; bay adds the standing ones of decision 11>]
    blastRadius: <what else this step can break: the other code, tests, guard decisions or generated files that depend on what it changes>
    dryRun: { suite: <command and result>, limits: <command and result>, standards: <command and result>, blastRadius: <the command or read that confirms the blastRadius text, and its result> }
```

`dod` on the envelope is the union of the steps' acceptance `dod` lists. Acceptance ids are `A1..An` within a step. The acceptance `text` of a step is at most 240 characters and a step has at most 8 acceptance entries, so each fits verbatim in a to-do item (decision 9; the ledger allows 240 characters and 12 items, `bay/ledger.py:21`).

**The complete template** (the envelope that bay builds for one plan step; `fix` appears only in a fix round, see decisions 2, 6 and 10; the last `stop` line appears only with `fix`, see decision 11):

```task
protocol: TaskEnvelope/v1
taskId: T-YYYYMMDD-xxxx
goal: <outcome>
context: <the proposal and plan sections to read, as path#heading>
inputs: [<paths, urls, prior taskIds>]
scope:
  in: [<what may change>]
  out: [<what must not change>]
acceptance:
  - { id: A1, text: <checkable>, evidence: <what to show>, dod: [DOD-n] }
  - { id: An, text: <checkable>, evidence: <what to show>, dod: [] }
dod: [<DoD ids that apply>]
fix:                                    # fix rounds only, copied from the failed review
  - id: <failed DoD or rule id>
    weakness: <the underlying problem, not one instance>
    places: [<every place it can happen>]
    ways: [<every way to trigger it>]
    reproduce: <a command or test that shows the failure before any change, and its output>
    rootCause: <why it happens, in one or two sentences; not the symptom>
limits:
  lines: <readable-code budget>
  tests: <test-count rule>
  style: [<style rules>]
stop:                                   # the plan's conditions, then the two standing ones bay adds (decision 11); a fix round has only the two standing ones
  - <condition from the plan: stop and report, do not improvise>
  - the brief or the plan is wrong, or conflicts with the proposal
  - the failure cannot be reproduced, or its root cause is not found   # fix rounds only
blastRadius: <what else this step can break>
deliverable: Result/v1 with selfCheck (one line per A-id and per applicable DoD id); in a fix round also `checked` (one line per place and per way)
```

Under the block the coordinator adds one rule line that bay also prints (decision 9): your `bay plan` to-do starts from `acceptance`, verbatim, one item per id.

**A filled-in example.** Plan step 3 of 0021, "The folder table and the stray-folder line" (`docs/plans/0021-component-layout.md:212-253` for the step, `docs/proposals/0021-component-layout.md:127-137` for the design), as bay would build it:

```task
protocol: TaskEnvelope/v1
taskId: T-20261104-7c3e
goal: A misplaced manifest or a stray folder under components/ is reported by bay check with the git mv that fixes it, and a content type's spec.kind must equal its folder.
context: docs/proposals/0021-component-layout.md#2-the-folder-name-is-the-kind, docs/plans/0021-component-layout.md#files-and-tests-per-item (item 3)
inputs: [bay/lint.py, bay/contenttypes.py, tests/test_boundary.py, tests/test_lint.py]
scope:
  in: [bay/lint.py (FOLDER_MANIFESTS, TIERS, lint_case_and_manifests), bay/contenttypes.py (_one), tests/test_boundary.py, tests/test_lint.py]
  out: [the composition check (step 5), B-11 names (step 4), any scaffold code (step 6)]
acceptance:
  - { id: A1, text: "components/rss/ (a folder at the old depth) is reported with `git mv components/rss components/modes/rss`", evidence: "test_lint_rejects_case_collisions_and_extension_folders_without_manifest fails on the parent commit and passes", dod: [DOD-12] }
  - { id: A2, text: "a connector manifest at a mode root, connectors/foo/ with no manifest and a connector.yaml inside content-types/bar/ are each reported", evidence: "three cases in the same test, each quoting the message", dod: [DOD-12] }
  - { id: A3, text: "a content type whose spec.kind differs from its folder name is a lint error", evidence: "a new row in test_lint.py's case table, quoting the message", dod: [DOD-12] }
  - { id: A4, text: "the shipped kit is still lint clean", evidence: "./bay.sh check output", dod: [DOD-12, DOD-15] }
dod: [DOD-7, DOD-12, DOD-14, DOD-15, DOD-18]
limits:
  lines: "bay_lines +10 readable (table +6, stray line +4) before the buffer; stop and report above +14"
  tests: "no test function added; cases go into existing tests"
  style: ["no # comment, no docstring over one line", "no packed lines or comprehensions with two for"]
stop: ["the table needs more than 14 lines", "a case passes on the parent commit", "the brief or the plan is wrong, or conflicts with the proposal"]
blastRadius: "every manifest under components/ is now checked by bay check, so a kit file at a wrong depth that passes today is reported; the dry-run lints the shipped kit and runs tests/test_boundary.py and tests/test_contenttypes.py"
deliverable: Result/v1 with selfCheck for A1-A4 and DOD-7, DOD-12, DOD-14, DOD-15, DOD-18; artifacts lists every changed file. Your bay plan to-do starts with the four acceptance items A1-A4, verbatim, one each; a dropped one stays as skip: <reason>.
```

The same step as it stands in the plan has the outcome, files and tests, and no evidence per criterion, which is why its review needed rounds.

**The same step in a fix round.** The `fix` and `stop` parts of a brief after a failed review, invented to show the lines (the review, its places and its message are not from 0021's history):

```task
fix:
  - id: DOD-12
    weakness: "a stray folder is reported only when it sits directly under components/"
    places: [bay/lint.py (FOLDER_MANIFESTS walk)]
    ways: ["components/modes/rss/extra/ with a manifest inside"]
    reproduce: "add that folder to the case table in test_lint.py; python3 tests/run.py tests/test_lint.py fails with: no finding for components/modes/rss/extra"
    rootCause: "the walk stops at depth 2, so a folder one level deeper is never visited; a depth check at the report would not change that"
stop:
  - the brief or the plan is wrong, or conflicts with the proposal
  - the failure cannot be reproduced, or its root cause is not found
```

Here a fix that tests for `None` where the walk returns nothing, or wraps the walk in a `try`/`except`, hides the missing report and is refused (decision 10). The fix is to walk to the depth the table needs.

**Why in the dispatcher and not a template in the coordinator's playbook.** A playbook sentence is what failed: "the brief states the goal, the inputs and the limits" (`components/base/cos/playbook.md:24`, generated into `.agentbay/COORDINATOR.md`, loop step 3) left the criteria to whoever wrote the brief. Building from data means a criterion in the plan is in the envelope.

**Test that fails on main:** `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` extended to a plan with front matter: main returns no `envelope` key (the brief at :715-728 has none), so the first assertion fails. A second case: a plan with a step without `acceptance` is refused at the plan step; main accepts any file (:110-113 only tests that it exists).

### 2. The builder reports a self-review

**Where it is today.** `Result` has `status`, `summary`, `artifacts`, `followups`, `blockers` (`schemas/task.schema.json:26-40`, `components/base/forge/types/Result.schema.json`). The builder prompt tells it to list its to-do items as done, dropped or blocked (`framework/roles/builder.yaml:17-19`) but never to check acceptance criteria. `submit` validates a step's output against its `out` type and requires a recorded `bay plan` (`bay/dispatch.py:76-108`, `_require_plan` :130-143).

**The change.**

- `Result` gains `selfCheck` (an object: id to one line of evidence), `checked` (an object: id to one line) and `planStep` (the plan step number the result answers). Both Result schemas get the same three optional keys.
- `submit` (`bay/dispatch.py:76-108`), for a step whose brief carried an `envelope`, compares the result with it after the schema check and before `state["steps"][step.id]` is written. It refuses with the missing ids: every acceptance id and every applicable DoD id of the envelope must be a key of `selfCheck` (**decided by the owner on 2026-11-05, the owner's question 3, answered:** the dispatcher refuses a result missing either kind; one loop covers both), and in a fix round every place and way id of `fix` must be a key of `checked`. The message names the ids and says what a line should hold. Steps with no envelope (forge.create, delivery.build, and forge.extend proposals without a plan, except in a fix round) are not checked, because they have no acceptance ids.
- `checked` keys are `<failed id>.P<n>` for the n-th place and `<failed id>.W<n>` for the n-th way, numbered by bay when it builds `fix`. A value starts with `fixed`, `already safe` or `not fixable` and then gives the reason; a `fixed` value also names the root cause and the test that failed before the change (decision 10).
- Because the plan has one entry per plan step, the implement step stays open until every plan step has an accepted result. The dispatcher holds a counter in the call state (`state["planStep"]`) and returns the next envelope in `next`. A fix round re-runs extend with `proposal` set, as the playbook says today (`components/base/forge/features/extend/playbook.md`, Failure handling), and builds `fix` from the failed review.
- `framework/roles/builder.yaml` (:12-29) says in its prompt: before you submit, check your work against each acceptance id and each applicable DoD id and report one line of evidence for each in `selfCheck`; in a fix round also `checked`.

**Test that fails on main:** `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` gets a case: a result without one acceptance id is refused naming the id. Main accepts it, as it has no such check. `tests/test_dispatch.py::test_the_step_result_accepts_what_the_worker_contract_returns` (:383) gets `selfCheck` in its result and fails on main with additionalProperties.

### 3. A limit is a question for the owner

**Where it is today.** The builder is told to run `./bay.sh check --limits` (`mode.yaml:41`) but nothing says what to do when readable code does not fit. 0021 and 0011 show what happened: packing, and exception re-approvals after the fact (`0021-component-layout.md:74`, `0011-standards.md:65`).

**The change.** `framework/roles/builder.yaml` prompt gets one rule: if a readable change would exceed a ceiling or an exception in the proposal, stop. Report the measured value, the ceiling and what the extra lines pay for. Do not shorten, join or pack code to fit. The same sentence goes into the envelope as `limits.style` and into `stop` (`a readable change goes over the limit`). The step's `limits.lines` is the plan's readable estimate plus its stated buffer, so the builder knows the budget and the point where it must stop.

This is a prompt rule and an envelope field, not a check. The check that backs it is decision 5. I considered a limits-step finding for "dense" code, and dropped it: density has no honest definition apart from the three shapes decision 5 names.

**Test that fails on main:** `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) gains a case that the builder prompt names the stop rule and the word "ceiling". Main's prompt (:12-29) has neither.

### 4. Plans dry-run the pipeline on a scratch copy

**Where it is today.** The plan task says "build order, files and tests per item, risks, and what each ceiling costs" (`components/base/forge/mode.yaml:39`). The 0021 plan did measure on scratch trees (`docs/plans/0021-component-layout.md:33-37`), but nothing requires it for every step, and its step 1 was called green without a run (`0021-component-layout.md:198`). The step that broke, the standards step, is a dispatcher code step (`bay/dispatch.py:533-545`), and no command runs it by hand.

**The change.**

- The plan task in `mode.yaml:39` asks for the front matter of decision 1 and, for every step the plan calls green, a `dryRun` entry: the suite (`python3 tests/run.py`), the limits (`./bay.sh check --limits`) and the standards step, each as a command and its result, run on a scratch copy of the tree with that step's changes applied. The plan step already runs in env framework-dev, which allows these commands (`components/base/forge/envs/framework-dev.yaml`, `clis`).
- `plan_steps` refuses a step whose `dryRun` lacks one of the three keys. It cannot check that the text is true; the reviewer and you read it, and a false entry is a plain lie in an approved file.
- **Decided by the owner on 2026-11-05 (the owner's question 2, answered), keep `./bay.sh check --standards`:** the plan lead cannot run the standards step today. `standards.check` needs a dispatcher and a connector context, and no CLI reaches it. I add `./bay.sh check --standards [--base <ref>]` (`bay/cli.py`, the `check` parser at :755-763): it runs the same `standards.check` as the step against the base and prints the new findings, and writes nothing. With `--base` it also runs the boundary check, because `--base` turns that on (`cli.py:113`); that is harmless and read-only. `guard.py:431` treats only `./bay.sh check --write` as a write, so the flag needs no guard change.
- Each limit exception in a proposal or plan is the readable estimate plus a stated buffer, written as two numbers in its `reason:`. This proposal's two exceptions follow it (front matter). The plan task and the playbook say so.

**Test that fails on main:** `tests/test_dispatch.py::test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval` (:358) gets a plan with a step that lacks `dryRun.standards`: refused. `tests/test_cli_commands.py::test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json` (:37) gets a case for `check --standards`: main's parser rejects the flag.

### 5. A no-packing check in python-check

**Where it is today.** `python-check` runs ruff and mypy and a few AST and token rules (`python_check.py:227-296`). Ruff's selection `E F W B` has no rule for these shapes. The standards step blocks only on findings that are new against the call's start commit, comparing them as a multiset keyed by file, rule and message (`bay/standards.py:38-48`).

**The change.** Two new row kinds in `python_check.py`, found with `ast` in the same pass as `_reachability_rows` (:227-244), added to `_inline_rows` (:283-296):

1. `packed-comprehension`: a list, set or dict comprehension or a generator expression with more than one `for` (`len(node.generators) > 1`), or one that contains another comprehension anywhere inside it. One row per outer comprehension.
2. `packed-fixture`: in a test file (a `.py` under a folder named `tests`, or named `test_*.py`), a string literal that sits on one source line, contains `\n`, and parses with `ast.parse` as a module of two or more statements. This is Python source written as one line. A fixture written one source line per line (a triple-quoted string or a list of lines) is not a finding.

Rows use a fixed message per rule with no line numbers, so the multiset comparison treats a moved line as the same finding and every case already in the tree is baseline. Measured by the plan with the rule as specified: 108 comprehension rows in 40 files (one row per outer comprehension; the earlier count of 70 two-`for` and 40 nested comprehensions counted the two shapes apart), and 45 one-line fixture rows in 18 test files. I measured a third shape, `"\n".join([...literals])` as source, and found 0 today, so I do not add a rule for it.

This is deterministic and cannot see intent. It stops the two shapes the 0011 and 0021 builders used; a new shape needs a new rule. That is the price of a check that does not judge.

**Test that fails on main:** `components/base/python/tests/test_python_check.py::test_python_findings_are_blocked_only_when_new_against_the_call_start` (:309) gets two cases (a new double-`for` comprehension, a new one-line fixture), each blocking, and an unchanged old case not blocking. On main neither shape is a finding.

### 6. The reviewer reports the class and sees earlier verdicts

**Where it is today.** The reviewer prompt gives a verdict per id and a severity (`framework/roles/reviewer.yaml:24-31`). A verdict item has `id`, `verdict`, `evidence`, `severity`, `suggestion`, `cites` (`schemas/data/review.verdict.v1.schema.json`). The review brief holds the task, DoD, rules, checks, output and `recordedPlans`, and a `recheck` when the same files had an earlier failed review: only the failed ids, the commits since and the ids that passed (`bay/dispatch.py:698-713`, `_prior_review` :679-696). The reviewer has a 25-turn budget (`reviewer.yaml:12`).

**The change.**

- The verdict schema requires `weakness` (the underlying problem), `places` (every place it can happen) and `ways` (every way to trigger it), all as strings or lists of strings, on an item whose verdict is `fail`; decision 10 adds `reproduce` and `rootCause` to the same requirement (a JSON Schema `if`/`then`). `_accept_review` (`bay/dispatch.py:617-638`) validates against that schema already (:618-621), so no dispatcher line is needed for this. The requirement holds for every mode: the schema is shared by every review step and by `bay note review` (`cli.py:484`), so every failed item in every mode carries the five fields, and the reviewer prompt, which every mode's reviewer reads, asks for them (owner, 2026-11-05).
- `framework/roles/reviewer.yaml` (:13-36) says: check every id even after the first failure; for each failure, search the change for the same weakness and report the whole class as that one item, listing each place and way; read `earlier` and do not pass an id an earlier review failed without evidence that it is fixed.
- `_review_brief` (:698-713) gains `earlier`: for every earlier call of the same target with the same gated proposal, its failed items (id, evidence, weakness, places, ways) and the ids it passed. `_prior_review` already walks the ledger and the calls folder to find the newest failed review of the same files (:679-696). It is split into one reader of earlier reviews that returns all of them, and `recheck` is built from the newest, as now. About +20 lines.
- A failed item is also the source of the next fix brief: bay copies `id`, `weakness`, `places`, `ways`, `reproduce` and `rootCause` (the last two are decision 10) into the `fix` section of decision 1, so a fix round sees what the reviewer saw. The coordinator does not retype findings.

The item stays one item per failure class, so the number of verdict ids and the rule that a failed `must` or blocker makes the call `partial` (`_accept_review` :628-631) do not change.

**Test that fails on main:** `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231) is extended: a failed item without `weakness` is refused (main accepts it), and the next call's review brief holds `earlier` with that item (main has no `earlier`).

### 7. Nits never block

**Where it is today.** A review call ends `partial` in `_accept_review` (`bay/dispatch.py:617-638`). The list `failed` (:630-631) holds every item that has `verdict: fail` at a `must` or `must_not` level (`FAIL_LEVELS`, :19) or has severity `blocker`; `if failed:` (:634-636) sets `state["status"] = "partial"` and `halt`, so the call stops before release. The severity of the first kind of item is not looked at: a `nit` on a must item halts the call. Rule R-8 says the reviewer rates each finding blocker, should-fix or nit and "any blocker makes the result partial" (`components/base/forge/features/extend/rules.yaml:8`), which is not what the code does for a nit on a must item. The verdict schema already has the `nit` value (`schemas/data/review.verdict.v1.schema.json:38-44`).

**The change.**

- `bay/dispatch.py:631`: the first clause of the filter also requires `i.get("severity") != "nit"`. The `blocker` clause is unchanged. About +1 line. A nit that fails a must item is kept in the stored review (`state["steps"][step.id]`, :633) and counted in `items`, but not in `state["review"]["failed"]`, so it is not a failed id for `recheck` (`_prior_review`, :679-696, compares with that list) and does not stop release. `_accept_review` serves every mode's review step, so the rule applies to every mode.
- The release step lists them. The release brief already carries the review verdict in `previous` (`_executor_brief`, :724). The release task (`components/base/forge/mode.yaml:46`) and playbook step 10 say: for each review item with severity `nit` and verdict `fail`, add one line to the Result's `followups`, as `nit <id>: <suggestion>`. This is the existing `followups` key (`schemas/task.schema.json:34`); no schema change.
- You can still ask for them now. The coordinator reports the nit lines with the release Result; if you say to fix them, it re-runs extend with `proposal` set and the nit items are the `fix` section of the brief (decision 6), as for any failed item.
- `rules.yaml` R-8 gets the sentence "A nit never makes the result partial, even on a must item." `framework/roles/reviewer.yaml` says what a nit is: a wording or style point with no effect on behaviour, a contract or a limit. Anything with such an effect is `should-fix` or `blocker`, and a `should-fix` on a must item still halts the call.

**What this does not fix.** A reviewer can call a real defect a nit and so let it through. Nothing in bay can judge that; the defence is the prompt definition above, the reviewer's evidence line being read at the gate, and your option to ask for the followups to be fixed.

**Test that fails on main:** `tests/test_dispatch.py::test_agentic_step_returns_plan_then_review_then_partial_on_failed_must` (:71) gets a case: a verdict that fails a must id with severity `nit` leaves the call `done`, and a verdict that fails it with `should-fix` still ends `partial`. On main both end `partial`, so the first assertion fails.

### 8. Blast radius, and the coordinator owns the diff

**Where it is today.** A plan step lists files and tests, not what else it can break; 0021 step 1 changed 18 guard decisions while being called trivially green (`0021-component-layout.md:198`). The coordinator hands the agent's output to `bay submit` after the schema check and the plan check (`bay/dispatch.py:76-108`); nothing makes anyone compare the diff with the criteria before that. The coordinator text is `components/base/cos/playbook.md`: loop step 3 (:22-26) says the brief states "the goal, the inputs and the limits" and that the agent writes its own plan. `claude_code.py:_coordinator` (`adapters/claude-code/claude_code.py:425-431`) builds `.agentbay/COORDINATOR.md` from that playbook (`root.playbook`, the `cos` mode), so the playbook is the source and the generated file is not edited by hand.

**The change.**

- **blastRadius in the plan and the brief.** Each plan step in the front matter (decision 1) has a required `blastRadius`: what else this step can break. `plan_steps` refuses a step without it, and the step's `dryRun` needs a `blastRadius` key: the command or read that confirms the text and its result. The plan's dry-run therefore confirms it, as for the suite, limits and standards. `schemas/task.schema.json` TaskEnvelope gets `blastRadius` (a string, optional), and bay copies the step's text into `envelope`. The builder reads it as a list of places to look at before it submits.
- **Diff ownership.** `components/base/cos/playbook.md`, loop step 3, gets a rule: before you submit an agent's output for a step that has an `envelope`, read the diff of that step (`git diff`, `git show` of its commit) against the brief's acceptance list, id by id, and the `blastRadius`. Then write your own one-line result for the step with `.agentbay/bay note <taskId> "<each acceptance id met or not, from the diff>"`; the agent's Result is not your result. If an id is not met by the diff, do not submit; dispatch a fresh agent (decision 9). The task block in the same file gains the new fields, and the generated `.agentbay/COORDINATOR.md` is rebuilt by the build step. `framework/roles/lead.yaml` is not changed by this decision (decision 12 changes only its write rule): the mode coordinators' prompt says "run each step plan exactly as it says" and the Chief of Staff text is the one that dispatches.
- This is prose for the coordinator, not a check in the dispatcher: bay cannot know that a diff was read. The note lands in the ledger (`bay note`, read by `bay status`), so you can see whether it was written.

**Test that fails on main:** `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417), in the plan-with-front-matter case of decision 1: the envelope carries `blastRadius`, and a plan step without it, or without `dryRun.blastRadius`, is refused; main has neither field. `adapters/claude-code/tests/test_adapter.py::test_adapter_round_trip` (:24): the generated `COORDINATOR.md` holds the diff-against-acceptance rule; main's text (`playbook.md:22-26`) does not.

### 9. Verbatim to-do steps, and fresh agents for changed tasks

**Where it is today.** `bay plan` records an outcome and a to-do list of `{text, serves}` items, once per taskId, with at most 12 items of 240 characters (`bay/ledger.py:21`, `record_plan` :83-103); `--done <n>` ticks one (`record_done` :106-113, folded by `plans` :150-162). `_require_plan` (`bay/dispatch.py:130-143`) only checks that some plan exists for the run. The agent writes its own to-do from the goal, so an acceptance criterion can be left out of it, and nothing says that an item was dropped on purpose. The coordinator can also resume an agent with new directives; its plan, which is once per taskId (`ledger.py:85-87`), then no longer matches the task.

**The change.**

- **The to-do starts from the acceptance list.** An agent's `bay plan` to-do starts with the brief's `acceptance` entries, verbatim, one item per acceptance id; the builder's own items (run the suite, write the report) follow. `record_plan` accepts an optional `id` on a to-do item (the acceptance id, which is also its `serves`). The builder prompt (`framework/roles/builder.yaml`) says so and the coordinator prints the same rule under the task block (decision 1).
- **A dropped item stays.** A new `bay plan <taskId> --skip <n> '<reason>'` marks item n as skipped with its reason; `plans()` folds it, and `bay status` shows the item as `skip: <reason>`. The item is not removed and not edited. A skip is stored as an `agent.plan.done` event whose `data.skip` holds the reason: there is no new event type, no `record_skip` and no change to `schemas/event.schema.json`. This needs the form in the subagent guard: `_plan_command` (`bay/guard.py:504-523`) allows exactly `<taskId> '<json>'` and `<taskId> --done <n>` today, and a third form with the same taskId check is added. I chose a command over writing `skip:` into the plan JSON, because a skip is usually decided half way through the work, and the plan is append-only.
- **The dispatcher refuses a plan with a gap.** `_require_plan` (:130-143), for a step with an `envelope`, also checks the plan of the run: for each acceptance id of the envelope there is an item with that `id`, its text equals the acceptance text, and it is done or skipped. The message names the ids. Without an envelope nothing changes. `selfCheck` still needs a line for a skipped id (decision 2), which is where the reason is judged.
- **Fresh agents.** `components/base/cos/playbook.md`, loop step 3, gets a coordinator rule: a changed task (a failed acceptance id, a fix, new directives, a changed brief) is a fresh dispatch with the full brief: a new taskId from `bay note task`, a new `bay note dispatch`, the whole envelope again with `fix` if it is a fix round. Never resume an agent with new directives. This follows from the plan being once per taskId, and it keeps every plan matching the task it answered. The rule is prose in the playbook; the dispatcher cannot see a resume.
- **Plan limits.** Acceptance `text` of at most 240 characters and at most 8 acceptance entries per plan step are checked by `plan_steps` (decision 1), so an acceptance list always fits in a to-do with room for the builder's own items.

**Test that fails on main:** `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14) gets a case: a plan that lacks an acceptance id, or has it with other words, is refused naming the id; the same plan with the item skipped is accepted. Main accepts both. `tests/test_ledger.py::test_bay_plan_records_scrubbed_size_limited_append_only_events` (:189) gets an item with an `id` and a `--skip` with a reason: main rejects the key. `tests/test_boundaries.py::test_bay_plan_is_the_only_bay_command_a_subagent_may_run` (:938) gets the `--skip` form for the agent's own task allowed and for another taskId denied. `adapters/claude-code/tests/test_adapter.py::test_adapter_round_trip` (:24): the generated text holds the fresh-dispatch rule.

### 10. Root causes, no silencing

**Where it is today.** A fix round starts from a failed review item. The reviewer gives an `evidence` line and a `suggestion` per item (`framework/roles/reviewer.yaml:24-31`), and decision 6 adds `weakness`, `places` and `ways`. Nothing asks anyone to show the failure before the fix or to say why it happens. The builder prompt (`framework/roles/builder.yaml:12-29`) says to make the smallest change that meets the deliverable, which a one-line guard also meets. The reviewer prompt has no rule about a fix that hides the problem. So a `None` check, a `try`/`except`, a guard or a `# type: ignore` can turn a review item green while the bug stays.

**The change.**

- **The brief.** The `fix` entry of decision 1 gains two lines next to `weakness`, `places` and `ways`: `reproduce` (a command or test that shows the failure before any change, with its output) and `rootCause` (why it happens, not what it looks like). The reviewer writes both on every failed item, because the verdict schema now requires them (decision 6's `if`/`then`, two more keys). bay copies them into `fix` with the other four; the coordinator does not retype them. A failed item with no reproduce line is refused at the review step, which is the point: a finding nobody can reproduce is not yet a finding.
- **The builder.** `framework/roles/builder.yaml` (:12-29) says, in plain words: in a fix round, first run `reproduce` and see it fail; then change the code that causes the failure, not the code that reports it. A fix that only silences the symptom is refused. A `None` check, a `try`/`except`, a guard or a `# type: ignore` that hides the bug instead of fixing why it happens is a silence. If the failure does not reproduce, or you cannot find the root cause, stop and report (decision 11). The `checked` line of a `fixed` place names the root cause and the test that failed before the change (decision 2).
- **The reviewer.** `framework/roles/reviewer.yaml` (:13-36) says: when you review a fix, fail it if it silences instead of fixes, and say which line hides the failure. Check that the test from `reproduce` fails on the parent commit and passes on the fix. A guard or an exception handler is acceptable when it is the correct behaviour, and the evidence line says why; it is not acceptable when its only job is to stop the failure from showing.
- **Standing stop line.** For a fix round bay adds `the failure cannot be reproduced, or its root cause is not found` to `stop` (decision 11).

**What this does not fix.** bay cannot tell a guard that fixes from a guard that hides: both are a few lines and both make the test pass. The checks that are mechanical are the schema (a failed item carries `reproduce` and `rootCause`) and the standing stop line. Whether a fix addresses the cause stays a reviewer judgment, backed by the failing test from `reproduce` and by your reading of the evidence line. I considered a lint on `# type: ignore` and bare `except`, and did not take it: legitimate uses exist, and a guard on a `None` has no marker to find.

**Test that fails on main:** `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231), in the case of decision 6: a failed item without `reproduce` or without `rootCause` is refused (main accepts it), and the next fix brief's `fix` entry holds both (main builds no `fix`). The prompt rules are text and are checked in `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51), which gains a case: the builder prompt holds the sentences "root cause" and "silences", and the reviewer prompt holds "silences instead of fixes"; main's prompts (`builder.yaml:12-29`, `reviewer.yaml:13-36`) have neither. Whether a real fix silences is not tested; it is the reviewer's call.

### 11. Say no

**Where it is today.** The prompts tell the builder and reviewer what to do and nothing about disagreeing. The builder prompt says to report `partial` if a check cannot run (`builder.yaml:27-28`) but not what to do with a brief that is wrong; the stop conditions of a brief are whatever the plan author wrote (decision 1). The reviewer prompt says "never pass an item without evidence" (`reviewer.yaml:42`), which does not say that a fail is welcome. An agent that finds the brief wrong has an incentive to work around it and hand back something that looks done.

**The change.**

- **Builder prompt** (`framework/roles/builder.yaml:12-29`), in plain words: pushing back is expected. If the brief is wrong, or conflicts with the proposal, stop and report. Do not code around it, and do not build something close to what was asked. Say what is wrong, quote the lines that conflict, and return status `blocked`.
- **Reviewer prompt** (`framework/roles/reviewer.yaml:13-36`), in plain words: an honest fail is expected. Do not agree because the author or the coordinator sounds sure, or because the work looks like what was asked. If an item does not meet its criterion, fail it with the evidence.
- **The brief's "Stop when" field.** `stop` in the template of decision 1 always ends with `the brief or the plan is wrong, or conflicts with the proposal`, added by bay to the plan's own conditions, so a plan author cannot leave it out and a builder always has that permission written in its brief. For a fix round it also ends with the reproduce line of decision 10. Both are constants in the dispatcher, about +4 lines.
- **A stop must be submittable.** A stopped builder has plan items it did not finish, and decisions 2 and 9 refuse a submit that leaves an acceptance id out. The rule: the builder marks each open item `--skip <n> 'stopped: <reason>'`, gives each affected `selfCheck` id the line `not met: stopped, see blockers`, and returns status `blocked` with the reason in `blockers`. So a stop needs no exception in `submit`. I considered exempting `blocked` results from the checks and did not: it would be a second path through the checks and a way to avoid them.
- **The coordinator.** A `blocked` result from a stop is not retried with the same brief. The coordinator reports it to you; if the brief is wrong, the plan step is where it is fixed, and a fresh agent gets the corrected brief (decision 9).

**What this does not fix.** A prompt cannot make an agent disagree. It removes the reason not to: a stop is allowed, it is submittable and it is written in the brief. A reviewer who agrees by default will still pass things; the defences are the evidence requirement and your reading of the review at the gate.

### 12. The lead writes proposals, the builder implements

**Where it is today.** forge.extend's `propose` step runs as the builder (`components/base/forge/mode.yaml:37`, `role: builder`), which the feature places in env framework-dev (`mode.yaml:29`) on its default tier, balanced (Sonnet, `framework/roles/builder.yaml:9`). The plan step runs as the lead on the deep tier (`mode.yaml:39`), and its task says "Write that one file only", the plan; the lead's prompt says the same, "write only the file the task names" (`framework/roles/lead.yaml:20`). So a plan that finds the proposal wrong can only list amendments, and someone else, today a builder, edits the proposal afterwards. That happened in this call: the plan listed twelve amendments, a builder started to apply them and was stopped, and the owner decided that amending a proposal is the lead's work. Nothing in the builder's prompt or description says it does not design (`builder.yaml:5-7`, :12-29).

**Can the lead write `docs/proposals/` today?** Yes, with no env or guard change. The lead's unit for these steps is `lead--forge--framework-dev--step` (`mode.yaml:39`, `roles: { lead: framework-dev }`). Env framework-dev lists `docs` in `fs.write` (`components/base/forge/envs/framework-dev.yaml:36`). The build gives a unit its env's `fs.write` when the role has `access: write` and a write tool (`adapters/claude-code/claude_code.py:381-386`; the lead has `access: write`, `lead.yaml:10`, and Edit and Write from `workspace.write/v1`, `framework-dev.yaml:11-12`). The guard denies a write only outside those paths or into a protected folder the env does not name (`bay/guard.py:336-343`), and `docs/` is neither.

**The change.**

- `components/base/forge/mode.yaml:37`: the propose step becomes `role: lead, roles: { lead: framework-dev }, tier: deep, effort: high`, the same fields the plan step already uses (:39). Its task is unchanged.
- `mode.yaml:39`: the plan task becomes: write the implementation plan to `docs/plans/<id>.md` and amend the proposal `docs/proposals/<id>.md` so the two agree; write those two files only and list both in `artifacts`; implement nothing. The gate hashes the proposal and the plan when it is built (`bay/dispatch.py:419-426`), after the plan step, so the approval covers the amended proposal.
- `framework/roles/builder.yaml` (:12-29) says: you implement briefs and plan steps only; you never write or amend a proposal or a plan; if one is wrong, stop and report (decision 11). The access comment (:10) stops naming the lead.
- `framework/roles/lead.yaml:20` says "write only the files the task names", and the access comment (:10) names forge.extend's propose and plan steps.
- `components/base/forge/features/extend/playbook.md`, step 1 says the lead writes the proposal (opus, high effort, env framework-dev), and step 3 says the plan step also amends the proposal.
- No `bay/` code. The dispatcher already reads a step's `role`, `roles`, `tier` and `effort` (the plan step is the precedent), and the unit already exists, so the build still resolves 21 role units.

**Other modes.** No other mode uses the builder for a proposal or a plan. forge.create's `fill` step (`mode.yaml:20`) is a builder filling the files a scaffold wrote, from the intent, in user space. It writes no proposal or plan and has no gate, and the reviewer checks it. It is a brief, so it is out of scope. delivery.build's `implement` (`components/base/delivery/mode.yaml:29`) implements. improve.implement's `draft` (`components/base/improve/mode.yaml:78`) writes a proposal draft, but as the analyst, not the builder, so the builder text does not touch it. It is out of scope too.

**Cost.** 0 `bay_lines` and 0 `kit_python_lines`: the change is YAML and prompt text, and the limits count only `.py` files (`bay/limits.py:56-86`). `tests` stays 463. Text: two step lines edited in mode.yaml, two sentences in builder.yaml, two lines edited in lead.yaml, two playbook steps edited. The propose step now runs on Opus at high effort instead of Sonnet, once per forge.extend call that drafts a proposal; this proposal does not measure that price.

**Test that fails on main:** `tests/test_dispatch.py::test_gate_stops_and_resumes_only_on_approval` (:205) asserts that the propose step runs as `builder--forge--framework-dev` (:211). The case changes to `lead--forge--framework-dev--step` at model `opus`, which fails on main. `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) gains a case: the builder prompt holds "never write or amend a proposal or a plan", and the lead prompt holds "the files the task names". Main's prompts (`builder.yaml:12-29`, `lead.yaml:20`) have neither.

**Test that fails on main:** `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) gains a case: the builder prompt holds the sentences "pushing back is expected" and "stop and report", and the reviewer prompt holds "an honest fail is expected". This is how a text-only change is checked: an existing role-prompt test asserts that the sentence is present. Main's prompts have none of them. `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417), in the case of decision 1: the `stop` of the built envelope ends with the standing line; main builds no `envelope`. `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14): a `blocked` result whose open items are skipped and whose `selfCheck` lines say `not met` is accepted; the same result with an item neither done nor skipped is refused naming it.

## Details

### Compatibility and safety

- **Contracts.** Every schema change adds optional keys (TaskEnvelope including `blastRadius`, Result in both places) or conditional requirements on a verdict item that fails. No existing document becomes invalid, so `agentbay/v4` and the v1 data contracts stay (DOD-11). If you read DOD-11 strictly for the verdict `if/then`, which tightens what a reviewer may submit, the alternative is a `review.verdict/v2`; I do not recommend it for a field only the reviewer role writes and only this dispatcher reads.
- **What breaks, with no alias (B-12).** A plan without the front matter is refused at the plan step. A builder result for an implement step without `selfCheck` is refused. A failed verdict item without `weakness`, `places`, `ways`, `reproduce` and `rootCause` is refused, in every mode's review and by `bay note review`. A plan step without `blastRadius`, a submit whose plan lacks an acceptance id as done or skipped, and a `nit` that used to halt a call are new behaviour with no switch. The propose step is dispatched to `lead--forge--framework-dev--step` instead of `builder--forge--framework-dev`, so a coordinator that hard-codes the old subagent name runs the wrong one; the step plan names the new one. Plans and calls already approved are unaffected: the gate holds the plan's exact content, and an open call that already passed the plan step has no envelope to check against (the envelope is built from the plan on the step's turn, and the check applies only when one was built).
- **No backward-compatibility code.** There is no reader for the free-form plan and no shim for results without `selfCheck` on envelope steps. Steps without an envelope (forge.create, delivery.build, the release step) are not weakened: they never had acceptance ids.
- **Safety.** No secret is read, written or shown. The new `check --standards` writes only under a temporary directory, as `standards.check` does (`bay/standards.py:103`). The guard gains one allowed form, `bay plan <taskId> --skip <n> '<reason>'`, with the same taskId and agent check as `--done`; it can write only to the agent's own plan, as `--done` does. `bay/dispatch.py`, `bay/cli.py` and `bay/guard.py` are on the sensitive list, so this proposal gets a plan. Builders stay on Sonnet for every proposal, this one included; the lead writes proposals and plans on Opus (decision 12), and reviews stay on Opus. The lead gains no write path: env framework-dev already lets it write `docs/` (decision 12).
- **Extensibility (DOD-4).** A new source is still one connector and one binding line.
- **Risks.** (a) The plan becomes longer because it carries the acceptance and the dry-run; its review is the owner's, at the gate. (b) A step plan with many criteria makes the builder's selfCheck long; the line is one per id and the dispatcher counts ids, not words. (c) A reviewer can mislabel a real defect as a nit (decision 7); the defence is the prompt definition and the evidence line you read. (d) The coordinator rules of decisions 8 and 9 are prose; bay checks the plan and the result, not that a diff was read or that no agent was resumed. (e) The packed-code rule cannot tell intent: a two-`for` comprehension that reads clearly is still a finding for a new one. That is your decision 5; the way out is a nested `for` loop. (f) Whether a fix addresses the root cause or hides the symptom is a judgment only the reviewer makes (decision 10); the reproduce test makes it easier to see, not automatic. (g) Pushback is a prompt and a brief line (decision 11): it removes the reason to code around a bad brief, and cannot force an agent to disagree. (h) The role split is a prompt rule for the builder (decision 12): the guard still lets a framework-dev builder write `docs/proposals/`, because the same env serves the implement step, which updates docs. What changes is who is dispatched to design.

### Tests and limits

**Tests.** `tests` stays 463. All new checks, decisions 6 to 12 included, are cases inside existing tests; no function is added and none is removed. The tests named under each decision fail on main. Decisions 10 and 11 are mostly prompt and template text, so the table also says how each part is checked: a role-prompt test asserts that the sentence is present, a dispatcher test asserts the built envelope and the verdict schema, and what only a reviewer can judge is named as such:

| Decision | Test (existing function, new case) | Why it fails on main |
|---|---|---|
| 1 | `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417) | the executor brief (`dispatch.py:715-728`) has no `envelope`; a plan without acceptance is accepted |
| 2 | `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14); `tests/test_dispatch.py::test_the_step_result_accepts_what_the_worker_contract_returns` (:383) | `submit` has no selfCheck check; the Result schema forbids the key |
| 3 | `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) | the builder prompt (`builder.yaml:12-29`) has no stop rule |
| 4 | `tests/test_dispatch.py::test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval` (:358); `tests/test_cli_commands.py::test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json` (:37) | no `dryRun` check; no `--standards` flag |
| 5 | `components/base/python/tests/test_python_check.py::test_python_findings_are_blocked_only_when_new_against_the_call_start` (:309) | neither shape is a finding |
| 6 | `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231) | `weakness` is not required; no `earlier` |
| 7 | `tests/test_dispatch.py::test_agentic_step_returns_plan_then_review_then_partial_on_failed_must` (:71) | a failed must item with severity `nit` ends `partial` (`dispatch.py:630-636`) |
| 8 | `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417); `adapters/claude-code/tests/test_adapter.py::test_adapter_round_trip` (:24) | no `blastRadius` in the envelope or the plan check; the coordinator text has no diff rule |
| 9 | `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14); `tests/test_ledger.py::test_bay_plan_records_scrubbed_size_limited_append_only_events` (:189); `tests/test_boundaries.py::test_bay_plan_is_the_only_bay_command_a_subagent_may_run` (:938); `adapters/claude-code/tests/test_adapter.py::test_adapter_round_trip` (:24) | `_require_plan` (:130-143) checks no acceptance id; the plan item has no `id`; no `--skip` form; no fresh-dispatch rule |
| 10 | `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231); `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) | a failed item without `reproduce` and `rootCause` is accepted and no `fix` is built; neither prompt has the root-cause or silencing sentences. Prompt text is checked by presence of the sentence; whether a given fix silences is the reviewer's call and has no test |
| 11 | `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51); `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417); `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14) | neither prompt says pushing back or an honest fail is expected; the built `stop` has no standing line (there is no envelope); there is no rule for a stopped builder's submit. The prompt sentences are checked by presence |
| 12 | `tests/test_dispatch.py::test_gate_stops_and_resumes_only_on_approval` (:205); `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) | the propose step runs as `builder--forge--framework-dev` (`mode.yaml:37`, asserted at :211); neither the builder nor the lead prompt has the role split. The prompt sentences are checked by presence |

The plan step confirms each test fits its case, or names a better existing one. Fixtures added are written one source line per line.

**Limits.** All nine measures are at their ceiling today (`./bay.sh check --limits` on main: "9 measures within their ceilings", and `framework/limits.yaml`: bay_lines 9703, kit_python_lines 5276, cli_commands 16, framework_folders 2, schemas 16, top_level_folders 7, tests 463, long_lines 134, comment_lines 0).

| Measure | Ceiling | After (measured in the plan) | Verdict |
|---|---|---|---|
| `bay_lines` | 9703 | 9896 readable (+193, measured), exception to 9935 with a buffer of 39 | over: exception |
| `kit_python_lines` | 5276 | 5322 readable (+46, measured), exception to 5331 with a buffer of 9 | over: exception |
| `tests` | 463 | 463 | cases only |
| `long_lines` | 134 | 133 | none written; one existing long line in `_require_plan_file` is split |
| `cli_commands` 16, `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | `--standards` is a flag of `check`; no schema file; nothing at the root; no comment |

By file, measured in the plan on readable, typed code: `dispatch.py` +119 (envelope, selfCheck coverage, plan-step counter, earlier reviews, to-do coverage and the standing stop lines 97; plan check at the plan step, the gate and approval 15; `check --standards` 6; nit filter 1), `proposal.py` +40 (`plan_steps` and its checks), `cli.py` +24 (`check --standards` 17 with the typed `_system`, `plan --skip` 7), `ledger.py` +8 (item `id`, the skip reason on `record_done`, the fold), `guard.py` +2 (the `--skip` form), `python_check.py` +46 (two row kinds). Together +193 `bay_lines` and +46 `kit_python_lines`; decision 12 adds 0 to both. Decisions 10 and 11 otherwise need no line budget: the role prompts are YAML, the verdict schema is JSON, and the brief template is proposal text, none of which `bay_lines` or `kit_python_lines` counts. The Python test files are not counted by `bay_lines` or `kit_python_lines` (`bay/limits.py:51-70`). If an exception must be lower, the first cut is `check --standards` (-23 `bay_lines`), with decision 4 then resting on a manual dry-run described in the plan; the second is `earlier` in the review brief (about -20); the third is `plan --skip`, with a skip then written into the plan JSON at record time (-17 across cli.py, ledger.py and guard.py, and the guard stays unchanged).

**Docs.** DESIGN.md and INTERFACES.md are at 3000 words each (`len(text.split())`). The additions (a paragraph in DESIGN; the envelope fields, plan front matter, selfCheck and verdict fields in INTERFACES) are estimated at +60 and +90 words, paid for by cuts in the same files; the plan measures it by applying draft text to copies, as 0021 did.

### Out of scope

- End-to-end tests that drive a feature to its end without stubs: proposal 0017.
- Briefs for forge.create, delivery.build and the other modes: they have no plan, so the schema describes the fields but bay builds nothing.
- Any change to the review budget (`reviewer.yaml:12`), to the number of review rounds (R-1) or to what blocks a call.
- A check for density beyond the two shapes in decision 5.
- A lint that finds silencing fixes (`# type: ignore`, bare `except`, a `None` guard): decision 10 is a brief field, a prompt rule and a reviewer judgment.
- An exception in `submit` for `blocked` results (decision 11): a stopped builder skips its open items and says `not met` instead.
- Opus builders on sensitive paths: considered, not chosen (owner, 2026-11-05)
- The builder in forge.create's `fill` step and the analyst in improve.implement's `draft` step (decision 12): neither is a builder writing a forge proposal or plan.
- A two-model review panel: considered and not chosen by the owner on 2026-11-05. The review stays one reviewer, one round (R-1).
- Dispatcher enforcement of the coordinator's rules in decisions 8 and 9 (that a diff was read, that no agent was resumed): bay cannot see either, so they are playbook text.
- A `review.verdict/v2` and an `agentbay/v5`.
- Backward-compatibility for old plans, results or verdicts.

### Measured and estimated

Measured on main a7a425d: the nine limit counts above; the word counts of the two docs; every line cited in this proposal, which I read on this commit (the lines cited in decisions 10 and 11, in `builder.yaml` and `reviewer.yaml`, on ebc1427, and those in decision 12 on b961bd6). Measured by the plan on scratch copies of 90cd9a1: the line costs and the two exceptions above; the baseline of decision 5 is 108 comprehension rows in 40 files and 45 fixture rows in 18 files (an `ast` walk over `git ls-files '*.py'`); 1217 guard decisions, 0 changed.

Estimated, and measured by the builder on each step's own commit: the DESIGN and INTERFACES word additions and the count of cases per test. Not measured: the run time of a plan's dry-run (the suite alone takes about two and a half minutes in this environment; 0021's measured 153 seconds, `docs/plans/0021-component-layout.md`), and the length of a plan that carries acceptance and dry-run for each step.
