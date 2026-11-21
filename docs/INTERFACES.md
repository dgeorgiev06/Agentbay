# agentbay interfaces: where each form is written

This file used to list what agentbay 4 called its contracts: Python modules, envs, connectors, the dispatcher, task
envelopes and ledger events. None of them is in agentbay 5, and git history keeps the old text. This page says
where each form that the built kit checks is written: the interfaces, the manifests, the toolbox and the shared types. The words are defined in [CONTEXT.md](../CONTEXT.md).

| Form | Where it is written | Checked by |
|---|---|---|
| A mode's manifest: actions, steps, effects, grants (`resources:`), settings, workflows | `schemas/mode.schema.json`; the types in `bay/generated/mode.ts` | `bay check`, and every load |
| A workflow: action, approval, wait and foreach steps | `schemas/workflow.schema.json` | `bay check` |
| A skill: its `SKILL.md`, the front matter and the sections | `schemas/skill.schema.json` for the front matter; the sections and their order in `bay/check-skills.ts` | `bay check` |
| An interface: actions with no code, named `name@major` | `schemas/interface.schema.json`; each interface in `components/base/interfaces/<name>.yaml`, its schemas in `components/base/interfaces/<name>/` | `bay check`; its shared test, `components/base/interfaces/<name>/tests/shared.ts`, run by each mode that implements it |
| The project config, `agentbay.config.yaml` | `schemas/config.schema.json`; `bay config` prints it | `bay check`, and every load |
| The toolbox, the only kernel file a mode's code imports | `bay/sdk.ts` | `bay check` (the imports a script may make) |
| The test toolbox, for a mode's tests | `tests/test-toolbox.ts` | |
| The shared types of the kernel | `bay/contracts.ts` | the type check |
| A harness adapter | the type `Adapter` in `bay/adapter.ts`; the one adapter is `adapters/claude-code/` | the type check, `adapters/claude-code/tests/` |
| The kernel's tools for a skill step's agent (`actions`, `db_query`, `files_read`, `files_list`, `files_write`, `call_action`, `submit`) | `bay/tool-definitions.ts`, served by `bay/mcp.ts` | the kernel, on every call |
| The command line | `bay --help` and `bay <command> --help`; the README's Commands table | `tests/readme-commands.test.ts` |
| The form of a plan | `components/base/forge/schemas/plan.json`; `docs/plans/README.md` | `forge.waves` |
| The form of a requirements file | the interface `requirements@1` | `requirements.check` |

To add a mode, an action, a skill, a workflow or an interface, run `bay new` (the README's Adding a mode).
