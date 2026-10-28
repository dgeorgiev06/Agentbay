"""Claude Code session transcripts -> redacted session.episode/v1 (read-only).

The on-disk format is NOT a stable API (docs/research/claude-code-transcripts.md), so:
  * stream line by line; any line that fails to parse or to fold (bad JSON, too deep, too long, an unexpected
    shape) is counted as a bad line and skipped - one record never fails a scan, and no line is ever echoed
  * dispatch on top-level `type` against an allowlist; unknown types are counted (by name only if the name
    looks like a record type, else as "other")
  * read only the fields needed, with defaults; never validate against a closed schema
  * structure and metadata only, always: counts, tool names, input hashes, durations, error flags, tokens,
    model. No free text is kept, ever. Text is read in memory only to classify it (interrupt, status question,
    environment gap) and then dropped.
  * symlinks are never followed: symlinked files and folders are skipped and every path must stay under the root
  * no cache: files whose mtime is older than the window start are skipped without being opened
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import short_hash

KNOWN = {"user", "assistant", "attachment", "system", "queue-operation", "last-prompt", "mode", "pr-link",
         "tools-used", "cost-state", "progress", "file-history-snapshot", "summary", "custom-title", "tag"}
TYPE_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
INTERRUPT = re.compile(r"^\s*\[request interrupted by user", re.I)
COMPACTED = "this session is being continued from a previous conversation that ran out of context"
# a short user turn that only asks where things stand
STATUS_Q = re.compile(r"^\s*(status|progress|update|eta)\??\s*$|^\s*(any )?(status|progress|update)s?\b.{0,30}\?\s*$|"
                      r"^\s*(how('?s| is) it going|where are (we|you)( at)?|are you (done|finished|still working)|"
                      r"(is it|are you) done( yet)?|what'?s the status|how far along|still (working|there))\b.{0,30}\??\s*$",
                      re.I)
STATUS_MAX_CHARS = 80
# tool errors that point at the environment, not the task
ENV_GAPS = [
    ("command-not-found", re.compile(r"command not found|: not found\b|No such file or directory: '?[\w./-]+'? *\(?(exec|spawn)|"
                                     r"is not recognized as an internal or external command", re.I)),
    ("missing-module", re.compile(r"ModuleNotFoundError|No module named|Cannot find module|ImportError", re.I)),
    ("network-blocked", re.compile(r"Could not resolve host|Name or service not known|Temporary failure in name resolution|"
                                   r"Connection refused|Network is unreachable|getaddrinfo|ENOTFOUND|ECONNREFUSED|"
                                   r"proxy.*(403|407)|blocked by (the )?(sandbox|network policy)", re.I)),
    ("sandbox-denied", re.compile(r"Operation not permitted|Permission denied|EACCES|EPERM|Read-only file system|"
                                  r"sandbox", re.I)),
]
SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")
SUBAGENT_TOOLS = ("Agent", "Task")
MAX_LINE_BYTES = 4_000_000          # longer lines are skipped and counted (huge pastes, corruption)


def _name(v, default: str = "?") -> str:
    """A tool/model name is kept only if it looks like a name (never free text)."""
    return v if isinstance(v, str) and SAFE_NAME.match(v) else default


def _id(v: str) -> str:
    """Session/agent ids (uuids, hex) are kept as is; anything else is hashed."""
    return v if SAFE_ID.match(v) else short_hash(v)


def _ts(v) -> str | None:
    if not isinstance(v, str):
        return None
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return v


def _ms_between(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    try:
        da = datetime.fromisoformat(a.replace("Z", "+00:00"))
        db = datetime.fromisoformat(b.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, int((db - da).total_seconds() * 1000))


def _text_of(content) -> str:
    """Plain text of a tool_result content (string or text blocks), for classification only."""
    if isinstance(content, str):
        return content[:20_000]
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and isinstance(b.get("text"), str))[:20_000]
    return ""


def env_gap(text: str) -> str | None:
    for kind, rx in ENV_GAPS:
        if rx.search(text):
            return kind
    return None


@dataclass
class _Acc:
    """Accumulates one transcript file (a session or a subagent) into an episode."""
    start: str | None = None
    end: str | None = None
    cwd: str | None = None
    version: str | None = None
    entrypoint: str | None = None
    models: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)          # message.id -> last usage
    calls: dict = field(default_factory=dict)          # tool_use id -> call
    order: list = field(default_factory=list)
    subagents: dict = field(default_factory=dict)      # tool_use id -> {type, finished}
    turns: int = 0
    interrupts: int = 0
    status_questions: int = 0
    queued: int = 0
    prompts: int = 0
    compaction: int = 0
    env_gaps: dict = field(default_factory=dict)
    hook_ms: int = 0
    hook_errors: int = 0
    cost: dict | None = None
    unknown: dict = field(default_factory=dict)
    bad_lines: int = 0
    records: int = 0


def _user_text(acc: _Acc, text: str, is_meta: bool) -> None:
    if INTERRUPT.match(text):
        acc.interrupts += 1
        return
    if text.strip().lower().startswith(COMPACTED):
        acc.compaction += 1
        return
    if not is_meta:
        acc.turns += 1
        if len(text) <= STATUS_MAX_CHARS and STATUS_Q.search(text):
            acc.status_questions += 1


def _record(acc: _Acc, rec: dict) -> None:
    t = rec["type"]
    ts = _ts(rec.get("timestamp"))
    if ts:
        acc.start = min(acc.start or ts, ts)
        acc.end = max(acc.end or ts, ts)
    if acc.cwd is None and isinstance(rec.get("cwd"), str):
        acc.cwd = rec["cwd"]
    v = rec.get("version")
    if acc.version is None and isinstance(v, str) and len(v) <= 40 and SAFE_ID.match(v):
        acc.version = v
    if acc.entrypoint is None and isinstance(rec.get("entrypoint"), str):
        acc.entrypoint = _name(rec["entrypoint"], None)
    if rec.get("isCompactSummary") is True:
        acc.compaction += 1
    if t == "user":
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
        content = msg.get("content")
        meta = rec.get("isMeta") is True
        tur = rec.get("toolUseResult") if isinstance(rec.get("toolUseResult"), dict) else {}
        if tur.get("interrupted") is True:
            acc.interrupts += 1
        pd = rec.get("permissionDecision") if isinstance(rec.get("permissionDecision"), dict) else {}
        if "user" in str(pd.get("source", "")).lower():
            acc.prompts += 1
        denied = bool(rec.get("toolDenialKind"))
        if isinstance(content, str):
            _user_text(acc, content, meta)
        elif isinstance(content, list):
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and isinstance(b.get("text"), str):
                    _user_text(acc, b["text"], meta)
                elif b.get("type") == "tool_result" and isinstance(b.get("tool_use_id"), str):
                    call = acc.calls.get(b["tool_use_id"])
                    if call is None:
                        continue
                    is_err = b.get("is_error") is True
                    call["error"] = call["error"] or is_err
                    call["denied"] = call["denied"] or (denied and is_err)
                    if is_err and not denied:
                        gap = env_gap(_text_of(b.get("content")) + " " + str(tur.get("stderr", ""))[:5000])
                        if gap:
                            acc.env_gaps[gap] = acc.env_gaps.get(gap, 0) + 1
                    sub = acc.subagents.get(b["tool_use_id"])
                    if sub is not None:
                        sub["finished"] = tur.get("status") in ("completed", "done", "success") or sub["finished"]
                        if isinstance(tur.get("agentId"), str):
                            sub["agentId"] = _id(tur["agentId"].removeprefix("agent-"))
    elif t == "assistant":
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
        mid = msg.get("id") if isinstance(msg.get("id"), str) else f"rec{acc.records}"
        if isinstance(msg.get("model"), str):
            m = _name(msg["model"])
            acc.models[m] = acc.models.get(m, 0) + 1
        if isinstance(msg.get("usage"), dict):
            acc.usage[mid] = msg["usage"]                 # one response is split across records: last usage wins
        content = msg.get("content")
        for b in content if isinstance(content, list) else []:
            if isinstance(b, dict) and b.get("type") == "tool_use" and isinstance(b.get("id"), str):
                name = _name(b.get("name"))
                call = {"name": name, "inputHash": short_hash(b.get("input")), "error": False, "denied": False}
                acc.calls[b["id"]] = call
                acc.order.append(call)
                if name in SUBAGENT_TOOLS:
                    inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                    acc.subagents[b["id"]] = {"type": _name(inp.get("subagent_type"), "general-purpose"),
                                              "finished": False}
    elif t == "queue-operation":
        if rec.get("operation") == "enqueue":           # the user typed while the agent was working
            acc.queued += 1
    elif t == "system":
        st = rec.get("subtype")
        if st == "stop_hook_summary":
            infos = rec.get("hookInfos")
            for h in infos if isinstance(infos, list) else []:
                if isinstance(h, dict) and isinstance(h.get("durationMs"), (int, float)):
                    acc.hook_ms += int(h["durationMs"])
            errs = rec.get("hookErrors")
            acc.hook_errors += len(errs) if isinstance(errs, list) else 0
        elif isinstance(st, str) and "compact" in st:
            acc.compaction += 1
    elif t == "cost-state":
        acc.cost = rec                                     # running snapshot: the last one wins


def _count(v) -> bool:
    """A usable non-negative, finite number (JSON allows 1e999 / Infinity / NaN; bool is not a count)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v < 1e15


