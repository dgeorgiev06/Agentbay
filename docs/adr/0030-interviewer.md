# ADR 30: an eighth role, the interviewer, for the PM mode's interview

Status: accepted, 21 November 2026. Decided by the owner, on question 6 of the design `docs/designs/pm-mode/design.md`. Adds to ADR 29, which stays as it was: ADR 29 says a later change of roles is a new ADR.

## Context

The PM mode asks the owner about a piece of work, a turn at a time, before anyone designs it. One skill step writes each turn's questions, with choices and a recommendation, and looks facts up in the project's files. None of the seven roles of ADR 29 fits that step. A designer writes a design from a requirements file, a challenger answers practices, a planner cuts a plan. None of them works before the requirements exist, and none is told it must never answer for the owner.

The owner, asked to choose on 21 November: "New role: interviewer (Recommended)".

## Decision

1. **A role is added: interviewer, at tier deep.** It is in `bay/roles.ts` beside the seven of ADR 29, and the kit now has eight roles. A skill step names `role: interviewer` and runs at deep.
2. **The interviewer asks, and never answers.** It writes the questions the frontier gives, each with two or three choices and a recommendation that names one of them, and gives each fact with the file and the words it rests on. It settles no question: only the owner's answer on a card does, recorded by a script.
3. **Why deep.** Asking the right questions is judgement, more than building is. A question it fails to ask costs a wrong build that is found late. A turn runs a few times for each piece of work, so the cost is small.
4. **Nothing else changes.** A role is still a name for a tier (ADR 29 item 1). The interviewer's ceiling and standing rules come with the slices that build them for every role.

## Rejected

- **No role, `tier: deep` on the step**, as the feed briefing's skills keep their tier. It says nothing about what the step must never do.
- **The designer's role for the step.** Its standing rules would be a designer's, and the interview runs before any design.

## Consequences

- The README, the glossary's Role row and `tests/roles.test.ts` list eight roles. That test holds ADR 29 to the seven roles it decided, and this ADR to the one it adds.
- The PM mode's skill `interview` names `role: interviewer`.
