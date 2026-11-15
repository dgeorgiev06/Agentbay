# 4. Mode code imports only the toolbox

Date: 2026-11-15. Status: accepted.

**Decision.** Mode scripts may import `bay/sdk.ts` and their own files. Nothing else from the kit.

**Why.** It keeps the kernel free to change inside, and keeps agents that extend a mode in a lane.

**Cost.** A missing toolbox function blocks a mode until the kernel adds it.
