# 5. Script confinement is a seat belt, not a wall

Date: 2026-11-15. Status: accepted.

**Decision.** Scripts run in a child Node process with the permission model, a clean environment and a preload allow-list. Real isolation waits for the cloud version.

**Why.** The audience is the owner first. Node's permission model narrows mistakes; it does not stop hostile code.

**Cost.** Modes from strangers are not safe to run until containers arrive.
