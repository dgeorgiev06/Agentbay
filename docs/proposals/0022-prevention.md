---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. The seven decisions were taken by the owner in chat on 2026-11-04 and are followed here as given. Every line cited was read on feat/prevention at 4.0.0 (main a7a425d). Counts marked measured were run on that commit; line costs are estimates, written as readable code plus a stated buffer, and the plan step replaces them with measured ones (see Measured and estimated).
id: "0022"
status: draft
touches:
  - { path: bay/dispatch.py, reason: "sensitive. The executor brief (:715-728) gains `envelope` built from the plan step; submit (:76-108) refuses a result whose selfCheck misses an acceptance id; _review_brief (:698-713) gains `earlier`; _prior_review (:679-696) is split so both use one reader of earlier reviews; _require_plan_file (:110-113) validates the plan's steps (about +75 lines)" }
  - { path: bay/proposal.py, reason: "plan_steps(text) reads and checks the plan's front matter next to front_matter (:13) and touches (:30) (about +25 lines)" }
  - { path: bay/cli.py, reason: "sensitive. `bay check --standards`: the standards step run by hand, read-only, so a plan can dry-run it (about +25 lines; no new command, cli_commands stays 16)" }
  - { path: schemas/task.schema.json, reason: "TaskEnvelope (:6-24) gains optional scope, acceptance, dod, fix, limits, stop; Result (:26-40) gains selfCheck, checked, planStep. Additive; stays v1" }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "a failed item must carry weakness, places and ways (decision 7); additive for passes" }
  - { path: components/base/forge/types/Result.schema.json, reason: "the forge step output type gains selfCheck, checked, planStep, the same three keys as task.schema.json" }
  - { path: framework/roles/builder.yaml, reason: "prompt (:12-29): the limits rule (decision 3), the selfCheck and checked report (decision 2)" }
  - { path: framework/roles/reviewer.yaml, reason: "prompt (:13-36): do not stop at a few findings; for every failure search the same weakness across the change and report the class as one item; read `earlier` (decision 7)" }
  - { path: components/base/forge/mode.yaml, reason: "the plan task (:39) asks for the plan format and the dry-run; implement (:41) is split into implement and implement-deep chosen by `when:` on the proposal step (decision 6)" }
  - { path: components/base/forge/connectors/scaffold/scaffold.py, reason: "the proposal step also returns `sensitive`, from the SENSITIVE list at :7-9 that plan_reason (:20-25) already uses (about +3 lines of protected kit code)" }
  - { path: components/base/forge/interfaces/forge.scaffold.v1.yaml, reason: "the proposal endpoint's out (:47-55) gains `sensitive`; additive output, contract stays v1" }
  - { path: components/base/forge/features/extend/playbook.md, reason: "step 3 (plan) and step 5 (implement) text; DOD-19 to DOD-21 (the next free ids after DOD-18)" }
  - { path: components/base/python/connectors/python-check/python_check.py, reason: "two new row kinds beside _reachability_rows (:227-244) and _token_rows (:247-255): a comprehension with more than one `for` or inside another comprehension, and a one-line string literal of two or more Python statements in a test file (about +35 lines of protected kit code)" }
  - { path: components/base/python/connectors/python-check/README.md, reason: "the two new rules and how to write the code instead" }
  - { path: tests/test_dispatch.py, reason: "cases added to existing tests: the envelope, the selfCheck refusal, the `earlier` verdicts, the tier of implement, the plan-format refusal (no test function added)" }
  - { path: tests/test_submit_needs_plan.py, reason: "a case in the submit-refusal test (:14): a result without selfCheck for every acceptance id" }
  - { path: tests/test_roles.py, reason: "a case in test_shipped_roles_are_five_generic_framework_roles_without_data_access (:51): the builder and reviewer prompts carry the new rules" }
  - { path: tests/test_cli_commands.py, reason: "a case: `bay check --standards` takes no boundary options and writes nothing" }
  - { path: components/base/python/tests/test_python_check.py, reason: "cases in the one test (:309), written one source line per line" }
  - { path: README.md, reason: "DOD-13: the brief format, selfCheck, `check --standards`" }
  - { path: docs/DESIGN.md, reason: "DOD-13: a paragraph on prevention; at its 3000-word budget, so the words are paid for by cuts in the same file" }
  - { path: docs/INTERFACES.md, reason: "DOD-13: the envelope fields, the plan front matter, selfCheck, the verdict fields; at its 3000-word budget, paid for by cuts" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines and kit_python_lines written down to the real counts" }
  - { path: bay/__init__.py, reason: "release step: version 4.1.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading note" }
exceptions:
  - { measure: bay_lines, to: 9853, reason: "9703 is the ceiling and the count. Estimated readable cost +125 (dispatch.py 75, proposal.py 25, cli.py 25), plus a stated buffer of 25 (20%), written before any code exists. The plan replaces the estimate with a measured one from a scratch copy; the exception is then the measured readable cost plus the same buffer." }
  - { measure: kit_python_lines, to: 5326, reason: "5276 is the ceiling and the count. Estimated readable cost +38 (python_check.py 35, scaffold.py 3), plus a buffer of 12. Test fixtures for the new rules are written one source line per line, as the owner decided on 2026-11-04." }
---

# 0022: Prevention

## Summary

Two framework changes took many rounds to land. 0011 (standards) needed seven fix rounds, and 0021 (component layout) needed three, plus two limit re-approvals. When I read what happened, the rounds were not caused by hard code. They were caused by six gaps in how work is handed out and checked:

- A fix brief named one instance of a problem, the builder fixed that one, and the next review found its sibling.
- The builder never compared its own work with the acceptance criteria, so the reviewer was the first to do it.
- A plan could call a step green without running anything. 0021 step 1 was called "trivially green" (`docs/proposals/0021-component-layout.md:198`) and still changed 18 guard decisions. The standards step could not run once its config folder moved (`python_check.py:21` names the folder).
- Builders packed code onto long lines or into one-line test fixtures to fit a limit. You call that cheating, and 0021 records your decision (`0021-component-layout.md:48`).
- A review stopped after a few findings.
- Each of these was found late, in review.

This proposal moves the checking earlier and makes it mechanical. What you get:

1. **One brief format.** Every builder brief has the same fields: outcome, context, scope, numbered acceptance criteria with the evidence each needs, the Definition-of-Done ids that apply, limits in numbers, stop conditions and the report format. For a fix round it also lists the weakness, every place it can happen and every way to trigger it. The plan step writes the acceptance criteria and evidence for each step, you approve them with the plan, and bay builds each brief from the plan, so no criterion is dropped on the way.
2. **A self-review in every result.** The builder reports one line of evidence per acceptance id. In a fix round it reports what it did at every listed place and way. bay refuses a result that leaves one out.
3. **A limit is your question, not a target.** If readable code goes over a ceiling, the builder stops, reports the measured value and what it pays for, and never compresses code.
4. **Plans prove their steps.** A plan runs the real suite, the limits check and the standards step on a scratch copy for every step it calls green. A limit exception is the readable estimate plus a stated buffer.
5. **A check for packed code**, in the Python checker the standards step already runs: a comprehension with more than one `for` or inside another comprehension, and test fixtures that hold source code as one line with `\n`. Cases already in the tree are the baseline and block nothing.
6. **Opus for risky implementations.** When the proposal touches a sensitive path, the implement step runs on the deep tier. This is the list that already triggers the plan step. Otherwise it stays on Sonnet.
7. **Reviews that find the class.** For every failure, the reviewer searches the same weakness across the whole change and reports the class as one item, and it sees the verdicts of earlier reviews of the same proposal.

What stays the same: the steps of forge.extend, the approval gate, the one review round, the Result and verdict contracts (all additions are optional keys, so `agentbay/v4` stays), every limit except the two exceptions below, and the rule that you alone pass the gate. There is no compatibility code. A plan written in the old free-form way is refused at the plan step with a message that names the missing field.

What it costs: `bay_lines` 9703 to an estimated 9853 and `kit_python_lines` 5276 to 5326, both as exceptions sized from readable code plus a buffer. `tests` stays 463: the new checks are cases inside existing tests. The proposal touches `bay/dispatch.py` and `bay/cli.py`, so under its own decision 6 the implementation runs on Opus.

What needs your decision: three questions, listed at the end. The most important one is a conflict with how plans work today. A plan is free text (`docs/plans/0021-component-layout.md` has no machine-readable part), so bay cannot build a brief from it. Decision 1 needs a plan format change: a small front matter. I describe that change as the way to do it and ask you to confirm it.

## The design

### 1. One brief format, built from the plan

**Where it is today.** The step plan the dispatcher returns for a builder holds the task text, playbook, rules, DoD, input and previous outputs (`bay/dispatch.py:715-728`). The coordinator then writes a TaskEnvelope by hand around it. `TaskEnvelope/v1` has `goal`, `context`, `inputs`, `constraints`, `deliverable` and `budget` and allows no other key (`schemas/task.schema.json:6-24`). Nothing says what a brief must contain, so a criterion can be dropped or never written.

**The change.**

- `schemas/task.schema.json` gives TaskEnvelope six optional keys: `scope`, `acceptance`, `dod`, `fix`, `limits`, `stop`. The brief's outcome is `goal`; its context is `context` and `inputs`; its report format is `deliverable`. Nothing else is renamed.
- The plan file starts with a YAML front matter, read by a new `plan_steps(text)` in `bay/proposal.py` beside `front_matter` (:13). It holds a `steps:` list. Each plan step has the fields below.
- `bay/dispatch.py` adds `envelope` to the executor brief (`_executor_brief`, :715-728) for the implement steps of forge.extend. It is the TaskEnvelope for the current plan step, without the `taskId`, which the coordinator still mints. The coordinator renders it as the task block; it adds nothing.
- The plan step's submit validates the plan (`_require_plan_file`, :110-113, which already insists the plan file exists and is listed): every step needs an outcome, scope, at least one acceptance entry with text and evidence, DoD ids that exist in the feature, limits, stop conditions and the dry-run of decision 4. A missing field is refused with the step number and the field name.
- The gate already binds the plan's exact content with the proposal (`bay/dispatch.py:419-426`), so approving the plan approves its acceptance criteria and evidence.
- Briefs for steps that have no plan (the propose step, the plan step itself, the release step) are still written by the coordinator, in the same fields. The playbook says so and the schema describes them. bay builds only what it has a plan for.

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
    stop: [<conditions that mean: stop and report, do not improvise>]
    dryRun: { suite: <command and result>, limits: <command and result>, standards: <command and result> }
```

`dod` on the envelope is the union of the steps' acceptance `dod` lists. Acceptance ids are `A1..An` within a step.

**The complete template** (the envelope that bay builds for one plan step; `fix` appears only in a fix round, see decision 2 and 7):

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
limits:
  lines: <readable-code budget>
  tests: <test-count rule>
  style: [<style rules>]
stop: [<conditions to stop and report>]
deliverable: Result/v1 with selfCheck (one line per A-id and per applicable DoD id); in a fix round also `checked` (one line per place and per way)
```

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
stop: ["the table needs more than 14 lines", "a case passes on the parent commit"]
deliverable: Result/v1 with selfCheck for A1-A4 and DOD-7, DOD-12, DOD-14, DOD-15, DOD-18; artifacts lists every changed file
```

The same step as it stands in the plan has the outcome, files and tests, and no evidence per criterion, which is why its review needed rounds.

**Why in the dispatcher and not a template in the coordinator's playbook.** A playbook sentence is what failed: "the brief states the goal, the inputs and the limits" (`.agentbay/COORDINATOR.md`, loop step 3) left the criteria to whoever wrote the brief. Building from data means a criterion in the plan is in the envelope.

**Test that fails on main:** `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` extended to a plan with front matter: main returns no `envelope` key (the brief at :715-728 has none), so the first assertion fails. A second case: a plan with a step without `acceptance` is refused at the plan step; main accepts any file (:110-113 only tests that it exists).

### 2. The builder reports a self-review

**Where it is today.** `Result` has `status`, `summary`, `artifacts`, `followups`, `blockers` (`schemas/task.schema.json:26-40`, `components/base/forge/types/Result.schema.json`). The builder prompt tells it to list its to-do items as done, dropped or blocked (`framework/roles/builder.yaml:17-19`) but never to check acceptance criteria. `submit` validates a step's output against its `out` type and requires a recorded `bay plan` (`bay/dispatch.py:76-108`, `_require_plan` :130-143).

**The change.**

- `Result` gains `selfCheck` (an object: id to one line of evidence), `checked` (an object: id to one line) and `planStep` (the plan step number the result answers). Both Result schemas get the same three optional keys.
- `submit` (`bay/dispatch.py:76-108`), for a step whose brief carried an `envelope`, compares the result with it after the schema check and before `state["steps"][step.id]` is written. It refuses with the missing ids: every acceptance id and every DoD id of the envelope must be a key of `selfCheck`, and in a fix round every place and way id of `fix` must be a key of `checked`. The message names the ids and says what a line should hold. Steps with no envelope (forge.create, delivery.build) are not checked, because they have no acceptance ids.
- `checked` keys are `<failed id>.P<n>` for the n-th place and `<failed id>.W<n>` for the n-th way, numbered by bay when it builds `fix`. A value starts with `fixed`, `already safe` or `not fixable` and then gives the reason.
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
- **Needs your confirmation (open question 2):** the plan lead cannot run the standards step today. `standards.check` needs a dispatcher and a connector context, and no CLI reaches it. I add `./bay.sh check --standards [--base <ref>]` (`bay/cli.py`, the `check` parser at :755-763): it runs the same `standards.check` as the step against the base and prints the new findings, and writes nothing. `guard.py:431` treats only `./bay.sh check --write` as a write, so the flag needs no guard change.
- Each limit exception in a proposal or plan is the readable estimate plus a stated buffer, written as two numbers in its `reason:`. This proposal's two exceptions follow it (front matter). The plan task and the playbook say so.

**Test that fails on main:** `tests/test_dispatch.py::test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval` (:358) gets a plan with a step that lacks `dryRun.standards`: refused. `tests/test_cli_commands.py::test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json` (:37) gets a case for `check --standards`: main's parser rejects the flag.

### 5. A no-packing check in python-check

**Where it is today.** `python-check` runs ruff and mypy and a few AST and token rules (`python_check.py:227-296`). Ruff's selection `E F W B` has no rule for these shapes. The standards step blocks only on findings that are new against the call's start commit, comparing them as a multiset keyed by file, rule and message (`bay/standards.py:38-48`).

**The change.** Two new row kinds in `python_check.py`, found with `ast` in the same pass as `_reachability_rows` (:227-244), added to `_inline_rows` (:283-296):

1. `packed-comprehension`: a list, set or dict comprehension or a generator expression with more than one `for` (`len(node.generators) > 1`), or one that contains another comprehension anywhere inside it. One row per outer comprehension.
2. `packed-fixture`: in a test file (a `.py` under a folder named `tests`, or named `test_*.py`), a string literal that sits on one source line, contains `\n`, and parses with `ast.parse` as a module of two or more statements. This is Python source written as one line. A fixture written one source line per line (a triple-quoted string or a list of lines) is not a finding.

Rows use a fixed message per rule with no line numbers, so the multiset comparison treats a moved line as the same finding and every case already in the tree is baseline. Measured on main: 70 comprehensions with more than one `for` in 29 files, 40 comprehensions inside another in 22 files, and 45 one-line fixture literals in 18 test files. I measured a third shape, `"\n".join([...literals])` as source, and found 0 today, so I do not add a rule for it.

This is deterministic and cannot see intent. It stops the two shapes the 0011 and 0021 builders used; a new shape needs a new rule. That is the price of a check that does not judge.

**Test that fails on main:** `components/base/python/tests/test_python_check.py::test_python_findings_are_blocked_only_when_new_against_the_call_start` (:309) gets two cases (a new double-`for` comprehension, a new one-line fixture), each blocking, and an unchanged old case not blocking. On main neither shape is a finding.

### 6. Sensitive proposals implement on the deep tier

**Where it is today.** `forge.scaffold.v1.proposal` decides whether a plan is needed. Its `SENSITIVE` list (`components/base/forge/connectors/scaffold/scaffold.py:7-9`) and `plan_reason` (:20-25) set `plan` true for a proposal that touches one of those paths; the result holds `plan` and `why` (`forge.scaffold.v1.yaml:47-55`). The implement step has no tier of its own, so it takes the builder role's `balanced` (`framework/roles/builder.yaml:9`, resolved at `bay/model.py:1326-1328`). The framework-dev env allows `balanced` and `deep` (`framework-dev.yaml`, `tiers`).

**The change.** A tier chosen by a value computed at run time would need a new feature in the model resolver, which resolves tier statically (`bay/model.py:1326-1330`) and checks it against the env at load time (`:1332-1336`). A step with its own `when:` already works (`bay/workflows.py:276-286`, used by `when: $steps.proposal.plan`). So:

- `plan_reason` is split so that `sensitive` is its own value. The proposal step returns `sensitive: bool` next to `plan` and `why` (`scaffold.py:51-52`, `forge.scaffold.v1.yaml` out). `sensitive` is true when `touches:` includes a path from the SENSITIVE list, whether or not a plan file already exists. A missing or unreadable `touches:` is not sensitive (it already forces a plan through `hits is None`, :23).
- `mode.yaml:41` becomes two steps with the same task text: `implement` with `when: "!$steps.proposal.sensitive"`, and `implement-deep` with `tier: deep` and `when: $steps.proposal.sensitive`. The task text is a YAML anchor, written once. Exactly one runs. The step plan then says `tier: deep, model: opus`, and the coordinator dispatches as it does for any role step.
- The playbook and DoD list (`playbook.md` steps 3 and 5) say which runs when.

I considered one step with a tier expression and rejected it: the resolver, the env-cap lint and the registry would all learn a run-time tier. Two steps need no code in `bay/`.

**Not changed:** the review (already deep), the plan (already deep), forge.create and delivery. The tier follows the proposal's declared `touches:`, not the final diff; a diff that reaches a sensitive file the proposal did not declare is already a boundary failure (`bay check --base`).

**Test that fails on main:** the case at `tests/test_dispatch.py:512-520` (inside `test_an_edit_after_approval_makes_the_gate_run_again`, which builds a proposal from front matter and reads the next step) gets a second half: a proposal touching `bay/dispatch.py` reaches `implement-deep` at model `opus`, and one touching only `README.md` reaches `implement` at `sonnet`. Main has one step `implement`, so the step id differs and the first assertion fails.

### 7. The reviewer reports the class and sees earlier verdicts

**Where it is today.** The reviewer prompt gives a verdict per id and a severity (`framework/roles/reviewer.yaml:24-31`). A verdict item has `id`, `verdict`, `evidence`, `severity`, `suggestion`, `cites` (`schemas/data/review.verdict.v1.schema.json`). The review brief holds the task, DoD, rules, checks, output and `recordedPlans`, and a `recheck` when the same files had an earlier failed review: only the failed ids, the commits since and the ids that passed (`bay/dispatch.py:698-713`, `_prior_review` :679-696). The reviewer has a 25-turn budget (`reviewer.yaml:12`).

**The change.**

- The verdict schema requires `weakness` (the underlying problem), `places` (every place it can happen) and `ways` (every way to trigger it), all as strings or lists of strings, on an item whose verdict is `fail` (a JSON Schema `if`/`then`). `_accept_review` (`bay/dispatch.py:617-638`) validates against that schema already (:618-621), so no dispatcher line is needed for this.
- `framework/roles/reviewer.yaml` (:13-36) says: check every id even after the first failure; for each failure, search the change for the same weakness and report the whole class as that one item, listing each place and way; read `earlier` and do not pass an id an earlier review failed without evidence that it is fixed.
- `_review_brief` (:698-713) gains `earlier`: for every earlier call of the same target with the same gated proposal, its failed items (id, evidence, weakness, places, ways) and the ids it passed. `_prior_review` already walks the ledger and the calls folder to find the newest failed review of the same files (:679-696). It is split into one reader of earlier reviews that returns all of them, and `recheck` is built from the newest, as now. About +20 lines.
- A failed item is also the source of the next fix brief: bay copies `id`, `weakness`, `places` and `ways` into the `fix` section of decision 1, so a fix round sees what the reviewer saw. The coordinator does not retype findings.

The item stays one item per failure class, so the number of verdict ids and the rule that a failed `must` or blocker makes the call `partial` (`_accept_review` :628-631) do not change.

**Test that fails on main:** `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231) is extended: a failed item without `weakness` is refused (main accepts it), and the next call's review brief holds `earlier` with that item (main has no `earlier`).

