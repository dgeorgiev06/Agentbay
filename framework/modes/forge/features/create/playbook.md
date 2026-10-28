# forge.create

## Purpose
Turn a plain-language intent into a working, lint-clean mode, feature, connector or env in user space (roles are framework-level: a new role goes through forge.extend).

## Inputs
- `kind`: mode | feature | connector | env (selects the template and the kind-scoped rules).
- `name`, `intent` (required); `target` (kind=feature: the user mode); `implements` (kind=connector: the interface).

## Steps
1. `scaffold`: the dispatcher renders the forge template for `kind` (same templates as `bay <kind> new`).
2. `fill`: the builder (in env local-authoring, user space only) proposes the content from the intent and fills every TODO: purpose, features with in/out/effects, the roles map (which framework role works in which env), needed capabilities, constraints and review settings for a mode; endpoint + playbook + rules (and skills for mode-specific behaviour) for a feature; endpoints and a fake-HTTP test for a connector; bindings and limits for an env.
3. The builder runs `./bay.sh lint` and `./bay.sh validate` and returns a Result listing every file. The coordinator (main thread, with the user) runs the tests: a subagent that writes code and runs it cannot be contained by the guard.
4. `review`: the reviewer checks the Definition of Done and rules for this kind.

## Definition of Done
- [DOD-1] (must) `./bay.sh lint` and `./bay.sh validate` pass with the new content.
- [DOD-2] (must) No TODO placeholders remain in the created files.
- [DOD-3] (must) Every file written is under modes/, envs/, connectors/ or agentbay.config.yaml.
- [DOD-4] (must) Mode and feature files name capabilities only, never concrete tools or connectors.
- [DOD-5] (must) Every feature has a playbook, rules and at least one test or demo call that exercises it.
- [DOD-6] (must) Features with write, spend, delete or external-write effects have `review: { when: always }`.
- [DOD-7] (must) A connector implements an existing interface and ships an offline test with a fake HTTP layer.
- [DOD-8] (should) The result needs no edits outside the new files, except one binding line in an env for a connector.

## Outputs
A `Result` with `artifacts` = every file created or changed.

## Failure handling
- Lint fails and the builder cannot fix it within the scope: return `partial` with the lint output.
- The intent needs a new capability interface or framework change: return `blocked` and suggest `forge.extend`.
