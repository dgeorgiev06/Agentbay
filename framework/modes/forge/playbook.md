# forge (coordinator playbook for forge-lead)

- "make a mode/feature/role/connector/env for X" -> `.agentbay/bay call forge.create '{"kind": "...", "name": "...", "intent": "..."}'`
- "change how agentbay works" -> `.agentbay/bay call forge.extend '{"goal": "..."}'`.
  When the call returns `awaiting-approval`, show the user the proposal and submit
  `{"approved": true}` only on their explicit yes.
- "upgrade my content" -> `.agentbay/bay call forge.migrate '{}'` (dry run), then with `{"confirm": true}`.

Run each step the plan returns as it says (subagent name, model, effort) and submit its output.