## Details

### Compatibility and safety

- **Contracts.** Every schema change adds optional keys (TaskEnvelope, Result in both places) or conditional requirements on a verdict item that fails. The forge.scaffold `proposal` endpoint gains an output key. No existing document becomes invalid, so `agentbay/v4` and the v1 data contracts stay (DOD-11). If you read DOD-11 strictly for the verdict `if/then`, which tightens what a reviewer may submit, the alternative is a `review.verdict/v2`; I do not recommend it for a field only the reviewer role writes and only this dispatcher reads.
- **What breaks, with no alias (B-12).** A plan without the front matter is refused at the plan step. A builder result for an implement step without `selfCheck` is refused. A failed verdict item without `weakness`, `places` and `ways` is refused. Plans and calls already approved are unaffected: the gate holds the plan's exact content, and an open call that already passed the plan step has no envelope to check against (the envelope is built from the plan on the step's turn, and the check applies only when one was built).
- **No backward-compatibility code.** There is no reader for the free-form plan and no shim for results without `selfCheck` on envelope steps. Steps without an envelope (forge.create, delivery.build, the release step) are not weakened: they never had acceptance ids.
- **Safety.** No secret is read, written or shown. The new `check --standards` writes only under a temporary directory, as `standards.check` does (`bay/standards.py:103`). The guard is unchanged. The implement-deep tier only raises the model. `bay/dispatch.py` and `bay/cli.py` are on the sensitive list, so this proposal gets a plan and runs its own implement step on the deep tier: it is the first proposal to be implemented under decision 6.
- **Extensibility (DOD-4).** A new source is still one connector and one binding line.
- **Risks.** (a) The plan becomes longer because it carries the acceptance and the dry-run; its review is the owner's, at the gate. (b) A step plan with many criteria makes the builder's selfCheck long; the line is one per id and the dispatcher counts ids, not words. (c) The packed-code rule cannot tell intent: a two-`for` comprehension that reads clearly is still a finding for a new one. That is your decision 5; the way out is a nested `for` loop.

