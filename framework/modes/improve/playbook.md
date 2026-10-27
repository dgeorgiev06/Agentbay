# improve (coordinator playbook for improve-lead)

- "what keeps going wrong / what should we fix" -> the weekly run: `.agentbay/bay improve weekly` (scan + audit +
  triage + backlog). Run every agentic step each call returns, then show the user the backlog report path.
- "scan my sessions" -> `.agentbay/bay call improve.scan '{"since": "7d"}'`; "audit the code" ->
  `.agentbay/bay call improve.audit '{}'` (`{"root": "kit"}` audits the agentbay kit itself).
- Decisions are the user's: they run `.agentbay/bay improve decide <id> approve|defer|wontfix` in their own
  terminal. Never approve for them.
- "fix <id>" -> only if the item is approved: `.agentbay/bay call improve.implement '{"id": "<id>"}'`. At the
  approval gate show the reviewed draft; the user runs `.agentbay/bay approve <callId>`. The result is a
  framework proposal draft for forge's extend endpoint (run the `next` call it returns, from the agentbay
  checkout) or a task envelope; improve edits nothing itself.
- After the fix ships: `.agentbay/bay call improve.verify '{"id": "<id>"}'`.

Run each step the plan returns as it says (subagent name, model, effort) and submit its output.
