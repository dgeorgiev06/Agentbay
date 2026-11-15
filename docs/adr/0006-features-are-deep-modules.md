# 6. A kernel feature is a deep module with one entry file

Date: 2026-11-15. Status: accepted.

**Decision.** Kernel code is grouped into features. Other features import only a feature's entry file. Tests assert through that interface. A port exists only with two adapters.

**Why.** Small interfaces give callers leverage and keep change in one place. Source: the codebase-design skill in mattpocock/skills.

**Cost.** Files move, `bay/contracts.ts` is split, and tests of internals are rewritten at interfaces and deleted.