### Tests and limits

**Tests.** `tests` stays 463. All new checks are cases inside existing tests; no function is added and none is removed. The tests named under each decision fail on main:

| Decision | Test (existing function, new case) | Why it fails on main |
|---|---|---|
| 1 | `tests/test_dispatch.py::test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` (:417) | the executor brief (`dispatch.py:715-728`) has no `envelope`; a plan without acceptance is accepted |
| 2 | `tests/test_submit_needs_plan.py::test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` (:14); `tests/test_dispatch.py::test_the_step_result_accepts_what_the_worker_contract_returns` (:383) | `submit` has no selfCheck check; the Result schema forbids the key |
| 3 | `tests/test_roles.py::test_shipped_roles_are_five_generic_framework_roles_without_data_access` (:51) | the builder prompt (`builder.yaml:12-29`) has no stop rule |
| 4 | `tests/test_dispatch.py::test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval` (:358); `tests/test_cli_commands.py::test_check_takes_boundary_options_only_with_a_base_and_json_prints_only_the_boundary_json` (:37) | no `dryRun` check; no `--standards` flag |
| 5 | `components/base/python/tests/test_python_check.py::test_python_findings_are_blocked_only_when_new_against_the_call_start` (:309) | neither shape is a finding |
| 6 | `tests/test_dispatch.py::test_an_edit_after_approval_makes_the_gate_run_again` (:442, the part at :512-520) | one step `implement`; no `sensitive` |
| 7 | `tests/test_dispatch.py::test_failed_review_halts_before_release` (:231) | `weakness` is not required; no `earlier` |

