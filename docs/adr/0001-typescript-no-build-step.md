# 1. The kit is TypeScript that Node runs directly

Date: 2026-11-15. Status: accepted.

**Decision.** The whole kit is TypeScript with erasable syntax only. Node runs the `.ts` files; there is no build step.

**Why.** One language for kernel, adapters and modes. What is checked in is what runs.

**Cost.** No enums, no parameter properties, no decorators. Node 22.18 or later.
