#!/usr/bin/env python3
"""PreToolUse guard: per-role scope for agentbay subagents; stdlib only, runs as a hook."""
from __future__ import annotations

import contextlib
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
NEVER_SEARCHED = (".agentbay", ".claude")
NEVER_DIRS = (".agentbay", ".claude", ".git", ".vscode", ".idea")
NEVER_FILES = ("CLAUDE.md", "CLAUDE.local.md", ".mcp.json", "agentbay.config.yaml", ".envrc", "Makefile", "bay.sh")
NEVER_PREFIXES = (".env",)
NEVER_SEQS = ((".github", "workflows"),)
GIT_O_CLUSTER = re.compile(r"-[A-FH-RT-Za-z]*O")
GIT_BAD_FLAGS = ("--output", "--ext-diff", "--textconv", "--no-index", "--exec", "--upload-pack",
                 "--receive-pack", "--config", "--git-dir", "--work-tree", "--open-files-in-pager",
                 "--pathspec-from-file", "-O")
GIT_MV_RM_FLAGS = ("-r", "-f", "-n", "-q", "-k", "-v", "--cached", "--dry-run", "--force", "--quiet")
LINT_CONFIG = {"ruff": ("--config", "ruff.toml"), "mypy": ("--config-file", "mypy.ini")}
LINT_FLAGS = ("--no-cache", "--ignore-noqa", "--statistics", "--strict", "--show-error-codes")
LINT_CONFIG_DIR = Path("components") / "python"


def abbrev(word: str, flags: tuple[str, ...]) -> bool:
    """True when `word` shortens a long option in `flags`: git and argparse accept `--pathspec-fr`."""
    name = word.split("=", 1)[0]
    return len(name) > 2 and name.startswith("--") and any(f.startswith(name) for f in flags)


INTERPRETERS = ("sh", "bash", "zsh", "dash", "ksh", "fish", "node", "perl", "ruby", "php", "deno", "bun")
EVAL_FLAGS = ("-c", "-e", "--eval", "-E", "-r")
PROBES = (".agentbay/guard.json", ".agentbay/bay", ".agentbay/roles/role/use",
          ".agentbay/data/feeds/feed-briefing/corpus.db", ".agentbay/data/feeds/feed-briefing/corpus.db-wal",
          ".agentbay/calls/C-0.json", ".agentbay/ledger/events.jsonl",
          ".claude/settings.json", ".claude/settings.local.json", ".claude/agents/agent.md")


APPROVE_FROM_FILE = "agentbay.config.yaml"
_KIT_CLI_RE = re.compile(r"(?:^|[\s;&|()`$'\"])(?:\S*/)?(?:bay|bay\.sh|cli\.py|bay\.cli)(?=[\s;&|()`'\"]|$)")
_APPROVE_RE = re.compile(r"(?:^|[\s;&|()`$'\"])approve(?=[\s;&|()`'\"]|$)")


def runs_approve(cmd: str, words: list[str]) -> bool:
    """True when `cmd` runs the kit CLI's `approve`, which is the owner's gate and never a subagent's."""
    if words:
        cli = [i for i, w in enumerate(words)
               if os.path.basename(w) in ("bay", "bay.sh", "cli.py") or w == "bay.cli"]
        return bool(cli) and "approve" in words[cli[0] + 1:]
    return bool(_KIT_CLI_RE.search(cmd) and _APPROVE_RE.search(cmd))


ASK_VERBS = {"note": ("dispatch", "review"), "show": ("reclaim", "close")}
ASK_VERB_EXPANSIONS = "{$`\n"


def _launcher_end(words: list[str], i: int) -> int | None:
    """The index after the kit CLI launcher that starts at words[i] (`./bay.sh`, `python3 -m bay.cli`), else None."""
    base = os.path.basename(words[i])
    if base in ("bay", "bay.sh", "cli.py"):
        return i + 1
    if base.startswith("python") and words[i + 1:i + 3] == ["-m", "bay.cli"]:
        return i + 3
    return None


def split_on_operators(raw: list[str]) -> list[str]:
    """Split shell words at their operators, which glue to words (`x;.agentbay/bay`)."""
    return [t for w in raw for t in re.split(r"[;&|<>(){}`$\n\r]+", w) if t]


