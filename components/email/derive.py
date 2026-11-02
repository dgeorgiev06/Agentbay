"""Derived fields of an email (content-type.yaml `derived`, `deriveVersion`).

The store calls derive(item, version) when it writes an item and again, without fetching anything, when the
kit's deriveVersion differs from the one the store recorded. The result is stored in `items.derived`; views read
it, so nothing here runs per query. Standard library only (lint checks the imports).
"""
from __future__ import annotations

GMAIL_DOMAINS = ("gmail.com", "googlemail.com")


def addr_key(addr) -> str | None:
    """One mailbox's identity: lower case, without a +tag; for Gmail (gmail.com, googlemail.com) the dots of the
    local part are ignored and googlemail.com is gmail.com. `Dana.Ruiz+work@GoogleMail.com` -> `danaruiz@gmail.com`."""
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
    """fromMe (I sent it: label SENT, or the sender is the account), toMe (my address is in To or Cc) and bulk
    (List-Unsubscribe, or Precedence: bulk or list), each 0 or 1. Addresses are compared with addr_key."""
    acct = addr_key(item.get("account"))
    from_me = "SENT" in (item.get("labels") or []) or addr_key(item.get("from") or "") == (acct or "")
    to_me = acct is not None and any(addr_key(a) == acct for a in [*(item.get("to") or []), *(item.get("cc") or [])])
    return {"fromMe": int(from_me), "toMe": int(to_me), "bulk": int(bool(item.get("bulk")))}
