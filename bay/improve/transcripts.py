"""Claude Code session transcripts -> redacted session.episode/v1.

The on-disk format is NOT a stable API (docs/research/claude-code-transcripts.md), so:
  * stream line by line; a bad or half-written line is counted, never raised, never echoed
  * dispatch on top-level `type` against an allowlist; unknown types are counted by name
  * read only the fields needed, with defaults; never validate against a closed schema
  * keep structure and metadata only (counts, names, durations, error flags, tokens, model).
    Free text is kept only with keep_text=True, and then only as short excerpts after a secret scan.
  * idempotent: a session is re-parsed only when its size or mtime (or its subagents') changed
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .. import secretscan
from . import short_hash

KNOWN = {"user", "assistant", "attachment", "system", "queue-operation", "last-prompt", "mode", "pr-link",
         "tools-used", "cost-state", "progress", "file-history-snapshot", "summary", "custom-title", "tag"}
INTERRUPT = re.compile(r"^\s*\[request interrupted by user", re.I)
COMPACTED = "this session is being continued from a previous conversation that ran out of context"
SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")
SUBAGENT_TOOLS = ("Agent", "Task")
EXCERPT_CHARS = 160
MAX_EXCERPTS = 20


def _name(v, default: str = "?") -> str:
    """A tool/model/type name is kept only if it looks like a name (never free text)."""
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


@dataclass
class _Acc:
    """Accumulates one transcript file (a session or a subagent) into an episode."""
    keep_text: bool
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
    queued: int = 0
    prompts: int = 0
    compaction: int = 0
    hook_ms: int = 0
    hook_errors: int = 0
    cost: dict | None = None
    unknown: dict = field(default_factory=dict)
    bad_lines: int = 0
    records: int = 0
    excerpts: list = field(default_factory=list)

    def excerpt(self, role: str, text: str) -> None:
        if self.keep_text and len(self.excerpts) < MAX_EXCERPTS and text.strip():
            self.excerpts.append({"role": role, "text": secretscan.scrub(text.strip()[:EXCERPT_CHARS])})


def _user_text(acc: _Acc, text: str, is_meta: bool) -> None:
    if INTERRUPT.match(text):
        acc.interrupts += 1
        return
    if text.strip().lower().startswith(COMPACTED):
        acc.compaction += 1
        return
    if not is_meta:
        acc.turns += 1
        acc.excerpt("user", text)


def _record(acc: _Acc, rec: dict) -> None:
    t = rec.get("type")
    ts = _ts(rec.get("timestamp"))
    if ts:
        acc.start = min(acc.start or ts, ts)
        acc.end = max(acc.end or ts, ts)
    if acc.cwd is None and isinstance(rec.get("cwd"), str):
        acc.cwd = rec["cwd"]
    if acc.version is None and isinstance(rec.get("version"), str):
        acc.version = rec["version"] if SAFE_ID.match(rec["version"]) and len(rec["version"]) <= 40 else None
    if acc.entrypoint is None and isinstance(rec.get("entrypoint"), str):
        acc.entrypoint = _name(rec["entrypoint"], None)
    if rec.get("isCompactSummary"):
        acc.compaction += 1
    if t == "user":
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
        content = msg.get("content")
        meta = bool(rec.get("isMeta"))
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
                elif b.get("type") == "tool_result":
                    call = acc.calls.get(b.get("tool_use_id"))
                    if call is not None:
                        call["error"] = call["error"] or b.get("is_error") is True
                        call["denied"] = call["denied"] or (denied and b.get("is_error") is True)
                        sub = acc.subagents.get(b.get("tool_use_id"))
                        if sub is not None:
                            st = tur.get("status")
                            sub["finished"] = st in ("completed", "done", "success") or sub["finished"]
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
        for b in msg.get("content") or []:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use" and isinstance(b.get("id"), str):
                name = _name(b.get("name"))
                call = {"name": name, "inputHash": short_hash(b.get("input")), "error": False, "denied": False}
                acc.calls[b["id"]] = call
                acc.order.append(call)
                if name in SUBAGENT_TOOLS:
                    inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                    acc.subagents[b["id"]] = {"type": _name(inp.get("subagent_type"), "general-purpose"),
                                              "finished": False}
            elif b.get("type") == "text" and isinstance(b.get("text"), str):
                acc.excerpt("assistant", b["text"])
    elif t == "queue-operation":
        if rec.get("operation") == "enqueue":           # the user typed while the agent was working
            acc.queued += 1
    elif t == "system":
        st = rec.get("subtype")
        if st == "stop_hook_summary":
            for h in rec.get("hookInfos") or []:
                if isinstance(h, dict) and isinstance(h.get("durationMs"), (int, float)):
                    acc.hook_ms += int(h["durationMs"])
            acc.hook_errors += len(rec.get("hookErrors") or [])
        elif isinstance(st, str) and "compact" in st:
            acc.compaction += 1
    elif t == "cost-state":
        acc.cost = rec                                     # running snapshot: the last one wins


def _tokens(acc: _Acc) -> dict:
    out = {"input": 0, "output": 0, "cacheRead": 0, "cacheCreation": 0}
    for u in acc.usage.values():
        for k, src in (("input", "input_tokens"), ("output", "output_tokens"),
                       ("cacheRead", "cache_read_input_tokens"), ("cacheCreation", "cache_creation_input_tokens")):
            v = u.get(src)
            if isinstance(v, (int, float)):
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
        if isinstance(c.get("totalCostUSD"), (int, float)):
            ep["costUsd"] = round(float(c["totalCostUSD"]), 6)
        if isinstance(c.get("totalDuration"), (int, float)):
            ep["durationMs"] = int(c["totalDuration"])
    if acc.excerpts:
        ep["excerpts"] = acc.excerpts
    ep["meta"] = {k: v for k, v in ep["meta"].items() if v not in (None, {}, 0)}
    return {k: v for k, v in ep.items() if v is not None}


def parse_stream(lines, keep_text: bool = False) -> _Acc:
    acc = _Acc(keep_text=keep_text)
    for raw in lines:
        if not raw.strip():
            continue
        try:
            rec = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            acc.bad_lines += 1                 # half-written last line of a live session, or corruption
            continue
        if not isinstance(rec, dict):
            acc.bad_lines += 1
            continue
        acc.records += 1
        t = rec.get("type")
        if t not in KNOWN:
            key = t if isinstance(t, str) and SAFE_NAME.match(t) else "<other>"
            acc.unknown[key] = acc.unknown.get(key, 0) + 1
            continue
        try:
            _record(acc, rec)
        except Exception:                      # a record of a shape we did not expect: count it, keep going
            acc.unknown["<malformed>"] = acc.unknown.get("<malformed>", 0) + 1
    return acc


def _lines(path: Path):
    with open(path, "rb") as f:
        for raw in f:
            yield raw.decode("utf-8", "replace")


def _real(p: str) -> str:
    return os.path.realpath(os.path.expanduser(p))


def parse_session(path: Path, keep_text: bool = False, project: Path | None = None) -> tuple[list[dict], dict]:
    """One session file (+ its subagents) -> (episodes, stats). Episodes are empty when `project` is given
    and the session's cwd is outside it."""
    sid = _id(path.stem)
    acc = parse_stream(_lines(path), keep_text)
    stats = {"badLines": acc.bad_lines, "unknownRecordTypes": dict(acc.unknown), "spillFiles": 0, "spillBytes": 0}
    if project is not None:
        root = _real(str(project))
        if not acc.cwd or not (_real(acc.cwd) == root or _real(acc.cwd).startswith(root + os.sep)):
            return [], {**stats, "otherProject": True}
    phash = short_hash(_real(acc.cwd), 10) if acc.cwd else None
    main = _episode(acc, f"cc:{sid}", "session", phash)
    eps = [main]
    sdir = path.parent / path.stem
    subdir = sdir / "subagents"
    if subdir.is_dir():
        for f in sorted(subdir.glob("agent-*.jsonl")):
            aid = _id(f.stem.removeprefix("agent-"))
            sacc = parse_stream(_lines(f), keep_text)
            ep = _episode(sacc, f"cc:{sid}/agent-{aid}", "subagent", phash)
            ep["parent"] = main["id"]
            meta = _read_meta(f.parent / f"{f.stem}.meta.json")
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
    if tr.is_dir():                                  # spilled large outputs: name and size only, never content
        for f in tr.glob("*.txt"):
            stats["spillFiles"] += 1
            stats["spillBytes"] += f.stat().st_size
    return eps, stats


