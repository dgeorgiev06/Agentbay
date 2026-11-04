# delivery.build

## Purpose
Make one change in the repository that meets a concrete deliverable, verified and independently reviewed.

## Inputs
- `goal`, `deliverable` (required); `context`, `inputs`, `constraints` (optional).

## Steps
1. `implement`: the builder reads the relevant code, states a one-paragraph plan, implements the smallest coherent change and runs the relevant checks.
2. The builder returns a Result listing every changed file.
3. `standards`: a code step, `standards.check/v1.findings` with `base: $call.base`. It ends the call `blocked` when the change adds a finding against the commit the call started from.
4. `review`: the reviewer judges the output against this Definition of Done and the rules.

## Definition of Done
- [DOD-1] (must) The deliverable exists exactly as stated.
- [DOD-2] (must) Relevant tests or smoke checks were run and their outcome is reported.
- [DOD-3] (must) Every changed file is listed in `artifacts`.
- [DOD-4] (should) Nothing outside the deliverable was changed.
- [DOD-5] (must) The `standards` step reports no new finding.
- [DOD-6] (must) No `#` comment and no docstring longer than one line; a reason goes in a name, an error message or the README.

## Outputs
A `Result` (`status`, `summary`, `artifacts`, `followups`, `blockers`).

## Failure handling
- Checks cannot be run: return `partial` and say what is unverified.
- The task needs tools the builder lacks: return `blocked`, do not improvise.
