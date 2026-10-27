"""Pattern-based secret scan. Stdlib only, so hooks and connectors can import it.

`vault.redact` scrubs secret values agentbay itself resolved; this module scrubs
secret-shaped text agentbay never saw (pasted keys in transcripts, tokens in
review evidence). Both run before anything reaches the ledger or the improve store.
"""
from __future__ import annotations

import re

# (kind, pattern). Ordered: specific before generic, so the reported kind is the most precise.
PATTERNS: list[tuple[str, re.Pattern]] = [
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S)),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    ("api-key", re.compile(r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|"
                           r"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|"
                           r"AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})")),
    ("connection-string", re.compile(r"\b[a-z][a-z0-9+.-]{1,20}://[^\s:/@'\"]+:[^\s@/'\"]+@[^\s'\"]+", re.I)),
    ("password", re.compile(r"(?i)\b(?:password|passwd|pwd)\s*[=:]\s*(?:\"[^\"]*\"|'[^']*'|\S+)")),
    ("secret-assignment", re.compile(r"(?i)\b(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
                                     r"aws_secret_access_key)\s*[=:]\s*[\"']?[A-Za-z0-9/+_.=-]{12,}")),
]


def find(text: str) -> list[str]:
    """Kinds of secrets present in text (deduplicated, in pattern order)."""
    if not text:
        return []
    return [kind for kind, rx in PATTERNS if rx.search(text)]


def scrub(text: str) -> str:
    """Replace every secret-shaped span with [REDACTED:<kind>]."""
    if not text:
        return text
    for kind, rx in PATTERNS:
        text = rx.sub(f"[REDACTED:{kind}]", text)
    return text


def scrub_obj(obj):
    """scrub() every string inside a JSON-like object (keys included)."""
    if isinstance(obj, str):
        return scrub(obj)
    if isinstance(obj, dict):
        return {scrub(k) if isinstance(k, str) else k: scrub_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub_obj(x) for x in obj]
    return obj


def clip(text: str, n: int) -> str:
    """Scrub, then cut to n chars: cutting first could leave the prefix of a secret the scan no longer sees."""
    return scrub(text or "")[:n]