def _tokens(acc: _Acc) -> dict:
    out = {"input": 0, "output": 0, "cacheRead": 0, "cacheCreation": 0}
    for u in acc.usage.values():
        for k, src in (("input", "input_tokens"), ("output", "output_tokens"),
                       ("cacheRead", "cache_read_input_tokens"), ("cacheCreation", "cache_creation_input_tokens")):
            v = u.get(src)
            if _count(v):
                out[k] += int(v)
    out["total"] = sum(out.values())
    return out


def _episode(acc: _Acc, eid: str, kind: str, project_hash: str | None) -> dict:
    tool_calls = [dict(c) for c in acc.order]
    ep = {"id": eid, "source": "claude-transcripts", "kind": kind, "start": acc.start, "end": acc.end,
          "durationMs": _ms_between(acc.start, acc.end), "tokens": _tokens(acc),
          "steps": [], "toolCalls": tool_calls,
          "errors": sum(1 for c in tool_calls if c["error"]),
          "denials": [{"tool": c["name"]} for c in tool_calls if c["denied"]],
          "permissionPrompts": acc.prompts, "interrupts": acc.interrupts, "instructionChanges": acc.queued,
          "statusQuestions": acc.status_questions, "envGaps": dict(acc.env_gaps),
          "turns": acc.turns, "compaction": acc.compaction or "not-detected",
          "subagents": [{"id": s.get("agentId") or tid[-12:], "type": s["type"], "finished": s["finished"]}
                        for tid, s in acc.subagents.items()],
          "meta": {"version": acc.version, "entrypoint": acc.entrypoint, "records": acc.records,
                   "badLines": acc.bad_lines, "unknownRecordTypes": dict(acc.unknown),
                   "hookMs": acc.hook_ms, "hookErrors": acc.hook_errors}}
    if acc.models:
        ep["model"] = max(acc.models, key=acc.models.get)
    if project_hash:
        ep["project"] = project_hash
    if acc.cost:
        c = acc.cost
        if _count(c.get("totalCostUSD")):
            ep["costUsd"] = round(float(c["totalCostUSD"]), 6)
        if _count(c.get("totalDuration")):
            ep["durationMs"] = int(c["totalDuration"])
    if not ep["envGaps"]:
        ep.pop("envGaps")
    ep["meta"] = {k: v for k, v in ep["meta"].items() if v not in (None, {}, 0)}
    return {k: v for k, v in ep.items() if v is not None}


