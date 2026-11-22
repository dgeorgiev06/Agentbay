# Fixtures for the capture

The reviewer's capture runs `bay check` and `bay new` on these folders and keeps what they print. Proof's settings will name them as the commands whose output must not change (`docs/adr/0022`). They live in the repository because proof judges a commit from a copy of it, and a copy holds only what the commit holds. They came unchanged from the capture's own folder; the capture script there still reads its own copy.

| Fixture | What it is | What `bay check` finds |
|---|---|---|
| `sound/` | A small project beside the kit: two modes, an interface, a skill, two workflows and a migration. The capture also runs `bay new` in a fresh copy of it. | No error and no warning. |
| `broken-overlay/` | Files copied over a copy of `sound/`: modes with a bad manifest, schema, grant, import, skill or migration, and interfaces that clash. | 67 errors: forge, which it lists, brings proof, git-worktrees and requirements and no toolchain, so proof has none. |
| `grants-overlay/` | Files copied over a copy of `sound/`: one mode, `grantbad`, that asks for a path it may not name. | One error, in `grantbad`. |
| `kit-overlay/` | Files copied over a copy of the kit: kernel files in an import cycle and one that imports `bay/cli.ts`, a stray folder, a mode whose YAML cannot be read, and stray files among the interfaces. The capture also changes two files of the kit copy, which this folder does not hold. | Six errors, one per file it adds. |

`sound/.gitignore` is part of the fixture. It ignores `schemas`, so the files under `sound/` that it covers are added to git by force.

Type check, lint and dead code leave this folder out: `tsconfig.json`, the eslint configuration and `knip.json` each exclude it, because its code is written to be broken. `tests/capture-fixtures.test.ts` holds what the table says.

## The owner's documents, frozen

Everything under `docs/requirements/`, `docs/designs/` and `docs/plans/` is the owner's and moves on as he signs new versions, so no test reads it. `tests/test-toolbox.ts` is the one place that copies the kit, with `copyKitInto` and `copyOfTheKit`: it leaves those three folders out of every copy and writes the frozen copies below at the paths the workflows expect. `tests/living-documents.test.ts` holds that, and the lint rules `agentbay/no-living-documents` and `agentbay/kit-copied-in-one-place` keep tests from reading the folders or copying the kit another way.

`todo-v1.yaml` is version 1 of `docs/requirements/todo.yaml`, the 2 outcomes and 13 conditions forge's and requirements' tests were written for. Each copy of the kit holds it at `docs/requirements/todo.yaml`, so the cards keep their words. Only `components/base/requirements/tests/check.test.ts` reads the owner's file, to check it is accepted.

`plans/` holds plans 0022, 0023 and 0024 as they were when the todo plan was approved. Each copy of the kit holds them under `docs/plans/`, so forge's tests work out real plans and the next free number for a new plan is 0025.
