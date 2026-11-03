---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. This rewrites the first draft, which the owner rejected on 2026-11-02 as too complicated; the owner chose the simpler design in this file the same day. Scope: the seven items of that decision, nothing more.
id: "0015"
status: draft
touches:
  - { path: bay/config.py, reason: "the `approve` setting (from, plans, planner) replaces `chat_approvals`; apiVersion agentbay/v4" }
  - { path: bay/cli.py, reason: "`from` replaces the chat switch; a backlog id follows the same channel; `bay auth` loses its terminal check; `bay status` ages a run from its last event and says when the guard has not run" }
  - { path: bay/dispatch.py, reason: "a changed approved file returns the call to its gate; a recorded approval is shown by `bay show`; the close reason reaches the ledger summary; a plan file can be a gate's subject" }
  - { path: bay/model.py, reason: "resolve expands each listed role step into plan step, gate and the step itself, as it already injects the review step" }
  - { path: bay/lint.py, reason: "every `approve.plans` entry must name a real endpoint or role step without `when:`" }
  - { path: bay/ledger.py, reason: "a run records the time of its last event" }
  - { path: bay/guard.py, reason: "every hook call touches a heartbeat file" }
  - { path: bay/boundary.py, reason: "B-3: a listed mode folder covers its feature folders" }
  - { path: bay/util.py, reason: "PLAN_PATH, the pattern for docs/plans/<name>.md" }
  - { path: schemas/config.schema.json, reason: "`approve: { from, plans, planner }` replaces `approvals`; apiVersion agentbay/v4" }
  - { path: schemas/mode.schema.json, reason: "the gate description names `approve.from`, not `approvals.chat`" }
  - { path: framework/kernel.yaml, reason: "the env `plan-writer` is protected and open to every mode" }
  - { path: framework/roles/lead.yaml, reason: "its comment and prompt say the planning step is also what `approve.plans` adds" }
  - { path: components/tools/envs/plan-writer.yaml, reason: "new env: reads the project, writes docs/plans/ only, runs no command but `bay plan`" }
  - { path: adapters/claude-code/claude_code.py, reason: "the generated coordinator text names `approve.from`; `bay auth` joins the commands that always ask" }
  - { path: components/forge/mode.yaml, reason: "the comment on the plan step; one line in the propose step's task about `touches:`" }
  - { path: components/forge/connectors/scaffold/scaffold.py, reason: "the plan step is always `large`, so the `approvals.plan` lookup goes" }
  - { path: components/forge/interfaces/forge.scaffold.v1.yaml, reason: "the shorter description of `proposal`" }
  - { path: components/forge/features/extend/playbook.md, reason: "plan step wording, a changed file returning to the gate, the release Result carries the publish commands" }
  - { path: components/forge/features/extend/rules.yaml, reason: "R-11 and R-12 reworded to match B-3 and the gate" }
  - { path: components/cos/playbook.md, reason: "briefs are scope only; chat gates follow `approve.from`" }
  - { path: components/cos/interfaces/workflow.run.v1.yaml, reason: "the chat sentence names `approve.from`" }
  - { path: components/improve/connectors/improve-store/store.py, reason: "a backlog approval may come from chat when `approve.from` allows it (protected path)" }
  - { path: components/improve/playbook.md, reason: "backlog decisions may come from chat" }
  - { path: components/improve/features/implement/playbook.md, reason: "same" }
  - { path: components/improve/README.md, reason: "same" }
  - { path: components/mail-briefing/playbook.md, reason: "`bay auth` runs from the app after its permission prompt" }
  - { path: agentbay.config.yaml, reason: "the owner's file, edited by the owner by hand: `approvals: { chat: true }` becomes `approve: { from: [terminal, chat] }`" }
  - { path: README.md, reason: "the commands table and the approval sentence" }
  - { path: docs/DESIGN.md, reason: "the threat model, plan approval, the reopened gate, `approve`; paid for by cuts (see Cost)" }
  - { path: docs/INTERFACES.md, reason: "`approve.plans`, the reopened gate, `replaces`; paid for by cuts (see Cost)" }
  - { path: tests/, reason: "existing tests extended or rewritten; one new test, paid for by removing one" }
  - { path: components/forge/tests/, reason: "the plan-step rule without `approvals.plan`" }
  - { path: components/gmail-api/tests/, reason: "config fixtures move to agentbay/v4" }
  - { path: components/briefing/tests/, reason: "config fixtures move to agentbay/v4" }
  - { path: components/mail-briefing/tests/, reason: "config fixtures move to agentbay/v4" }
  - { path: bay/__init__.py, reason: "release step: version 2.0.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading section" }
  - { path: framework/limits.yaml, reason: "release step: the ceilings are written down to the real counts" }
