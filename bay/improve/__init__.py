"""improve: find recurring failures and waste in sessions and artifacts, with evidence.

Code here runs only on the dispatcher side (inside connectors). Agents reach its results only through
read-only role shims. Modules:

  transcripts  defensive Claude Code transcript parser -> redacted session.episode/v1
  sources      ledger events/verdicts and git history -> session.episode/v1, review verdicts
  graph        project/kit files and the reference graph (artifacts.read/v1)
  detectors    deterministic session and artifact detectors -> candidate improve.finding/v1
  conformance  framework/rules/conformance.yaml: load, validate, deterministic checks
  store        .agentbay/data/improve/findings.jsonl: dedup by fingerprint, triage, backlog, verify
"""
from __future__ import annotations

import hashlib
import json


def short_hash(obj, n: int = 12) -> str:
    """Stable short hash of any JSON-able value (used instead of content, never reversible in practice)."""
    raw = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()[:n]
