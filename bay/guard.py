#!/usr/bin/env python3
"""PreToolUse guard for agentbay. Wired by the claude_code adapter with matcher
Bash|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep.

Why a hook: Claude Code permission rules are session-wide (they apply to
subagents too) and a subagent's `tools` field takes bare tool names, so
per-role scope cannot be expressed in settings.json. settings.json adds the
session-wide floor (Edit deny on .agentbay/**, .claude/** and the kit); this
hook adds the per-role part.

Who is calling. Hook input carries `agent_type` (and `agent_id`) when the call
comes from a subagent; the main thread sends neither.
  * agentbay subagent (agent_type in .agentbay/guard.json): scoped as below.
  * other subagent (agent_type unknown, or agent_id without agent_type): may not
    touch .agentbay/ or the kit CLI in any way; everything else falls through
    to normal permissions.
  * main thread (no agent fields): no decision; settings.json applies (explicit
    `bay call|submit|status|log|note|task|show` allows, Edit deny rules).
    Claude Code versions that do not send agent fields therefore look like the
    main thread; agentbay requires a version that does (documented).

agentbay subagents:
  * nothing under .agentbay/ via any tool, except running their own use shim
  * file writes only inside the env's fs.write, never under .agentbay/, .claude/
    or .git/, never into the kit when the kit is outside the project, and never
    into framework/, bay/ or schemas/ of the kit checkout unless the env names
    them explicitly
  * reads only inside the env's fs.read
  * Bash: one simple command (no ; && | > < ` $( or newlines) that is the role's
    own shim or one of its env's command prefixes; git file-writing/exec flags
    (--output, --ext-diff, --textconv, --no-index, ...) are refused, and no
    argument may resolve under .agentbay/ or .claude/. Allowed commands get an
    explicit "allow" so they do not prompt.
All paths are normalized (.., symlinks) before checking. Errors fail closed for
subagents.
"""
from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path

POLICY = Path(".agentbay") / "guard.json"
FILE_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
NEVER_WRITE = (".agentbay", ".claude", ".git")
GIT_BAD_FLAGS = ("--output", "--ext-diff", "--textconv", "--no-index", "--exec", "--upload-pack",
                 "--receive-pack", "--config", "--git-dir", "--work-tree", "--open-files-in-pager")


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


def norm(path: str, cwd: Path) -> Path:
    """Absolute, ..-free, symlink-resolved path."""
    p = Path(os.path.expanduser(path))
    if not p.is_absolute():
        p = cwd / p
    return Path(os.path.realpath(p))


def under(p: Path, root: Path) -> bool:
    try:
        p.relative_to(root)
        return True
    except ValueError:
        return False


