# briefing (coordinator playbook, run by the lead role)

You run a mode that extends briefing from the Chief of Staff's main thread (`<mode>` below).

- "brief me", "what did people say about X this week" -> `.agentbay/bay call <mode>.digest '{"since": "7d", "focus": "X"}'`
- a specific question -> `.agentbay/bay call <mode>.ask '{"question": "..."}'`
- "refresh" / first run -> `.agentbay/bay call <mode>.sync '{}'`
- housekeeping -> `.agentbay/bay call <mode>.prune '{}'` (daily)

When a call returns `needs-agent`, run the step it names: for a subagent, use the
Agent tool with `subagent_type` and `model` from the plan and paste the plan's
task, playbook, rules and inputs into a TaskEnvelope. Submit the subagent's JSON
with the plan's `submit` command. Repeat until the call is `done`, `partial` or
`blocked`. Deliver the output with clickable citations (for a cited item id, look up
its url with your use shim: `items.store/v1.get '{"ids": [...]}'`), and always repeat
the coverage note and any budget stop in plain words.
