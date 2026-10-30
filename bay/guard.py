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
    `bay show|status|log|note|task` allows, Edit deny rules; `bay call` and
    `bay submit` always prompt).
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
    argument may resolve under .agentbay/ or .claude/. Only the role's own shim
    gets an explicit "allow" (and not in the agentbay checkout); everything else
    that passes the guard still gets Claude Code's normal permission prompt.
All paths are normalized (.., symlinks) before checking. Errors fail closed for
subagents.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
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
PROBES = (".agentbay/guard.json", ".agentbay/bay", ".agentbay/roles/role/use", ".agentbay/data/feeds/feed-briefing/corpus.db",
          ".agentbay/data/feeds/feed-briefing/corpus.db-wal", ".agentbay/calls/C-0.json", ".agentbay/ledger/events.jsonl",
          ".claude/settings.json", ".claude/settings.local.json", ".claude/agents/agent.md")


# the owner's settings file: it turns approvals from chat on (proposal 0006, Part G), so no subagent may name it in
# a Bash command (a write by redirect, cp, mv, sed -i, tee, ...); file tools are refused by NEVER_FILES
CONFIG_FILE = "agentbay.config.yaml"
# the kit CLI in any spelling: bay, bay.sh, .agentbay/bay, bay/cli.py, `python -m bay.cli`
_CLI_RE = re.compile(r"(?:^|[\s;&|()`$'\"])(?:\S*/)?(?:bay|bay\.sh|cli\.py|bay\.cli)(?=[\s;&|()`'\"]|$)")
_APPROVE_RE = re.compile(r"(?:^|[\s;&|()`$'\"])approve(?=[\s;&|()`'\"]|$)")


def runs_approve(cmd: str, words: list[str]) -> bool:
    """True when `cmd` runs the kit CLI's `approve` (a gate is the owner's, never a subagent's). Parsed words are
    checked when the command parses (so a commit message that mentions `bay approve` is fine); otherwise the raw
    text."""
    if words:
        cli = [i for i, w in enumerate(words)
               if os.path.basename(w) in ("bay", "bay.sh", "cli.py") or w == "bay.cli"]
        return bool(cli) and "approve" in words[cli[0] + 1:]
    return bool(_CLI_RE.search(cmd) and _APPROVE_RE.search(cmd))


def dequote(cmd: str) -> str:
    """The command text with quotes and backslashes removed: what the shell would join (`.agent''bay`)."""
    return re.sub(r"['\"\\]", "", cmd)


