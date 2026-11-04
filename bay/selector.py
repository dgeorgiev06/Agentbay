"""Selectors: the shared vocabulary that says which items a briefing mode keeps."""
from __future__ import annotations

import json
from datetime import datetime

from .util import parse_time

FIELDS = ("from", "to", "subject", "text", "in", "has", "since", "not")
HAS = ("link", "attachment")


def vals(v) -> list[str]:
    return [] if v is None else [str(x) for x in (v if isinstance(v, list) else [v])]


def _norm(s: str) -> str:
    return s.strip().casefold().lstrip("@")


def _addr_match(value: str, addrs: list[str]) -> bool:
    """Whether `value` (a handle, an address or a domain) matches any of `addrs`; `*` is the only wildcard."""
    v = _norm(value)
    for a in addrs:
        a = _norm(a)
        if not a:
            continue
        if "*" in v:
            if glob(v, a):
                return True
            continue
        if a == v or ("@" in a and (a.endswith("@" + v) or a.split("@", 1)[1] == v)):
            return True
    return False


def addr_matches(patterns, addr: str) -> bool:
    """Whether an address or handle matches any of `patterns`, by the `from`/`to` rules."""
    return any(_addr_match(p, [addr or ""]) for p in vals(patterns))


def _container(v: str) -> str:
    v = _norm(v)
    for prefix in ("label:", "in:"):
        if v.startswith(prefix):
            return v[len(prefix):]
    return v


def glob(pattern: str, text: str) -> bool:
    """`*` matches any run of characters, the rest is literal; no regex or backtracking, so cost stays a few finds."""
    head, *mid = pattern.split("*")
    if not mid:
        return pattern == text
    tail = mid.pop()
    if len(head) + len(tail) > len(text) or not text.startswith(head) or not text.endswith(tail):
        return False
    pos, end = len(head), len(text) - len(tail)
    for part in mid:
        if part:
            i = text.find(part, pos, end)
            if i < 0:
                return False
            pos = i + len(part)
    return True


def _field(item: dict, field: str, values: list[str], now: datetime) -> bool:
    if field == "from":
        au = item.get("author") or {}
        return any(_addr_match(v, [au.get("handle") or "", au.get("email") or ""]) for v in values)
    if field == "to":
        return any(_addr_match(v, list(item.get("to") or []) + list(item.get("cc") or [])) for v in values)
    if field == "subject":
        t = (item.get("title") or "").casefold()
        return any(v.casefold() in t for v in values)
    if field == "text":
        t = f"{item.get('title') or ''}\n{item.get('text') or ''}".casefold()
        return any(v.casefold() in t for v in values)
    if field == "in":
        have = {_norm(x) for x in [item.get("container") or "", *(item.get("labels") or [])] if x}
        return any(_norm(v) in have or _container(v) in have for v in values)
    if field == "has":
        return any(_has(item, v) for v in values)
    if field == "since":
        created = parse_time(item["createdAt"], now)
        return all(created >= parse_time(v, now) for v in values)
    raise ValueError(f"unknown selector field '{field}'")


def _has(item: dict, what: str) -> bool:
    w = what.casefold()
    if w == "link":
        return "http://" in (item.get("text") or "") or "https://" in (item.get("text") or "")
    if w == "attachment":
        return bool(item.get("attachments"))
    raise ValueError(f"selector `has: {what}` is not one of {', '.join(HAS)}")


def matches(item: dict, sel: dict, now: datetime) -> bool:
    """The one shared matcher. Every field of `sel` must match; any matching `not` field excludes."""
    for f in FIELDS:
        if f == "not" or f not in sel:
            continue
        if not _field(item, f, vals(sel[f]), now):
            return False
    for f, v in (sel.get("not") or {}).items():
        if _field(item, f, vals(v), now):
            return False
    return True


def match_ids(item: dict, selectors: list[dict], now: datetime) -> list[str]:
    return [s["id"] for s in selectors if matches(item, s, now)]


