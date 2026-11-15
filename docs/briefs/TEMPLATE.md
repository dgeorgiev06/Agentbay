# Brief <id>: <what will be true when this is done>

Slice for one builder. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

## Input

- The branch and the worktree.
- The decision records this slice carries out.
- `framework/practices.md` and the toolchain's practices file (for TypeScript, `components/base/typescript/practices.md`).
- The files to read, by path.

## Output

A numbered list of what exists when the slice is done. Then one paragraph on what is out of scope and which slice owns it.

## Definition of done

- [DOD-<id>-n] (must | should | must_not) One checkable statement each. No "if": the reviewer decides conditions before the brief is written. Always include:
  - the test that is written first and how it is seen failing (P-17);
  - what is deleted (P-11) and the same thing in more than one place (P-12);
  - the proof on the real thing (P-19): the command or session, named;
  - `npm run check` passes; the debt file and the detector count do not rise;
  - size before and after, reported and never targeted (P-13).

## Instructions

Ordered steps. The first is always: run `npm run check` before any edit and record the baseline.

## Tools

Every command in full. Never "as in another brief".

## Resources

The files the builder will open, by path.

## Rules and constraints

The practice ids that matter most for this slice, commit rules, the safety rules, and what the report contains (P-22).
