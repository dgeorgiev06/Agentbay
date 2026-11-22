# Claude Code adapter

The only part of agentbay that knows about Claude Code. `adapter.ts` exports `adapter` (contract: `bay/adapter.ts`).

## What `build` writes

All paths are in the project. Every effect goes through the file port of the request.

| File | How | What |
|---|---|---|
| `.claude/agents/<agent>.md` | created | One agent per skill step. Its `tools` are `mcp__agentbay__submit` first, then `Read, Glob, Grep` when the step has read paths, `Write, Edit` when it has write paths, `Bash` only when its mode lists a command whose every effect is declared by every action that uses the skill, and `mcp__agentbay__<tool>` for each other kernel tool. Never `Agent` and never web tools. Its `model` and `effort` come from the step's tier, as the next section says |
| `.agentbay/steps.json` | created | The hook's policy, keyed by agent: tools, read roots, write roots (absolute) and the words of each listed command whose every effect the step's actions declare. The closed names are constants in the hook, not in this file |
| `.claude/settings.json` | merged | One `PreToolUse` entry, matcher `*`, running `node --disable-warning=ExperimentalWarning '<kit>/adapters/claude-code/step-guard.ts' --project '<root>'` with `timeout: 30` and `onFailure: "block"`. No allow or deny rules: settings rules apply to the whole session, the main thread included, so the per-step list lives only in the hook |
| `.mcp.json` | merged | The server `agentbay`: `node <kit>/bay/mcp.ts --project <root>` |
| `CLAUDE.md` | merged | The coordinator's protocol between `<!-- agentbay:start -->` and `<!-- agentbay:end -->`, added at the end or replaced in place |
| `.agentbay/build.json` | record | Each created file with its SHA-256; each merged file with what was added, whether the file existed and its text before the build; and the folders the build created |

`build` writes nothing and reports a problem when a step is granted a read or write root whose path, or whose tree (at most 5,000 entries, 12 levels), holds a closed name: a mode should not be granted a folder that holds secrets. One `.git` entry is not closed to this rule: a regular file, not a link, whose whole text is one line `gitdir: <path>`, with `<path>` a folder directly in the project's own `.git/worktrees/`, by its real path, as git writes it in a worktree it adds. The hook still denies a step every path with a `.git` segment, that pointer included. `clean` deletes a created file only if its hash still matches, then the folders the build created if they are left empty. It takes out of each merged file exactly what the build added: when the file is unchanged since the build it gets back its old bytes; otherwise the user's later edits are kept. A file that held only agentbay's additions is deleted. Building twice changes nothing. A hand edit of a created file is overwritten by the next build, which says so. Files that are no longer built are deleted unless they were edited. Note that `build.json` keeps a copy of the earlier `settings.json`, `.mcp.json` and `CLAUDE.md`.

## Tiers

A skill step names a tier, `fast`, `balanced` or `deep`, or a role, which gives it the role's tier in `bay/roles.ts`; the adapter is handed only the tier. The config's `tiers` may give each tier a model and an effort:

```yaml
tiers:
  balanced: { model: sonnet, effort: medium }
  deep: { model: opus, effort: medium }
```

`build` writes them into the agent file as `model` and `effort`. A tier the config leaves out keeps the adapter's model (fast `haiku`, balanced `sonnet`, deep `opus`, held in `tiers.ts`) and gets no `effort` line, so the session's effort applies. A tier with no `effort` gets none either. The config's schema closes the tier names and the efforts (`low`, `medium`, `high`, `xhigh`, `max`). The model is checked here: `build` refuses a name other than `haiku`, `sonnet`, `opus` and `fable`, says which it knows, and writes nothing. Full model ids and `inherit` are not accepted. After the setting changes, run `bay build`: it reports each agent file it updated. `bay check` does not yet see the adapter, so it neither refuses an unknown model nor says the built agents are stale.

