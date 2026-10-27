---
name: review-checklist
description: Checklist for reviewing a change or document produced by another agent. Use for any review or QA task.
---
# Review checklist

Rate each finding **blocker / should-fix / nit**.

- Does the work meet the task's `deliverable` exactly? Anything missing?
- Correctness: logic errors, unhandled edge cases, wrong assumptions.
- Evidence: are claims backed by sources or tests? Were tests actually run?
- Scope: did it change things the task did not ask for?
- Safety: secrets, destructive commands, external calls, data handling.

Status rule: any blocker → `partial`; otherwise `done`.
