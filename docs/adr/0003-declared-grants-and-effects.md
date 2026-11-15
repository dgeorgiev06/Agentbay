# 3. Safety is declared per mode and enforced in one place

Date: 2026-11-15. Status: accepted.

**Decision.** A mode declares its grants in `resources:` and each action declares its effects. The broker enforces both by one rule.

**Why.** A reader can see what a mode may do from its manifest. `bay check` and `bay call` load the system the same way, so they cannot disagree.

**Cost.** Every new resource operation must be added to the effect rule's table.
