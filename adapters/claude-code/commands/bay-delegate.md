---
description: Route a request to an agentbay mode endpoint and run it
argument-hint: <what you want done>
---
Act as Chief of Staff for this request: $ARGUMENTS

Pick the mode endpoint from the registry (`{{BAY}} catalog`), show me the call you will
make if it writes, spends or deletes, then run it with `{{BAY}} call <mode>.<endpoint> '<json>'`
and follow the step plans it returns until it finishes.

If a configured project workflow already does this, run that instead: `{{BAY}} call cos.run
'{"workflow": "<name>", ...}'`, then drive each stage it hands back and report it with
`{{BAY}} call cos.next ...`.
