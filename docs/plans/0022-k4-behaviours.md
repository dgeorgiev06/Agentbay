# K4: kept, changed and dropped behaviours

Slice K4 of plan 0022 (the engine: `bay/engine.ts`, `bay/run-store.ts`, `bay/references.ts` and the files they are split into). One line per test function of the five old files named for the slice, read with `git show main:tests/<file>`. "Named" means the proposal or plan names the drop: roles and agent profiles (Concepts), review as a skill like any other rather than verdict records (Concepts, Role row), the gate and plan approval replaced by the `approval` workflow step (Concepts), the ledger and call state files replaced by the `runs` and `events` tables (Concepts), and the Chief-of-Staff stage syntax replaced by workflows of four step kinds where "anything more belongs in a script" (Workflows and runs). "Owner" means it is not named, and the drop goes back to the owner (plan, R-5). "Later slice" means the behaviour is not lost but is not K4's.

New tests: `tests/engine.test.ts` (E), `tests/engine-workflow.test.ts` (W), `tests/engine-crash.test.ts` (C), `tests/run-store.test.ts` (S), `tests/references.test.ts` (Ref), `tests/registry.test.ts` (R), `tests/budget.test.ts`, `tests/json.test.ts`. E and W run every scenario against both the in-memory and the SQLite store.

## tests/test_dispatch.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_input_schema_validated` | kept | E "input that breaks the action's input schema is refused before any run exists", including an unknown action and an unknown mode. |
| `test_sync_runs_code_step_and_logs_events_with_cost` | changed | A code step is a `script` step run by the `ScriptRunner`; its events are `step.started`, `step.finished` (with `spent`) and `run.finished` rows in `kernel.db` (C "one representative run emits every event kind"). The event JSON Schema file is gone: events are typed columns, not JSONL lines (named: ledger replaced by tables). |
| `test_config_lookback_default_and_caps_strictest_wins` | changed / later slice | Caps become budgets: the smallest of workflow, action and project default per measure (E "the smallest of the action's budget and the project default applies, in nested calls too"). `lookback` is a feed-briefing setting (M3). |
| `test_budget_exhausted_blocks_with_reason` | changed / dropped | A run at its limit waits for `budget` with the measure, limit and spend, and continues on `extendBudget` or ends on `stop` (E "exceeding <measure> waits ..." for each measure). Dropped: a monthly cap that spans runs; the proposal names only per-run budgets (owner). |
| `test_offline_source_is_never_billed_against_spend` | changed | The engine charges only what a `StepOutcome` reports, so a fake source that reports no spend costs nothing (E "nested calls draw from the caller's remaining budget"). The offline switch is a binding to a fake mode (K1, named). |
| `test_agentic_step_returns_plan_then_review_then_partial_on_failed_must` | changed / dropped | `needs-agent` becomes a `skill` step that waits with a `SkillTask` (E "a skill step waits with its task"); a submit for another step and an output that breaks the schema are refused (E "a submission for another step or round is refused", "a submission that breaks the skill's output schema is refused"). The review step, its verdict ids and `partial` are replaced by the checks loop (E checks tests; named: review is a skill). `runAs`, role, model and playbook text are dropped with roles (named); tier to model is K6; citation checks are mode scripts (M2, M3). |
| `test_digest_done_when_review_passes` | changed | Done when the checks pass: E "a failed check sends the skill back with feedback, and a passing round 2 finishes it". Closing dispatched agent tasks in the ledger is dropped with agent tracking (named: roles, ledger). |
| `test_stale_refresh_is_skipped_when_fresh` | dropped | `when: stale > 2h` step conditions do not exist; workflows have four step kinds and anything more belongs in a script (named). Freshness is a feed-briefing script (M3). |
| `test_use_enforces_role_grants` | later slice / dropped | Grants are the broker's permissions (K3). Role units are dropped (named). The engine hands each script the callee's `Permissions` (E "a call step runs the bound mode's action with the callee's permissions"). |
| `test_effects_rechecked_at_runtime` | kept | E "a call to an action with an effect the caller lacks is refused at run time, before it runs". Effects are the action's, not an environment's (named). |
| `test_connector_failure_is_reported_redacted` | kept / later slice | A failed script fails the run with its reason (E "a failed script step fails the run with its reason"); event details carry the reason's size, never its text (C event test). Redacting secrets from the reason is K3's runner; the engine stores the reason it is given. |
| `test_secrets_never_in_ledger_output_or_store_on_success` | later slice | Secrets are K3's. K4's part: events carry ids and sizes, not payloads (C "... with ids and sizes but no payloads"). |
| `test_redact_is_a_last_line_of_defence` | later slice | `bay/secrets.ts` (K3). |
| `test_gate_stops_and_resumes_only_on_approval` | changed | The gate is the `approval` step: only `approve` with the shown hash continues it, a submit cannot (W "an approval records the hash of what it showed and continues only for that hash"). Rejecting fails the run and runs undo instead of ending `blocked` (W "a rejected approval fails the run and undoes finished actions"). The "approve from your own terminal" text is the CLI's (K5). |
| `test_failed_review_halts_before_release` | changed / dropped | A failed must item sends the skill back, three rounds at most, then the run fails before any later step (E "a check that still fails in round 3 fails the run"). Severity levels, conformance rule sets and the recheck that carries verdicts from a prior call are dropped with review verdict records (named: review is a skill). |
| `test_selector_change_forces_refresh_even_when_fresh` | later slice | Selectors are feed-briefing's (M3). |
| `test_front_matter_marker_grants_nothing` | changed / dropped | Nothing in content passes an approval: it waits until `approve` names its hash (W hash test; W "an approval event written into the log by anyone but the engine passes nothing"). Skipping propose and plan steps is forge's workflow (M6). |
| `test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval` | changed / dropped | An approval binds the SHA-256 of the canonical JSON of what `show` resolves to, such as `$steps.propose.output` (W hash test). Dropped: a later run that names the same unchanged file skips its approval; approvals are per run (owner). |
| `test_the_step_result_accepts_what_the_worker_contract_returns` | changed | A skill's result is checked against its own `metadata.output` schema, and the action's output schema when it is the last step (E "a submission that breaks the skill's output schema is refused"). `Result/v1` is gone with the worker contract (named: skill contract). |
| `test_gate_plan_and_show_name_the_chat_path_when_approve_from_lists_chat` | later slice | How the owner approves (terminal, chat) is the CLI and adapter (K5, K6). The engine records who approved in `approval.recorded` (W hash test). |
| `test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate` | dropped | Reusing an approval across runs (owner, as above). `by` is kept in `approval.recorded`; the chat quote is not recorded (K5 may add it to `by`). |
| `test_an_edit_after_approval_makes_the_gate_run_again` | changed / dropped | Content that changes while the approval waits returns the run to the approval with the new hash, and the old hash is refused (W "when the shown content changes, approving the old hash returns the run to the approval"). Dropped: re-checking content after the approval step finished; a finished approval is final in the run (owner). Approving a proposal and a plan together becomes one `show` of a mapping of both, hashed as one value; hash prefixes are not accepted (changed). Choosing a plan step by the size of `touches` is forge's (M6). |
| `test_only_bay_approve_events_count_as_a_recorded_approval` | kept | W "an approval event written into the log by anyone but the engine passes nothing": the engine reads steps, never events, to decide. |
| `test_a_gate_takes_no_when_and_approves_goes_on_a_gate_only` | changed | There is no `when:`; `show:` exists only on approval steps, and the closed workflow schema refuses any other field (R "a when condition on a workflow step is refused"). |
| `test_when_names_only_an_earlier_step` | kept | R "a reference to a step that is not defined earlier in its scope is reported". |
| `test_a_listed_step_is_planned_approved_and_then_run_by_a_fresh_agent` | dropped / later slice | Plan approval as a separate mechanism is replaced by a skill step and an approval step in a workflow (named). The per-agent write limits are K6's hook. |

