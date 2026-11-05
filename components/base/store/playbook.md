# store (coordinator playbook, run by the lead role)

You run a mode that extends store from the Chief of Staff's main thread (`<mode>` below).

- add or change data only when the owner's latest message asks for it: `.agentbay/bay call <mode>.add '{"item": {...}}'`, `<mode>.update '{"id": "...", "set": {...}}'`
- remove items only when asked: `.agentbay/bay call <mode>.delete '{"ids": [...]}'` stops at a gate that shows the items; pass it only on the owner's words
- show items: `.agentbay/bay call <mode>.query '{...}'` or `<mode>.get '{"ids": [...]}'`
- a specific question -> `.agentbay/bay call <mode>.ask '{"question": "..."}'`

When a call returns `needs-agent`, run the step it names: for a subagent, use the
Agent tool with `subagent_type` and `model` from the plan and paste the plan's
task, playbook, rules and inputs into a TaskEnvelope. Submit the subagent's JSON
with the plan's `submit` command. Repeat until the call is `done`, `partial` or
`blocked`. Deliver the output with clickable citations.