def asked_bay_write(cmd: str) -> str | None:
    """The asked kit command (`note dispatch`, `show close`, ...) that `cmd` runs, judged on shell words, else None."""
    try:
        raw = shlex.split(cmd)
    except ValueError:
        raw = dequote(cmd).split()
    words = raw
    if unsafe(cmd):
        words = split_on_operators(raw)
    for verb, sub in _launcher_calls(words):
        if sub in ASK_VERBS.get(verb, ()):
            return f"{verb} {sub}"
    for verb, sub in _launcher_calls(raw):
        if verb in ASK_VERBS and any(c in sub for c in ASK_VERB_EXPANSIONS):
            return f"{verb} <word with an expansion>"
    return None


def _launcher_calls(words: list[str]):
    """(verb, word after the verb) for every kit CLI launcher in `words`, after its global options."""
    for i in range(len(words)):
        j = _launcher_end(words, i)
        if j is None:
            continue
        while j < len(words) and words[j].startswith("-"):
            w = words[j]
            j += 2 if len(w) >= 3 and "=" not in w and "--project".startswith(w) else 1
        if j < len(words) and words[j] in ASK_VERBS:
            yield words[j], (words[j + 1] if j + 1 < len(words) else "")


def main_thread_decision(payload: dict) -> tuple[str, str]:
    """('ask'|'pass', reason) for a call from the main thread: only the kit's logging writes are asked."""
    if payload.get("tool_name") == "Bash":
        hit = asked_bay_write((payload.get("tool_input") or {}).get("command", "") or "")
        if hit:
            return "ask", f"agentbay: `bay {hit}` records a decision in the ledger; confirm it"
    return "pass", ""


def dequote(cmd: str) -> str:
    """The command text with quotes and backslashes removed: what the shell would join (`.agent''bay`)."""
    return re.sub(r"['\"\\]", "", cmd)


def names_config(cmd: str, words: list[str], at_root) -> bool:
    """True when `cmd` names the owner's config file, directly or by a glob in the project root that matches it."""
    if APPROVE_FROM_FILE.casefold()[:len("agentbay.conf")] in dequote(cmd).casefold():
        return True
    if any(os.path.basename(w).casefold() == APPROVE_FROM_FILE.casefold() for w in words):
        return True
    toks = words or re.split(r"[\s;&|<>()`'\"]+", cmd)
    return any(any(c in w for c in "*?[{") and at_root(os.path.dirname(w)) and any(
        fnmatch.fnmatch(APPROVE_FROM_FILE, x.casefold()) for x in _expand_braces(os.path.basename(w).casefold()))
        for w in toks if w)