## tests/test_stage_syntax.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_stage_syntax_table` | changed / dropped | The golden table of `when`, `with` and `gate` forms becomes the reference grammar: Ref "the four reference forms parse, and nothing else does" and the R reference tests. `$in` is `$trigger`, `$config.x` is `$settings.x`. Dropped: `when` conditions, `stale >` and `$a|$b` alternatives (named: four step kinds; references are resolved whole). |
| `test_the_reference_grammar_is_spelled_once_and_the_schemas_equal_it` | changed | The grammar is spelled once, in `bay/references.ts`; the workflow schema only requires that a reference starts with `$`, and the registry applies the grammar, so there is no second spelling to keep equal. |
| `test_the_dispatcher_and_the_cursor_share_one_skip_rule_and_one_substitution` | changed / dropped | One resolver serves the engine and the registry (`bay/references.ts`). The skip rule goes with `when` (named). Dropped: the `*` wildcard in a path and `$call.base`; the contracts section defines the grammar without them, and a script can map a list. |
| `test_a_project_workflow_gate_with_when_is_refused_and_the_message_names_the_fix` | changed | `when:` on any step is refused by the closed workflow schema with "has the field when, which is not allowed here" (R "a when condition on a workflow step is refused"). |
| `test_lint_reports_a_project_gate_with_when` | later slice | `bay check` reports schema problems (K2). |
| `test_no_output_passed_to_cos_next_skips_a_gate` | kept | No step output can pass an approval; only `approve` with the hash does (W hash test). The `cos.next` cursor is replaced by the engine (named). |
| `test_a_gate_without_when_still_waits_for_the_owner` | kept | W hash test: the run waits at the approval with its question. |

