#!/usr/bin/env python3
"""PreToolUse guard for Bash calls made by agentbay subagents. Wired by the claude_code adapter.

Claude Code's permissions.allow is session-wide (it applies to subagents too)
and a subagent's `tools` field takes only bare tool names, so per-role Bash
scope is enforced here. Hook input carries `agent_type` when the call comes
from a subagent. For every subagent agentbay generated (listed in
.agentbay/guard.json), a Bash command is allowed only when it is ONE simple
command (no ; && || | > < ` $( or newlines) whose program is either
  * that role's own use shim  (.agentbay/roles/<role>/use ...), or
  * one of the role's pre-approved command prefixes (from its env's tool bindings).
Everything else (.agentbay/bay, other roles' shims, bay/cli.py, security, ...)
is denied with a reason the subagent sees.

Fail closed for subagents (any error -> deny). Other subagents may not touch
.agentbay/ or the kit CLI at all; their other commands, and every call from the
main thread, get no decision and fall through to normal Claude Code
permissions.
"""
from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path

POLICY = Path(".agentbay") / "guard.json"


def unsafe(cmd: str) -> str | None:
    """Return why `cmd` is not a single simple command, or None."""
    single = double = False
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if c == "\\" and not single:
            i += 2
            continue
        if c == "'" and not double:
            single = not single
        elif c == '"' and not single:
            double = not double
        elif not single and c in "`$":
            return "shell expansion ($ or `) is not allowed"
        elif not single and not double and (c in ";&|<>\n\r(){}"):
            return f"shell operator {c!r} is not allowed; run one command at a time"
        i += 1
    if single or double:
        return "unbalanced quotes"
    return None


def decide(policy: dict, agent: str, command: str, project: Path) -> tuple[str, str]:
    """('allow'|'deny', reason)"""
    entry = policy.get("subagents", {}).get(agent)
    if entry is None:
        # not an agentbay role: leave it to normal permissions, but keep it off the control plane
        if any(m in command for m in (".agentbay/", "bay/cli.py", "bay.sh")):
            return "deny", (f"agentbay: subagent {agent} is not an agentbay role; only the main thread runs "
                            f".agentbay/bay and only agentbay roles run their own use shim")
        return "pass", ""
    why = unsafe(command)
    if why:
        return "deny", f"agentbay: {agent}: {why}"
    try:
        words = shlex.split(command)
    except ValueError as e:
        return "deny", f"agentbay: {agent}: cannot parse command ({e})"
    if not words:
        return "deny", f"agentbay: {agent}: empty command"
    shim = entry.get("shim")
    if shim:
        prog = words[0]
        targets = {shim, f"./{shim}", str(project / shim)}
        if prog in targets:
            return "allow", ""
    for prefix in entry.get("clis", []):
        pw = shlex.split(prefix)
        if words[: len(pw)] == pw:
            return "allow", ""
    allowed = ([shim] if shim else []) + entry.get("clis", [])
    return "deny", (f"agentbay: role {entry.get('role', agent)} may only run: {', '.join(allowed) or 'nothing'} "
                    f"via Bash. Use `{shim} <capability>/v<N>.<endpoint> '<json>'` for data." if shim else
                    f"agentbay: role {entry.get('role', agent)} may only run: {', '.join(allowed) or 'nothing'} via Bash.")


def _emit(decision: str, reason: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}))


def main() -> int:
    agent = None
    try:
        payload = json.load(sys.stdin)
        agent = payload.get("agent_type")
        if payload.get("tool_name") != "Bash" or not agent:
            return 0
        project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        policy = json.loads((project / POLICY).read_text())
        decision, reason = decide(policy, agent, (payload.get("tool_input") or {}).get("command", ""), project)
        if decision == "deny":
            print(reason, file=sys.stderr)
            _emit("deny", reason)
            return 2
        return 0
    except Exception as e:  # fail closed only for subagents
        if agent:
            msg = f"agentbay guard error ({type(e).__name__}); Bash denied for subagent {agent}. Rebuild with ./bay.sh build"
            print(msg, file=sys.stderr)
            _emit("deny", msg)
            return 2
        return 0


if __name__ == "__main__":
    sys.exit(main())