def unsafe(cmd: str) -> str | None:
    """Return why `cmd` is not a single simple command, or None."""
    single = double = False
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if c == "\\" and not single:
            if cmd[i + 1:i + 2] in ("\n", "\r"):
                return "backslash-newline line continuation is not allowed; write the command on one line"
            i += 2
            continue
        if c == "'" and not double:
            single = not single
        elif c == '"' and not single:
            double = not double
        elif not single and c in "`$":
            return "shell expansion ($ or `) is not allowed"
        elif c == "#" and not single and not double and (i == 0 or cmd[i - 1] in " \t"):
            return "shell comment # is not allowed; run one command at a time"
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
    return p.is_relative_to(root)


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

    def _fold(self, p: Path) -> str:
        return str(p).casefold() if self.ci else str(p)

    def inside(self, p: Path, root: Path) -> bool:
        """True when p is root or below it, by path (case-folded where needed) or by device and inode identity."""
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
            return "the agentbay kit is not writable by agents"
        return None

    def decide(self, payload: dict) -> tuple[str, str]:
        """('allow'|'deny'|'pass', reason)"""
        agent = payload.get("agent_type")
        entry = self.policy.get("subagents", {}).get(agent) if agent else None
        if entry is None and not payload.get("agent_id"):
            return main_thread_decision(payload)
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
        if under(self.project, root):
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
            words = shlex.split(command)
        except ValueError as e:
            return f"cannot parse command ({e})", []
        if any("\n" in w or "\r" in w for w in words):
            return "a newline inside a word is not allowed; write the command on one line", []
        return why, words

    def _owner_only(self, who, command, words, cwd) -> tuple[str, str] | None:
        """Denies for anyone, role or not: `bay approve` and the owner's config file are the owner's."""
        if runs_approve(command, words):
            return "deny", (f"agentbay: {who} may not run `bay approve`: approval gates are the owner's (a terminal, "
                            f"or a chat approval the main thread relays)")
        if names_config(command, words, lambda d: norm(d or ".", cwd) == self.project):
            return "deny", f"agentbay: {who} may not name {APPROVE_FROM_FILE} in a command (the owner's settings)"
        return None

    def _bash_outside_role(self, who, command, why, words, cwd) -> tuple[str, str]:
        """Not an agentbay role: off the control plane by path, glob and interpreter -c (S-B)."""
        if why:
            return ("deny", f"agentbay: {who}: {why} (in a command that mentions .agentbay/.claude)") \
                if any(c in dequote(command).casefold() for c in NEVER_SEARCHED) else ("pass", "")
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
        if self.policy.get("autoAllowShim", False):
            return "allow", ""
        return "pass", ""

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
        if pw[:3] == ["python3", "-I", "-m"] and pw[3] in LINT_CONFIG:
            d = self._lint_command(words, cwd, len(pw), pw[3])
            if d:
                return d
        writes = pw == ["./bay.sh", "check"] and any(abbrev(w, ("--write",)) for w in words[2:])
        if writes and (why := self._write_denied(entry, self.project / "framework/limits.yaml")):
            return "deny", f"agentbay: check --write rewrites framework/limits.yaml: {why}"
        return "pass", ""

    def _lint_command(self, words: list[str], cwd: Path, first: int, tool: str) -> tuple[str, str] | None:
        """Denies ruff or mypy unless it names the kit's protected config once and uses only LINT_FLAGS."""
        flag, name = LINT_CONFIG[tool]
        config = self.kit / LINT_CONFIG_DIR / name if self.kit else None
        outside = config is not None and self.kit != self.project and not self.inside(config, self.project)
        if config is None or not (outside or any(self.inside(config, self.project / d)
                                                 for d in self.policy.get("protected", []))):
            return "deny", f"agentbay: {tool} needs the kit's {name} in a protected path; it is not protected here"
        rest, given = words[first:], []
        for i, word in enumerate(rest):
            if word.startswith("@"):
                return "deny", f"agentbay: {tool} argument files (@file) are not allowed"
            if any(c in word for c in "?*[]"):
                return "deny", f"agentbay: {tool} globs are not allowed; name each path"
            if word == flag:
                given.append(norm(rest[i + 1], cwd) if i + 1 < len(rest) else None)
            elif word.startswith("-") and word not in LINT_FLAGS and (i == 0 or rest[i - 1] != flag):
                return "deny", f"agentbay: {tool} flag {word} is not allowed (only {flag} and {' '.join(LINT_FLAGS)})"
        if given != [config]:
            return "deny", f"agentbay: {tool} needs exactly one `{flag} {config}`"
        return None

    def _git_command(self, entry, words, cwd, first) -> tuple[str, str] | None:
        """Denies for git flags that write or read files or run programs, and for an unsafe `worktree add`."""
        for word in words[first:]:
            if word.startswith(GIT_BAD_FLAGS) or abbrev(word, GIT_BAD_FLAGS) or GIT_O_CLUSTER.match(word):
                return "deny", f"agentbay: git flag {word} is not allowed (it writes or reads files or runs programs)"
        if words[1:3] == ["worktree", "add"]:
            return self._worktree_add(entry, words[3:], cwd)
        if words[1] in ("mv", "rm"):
            return self._git_mv_rm(entry, words, cwd)
        return None

    def _git_mv_rm(self, entry, words, cwd) -> tuple[str, str] | None:
        """Denies a `git mv` or `git rm` with a flag outside GIT_MV_RM_FLAGS, or a path the role may not write."""
        verb = words[1]
        cut = words.index("--") if "--" in words else len(words)
        options = [w for w in words[2:cut] if w.startswith("-")]
        paths = [w for w in words[2:cut] if not w.startswith("-")] + words[cut + 1:]
        for option in options:
            if option not in GIT_MV_RM_FLAGS:
                return "deny", f"agentbay: git {verb} {option}: only {' '.join(GIT_MV_RM_FLAGS)} are allowed"
        for path in paths:
            reason = self._git_path_denied(entry, path, cwd)
            if reason:
                return "deny", f"agentbay: git {verb} {path}: {reason}"
        return None

    def _git_path_denied(self, entry, a, cwd) -> str | None:
        """Why the role may not write `a` or a never-written or protected path inside it (`git rm -r .`), or None."""
        if a.startswith(":") or any(c in a for c in "*?[\\"):
            return "git pathspec magic and globs are not allowed; name each path"
        target = norm(a, cwd)
        held = (*NEVER_DIRS, *NEVER_FILES, *map("/".join, NEVER_SEQS), *self.policy.get("protected", []))
        for path in [target, *(self.project / h for h in held)]:
            if self.inside(path, target):
                reason = self.never_write(path) or self._write_denied(entry, path)
                if reason:
                    return reason
        return None

    @staticmethod
    def _deny_unlisted(entry) -> tuple[str, str]:
        shim = entry.get("shim")
        allowed = ([shim] if shim else []) + entry.get("clis", [])
        return "deny", (f"agentbay: role {entry['role']} may only run: {', '.join(allowed) or 'nothing'} via Bash"
                        + (f". Use `{shim} <capability>/v<N>.<endpoint> '<json>'` for data." if shim else "."))

    def _plan_command(self, who, words, agent) -> tuple[str, str]:
        """The one `bay` command a subagent may run: `bay plan <taskId> '<json>'` or `--done <n>`, for its task."""
        shape = len(words) == 4 or (len(words) == 5 and words[3] == "--done")
        task_id_ok = re.match(r"^T-[0-9]{8}-[0-9a-z]{4}$", words[2])
        if not shape or (len(words) == 4 and words[3].startswith("-")) or not task_id_ok:
            return "deny", (f"agentbay: {who}: `bay plan` takes exactly `<taskId> '<json>'` or `<taskId> --done <n>`")
        disp = None
        try:
            for line in (self.agentbay / "ledger" / "events.jsonl").read_text(encoding="utf-8").split("\n"):
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                dispatched = e.get("type") in ("agent.dispatch", "spawned") if isinstance(e, dict) else False
                if dispatched and e.get("taskId") == words[2]:
                    disp = e
        except OSError:
            pass
        if disp is None or disp.get("agent") != agent:
            return "deny", f"agentbay: {who}: `bay plan` takes only the taskId this agent was dispatched with"
        return ("allow", "") if self.policy.get("autoAllowShim", False) else ("pass", "")

    def _words(self, who, words, cwd, first: int = 0) -> tuple[str, str] | None:
        """Denies inline interpreter code in any word, and control-plane paths or globs in the words from `first` on."""
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
            if os.path.isabs(a) or not under(norm(a, cwd), self.project):
                return "deny", "agentbay: git worktree add needs a relative path inside the project"
            why = self._git_path_denied(entry, a, cwd)
            return ("deny", f"agentbay: git worktree add {a}: {why}") if why else None
        return None

    def _touches_control_plane(self, word: str, cwd: Path) -> bool:
        if "/" not in word and word.casefold() not in (".agentbay", ".claude", "bay.sh"):
            return False
        p = norm(word, cwd)
        if self.inside(p, self.agentbay) or self.inside(p, self.project / ".claude"):
            return True
        if self.kit and p in (self.kit / "bay.sh", self.kit / "bay" / "cli.py"):
            return True
        return False


