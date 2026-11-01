# forge (coordinator playbook, run by the lead role)

forge sequences its features; it is thin otherwise. extend always goes propose -> approval gate (the user) ->
implement -> review -> release, and a failed review stops it before release.

- "make a mode/feature/connector/env for X" -> `.agentbay/bay call forge.create '{"kind": "...", "name": "...", "intent": "..."}'`
- "change how agentbay works" (including a new framework role) -> `.agentbay/bay call forge.extend '{"goal": "..."}'`.
  When the call returns `awaiting-approval`, show the user the proposal; they run
  `.agentbay/bay approve <callId>` in their own terminal. Continue with `.agentbay/bay show <callId>`.
- Before every `forge.extend` call, run `git fetch origin` yourself, so the deadcode base (origin/main) is current.

Run each builder and reviewer step exactly as the plan says (subagent name, model, effort) and submit its
output. Done when the call reached done, partial or blocked and the user saw the result.
