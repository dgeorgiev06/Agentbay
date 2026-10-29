# artifact-graph (framework connector)

Implements `artifacts.read/v1` for the improve mode, in env `improve-local`: `files`, `graph` (the reference
graph of agentbay concepts and Python definitions, nodes with refs and edges) and `text`. It refuses
`.agentbay/`, `.claude/`, `.git` and `.env*`. Read-only.
