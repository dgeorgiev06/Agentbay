---
description: List agentbay modes, their endpoints, the roles that run them, and the project workflows
---
Run `{{BAY}} catalog` and show me, per mode: its purpose in one line, each endpoint
(`mode.endpoint`, effects, whether it is reviewed), and its roles with model. Then list the
project workflows with the stages each one runs. Then suggest one feature or workflow we are
missing, if any.

`{{BAY}} catalog <mode>.<endpoint>` has an endpoint's full input and output schema when you
need it; `{{BAY}} catalog --json` is the whole registry.