## tests/test_ledger.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_note_on_unknown_ref_never_creates_a_running_run` | dropped | `bay note` and instruction-change notes have no counterpart; only the engine creates runs and their events (owner). |
| `test_note_attaches_to_existing_run_by_run_id_or_task_id` | dropped | As above (owner). |
| `test_code_steps_and_calls_carry_duration_and_cost` | changed | Each step row has `started_at` and `finished_at` from the clock and its `spent`; `step.finished` carries `spent` (S, C event test). There is no `durationMs` field. |
| `test_submit_records_reported_usage` | changed / dropped | Spend is what a script's `StepOutcome` reports. Dropped for now: usage of a skill step, because `submit` in the contracts takes no spend (reported as a needed contracts change). |
| `test_guard_decisions_are_ledger_events_without_raw_commands` | later slice | The deny hook (K6). |
| `test_hook_records_agent_duration_and_tokens` | later slice | The adapter (K6), with the same contracts gap as skill usage above. |
| `test_ledger_scrubs_secret_shaped_text_and_stays_valid_json` | changed / later slice | Events hold ids, sizes and step keys, no free text, so there is nothing to scrub in them (C event test). Scanning outputs for secrets before they are stored is K3's scanner; the engine has no hook to call it yet (reported). |
| `test_secret_scan_catches_planted_secrets` | later slice | K3. |
| `test_secretscan_catches_bare_values_with_dots_and_digit_less_secrets` | later slice | K3. |
| `test_audit_parses_source_that_contains_secret_shaped_code` | later slice | improve (M7). |
| `test_bay_plan_records_scrubbed_size_limited_append_only_events` | dropped / kept | `bay plan` records are dropped with needs-agent plans (named). Kept: events are append-only; the store has no way to change or delete one (S). |
| `test_a_steps_usage_is_split_among_the_agents_dispatched_to_it_not_counted_per_agent` | dropped | No agents in the kernel; spend is per step and per run (named: roles and agent profiles). |
| `test_a_dispatched_agent_is_listed_by_status_without_the_spawn_hook` | changed / dropped | Runs are listed by status (`RunStore.listRuns`, S); `bay runs` is K5. A stuck run is shown by its lock: a writer without a heartbeat for ten minutes is replaced, and that is an event (S, C "a lock left by a dead engine is taken over after ten minutes"). Agent-level dispatch, reclaim and stale lists are dropped (named: roles). |

## tests/test_review_record.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_review_record_appends_a_scrubbed_event_improve_reads_and_refuses_bad_input` | dropped | Review verdict records as a separate mechanism (named: review is a skill). |
| `test_a_recorded_review_passes_no_gate_and_nothing_in_the_dispatcher_reads_it` | kept | W "an approval event written into the log by anyone but the engine passes nothing". |

## tests/test_submit_needs_plan.py

| Old test | Verdict | Where, how or why |
|---|---|---|
| `test_submit_is_refused_without_a_recorded_outcome_and_accepted_after_bay_plan` | dropped / kept | The plan-before-submit rule goes with needs-agent plans (named). Kept: a submit is refused unless the run waits for exactly that step and round (E "a submission for another step or round is refused and changes nothing"). |
| `test_bay_show_prints_the_inputs_a_dispatch_recorded` | changed | Every step's input is saved before it starts and the waiting `SkillTask` carries it (E pipeline and skill tests); printing is K5. |
| `test_a_plan_of_another_step_or_call_does_not_count` | changed | A submission counts only for its run and its `<step>#<round>` (E "a submission for another step or round is refused"; E "a failed check sends the skill back", where the round 1 key is refused in round 2). |
| `test_a_later_spawn_record_does_not_override_the_coordinators_dispatch` | dropped | Dispatch and spawn records are the adapter's, not the kernel's (named: roles, ledger). |
| `test_a_steps_submit_closes_every_run_dispatched_to_that_call_and_step` | dropped | As above. |
| `test_a_result_taskid_counts_when_its_dispatch_names_this_call_and_step_or_no_call` | dropped | As above. |
| `test_plan_ownership_is_per_agent_type_not_per_run` | dropped | As above. |
| `test_a_closed_call_is_abandoned_and_refuses_submit_and_approve` | changed / dropped | `stop` ends a run (failed, then undo), and submit, approve and extend on an ended run are refused (E "an extension must not be negative, and stop ends a run that waits for budget"; E skill test; W hash test). Dropped: replacing one call by a new one that inherits its base commit (owner). |