Claude Code's own order still applies above the agent file: the environment variable `CLAUDE_CODE_EFFORT_LEVEL` overrides `effort`, and the coordinator may pass an effort when it starts a step agent.

## What the hook does

`step-guard.ts` reads one hook payload, then decides by comparing it against lists. It never parses shell.

- **Main thread** (no `agent_id`): everything passes, except writes (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) into `.agentbay/`, `.claude/`, `.mcp.json` or the kit's `bay/`, `schemas/`, `adapters/`, `framework/`, and, when the project is not the kit, into the kit's `components/base/`. A mode placed there is granted its list with no trust, so the hook says to make the mode in the project, where the owner decides whether to trust it. When the project is the kit, writes into `components/base/` pass: building base modes is the kit's own work. Paths are resolved as for a step, through links; a path that climbs with `..` is denied.
- **A subagent missing from the policy**: denied everything.
- **A step agent**: the tool must be in its list. File paths are resolved through `realpath` of their deepest existing ancestor and must lie inside a root, with a real separator boundary. `..`, `~` and broken links are refused. Closed to every step whatever its roots, compared without case: `.agentbay`, `.claude`, `.git`, `.mcp.json`, `CLAUDE.md`, `agentbay.config.yaml`, `.env`, `.env.*`. The kit's `bay/`, `schemas/`, `adapters/`, `framework/` may be read inside a read root, and written only through a write root that itself lies inside that folder, which the kernel grants to the base mode `forge` alone. Before a search, the hook walks its folder without following links (at most 5,000 entries and 12 levels) and denies when any name in it is closed, when a link in it leads outside the read roots or to a closed location, or when the walk exceeds the bound. A search pattern may not climb, start with `~`, name a closed location or use a wildcard over hidden names. A command must equal the words of a command in the step's policy, or be those words plus a space and only `[A-Za-z0-9 _./=:,@%+-]`. Only `mcp__agentbay__*` tools that are listed pass.
- **A step agent's `mcp__agentbay__submit` that passes**: before it exits, the hook records a sighting in `.agentbay/hook-sightings.db`, a SQLite file it makes with mode 0600: the SHA-256 of the call's `token`, and the agent with the mode and skill `steps.json` gives it. A call from the main thread, from a subagent missing from the policy, or without a token records nothing.
- **Anything malformed or failing**: denied. A deny prints the documented `permissionDecision: "deny"` JSON, writes the reason to stderr and exits 2.

## How the kernel knows the hook saw a step

The config's `skillSteps.run` says how skill steps run. With `with-the-hook`, the default, the kernel takes a skill step's output only when the adapter's `hookSaw` finds an unused sighting of that output's token by that step's mode and skill, and uses it up. One sighting lets one answer through. Otherwise the kernel refuses, says what was missing and the two ways on, and the run still waits. With `without-the-hook`, the kernel takes the output. Either way, the run's events hold one `skill.hook` event per answer taken: `{ stepKey, hookSaw, skillSteps }`. The kernel reads the setting from the config when each answer arrives, so a change applies to a step already waiting. `bay check` says which way the project runs and warns when it runs without the hook.

A step agent cannot record a sighting for itself while the hook runs. `.agentbay` is closed to its `Write`, `Edit` and `Read`, through links too; its `Bash` runs only the words of a listed command; the kernel's `files_write` refuses `.agentbay`; and no kernel tool records a sighting. A submit from the main thread, or from another step's agent, records a sighting that does not match the step. Text in the sightings file is not a SQLite database and is not believed.

What a sighting cannot prove:

- A step whose mode lists a command that runs code can run code it wrote, and that code can write the sightings file. The hook does not stop it (see below). A step with no such command cannot.
- In a session without the hook, nothing records sightings, so with `with-the-hook` every output is refused. A step agent there is not confined, and one with `Bash` can write a sighting itself. One with only `Write` and `Edit` would have to write a whole SQLite file holding the SHA-256 of its token as text.
- The main thread can write the sightings file with its shell, as it can write the rest of `.agentbay/`.
- A sighting says the hook let the step's agent hand in that token. It does not say which output: the next output handed in with that token uses it.