def local_with(caps: dict, field: str, sel: dict) -> list[str]:
    """Fields of `sel` that make a native `field` local on this source (capability `localWith`)."""
    c = caps.get(field)
    return [f for f in (c.get("localWith") or []) if f in sel] if isinstance(c, dict) else []


def mode_of(caps: dict, field: str) -> str | None:
    """'native' | 'local' | None (the source cannot express the field)."""
    c = caps.get(field)
    if isinstance(c, dict):
        c = c.get("mode")
    return c if c in ("native", "local") else None


def wildcard(v) -> bool:
    """Whether a field value (one or a list) has a `*` value; such a field is matched locally, never at the source."""
    return any("*" in x for x in vals(v))


def split(sel: dict, caps: dict) -> tuple[dict, dict]:
    """(native query, local filter); `not` and wildcards are always local, and the store re-applies it all."""
    native, local = {}, {}
    for f in FIELDS:
        if f == "id" or f not in sel:
            continue
        (native if f != "not" and mode_of(caps, f) == "native" and not wildcard(sel[f]) else local)[f] = sel[f]
    return native, local


def native_key(native: dict) -> str:
    """Canonical text of a native query: selectors with the same native query share one fetch and cursor."""
    return json.dumps({k: sorted(vals(v)) for k, v in sorted(native.items()) if k != "since"},
                      sort_keys=True, separators=(",", ":"))


def canonical(selectors: list[dict]) -> str:
    return json.dumps(selectors or [], sort_keys=True, separators=(",", ":"))


def check(selectors: list[dict], caps: dict, *, connector: str, paid: bool, where: str) -> tuple[list[str], list[str]]:
    """(errors, warnings) for one bound source. Errors: duplicate ids, fields the source cannot express."""
    errors, warnings = [], []
    seen: set[str] = set()
    for s in selectors or []:
        sid = s.get("id", "?")
        if sid in seen:
            errors.append(f"{where}: selector id '{sid}' is used twice; ids must be unique")
        seen.add(sid)
        fields = [f for f in s if f not in ("id", "not")] + [f"not.{f}" for f in (s.get("not") or {})]
        for f in fields:
            base = f.split(".", 1)[-1]
            m = mode_of(caps, base)
            if m is None:
                have = ", ".join(f"{k} ({mode_of(caps, k)})" for k in caps) or "none"
                errors.append(f"{where}: selector '{sid}' uses `{f}`, which source connector {connector} cannot "
                              f"express (it declares: {have}); remove the field or bind a source that supports it")
            elif paid and (m == "local" or f.startswith("not.") or wildcard(s.get(f))) and base != "since":
                wild = m == "native" and not f.startswith("not.")
                why = f"has a `*` value, which {connector} cannot search natively, so it is" if wild else "is"
                if wild and not {k for k in split(s, caps)[0] if k != "since"}:
                    why = (f"has a `*` value, which {connector} cannot search natively, so the native query is "
                           f"empty and becomes {connector}'s default stream (the home timeline on X); `{f}` is")
                fix = f"exact values for `{f}` or " if wild else ""
                warnings.append(f"{where}: selector '{sid}' field `{f}` {why} matched locally on paid source "
                                f"{connector}: every item its native query returns is billed, then dropped if it does "
                                f"not match; narrow it with {fix}native fields "
                                f"({', '.join(k for k in caps if mode_of(caps, k) == 'native')})")
            elif paid and m == "native" and not f.startswith("not.") and local_with(caps, base, s):
                both = ", ".join(f"`{x}`" for x in local_with(caps, base, s))
                warnings.append(f"{where}: selector '{sid}' combines `{f}` with {both}; {connector} then reads the "
                                f"{both} stream and matches `{f}` locally, so on this paid source every item of that "
                                f"stream is billed, then dropped unless it matches. Split it into two selectors "
                                f"(one with `{f}` only) to fetch `{f}` natively")
    return errors, warnings