def _read_meta(p: Path) -> dict:
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def signature(path: Path) -> dict:
    """Session id + size + mtime of the session file and its subagent files (the idempotency key)."""
    st = path.stat()
    size, mtime = st.st_size, st.st_mtime_ns
    sub = path.parent / path.stem / "subagents"
    if sub.is_dir():
        for f in sub.glob("agent-*"):
            s = f.stat()
            size += s.st_size
            mtime = max(mtime, s.st_mtime_ns)
    return {"size": size, "mtime": mtime}


class TranscriptSource:
    """All sessions under `root` (~/.claude/projects) for one project, cached in `cache` by signature."""

    def __init__(self, root: Path, cache: Path, project: Path | None, keep_text: bool = False):
        self.root, self.cache_path, self.project, self.keep_text = root, cache, project, keep_text

    def _load_index(self) -> dict:
        try:
            d = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if isinstance(d, dict) and d.get("keepText") == self.keep_text and d.get("project") == self._pkey():
                return d
        except (OSError, ValueError):
            pass
        return {"keepText": self.keep_text, "project": self._pkey(), "sessions": {}}

    def _pkey(self) -> str | None:
        return short_hash(_real(str(self.project)), 10) if self.project else None

    def sessions(self) -> list[Path]:
        if not self.root.is_dir():
            return []
        return sorted(p for p in self.root.glob("*/*.jsonl") if p.is_file())

    def episodes(self) -> tuple[list[dict], dict]:
        idx = self._load_index()
        seen = set()
        stats = {"sessions": 0, "parsed": 0, "cached": 0, "otherProjects": 0, "badLines": 0,
                 "unknownRecordTypes": {}, "spillFiles": 0, "spillBytes": 0}
        out: list[dict] = []
        for path in self.sessions():
            sid = path.stem
            seen.add(sid)
            sig = signature(path)
            ent = idx["sessions"].get(sid)
            if ent and ent.get("sig") == sig:
                stats["cached"] += 1
            else:
                eps, st = parse_session(path, self.keep_text, self.project)
                ent = {"sig": sig, "episodes": eps, "stats": st}
                idx["sessions"][sid] = ent
                stats["parsed"] += 1
            st = ent["stats"]
            if st.get("otherProject"):
                stats["otherProjects"] += 1
                continue
            stats["sessions"] += 1
            stats["badLines"] += st.get("badLines", 0)
            stats["spillFiles"] += st.get("spillFiles", 0)
            stats["spillBytes"] += st.get("spillBytes", 0)
            for k, v in st.get("unknownRecordTypes", {}).items():
                stats["unknownRecordTypes"][k] = stats["unknownRecordTypes"].get(k, 0) + v
            out += ent["episodes"]
        idx["sessions"] = {k: v for k, v in idx["sessions"].items() if k in seen}
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(secretscan.scrub_obj(idx), ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.cache_path)
        return out, stats
