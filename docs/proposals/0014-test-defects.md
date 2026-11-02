---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope approved by the owner on 2026-11-02: three test defects found by the test inventory, nothing more.
id: "0014"
status: draft
touches:
  - { path: tests/test_boundaries.py, reason: "the role-shim test proves that a denied write, spend or delete leaves the corpus as it was" }
  - { path: components/improve/connectors/git/tests/test_git_connector.py, reason: "the git test raises a skip when git is missing instead of returning early" }
  - { path: tests/run.py, reason: "the runner understands a skip: it prints it, counts it and does not call it a pass" }
  - { path: tests/test_stage_syntax.py, reason: "owner decision 2026-11-02: a refused workflow (a gate with when:) fails the call too, so the gate-syntax test asserts the failed call and its error" }
  - { path: components/cos/tests/test_workflows.py, reason: "the live-run edit test asserts that the call fails" }
  - { path: components/cos/connectors/workflow-runner/workflow_runner.py, reason: "a report the run can no longer take ends the run as failed and then fails the call" }
  - { path: components/cos/playbook.md, reason: "one sentence: a failed cos.next call means the run ended because its workflow changed" }
  - { path: docs/INTERFACES.md, reason: "section 6 says a stage report the run cannot take fails the call" }
  - { path: bay/__init__.py, reason: "release step: version 1.1.2" }
  - { path: CHANGELOG.md, reason: "release step: entry" }
---

# 0014: Test defects

## Problem

The test inventory found three tests that pass without proving what they claim. A test that cannot fail is worse than no test, because it is read as evidence. Each defect is described below as the test claims it, why it does not prove it, the change, and how we will show that the fixed test fails on the defect. Only the third defect is also a fault in the product.

## The changes

**1. The role shim test never checks that the shim cannot write.** The test `test_role_shim_reads_only_its_grants_and_cannot_write_spend_or_delete` in `tests/test_boundaries.py` claims that an analyst's use shim can read what it is granted and cannot write, spend or delete. The read half is real. The write half ends with `before = corpus.db.read_bytes()` followed by `assert before == corpus.db.read_bytes()`, which reads the same file twice with nothing in between, so it is true whatever the shim does. The refusals in the loop above it are checked only by exit code and the words "not granted", so a shim that refused politely and still wrote would pass. There is a second weakness: the loop calls `prune` with `{}`, which would delete nothing even if the grant were wrong, so comparing the file around that call would still prove nothing.

The change: the test reads the corpus file before the loop of denied calls and after it, and compares the two. The `prune` call in the loop gets `{"olderThan": "1m"}`, which on this fixture removes every stored item if it is ever allowed to run. After the loop the test runs the granted `query` again and expects the same author set as before. The rejected approach is comparing row counts through the sql endpoint, because that would use the very channel under test and says less than the bytes of the file.

How we will show it fails on the defect: I tried it in a scratch project. With the grant check bypassed in process, `prune` with `olderThan: "1m"` reports `removed: 7, remaining: 0` and the file's hash changes, while the same call with `{}` removes nothing. So during implementation we add `items.store/v1.prune` to the analyst's `bay_uses` as a temporary, uncommitted edit, and quote the result: the old test passes, the fixed test fails at the new comparison. The edit is reverted before the commit.

**2. The git connector test passes silently when git is missing.** The test `test_commits_reverts_and_churn_without_messages`, now in `components/improve/connectors/git/tests/test_git_connector.py`, claims that commits become episodes, reverts are detected, churn is counted and bodies never leave the connector. It starts with `if not shutil.which("git"): return`, so on a machine without git it passes having checked nothing, and the summary reads `1 passed`. I confirmed this with a `PATH` that holds only python: the runner printed a check mark for it.

The change: the early return becomes `raise unittest.SkipTest("git is not installed")`. A skip is the standard way to say "not run", and pytest already treats it as one, since `tests/conftest.py` lets the same files run there. `tests/run.py` has no notion of a skip today and would count it as a failure, so it gets one: it catches `SkipTest`, prints `- <file>::<name> skipped: <reason>` (also under `-q`, like failures), and ends with `N passed, M failed, K skipped`. The runner is not part of any counted measure: `bay_lines` counts `bay/`, `kit_python_lines` excludes `tests/`, and `tests` counts only `def test_` in test files. Rejected: a decorator or helper in `tests/helpers.py`, because one use does not earn one; and deleting the guard so the test fails without git, because git is not a dependency of the kit and the test would then fail for a missing tool, not a defect.

