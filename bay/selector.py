"""Selectors: the shared vocabulary that says which items a briefing mode keeps.

    selectors:                       # agentbay.config.yaml modes.<mode>.selectors (schema: selector/v1)
      - { id: home, in: home }
      - { id: staking, from: [vitalik, lido], text: staking, not: { text: giveaway } }

Fields: from, to, subject, text, in, has, since, not. A field takes one value or a list (any value matches).
Fields of one selector are ANDed, selectors are ORed, and `not` excludes: an item is excluded when ANY
field of its `not` block matches. Matching is case-insensitive (casefold).
  from / to   a handle, a full address or a domain (`example.com`, `@example.com`). `*` is the only wildcard,
              and only here: `*@bank.example`, `news*` (any run of characters). A field with a `*` value is
              matched locally, never sent to the source's search
  subject     substring of the title;  text: substring of title or body (no wildcards)
  in          a container or label, exactly (home, list:<id>, INBOX); a `label:` or `in:` prefix (Gmail search
              style, `label:Work`, `in:inbox`) is ignored when matching
  has         link | attachment
  since       relative (7d) or ISO-8601

Each source connector declares which fields its native search handles (connector.yaml spec.selectors:
`native` or `local`; a field it does not list cannot be expressed). `split()` turns a selector into a
native query (narrows the fetch) and a local filter. `not` is native only on a source that declares
`not: native` and handles every field inside it natively (Gmail's `-` prefix). The store always re-applies
the FULL selector with `matches()`, so behaviour is the same on every source no matter what the native
query did.
"""
from __future__ import annotations

import json
from datetime import datetime

from .util import parse_time

FIELDS = ("from", "to", "subject", "text", "in", "has", "since", "not")
HAS = ("link", "attachment")


def _vals(v) -> list[str]:
    if v is None:
        return []
    return [str(x) for x in (v if isinstance(v, list) else [v])]


def _norm(s: str) -> str:
    return s.strip().casefold().lstrip("@")


def _addr_match(value: str, addrs: list[str]) -> bool:
    """`value` is a handle, a full address, or a domain (`example.com` or `@example.com`); `*` matches any run
    of characters (the only wildcard)."""
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
    """Whether an address or handle matches any of `patterns` (the `from`/`to` rules: handle, address, domain,
    `*` wildcard). Used for sender lists such as a mode's `important` setting."""
    return any(_addr_match(p, [addr or ""]) for p in _vals(patterns))


def _container(v: str) -> str:
    v = _norm(v)
    for prefix in ("label:", "in:"):
        if v.startswith(prefix):
            return v[len(prefix):]
    return v


def glob(pattern: str, text: str) -> bool:
    """`*` matches any run of characters; everything else is literal. No regex and no backtracking: the
    literal parts between stars are found left to right (for `*`-only patterns the leftmost occurrence is
    always a safe choice), so the cost is a few str.find calls over `text`, whatever the number of stars."""
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
        if not _field(item, f, _vals(sel[f]), now):
            return False
    for f, v in (sel.get("not") or {}).items():
        if _field(item, f, _vals(v), now):
            return False
    return True


def match_ids(item: dict, selectors: list[dict], now: datetime) -> list[str]:
    return [s["id"] for s in selectors if matches(item, s, now)]


# ------------------------------------------------------------------ capabilities
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
    """Whether a field value (one or a list) has a `*` value. Source APIs search exact handles and addresses,
    so such a field is matched locally only (all its values: they are ORed)."""
    return any("*" in x for x in _vals(v))


def _native_not(block, caps: dict) -> bool:
    """A `not` block goes to the source only when the source declares `not: native` and handles every field in
    it natively without wildcards (Gmail `-from:x`); otherwise it is matched locally."""
    return (mode_of(caps, "not") == "native" and isinstance(block, dict) and bool(block)
            and all(f != "since" and mode_of(caps, f) == "native" and not wildcard(v) for f, v in block.items()))


def split(sel: dict, caps: dict) -> tuple[dict, dict]:
    """(native query, local filter). Wildcard values are always local, and `not` is local unless the source
    can express all of it (`_native_not`); the store re-applies the whole selector anyway."""
    native, local = {}, {}
    for f in FIELDS:
        if f == "id" or f not in sel:
            continue
        if f == "not":
            (native if _native_not(sel[f], caps) else local)[f] = sel[f]
            continue
        (native if mode_of(caps, f) == "native" and not wildcard(sel[f]) else local)[f] = sel[f]
    return native, local


def native_key(native: dict) -> str:
    """Canonical text of a native query: selectors with the same native query share one fetch and cursor."""
    def norm(v):
        return {k: sorted(_vals(x)) for k, x in sorted(v.items())} if isinstance(v, dict) else sorted(_vals(v))
    return json.dumps({k: norm(v) for k, v in sorted(native.items()) if k != "since"},
                      sort_keys=True, separators=(",", ":"))


def canonical(selectors: list[dict]) -> str:
    return json.dumps(selectors or [], sort_keys=True, separators=(",", ":"))


def check(selectors: list[dict], caps: dict, *, connector: str, paid: bool, where: str) -> tuple[list[str], list[str]]:
    """(errors, warnings) for one bound source. Errors: duplicate ids, fields the source cannot express.
    Warnings: local-only fields on a paid source (you pay for items that are then dropped), including a native
    field the source matches locally when combined with another (`localWith`, e.g. X `from` with `in`)."""
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
