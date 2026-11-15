# 2. The kernel never drives a model

Date: 2026-11-15. Status: accepted.

**Decision.** The kernel hands a harness a task and waits for a submission. It does not call a model API and does not own the agent loop.

**Why.** The same mode must run, interactively or not, on any harness: Claude Code, Codex, and frameworks such as Mastra. It also lets skill work run under the owner's subscription.

**Cost.** The kernel must own what harnesses lack or do differently: runs, approvals, budgets, grants and effects. Agent frameworks are harnesses behind adapters, never a foundation.
