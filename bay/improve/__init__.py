"""improve: find recurring failures and waste in sessions and artifacts, with evidence.

Code here runs only on the dispatcher side (inside connectors). Agents reach its results only through
read-only role shims. Modules:

  transcripts  defensive Claude Code transcript parser -> redacted session.episode/v1
  sources      ledger events/verdicts and git history -> session.episode/v1, review verdicts
  detectors    deterministic session and artifact detectors -> candidate improve.finding/v1
  store       .agentbay/data/improve/findings.jsonl: dedup by fingerprint, triage, backlog, verify
"""
