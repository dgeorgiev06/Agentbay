# factory.spec

## Purpose
Turn a requirements document written for people into a spec a plan can be built from: the outcomes this run commits
to, what has to be true for each one, what is out of scope, and the questions only the owner can answer.

## Inputs
- `runId` (required): the run. Its goal, the requirements document's path and the language profile come from the
  `run` step.

## Steps
1. `run`: a code step; it returns the run's goal, the requirements document and the language profile.
2. `draft`: the analyst reads the requirements document (and nothing else it was not pointed at), writes
   `docs/factory/<runId>/spec.md`, and returns the outcomes with their acceptance criteria.
3. `record`: a code step; it records the stage and its artifact.

## Definition of Done
- [DOD-1] (must) Every outcome in the spec traces to a line of the requirements document, named in `source`.
- [DOD-2] (must) Every outcome has at least one acceptance criterion that is observable: a command, an output, a
  state change or a user-visible behaviour, never "works correctly".
- [DOD-3] (must) The spec file exists at `docs/factory/<runId>/spec.md` and is listed in `artifacts`.
- [DOD-4] (must) Anything the requirements leave open is in `questions`, with the assumption the spec proceeds on.
- [DOD-5] (must_not) No outcome is invented: a requirement the document does not state goes in `questions`.
- [DOD-6] (should) `outOfScope` names what a reader would reasonably expect and this run will not do.

## Outputs
A `Spec`: `status`, `summary`, `artifacts` (the spec file), `outcomes`, `constraints`, `outOfScope`, `questions`.

## Failure handling
- The requirements document is missing or unreadable: return `blocked` with the path.
- It is too vague to specify: write what can be specified, list the rest in `questions` and return `partial`.
