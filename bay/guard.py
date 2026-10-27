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

import fnmatch
import json
import os
import shlex
import sys
from pathlib import Path

POLICY = Path(".agentbay") / "guard.json"
FILE_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
CONTROL = (".agentbay", ".claude")                 # never read/searched by subagents via patterns
# never written by any subagent (S-D): directory segments at any depth, file names at any depth,
# file-name prefixes, and multi-segment paths
NEVER_DIRS = (".agentbay", ".claude", ".git", ".vscode", ".idea")
NEVER_FILES = ("CLAUDE.md", "CLAUDE.local.md", ".mcp.json", "agentbay.config.yaml", ".envrc", "Makefile", "bay.sh")
NEVER_PREFIXES = (".env",)
NEVER_SEQS = ((".github", "workflows"),)
GIT_BAD_FLAGS = ("--output", "--ext-diff", "--textconv", "--no-index", "--exec", "--upload-pack",
                 "--receive-pack", "--config", "--git-dir", "--work-tree", "--open-files-in-pager",
                 "--pathspec-from-file", "-O")
INTERPRETERS = ("sh", "bash", "zsh", "dash", "ksh", "fish", "node", "perl", "ruby", "php", "deno", "bun")
EVAL_FLAGS = ("-c", "-e", "--eval", "-E", "-r")
PROBES = (".agentbay/guard.json", ".agentbay/bay", ".agentbay/roles/role/use", ".agentbay/data/feeds/posts.jsonl",
          ".agentbay/data/feeds/state.json", ".agentbay/calls/C-0.json", ".agentbay/ledger/events.jsonl",
          ".claude/settings.json", ".claude/settings.local.json", ".claude/agents/agent.md")


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


def case_insensitive(probe: Path) -> bool:
    """Is the filesystem holding `probe` (an existing path) case-insensitive? Checked once per run."""
    alt = probe.with_name(probe.name.swapcase())
    if alt == probe or not probe.exists():
        return False
    try:
        return alt.exists() and os.path.samefile(alt, probe)
    except OSError:
        return False


def _expand_braces(pat: str) -> list[str]:
    i = pat.find("{")
    j = pat.find("}", i + 1)
    if i < 0 or j < 0:
        return [pat]
    return [x for alt in pat[i + 1:j].split(",") for x in _expand_braces(pat[:i] + alt + pat[j + 1:])]


def _seg_match(pat: list[str], path: list[str]) -> bool:
    """Glob match by segment; wildcards never match a leading '.' (shell/glob dotfile rule)."""
    if not pat:
        return not path
    head = pat[0]
    if head == "**":
        if _seg_match(pat[1:], path):
            return True
        return bool(path) and not path[0].startswith(".") and _seg_match(pat, path[1:])
    if not path:
        return False
    if path[0].startswith(".") and not head.startswith("."):
        return False
    return fnmatch.fnmatchcase(path[0], head) and _seg_match(pat[1:], path[1:])


def glob_hits(pattern: str, probes: list[str], fold: bool) -> list[str]:
    hits = []
    for pat in _expand_braces(pattern):
        pat = pat.strip("/").replace("//", "/")
        if fold:
            pat = pat.casefold()
        for pr in probes:
            segs = (pr.casefold() if fold else pr).split("/")
            # the pattern may name the file or any directory above it (`ls .claude/`, `Glob .agentbay`)
            if any(_seg_match(pat.split("/"), segs[:n]) for n in range(1, len(segs) + 1)):
                hits.append(pr)
    return hits