def _ledger_reason(reason: str) -> str:
    """Scrub the reason of secrets, then cut it to 300 characters, in that order."""
    from bay import secretscan
    return secretscan.scrub(reason or "denied")[:300]


def _touch_seen(project: Path) -> None:
    """Mark the hook as seen; never raises, never follows a symlink."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
    with contextlib.suppress(OSError):
        with os.fdopen(os.open(project / ".agentbay/ledger/guard.seen", flags, 0o644), "w") as seen:
            os.utime(seen.fileno())


def record_denial(project: Path, payload: dict, reason: str) -> None:
    """Ledger a denial; never raises, so no decision depends on the ledger."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from bay import ledger
        reason = _ledger_reason(reason)
        ledger.append(project, "permission.denied", payload.get("agent_id") or payload.get("session_id") or "guard",
                      source="guard", agent=payload.get("agent_type"), sessionId=payload.get("session_id"),
                      tool=payload.get("tool_name"), reason=reason)
    except Exception as e:
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
        project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        _touch_seen(project)
        if not subagent:
            decision, reason = main_thread_decision(payload)
            if decision == "ask":
                _emit("ask", reason)
            return 0
        policy = json.loads((project / POLICY).read_text())
        decision, reason = Guard(policy, project).decide(payload)
        if decision == "deny":
            record_denial(project, payload, reason)
            print(reason, file=sys.stderr)
            _emit("deny", reason)
            return 2
        if decision in ("allow", "ask"):
            _emit(decision, reason if decision == "ask" else "")
        return 0
    except Exception as e:
        if subagent:
            msg = f"agentbay guard error ({type(e).__name__}); denied for subagent. Rebuild with ./bay.sh build"
            print(msg, file=sys.stderr)
            _emit("deny", msg)
            return 2
        return 0


if __name__ == "__main__":
    sys.exit(main())