def parse_stream(lines) -> _Acc:
    """Fold lines (str or bytes) into an accumulator. Never raises for content: every failure is a bad line."""
    acc = _Acc()
    for raw in lines:
        if len(raw) > MAX_LINE_BYTES:
            acc.bad_lines += 1
            continue
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", "replace")
        if not raw.strip():
            continue
        try:
            rec = json.loads(raw)
        except (ValueError, RecursionError, MemoryError):
            acc.bad_lines += 1                 # half-written last line of a live session, too deep, corrupt
            continue
        if not isinstance(rec, dict):
            acc.bad_lines += 1
            continue
        t = rec.get("type")
        if not isinstance(t, str) or t not in KNOWN:
            key = t if isinstance(t, str) and TYPE_NAME.match(t) else "other"
            acc.unknown[key] = acc.unknown.get(key, 0) + 1
            acc.records += 1
            continue
        try:
            _record(acc, rec)
            acc.records += 1
        except Exception:                      # a known type with a shape we did not expect: count it, keep going
            acc.bad_lines += 1
    return acc


def _lines(path: Path):
    with open(path, "rb") as f:
        while True:
            raw = f.readline(MAX_LINE_BYTES + 1)
            if not raw:
                return
            if len(raw) > MAX_LINE_BYTES and not raw.endswith(b"\n"):
                while raw and not raw.endswith(b"\n"):     # drain the rest of the oversized line
                    raw = f.readline(MAX_LINE_BYTES + 1)
                yield b"x" * (MAX_LINE_BYTES + 1)          # counted as oversized, content never kept
                continue
            yield raw


def _real(p: str) -> str:
    return os.path.realpath(os.path.expanduser(p))


def safe_file(path: Path, root: Path) -> bool:
    """A regular file, not a symlink, with no symlinked parent below root, resolving under root."""
    try:
        rel = path.relative_to(root)
    except ValueError:
        return False
    cur = root
    for part in rel.parts:
        cur = cur / part
        if cur.is_symlink():
            return False
    try:
        return path.is_file() and Path(os.path.realpath(path)).is_relative_to(Path(os.path.realpath(root)))
    except OSError:
        return False