exceptions:
  - { measure: bay_lines, to: 9650, reason: "the item-by-item estimate in Cost is about +48 lines in bay/ against a ceiling that is already reached, and the payers that can be named from today's code are already counted in it. 9650 is an upper bound with a 7-line margin. The plan step must name every payer it finds first, and the release lowers the ceiling to the real count." }
---

# 0015: Plan approval as a gate, and process gaps

## Problem

The owner can approve a proposal but not what an agent will do with it. A builder records a plan that nobody approves, and it may write at once. Around that gap sit smaller ones found in the 0013 review and in the owner's discussions of 1 and 2 November: two unrelated approval settings, a touches rule that contradicts the amend rule, an approval that stays valid after the approved file changes, an owner who has only the app, and a few facts that `bay show` and `bay status` get wrong.

The first draft of this proposal built a separate plan-approval system. The owner rejected it as too complicated. This draft solves the same need with the machinery that already exists: a plan is a file, approving it is a gate, and a gate already binds the exact content of a file. Each item below gives the problem with its evidence, the change, and the test that fails on `main`. The proposal touches 39 entries, has an exception and touches sensitive paths (`bay/dispatch.py`, `bay/guard.py`, `bay/cli.py`, `bay/ledger.py`, `bay/boundary.py`, `adapters/`, `schemas/config.schema.json`, `framework/kernel.yaml`), so forge.extend's plan step runs for it as today. Nothing is implemented before the gate.

## The changes

**1. One `approve` setting.**

*Today.* Two keys control approvals: `approvals.chat` (`schemas/config.schema.json`, read by `chat_approvals` at `bay/config.py:67`) and `approvals.plan` (`large`, `always` or `never`, read at `components/forge/connectors/scaffold/scaffold.py:50`). `chat_approvals` is called from `bay/cli.py:295` and `bay/dispatch.py:694` (`_chat_path`); only a gate honours it. A backlog item (`bay approve F-...`) always demands a terminal (`bay/cli.py:386-400`, `components/improve/connectors/improve-store/store.py:184`).

*Change.*

```yaml
approve:
  from: [terminal, chat]              # where the owner can decide; default [terminal]
  plans: [delivery.build.implement]   # <mode.endpoint> or <mode.endpoint.step>; default []
  planner: { tier: deep, effort: high }   # optional; the default is shown
```

`approve` replaces `approvals` whole; `approvals` is refused with a message naming `approve`, and no alias is kept. `from` replaces `approvals.chat` (chat is on exactly when `from` lists it) and applies to gates and backlog items alike (item 5). `plans` is item 2. `approvals.plan` goes: forge.extend's own plan step is always `large`, so `plan_reason` in `scaffold.py` drops its `want` argument. What this loses is `always` and `never`. `never` still showed the gate, so it only saved a plan file for a large proposal; `always` is reachable by listing a step (item 2). The config schema goes from v3 to v4 and the release is 2.0.0.

*Test that fails on `main`.* `tests/test_config.py` asserts that `approvals: { chat: true }` is refused naming `approve`, and that `from: [chat]` lets `bay approve --via chat` through while the default refuses it. The chat tests in `tests/test_boundaries.py` and `tests/test_protection.py` are rewritten in place for the new key. On `main` the new key is rejected by the schema.

**2. Plan approval is a gate.**

