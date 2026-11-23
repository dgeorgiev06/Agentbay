# Pack contract

agentbay is a Claude Code plugin marketplace. Each pack in `packs/<name>/` is one plugin. There is no framework code shared between packs.

## Layout

```
packs/<name>/
  .claude-plugin/plugin.json   name, description, version, dependencies, userConfig
  skills/<skill>/SKILL.md      contract and allowed-tools in frontmatter, short instructions in the body
  agents/<role>.md             config in frontmatter, 20-40 lines of role prose in the body
  bin/<name>                   executable entry point, on the Bash PATH while the pack is enabled
  src/                         TypeScript run directly by Node (no build step)
  tests/*.test.ts              node:test, through the command's entry point
  evals/<case>/                prompt.md + graders/*.md for `claude plugin eval`
  workflows/*.js               saved workflows (dev pack only)
```

## Commands

- `<name> <action> '<json>'` prints one JSON object to stdout and exits 0.
- An error prints `{"error": "<plain sentence>"}` to stdout and exits 1.
- `<name> schema` prints every action with its input and output shapes.
- Commands never call a model. Output stays small; large artifacts go to files referenced by path.
- State lives in one SQLite file (`node:sqlite`) at `$AGENTBAY_HOME/<name>/<name>.db`, with `AGENTBAY_HOME` defaulting to `~/.agentbay`. `CLAUDE_PLUGIN_DATA` is not used: it is absent from Bash-tool commands and deleted on uninstall. A pack never reads another pack's data.
- The database carries a schema version (`PRAGMA user_version`) and migrates forward on open.
- `<name> export` prints all of the pack's data as one JSON object, so it can be backed up or moved.
- `<name> setup` prints the permission rules to add to the user's settings, for example `{"allow": ["Bash(todo *)"]}`. A plugin cannot grant its own permissions.
- Every failure, including an unopenable store, prints `{"error"}` and exits 1; nothing reaches stderr as a stack trace.

## Canonical command shape

Packs are separate plugins, so these few pieces are copied, not shared. Copy them exactly:

- `bin/<name>`: `pack_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)` then `exec node --no-warnings "$pack_dir/src/cli.ts" "$@"`.
- `src/cli.ts`: parse argv, resolve the data dir from `AGENTBAY_HOME`, open the store, run the action, print a Result (`{ok, value} | {ok: false, error}`) with exit 0 or 1; a top-level catch turns any thrown error into `{"error"}`.
- `src/store.ts`: open SQLite at the given path, migrate by `user_version`.
- `src/rules.ts`: pure functions only.

## Skills

```yaml
---
name: add
description: Add a todo. USE WHEN the user wants to capture a task.
input:  { text: string, due?: date }
output: { id: string }
done:   The todo is stored and its id is returned.
rules:
  - Text is trimmed; blank text is refused.
allowed-tools: Bash(todo *)
---
```

`allowed-tools` lets the skill run its own command without a prompt for the turn that invokes it. `input`, `output`, `done` and `rules` are agentbay's contract for reviewers; Claude Code ignores them, so they must match `<name> schema` exactly.

Being on the PATH announces nothing, so every command a skill may run is named in its body with its input shape and one example. The body says only what the code does not enforce.

## Routing

Claude routes from skill and agent descriptions. Slash commands are the deterministic way in.

## Evals

- Every pack ships 5-10 cases under `evals/`, near-misses included.
- Graders check inputs only: the chosen skill (`tool_used: Skill`) and the command it ran with its JSON (`tool_used: Bash` with `input_match`). Never grade command output or stored state: eval runs are sandboxed and start with an empty store.
- `prompt.md` grants `allowed_tools: [Skill, Bash]`; cases that test routing between packs list the other packs under `plugins:`.
- Per change: `claude plugin eval packs/<name> --ablation none --runs 1 --allow-tools "Bash(<name> *)"`. Before a release: the full suite with default runs. Each eval run is a real model call; stop and ask before a run expected to cost more than $2.

## The cos pack

cos runs only in a dedicated home project, never as a global default: set `"agent": "cos:cos"` in that project's `.claude/settings.json`, or start with `claude --agent cos:cos`. The pack ships no `settings.json`.

## Merge rules

- No duplicated code.
- Business rules are pure functions; the clock, store, file system and network are passed in.
- Deciding stays apart from acting; no module-level state.
- Readable TypeScript following the official docs; no packing code onto long lines; no comments.
- Unused code is deleted.
- Tests go through the command's entry point, never read living documents, never call a model, run in under 30 seconds per pack, and are no larger than the code.
- Dependencies: none beyond Node built-ins without approval.
