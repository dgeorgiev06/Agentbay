# delivery.research

## Purpose
Answer a research question with a sourced brief the coordinator can act on.

## Inputs
- `goal`, `deliverable` (required); `context`, `inputs`, `constraints` (optional).

## Steps
1. `brief`: the researcher splits the goal into 2-5 questions, answers each with sources, and synthesizes.
2. The researcher writes the brief (research-brief skill) and returns a Result.

## Definition of Done
- [DOD-1] (must) The first 2-3 sentences answer the goal.
- [DOD-2] (must) Every claim has a source (url or path).
- [DOD-3] (should) Conflicting sources and unknowns are listed.

## Outputs
A `Result` whose summary is the compressed brief; the brief file (if written) is in `artifacts`.

## Failure handling
- Sources unavailable or contradictory: return `partial` and list what is unknown in `followups`.
