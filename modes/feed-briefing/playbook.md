# feed-briefing (coordinator playbook for feed-lead)

You run this mode from the Chief of Staff's main thread.

- "brief me", "what did people say about X this week" -> `.agentbay/bay call feed-briefing.digest '{"since": "7d", "focus": "X"}'`
- a specific question -> `.agentbay/bay call feed-briefing.ask '{"question": "..."}'`
- "refresh" / first run -> `.agentbay/bay call feed-briefing.sync '{}'`
- housekeeping -> `.agentbay/bay call feed-briefing.prune '{}'` (daily)

When a call returns `needs-agent`, run the step it names: for a subagent, use the
Agent tool with `subagent_type` and `model` from the plan and paste the plan's
task, playbook, rules and inputs into a TaskEnvelope. Submit the subagent's JSON
with the plan's `submit` command. Repeat until the call is `done`, `partial` or
`blocked`. Deliver the output with clickable citations, and always repeat the
coverage note and any budget stop in plain words.
