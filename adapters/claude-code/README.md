# Claude Code adapter

The only part of agentbay that knows about Claude Code. `adapter.ts` exports `adapter` (contract: `bay/adapter.ts`).

## What `build` writes

All paths are in the project. Every effect goes through the file port of the request.

| File | How | What |
|---|---|---|
| `.claude/agents/<agent>.md` | created | One agent per skill step. Its `tools` are `Read, Glob, Grep` when the step has read paths, `Write, Edit` when it has write paths, `Bash` only when its mode lists commands, and `mcp__agentbay__<tool>` for each kernel tool, always including `submit`. Never `Agent` and never web tools. Its `model` comes from the tier: fast `haiku`, balanced `sonnet`, deep `opus` |
| `.agentbay/steps.json` | created | The hook's policy, keyed by agent: tools, read roots, write roots (absolute), command prefixes, and the names closed to every step |
| `.claude/settings.json` | merged | One `PreToolUse` entry, matcher `*`, running `node '<kit>/adapters/claude-code/step-guard.ts' --project '<root>'` with `timeout: 30` and `onFailure: "block"`. No allow or deny rules: settings rules apply to the whole session, the main thread included, so the per-step list lives only in the hook |
| `.mcp.json` | merged | The server `agentbay`: `node <kit>/bay/mcp.ts --project <root>` |
| `CLAUDE.md` | merged | The coordinator's protocol between `<!-- agentbay:start -->` and `<!-- agentbay:end -->`, added at the end or replaced in place |
| `.agentbay/build.json` | record | Each created file with its SHA-256, and each merged file with what was added, whether the file existed and its text before the build |

`clean` deletes a created file only if its hash still matches. It takes out of each merged file exactly what the build added: when the file is unchanged since the build it gets back its old bytes; otherwise the user's later edits are kept. A file that held only agentbay's additions is deleted. Building twice changes nothing. A hand edit of a created file is overwritten by the next build, which says so. Files that are no longer built are deleted unless they were edited. Note that `build.json` keeps a copy of the earlier `settings.json`, `.mcp.json` and `CLAUDE.md`.

## What the hook does

`step-guard.ts` reads one hook payload, then decides by comparing it against lists. It never parses shell.

- **Main thread** (no `agent_id`): everything passes, except writes (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) into `.agentbay/`, `.claude/`, `.mcp.json` or the kit's `bay/`, `schemas/`, `adapters/`, `framework/`.
- **A subagent missing from the policy**: denied everything.
- **A step agent**: the tool must be in its list. File paths are resolved through `realpath` of their deepest existing ancestor and must lie inside a root, with a real separator boundary. `..`, `~` and broken links are refused. Closed to every step whatever its roots, compared without case: `.agentbay`, `.claude`, `.git`, `.mcp.json`, `CLAUDE.md`, `agentbay.config.yaml`, `.env`, `.env.*`, and the kit's four folders. A search may not run in a folder that holds a closed location, and its pattern may not climb, start with `~`, name a closed location or use a wildcard over hidden names. A command must equal a listed prefix, or be the prefix plus a space and only `[A-Za-z0-9 _./=:,@%+-]`. Only `mcp__agentbay__*` tools that are listed pass.
- **Anything malformed or failing**: denied. A deny prints the documented `permissionDecision: "deny"` JSON, writes the reason to stderr and exits 2.

## What the hook does not stop

- The main thread is not confined. Its shell can still write `.agentbay/` (for example with `echo > .agentbay/steps.json`). That is accepted for 5.0.0 because the coordinator is the owner's own session. The main thread may also edit `agentbay.config.yaml`.
- A listed command that runs code runs whatever the agent wrote, for example `node --test out/evil.test.ts` or `node --test --import=./out/x.mjs`.
- Settings `allow` and `deny` rules apply to the whole session. No per-step rule lives there.
- Only Claude Code can make the hook fail closed when the hook itself does not run (node missing, a kill, a timeout). That depends on `onFailure: "block"`. The current hooks page does not document that field; strings in Claude Code 2.1.325 suggest it exists. Without it, a hook that never runs lets the call through.
- A link swapped between the check and the tool call. Only a step with a command could do that.
- A search can reach a nested `.env` or `.git` below a read root through a pattern that names neither, such as `**/*`, if Claude Code's search includes hidden files.
- The hook does not check MCP tool arguments or task tokens; the kernel does.
- Every step can read its own mode folder, because the policy includes it in the read paths.
- None of this has run inside a live Claude Code session. It is unverified until the owner's first real run.

## Documentation relied on (read 2026-11-14)

- https://code.claude.com/docs/en/hooks: `agent_id` (present only inside a subagent), `agent_type`, absolute `file_path`, the deny JSON, exit 2, matcher `*`, and that timeouts and other exit codes do not block.
- https://code.claude.com/docs/en/sub-agents: the front matter fields, `tools` as a comma-separated list, the `Agent` tool (renamed from `Task`), and the model aliases.
- https://code.claude.com/docs/en/model-config: `haiku` for simple tasks, `sonnet` for daily coding, `opus` for complex reasoning.
- https://code.claude.com/docs/en/tools-reference: tool names, and that Glob and Grep are present for a subagent that lists them without `Bash`.
- https://code.claude.com/docs/en/permissions: rules are not a security boundary around a program, and deny wins over allow.
- https://code.claude.com/docs/en/mcp: the `.mcp.json` `mcpServers` format, and that project servers ask for approval.