## What the hook does not stop

- Trust (ADR 21) stops a mode's script and an agent inside a run's step from granting commands to themselves. It does not stop an agent that has the owner's shell or the owner's voice in chat. The hook closes one way round it: the main thread's file tools placing a mode in the kit's `components/base/`. Three ways stay open by design:
  - The main thread's shell is not checked. It can write into `components/base/` or `.agentbay/trust.json` as the owner can.
  - A pseudo-terminal passes the terminal check of `bay approve`. An agent that runs `bay approve --trust <mode>` inside one and types `yes` gives trust.
  - A quote can be invented. When `approvals.from` lists chat, an agent that quotes words the owner did not write gives trust. The `CLAUDE.md` block tells the coordinator never to do this. Nothing enforces it.
- The main thread is not confined. Its shell can still write `.agentbay/` (for example with `echo > .agentbay/steps.json`). That is accepted for 5.0.0 because the coordinator is the owner's own session.
- The main thread may edit `agentbay.config.yaml`, including `approvals`, by owner decision: the owner has no terminal and changes settings through the coordinator. The `CLAUDE.md` block tells the coordinator to change `approvals` only when the owner asks for exactly that, in their own words. Nothing enforces it.
- A listed command that runs code runs whatever the agent wrote, for example `node --test out/evil.test.ts` or `node --test --import=./out/x.mjs`.
- Settings `allow` and `deny` rules apply to the whole session. No per-step rule lives there.
- If the hook cannot run (node missing, a kill, a timeout, the entry removed from settings), calls pass. The hook fails closed only for errors inside itself. It then records no sighting, so with `skillSteps.run` at `with-the-hook` the kernel refuses the step's output. The entry carries `onFailure: "block"`, which the current hooks page does not document (strings in Claude Code 2.1.325 suggest it exists), so the design does not rely on it: the `CLAUDE.md` block tells the coordinator to run `bay.sh check` at the start of a session and, when skill steps run with the hook, stop if the hook is not registered. That check is a later kernel slice.
- A link swapped between the check and the tool call. Only a step with a command could do that.
- The search walk sees the tree as it is when the hook runs. A step with a command could add a link or a secret between the check and the search.
- The hook does not check MCP tool arguments or task tokens; the kernel does. It reads the token of a step's submit only to record the sighting.
- Every step can read its own mode folder, because the policy includes it in the read paths.
- None of this has run inside a live Claude Code session. It is unverified until the owner's first real run.

## Documentation relied on (read 2026-11-14)

- https://code.claude.com/docs/en/hooks: `agent_id` (present only inside a subagent), `agent_type`, absolute `file_path`, the deny JSON, exit 2, matcher `*`, and that timeouts and other exit codes do not block.
- https://code.claude.com/docs/en/sub-agents: the front matter fields, `tools` as a comma-separated list, the `Agent` tool (renamed from `Task`), and the model aliases.
- https://code.claude.com/docs/en/subagents (read 2026-11-18): the `effort` field with `low`, `medium`, `high`, `xhigh` and `max`, whose levels depend on the model; the aliases `sonnet`, `opus`, `haiku` and `fable`; and that `CLAUDE_CODE_EFFORT_LEVEL` and an effort passed when the agent is started override the field.
- https://code.claude.com/docs/en/model-config: `haiku` for simple tasks, `sonnet` for daily coding, `opus` for complex reasoning.
- https://code.claude.com/docs/en/tools-reference: tool names, and that Glob and Grep are present for a subagent that lists them without `Bash`.
- https://code.claude.com/docs/en/permissions: rules are not a security boundary around a program, and deny wins over allow.
- https://code.claude.com/docs/en/mcp: the `.mcp.json` `mcpServers` format, and that project servers ask for approval.