def names_config(cmd: str, words: list[str], at_root) -> bool:
    """True when `cmd` names agentbay.config.yaml, directly or by a glob in the project root (`at_root(dir)`)
    that matches it. Quotes and backslashes are removed first (`agentbay.conf''ig.yaml` is the same file), and a
    command that does not parse is judged on that text alone: anything containing `agentbay.conf` is denied."""
    if CONFIG_FILE.casefold()[:len("agentbay.conf")] in dequote(cmd).casefold():
        return True
    if any(os.path.basename(w).casefold() == CONFIG_FILE.casefold() for w in words):
        return True
    toks = words or re.split(r"[\s;&|<>()`'\"]+", cmd)
    return any(any(c in w for c in "*?[{") and at_root(os.path.dirname(w)) and any(
        fnmatch.fnmatch(CONFIG_FILE, x.casefold()) for x in _expand_braces(os.path.basename(w).casefold()))
        for w in toks if w)


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
        if self.kit and self.kit != self.project and self.inside(p, self.kit):
            return "the agentbay kit is not writable by agents"   # outside or nested inside the project
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
            return self._bash(entry, who, ti.get("command", ""), cwd, agent)
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

    def _bash(self, entry, who, command, cwd, agent=None) -> tuple[str, str]:
        why, words = self._parse_command(command)
        d = self._owner_only(who, command, words, cwd)
        if d:
            return d
        if entry is None:
            return self._bash_outside_role(who, command, why, words, cwd)
        return self._bash_in_role(entry, who, why, words, cwd, agent)

    @staticmethod
    def _parse_command(command) -> tuple[str, list]:
        """(why the command is unsafe or unparsable, or a falsy value; its words, empty when there is a `why`)."""
        why = unsafe(command)
        if why:
            return why, []
        try:
            return why, shlex.split(command)
        except ValueError as e:
            return f"cannot parse command ({e})", []

    def _owner_only(self, who, command, words, cwd) -> tuple[str, str] | None:
        """Denies for anyone, role or not: `bay approve` and the owner's config file are the owner's."""
        if runs_approve(command, words):
            return "deny", (f"agentbay: {who} may not run `bay approve`: approval gates are the owner's (a terminal, "
                            f"or a chat approval the main thread relays)")
        if names_config(command, words, lambda d: norm(d or ".", cwd) == self.project):
            return "deny", f"agentbay: {who} may not name {CONFIG_FILE} in a command (the owner's settings)"
        return None

    def _bash_outside_role(self, who, command, why, words, cwd) -> tuple[str, str]:
        """Not an agentbay role: off the control plane by path, glob and interpreter -c (S-B)."""
        if why:
            return ("deny", f"agentbay: {who}: {why} (in a command that mentions .agentbay/.claude)") \
                if any(c in dequote(command).casefold() for c in CONTROL) else ("pass", "")
        d = self._words(who, words, cwd)
        return d or ("pass", "")

    def _bash_in_role(self, entry, who, why, words, cwd, agent) -> tuple[str, str]:
        """An agentbay role may run only its shim, `bay plan` and its approved CLI prefixes."""
        if why:
            return "deny", f"agentbay: {who}: {why}"
        if not words:
            return "deny", f"agentbay: {who}: empty command"
        d = self._shim_command(entry, who, words, cwd)
        if d:
            return d
        if len(words) > 1 and words[1] == "plan" and norm(words[0], cwd) == self.agentbay / "bay":
            return self._plan_command(who, words, agent)
        d = self._cli_command(entry, who, words, cwd)
        return d or self._deny_unlisted(entry)

    def _shim_command(self, entry, who, words, cwd) -> tuple[str, str] | None:
        """The decision for a call of the role's use shim; None when the command is not the shim."""
        shim = entry.get("shim")
        if not (shim and norm(words[0], cwd) == norm(shim, self.project)):
            return None
        flag = next((w for w in words[1:] if w.startswith("-")), None)
        if flag is not None:
            return "deny", f"agentbay: the use shim takes no flags (got {flag})"
        if self.policy.get("autoAllowShim", False):    # old or missing policy: prompt (fail closed)
            return "allow", ""         # the ONLY auto-allow: the role's own read-only data shim
        return "pass", ""              # kit inside the project: roles might edit code the shim runs; prompt

    def _cli_command(self, entry, who, words, cwd) -> tuple[str, str] | None:
        """The decision for a command under one of the role's approved CLI prefixes; None when under none."""
        for prefix in entry.get("clis", []):
            pw = shlex.split(prefix)
            if words[: len(pw)] == pw:
                return self._prefixed_command(entry, who, words, cwd, pw)
        return None

    def _prefixed_command(self, entry, who, words, cwd, pw) -> tuple[str, str]:
        d = self._words(who, words, cwd, first=len(pw))
        if d:
            return d
        if pw[0] == "git":
            d = self._git_command(entry, words, cwd, len(pw))
            if d:
                return d
        return "pass", ""              # never auto-allowed: Claude Code's normal permission prompt applies

    def _git_command(self, entry, words, cwd, first) -> tuple[str, str] | None:
        """Denies for git flags that write or read files or run programs, and for an unsafe `worktree add`."""
        bad = [w for w in words[first:] if w.startswith(GIT_BAD_FLAGS)]
        if bad:
            return "deny", f"agentbay: git flag {bad[0]} is not allowed (it writes or reads files or runs programs)"
        if words[1:3] == ["worktree", "add"]:
            return self._worktree_add(entry, words[3:], cwd)
        return None

    @staticmethod
    def _deny_unlisted(entry) -> tuple[str, str]:
        shim = entry.get("shim")
        allowed = ([shim] if shim else []) + entry.get("clis", [])
        return "deny", (f"agentbay: role {entry['role']} may only run: {', '.join(allowed) or 'nothing'} via Bash"
                        + (f". Use `{shim} <capability>/v<N>.<endpoint> '<json>'` for data." if shim else "."))

    def _plan_command(self, who, words, agent) -> tuple[str, str]:
        """`bay plan <taskId> '<json>'` or `bay plan <taskId> --done <n>`: the one `bay` command an agentbay subagent
        may run. It only appends to the ledger, and only for the taskId the ledger shows was dispatched to this
        agent; any other shape of the command is denied."""
        shape = len(words) == 4 or (len(words) == 5 and words[3] == "--done")
        if not shape or (len(words) == 4 and words[3].startswith("-")) or not re.match(r"^T-[0-9]{8}-[0-9a-z]{4}$", words[2]):
            return "deny", (f"agentbay: {who}: `bay plan` takes exactly `<taskId> '<json>'` or `<taskId> --done <n>`")
        disp = None                     # stdlib only (this runs as a standalone hook): the ledger's latest record
        try:
            for line in (self.agentbay / "ledger" / "events.jsonl").read_text(encoding="utf-8").split("\n"):
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(e, dict) and e.get("taskId") == words[2] and e.get("type") in ("agent.dispatch", "spawned"):
                    disp = e
        except OSError:
            pass
        if disp is None or disp.get("agent") != agent:
            return "deny", f"agentbay: {who}: `bay plan` takes only the taskId this agent was dispatched with"
        return ("allow", "") if self.policy.get("autoAllowShim", False) else ("pass", "")

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


def record_denial(project: Path, payload: dict, reason: str) -> None:
    """permission.denied ledger event (tool, agent, reason; never the command). Never raises: the decision
    stands regardless; a failure is appended to .agentbay/ledger/hook-errors.log."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from bay import ledger, secretscan
        reason = secretscan.scrub(reason or "denied")[:300]      # scrub first, then cut
        ledger.append(project, "permission.denied", payload.get("agent_id") or payload.get("session_id") or "guard",
                      source="guard", agent=payload.get("agent_type"), sessionId=payload.get("session_id"),
                      tool=payload.get("tool_name"), reason=reason)
    except Exception as e:  # the guard's decision must not depend on the ledger
        try:
            with open(project / ".agentbay" / "ledger" / "hook-errors.log", "a") as f:
                f.write(f"guard: permission.denied not recorded ({type(e).__name__})\n")
        except OSError:
            pass


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
            record_denial(project, payload, reason)
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