class Guard:
    def __init__(self, policy: dict, project: Path):
        self.policy = policy
        self.project = Path(os.path.realpath(policy.get("project") or project))
        self.kit = Path(os.path.realpath(policy["kit"])) if policy.get("kit") else None
        self.agentbay = self.project / ".agentbay"

    # ---------------------------------------------------------------- decisions
    def decide(self, payload: dict) -> tuple[str, str]:
        """('allow'|'deny'|'pass', reason)"""
        agent = payload.get("agent_type")
        if not agent and not payload.get("agent_id"):
            return "pass", ""                                    # main thread
        entry = self.policy.get("subagents", {}).get(agent) if agent else None
        tool = payload.get("tool_name")
        ti = payload.get("tool_input") or {}
        cwd = Path(payload.get("cwd") or self.project)
        who = f"subagent {agent or payload.get('agent_id')}"
        if tool == "Bash":
            return self._bash(entry, who, ti.get("command", ""), cwd)
        if tool in FILE_TOOLS:
            return self._files(entry, who, tool, ti, cwd)
        return "pass", ""

    def _files(self, entry, who, tool, ti, cwd) -> tuple[str, str]:
        raw = [ti[k] for k in ("file_path", "notebook_path", "path") if isinstance(ti.get(k), str) and ti[k]]
        if tool in ("Glob", "Grep") and not ti.get("path"):
            raw.append(".")
        pattern = ti.get("pattern") if tool == "Glob" else ti.get("glob") if tool == "Grep" else None
        if ".agentbay" in str(pattern or ""):
            return "deny", f"agentbay: {who} may not search .agentbay/ (use the role's use shim for data)"
        paths = [norm(r, cwd) for r in raw]
        for p in paths:
            if under(p, self.agentbay):
                return "deny", f"agentbay: {who} may not access {p} (.agentbay/ is the control plane)"
        if entry is None:
            return "pass", ""
        if tool in WRITE_TOOLS:
            for p in paths:
                why = self._write_denied(entry, p)
                if why:
                    return "deny", f"agentbay: role {entry['role']} may not write {p}: {why}"
        else:
            for p in paths:
                if not any(under(p, self.project / r) for r in entry.get("read", ["."])):
                    return "deny", (f"agentbay: role {entry['role']} may only read inside "
                                    f"{', '.join(entry.get('read', ['.']))} (env fs.read)")
        return "pass", ""

    def _write_denied(self, entry: dict, p: Path) -> str | None:
        for d in NEVER_WRITE:
            if under(p, self.project / d):
                return f"{d}/ is never writable by agents"
        if self.kit and not under(self.kit, self.project) and under(p, self.kit):
            return "the agentbay kit is not writable by agents"
        writes = entry.get("write", [])
        if not any(under(p, self.project / w) for w in writes):
            return f"outside the env's fs.write {writes}"
        for d in self.policy.get("protected", []):
            if under(p, self.project / d) and not any(under(self.project / w, self.project / d) for w in writes):
                return f"{d}/ of the agentbay checkout is writable only by forge.extend (env must name it)"
        return None

    def _bash(self, entry, who, command, cwd) -> tuple[str, str]:
        why = unsafe(command)
        try:
            words = shlex.split(command) if not why else []
        except ValueError as e:
            why = f"cannot parse command ({e})"
            words = []
        if entry is None:
            # not an agentbay role: keep it off the control plane by exact path, fail closed if unparsable
            if why:
                return ("deny", f"agentbay: {who}: {why} (in a command that mentions .agentbay)") \
                    if ".agentbay" in command else ("pass", "")
            for w in words:
                if self._touches_control_plane(w, cwd):
                    return "deny", (f"agentbay: {who} is not an agentbay role and may not run or access {w}; "
                                    f"only the main thread runs .agentbay/bay")
            return "pass", ""
        if why:
            return "deny", f"agentbay: {who}: {why}"
        if not words:
            return "deny", f"agentbay: {who}: empty command"
        shim = entry.get("shim")
        if shim and norm(words[0], cwd) == norm(shim, self.project):
            for w in words[1:]:
                if w.startswith("-"):
                    return "deny", f"agentbay: the use shim takes no flags (got {w})"
            return "allow", ""
        for prefix in entry.get("clis", []):
            pw = shlex.split(prefix)
            if words[: len(pw)] != pw:
                continue
            rest = words[len(pw):]
            if pw[0] == "git":
                bad = [w for w in rest if w.startswith(GIT_BAD_FLAGS)]
                if bad:
                    return "deny", f"agentbay: git flag {bad[0]} is not allowed (it writes files or runs programs)"
            for w in rest:
                if not w.startswith("-") and self._touches_control_plane(w, cwd, also_claude=True):
                    return "deny", f"agentbay: argument {w} reaches .agentbay/ or .claude/"
            return "allow", ""
        allowed = ([shim] if shim else []) + entry.get("clis", [])
        return "deny", (f"agentbay: role {entry['role']} may only run: {', '.join(allowed) or 'nothing'} via Bash"
                        + (f". Use `{shim} <capability>/v<N>.<endpoint> '<json>'` for data." if shim else "."))

    def _touches_control_plane(self, word: str, cwd: Path, also_claude: bool = False) -> bool:
        if "/" not in word and word not in (".agentbay", ".claude", "bay.sh"):
            return False
        p = norm(word.split("=", 1)[-1], cwd)
        if under(p, self.agentbay) or (also_claude and under(p, self.project / ".claude")):
            return True
        if self.kit and (p == self.kit / "bay.sh" or under(p, self.kit / "bay")):
            return True
        return False


def _emit(decision: str, reason: str) -> None:
    out = {"hookEventName": "PreToolUse", "permissionDecision": decision}
    if reason:
        out["permissionDecisionReason"] = reason
    print(json.dumps({"hookSpecificOutput": out}))


def main() -> int:
    subagent = False
    try:
        payload = json.load(sys.stdin)
        subagent = bool(payload.get("agent_type") or payload.get("agent_id"))
        if not subagent:
            return 0
        project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        policy = json.loads((project / POLICY).read_text())
        decision, reason = Guard(policy, project).decide(payload)
        if decision == "deny":
            print(reason, file=sys.stderr)
            _emit("deny", reason)
            return 2
        if decision == "allow":
            _emit("allow", "")
        return 0
    except Exception as e:  # fail closed for subagents
        if subagent:
            msg = f"agentbay guard error ({type(e).__name__}); denied for subagent. Rebuild with ./bay.sh build"
            print(msg, file=sys.stderr)
            _emit("deny", msg)
            return 2
        return 0


if __name__ == "__main__":
    sys.exit(main())
