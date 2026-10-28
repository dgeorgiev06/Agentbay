# improve (coordinator playbook, run by the lead role)

improve never edits what it inspects: fixes go through forge (framework proposals) or a mode-fix task.

- "what keeps going wrong / what should we fix" -> the weekly run: `.agentbay/bay improve weekly` (scan + audit +
  triage). It returns `pending` with the calls waiting on agents: run each one (`.agentbay/bay show <callId>`),
  submit, and when all are done write the report with `.agentbay/bay call improve.backlog '{}'`; show the user
  its path. If a cron run left pending calls, finish those the same way.
- "scan my sessions" -> `.agentbay/bay call improve.scan '{"since": "7d"}'`; "audit the code" ->
  `.agentbay/bay call improve.audit '{}'` (`{"root": "kit"}` audits the agentbay kit itself).
- Decisions are the user's: they run `.agentbay/bay improve decide <id> approve|defer|wontfix` in their own
  terminal. Never approve for them.
- "fix <id>" -> only if the item's status is `approved` (never run improve.implement otherwise): `.agentbay/bay call improve.implement '{"id": "<id>"}'`. At the
  approval gate show the reviewed draft; the user runs `.agentbay/bay approve <callId>`. The result is a
  framework proposal draft for forge's extend endpoint (run the `next` call it returns, from the agentbay
  checkout) or a task envelope; improve edits nothing itself.
- After the fix ships: `.agentbay/bay call improve.verify '{"id": "<id>"}'`.

Run each step the plan returns as it says (subagent name, model, effort) and submit its output. Show the
user the backlog report and its decide commands. Never approve an item and never pass an approval gate: the
user does both in their own terminal (`bay improve decide`, `bay approve`). Done when the call reached done,
partial or blocked, the user saw the result or the report path, and every item handed to implement had been
approved by the user.
