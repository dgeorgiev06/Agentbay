# forge.migrate

## Purpose
Keep user modes, roles, agents, envs and connectors working across framework versions.

## Inputs
- `to` (optional): target version, default the kit version.
- `confirm` (optional, default false): apply the planned changes; without it the call is a dry run.

## Steps
1. `plan`: the dispatcher computes the migration plan and a unified diff; nothing is written.
2. `apply`: only when `confirm` is true, the dispatcher applies exactly the planned changes.
3. `review`: the reviewer checks the diff (dry run) or the applied result.

## Definition of Done
- [DOD-1] (must) A dry run writes nothing and returns a diff of every planned change.
- [DOD-2] (must) Apply performs only the changes shown by the dry run.
- [DOD-3] (must) After apply, `./bay.sh lint` and `./bay.sh validate` pass.
- [DOD-4] (should) Every change carries a note saying why.

## Outputs
`{changes, diff}` for a dry run; `{changes, applied, notes}` after apply.

## Failure handling
- Content that cannot be migrated automatically is listed in `notes`; fix it by hand or with forge.create.
