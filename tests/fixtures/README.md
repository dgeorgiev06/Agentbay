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
