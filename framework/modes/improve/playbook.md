# improve (coordinator playbook, run by the lead role)

improve never edits what it inspects: fixes go through forge (framework proposals) or a mode-fix task.

- "what keeps going wrong / what should we fix" -> the weekly run, in this order: `.agentbay/bay call improve.scan
  '{}'`, `improve.audit`, `improve.triage`. One at a time: each may return `needs-agent`; run it to a terminal
  status (`.agentbay/bay show <callId>`, submit) before you start the next, because two open improve calls on the
  analyst unit limit its reads to what both declare. When all three are done write the report with `.agentbay/bay
  call improve.backlog '{}'`; show the user its path. If a cron run left a scan pending, finish it first, then
  audit and triage in turn. A refused use names the open calls in the way: finish them (`bay show <callId>`) or
  reclaim a stuck run (`bay show reclaim <runId>`).
- "scan my sessions" -> `.agentbay/bay call improve.scan '{"since": "7d"}'`; "audit the code" ->
  `.agentbay/bay call improve.audit '{}'` (`{"root": "kit"}` audits the agentbay kit itself).
- Decisions are the user's: they run `.agentbay/bay approve <id>` (or `--defer`, `--wontfix`) in their own
  terminal. Never approve for them, and never relay one from chat.
- "fix <id>" -> only if the item's status is `approved` (never run improve.implement otherwise): `.agentbay/bay call improve.implement '{"id": "<id>"}'`. At the
  approval gate show the reviewed draft; the user runs `.agentbay/bay approve <callId>`. The result is a
  framework proposal draft for forge's extend endpoint (run the `next` call it returns, from the agentbay
  checkout) or a task envelope; improve edits nothing itself.
- After the fix ships: `.agentbay/bay call improve.verify '{"id": "<id>"}'`.

Run each step the plan returns as it says (subagent name, model, effort) and submit its output. Show the
user the backlog report and its approve commands. Never approve an item and never pass an approval gate: the
user does both in their own terminal (`bay approve <id>`, `bay approve <callId>`). Done when the call reached done,
partial or blocked, the user saw the result or the report path, and every item handed to implement had been
approved by the user.
