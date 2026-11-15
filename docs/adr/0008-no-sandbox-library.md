# 8. Ideas from Sandcastle, not the dependency

Date: 2026-11-15. Status: accepted.

**Decision.** Forge takes the pattern (a worktree and branch per builder, commits merged back, harness providers) and does not depend on the Sandcastle library.

**Why.** Owner decision. The kit keeps two runtime dependencies.

**Cost.** The builder runner and any stronger sandbox are written here.
