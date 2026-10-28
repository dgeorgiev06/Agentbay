---
name: pattern-analysis
description: How improve's analyst finds recurring session patterns, explains root causes, proposes preventive fixes and drafts handoffs. Use for improve scan `patterns`, triage `analyze` and implement `draft` steps.
---
# Pattern analysis (improve)

1. Start from the step plan: episode summaries in `previous.detect.episodes`, detector findings in
   `previous.store.summary` and earlier steps. Read more through your use shim:
   `session.events/v1.episodes '{"since": "7d"}'` for full episodes and `improve.findings/v1.query '<json>'`
   for stored findings.
2. Episodes are structure only: counts, durations, tool names and input hashes, never conversation text.
   Never quote or reconstruct transcript text; cite ids and counts only.
3. Look for the cause behind a pattern, not its symptom.
4. Prefer preventive fixes: a new lint or conformance rule, a deterministic check, a test, a clearer
   playbook step. Every proposed fix names where it goes: forge.extend for the framework, a mode-fix task for
   a user mode.
5. Cite evidence by episode id or file:line exactly as given; never invent ids. Every finding or annotation
   cites evidence ids that appear in the plan or the store.