*Today.* forge.extend already has the three pieces, wired by hand for one feature (`components/forge/mode.yaml`): a `plan` step (role `lead`, tier deep), an `approve` gate with `approves:` naming the proposal, and `implement`. The gate machinery hashes the file itself (`_file_subject`, `bay/dispatch.py:425`), records path and sha256 in the ledger at `approve` (`bay/dispatch.py:148`), and skips a later gate only for unchanged content (`_gate_check`, `bay/dispatch.py:439`). Three things stop it from serving any step:

- The steps are written in forge's `mode.yaml` and cannot be switched by the owner's config. A gate takes no `when:` (`bay/model.py:1153`), and `when:` reads only `$in` and `$steps` (`bay/workflows.py:319`), not `$config`, so a mode cannot say "plan here only if the owner listed me".
- The plan step is not confined to a plan file. Its env is `framework-dev` (`mode.yaml`, `roles: { lead: framework-dev }`), which writes `bay/`, `framework/`, `schemas/` and `adapters/` (`components/forge/envs/framework-dev.yaml:21-33`). "Write that one file only" is task text, and the lead role's prompt repeats it; nothing enforces it.
- The gate recognises only `docs/proposals/<id>.md` (`PROPOSAL_PATH`, `bay/util.py:76`, used at `bay/dispatch.py:430`), and derives the plan file from the proposal's name (`_gate_subject`, `bay/dispatch.py:415-423`).

*The simplest mechanism, and why.* I considered three.

- **Mode configuration alone** (each mode author writes `plan`, `gate` and the work step, as forge does). It needs almost no code, but the owner's `approve.plans` cannot switch it on, because of the `when:` rule above, and it would mean editing every mode, including the protected ones. Rejected.
- **The dispatcher inserts the steps while the call runs.** It would work, but the step list would differ from the one `bay check` validated, and `bay build` would not know to generate the planner's subagent file.
- **Resolve expands the step list** (chosen). `_feature_steps` (`bay/model.py:1144`) already injects the review step at a marker, using the same step builder that every mode step uses. For each role step listed in `approve.plans`, it emits three steps in place of one:

  | step | what it is |
  |---|---|
  | `<id>-plan` | role `lead`, env `plan-writer`, tier and effort from `approve.planner`, out `Result`; the task asks for `docs/plans/<name>.md` holding the outcome, the items, the files and the risks, listed in `artifacts` |
  | `<id>-approve` | a gate, `approves: $steps.<id>-plan.artifacts`; the existing `bay approve <callId>` passes it, bound to the file's sha256 |
  | `<id>` | the original step, unchanged except that its task gains one sentence: follow the approved plan named in `previous.<id>-plan.artifacts`, and report `partial` if it cannot be followed |

  The original step runs as a fresh subagent. That is already the case: every role step is its own dispatch, and the plan step's agent is closed by its submit (`_close_runs`, `bay/dispatch.py:115`). The worker's brief already carries earlier outputs as `previous` (`_executor_brief`, `bay/dispatch.py:679`), so the plan path needs no new input field. The cursor, the `awaiting-approval` status, `bay approve`, the ledger record and the skip rule are all unchanged.

*The env that confines the planner.* A new env `plan-writer` (`components/tools/envs/plan-writer.yaml`):

```yaml
bind:
  workspace.read/v1: { tools: [Read, Glob, Grep] }
  workspace.write/v1: { tools: [Write, Edit, Bash], clis: [] }   # Bash only for `bay plan`
fs: { read: ["."], write: [docs/plans] }
tiers: [balanced, deep]
effects: [read, write]
```

The write scope needs no new guard logic. The adapter gives a role writable paths only when the role has `access: write` and a file-writing tool (`adapters/claude-code/claude_code.py:432`), and `Guard._write_denied` (`bay/guard.py:367`) then refuses any write outside `fs.write`. The lead role already has `access: write`. Bash is bound with an empty `clis` because the guard lets a subagent run `bay plan` regardless of `clis` (`_bash_in_role`, `bay/guard.py:422`) but only if the agent has the Bash tool, and a submit is refused without a recorded plan (`_require_plan`, `bay/dispatch.py:131`); with `clis: []` it can run nothing else (`_deny_unlisted`). `framework/kernel.yaml` lists `plan-writer` under `protected: env:` as open to every mode (`plan-writer: { modes: ["*"] }`), as `workspace` and `research` are, so a user mode may use it.