class Guard:
    def __init__(self, policy: dict, project: Path, ci: bool | None = None):
        self.policy = policy
        self.project = Path(os.path.realpath(policy.get("project") or project))
        self.kit = Path(os.path.realpath(policy["kit"])) if policy.get("kit") else None
        self.agentbay = self.project / ".agentbay"
        self.ci = case_insensitive(self.agentbay) if ci is None else ci

    # ---------------------------------------------------------------- identity-based path checks (B1)
    def _fold(self, p: Path) -> str:
        return str(p).casefold() if self.ci else str(p)

    def inside(self, p: Path, root: Path) -> bool:
        """p is root or below it: by path (case-folded on case-insensitive filesystems) or by identity
        (os.stat st_dev/st_ino of p or any existing ancestor equals root's)."""
        if under(p, root) or (self.ci and (self._fold(p) + os.sep).startswith(self._fold(root) + os.sep)):
            return True
        try:
            rs = os.stat(root)
        except OSError:
            return False
        for a in (p, *p.parents):
            try:
                st = os.stat(a)
            except OSError:
                continue
            if (st.st_dev, st.st_ino) == (rs.st_dev, rs.st_ino):
                return True
        return False

    def _segments(self, p: Path) -> list[str]:
        rel = p.relative_to(self.project).parts if under(p, self.project) else p.parts
        return [s.casefold() if self.ci else s for s in rel]

    def never_write(self, p: Path) -> str | None:
        f = (lambda s: s.casefold()) if self.ci else (lambda s: s)
        segs = self._segments(p)
        for d in NEVER_DIRS:
            if f(d) in segs[:-1] or (segs and segs[-1] == f(d)) or self.inside(p, self.project / d):
                return f"{d}/ is never writable by agents"
        name = segs[-1] if segs else ""
        if name in {f(n) for n in NEVER_FILES} or any(name.startswith(f(x)) for x in NEVER_PREFIXES):
            return f"{p.name} is never writable by agents (agent/tool configuration)"
        for seq in NEVER_SEQS:
            fs = [f(x) for x in seq]
            if any(segs[i:i + len(fs)] == fs for i in range(len(segs))):
                return f"{'/'.join(seq)}/ is never writable by agents"
        if self.kit and not under(self.kit, self.project) and self.inside(p, self.kit):
            return "the agentbay kit is not writable by agents"
        return None

    # ---------------------------------------------------------------- decisions
    def decide(self, payload: dict) -> tuple[str, str]:
        """('allow'|'deny'|'pass', reason)"""
        agent = payload.get("agent_type")
        entry = self.policy.get("subagents", {}).get(agent) if agent else None
        if entry is None and not payload.get("agent_id"):
            return "pass", ""            # main thread (also `--agent` sessions: agent_type without agent_id)
        tool = payload.get("tool_name")
        ti = payload.get("tool_input") or {}
        cwd = Path(payload.get("cwd") or self.project)
        who = f"subagent {agent or payload.get('agent_id')}"
        if tool == "Bash":
            return self._bash(entry, who, ti.get("command", ""), cwd)
        if tool in FILE_TOOLS:
            return self._files(entry, who, tool, ti, cwd)
        return "pass", ""

    def _search(self, entry, who, tool, ti, cwd) -> tuple[str, str] | None:
        pattern = ti.get("pattern") if tool == "Glob" else ti.get("glob")
        if not pattern:
            return None
        root = norm(ti.get("path") or ".", cwd)
        if under(self.project, root):          # search root at or above the project: probe the control plane
            prefix = Path(os.path.relpath(self.project, root))
            probes = [str(prefix / pr) if str(prefix) != "." else pr for pr in PROBES]
            hits = glob_hits(pattern, probes, self.ci)
            if hits:
                return "deny", f"agentbay: {who} may not search {hits[0].split('/')[-2]}/ (pattern {pattern})"
            if entry is not None and root == self.project and pattern.lstrip("/").startswith("."):
                return "deny", f"agentbay: {who} may not glob dot-paths ({pattern}) at the project root"
        elif ".." in pattern:
            return "deny", f"agentbay: {who}: '..' in a search pattern is not allowed"
        return None

    def _files(self, entry, who, tool, ti, cwd) -> tuple[str, str]:
        raw = [ti[k] for k in ("file_path", "notebook_path", "path") if isinstance(ti.get(k), str) and ti[k]]
        if tool in ("Glob", "Grep"):
            if not ti.get("path"):
                raw.append(".")
            d = self._search(entry, who, tool, ti, cwd)
            if d:
                return d
        paths = [norm(r, cwd) for r in raw]
        for p in paths:
            if self.inside(p, self.agentbay):
                return "deny", f"agentbay: {who} may not access {p} (.agentbay/ is the control plane)"
        if tool in WRITE_TOOLS:
            for p in paths:
                why = self.never_write(p)
                if why:
                    return "deny", f"agentbay: {who} may not write {p}: {why}"
        if entry is None:
            return "pass", ""
        if tool in WRITE_TOOLS:
            for p in paths:
                why = self._write_denied(entry, p)
                if why:
                    return "deny", f"agentbay: role {entry['role']} may not write {p}: {why}"
        else:
            for p in paths:
                if not any(self.inside(p, self.project / r) for r in entry.get("read", ["."])):
                    return "deny", (f"agentbay: role {entry['role']} may only read inside "
                                    f"{', '.join(entry.get('read', ['.']))} (env fs.read)")
        return "pass", ""

    def _write_denied(self, entry: dict, p: Path) -> str | None:
        writes = entry.get("write", [])
        if not any(self.inside(p, self.project / w) for w in writes):
            return f"outside the role's writable paths {writes}"
        for d in self.policy.get("protected", []):
            if self.inside(p, self.project / d) and not any(under(self.project / w, self.project / d) for w in writes):
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
            # not an agentbay role: off the control plane by path, glob and interpreter -c (S-B)
            if why:
                return ("deny", f"agentbay: {who}: {why} (in a command that mentions .agentbay/.claude)") \
                    if any(c in command for c in CONTROL) else ("pass", "")
            d = self._words(who, words, cwd)
            return d or ("pass", "")
        if why:
            return "deny", f"agentbay: {who}: {why}"
        if not words:
            return "deny", f"agentbay: {who}: empty command"
        shim = entry.get("shim")
        if shim and norm(words[0], cwd) == norm(shim, self.project):
            for w in words[1:]:
                if w.startswith("-"):
                    return "deny", f"agentbay: the use shim takes no flags (got {w})"
            return "allow", ""             # the ONLY auto-allow: the role's own read-only data shim
        for prefix in entry.get("clis", []):
            pw = shlex.split(prefix)
            if words[: len(pw)] != pw:
                continue
            rest = words[len(pw):]
            d = self._words(who, words, cwd, first=len(pw))
            if d:
                return d
            if pw[0] == "git":
                bad = [w for w in rest if w.startswith(GIT_BAD_FLAGS)]
                if bad:
                    return "deny", f"agentbay: git flag {bad[0]} is not allowed (it writes or reads files or runs programs)"
                if words[1:3] == ["worktree", "add"]:
                    d = self._worktree_add(entry, words[3:], cwd)
                    if d:
                        return d
            return "pass", ""              # never auto-allowed: Claude Code's normal permission prompt applies
        allowed = ([shim] if shim else []) + entry.get("clis", [])
        return "deny", (f"agentbay: role {entry['role']} may only run: {', '.join(allowed) or 'nothing'} via Bash"
                        + (f". Use `{shim} <capability>/v<N>.<endpoint> '<json>'` for data." if shim else "."))

    def _words(self, who, words, cwd, first: int = 0) -> tuple[str, str] | None:
        """Checks every word for inline interpreter code; words from `first` on (the arguments after an
        approved command prefix) for paths and globs reaching the control plane."""
        for i, w in enumerate(words):
            base = os.path.basename(w)
            if (base in INTERPRETERS or base.startswith("python")) and any(
                    x in EVAL_FLAGS or (x.startswith("-") and not x.startswith("--") and "c" in x[1:])
                    for x in words[i + 1:i + 3]):
                return "deny", f"agentbay: {who}: inline interpreter code ({base} -c/-e) is not allowed"
            if i < first:
                continue
            val = w.split("=", 1)[1] if w.startswith("-") and "=" in w else w
            if not val or (val.startswith("-") and "=" not in w):
                continue
            if self._touches_control_plane(val, cwd):
                return "deny", f"agentbay: {who}: argument {w} reaches .agentbay/, .claude/ or the kit CLI"
            if any(c in val for c in "*?[{"):
                rel = os.path.relpath(norm(os.path.dirname(val) or ".", cwd), self.project)
                pat = os.path.join(rel, os.path.basename(val)) if rel != "." else os.path.basename(val)
                if glob_hits(pat, list(PROBES), self.ci):
                    return "deny", f"agentbay: {who}: glob {w} matches .agentbay/ or .claude/"
        return None

    def _worktree_add(self, entry, args, cwd) -> tuple[str, str] | None:
        it = iter(args)
        for a in it:
            if a in ("-b", "-B", "--reason"):
                next(it, None)
                continue
            if a.startswith("-"):
                continue
            p = norm(a, cwd)
            if os.path.isabs(a) or not under(p, self.project):
                return "deny", "agentbay: git worktree add needs a relative path inside the project"
            why = self.never_write(p) or self._write_denied(entry, p)
            if why:
                return "deny", f"agentbay: git worktree add {a}: {why}"
            return None
        return None

    def _touches_control_plane(self, word: str, cwd: Path) -> bool:
        if "/" not in word and word.casefold() not in (".agentbay", ".claude", "bay.sh"):
            return False
        p = norm(word, cwd)
        if self.inside(p, self.agentbay) or self.inside(p, self.project / ".claude"):
            return True
        if self.kit and p in (self.kit / "bay.sh", self.kit / "bay" / "cli.py"):     # the kit control-plane CLI
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
        subagent = bool(payload.get("agent_id") or payload.get("agent_type"))
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
