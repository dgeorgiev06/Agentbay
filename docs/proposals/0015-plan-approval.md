---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Scope decided by the owner on 2026-11-01 and 2026-11-02: thirteen items, listed below. Item 6 is left out and goes to its own proposal 0016 (see "Left out"). The owner decided the open choices on 2026-11-02; they are recorded below as decisions.
id: "0015"
status: draft
touches:
  - { path: bay/config.py, reason: "the `approve` setting (from, plans) replaces `chat_approvals`" }
  - { path: bay/cli.py, reason: "`bay approve` takes a plan id (T-...) and, mid-call, an amended proposal; a backlog id follows `approve.from`; `bay plan --revise`; `status` says when the guard is not active and ages a run from its last event; `bay auth` loses its terminal check and relies on the app's permission prompt" }
  - { path: bay/dispatch.py, reason: "amendment approval and the refusal of unapproved drift, the plan-approval mark on a step plan, a gate's text after approval, the close reason in the ledger, the guard note on a step plan" }
  - { path: bay/ledger.py, reason: "plan revisions, the plan file and its hash, plan approvals and the question the guard asks, a run's last event" }
  - { path: bay/guard.py, reason: "a subagent whose plan awaits approval may read and run `bay plan` only (plus write its own plan file); the guard leaves a heartbeat; `bay plan --revise` is an allowed shape" }
  - { path: bay/boundary.py, reason: "B-3 simplified: a listed folder covers the feature folders inside it" }
  - { path: bay/lint.py, reason: "every `approve.plans` entry must name a real endpoint or step" }
  - { path: schemas/config.schema.json, reason: "`approve: { from, plans }` replaces `approvals: { chat, plan }`; apiVersion agentbay/v4" }
  - { path: schemas/event.schema.json, reason: "the event type `agent.plan.approved`" }
  - { path: adapters/claude-code/claude_code.py, reason: "the generated coordinator text names plan approval, the new `approve.from` setting and the guard note" }
  - { path: components/forge/mode.yaml, reason: "a `scope` code step before the gate; one line in the propose step's task; the comment on the plan step" }
  - { path: components/forge/connectors/scaffold/scaffold.py, reason: "the `scope` endpoint; the plan step is always `large`, so the `approvals.plan` lookup goes" }
  - { path: components/forge/interfaces/forge.scaffold.v1.yaml, reason: "the `scope` endpoint and the shorter description of `proposal`" }
  - { path: components/forge/features/extend/playbook.md, reason: "the scope step, amendments, the publish step after the merge, touches wording" }
  - { path: components/forge/features/extend/rules.yaml, reason: "R-11 and R-12 reworded so that they no longer contradict each other" }
  - { path: components/forge/playbook.md, reason: "the coordinator relays plan approvals and amendments, and publishes the release after the merge" }
  - { path: components/forge/tests/, reason: "the scope endpoint" }
  - { path: components/cos/playbook.md, reason: "briefs are scope only; the plan-approval round trip; chat gates follow `approve.from`" }
  - { path: components/cos/interfaces/workflow.run.v1.yaml, reason: "the chat sentence names `approve.from` instead of `approvals.chat`" }
  - { path: framework/roles/builder.yaml, reason: "the builder writes its full plan to a file, and stops and reports when a write is denied for lack of plan approval" }
  - { path: agentbay.config.yaml, reason: "the owner's file, edited by the owner by hand: `approvals: { chat: true }` becomes `approve: { from: [terminal, chat] }`" }
  - { path: README.md, reason: "the commands table and the approval sentence" }
  - { path: docs/DESIGN.md, reason: "the threat model, plan approval, the new `approve` setting, the guard note, the bypass statement; paid for by cuts (see Cost)" }
  - { path: docs/INTERFACES.md, reason: "`bay approve`, `bay plan --revise`, the plan file, the new event, the step-plan guard field; paid for by cuts (see Cost)" }
  - { path: tests/, reason: "existing tests extended or rewritten; no test is added without one removed" }
  - { path: bay/__init__.py, reason: "release step: version" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading section" }
  - { path: framework/limits.yaml, reason: "release step: the ceilings are written down to the real counts" }
exceptions:
  - { measure: bay_lines, to: 9745, reason: "about 180 lines are added in cli.py, dispatch.py, ledger.py, guard.py, config.py and lint.py (the Cost section gives each item's share) and about 36 are paid by same-behaviour cuts in those files (item 11 alone saves about 11 in cli.py); the net is about +144 plus a 6-line margin. This is an upper bound: the plan step names the payers, and the release lowers the ceiling to the real count" }
  - { measure: kit_python_lines, to: 6600, reason: "the `scope` endpoint adds about 24 lines to the forge scaffold connector and the always-`large` plan rule removes about 6; the adapter text is reflowed with no net lines; the release lowers the ceiling to the real count" }
---

# 0015: Plan approval and process gaps

## Problem

The 0013 and 0014 work showed that the framework can approve a proposal but not what an agent will do with it. The owner reads the proposal, then a builder records a plan that nobody approves, and the builder is free to write at once. Around that gap sit twelve smaller ones, found in the 0013 review and in the owner's discussions on 1 and 2 November: the approval settings are two unrelated keys, an amendment during implement cannot be approved, the touches rule contradicts the amend rule, releases leave no tag, briefs tell agents how to work, a plan cannot be revised or held in full, the threat model is written nowhere, the guard can be off without anyone being told, and an owner who has only the app cannot do four of the steps that are reserved to a terminal.

This proposal covers thirteen items, in the order the owner listed them. Each item gives the problem with its evidence, the change, and the test that will fail on `main`. Where the owner already decided the shape I follow it. The choices the owner made on 2026-11-02 are written as decisions, with one line for what was rejected and why. The few choices still open carry my position, marked "(recommended; the owner confirms at the gate)", and are collected at the end. Item 6 (test effectiveness) is left out and becomes proposal 0016; the reason is in "Left out". A path for secrets without a terminal is also left for a later proposal.

Nothing here changes how a proposal is approved today, and nothing is implemented before the gate. The proposal touches 29 files, has exceptions and touches sensitive paths (`bay/guard.py`, `bay/dispatch.py`, `bay/cli.py`, `bay/ledger.py`, `bay/boundary.py`, `adapters/`, `schemas/config.schema.json`, `schemas/event.schema.json`), so the plan step will run on its own and will bind a plan to the gate.

## The changes

**1. One `approve` setting, and plan approval that the guard enforces.**

The problem today. Two keys control approvals: `approvals.chat` (a boolean, `schemas/config.schema.json:40-60`, read by `chat_approvals` in `bay/config.py:67`) and `approvals.plan` (`large`, `always` or `never`, read in `components/forge/connectors/scaffold/scaffold.py:50`). The second one only decides whether forge's own plan step runs. Nothing lets the owner say that an agent's plan must be approved before the agent works. A builder records its plan with `bay plan` (`bay/ledger.py:86`), and the plan is only a record: the dispatcher requires that one exists before it accepts the result (`Dispatcher._require_plan`, `bay/dispatch.py:131`), which is after the work is done. The guard decides each tool call by role, path and command (`bay/guard.py:303`) and never looks at the plan.

The change, in the shape the owner decided.

```yaml
approve:
  from: [terminal, chat]          # where the owner can pass a gate; default [terminal]
  plans: [forge.extend.implement] # <mode.endpoint> or <mode.endpoint.step>; default []
```

`approve` replaces `approvals` whole. The key `approvals` is refused with a message that names `approve`; no alias is kept. `from` replaces `approvals.chat` (chat is on exactly when `from` lists it). `plans` lists the agent steps whose recorded plan the owner must approve before the agent may write. Forge's plan step for a large proposal stays automatic, as before, and loses its three-value switch: it is always `large`, so `approvals.plan` goes and `plan_reason` in `scaffold.py` drops its `want` argument.

How the approval works.

- The dispatcher marks the step plan of a listed step with `approvePlan: true` (in `_plan`, `bay/dispatch.py:603`), and writes the mark into the `step.planned` event's data.
- The builder runs `bay plan` as now. Its plan can name a plan file (item 12). Until the owner approves it, the guard lets that agent read (`Read`, `Glob`, `Grep`), run `bay plan` and write its own plan file, and denies every other write tool and every other Bash command. Bash is denied because a command such as `python3 tests/run.py` runs code that can write anything (item 9), so "no writes" cannot mean "no write tools" only. The denial text says the plan awaits the owner and names `bay approve <taskId>`.
- The owner approves with `bay approve T-...` (a terminal, or chat when `from` lists it). The command prints the plan's outcome, its items and the plan file's hash, asks for the usual confirmation and records `agent.plan.approved` in the ledger with a digest of exactly what was shown. A chat approval carries `--sha` of that digest and the owner's quoted words, as gates do now.
- The guard allows the agent to write again when the newest plan revision of every run dispatched to that call and step has an approval with the same digest. An edit of the plan file, or a revision (item 7), changes the digest, and the writes stop until the owner approves again. This is the owner's "an edit of the plan reopens it".
- The agent cannot wait for the owner, because a subagent runs to its end. So the builder's prompt (`framework/roles/builder.yaml`) says that when a write is denied for lack of plan approval it stops and returns status `partial` with the taskId and the words "awaiting plan approval". The coordinator shows the plan to the owner, and once the owner approves it resumes the same agent. The coordinator's playbook (`components/cos/playbook.md`) says so in one sentence.
- Lint checks every `plans` entry against the kit and names the gap (an unknown mode, endpoint or step).

What stays as it is. The setting default is empty, so nothing changes for a project that does not list a step. The guard still applies only inside a session started in the project, which is why item 10 comes with this item.

How a test will show it. A guard test builds a project with `approve: { plans: [forge.extend.implement] }`, plans the step, dispatches a builder, records its plan, and asserts four things: `Write`, `Edit` and `Bash` are denied with the message naming `bay approve`; `Read` and `bay plan` pass; after the approval the same `Write` passes; and after an edit of the plan file it is denied again. On `main` the first assertion fails because nothing is denied. A config test asserts that `approvals: { chat: true }` is refused with the new key's name, and that `from: [chat]` lets `bay approve --via chat` through while `from: [terminal]` refuses it.

**2. Amendments during implement get an approval path.**

The problem today. After the gate, the proposal is a living file. The playbook and rule R-12 tell the builder to amend it for a change of scope or design. But `bay approve` refuses the call once the gate has passed (`bay/dispatch.py:156` and `bay/cli.py:327`: "is needs-agent, not awaiting approval"), so there is nothing the owner can do with an amendment, and nothing stops the builder carrying on, because the dispatcher compares the file with its approved hash only while the gate is open. The approval the owner gave covers a file that no longer exists.

The change. While a call is open and past its gate, `bay approve <callId>` compares the file the gate bound (the proposal, and the plan if there is one) with the hash recorded at the gate. If they differ, the command prints the old and new hashes and the current `touches:` and `exceptions:`, and asks the owner to read the file. On confirmation the dispatcher records a `step.completed` event with the new `approves` and `amendment: true`, replaces the gate's recorded subject in the call state, and goes on. If the files match, the command still says "not awaiting approval". `--reject` mid-call is refused with a pointer to `bay show close`, because rejecting an amendment is the same as ending the call (recommended; the owner confirms at the gate).

The refusal. `Dispatcher.submit` compares the bound files with the approved hash before it records anything, and refuses the submit with "the proposal changed after approval: the owner runs `bay approve <callId>`". The same check runs before each code step in `_advance`, so `deadcode`, `limits` and `review` cannot run on an unapproved amendment. A re-check after review then sees a changed approved subject and runs as a full review, which is what R-1 and DESIGN already say.

How a test will show it. The existing gate test in `tests/test_dispatch.py` goes on past the gate: it edits the proposal, asserts that `submit` is refused naming the amendment, runs `bay approve` for the call and asserts the ledger holds an approval with `amendment: true`, and then asserts the submit is accepted. On `main` the second `bay approve` fails with "not awaiting approval", and the submit is accepted without any approval, so the test fails at its first new assertion.

**3. Touches: one clear rule, checked early.**

The problem today. Rule R-11 says to list a folder where files may be renamed. Rule R-12 says to amend only for a change of scope or design. But B-3 (`bay/boundary.py:409`) accepts a path under `features/<f>/` only when a `touches:` entry's literal prefix reaches `<component>/features/`, so listing `components/forge/` does not cover `components/forge/features/extend/playbook.md`. A rename inside a feature folder therefore forces an amendment, and the two rules contradict each other. The 0013 and 0014 reviews both met this.

The change has three parts, as the owner decided.

(a) B-3 simplified: a listed mode folder covers the feature folders inside it. The `literal_prefix(g).startswith(folder + "features/")` condition in `_classify` is deleted, the feature branch becomes `ok = listed`, and the docstring line "a whole-component entry does not cover features" goes. The component-wide files of an existing component (`mode.yaml`, `playbook.md`) were already covered by a folder entry. The code gets shorter.

(b) A code step checks `touches:` against the plan's per-part file lists before the gate. The forge plan step's task says each part of `docs/plans/<id>.md` has a line that begins `Files:` followed by comma-separated paths. A new step `scope` (after `plan`, before `approve`) runs a new endpoint `forge.scaffold/v1.scope`. It reads the proposal's `touches:` and the plan's `Files:` lines and returns `stopped: "<paths> are in the plan but not in touches:"` for any file no `touches:` glob matches, which blocks the call before the owner is asked. When no plan file exists it returns ok. The matching reuses `boundary.match`, so the check agrees with `bay check --base` later. The owner then approves a proposal and plan that already agree.

(c) One line in the propose step's task in `components/forge/mode.yaml`: "List every file you will edit in touches:, using a folder (path/) where files in it may be renamed." The extend playbook and the two rules say the same in their own words; R-12 gains "and only through `bay approve`" (item 2).

How a test will show it. `tests/test_boundary.py` (lines 138-144) today asserts that a folder entry does not cover a feature file; it is rewritten to assert that it does, and fails on `main` at that assertion. A forge test calls `scope` with a plan whose `Files:` line names a path outside `touches:` and asserts `stopped`; on `main` the endpoint does not exist.

**4. Releases: tag and GitHub Release after the merge.**

The problem today. The release step ends at "changelog entry, version bump, all checks green" (`components/forge/features/extend/playbook.md`, step 9). No tag exists (`git tag` is empty) and no GitHub Release does either (the releases and tags API both return an empty list). The owner's decision of 2 November is that, after the owner merges, the release commit on main is tagged and a GitHub Release is created with the CHANGELOG entry as its notes. Tag pushes and the releases API return 403 from the builder's environment, so the step cannot do this itself. I did not try a write; the reads work and return empty lists.

Decision (owner, 2026-11-02): the owner publishes the release. The release step's Result carries the exact commands and the release text, filled in: `git tag -a v<version> <merge commit> -m ...`, `git push origin v<version>`, `gh release create v<version> --title v<version> --notes-file <file>`, and the release text itself, copied out of the CHANGELOG entry so that the owner can paste it into the web form if they prefer the web to the commands. A new last paragraph in the extend playbook ("Publish") says so. Nothing in the framework's code changes. Rejected: a CI workflow that creates the release on every push to main, because it adds a top-level folder and a workflow with write permission, and no agent can write `.github/workflows/`.

How a test will show it. There is no code to test; it is a playbook change. The extend playbook gains a Definition of Done item, "the release Result carries the publish commands and the release text", and the review step judges it on the next release.

**5. Briefs are scope only; the agent writes its plan.**

The problem today. `components/cos/playbook.md` (line 24-31) says the dispatch prompt "includes the plan's task, playbook, rules, definition of done and inputs". Coordinators have read that as permission to write the steps too, so a brief arrives with its own build order, and the agent's `bay plan` then repeats the coordinator's thinking instead of its own. The builder's prompt says the agent plans first (`framework/roles/builder.yaml:12-17`), but nothing says the coordinator must leave that to it.

The change. One sentence in the cos playbook at the dispatch step: "The brief states the goal, the inputs and the limits, and nothing about how to do the work; the agent writes its own plan with `bay plan`." The builder and reviewer role prompts already tell the agent to plan before it works, so no role file needs the sentence. The plan-approval path in item 1 is what makes the sentence matter: the owner approves the agent's plan, so it has to be the agent's.

How a test will show it. It is a playbook sentence and cannot fail a test. The reviewer reads the dispatch inputs in `bay show` (they are recorded) and judges the sentence by them. I state this plainly so that it is not mistaken for something enforced.

**6. Test effectiveness: left out.** See "Left out".

**7. Plan revisions.**

The problem today. `bay plan` refuses a second plan for a task (`bay/ledger.py:92-93`: "already has a plan; tick items with --done"), and `plans()` keeps the first plan it sees (`bay/ledger.py:160-162`). An agent that learns something while working cannot change its plan, so the record on file drifts from the work, and the reviewer judges the work against a plan nobody followed. With plan approval (item 1) the problem gets worse: the plan that is approved must be the plan on record.

The change. `bay plan <taskId> --revise '<json>'` records a revision. The JSON is the same shape as a plan with one more required string, `why`, of at most 240 characters. The event is `agent.plan` with `data.revision` (2, 3, ...) and `data.supersedes`, so the old plan stays in the ledger and is no longer the plan on record. `plans()` takes the newest revision, resets the items' done marks (the new items are new), and keeps the count in `revision`. `--done` ticks the newest revision. `bay show` and `bay status --agents` print the revision number. The guard's `_plan_command` (`bay/guard.py:473`) allows the one extra shape `bay plan <taskId> --revise '<json>'`. A revision after approval changes the digest, so item 1 reopens the approval; a revision before approval simply supersedes. A plain `bay plan` for a task that has a plan is still refused, now with the pointer to `--revise`.

How a test will show it. In `tests/test_ledger.py`, the existing plan test records a plan, asserts that a second plan is refused with the pointer, records a revision, and asserts that `plans()` returns the revision with fresh done marks and that an approval recorded for revision 1 no longer allows writes. On `main` the `--revise` flag is rejected by the argument parser, so the test fails at once.

**8. The threat model, stated once in DESIGN.md.**

The problem today. The safety model (`docs/DESIGN.md`, "Safety model") lists mechanisms and says in one phrase that hooks are "defense in depth, not isolation", but it nowhere says what is protected, from whom, and from whom not. A reader cannot tell whether a gap is a bug or an accepted limit.

The change. A short paragraph at the head of the safety model, in the owner's words of 1 November. Protected: the rules that bind agents (the guard, the dispatcher, the gates, secrets, the ledger and the boundary check); the owner's authority, meaning the framework changes only through `forge.extend` with approval and review; and secrets and the outside accounts they open. The threats are agent mistakes or overreach, prompt injection through the data agents read, and extensions that overreach. The framework does not defend against the owner. It is a set of guardrails and not a hard security boundary: a process that runs code on the owner's machine, as a test run does (item 9), can do what the owner's user can do. The paragraph replaces the current "Hooks are defense in depth" paragraph, which says the same thing in fewer words and names no threat.

How a test will show it. Documentation only; there is no test. `bay check --docs` (B-11) keeps the core docs free of component names.

**9. The test-running bypass: stated as a known limit.**

The problem today. The builder's environment lets it write `tests/` and `bay/` and run `python3 tests/run.py` (`components/forge/envs/framework-dev.yaml:17-19`, whose comment already says tests are "arbitrary code: trusted by design"). A test can therefore execute any code with the owner's rights, including edits to `bay/` and `.agentbay/`, and the guard cannot see inside it. The guard stops the builder's own tool calls and not what a program it runs does. This is true of every command the builder may run, and the test runner is the one it runs most.

Decision (owner, 2026-11-02): state it. The threat model of item 8 names the limit: code that a builder runs is outside the guard's reach, and the controls that stand around it are the approval gate, the plan approval of item 1, the opus review of the whole diff, the boundary check, and the `deadcode` and `limits` steps. This costs words only. Rejected: forbidding a builder to run tests it wrote, because it closes only part of the hole (old tests import edited code from `bay/`) and costs guard lines at the ceiling; and running tests with the kit read-only, which needs an OS sandbox and is a later proposal.

How a test will show it. It is documentation; there is no test.

**10. The guard says when it is not active.**

The problem today. The guard hook is wired in `.claude/settings.json`, which Claude Code reads only for a session started inside the project. A session started elsewhere runs with no guard at all, and nothing says so. The only warning is printed once, by `bay build` (`adapters/claude-code/claude_code.py:258`). `bay status` has a similar line only for the spawn hook, and it needs a dispatch with no hook event to appear (`bay/cli.py:533`). So the coordinator and the owner can both believe enforcement is on when it is off, and with item 1 the plan approval would be silently unenforced.

The change. Every guard decision, including a main-thread one, touches a small file, `.agentbay/ledger/guard.seen` (the folder is already ignored by git). `bay status` and the step plan in every `bay call`, `bay submit` and `bay show` check its age. If it was written in the last two minutes the guard is certainly running, because the guard hook fires before the very Bash command that runs `bay`. Otherwise `bay status` prints "guard: not active in this session (last seen <ago>, or never). It loads only in a Claude Code session started inside the project; enforcement is off", and a step plan that tells the coordinator to dispatch an agent carries `guard: "not active"` with the same sentence. From a plain terminal the line also appears; that is correct and says so.

This is the position (recommended; the owner confirms at the gate). The rejected alternative is to infer the guard from the spawn hook's events. It is only a proxy, it is absent at the first dispatch of a session, and a cheap file the guard writes is the direct evidence.

How a test will show it. A status test with no `guard.seen` asserts the "not active" line and `guard` on the step plan; after one main-thread guard decision (the existing guard test helper calls the hook) it asserts neither. On `main` neither exists.

**11. An owner without a terminal.**

The problem today. Four steps are marked as terminal-only: `bay build`, `bay approve <F-id>`, `bay secret set` and `bay auth`. An owner who uses the app has no terminal. I checked each against the code, and the owner decided each on 2026-11-02.

- `bay build` has no terminal check at all (`bay/cli.py:141`). It is "terminal only" only in the sense that Claude Code asks before the coordinator runs it, and the owner approved that prompt on 1 November. Decision: no code change. The docs say that the prompt is the approval, because they now say "your terminal".
- `bay approve <F-id>` (an improve backlog item) refuses chat and a non-terminal (`bay/cli.py:386-400`). Decision: it follows `approve.from`, the same as a gate, with the owner's quote recorded as `user@chat-via-cos`. It reuses `_approval_channel`, so `_decide_finding` gets shorter. Rejected: leaving it terminal-only, because the owner cannot then decide backlog items from the app.
- `bay auth <connector>` (`bay/cli.py:450`) opens the owner's browser for a sign-in and stores the token directly in the keychain; no value passes through stdout. Decision: its terminal check is dropped and the coordinator runs it after Claude Code's permission prompt, so the owner confirms twice, in the app prompt and in the browser, and no secret is exposed. The one added risk is that an injected coordinator could open a login page; the owner still has to confirm there. Rejected: keeping the terminal check, because the app is the owner's only interface.
- `bay secret set` (`bay/cli.py:431`) stays terminal-only in this proposal. It reads the value from a hidden terminal prompt and refuses a pipe, so that an agent cannot overwrite a secret and no value passes through the conversation. The owner did not choose a no-terminal path for secrets, so that path (Keychain Access, or a local form) is a later proposal. Nothing about secrets changes here.

How a test will show it. For the backlog id: with `approve: { from: [chat] }` the existing decision test passes `--via chat --quote ...` and expects the decision recorded as `user@chat-via-cos`; on `main` it is refused ("a backlog item is decided at a terminal"). For `auth`, the existing refusal test is changed to expect the login to start without a terminal; on `main` it is refused.

**12. A home for the full plan.**

The problem today. A plan item is capped at 240 characters (`bay/ledger.py:29`, `MAX_ITEM_TEXT`), with twelve items and a 1000-character outcome. That is enough for a to-do list and not enough to build from, and the plan step for proposals shows the way: `docs/plans/<id>.md` holds the full plan and the gate binds it. A builder's plan has no such home, so the real plan lives in the builder's head and the reviewer cannot see it.

The change. A plan may name a plan file: `bay plan <taskId> '{"outcome": ..., "todo": [...], "file": "docs/plans/<taskId>.md"}'`. The file must already exist under `docs/plans/` and be named for the taskId. The ledger records the file's path and its sha256 in the plan event, as the dispatcher does for the proposal at a gate, and the plan approval of item 1 shows and binds that hash (the approval digest covers the outcome, the items and the file hash). The guard lets the agent write exactly that file even before approval, because the plan has to be written before it can be approved, and an edit of the file after approval changes the hash and reopens the approval, as for the proposal plan. A revision (item 7) may name a new file. The file is a history document: `docs/plans/` is already in `HISTORY_DOCS`, so it does not count in the doc budget. The coordinator's brief and the reviewer's brief (`recordedPlans`) carry the path, not the text.

The 240-character cap stays: the items are the checklist, the file is the plan. One file per dispatched part follows, because each part is a dispatch with its own taskId.

How a test will show it. A ledger test records a plan with a `file`, asserts that the hash is in the event, and asserts that a `file` outside `docs/plans/` or with a name that is not the taskId is refused. A guard test asserts that the agent can write that file before approval and no other, and that an edit after approval denies the next write. On `main` the `file` key is rejected by the plan's shape check.

**13. Leftovers from the 0013 review.**

Four small items. Three have a test that fails on `main`. One is a decision.

(a) `replaces` is honoured only by `forge.extend`. The dispatcher reads the key for any call (`bay/dispatch.py:66-69`), but only `ExtendReq` declares it, and every other input type refuses an extra field. So the dispatcher code looks general and is not. Position (recommended; the owner confirms at the gate): say so in the contract. An endpoint honours `replaces` when its input type declares it, and today only `forge.extend` does. It is one sentence in `INTERFACES.md` and no code, and no test applies. Rejected: generalising it to every endpoint, which could close calls the owner did not mean, because the other endpoints (digests, workflow runs) are not restart-after-a-gate cases.

(b) `show close` records its reason in the ledger. `Dispatcher.close` sets `result = {"reason": reason}` (`bay/dispatch.py:74-80`), but `_finish` writes the event's summary from `stopped`, `result.error` or the status (`bay/dispatch.py:715`), so the ledger holds "abandoned" and the reason exists only in the call file. The change: `_finish` also reads `result.reason`. It is the same line with one more `or`. The test: the existing close test reads the `call.completed` event and asserts its summary holds the reason. On `main` the summary is "abandoned".

(c) A run's staleness counts from its last event. `_stale` ages a running agent from `r.started` (`bay/cli.py:529`), so an agent that has ticked its plan an hour ago is "stale" after a day of running. The change: `ledger.fold` records the time of the last event that names the run's runId or taskId (a tick, a note, a plan), and `_stale` uses it. The test: the existing stale test gives a run that started two days ago and ticked an item five minutes ago, and asserts it is not stale. On `main` it is listed under `STALE?`.

(d) `bay show` reflects a recorded gate approval. `_public` prints `gates` from the state saved when the gate was planned (`bay/dispatch.py:723-724`), so a finished call still reads "the gate runs: no recorded approval of docs/proposals/0014-test-defects.md ... only `bay approve` passes a gate". I read call C-20261102-d4bfca, which is `done`, and it says exactly that. The change: `approve` writes the gate's text after the decision ("approved by <by> on <date> (sha256 ...)", or "rejected by ..."; for an amendment, "amended and approved by ..."). The test: after the existing approve test, `show` is asserted to mention the approval; on `main` it still says "no recorded approval".

## Left out

**Item 6, test effectiveness, goes to its own proposal (0016).** It has three separate mechanisms and a shared need that does not exist yet.

- Part (1), running each new or changed test against the base. The dispatcher has to export the base tree, copy in the changed test files, run only the changed tests, and fail the step when one passes. A test that legitimately passes on the base (a refactor that changes no behaviour) needs a declared exception in the proposal, and that exception needs designing.
- Part (3), each test names what it guards, and lint reports rules no test guards and tests that guard nothing. It needs a convention (a marker or a docstring line) applied to the 539 existing tests, and a place that lists the rules and decisions.
- Part (5), no silent passes. The runner already prints and counts skips since 1.1.2. What remains is lint refusing an early `return` in a test.

All three need something the framework does not have: a reader of test source (lint does not read `tests/` today; `bay/lint.py:492` exempts it). That reader should be designed once. Together they would add roughly 60 lines to `bay/`, which is more than this proposal can pay, and the convention touches almost every test file, so it would swamp this review. The 0016 proposal can use plan approval (item 1) from the start.

**A path for secrets without a terminal** (item 11). The owner did not choose one. Storing the value with Keychain Access, or a local page that takes it in the browser, each needs its own analysis (the page is a new listener and attack surface), so it is a later proposal.

**An OS sandbox for builder test runs** (item 9). It is a different kind of change and a later proposal.

## Cost against the ceilings

All seven measures in `framework/limits.yaml` are covered.

- `bay_lines` (ceiling 9595, count 9595): over, so the exceptions entry above. The estimate by item, in lines of `bay/` as `limits.count` measures them: item 1 about +50 (guard +22, ledger +16, dispatch +6, cli +6); item 2 about +20 (dispatch +16, cli +4); item 3 about -8 (boundary.py: the feature branch is deleted); item 7 about +16 (ledger +11, cli +3, guard +2); item 10 about +14 (guard +6, dispatch +4, cli +4); item 11 about -11 (the backlog branch reuses `_approval_channel` and loses about 8 lines and `auth` loses 3, in cli.py; `secret` is unchanged); item 12 about +24 (ledger +16, guard +8); item 13 about +9 (ledger +4, cli +4, dispatch +1 for close, plus 3 for the gate text in dispatch); config about +6 and lint about +10 for item 1's setting; the new `agent.plan.approved` record in ledger about +10. That adds to about +180 gross, with item 11's saving counted among the payers. Payers in files the change edits, all with the same behaviour: the `chat_approvals` function and its two call sites (about -6), a duplicated docstring paragraph in `cli.py` about the approval channel (about -5), the repeated `Path(...) / ".agentbay"` lookups in `guard.py` folded into one name (about -6), and the boundary change above (about -8). Together with item 11's -11 that is about 36 saved besides the -8 already counted, so the net is about +144. I could not count these exactly without writing the code; the plan step will fix them, and the exception is an upper bound, to be lowered at release. The exception stays (recommended; the owner confirms at the gate). If it must shrink, items 12 (+24) and 7 (+16) are the first to drop, and then item 1 loses its file binding.
- `kit_python_lines` (6580, count 6580): over by the `scope` endpoint, so an exceptions entry. `scaffold.py` gains about 24 lines for it and loses about 6 for the always-`large` plan rule. The adapter's coordinator text is reflowed into the existing lines, as 0013 did, so `claude_code.py` nets 0.
- `cli_commands` (16): unchanged. `approve` takes a plan id the way it takes a backlog id and a workflow run id; `plan` gains a flag; no `sub.add_parser` call is added.
- `schemas` (16): unchanged. `config.schema.json` and `event.schema.json` are edited; no file is added.
- `framework_folders` (2) and `top_level_folders` (7): unchanged. Item 4 adds no folder (the owner rejected the CI workflow).
- `tests` (539): unchanged. No `def test_` is added. Each scenario above extends a named existing test. Where two tests merge, the one made obsolete is `tests/test_dispatch.py`'s `approvals.plan` always, never and bogus loop (it checked a switch that no longer exists; the `large` rules stay as one assertion) and the matching row in `tests/test_resolver.py:219`. Item 1's guard test goes into `tests/test_submit_needs_plan.py`, the revision and approval tests into `tests/test_ledger.py`, the amendment test into `tests/test_dispatch.py`, the status test into `tests/test_ledger.py`, and the chat-source tests in `tests/test_boundaries.py` and `tests/test_protection.py` are rewritten in place for the new key. If a scenario cannot fit into an existing test, the plan names the test it replaces; otherwise it does not go in.

**Docs.** Both docs are at their budget of 3000 words, measured with the improve detector's count: `docs/DESIGN.md` is 2999 and `docs/INTERFACES.md` is 2998 today, so neither has room for a single word. `README.md` is 1590 and has room, so it is not a problem. Each addition below is paid by a named cut in the same file, so the count does not rise. The numbers are my counts of the current text; the plan step will measure the result.

`docs/DESIGN.md`, about +205 words (the bypass statement of item 9 is part of the threat model):

- the threat model (item 8) +115, and the bypass statement (item 9) +40;
- plan approval and amendments, +50, and the guard note, +20;
- the `approve` setting is described in the paragraph that already describes chat approval, so it adds nothing.

Paid by:

- the "Hooks are defense in depth" paragraph, replaced by the threat model (-32);
- the "Chat approval is opt-in" paragraph (96 words), rewritten around `approve.from` in about 62 words (-34);
- the "Your terminal only" bullet (16 words), folded into the rewritten approval bullet (-16);
- the Plan bullet of `forge.extend` (86 words), which describes the three `approvals.plan` values; it shrinks to about 40 (-46);
- the Run log paragraph's last two sentences, which repeat what INTERFACES section 9 says about the stale list and the spawn hook (about -45, with a pointer to section 9 kept);
- the Gate bullet's chat-sha sentence (-18), which the rewritten approval bullet already carries;
- a sentence in the Dispatcher section that lists what the status paragraph already lists (-14).

That is about -205 for +205. If the count comes out higher, the plan step trims the threat model's last sentence first.

`docs/INTERFACES.md`, about +130 words:

- `bay approve <T-id>`, `bay plan --revise`, the plan `file` and the `agent.plan.approved` event in section 9, +85;
- the `guard` field on the step plan and the amendment sentence in section 7, +30;
- the `replaces` sentence (item 13a), +15.

Paid by:

- the section 9 sentence on stale and the spawn hook, which DESIGN also says (about -30; DESIGN keeps the one copy);
- the section 7 sentence on `abandoned` and `replaces`, merged into one (about -18);
- the two bullets of section 9 that list the dispatcher's and the guard's event types, merged (about -28);
- the section 9 sentence on `bay note done` and reclaim, which repeats the DESIGN status paragraph (about -22);
- the bullet on `review.recorded`, shortened (about -12);
- the section 10 introduction, cut to one sentence (-20).

That is about -130 for +130, again with a measured result from the plan step.

## Compatibility and safety impact

This change breaks one contract and no other.

- **`approvals` becomes `approve`.** A project whose `agentbay.config.yaml` has `approvals:` fails `bay check` with a message that names `approve` and shows the new shape. No alias and no translation are written. The only such file in this repository is the owner's own, which the owner edits by hand because the guard keeps agents out of it. Its apiVersion goes from `agentbay/v3` to `agentbay/v4` in `schemas/config.schema.json` (the `$id` and the `const`), and the CHANGELOG entry has an Upgrading section. `approvals.plan` goes with it; the plan step is always `large`.
- **The ledger event schema gains one type, `agent.plan.approved`,** and `agent.plan` events gain optional `data.revision`, `data.why` and `data.file`. This is additive: a reader that ignores an unknown type reads an old ledger and a new one alike, and no event changes meaning. The schema's apiVersion is unchanged.
- **Behaviour that changes.** A project that lists nothing in `approve.plans` behaves as before. `bay approve` now also accepts a plan id, and, mid-call, an amended proposal; a submit after an unapproved amendment is refused. `B-3` accepts more paths than before (a listed folder covers its features). Hosts that run `bay` outside a Claude Code session start to see the "guard not active" line.
- **Version.** Decision (owner, 2026-11-02): 2.0.0, because the config schema goes from v3 to v4. The CHANGELOG entry carries the Upgrading section.
- **Safety.** No secret is read, written or shown by any change here. Plan approvals and the heartbeat file hold no secret. Item 11 removes the terminal check only from `bay auth`, and it runs only after a Claude Code prompt; `bay secret set` still refuses a non-terminal, and a value never passes through the conversation. Item 1 narrows what a subagent may do and widens nothing for it, except writing its own plan file. The new owner-facing channel (a plan or a backlog item approved from chat) is the same channel as a gate approved from chat, labelled `user@chat-via-cos`, and it is on only if `from` lists chat. The guard remains guardrails, not a hard boundary, as item 8 now says in DESIGN.

## Decisions and positions

Decided by the owner on 2026-11-02 and written into the items above:

1. Item 4: the owner publishes the release; the release Result carries the commands and the release text. No CI workflow.
2. Item 9: stated in DESIGN's threat model as a known limit; a sandbox is a later proposal.
3. Item 11: backlog ids follow `approve.from`; `bay auth` drops its terminal check; `bay build` needs no change; `bay secret set` stays terminal-only, and a no-terminal path for secrets is a later proposal.
4. The version is 2.0.0 (config schema v3 to v4).
5. Item 6 stays out and becomes 0016.

My positions on the rest (recommended; the owner confirms at the gate):

1. Item 13(a): `replaces` is documented as honoured where the input type declares it.
2. Item 2: a mid-call `--reject` is refused and points to `bay show close`.
3. Item 10: the guard writes a heartbeat file.
4. The `approve.from` default is `[terminal]`, matching today's default of chat off.
5. The `bay_lines` exception stays at 9745 as an upper bound; items 12 and 7 are the first to drop if it must shrink.
