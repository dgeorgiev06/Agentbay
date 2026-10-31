"""Where the kit keeps its extensions, for tests that must name them by what they are (proposal 0008, stage 5). A
logical path is `mode:<name>/<rest>`, `env:<name>` or `connector:<name>/<rest>`; anything else is already physical.
Since part G every mode, env and connector sits in modes/, envs/ or connectors/, whoever wrote it, so `physical` is a
plain mapping (the guard-matrix rows were written on logical paths before the move and keep their keys)."""
from __future__ import annotations

FOLDERS = {"mode": "modes", "env": "envs", "connector": "connectors"}

# The paths of the protected instances, in the order the guard policy lists them after the four protected folders (the
# map's order per kind): written out so a change to the protected set shows in the test, not only in the map.
PROTECTED_INSTANCES = [
    "modes/cos", "modes/forge", "modes/improve",
    "envs/cos-local.yaml", "envs/framework-dev.yaml", "envs/improve-local.yaml", "envs/local-authoring.yaml",
    "envs/workspace.yaml", "envs/research.yaml",
    "connectors/artifact-graph", "connectors/claude-transcripts", "connectors/corpus-store", "connectors/git",
    "connectors/improve-detect", "connectors/improve-store", "connectors/ledger", "connectors/scaffold",
    "connectors/workflow-runner",
]


def physical(logical: str) -> str:
    kind, sep, rest = logical.partition(":")
    if not sep or kind not in FOLDERS:
        return logical
    return f"{FOLDERS[kind]}/{rest}.yaml" if kind == "env" else f"{FOLDERS[kind]}/{rest}"
