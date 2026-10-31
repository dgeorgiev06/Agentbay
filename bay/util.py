"""Small shared helpers: durations, timestamps, YAML/JSON IO, hashes. Stdlib + PyYAML."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

_DUR = re.compile(r"^\s*([0-9]+)\s*([mhdw])\s*$")
_UNITS = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}


def duration(text: str) -> timedelta:
    """'90m', '12h', '3d', '2w' -> timedelta. Raises ValueError with the bad text."""
    m = _DUR.match(str(text))
    if not m:
        raise ValueError(f"bad duration {text!r} (expected e.g. 30m, 12h, 3d, 2w)")
    return timedelta(**{_UNITS[m.group(2)]: int(m.group(1))})


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(text: str, now: datetime) -> datetime:
    """ISO-8601 instant, or a relative duration meaning 'that long before now'."""
    if _DUR.match(str(text)):
        return now - duration(text)
    try:
        dt = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"bad time {text!r} (expected ISO-8601 like 2026-10-27T09:00:00Z, or relative like 3d)")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def in_window(ts: str | None, since: datetime | None, until: datetime | None) -> bool:
    """Is the ISO timestamp `ts` within [since, until]? No bound on a side is open; a missing `ts` is in only when
    there is no `since`; an unparsable one is out."""
    if not ts:
        return since is None
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return False
    return (since is None or t >= since) and (until is None or t <= until)


def short_hash(obj, n: int = 12) -> str:
    """Stable short hash of any JSON-able value (used instead of content, never reversible in practice)."""
    raw = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()[:n]


def fingerprint(c: dict) -> str:
    """The improve finding contract: the id of a candidate is its kind and detector key (improve-detect and
    improve-store both use it; the tests of both assert one shared vector)."""
    return short_hash(f"{c['kind']}|{c['detector']['key']}", 16)


MAX_WARNINGS = 20


def warn(warnings: list | None, msg: str) -> None:
    """Append `msg` to the caller's warnings list (when it has one), keeping at most MAX_WARNINGS."""
    if warnings is not None and len(warnings) < MAX_WARNINGS:
        warnings.append(msg)


def read_events(project: Path, warnings: list | None = None) -> list[dict]:
    """The ledger's events (dicts with string type, ts and runId), read-only; a line that is not one is skipped and
    named (file:line) in `warnings`. The one reader of connectors that fold the ledger (ledger, improve-store)."""
    from .ledger import LEDGER_FILE
    p = Path(project) / LEDGER_FILE
    out: list[dict] = []
    if p.exists():
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except (ValueError, RecursionError):
                e = None
            if isinstance(e, dict) and all(isinstance(e.get(k), str) for k in ("type", "ts", "runId")):
                out.append(e)
            else:
                warn(warnings, f"{LEDGER_FILE}:{n}: not a ledger event, skipped")
    return out


def read_json(p: Path, default=None):
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(p)