*Models.* The owner decided: the planner runs on opus and the worker on sonnet by default, and both are configurable. The framework already resolves a role step's model as step `tier:`, then feature `tier:`, then the role's default, and the agent profile maps the tier to a model (`adapters/claude-code/adapter.yaml:10`, `tiers: { fast: haiku, balanced: sonnet, deep: opus }`; `_role_step`, `bay/model.py:1319`). That covers the worker without a new setting: the original step keeps its own line, so `builder` stays balanced, which is sonnet. It cannot cover the planner, because the plan step exists in no `mode.yaml` and so has no line to carry a `tier:`. The smallest addition is the optional key `planner: { tier, effort }` under `approve`, default `deep` and `high` (forge.extend's plan step already runs deep, which is opus). Where the owner changes each model:

| model | where | example |
|---|---|---|
| planner, all listed steps | `agentbay.config.yaml` | `approve: { plans: [delivery.build.implement], planner: { tier: balanced, effort: medium } }` |
| worker, one step | the step's `tier:` in its `mode.yaml` | `- { id: implement, role: builder, tier: deep, ... }` (for a framework mode, through forge.extend) |
| worker, every step of a feature | the feature's `tier:` in its `mode.yaml` | `build: { tier: deep, ... }` (the planner is unaffected: the injected step carries its own tier) |
| what a tier means | `profile.tiers` in `adapters/claude-code/adapter.yaml` | `tiers: { fast: haiku, balanced: sonnet, deep: opus }` |

If the owner would rather keep zero new settings, the fallback is a constant in the expansion (deep, high), changed only through forge.extend; I recommend the key because the owner asked for configurability. This is one of the open choices.

*Limits of what the goal asks.* Three points the goal does not hold as stated, with the nearest simple alternative.
1. "Reuse forge.extend's plan step": its machinery is reused, but not the step itself, for the reasons above. forge.extend keeps its own plan step and gate, which already bind proposal and plan together, so listing `forge.extend.implement` would add a second gate and is pointless; it is the way to get the old `always`, if the owner wants a plan for every proposal.
2. A listed step may have no `when:`, because a gate cannot be skipped by a value and a skipped step must not leave its gate behind. Lint refuses it, naming the step. The endpoint form `<mode.endpoint>` covers each role step of the endpoint that has no `when:`, except the injected review; the step form picks one.
3. The gate guards the call, not the tool. Until the owner approves, the dispatcher issues no step plan for the work and refuses its submit (`bay/dispatch.py:92`: a call waits for the step at its cursor). It does not stop a coordinator from doing the work by hand outside any call, as is true of every gate today. The first draft's guard blocking per agent type closed that; see "What the rejected design had".

*Test that fails on `main`.* One new test in `tests/test_dispatch.py` (paid for under Cost). It configures `approve: { plans: [delivery.build.implement] }`, calls `delivery.build`, and asserts: the first step plan is `implement-plan` in env `plan-writer` at tier deep; the generated guard policy gives that unit `write: [docs/plans]` and no `clis`; submitting the plan with an artifact outside `docs/plans/` is refused; the next status is `awaiting-approval` with the plan's path and sha256; `bay approve` (with `--sha` for chat) moves to `implement`, a fresh agent whose brief names the plan; and with `planner: { tier: balanced }` the first plan runs at sonnet. On `main` the config key is unknown and the call's first step is `implement`.

**3. An approval covers only what the owner saw.**

*Today.* After a gate passes, the approved file is a living file: nothing compares it again. A builder that amends the proposal (as R-12 allows) carries on, and `deadcode`, `limits` and review run on content the owner never saw. `approve` refuses the call once the gate has passed (`bay/dispatch.py:156-157`: "is needs-agent, not awaiting approval"), so the owner has no way to approve an amendment either. Separately, `bay show` of a finished call still prints the planning-time sentence "the gate runs: no recorded approval of ..." (`_public`, `bay/dispatch.py:722-725` prints `state["gates"][...]["why"]`, written when the gate was planned). Call C-20261102-d4bfca is `done` and says so.

*Change.* One check at the top of `_advance` (`bay/dispatch.py:343`), which every submit and every approval passes through. For each gate already passed, it recomputes the gate's subject (`_gate_subject`) and compares it with the one recorded in `state["gates"][<gate>]["approves"]`, which holds the approved content for passed and skipped gates alike. If it differs, the dispatcher remembers the cursor it was at, sets the cursor back to that gate, recomputes `why` with the existing `_gate_check` ("changed since <by> approved it on <date>"), and returns `awaiting-approval`. The same `bay approve <callId>` passes it again; `approve` then resumes at the remembered cursor instead of the step after the gate, so nothing is run twice. A rejection ends the call as today. There is no separate amendment path and no new command. The check covers a proposal, a plan and the injected plan gate of item 2 equally, because all are gate subjects.

`approve` also overwrites the gate's `why` with "approved by <by> on <date> (sha256 ...)" (or "rejected by ..."), so `bay show` reflects the record.

What this does not do: between the edit and the next submit, a builder is still running under the old approval. Nothing it produces is accepted or checked until the owner has seen the change, and that is the commitment.

*Test that fails on `main`.* `test_an_edit_after_approval_makes_the_gate_run_again` (`tests/test_dispatch.py:444`) goes on past the gate: it edits the proposal while the call is at `implement`, submits, and asserts the call is `awaiting-approval` at the gate with a `why` naming the change, that `bay approve` passes it, that the call resumes at the next step, not at `implement`, and that `show` says "approved by". On `main` the submit is accepted and the call moves on.

**4. B-3: a listed mode folder covers its feature folders.**

*Today.* Rule R-11 says to list a folder where files may be renamed. Rule R-12 says to amend only for a change of scope or design. But B-3 accepts a path under `components/<c>/features/<f>/` only when a `touches:` entry's literal prefix reaches `features/` (`bay/boundary.py:409`), so listing `components/forge/` does not cover `components/forge/features/extend/playbook.md`, and a rename in a feature folder forces an amendment. The two rules contradict each other. The 0013 and 0014 reviews both met this.

*Change.* `ok = any(match(g, path) and literal_prefix(g).startswith(folder + "features/") for g in globs)` becomes `ok = listed`, and the feature branch's docstring line "a whole-component entry does not cover features" goes. The code gets shorter. R-11 and R-12 in `components/forge/features/extend/rules.yaml` are reworded: R-11, "List a mode folder (path/) where files in it, features included, may be renamed"; R-12, "Amend the proposal only for a change of scope or design; the call returns to the gate and `bay approve` passes it again" (item 3).

*Test that fails on `main`.* `tests/test_boundary.py:138-144` (`test_feature_folder_in_existing_mode_needs_its_own_listing`) asserts that a whole-mode entry does not cover a feature file. It is rewritten to assert that it does, and fails on `main` at that assertion.

**5. An owner without a terminal.**

*Today.* Three steps are terminal-only. I checked each against the code.

- `bay approve <F-id>` (a backlog item) refuses chat and a non-terminal (`bay/cli.py:386-400`), and the store accepts only `by == "user@tty"` (`store.py:184`, and again at `store.py:263` when implement claims the item).
- `bay auth` demands a TTY (`bay/cli.py:450-460`). It opens the owner's browser for a sign-in and stores the token in the keychain; no value passes through stdout.
- `bay secret set` demands a TTY and reads a hidden prompt (`bay/cli.py:431`).

*Change.* A backlog decision follows `approve.from`. `_decide_finding` calls `_approval_channel` as a gate does, so its own tty and chat refusals disappear and the function gets shorter; the ledger records `user@chat-via-cos` with the quote, and the store accepts that label as well as `user@tty` in the two places above. `bay auth` drops its terminal check and relies on the permission prompt Claude Code shows before any command that is not pre-approved. `bay auth` is not pre-approved today, so that prompt exists; to stop an owner's wide allow rule from silencing it, `auth` joins `approve` in the verbs that always ask (`_want_ask`, `adapters/claude-code/claude_code.py:137`, a word in an existing tuple). The owner then confirms twice, in the app and in the browser, and no secret is exposed. The residual risk is that an injected coordinator opens a login page; the owner still confirms there. DESIGN states that `bay auth` needs the browser on the machine running bay. `bay secret set` stays terminal-only and a no-terminal path for secrets is out of scope.

*Test that fails on `main`.* In `tests/test_protection.py:532`, with `approve: { from: [chat] }`, `bay approve F-... --via chat --quote ...` is expected to record the decision as `user@chat-via-cos`; on `main` it is refused ("a backlog item is decided at a terminal"). `tests/test_auth.py:18` (`test_auth_refuses_without_a_terminal_and_names_the_connector`) asserts the opposite of the change and is removed; `test_chat_setting_does_not_open_secrets_or_logins` (`tests/test_boundaries.py:720`) is rewritten to assert only that `secret set` stays terminal-only.

**6. Small fixes.**

(a) *Staleness counts from the last event.* `_stale` ages a running agent from `r.started` (`bay/cli.py:529`), so an agent that ticked its plan five minutes ago is "stale" after a day of running. `ledger.fold` records `Run.last`, the time of the last event naming the run's runId or taskId (a tick, a note, a plan), and `_stale` uses it. Test: in the existing status test, a run that started two days ago and ticked five minutes ago is not listed under `STALE?`; on `main` it is.

(b) *`show close` records its reason.* `Dispatcher.close` sets `result = {"reason": reason}` (`bay/dispatch.py:74-80`) but `_finish` builds the event summary from `stopped`, `result.error` or the status (`bay/dispatch.py:715`), so the ledger says "abandoned". `_finish` also reads `result.reason`: one more `or` in the same line. Test: the existing close test (`tests/test_submit_needs_plan.py:125`) reads the `call.completed` event and asserts the reason is in its summary; on `main` it is "abandoned".

(c) *`replaces` is documented as honoured where the input type declares it.* The dispatcher reads the key for any call (`bay/dispatch.py:66-69`), but only forge.extend's `ExtendReq` declares it and every other input type refuses extra fields. One sentence in INTERFACES section 7; no code and no test. Generalising it was rejected: it could close calls the owner did not mean.

(d) *`bay status` says plainly when the guard has not run recently.* The guard hook is wired in `.claude/settings.json`, which Claude Code reads only for a session started inside the project; elsewhere it never runs and nothing says so (the one warning is printed once by `bay build`). Smallest mechanism: `main()` in `bay/guard.py` touches `.agentbay/ledger/guard.seen` on every hook call (the folder is ignored by git), and `bay status` prints "guard: no tool call was checked in the last 2 minutes. In a Claude Code session this means its hooks are not loaded: start it inside the project" when the file is older. The guard hook fires before the very Bash command that runs `bay status`, so in a guarded session the file is always fresh. From a plain terminal the line also appears, and says so. Rejected: inferring it from the spawn hook's events, which is a proxy and is absent at the first dispatch. Test: a status test with no heartbeat asserts the line; after one guard decision (the existing guard test helper calls the hook) it asserts it is gone. On `main` neither exists.

**7. Docs.**

- `docs/DESIGN.md` states the threat model once, at the head of the safety model, replacing "Hooks are defense in depth". It protects the rules that bind agents (guard, dispatcher, gates, secrets, ledger, boundary check), the owner's authority (the framework changes only through forge.extend with approval and review), and secrets. It defends against agent mistakes and overreach, prompt injection through data agents read, and extensions that overreach. It does not defend against the owner. It is guardrails, not a hard boundary, and one bypass is known: code a builder runs, such as a test, runs outside the guard, so the controls around it are the approval gate, plan approval, the whole-diff opus review, the boundary check, and the `deadcode` and `limits` steps. DESIGN also says that `bay auth` needs the browser on the machine running bay.
- `components/cos/playbook.md`: "The brief states the goal, the inputs and the limits, and nothing about how to do the work; the agent writes its own plan." Today the playbook says the prompt "includes the plan's task, playbook, rules, definition of done and inputs" (lines 24-31), which coordinators read as permission to write the steps. It cannot fail a test; the reviewer judges it from the recorded dispatch inputs.
- The extend playbook's release step: the Result carries the exact commands and text for the owner to run after the merge: `git tag -a v<version> <merge commit> -m ...`, `git push origin v<version>`, `gh release create v<version> --title v<version> --notes-file <file>`, and the release text copied from the CHANGELOG entry. `git tag` is empty today and tag pushes return 403 from the builder's environment. A Definition of Done line makes the review judge it. No CI workflow (it needs write access to `.github/workflows/`, which no agent has).

## What the rejected design had that this one drops, and the controls that remain

| Rejected design | In this one | Control that remains | What is weaker |
|---|---|---|---|
| `agent.plan.approved` event, plan digest, `bay approve <taskId>` | The plan is a file; its approval is the existing gate record (path, sha256) | `bay approve <callId>`, terminal or chat with `--sha`, shown with the exact file | The approved thing is the file, not the agent's `bay plan` checklist; the planner's task says the file holds the outcome and items |
| Guard blocked every write and command of an agent until its plan was approved | The dispatcher issues no step plan for the work and refuses its submit until the gate passes | The gate; the review step; the boundary check against `touches:`; the planner's env cannot write outside `docs/plans/` | A coordinator could do the work by hand outside the call; before, the guard stopped even that. Nothing a hand-done change produces enters a call |
| Amendment approval branch, hash comparison on submit, refusal of drift | One check at `_advance` returns the call to the same gate | `bay approve <callId>`; no result is accepted and no check runs on unseen content | A builder keeps working under the old approval until its next submit |
| `bay plan --revise` and plan revisions | Dropped | A changed plan file reopens the gate; `bay plan` stays one checklist per task | The checklist cannot be revised mid-task; the file can |
| `file` key on `bay plan` (a plan file named in the checklist) | Dropped; the file is the gate's subject | The artifacts of the plan step | none |
| `scope` step checking `touches:` against the plan's `Files:` lines before the gate | Dropped | `bay check --base` (B-1 to B-3) and the review's DOD-7 after implement; B-3 now covers feature folders (item 4) | A plan that goes beyond `touches:` is caught after the build, not before the gate |
| Guard note on every step plan | Reduced to one line in `bay status` (item 6d) | The heartbeat file | The coordinator's step plans carry no warning |
| `approvals.plan` `always` and `never` | Dropped; the plan step is `large` | List `forge.extend.implement` in `approve.plans` for a plan on every proposal | One more gate in that case |

Nothing important was lost on secrets, the owner-only `bay approve`, the review or the limits: none of them is touched.

## Cost against the ceilings

All seven measures in `framework/limits.yaml` are covered. The line numbers are estimates in the units `limits.count` uses (every line of `bay/*.py`, comments and blanks included).

- **`bay_lines` (ceiling 9595, count 9595): over, so the exception above.** Gross: `bay/model.py` +16 (the expansion 13, the planner's tier 3); `dispatch.py` +16 (reopen 10, resume and `why` at approve 5, subject tweak 1); `lint.py` +10; `config.py` +4; `ledger.py` +4; `guard.py` +4; `util.py` +1; `cli.py` -6 net (status guard line +4 and `_stale` +1, `_decide_finding` -9 because it reuses `_approval_channel`, `cmd_auth` -2); `boundary.py` -1. The net is about +48. Payers I can name from the code: `chat_approvals` and its docstring (replaced by one smaller helper, already in `config.py`'s +4), the two `_decide_finding` refusal branches and the `cmd_auth` check (counted in `cli.py`), and the B-3 clause. I cannot count more without writing the code, so the exception is an upper bound. If it must shrink, the heartbeat (item 6d, about 8 lines across guard and cli) is the first to go.
- **`kit_python_lines` (6580, count 6580): not over.** `scaffold.py` loses about 6 (no `approvals.plan` lookup, no `want` argument); `store.py` gains 2. Net about -4.
- **`tests` (539): unchanged.** One test is added (item 2) and one is removed (`test_auth_refuses_without_a_terminal_and_names_the_connector`, which asserts the behaviour item 5 removes). Everything else extends or rewrites a named existing test.
- **`cli_commands` (16), `schemas` (16), `framework_folders` (2), `top_level_folders` (7): unchanged.** No `sub.add_parser` call, no schema file, no folder is added; `plan-writer.yaml` goes into the existing `components/tools/envs/`.
- **`docs/DESIGN.md` (2999 words by `len(text.split())`) and `docs/INTERFACES.md` (2987): at their budget; additions are paid in the same file.** Counts are mine from today's text; the plan step measures the result.
  - DESIGN: +79 for the threat model (replacing the 31-word "Hooks are defense in depth" paragraph with about 110), +60 for plan approval and the reopened gate. Paid by: the "Chat approval is opt-in" bullet (96 words) and "Your terminal only" (16) rewritten into one `approve.from` bullet of about 85 (-27); the Plan bullet of forge.extend (86), which describes the three `approvals.plan` values, cut to about 40 (-46); the Gate bullet's chat-sha sentence (-18); the Run log's two sentences on the hook, replaced by the guard sentence (-7); and a trim of the Size and "What only `forge.extend` may write" paragraphs (about -40 in all, they repeat `limits.yaml` and `kernel.yaml`). Net about +1; the threat model's last sentence goes first if the count is higher.
  - INTERFACES: +45 for `approve.plans` and the reopened gate in section 7, +10 for `replaces`. Paid by: the section 7 pointer sentence that lists the terminal and chat paths (-15), the `abandoned` sentence merged with `replaces` (-12), and the section 9 `STALE?` and spawn-hook sentence shortened (-5), about -32 against +55. The net is about +13 only if every cut lands, which is exactly the headroom (13 words); the plan step must confirm it or trim the new sentences.

So one exception (`bay_lines`), no change to `framework/limits.yaml` except by the release step.

## Compatibility and safety impact

- **`approvals` becomes `approve`.** A project whose `agentbay.config.yaml` has `approvals:` fails `bay check` with a message naming `approve` and showing the new shape. No alias and no translation. The only such file here is the owner's own, which the owner edits by hand because the guard keeps agents out of it. The config schema goes from `agentbay/v3` to `agentbay/v4`, and the config fixtures in three component test folders and `tests/helpers.py` move with it. The ledger event schema is unchanged (no new type): the reopened gate records the same `step.planned` and `step.completed` events as any gate.
- **Behaviour that changes.** A project listing nothing in `approve.plans` behaves as before, except that forge.extend's plan step is always `large`, a submit after an unseen change to an approved file now ends at the gate, and B-3 accepts more paths. A backlog decision and a gate follow the same `from`. Hosts that run `bay` outside a Claude Code session see the guard line.
- **Safety.** No secret is read, written or shown by any change here, and `bay secret set` is untouched. The planner has no more reach than a role with `fs.write: [docs/plans]` and no command but `bay plan`: less than the plan step has today. The new owner-facing channel (a backlog item from chat) is the one gates already use, labelled `user@chat-via-cos`, and exists only if `from` lists chat. The guard remains guardrails, not a hard boundary, which the threat model now says.
- **Version.** 2.0.0, with an Upgrading section in the CHANGELOG.
- **Out of scope.** Test effectiveness (proposal 0016), a no-terminal path for `bay secret set`, an OS sandbox, push notifications.

## Open choices for the owner

Positions marked recommended; confirm or change at the gate.

1. `approve.planner` as a config key (recommended), or a constant deep/high changed only through forge.extend.
2. The `<mode.endpoint>` form covers every role step of the endpoint that has no `when:` (recommended; the step form picks one), or only endpoints with a single role step.
3. `auth` always asks (a word added to `_want_ask`) (recommended), or relies on Claude Code's default prompt alone.
4. The `bay_lines` exception at 9650, with the heartbeat first to drop (recommended).
