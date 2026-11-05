---
# Plan for docs/proposals/0022-prevention.md. Implements nothing. Measured on scratch copies of feat/prevention at 90cd9a1; amended at b961bd6 for the owner's decisions of 2026-11-05 (Opus builders dropped, fix fields in every mode, the role split).
proposal: docs/proposals/0022-prevention.md
steps:
  - id: 1
    outcome: forge.extend's propose step runs as the lead on the deep tier; the plan step writes the plan and amends the proposal; the builder prompt says it implements briefs and plan steps only, never proposals or plans.
    context: [docs/proposals/0022-prevention.md#12-the-lead-writes-proposals-the-builder-implements]
    scope:
      in: [components/base/forge/mode.yaml (propose and plan steps), framework/roles/builder.yaml, framework/roles/lead.yaml, components/base/forge/features/extend/playbook.md (steps 1 and 3), tests/test_dispatch.py, tests/test_roles.py]
      out: [bay/, schemas/, components/base/forge/envs/, forge.create, improve]
    acceptance:
      - { id: A1, text: "the propose step of forge.extend returns runAs subagent_type=lead--forge--framework-dev--step at model opus", evidence: "the case at tests/test_dispatch.py:211 in test_gate_stops_and_resumes_only_on_approval, failing on b961bd6", dod: [DOD-3] }
      - { id: A2, text: "the plan task says write the plan and amend the proposal so they agree, write those two files only and list both in artifacts", evidence: "git show of components/base/forge/mode.yaml", dod: [DOD-3] }
      - { id: A3, text: "the builder prompt holds: never write or amend a proposal or a plan; the lead prompt holds: the files the task names", evidence: "a case in test_shipped_roles_are_five_generic_framework_roles_without_data_access (:51), failing on b961bd6", dod: [DOD-3] }
      - { id: A4, text: "extend playbook step 1 says the lead writes the proposal, and step 3 says the plan step also amends it", evidence: "git show of playbook.md", dod: [DOD-13] }
      - { id: A5, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass; bay_lines and kit_python_lines unchanged; 21 role units", evidence: "the three outputs quoted", dod: [DOD-12, DOD-15] }
    limits: { lines: "0 bay_lines, 0 kit_python_lines; YAML and prompt text only", tests: "no test function added", style: ["plain words", "the propose step uses the same fields as the plan step"] }
    stop: ["a new role unit or env change is needed", "bay/ code is needed to run the propose step as the lead"]
    blastRadius: "the forge.extend step list and the propose step's subagent name; one test asserts it (test_dispatch.py:211); builder.yaml and lead.yaml serve every mode, so every builder and lead unit reads the new text"
    dryRun: { suite: "not run on a tree of its own: YAML and text only; the one assertion on the propose step's runAs is test_dispatch.py:211", limits: "no counted file changes: the limits count .py files only (bay/limits.py:56-86)", standards: "not run: no Python", blastRadius: "grep of tests for propose and runAs: 1 assertion (:211); grep of components for role: builder: fill, propose, implement, release, delivery implement" }
  - id: 2
    outcome: Result carries selfCheck, checked and planStep, the envelope has the new optional keys, and a failed verdict item must carry weakness, places, ways, reproduce and rootCause in every mode.
    context: [docs/proposals/0022-prevention.md#2-the-builder-reports-a-self-review, docs/proposals/0022-prevention.md#6-the-reviewer-reports-the-class-and-sees-earlier-verdicts]
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
    blastRadius: "review.verdict/v1 is shared, and the owner decided the five keys apply in every mode: every mode's review step and `bay note review` (cli.py:484) need them on a fail; existing stored verdicts are not re-validated"
    dryRun: { suite: "schemas alone (s1): 572 passed, 4 failed: test_agentic_step_returns_plan_then_review_then_partial_on_failed_must, test_failed_review_halts_before_release, test_review_record_appends..., test_failed_triage_review_stores_nothing", limits: "unchanged", standards: "0 new", blastRadius: "the 4 failures are 2 modes (feed-briefing, improve) and bay note review" }
  - id: 3
    outcome: A failed must item of severity nit no longer ends a call partial; the release lists nits in followups.
    context: [docs/proposals/0022-prevention.md#7-nits-never-block]
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
      - { id: A5, text: "the suite, ./bay.sh check, --limits and --standards pass; kit_python_lines grows by at most 55", evidence: "the four outputs quoted", dod: [DOD-12, DOD-15, DOD-17] }
    limits: { lines: "kit_python_lines +46 readable, stop above +55 (the exception)", tests: "no test function added", style: ["new fixtures one source line per line", "the rule's own code has no two-for comprehension"] }
    stop: ["a baseline case is reported as new", "the rule needs a line number in its message"]
    blastRadius: "every later step and every forge.create or delivery call with the standards step: a new packed comprehension anywhere in the tree now blocks; the multiset compare keeps the 153 existing rows (108 + 45) as baseline"
    dryRun: { suite: "in sC: see Dry runs", limits: "python_check.py 317 -> 363 (+46)", standards: "0 new on sC against the base", blastRadius: "the new rows over git ls-files '*.py': 108 packed-comprehension rows in 40 files, 45 packed-fixture rows in 18 files" }
  - id: 5
    outcome: A to-do item may carry the acceptance id, and `bay plan <taskId> --skip <n> '<reason>'` marks an item skipped with its reason, for the agent's own task only.
    context: [docs/proposals/0022-prevention.md#9-verbatim-to-do-steps-and-fresh-agents-for-changed-tasks]
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
    outcome: The plan step, the gate and approval refuse a plan without a valid front-matter steps list, naming the step number and the field.
    context: [docs/proposals/0022-prevention.md#1-one-brief-format-built-from-the-plan, docs/plans/0022-prevention.md#where-the-proposal-was-wrong]
    scope:
      in: [bay/proposal.py (plan_steps), bay/dispatch.py (_require_plan_file, _gate_subject, approve, _plan_steps), components/base/forge/mode.yaml (plan task), tests/test_dispatch.py]
      out: [the free-form plans already in docs/plans/]
    acceptance:
      - { id: A1, text: "a plan step without acceptance, blastRadius or dryRun.standards is refused at the plan step with plan step <n>: missing <field>", evidence: "a case in test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval (:358), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a plan edited at the gate into one without steps cannot be approved", evidence: "a case in test_an_edit_after_approval_makes_the_gate_run_again, quoting the refusal", dod: [DOD-3] }
      - { id: A3, text: "an acceptance text over 240 characters, a 9th entry or an unknown DoD id is refused", evidence: "three cases in the test of A1, each quoting the message", dod: [DOD-3] }
      - { id: A4, text: "this plan, docs/plans/0022-prevention.md, passes plan_steps", evidence: "plan_steps run on this file, output quoted", dod: [DOD-3] }
      - { id: A5, text: "the suite, ./bay.sh check, --limits and --standards pass", evidence: "the four outputs quoted", dod: [DOD-12, DOD-15, DOD-17] }
    limits: { lines: "bay_lines +55 readable (proposal.py 40, dispatch.py 15), stop above +60", tests: "no test function added", style: ["typed defs, so mypy adds no finding"] }
    stop: ["an approved plan of another proposal has to be read"]
    blastRadius: "every forge.extend plan step and gate with a plan; tests that write a plan file (test_dispatch 0097-plan) now need front matter; approve.plans plans (docs/plans/<callId>-<step>.md) are checked by _require_plan_file, the forge plan by _gate_subject and approval"
    dryRun: { suite: "in sA without the fixture: test_an_edit_after_approval failed on the free-form plan; with PLAN_FM it passes", limits: "proposal.py 50 -> 90", standards: "0 new after typing", blastRadius: "the 0097 plan fixture is the only plan file written by a test with a gate" }
  - id: 7
    outcome: For a planned proposal the implement brief carries an envelope built from the current plan step, the step stays open until every plan step has an accepted result, and a fix round gets a fix envelope.
    context: [docs/proposals/0022-prevention.md#1-one-brief-format-built-from-the-plan, docs/proposals/0022-prevention.md#2-the-builder-reports-a-self-review, docs/proposals/0022-prevention.md#10-root-causes-no-silencing]
    scope:
      in: [bay/dispatch.py, tests/test_dispatch.py, tests/test_submit_needs_plan.py]
      out: [forge.create, delivery.build, forge.extend proposals without a plan outside a fix round]
    acceptance:
      - { id: A1, text: "the implement brief of a planned proposal has envelope with goal, scope, acceptance, dod, limits, stop ending with the standing line, and blastRadius", evidence: "a case in test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate (:417), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "a result missing a selfCheck line for an acceptance or DoD id is refused, naming the ids", evidence: "a case in test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan (:14)", dod: [DOD-3] }
      - { id: A3, text: "a submit whose to-do lacks an acceptance id, or has other words, is refused; done or skipped is accepted", evidence: "cases in the same test", dod: [DOD-3] }
      - { id: A4, text: "a plan with two steps returns implement twice, with planStep 1 then 2, before deadcode; a proposal without a plan gets no envelope", evidence: "cases in the test of A1", dod: [DOD-3] }
      - { id: A5, text: "after a failed review the next implement brief has fix with id, weakness, places, ways, reproduce and rootCause, acceptance [], and stop the two standing lines", evidence: "a case in test_failed_review_halts_before_release (:231)", dod: [DOD-3] }
      - { id: A6, text: "the review brief carries earlier: failed items and passed ids of every earlier review of the same files", evidence: "a case in test_failed_review_halts_before_release", dod: [DOD-3] }
      - { id: A7, text: "a blocked result with open items skipped and selfCheck lines not met: stopped is accepted", evidence: "a case in test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan", dod: [DOD-3] }
      - { id: A8, text: "the suite, ./bay.sh check, --limits and --standards pass", evidence: "the four outputs quoted", dod: [DOD-12, DOD-14, DOD-15, DOD-17] }
    limits: { lines: "bay_lines +97 readable, stop above +110", tests: "no test function added", style: ["typed defs", "no two-for comprehension: write the loop"] }
    stop: ["a call with no approved plan and no failed review gets an envelope", "submit needs a path that skips the checks for blocked results"]
    blastRadius: "every forge.extend implement and review step; the failed-review re-run test now submits selfCheck and checked; the open 0022 call is safe because its implement brief is built before this code exists"
    dryRun: { suite: "sA without test updates: test_failed_review_halts_before_release refused the fix-round submit (selfCheck); with the update it passes", limits: "dispatch.py 868 -> 987 for steps 3, 6, 7 and 8 together", standards: "16 new on the first draft (untyped defs), then 2 packed comprehensions; 0 after", blastRadius: "bay show never rebuilds a plan (dispatch.py:206-208), so the envelope is built only in _advance" }
  - id: 8
    outcome: "`./bay.sh check --standards [--base <ref>]` runs the forge.extend standards step by hand, prints the new findings and writes nothing; with --base it also runs the boundary check."
    context: [docs/proposals/0022-prevention.md#4-plans-dry-run-the-pipeline-on-a-scratch-copy]
    scope:
      in: [bay/cli.py (check parser, cmd_check, _print_standards, _system annotation), bay/dispatch.py (standards_by_hand), tests/test_cli_commands.py]
      out: [bay/standards.py, the guard]
    acceptance:
      - { id: A1, text: "check --standards prints each new finding and a count line, and exits 1 when there is a new finding", evidence: "a case in test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json (:37), failing on 90cd9a1", dod: [DOD-3] }
      - { id: A2, text: "the run writes nothing in the project: git status is the same before and after", evidence: "the same test, comparing git status output", dod: [DOD-2] }
      - { id: A3, text: "cli_commands stays 16; the guard treats the flag as read-only", evidence: "./bay.sh check --limits output and the guard matrix unchanged by this step", dod: [DOD-15] }
      - { id: A4, text: "the suite, ./bay.sh check and ./bay.sh check --limits pass", evidence: "the three outputs quoted", dod: [DOD-12, DOD-15] }
    limits: { lines: "bay_lines +23 readable (cli 17 with the typed _system, dispatch 6), stop above +28", tests: "no test function added", style: ["typed defs"] }
    stop: ["the flag needs a guard change"]
    blastRadius: "check with --base also runs the boundary check (cli.py:113), so check --standards --base <ref> runs both; the plan lead and builders gain no new command, ./bay.sh check is already in framework-dev clis"
    dryRun: { suite: "in sC: see Dry runs", limits: "cli.py 842 -> 866 with step 5", standards: "the command itself, on the scratch tree: 13.8 s, then 0 new finding(s), 1698 existing", blastRadius: "git status on the scratch tree after the run: unchanged" }
  - id: 9
    outcome: The builder and reviewer prompts, the coordinator playbook and the extend playbook carry the rules of decisions 2, 3, 6, 7, 8, 9, 10 and 11.
    context: [docs/proposals/0022-prevention.md#8-blast-radius-and-the-coordinator-owns-the-diff, docs/proposals/0022-prevention.md#11-say-no]
    scope:
      in: [framework/roles/builder.yaml, framework/roles/reviewer.yaml, components/base/cos/playbook.md, components/base/forge/features/extend/playbook.md, tests/test_roles.py, adapters/claude-code/tests/test_adapter.py]
      out: [.agentbay/COORDINATOR.md (regenerated by build), framework/roles/lead.yaml (step 1 only)]
    acceptance:
      - { id: A1, text: "the builder prompt holds: selfCheck, --skip, ceiling, root cause, silences, pushing back is expected, stop and report", evidence: "a case in test_shipped_roles_are_five_generic_framework_roles_without_data_access (:51)", dod: [DOD-3] }
      - { id: A2, text: "the reviewer prompt holds the nit definition, the class search, earlier, silences instead of fixes and an honest fail is expected", evidence: "the same test", dod: [DOD-3] }
      - { id: A3, text: "the generated COORDINATOR.md holds the envelope rule, the diff-against-acceptance note and the fresh-dispatch rule", evidence: "a case in test_adapter_round_trip (:24)", dod: [DOD-3] }
      - { id: A4, text: "the extend playbook steps 3 and 10 say plan format and nits in followups", evidence: "git show of playbook.md", dod: [DOD-13] }
      - { id: A5, text: "the suite and ./bay.sh check pass", evidence: "both outputs quoted", dod: [DOD-12] }
    limits: { lines: "0 bay_lines; text only", tests: "no test function added", style: ["plain words"] }
    stop: ["a sentence needs a rule the proposal does not have"]
    blastRadius: "builder.yaml and reviewer.yaml serve every mode's builder and reviewer units (21 role units), so delivery, forge.create and every mode's review read the new text; the cos playbook is the source of every project's COORDINATOR.md"
    dryRun: { suite: "in sC: see Dry runs", limits: "unchanged by text", standards: "0 new", blastRadius: "./bay.sh check resolves 21 role units after the text change" }
  - id: 10
    outcome: README, DESIGN and INTERFACES describe the brief format, the plan front matter, selfCheck, check --standards, plan --skip and who writes proposals; DESIGN and INTERFACES stay at 3000 words.
    context: [docs/proposals/0022-prevention.md#tests-and-limits, docs/proposals/0022-prevention.md#12-the-lead-writes-proposals-the-builder-implements]
    scope:
      in: [README.md, docs/DESIGN.md, docs/INTERFACES.md]
      out: [docs/proposals/, docs/plans/]
    acceptance:
      - { id: A1, text: "README names check --standards, plan --skip, selfCheck and the plan front matter", evidence: "git show of README.md", dod: [DOD-13] }
      - { id: A2, text: "INTERFACES lists the envelope keys, the plan steps fields, selfCheck, checked and the five verdict keys", evidence: "git show of docs/INTERFACES.md", dod: [DOD-13] }
      - { id: A3, text: "DESIGN's forge.extend paragraph says the lead writes the proposal and the plan, and the builder implements", evidence: "git show of docs/DESIGN.md", dod: [DOD-13] }
      - { id: A4, text: "DESIGN and INTERFACES are each at most 3000 words", evidence: "len(text.split()) for both, quoted", dod: [DOD-13] }
      - { id: A5, text: "./bay.sh check --docs --base origin/main passes", evidence: "its output quoted", dod: [DOD-12] }
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
      - { id: A1, text: "bay/__init__.py says 4.1.0 and CHANGELOG has a 4.1.0 entry with an Upgrading note for free-form plans, verdicts and the propose step's new subagent", evidence: "git show of both files", dod: [DOD-16] }
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
A1..An with evidence, limits, stop conditions, blast radius and dry-run.

The proposal and this plan were amended together at b961bd6, by the lead, as decision 12 of the proposal now asks of
every plan step. They agree: every error this plan found in the proposal is fixed in the proposal (see "Where the
proposal was wrong"), and the owner's decisions of 2026-11-05 are in both.

I wrote the code of the old steps 1 to 9 readably on scratch copies under the scratchpad (`p22/`), typed so the
standards step adds no finding, and ran the suite, `./bay.sh check`, `./bay.sh check --limits` and the standards step
on them.

- **The design works**, with four holes the first draft of the proposal did not name, all now closed. A plan edited
  at the gate skipped the plan-step check (step 6). A skip as a new event type would have needed
  `schemas/event.schema.json`, a sensitive file outside `touches:` (step 5). Small proposals (no plan) get no
  envelope, except in a fix round (step 7). The fix round's envelope was unspecified; it is now defined (step 7).
- **The owner dropped Opus builders on sensitive paths.** The old step 1 (implement-deep) is gone, and so is its
  `scaffold.py` cost. Builders stay on Sonnet.
- **The owner added the role split** (proposal decision 12): the lead writes and amends proposals, the builder only
  implements. It is step 1 here, because it is YAML and prompt text and needs nothing else.
- **The fix fields apply in every mode** (owner): the shared verdict schema and `bay note review` require them, as
  step 2 builds it.
- **Costs, measured from readable code:** `bay_lines` 9703 -> 9896 (+193), `kit_python_lines` 5276 -> 5322 (+46).
  With a stated 20% buffer the exceptions are 9935 and 5331 (arithmetic under Costs). `tests` stays 463,
  `long_lines` falls to 133, the other measures do not move.
- **The dry runs caught my own draft twice.** The first draft had 16 new standards findings (untyped defs, a
  `sorted` over `Any`, long lines), found by `check --standards` in 14 seconds. With step 4 in the tree, the next
  run found two packed comprehensions in my new dispatcher code. Decisions 4 and 5 work; the line counts include
  the typed, unpacked code.

## Owner decisions

All taken on 2026-11-05; none is open.

1. **Opus builders on sensitive paths: dropped.** The proposal's Out of scope says "Opus builders on sensitive
   paths: considered, not chosen (owner, 2026-11-05)". Nothing in either file sets or reads `sensitive` or
   `implement-deep`.
2. **The required fix fields apply in every mode.** `weakness`, `places`, `ways`, `reproduce` and `rootCause` are
   required on a failed item through the shared `review.verdict/v1` schema and `bay note review`
   (`bay/cli.py:484`). Proposal decision 6 and step 2.
3. **The role split** (proposal decision 12, step 1). The answers to the owner's checks:
   - The lead may write `docs/proposals/` today. Its unit `lead--forge--framework-dev--step` gets env
     framework-dev's `fs.write`, which lists `docs` (`components/base/forge/envs/framework-dev.yaml:36`), because the
     lead has `access: write` (`framework/roles/lead.yaml:10`) and the build passes the env's write paths to a
     writing unit (`adapters/claude-code/claude_code.py:381-386`); the guard denies only writes outside them
     (`bay/guard.py:336-343`). No env or guard change.
   - No other mode uses the builder for design. forge.create's `fill` (`components/base/forge/mode.yaml:20`) fills
     scaffolded files in user space with no proposal, plan or gate; improve.implement's `draft`
     (`components/base/improve/mode.yaml:78`) is the analyst. Both are out of scope, and the proposal says so.
   - Cost: 0 `bay_lines`, 0 `kit_python_lines` (YAML and text; `bay/limits.py:56-86` counts `.py` only). The
     propose step runs on Opus at high effort instead of Sonnet; that price is not measured here.

The nit rule (step 3) applies to every mode, because `_accept_review` serves every review step. The proposal says so
in decision 7.

## Where the proposal was wrong

Each item was measured or read on 90cd9a1. All are now fixed in the proposal; the section that holds each fix is
named.

- **`_require_plan_file` does not check the forge plan.** It checks only an `approve.plans` plan
  (`approves == $steps.<id>.artifacts`, `dispatch.py:110-113`); forge.extend's gate approves the proposal and finds
  the plan by name (`_gate_subject`, `dispatch.py:419-426`). Step 6 adds the check through `_gate_subject`, and again
  at approval, because a plan edited while the gate waits was otherwise approved and then crashed the implement brief
  (seen in the dry run: `test_an_edit_after_approval_makes_the_gate_run_again`). Proposal: `touches:` bay/dispatch.py,
  decision 1.
- **No new event type for a skip.** `agent.plan.skip` would need `schemas/event.schema.json` (`:33-34` lists the
  plan types). A skip is an `agent.plan.done` event with `data.skip`; there is no `record_skip`, `record_done` takes
  the reason. Proposal: `touches:` bay/ledger.py, decision 9.
- **No envelope without a plan, except in a fix round.** Proposal: decision 1 (the dispatcher bullet and the last
  bullet), decision 2.
- **The fix-round envelope**: `acceptance: []`, `dod` the failed DoD ids, `fix` copied from the failed items, `stop`
  the two standing lines; no plan step counter; bay finds the round with the same reader as `recheck`. Proposal:
  decision 1.
- **DOD-19 to DOD-21** were named but never defined. Dropped: the new checks are covered by DOD-3 and DOD-17.
  Proposal: `touches:` extend playbook.md.
- **`check --standards --base <ref>` also runs the boundary check** (`cli.py:113`). Proposal: `touches:` bay/cli.py,
  decision 4.
- **Line costs and exceptions**: measured readable cost plus a stated 20% buffer. Proposal: `exceptions:`, Summary,
  Tests and limits.
- **Decision 5's baseline**: 108 comprehension rows in 40 files, 45 fixture rows in 18 files. Proposal: decision 5,
  Measured and estimated.
- **Files missing from `touches:`**: `tests/golden/guard-matrix.json`, `tests/test_review_record.py` and
  `components/base/improve/tests/test_improve.py` are added. The fourth file this plan named,
  `components/base/improve/connectors/improve-detect/tests/test_deadcode_check.py`, changed only because it pins
  `implement` right before `deadcode` (`:265`) and implement-deep sat between them. With the Opus-builder decision
  dropped nothing goes between them, so the file does not change and is not in `touches:`.
- **`bay/cli.py` `_system` gains a type annotation**, so a typed caller adds no mypy finding. Proposal: `touches:`
  bay/cli.py.

## Build order

One commit per step, in the order of the front matter. Each ends with the suite, `./bay.sh check` and
`./bay.sh check --limits` green, and `./bay.sh check --standards --base <the call's base>` with no new finding where
the step touches Python.

1. **Role split**: the propose step to the lead, the plan task, the builder and lead prompts, playbook steps 1 and 3.
2. **Schemas**, with the fixtures that use a failed verdict.
3. **Nits never block**: one condition, R-8 and the release task text.
4. **Packed-code rules**, early, so every later step is checked by them.
5. **To-do ids and `--skip`**, with the guard and its golden matrix.
6. **Plan front matter checked** at the plan step, the gate and approval.
7. **Envelope, selfCheck, to-do coverage, plan-step counter, fix round, `earlier`.** The largest step; it needs 2,
   5 and 6.
8. **`check --standards`.**
9. **Prompts and coordinator text.**
10. **Docs.**
11. **Release 4.1.0.**

Steps 1, 3, 4 and 8 are independent of the others. Step 9 comes after 7 so the text describes what exists, and after
1 because both edit `builder.yaml` and the extend playbook.

## Dry runs

All runs on `git archive` copies of 90cd9a1 under the scratchpad (`p22/`), each turned into a git repo. They hold the
old step 1 (implement-deep, now dropped) and not the new step 1 (role split). The old step 1 touched no `bay/` file;
its only counted cost was `scaffold.py` +6, which Costs subtracts. The new step 1 was not dry-run on a tree of its
own: it is YAML and text, and its front-matter entry says what confirms its blast radius.

| Tree | What it holds | Suite | `bay check` | `--limits` | Standards |
|---|---|---|---|---|---|
| base | 90cd9a1 | 576 passed, 0 failed, 161.7 s | lint clean, 7 modes, 44 features | 9 measures within ceilings | - |
| s1 | step 2 schemas, no fixture changes | 572 passed, 4 failed (the four named in step 2) | - | - | - |
| sA | code of old steps 1 to 8, no test changes | 560 passed, 16 failed (table below) | lint clean | bay_lines 9860, kit 5282, long_lines 133 | - |
| sC | old steps 1 to 9 with the test fixture changes | 576 passed, 0 failed, 267.0 s | lint clean, 7 modes, 44 features, 21 role units | bay_lines 9891, kit 5328 | 4 new: 2 packed comprehensions in dispatch.py, 2 long lines |
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
| `implement-deep` sits between implement and deadcode | test_forge_extend_runs_deadcode_and_several_standards_checkers_between_implement_and_review | old step 1, dropped |

The 12 gate tests were my bug, not the design's: the first `_envelope` assumed an approved plan. It now returns no
envelope without one, and all 12 pass with no test change. I did not run each step alone on its own tree; the steps
were measured together, and each failure above is attributed to the step that causes it. The builder runs each
step's dryRun again on its own commit.

## The open 0022 call

The call that carries this plan (C-20261105-128b6d) keeps working while its own code changes under it:

- Its implement brief is built when the gate passes, before step 7 exists, so it has no `envelope` and none of the
  new checks apply to it. `bay show` does not rebuild a brief (`dispatch.py:206-208`).
- Its propose step is behind it, and its plan step, this one, already wrote the plan and amended the proposal, as
  step 1 will require of every plan step. Step 1 changes who runs those steps from the next call on.
- The gate binds the proposal and the plan as they are when it is built (`dispatch.py:419-426`), so the approval
  covers the amended proposal.
- Its fix round, if any, is a new call that runs the new code: it gets a fix envelope from the failed review, and
  the reviewer of this call must already write the five keys once step 2 has landed.

## Costs

Measured with `wc -l` on readable, typed code (no packing; every new def typed so the standards step adds nothing).

| File | First proposal draft | Measured | Now |
|---|---|---|---|
| bay/dispatch.py | +99 | +119 | +119 |
| bay/proposal.py | +29 | +40 | +40 |
| bay/cli.py | +31 | +24 | +24 |
| bay/ledger.py | +14 | +8 | +8 |
| bay/guard.py | +5 | +2 | +2 |
| **bay_lines** | **+178** | **+193** | **+193** |
| python_check.py | +35 | +46 | +46 |
| scaffold.py | +3 | +6 | 0 (dropped with Opus builders) |
| **kit_python_lines** | **+38** | **+52** | **+46** |
| role split (step 1) | - | 0 | 0 (YAML and text) |

The arithmetic, with the buffer rounded to the nearest line:

- `bay_lines`: 119 + 40 + 24 + 8 + 2 = 193 (by step: 1 + 17 + 55 + 97 + 23 = 193, steps 3, 5, 6, 7 and 8; and
  dispatch.py is 1 + 15 + 97 + 6 = 119, cli.py 7 + 17 = 24). After: 9703 + 193 = 9896, as measured on sD. Buffer:
  0.2 x 193 = 38.6, so 39. Exception: 9896 + 39 = **9935**.
- `kit_python_lines`: measured on sD 5328 - 5276 = 52 = 46 (python_check.py) + 6 (scaffold.py). Without scaffold.py:
  52 - 6 = 46. After: 5276 + 46 = 5322. Buffer: 0.2 x 46 = 9.2, so 9. Exception: 5322 + 9 = **5331**.
- Step 1 (role split) adds 0 to both: `bay/limits.py:56-86` counts `.py` files only.

| Measure | Ceiling | After (measured) | What it costs |
|---|---|---|---|
| `bay_lines` | 9703 | 9896 (+193) | exception to 9935: the measured +193 plus a stated buffer of 20% (39) |
| `kit_python_lines` | 5276 | 5322 (+46) | exception to 5331: the measured +46 plus a stated buffer of 20% (9) |
| `tests` | 463 | 463 | all checks are cases in existing tests |
| `long_lines` | 134 | 133 | none written; one existing long line in `_require_plan_file` is split |
| `cli_commands` | 16 | 16 | `--standards` is a flag, `--skip` an option of `plan` |
| `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | no file, folder or comment added |

If you want an exception lower, the cuts are as the proposal lists: `check --standards` (-23 measured), `earlier`
(about -20), `--skip` (-17 across cli, ledger and guard).

## Risks

- **Every mode's reviews change** (owner decision 2 and step 3): a reviewer in any mode must write five more keys on
  a fail, and a nit on a must item stops halting any mode.
- **The propose step costs more.** It moves from Sonnet to Opus at high effort (step 1), once per call that drafts a
  proposal. Not measured.
- **The role split is a prompt rule.** A framework-dev builder can still write `docs/proposals/`, because its env
  serves the implement step, which updates docs. What changes is who is dispatched to design, and the builder's prompt.
- **Step 1 was not dry-run.** It is YAML and text; one test asserts the propose step's subagent (`test_dispatch.py:211`).
- **Old plans cannot be re-run.** No compatibility code: a fix round for 0011 or 0021 would read their free-form
  plans and be refused. Neither is open.
- **Typed code is required, not only readable code.** New untyped defs are new mypy findings and block the standards
  step. Builders who do not run `./bay.sh check --standards` find this late, as the first draft here did.
- **The plan-step counter** keeps one `implement` step open across several builder runs; a coordinator that submits
  a result for the wrong plan step gets the next envelope anyway, because bay counts and does not read `planStep`.
- **The prompt rules are not enforced** (decisions 8 to 12): a diff note can be skipped and a reviewer can still
  agree.
- **The dry run of docs is a budget, not text.** DESIGN and INTERFACES are at 3000 words today; step 10 pays for
  every word with a cut, and the plan did not draft that text.