How we will show it fails on the defect: with `PATH` holding only python, the old test is reported as passed and the fixed test is reported as skipped with its reason, the summary shows `0 passed, 0 failed, 1 skipped`, and the same run exits 0. With git present the test runs and passes as before. We add no test for the runner itself, since the test count must not grow; the quoted before and after output is the evidence.

**3. The call says done while the run says failed. This is a real fault, in the workflow runner and not in the dispatcher.** The test `test_editing_the_workflow_under_a_live_run_fails_loudly` in `components/cos/tests/test_workflows.py` claims that when someone edits a workflow under a live run, the failure is loud. It asserts the opposite of loud for the caller: `out["status"] == "done"`, with the failure only inside `out["output"]["status"]`, and a comment calling that correct. I ran it: the call returns `done` with no error, while `cos.status` shows the run as `failed`. A coordinator reading the call status, as its playbook tells it to, sees success.

Why it is not a test problem: the dispatcher is right. A connector that returns is `done`, and one that raises is `failed` with its message (`Dispatcher._run_code` in `bay/dispatch.py`). The fault is in `WorkflowRunner._advance` in `components/cos/connectors/workflow-runner/workflow_runner.py`, which on a stage that has vanished from the edited workflow marks the run failed and then returns normally. Its neighbours behave the other way: when the whole workflow is gone, `_def` raises `ConnectorError`, and so do a run that is over or one waiting at a gate. The other failed-run cases keep returning `done`, correctly: when a stage's own call failed or was blocked, the report was taken and recorded, and the call's output says the run ended. A vanished stage is different because the report could not be taken, and that is an error.

The change: in the branch of `_advance` for `missing` and `refused`, the runner saves the run as failed with its reason as now, then raises `ConnectorError` with that reason, so the call ends `failed` with the message. The run record stays true, and the next `cos.next` for that run says the run is already over. The edit merges the two assignments to `run` into one line, so the file stays the same length. `components/cos/playbook.md` gains one sentence for the coordinator: a `cos.next` call that itself fails with "the workflow changed after this run started" means the run has ended, so report it and start a new run. `docs/INTERFACES.md` section 6 gains the same fact in one line. The owner decided on 2026-11-02 that `refused` fails the call the same way, so `test_no_output_passed_to_cos_next_skips_a_gate` in `tests/test_stage_syntax.py`, which today expects `done` with a failed output, asserts the failed call and its error "a gate takes no when:" instead. The test is changed to assert `out["status"] == "failed"`, that the error contains "no longer in workflows.morning", and that `cos.status` shows the run `failed`. `StageOut` is unchanged: that output shape is still what every other path returns.

How we will show it fails on the defect: on the current code the changed test fails at its first assertion with status `done`, which I reproduced in a scratch project (call `done`, no error, run `failed`). After the fix it passes.

## Cost against the ceilings

- `bay_lines` (ceiling 9595, count 9595): unchanged. Nothing under `bay/` is edited except the version string in `bay/__init__.py` at release, which keeps its line count. No exception is needed.
- `kit_python_lines` (6580, count 6580): unchanged. The runner gains one line and loses one, as described. The release step confirms the count.
- `tests` (539, count 539): unchanged. No test is added or removed; three are made stricter.
- `cli_commands` (16), `schemas` (16), `framework_folders` (2) and `top_level_folders` (7): unchanged.

So there is no `exceptions:` entry, and `framework/limits.yaml` is not edited. `touches:` lists nine files, so by the default `approvals.plan: large` rule no plan is needed: it is under ten, has no exceptions, and no touch is at or under `bay/dispatch.py`, `guard.py`, `cli.py`, `ledger.py` or the other named files. If the gate is run on a file list longer than this one, the plan step will be asked for.

## Compatibility and safety impact

No backward-compatibility code is added. No schema changes and no `apiVersion` bump: the `cos.next` input and the `StageOut` shape are untouched. What changes is one outcome of `cos.next`: when a stage has vanished from an edited workflow, the call now ends `failed` with the reason where it used to end `done`. The run's own record is the same as before. A caller that read only the call status was wrongly told "done"; a caller that read the run status sees no difference. The release is a patch, 1.1.2.

Nothing here touches an approval, a gate, a grant, a secret or the guard. The shim change makes a boundary test stricter and weakens nothing. `README.md` and `docs/DESIGN.md` need no edit: neither describes the runner's skip output or this error path, and the README line for `tests/run.py` already reads "the test suite". `test_resolve_checks_every_evidence_kind` in `components/improve/connectors/improve-detect/tests/` also checks `shutil.which("git")`, but it only leaves out the git evidence and still runs its other checks, so it is outside the approved scope and is left as it is.
