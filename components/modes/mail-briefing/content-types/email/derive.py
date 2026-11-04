"""Derived fields of an email (content-type.yaml `derived`, `deriveVersion`)."""
from __future__ import annotations

GMAIL_DOMAINS = ("gmail.com", "googlemail.com")


def addr_key(addr) -> str | None:
    """One mailbox's identity: lower case, without a +tag; Gmail dots are ignored and googlemail.com is gmail.com."""
    if addr is None:
        return None
    a = str(addr).strip().lower()
    local, at, domain = a.rpartition("@")
    if not at or not local:
        return a
    local = local.split("+", 1)[0] or local
    if domain in GMAIL_DOMAINS:
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def derive(item: dict, version: int) -> dict:
    """fromMe, toMe and bulk, each 0 or 1, from the labels and headers, with addresses compared by addr_key."""
    acct = addr_key(item.get("account"))
    from_me = "SENT" in (item.get("labels") or []) or addr_key(item.get("from") or "") == (acct or "")
    to_me = acct is not None and any(addr_key(a) == acct for a in [*(item.get("to") or []), *(item.get("cc") or [])])
    return {"fromMe": int(from_me), "toMe": int(to_me), "bulk": int(bool(item.get("bulk")))}
