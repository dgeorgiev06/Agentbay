"""Where the kit keeps its extensions, for tests that must name them by what they are (proposal 0008, stage 5; 0010).
A logical path is `mode:<name>/<rest>`, `env:<name>` or `connector:<name>/<rest>`; anything else is already physical,
except the two renames below. Since 0010 every extension is a component folder, so `physical` needs the owner of
an env (the component of the mode it serves) and of an internal connector (the component that owns it)."""
from __future__ import annotations

# The paths of the protected instances, in the order the guard policy lists them after the four protected folders
# (framework/kernel.yaml `protected.paths`): written out so a change to the protected set shows in the test.
PROTECTED_INSTANCES = [
    "components/cos", "components/forge",
    "components/improve/envs/improve-local.yaml", "components/tools/envs/workspace.yaml",
    "components/tools/envs/research.yaml",
    "components/claude-transcripts", "components/briefing/connectors/corpus-store",
    "components/improve/connectors/artifact-graph", "components/improve/connectors/git",
    "components/improve/connectors/improve-detect", "components/improve/connectors/improve-store",
    "components/improve/connectors/ledger",
    "components/briefing/interfaces", "components/improve/interfaces", "components/tools/interfaces",
]

ENV_OWNER = {"cos-local": "cos", "improve-local": "improve", "framework-dev": "forge", "local-authoring": "forge",
             "local-feeds": "briefing", "local-mail": "mail-briefing", "workspace": "tools", "research": "tools"}
ENV_DEFAULT = "briefing"          # an env a test invents sits in an ordinary mode's folder
CONNECTOR_OWNER = {"scaffold": "forge", "workflow-runner": "cos", "corpus-store": "briefing", "fake": "post",
                   "fake-mail": "email", "improve-detect": "improve", "improve-store": "improve", "ledger": "improve",
                   "git": "improve", "artifact-graph": "improve"}    # the others (gmail-api, x-api, ...) are components
RENAMED = {"framework/components.yaml": "framework/kernel.yaml",     # the map
           "modes/x.yaml": "components/x.yaml"}                       # a user file in the old modes folder


def physical(logical: str) -> str:
    kind, sep, rest = logical.partition(":")
    if not sep:
        return RENAMED.get(logical, logical)
    if kind == "mode":
        return f"components/{rest}"
    if kind == "env":
        return f"components/{ENV_OWNER.get(rest, ENV_DEFAULT)}/envs/{rest}.yaml"
    if kind == "connector":
        name, _, tail = rest.partition("/")
        owner = CONNECTOR_OWNER.get(name)
        return f"components/{owner}/connectors/{rest}" if owner else f"components/{rest}"
    return logical
