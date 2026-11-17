# Claude Code adapter

The only part of agentbay that knows about Claude Code. `adapter.ts` exports `adapter` (contract: `bay/adapter.ts`).

## What `build` writes

All paths are in the project. Every effect goes through the file port of the request.

| File | How | What |
|---|---|---|
| `.claude/agents/<agent>.md` | created | One agent per skill step. Its `tools` are `mcp__agentbay__submit` first, then `Read, Glob, Grep` when the step has read paths, `Write, Edit` when it has write paths, `Bash` only when its mode lists a command whose every effect is declared by every action that uses the skill, and `mcp__agentbay__<tool>` for each other kernel tool. Never `Agent` and never web tools. Its `model` comes from the tier: fast `haiku`, balanced `sonnet`, deep `opus` |
| `.agentbay/steps.json` | created | The hook's policy, keyed by agent: tools, read roots, write roots (absolute) and the words of each listed command whose every effect the step's actions declare. The closed names are constants in the hook, not in this file |
| `.claude/settings.json` | merged | One `PreToolUse` entry, matcher `*`, running `node '<kit>/adapters/claude-code/step-guard.ts' --project '<root>'` with `timeout: 30` and `onFailure: "block"`. No allow or deny rules: settings rules apply to the whole session, the main thread included, so the per-step list lives only in the hook |
| `.mcp.json` | merged | The server `agentbay`: `node <kit>/bay/mcp.ts --project <root>` |
| `CLAUDE.md` | merged | The coordinator's protocol between `<!-- agentbay:start -->` and `<!-- agentbay:end -->`, added at the end or replaced in place |
| `.agentbay/build.json` | record | Each created file with its SHA-256; each merged file with what was added, whether the file existed and its text before the build; and the folders the build created |

`build` writes nothing and reports a problem when a step is granted a read or write root whose path, or whose tree (at most 5,000 entries, 12 levels), holds a closed name: a mode should not be granted a folder that holds secrets. `clean` deletes a created file only if its hash still matches, then the folders the build created if they are left empty. It takes out of each merged file exactly what the build added: when the file is unchanged since the build it gets back its old bytes; otherwise the user's later edits are kept. A file that held only agentbay's additions is deleted. Building twice changes nothing. A hand edit of a created file is overwritten by the next build, which says so. Files that are no longer built are deleted unless they were edited. Note that `build.json` keeps a copy of the earlier `settings.json`, `.mcp.json` and `CLAUDE.md`.

## What the hook does

`step-guard.ts` reads one hook payload, then decides by comparing it against lists. It never parses shell.

- **Main thread** (no `agent_id`): everything passes, except writes (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) into `.agentbay/`, `.claude/`, `.mcp.json` or the kit's `bay/`, `schemas/`, `adapters/`, `framework/`, and, when the project is not the kit, into the kit's `components/base/`. A mode placed there is granted its list with no trust, so the hook says to make the mode in the project, where the owner decides whether to trust it. When the project is the kit, writes into `components/base/` pass: building base modes is the kit's own work. Paths are resolved as for a step, through links; a path that climbs with `..` is denied.
- **A subagent missing from the policy**: denied everything.
- **A step agent**: the tool must be in its list. File paths are resolved through `realpath` of their deepest existing ancestor and must lie inside a root, with a real separator boundary. `..`, `~` and broken links are refused. Closed to every step whatever its roots, compared without case: `.agentbay`, `.claude`, `.git`, `.mcp.json`, `CLAUDE.md`, `agentbay.config.yaml`, `.env`, `.env.*`. The kit's `bay/`, `schemas/`, `adapters/`, `framework/` may be read inside a read root, and written only through a write root that itself lies inside that folder, which the kernel grants to the base mode `forge` alone. Before a search, the hook walks its folder without following links (at most 5,000 entries and 12 levels) and denies when any name in it is closed, when a link in it leads outside the read roots or to a closed location, or when the walk exceeds the bound. A search pattern may not climb, start with `~`, name a closed location or use a wildcard over hidden names. A command must equal the words of a command in the step's policy, or be those words plus a space and only `[A-Za-z0-9 _./=:,@%+-]`. Only `mcp__agentbay__*` tools that are listed pass.
- **Anything malformed or failing**: denied. A deny prints the documented `permissionDecision: "deny"` JSON, writes the reason to stderr and exits 2.

## What the hook does not stop

- Trust (ADR 21) stops a mode's script and an agent inside a run's step from granting commands to themselves. It does not stop an agent that has the owner's shell or the owner's voice in chat. The hook closes one way round it: the main thread's file tools placing a mode in the kit's `components/base/`. Three ways stay open by design:
  - The main thread's shell is not checked. It can write into `components/base/` or `.agentbay/trust.json` as the owner can.
  - A pseudo-terminal passes the terminal check of `bay approve`. An agent that runs `bay approve --trust <mode>` inside one and types `yes` gives trust.
  - A quote can be invented. When `approvals.from` lists chat, an agent that quotes words the owner did not write gives trust. The `CLAUDE.md` block tells the coordinator never to do this. Nothing enforces it.
- The main thread is not confined. Its shell can still write `.agentbay/` (for example with `echo > .agentbay/steps.json`). That is accepted for 5.0.0 because the coordinator is the owner's own session.
- The main thread may edit `agentbay.config.yaml`, including `approvals`, by owner decision: the owner has no terminal and changes settings through the coordinator. The `CLAUDE.md` block tells the coordinator to change `approvals` only when the owner asks for exactly that, in their own words. Nothing enforces it.
- A listed command that runs code runs whatever the agent wrote, for example `node --test out/evil.test.ts` or `node --test --import=./out/x.mjs`.
- Settings `allow` and `deny` rules apply to the whole session. No per-step rule lives there.
- If the hook cannot run (node missing, a kill, a timeout, the entry removed from settings), calls pass. The hook fails closed only for errors inside itself. The entry carries `onFailure: "block"`, which the current hooks page does not document (strings in Claude Code 2.1.325 suggest it exists), so the design does not rely on it: the `CLAUDE.md` block tells the coordinator to run `bay.sh check` at the start of a session and stop if the hook is not registered. That check is a later kernel slice.
- A link swapped between the check and the tool call. Only a step with a command could do that.
- The search walk sees the tree as it is when the hook runs. A step with a command could add a link or a secret between the check and the search.
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