The plan step confirms each test fits its case, or names a better existing one. Fixtures added are written one source line per line.

**Limits.** All nine measures are at their ceiling today (`./bay.sh check --limits` on main: "9 measures within their ceilings", and `framework/limits.yaml`: bay_lines 9703, kit_python_lines 5276, cli_commands 16, framework_folders 2, schemas 16, top_level_folders 7, tests 463, long_lines 134, comment_lines 0).

| Measure | Ceiling | After (estimated) | Verdict |
|---|---|---|---|
| `bay_lines` | 9703 | 9828 readable (+125), exception to 9853 with a buffer of 25 | over: exception |
| `kit_python_lines` | 5276 | 5314 readable (+38), exception to 5326 with a buffer of 12 | over: exception |
| `tests` | 463 | 463 | cases only |
| `long_lines` | 134 | 134 | none written; each new line stays under 120 characters |
| `cli_commands` 16, `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | `--standards` is a flag of `check`; no schema file; nothing at the root; no comment |

By file, all estimates: `dispatch.py` +75 (envelope from plan step 25, selfCheck coverage 12, plan-step counter 10, earlier reviews 20, plan validation 8), `proposal.py` +25 (`plan_steps` and its checks), `cli.py` +25 (`check --standards`), `python_check.py` +35 (two row kinds), `scaffold.py` +3. The Python test files are not counted by `bay_lines` or `kit_python_lines` (`bay/limits.py:51-70`). If an exception must be lower, the first cut is `check --standards` (-25 `bay_lines`), with decision 4 then resting on a manual dry-run described in the plan; the second is `earlier` in the review brief (-20).

**Docs.** DESIGN.md and INTERFACES.md are at 3000 words each (`len(text.split())`). The additions (a paragraph in DESIGN; the envelope fields, plan front matter, selfCheck and verdict fields in INTERFACES) are estimated at +60 and +90 words, paid for by cuts in the same files; the plan measures it by applying draft text to copies, as 0021 did.

### Out of scope

- End-to-end tests that drive a feature to its end without stubs: proposal 0017.
- Briefs for forge.create, delivery.build and the other modes: they have no plan, so the schema describes the fields but bay builds nothing.
- Any change to the review budget (`reviewer.yaml:12`), to the number of review rounds (R-1) or to what blocks a call.
- A check for density beyond the two shapes in decision 5.
- A `review.verdict/v2` and an `agentbay/v5`.
- Choosing the tier by the actual diff instead of `touches:`.
- Backward-compatibility for old plans, results or verdicts.

### Measured and estimated

Measured on main a7a425d: the nine limit counts above; the 70, 40 and 45 baseline counts of decision 5 (an `ast` walk over `git ls-files '*.py'`; the scripts are in the scratchpad, not committed); the word counts of the two docs; every line cited in this proposal, which I read on this commit.

Estimated, and replaced by measured numbers in the plan: every line cost in the limits table, the DESIGN and INTERFACES word additions, and the count of cases per test. Not measured: the run time of a plan's dry-run (the suite alone takes about two and a half minutes in this environment; 0021's measured 153 seconds, `docs/plans/0021-component-layout.md`), and the length of a plan that carries acceptance and dry-run for each step.

### Open questions for the owner

1. **A plan needs a machine-readable part (conflict with today's plans).** A brief cannot be built from a free-form plan (`docs/plans/*.md` have no fields; `bay/dispatch.py:419-426` hashes the file only). Decisions 1, 2 and 4 therefore need a plan format change: the YAML front matter above, validated at the plan step. I recommend it. The alternative is to leave plans free-form and have the coordinator copy acceptance from them by hand, which is the thing that dropped criteria.
2. **A way to dry-run the standards step.** No command runs it by hand. I recommend `./bay.sh check --standards` (+25 `bay_lines`, no new command). Without it, "the standards step, run for every step the plan calls green" (decision 4) can only be met by running ruff and mypy directly, which is what missed the `CONFIG_DIR` constant in 0021.
3. **Does selfCheck refusal cover DoD ids too?** Your decision 2 says the dispatcher refuses a result that does not cover every acceptance id, and that the builder reports one line per applicable DoD id. I wrote the refusal to cover both (the same loop, no extra lines). If you want only acceptance ids enforced, the DoD lines stay in the report and the reviewer judges them.
