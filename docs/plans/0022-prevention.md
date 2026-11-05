---
# Plan for docs/proposals/0022-prevention.md. Implements nothing. Measured on scratch copies of feat/prevention at 90cd9a1.
proposal: docs/proposals/0022-prevention.md
steps:
  - id: 1
    outcome: A proposal that touches a SENSITIVE path is implemented by implement-deep on the deep tier (opus); any other proposal by implement on balanced (sonnet).
    context: [docs/proposals/0022-prevention.md#6-sensitive-proposals-implement-on-the-deep-tier, docs/plans/0022-prevention.md#step-1]
    scope:
      in: [components/base/forge/connectors/scaffold/scaffold.py, components/base/forge/interfaces/forge.scaffold.v1.yaml, components/base/forge/mode.yaml, tests/test_dispatch.py, components/base/improve/connectors/improve-detect/tests/test_deadcode_check.py]
      out: [bay/, schemas/, framework/roles/]
    acceptance:
      - { id: A1, text: "forge.scaffold/v1.proposal returns sensitive: true when touches: is at, under or above a SENSITIVE path, false otherwise, also when the plan file exists", evidence: "a case in test_an_edit_after_approval_makes_the_gate_run_again, failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a proposal touching bay/dispatch.py reaches step implement-deep at model opus; one touching only README.md reaches implement at sonnet", evidence: "the same test, the part at tests/test_dispatch.py:512-520, quoting next.step and next.model", dod: [DOD-3, DOD-12] }
      - { id: A3, text: "implement and implement-deep share one task text, written once as a YAML anchor", evidence: "git show of components/base/forge/mode.yaml", dod: [DOD-10] }
      - { id: A4, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass; kit_python_lines grows by at most 8", evidence: "the three outputs quoted, with the kit_python_lines count", dod: [DOD-12, DOD-15] }
    limits: { lines: "kit_python_lines +6 readable, stop above +8", tests: "no test function added", style: ["no # comment", "no comprehension with two for"] }
    stop: ["a step other than implement needs a tier of its own", "the model resolver needs a change to choose the tier"]
    blastRadius: "the forge.extend step list (every test that walks it, the deadcode test pins implement next to deadcode), the ledger step name forge.extend.implement that improve reads, and the open 0022 call"
    dryRun: { suite: "in snapshot sC (all steps): see Dry runs; alone this step breaks only test_deadcode_check:265", limits: "kit_python_lines +6 (scaffold.py 56 -> 62)", standards: "0 new findings once is_sensitive is typed", blastRadius: "grep of test code for the implement step id: 40 hits; 1 asserts the order (test_deadcode_check:265), the rest submit or read implement" }
  - id: 2
    outcome: Result carries selfCheck, checked and planStep, the envelope has the new optional keys, and a failed verdict item must carry weakness, places, ways, reproduce and rootCause.
    context: [docs/proposals/0022-prevention.md#2-the-builder-reports-a-self-review, docs/proposals/0022-prevention.md#7-the-reviewer-reports-the-class-and-sees-earlier-verdicts]
    scope:
      in: [schemas/task.schema.json, components/base/forge/types/Result.schema.json, schemas/data/review.verdict.v1.schema.json, tests/test_dispatch.py, tests/test_review_record.py, components/base/improve/tests/test_improve.py]
      out: [bay/, every other schema]
    acceptance:
      - { id: A1, text: "a failed verdict item without one of weakness, places, ways, reproduce or rootCause is refused, naming the missing key", evidence: "a case in test_failed_review_halts_before_release, failing on 90cd9a1", dod: [DOD-11] }
      - { id: A2, text: "a forge step result with selfCheck, checked and planStep is accepted", evidence: "a case in test_the_step_result_accepts_what_the_worker_contract_returns (:383), failing on 90cd9a1 with additionalProperties", dod: [DOD-11] }
      - { id: A3, text: "every fixture with a failed verdict item carries the five keys: test_dispatch.py, test_review_record.py, components/base/improve/tests/test_improve.py", evidence: "the four tests that fail on the schema alone pass: names quoted", dod: [DOD-12] }
      - { id: A4, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass; schemas stays 16", evidence: "the three outputs quoted", dod: [DOD-12, DOD-15] }
    limits: { lines: "0 bay_lines; JSON only", tests: "no test function added", style: ["places and ways are lists of strings, the other three are strings"] }
    stop: ["a document already in the tree or the ledger becomes invalid", "a schema file has to be added"]
    blastRadius: "review.verdict/v1 is shared: every mode's review step and `bay note review` (cli.py:484) now need the five keys on a fail, not only forge.extend; existing stored verdicts are not re-validated"
    dryRun: { suite: "schemas alone (s1): 572 passed, 4 failed: test_agentic_step_returns_plan_then_review_then_partial_on_failed_must, test_failed_review_halts_before_release, test_review_record_appends..., test_failed_triage_review_stores_nothing", limits: "unchanged", standards: "0 new", blastRadius: "the 4 failures are 2 modes (feed-briefing, improve) and bay note review" }
  - id: 3
    outcome: A failed must item of severity nit no longer ends a call partial; the release lists nits in followups.
    context: [docs/proposals/0022-prevention.md#8-nits-never-block]
    scope:
      in: [bay/dispatch.py (_accept_review), components/base/forge/features/extend/rules.yaml, components/base/forge/mode.yaml (release task), tests/test_dispatch.py]
      out: [the verdict schema, the blocker clause]
    acceptance:
      - { id: A1, text: "a verdict that fails a must id with severity nit leaves the call done; with should-fix it still ends partial", evidence: "a case in test_agentic_step_returns_plan_then_review_then_partial_on_failed_must (:71), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "R-8 says a nit never makes the result partial, even on a must item", evidence: "git show of rules.yaml", dod: [DOD-3] }
      - { id: A3, text: "the release task asks for one followups line per failed nit, as nit <id>: <suggestion>", evidence: "git show of mode.yaml", dod: [DOD-3] }
      - { id: A4, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass; bay_lines grows by 1", evidence: "the three outputs quoted, with bay_lines", dod: [DOD-12, DOD-15] }
    limits: { lines: "bay_lines +1, stop above +2", tests: "no test function added", style: ["no packed lines"] }
    stop: ["the filter needs more than two lines"]
    blastRadius: "_accept_review serves every mode, so a nit on a must item stops halting feed-briefing, mail-briefing, todo, improve and delivery reviews too; recheck reads state.review.failed, which no longer lists the nit"
    dryRun: { suite: "in sC: see Dry runs; no test asserts that a nit halts (grep nit in tests: no such case)", limits: "bay_lines +1 measured", standards: "0 new", blastRadius: "grep FAIL_LEVELS and severity in bay/: one reader, _accept_review" }
  - id: 4
    outcome: python-check reports a comprehension with more than one for or inside another, and a one-line source fixture in a test file; the 108 and 45 cases in the tree are baseline.
    context: [docs/proposals/0022-prevention.md#5-a-no-packing-check-in-python-check]
    scope:
      in: [components/base/python/connectors/python-check/python_check.py, components/base/python/connectors/python-check/README.md, components/base/python/tests/test_python_check.py]
      out: [ruff and mypy settings, bay/standards.py]
    acceptance:
      - { id: A1, text: "a new double-for comprehension and a new one-line fixture each block the standards step; an unchanged old case does not", evidence: "three cases in test_python_findings_are_blocked_only_when_new_against_the_call_start (:309), failing on 90cd9a1", dod: [DOD-17] }
      - { id: A2, text: "a fixture written one source line per line (triple-quoted or a list of lines) is not a finding", evidence: "a case in the same test", dod: [DOD-17] }
      - { id: A3, text: "rows use one fixed message per rule with no line number in it", evidence: "the two message constants quoted from python_check.py", dod: [DOD-8] }
      - { id: A4, text: "the README names both rules and how to write the code instead", evidence: "git show of the README", dod: [DOD-13] }
      - { id: A5, text: "the suite, ./bay.sh check, --limits and --standards pass; kit_python_lines grows by at most 52", evidence: "the four outputs quoted", dod: [DOD-12, DOD-15, DOD-17] }
    limits: { lines: "kit_python_lines +46 readable, stop above +52", tests: "no test function added", style: ["new fixtures one source line per line", "the rule's own code has no two-for comprehension"] }
    stop: ["a baseline case is reported as new", "the rule needs a line number in its message"]
    blastRadius: "every later step and every forge.create or delivery call with the standards step: a new packed comprehension anywhere in the tree now blocks; the multiset compare keeps the 153 existing rows as baseline"
    dryRun: { suite: "in sC: see Dry runs", limits: "python_check.py 317 -> 363 (+46)", standards: "0 new on sC against the base", blastRadius: "the new rows over git ls-files '*.py': 108 packed-comprehension rows in 40 files, 45 packed-fixture rows in 18 files" }
  - id: 5
    outcome: A to-do item may carry the acceptance id, and `bay plan <taskId> --skip <n> '<reason>'` marks an item skipped with its reason, for the agent's own task only.
    context: [docs/proposals/0022-prevention.md#10-verbatim-to-do-steps-and-fresh-agents-for-changed-tasks]
    scope:
      in: [bay/ledger.py, bay/cli.py (cmd_plan, plan parser, help line), bay/guard.py (_plan_command), tests/golden/guard-matrix.json, tests/test_ledger.py, tests/test_boundaries.py]
      out: [schemas/event.schema.json, any new event type]
    acceptance:
      - { id: A1, text: "record_plan accepts an optional id on a to-do item and rejects any other new key", evidence: "a case in test_bay_plan_records_scrubbed_size_limited_append_only_events (:189), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a skip is an agent.plan.done event with data.skip; plans() marks the item done and keeps the reason", evidence: "the same test, quoting the folded item", dod: [DOD-3] }
      - { id: A3, text: "the guard allows --skip for the agent's own taskId and denies it for another taskId and for any other shape", evidence: "cases in test_bay_plan_is_the_only_bay_command_a_subagent_may_run (:938)", dod: [DOD-2] }
      - { id: A4, text: "the guard golden matrix changes in deny reasons only: 0 of 1217 decisions differ", evidence: "a decision-by-decision compare of old and new guard-matrix.json, quoted", dod: [DOD-2, DOD-12] }
      - { id: A5, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass; cli_commands stays 16", evidence: "the three outputs quoted", dod: [DOD-12, DOD-15] }
    limits: { lines: "bay_lines +17 readable (ledger 8, cli 7, guard 2), stop above +21", tests: "no test function added", style: ["no packed lines"] }
    stop: ["the skip needs a new event type", "a guard decision other than the --skip form changes"]
    blastRadius: "the guard decides every Bash call of every subagent; 15 deny reasons in the golden matrix change text; plans() is read by bay show, bay status --agents and the review brief's recordedPlans"
    dryRun: { suite: "in sC: see Dry runs", limits: "ledger 318 -> 326, guard 643 -> 645", standards: "0 new", blastRadius: "guard matrix captured on the scratch tree: 1217 decisions, 0 changed, 15 reasons changed" }
  - id: 6
    outcome: The plan step and the gate refuse a plan without a valid front-matter steps list, naming the step number and the field.
    context: [docs/proposals/0022-prevention.md#1-one-brief-format-built-from-the-plan, docs/plans/0022-prevention.md#where-the-proposal-is-wrong]
    scope:
      in: [bay/proposal.py (plan_steps), bay/dispatch.py (_require_plan_file, approve, _plan_steps), components/base/forge/mode.yaml (plan task), tests/test_dispatch.py]
      out: [the free-form plans already in docs/plans/]
    acceptance:
      - { id: A1, text: "a plan step without acceptance, blastRadius or dryRun.standards is refused at the plan step with plan step <n>: missing <field>", evidence: "a case in test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval (:358), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a plan edited at the gate into one without steps cannot be approved", evidence: "a case in test_an_edit_after_approval_makes_the_gate_run_again, quoting the refusal", dod: [DOD-3] }
      - { id: A3, text: "an acceptance text over 240 characters, a 9th entry or an unknown DoD id is refused", evidence: "three cases in the test of A1, each quoting the message", dod: [DOD-3] }
      - { id: A4, text: "this plan, docs/plans/0022-prevention.md, passes plan_steps", evidence: "plan_steps run on this file, output quoted", dod: [DOD-3] }
      - { id: A5, text: "the suite, ./bay.sh check, --limits and --standards pass", evidence: "the four outputs quoted", dod: [DOD-12, DOD-15, DOD-17] }
    limits: { lines: "bay_lines +55 readable (proposal.py 40, dispatch.py 15), stop above +60", tests: "no test function added", style: ["typed defs, so mypy adds no finding"] }
    stop: ["an approved plan of another proposal has to be read"]
    blastRadius: "every forge.extend plan step and gate with a plan; tests that write a plan file (test_dispatch 0097-plan) now need front matter; approve.plans plans (docs/plans/<callId>-<step>.md) are not checked"
    dryRun: { suite: "in sA without the fixture: test_an_edit_after_approval failed on the free-form plan; with PLAN_FM it passes", limits: "proposal.py 50 -> 90", standards: "0 new after typing", blastRadius: "the 0097 plan fixture is the only plan file written by a test with a gate" }
  - id: 7
    outcome: For a planned proposal the implement brief carries an envelope built from the current plan step, the step stays open until every plan step has an accepted result, and a fix round gets a fix envelope.
    context: [docs/proposals/0022-prevention.md#1-one-brief-format-built-from-the-plan, docs/proposals/0022-prevention.md#2-the-builder-reports-a-self-review, docs/proposals/0022-prevention.md#11-root-causes-no-silencing]
    scope:
      in: [bay/dispatch.py, tests/test_dispatch.py, tests/test_submit_needs_plan.py]
      out: [forge.create, delivery.build, steps without an approved plan and no failed review]
    acceptance:
      - { id: A1, text: "the implement brief of a planned proposal has envelope with goal, scope, acceptance, dod, limits, stop ending with the standing line, and blastRadius", evidence: "a case in test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate (:417), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a result missing a selfCheck line for an acceptance or DoD id is refused, naming the ids", evidence: "a case in test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan (:14)", dod: [DOD-3] }
      - { id: A3, text: "a submit whose to-do lacks an acceptance id, or has other words, is refused; done or skipped is accepted", evidence: "cases in the same test", dod: [DOD-3] }
      - { id: A4, text: "a plan with two steps returns implement twice, with planStep 1 then 2, before deadcode", evidence: "a case in the test of A1", dod: [DOD-3] }
      - { id: A5, text: "after a failed review the next implement brief has fix with id, weakness, places, ways, reproduce and rootCause, and stop ends with the reproduce line", evidence: "a case in test_failed_review_halts_before_release (:231)", dod: [DOD-3] }
      - { id: A6, text: "the review brief carries earlier: failed items and passed ids of every earlier review of the same files", evidence: "a case in test_failed_review_halts_before_release", dod: [DOD-3] }
      - { id: A7, text: "a blocked result with open items skipped and selfCheck lines not met: stopped is accepted", evidence: "a case in test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan", dod: [DOD-3] }
      - { id: A8, text: "the suite, ./bay.sh check, --limits and --standards pass", evidence: "the four outputs quoted", dod: [DOD-12, DOD-14, DOD-15, DOD-17] }
    limits: { lines: "bay_lines +97 readable, stop above +110", tests: "no test function added", style: ["typed defs", "no two-for comprehension: write the loop"] }
    stop: ["a call with no approved plan and no failed review gets an envelope", "submit needs a path that skips the checks for blocked results"]
    blastRadius: "every forge.extend implement and review step; the failed-review re-run test now submits selfCheck and checked; the open 0022 call is safe because its implement brief is built before this code exists"
    dryRun: { suite: "sA without test updates: test_failed_review_halts_before_release refused the fix-round submit (selfCheck); with the update it passes", limits: "dispatch.py 868 -> 987 for steps 3, 6, 7 and 8 together", standards: "16 new on the first draft (untyped defs), then 2 packed comprehensions; 0 after", blastRadius: "bay show never rebuilds a plan (dispatch.py:206-208), so the envelope is built only in _advance" }
  - id: 8
    outcome: "`./bay.sh check --standards [--base <ref>]` runs the forge.extend standards step by hand, prints the new findings and writes nothing."
    context: [docs/proposals/0022-prevention.md#4-plans-dry-run-the-pipeline-on-a-scratch-copy]
    scope:
      in: [bay/cli.py (check parser, cmd_check, _print_standards), bay/dispatch.py (standards_by_hand), tests/test_cli_commands.py]
      out: [bay/standards.py, the guard]
    acceptance:
      - { id: A1, text: "check --standards prints each new finding and a count line, and exits 1 when there is a new finding", evidence: "a case in test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json (:37), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "the run writes nothing in the project: git status is the same before and after", evidence: "the same test, comparing git status output", dod: [DOD-2] }
      - { id: A3, text: "cli_commands stays 16; the guard treats the flag as read-only", evidence: "./bay.sh check --limits output and the guard matrix unchanged by this step", dod: [DOD-15] }
      - { id: A4, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass", evidence: "the three outputs quoted", dod: [DOD-12, DOD-15] }
    limits: { lines: "bay_lines +23 readable (cli 17 with the typed _system, dispatch 6), stop above +28", tests: "no test function added", style: ["typed defs"] }
    stop: ["the flag needs a guard change"]
    blastRadius: "check with --base also runs the boundary check, so check --standards --base <ref> runs both; the plan lead and builders gain no new command, ./bay.sh check is already in framework-dev clis"
    dryRun: { suite: "in sC: see Dry runs", limits: "cli.py 842 -> 866 with step 5", standards: "the command itself, on the scratch tree: 13.8 s, then 0 new finding(s), 1698 existing", blastRadius: "git status on the scratch tree after the run: unchanged" }
  - id: 9
    outcome: The builder and reviewer prompts, the coordinator playbook and the extend playbook carry the rules of decisions 2, 3, 7, 8, 9, 10, 11 and 12.
    context: [docs/proposals/0022-prevention.md#9-blast-radius-and-the-coordinator-owns-the-diff, docs/proposals/0022-prevention.md#12-say-no]
    scope:
      in: [framework/roles/builder.yaml, framework/roles/reviewer.yaml, components/base/cos/playbook.md, components/base/forge/features/extend/playbook.md, tests/test_roles.py, adapters/claude-code/tests/test_adapter.py]
      out: [.agentbay/COORDINATOR.md (regenerated by build), framework/roles/lead.yaml]
    acceptance:
      - { id: A1, text: "the builder prompt holds: selfCheck, --skip, ceiling, root cause, silences, pushing back is expected, stop and report", evidence: "a case in test_shipped_roles_are_five_generic_framework_roles_without_data_access (:51)", dod: [DOD-3] }
      - { id: A2, text: "the reviewer prompt holds the nit definition, the class search, earlier, silences instead of fixes and an honest fail is expected", evidence: "the same test", dod: [DOD-3] }
      - { id: A3, text: "the generated COORDINATOR.md holds the envelope rule, the diff-against-acceptance note and the fresh-dispatch rule", evidence: "a case in test_adapter_round_trip (:24)", dod: [DOD-3] }
      - { id: A4, text: "the extend playbook steps 3, 5 and 10 say plan format, implement-deep and nits in followups", evidence: "git show of playbook.md", dod: [DOD-13] }
      - { id: A5, text: "the suite and ./bay.sh check pass", evidence: "both outputs quoted", dod: [DOD-12] }
    limits: { lines: "0 bay_lines; text only", tests: "no test function added", style: ["plain words"] }
    stop: ["a sentence needs a rule the proposal does not have"]
    blastRadius: "builder.yaml and reviewer.yaml serve every mode's builder and reviewer units (21 role units), so delivery, forge.create and every mode's review read the new text; the cos playbook is the source of every project's COORDINATOR.md"
    dryRun: { suite: "in sC: see Dry runs", limits: "unchanged by text", standards: "0 new", blastRadius: "./bay.sh check resolves 21 role units after the text change" }
  - id: 10
    outcome: README, DESIGN and INTERFACES describe the brief format, the plan front matter, selfCheck, check --standards and plan --skip; DESIGN and INTERFACES stay at 3000 words.
    context: [docs/proposals/0022-prevention.md#tests-and-limits]
    scope:
      in: [README.md, docs/DESIGN.md, docs/INTERFACES.md]
      out: [docs/proposals/, docs/plans/]
    acceptance:
      - { id: A1, text: "README names check --standards, plan --skip, selfCheck and the plan front matter", evidence: "git show of README.md", dod: [DOD-13] }
      - { id: A2, text: "INTERFACES lists the envelope keys, the plan steps fields, selfCheck, checked and the five verdict keys", evidence: "git show of docs/INTERFACES.md", dod: [DOD-13] }
      - { id: A3, text: "DESIGN and INTERFACES are each at most 3000 words", evidence: "len(text.split()) for both, quoted", dod: [DOD-13] }
      - { id: A4, text: "./bay.sh check --docs --base origin/main passes", evidence: "its output quoted", dod: [DOD-12] }
    limits: { lines: "0 bay_lines", tests: "no test function added", style: ["each added word paid for by a cut in the same file"] }
    stop: ["the additions cannot be paid for by cuts"]
    blastRadius: "B-11 on the core docs and the improve doc-size and doc-stale detectors read these files"
    dryRun: { suite: "not run: text only", limits: "words measured on 90cd9a1: DESIGN 3000, INTERFACES 3000, README 1982", standards: "not run: no Python", blastRadius: "not dry-run: the draft text is the builder's; the plan only measured the budgets" }
  - id: 11
    outcome: Version 4.1.0 is released with the measured ceilings written by the release step.
    context: [components/base/forge/features/extend/playbook.md]
    scope:
      in: [bay/__init__.py, CHANGELOG.md, framework/limits.yaml]
      out: [everything else]
    acceptance:
      - { id: A1, text: "bay/__init__.py says 4.1.0 and CHANGELOG has a 4.1.0 entry with an Upgrading note for free-form plans and verdicts", evidence: "git show of both files", dod: [DOD-16] }
      - { id: A2, text: "framework/limits.yaml is written once with check --limits --write --base origin/main --proposal docs/proposals/0022-prevention.md", evidence: "the command and its output", dod: [DOD-15] }
      - { id: A3, text: "the Result lists the tag, push and gh release create commands and the release text", evidence: "the Result", dod: [DOD-16] }
    limits: { lines: "0", tests: "unchanged", style: [] }
    stop: ["a count is over its exception"]
    blastRadius: "every later call starts from the new ceilings"
    dryRun: { suite: "covered by sC", limits: "sC counts, see Costs", standards: "not run: release-standards runs it", blastRadius: "read of framework/limits.yaml" }
---

# Plan 0022: prevention

## Summary

This plan is for proposal 0022 (feat/prevention at 90cd9a1, 4.0.0). It implements nothing. It is also the first plan
written in the format the proposal introduces: the front matter above lists each step with its scope, acceptance
A1..An with evidence, limits, stop conditions, blast radius and dry-run. Where this plan and the proposal differ, the
plan wins, and the proposal is amended before the gate (see "Where the proposal is wrong").

I wrote the code of steps 1 to 9 readably on scratch copies under the scratchpad (`p22/`), typed so the standards step
adds no finding, and ran the suite, `./bay.sh check`, `./bay.sh check --limits` and the standards step on them.

- **The design works**, with four holes the proposal does not name. A plan edited at the gate skips the plan-step
  check. A skip as a new event type needs `schemas/event.schema.json`, a sensitive file that is not in `touches:`.
  Small proposals (no plan) get no envelope at all, so decisions 1, 2 and 10 only bite on planned proposals and on
  fix rounds. The proposal never says what a fix round's envelope holds. The plan closes all four (step 6, step 5,
  "Where the proposal is wrong").
- **Decision 6 cannot apply to the call that introduces it.** The open 0022 call computed its `proposal` output
  without `sensitive`, and its mode.yaml has one implement step, so 0022 itself would be implemented on Sonnet.
  That is owner decision 1 below; I recommend doing the deep-tier change first and restarting the call.
- **The shared contracts reach further than the proposal says.** The verdict schema, `_accept_review`, the builder
  prompt and the reviewer prompt serve every mode, not only forge.extend. That is owner decision 2.
- **Costs, measured from readable code:** `bay_lines` 9703 -> 9896 (+193) (the proposal estimated +178);
  `kit_python_lines` 5276 -> 5328 (+52) (estimated +38). With a 20% buffer the exceptions are 9935 and
  5338, not 9917 and 5326. `tests` stays 463, `long_lines` falls to 133, the other measures do not move.
- **The dry runs caught my own draft twice.** The first draft had 16 new standards findings (untyped defs, a
  `sorted` over `Any`, long lines), found by `check --standards` in 14 seconds. With step 4 in the tree, the next
  run found two packed comprehensions in my new dispatcher code. Decisions 4 and 5 work; the line counts include
  the typed, unpacked code.

## Decisions for the owner

1. **The tier of 0022's own implement step.** As written, this call runs implement on `balanced` (Sonnet): the
   `proposal` step ran before `sensitive` existed and an absent value skips `implement-deep`
   (`bay/workflows.py:276-281`). The proposal says this proposal is "the first to be implemented under decision 6"
   (front matter of 0022, Compatibility and safety); as built, it is not.
   - (a) Accept Sonnet for 0022, with the coordinator writing each step's brief by hand from this front matter.
   - (b) **Recommended.** Step 1 is the deep-tier change, so it lands first. After it is committed and accepted,
     the coordinator starts `forge.extend` with `proposal` set and `replaces` this call. The gate is skipped (the
     ledger holds your approval of the unchanged files), `replaces` keeps this call's base for the standards step,
     the proposal step now returns `sensitive: true`, and steps 2 to 11 run on `implement-deep` (Opus).
2. **Who must write the five fix keys.** `review.verdict/v1` is one schema for every review step, and
   `bay note review` (`bay/cli.py:484`) validates against it too. The dry run confirmed it: the schema change alone
   fails a feed-briefing review test, an improve triage test and the `bay note review` test.
   - (a) **Recommended.** Every failed item in every mode carries `weakness`, `places`, `ways`, `reproduce` and
     `rootCause`. One schema and one reviewer prompt, as the proposal writes it. A digest reviewer then writes a
     reproduce line too, which is cheap and makes its fail checkable.
   - (b) Only forge.extend: the five keys stay optional in the schema, and `_accept_review` requires them when the
     target is forge.extend (+3 `bay_lines`).

   The nit rule (step 3) also applies to every mode, because `_accept_review` serves every review step. I see no
   reason to limit it; say so if you do.

## Where the proposal is wrong

Each item is measured or read on 90cd9a1. The amendments are listed at the end of the plan.

- **`_require_plan_file` does not check the forge plan.** The proposal says it "already insists the plan file exists
  and is listed" (`dispatch.py:110-113`). It does that only for an `approve.plans` plan
  (`approves == $steps.<id>.artifacts`); forge.extend's gate approves the proposal and finds the plan by name
  (`_gate_subject`, `dispatch.py:419-426`). Step 6 adds the check through `_gate_subject`, and also at approval,
  because a plan edited while the gate waits was otherwise approved and then crashed the implement brief (seen in
  the dry run: `test_an_edit_after_approval_makes_the_gate_run_again`).
- **No new event type for a skip.** `agent.plan.skip` would need `schemas/event.schema.json` (`:33-34` lists the
  plan types), a sensitive path not in `touches:`. A skip is an `agent.plan.done` event with `data.skip`; there is
  no `record_skip`, `record_done` takes the reason.
- **No envelope without a plan.** bay builds the envelope from the approved plan; a proposal small enough to skip
  the plan step gets none, and its builder result is not checked. Fix rounds are the exception: they always get a
  fix envelope. The proposal's "Steps with no envelope (forge.create, delivery.build)" should add "and forge.extend
  proposals without a plan".
- **The fix-round envelope is unspecified.** The plan decides: in a fix round the envelope has `acceptance: []`,
  `dod` the failed DoD ids, `fix` copied from the failed items, `stop` the two standing lines. There is no plan step
  counter in a fix round. bay finds the round with the same reader as `recheck`.
- **DOD-19 to DOD-21 are named in `touches:` but never defined.** Adding DoD ids also adds three verdicts to every
  extend review. The plan drops them: the new checks are mechanical and already covered by DOD-3 and DOD-17.
- **`check --standards --base <ref>` also runs the boundary check**, because `--base` turns it on (`cli.py:113`).
  That is harmless and read-only, but the proposal says the flag only runs the standards step.
- **Line costs.** Measured readable costs differ by file: see Costs. Both exceptions in the proposal are too low.
- **Decision 5's counts.** The proposal measured 70 two-`for` and 40 nested comprehensions. The rule as specified
  reports one row per outer comprehension: 108 rows in 40 files. The 45 one-line fixtures in 18 files match.
- **Files missing from `touches:`.** `tests/golden/guard-matrix.json` (15 deny reasons change),
  `tests/test_review_record.py`, `components/base/improve/tests/test_improve.py` and
  `components/base/improve/connectors/improve-detect/tests/test_deadcode_check.py` (it pins `implement` right before
  `deadcode`, `:265`).

## Build order

One commit per step, in the order of the front matter. Each ends with the suite, `./bay.sh check` and
`./bay.sh check --limits` green, and `./bay.sh check --standards --base <the call's base>` with no new finding where
the step touches Python.

1. **Deep tier** first, so the remaining steps can run on Opus (owner decision 1).
2. **Schemas**, with the four fixtures that use a failed verdict.
3. **Nits never block**: one condition, R-8 and the release task text.
4. **Packed-code rules**, early, so every later step is checked by them.
5. **To-do ids and `--skip`**, with the guard and its golden matrix.
6. **Plan front matter checked** at the plan step and at the gate.
7. **Envelope, selfCheck, to-do coverage, plan-step counter, fix round, `earlier`.** The largest step; it needs 2,
   5 and 6.
8. **`check --standards`.**
9. **Prompts and coordinator text.**
10. **Docs.**
11. **Release 4.1.0.**

Steps 3, 4 and 8 are independent of the others. Step 9 comes after 7 so the text describes what exists.

## Dry runs

All runs on `git archive` copies of 90cd9a1 under the scratchpad (`p22/`), each turned into a git repo.

| Tree | What it holds | Suite | `bay check` | `--limits` | Standards |
|---|---|---|---|---|---|
| base | 90cd9a1 | 576 passed, 0 failed, 161.7 s | lint clean, 7 modes, 44 features | 9 measures within ceilings | - |
| s1 | step 2 schemas, no fixture changes | 572 passed, 4 failed (the four named in step 2) | - | - | - |
| sA | code of steps 1 to 8, no test changes | 560 passed, 16 failed (table below) | lint clean | bay_lines 9860, kit 5282, long_lines 133 | - |
| sC | steps 1 to 9 with the test fixture changes | 576 passed, 0 failed, 267.0 s | lint clean, 7 modes, 44 features, 21 role units | bay_lines 9891, kit 5328 | 4 new: 2 packed comprehensions in dispatch.py, 2 long lines |
| sD | sC with those 4 fixed | 576 passed, 0 failed, 146.4 s | lint clean, 7 modes, 44 features, 21 role units | bay_lines 9896, kit 5328 (both over: the exceptions), long_lines 133, the rest unchanged | 0 new, 1849 existing |

sD is the tree the costs below are taken from. It does not hold the new test cases each step adds (they cost no
counted lines: test files are not in `bay_lines` or `kit_python_lines`), the README and docs text, or the release.

The 16 failures in sA, by cause, each the blast radius of one step:

| Cause | Tests | Step |
|---|---|---|
| the guard deny reason for `bay plan` names `--skip` | test_guard_decision_matrix (15 reasons, 0 of 1217 decisions changed) | 5 |
| the implement brief built an envelope with no approved plan (fixed: no plan, no envelope) | 12 gate and approval tests in test_dispatch, test_boundaries, test_protection, test_review7a, test_deadcode_check | 7 |
| a plan without front matter is refused | test_an_edit_after_approval_makes_the_gate_run_again | 6 |
| a fix round's result has no selfCheck | test_failed_review_halts_before_release | 7 |
| `implement-deep` sits between implement and deadcode | test_forge_extend_runs_deadcode_and_several_standards_checkers_between_implement_and_review | 1 |

The 12 gate tests were my bug, not the design's: the first `_envelope` assumed an approved plan. It now returns no
envelope without one, and all 12 pass. I did not run each step alone on its own tree; the steps were measured
together, and each failure above is attributed to the step that causes it. The builder runs each step's dryRun
again on its own commit.

## The open 0022 call

The call that carries this plan (C-20261105-128b6d) keeps working while its own code changes under it:

- Its implement brief is built when the gate passes, before step 7 exists, so it has no `envelope` and none of the
  new checks apply to it. `bay show` does not rebuild a brief (`dispatch.py:206-208`).
- After step 1, `implement-deep` follows `implement` in the step list; this call's `proposal` output has no
  `sensitive`, so `implement-deep` is skipped and the cursor goes on to deadcode.
- Its fix round, if any, is a new call that runs the new code: it gets a fix envelope from the failed review, and
  the reviewer of this call must already write the five keys once step 2 has landed.

## Costs

Measured with `wc -l` on readable, typed code (no packing; every new def typed so the standards step adds nothing).

| File | Proposal | Measured |
|---|---|---|
| bay/dispatch.py | +99 | +119 |
| bay/proposal.py | +29 | +40 |
| bay/cli.py | +31 | +24 |
| bay/ledger.py | +14 | +8 |
| bay/guard.py | +5 | +2 |
| **bay_lines** | **+178** | **+193** |
| python_check.py | +35 | +46 |
| scaffold.py | +3 | +6 |
| **kit_python_lines** | **+38** | **+52** |

| Measure | Ceiling | After (measured) | What it costs |
|---|---|---|---|
| `bay_lines` | 9703 | 9896 (+193) | exception to 9935: the measured +193 plus a stated buffer of 20% (39) |
| `kit_python_lines` | 5276 | 5328 (+52) | exception to 5338: the measured +52 plus a stated buffer of 20% (10) |
| `tests` | 463 | 463 | all checks are cases in existing tests |
| `long_lines` | 134 | 133 | none written; one existing long line in `_require_plan_file` is split |
| `cli_commands` | 16 | 16 | `--standards` is a flag, `--skip` an option of `plan` |
| `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | no file, folder or comment added |

If you want the exception lower, the cuts are as the proposal lists: `check --standards` (-23 measured), `earlier`
(about -20), `--skip` (-17 across cli, ledger and guard).

## Risks

- **Sonnet for 0022 itself** (owner decision 1, option a): the largest step, 7, is the one decision 6 was written
  for.
- **Every mode's reviews change** (owner decision 2 and step 3): a reviewer in any mode must write five more keys on
  a fail, and a nit on a must item stops halting any mode.
- **Old plans cannot be re-run.** No compatibility code: a fix round for 0011 or 0021 would read their free-form
  plans and be refused. Neither is open.
- **Typed code is required, not only readable code.** New untyped defs are new mypy findings and block the standards
  step. Builders who do not run `./bay.sh check --standards` find this late, as the first draft here did.
- **The plan-step counter** keeps one `implement` step open across several builder runs; a coordinator that submits
  a result for the wrong plan step gets the next envelope anyway, because bay counts and does not read `planStep`.
- **The prompt rules are not enforced** (decisions 9 to 12): a diff note can be skipped and a reviewer can still agree.
- **The dry run of docs is a budget, not text.** DESIGN and INTERFACES are at 3000 words today; step 10 pays for
  every word with a cut, and the plan did not draft that text.

## Followups (proposal amendments)

1. Owner decision 1: say that 0022 implements on Opus only after step 1 and a restart with `replaces`, or on Sonnet.
2. Owner decision 2: say whether the five fix keys apply to every mode's review.
3. Exceptions: `bay_lines` to 9935 and `kit_python_lines` to 5338, with these measured numbers in
   `reason:`.
4. The per-file costs in `touches:` and the limits table, as measured above.
5. `_require_plan_file` does not cover the forge plan today; the check goes through `_gate_subject`, and approval
   also checks the plan.
6. A skip is `agent.plan.done` with `data.skip`; drop `record_skip`; no event schema change.
7. No envelope for a proposal without a plan, except in a fix round; the fix-round envelope as written here.
8. Drop DOD-19 to DOD-21.
9. `check --standards --base` also runs the boundary check.
10. Decision 5's baseline: 108 comprehension rows in 40 files.
11. Add to `touches:` the four test files and the golden matrix named above.
12. `bay/cli.py`: `_system` gains a type annotation, so a typed caller adds no mypy finding.
