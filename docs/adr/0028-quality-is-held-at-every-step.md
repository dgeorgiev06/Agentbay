# ADR 28: code quality, readability and modularity are held at every step of the pipeline

Status: accepted as a goal, 19 November 2026. The goal is the owner's. How each step holds it is the reviewer's proposal below; the owner may change any point.

## Context

The owner asked for the missing steps of the pipeline to be built: requirements, design, planning and waves. He then said: "Ensure code quality and readability and modularity grounded in best practices as we discussed. Engrave this goal into the pipeline."

What was discussed and decided before, which this record gathers:

- Deep modules, interfaces first, vertical slices; unused code deleted; the same code in two places flagged and made one.
- Code a person can read. A line budget never outranks readability, and packing lines to meet one is cheating. No comments in code.
- Practices written down with who holds each: `framework/practices.md` (P-01 to P-51, with Structure and Data sections) and one file per language (`components/base/typescript/practices.md`).
- A reviewer's instructions on what a good test is, negative paths included.

Today the practices are held in the build rounds only, and unevenly. Of the kit's practices, 12 are held by a check, 31 by review, 4 by a design or a plan that no step of forge yet reads, and 4 by a check that is planned and not built (P-12, P-15, P-16, P-30). The reviewer hands back findings; it does not answer practice by practice. The card does not say which practices were judged.

## Decision

1. **Every practice has a holder that acts in the pipeline**: a check, proof, the reviewer, the design step or the planning step. A practice whose holder is "planned" is a debt. The list of such debts only shrinks, and `bay check` names each one.
2. **Design holds structure.** A design names its modules, what each hides, and each interface, before anything else. A script refuses a design with a module that has no interface, an interface no module implements, or a table two modules own. The practices held by design are judged by the design's challenger, practice by practice, and the design card shows the answer.
3. **Planning holds the slices' shape.** Each slice is vertical, names the interface files it builds against, and keeps its scope inside one module where it can. `forge.waves` refuses a slice that names no interface or whose scope crosses modules without saying why. The practices held by a plan are judged by the plan's challenger.
4. **Building is given the practices.** The test writer and the builder each get the practices that bear on their work, and the exemplar files for their language once the owner has approved them.
5. **Proof holds what a tool can hold, on every slice, whether or not its plan lists them**: types, lint, format, dead code, and that the count of duplicated blocks does not rise. A signal such as a long function or a large file is shown as a signal, never as a limit.
6. **The reviewer answers every practice it holds, by id**: held, not held, or does not apply, with the place when not held. A script sends back a review that leaves one out.
7. **The card shows it.** One block says how many practices a tool, proof and the reviewer held, and names each one not held with its sentence. Merge is not available while a practice marked must is not held; the owner may still keep the work.
8. **The same holds outside the kit.** A project adds its own practices file; a language brings its own through its toolchain mode. Nothing in this record depends on TypeScript.

## Consequences

- Slice DS1 (design) builds point 2, slice PL1 (planning) point 3, and a new slice QL1 points 1, 5, 6 and 7 in forge and proof. Point 4's exemplar files wait on the owner's answer to the research note of 19 November.
- A review costs more: one answer per practice, not only findings.
- A practice nobody can hold must be reworded or removed. That is the intent.
- This does not make code good by itself. A check holds what can be counted, and the reviewer and the challenger are models whose judgement can be wrong. The card says who judged each line so the owner can tell.