def parse_session(path: Path, root: Path, project: Path | None = None) -> tuple[list[dict], dict]:
    """One session file (+ its subagents) -> (episodes, stats). Episodes are empty when `project` is given
    and the session's cwd is outside it."""
    sid = _id(path.stem)
    acc = parse_stream(_lines(path))
    stats = {"badLines": acc.bad_lines, "unknownRecordTypes": dict(acc.unknown), "spillFiles": 0, "spillBytes": 0,
             "skippedSymlinks": 0}
    if project is not None:
        proot = _real(str(project))
        if not acc.cwd or not (_real(acc.cwd) == proot or _real(acc.cwd).startswith(proot + os.sep)):
            return [], {**stats, "otherProject": True}
    phash = short_hash(_real(acc.cwd), 10) if acc.cwd else None
    main = _episode(acc, f"cc:{sid}", "session", phash)
    eps = [main]
    sdir = path.parent / path.stem
    subdir = sdir / "subagents"
    if subdir.is_dir() and not subdir.is_symlink() and not sdir.is_symlink():
        for f in sorted(subdir.glob("agent-*.jsonl")):
            if not safe_file(f, root):
                stats["skippedSymlinks"] += 1
                continue
            aid = _id(f.stem.removeprefix("agent-"))
            sacc = parse_stream(_lines(f))
            ep = _episode(sacc, f"cc:{sid}/agent-{aid}", "subagent", phash)
            ep["parent"] = main["id"]
            mp = f.parent / f"{f.stem}.meta.json"
            meta = _read_meta(mp) if safe_file(mp, root) else {}
            if meta:
                ep["agentType"] = _name(meta.get("agentType"), "?")
                ep["subagentFinished"] = meta.get("finished") is True
                if isinstance(meta.get("model"), str):
                    ep["model"] = _name(meta["model"])
            for k, v in sacc.unknown.items():
                stats["unknownRecordTypes"][k] = stats["unknownRecordTypes"].get(k, 0) + v
            stats["badLines"] += sacc.bad_lines
            for s in main["subagents"]:
                if s["id"] == aid:
                    s["finished"] = s["finished"] or ep.get("subagentFinished", False)
                    ep["agentType"] = ep.get("agentType") or s["type"]
            eps.append(ep)
    tr = sdir / "tool-results"
    if tr.is_dir() and not tr.is_symlink() and not sdir.is_symlink():   # spilled outputs: count and size only
        for f in tr.glob("*.txt"):
            if safe_file(f, root):
                stats["spillFiles"] += 1
                stats["spillBytes"] += f.stat().st_size
    return eps, stats


def _read_meta(p: Path) -> dict:
    try:
        d = json.loads(p.read_text(encoding="utf-8")[:100_000])
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError, RecursionError):
        return {}


class TranscriptSource:
    """All sessions under `root` (~/.claude/projects) for one project. Read-only; no cache."""

    def __init__(self, root: Path, project: Path | None):
        self.root, self.project = Path(root), project

    def sessions(self) -> tuple[list[Path], int]:
        """Session files directly under <root>/<project-folder>/; symlinks are skipped and counted."""
        if not self.root.is_dir() or self.root.is_symlink():
            return [], 0
        out, skipped = [], 0
        for d in sorted(self.root.iterdir()):
            if d.is_symlink():
                skipped += 1
                continue
            if not d.is_dir():
                continue
            for f in sorted(d.glob("*.jsonl")):
                if safe_file(f, self.root):
                    out.append(f)
                else:
                    skipped += 1
        return out, skipped

    def episodes(self, since: datetime | None = None) -> tuple[list[dict], dict]:
        files, skipped = self.sessions()
        stats = {"sessions": 0, "files": len(files), "skippedOld": 0, "skippedSymlinks": skipped, "otherProjects": 0,
                 "badLines": 0, "unknownRecordTypes": {}, "spillFiles": 0, "spillBytes": 0, "errors": []}
        out: list[dict] = []
        cutoff = since.timestamp() if since else None
        for path in files:
            try:
                newest = path.stat().st_mtime
                sub = path.parent / path.stem / "subagents"
                if sub.is_dir() and not sub.is_symlink():
                    newest = max([newest] + [f.stat().st_mtime for f in sub.glob("agent-*.jsonl") if not f.is_symlink()])
                if cutoff is not None and newest < cutoff:
                    stats["skippedOld"] += 1          # mtime prefilter: nothing in it can be in the window
                    continue
                eps, st = parse_session(path, self.root, self.project)
            except Exception as e:                 # any failure is one file's problem, never the scan's
                stats["errors"].append({"file": f"{_id(path.stem)}.jsonl", "error": type(e).__name__})
                continue
            if st.get("otherProject"):
                stats["otherProjects"] += 1
                continue
            stats["sessions"] += 1
            for k in ("badLines", "spillFiles", "spillBytes", "skippedSymlinks"):
                stats[k] += st.get(k, 0)
            for k, v in st.get("unknownRecordTypes", {}).items():
                stats["unknownRecordTypes"][k] = stats["unknownRecordTypes"].get(k, 0) + v
            out += eps
        return out, stats
