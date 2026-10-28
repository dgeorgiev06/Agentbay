# Claude Code transcript format (research notes, 2026-10-27)

**Status:** the on-disk format is NOT officially documented as stable. Parse defensively.
- "Documented" means official docs (code.claude.com hooks page; Agent SDK session-browser cookbook).
- "Community" means third-party docs (evilpiepirate transcript-format doc, claude-dev.tools).
- "Observed" means seen in one real local session (structure only).

## Layout
- `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, one file per session (documented). The filename stem is the `sessionId`.
- Don't decode `<encoded-cwd>`: the encoding is lossy. Take the project from the `cwd` field.
- `<session-id>/subagents/agent-<agentId>.jsonl` holds a subagent transcript. `agent-<agentId>.meta.json` holds `agentType`, `isBuiltIn`, `description`, `toolUseId`, `spawnDepth`, `model`, and `finished` (observed).
- Skip these (observed): `<session-id>/subagents/*.prefix.json` (cache diagnostics), `<session-id>/tool-results/*.txt` (spilled large outputs; keep name and size only), `ccr-tip.json`.
- The file can be appended while a session is live, so tolerate a half-written last line. The SDK appends rename and tag metadata entries; the latest wins.
- Official SDK helpers `list_sessions` and `get_session_messages` exist and are documented. Prefer them for conversation text when available.

## Record types (dispatch on top-level `type`; allowlist; unknown types are counted, never errors)
- **Common chain fields** (community): `uuid`, `parentUuid` (null at the root), `sessionId`, `timestamp` (ISO), `cwd`, `version`, `gitBranch`.
- **Common chain fields** (observed): `isSidechain`, `userType`, `entrypoint`.
- **`user`:** `message.content` is a string or blocks.
  - Blocks are `text` or `tool_result{tool_use_id, content, is_error?}`.
  - Optional: `isMeta`, `permissionMode`, `toolUseResult` (shape varies by tool), `sourceToolAssistantUUID`, `permissionDecision{decision, source, reasonType, ruleSource}`, `toolDenialKind`.
- **`assistant`:** `message{id, model, role, content[], stop_reason, usage}`, `requestId`.
  - Blocks are `text`, `thinking`, and `tool_use{id, name, input}`.
  - One API response is split across records that share `message.id`. Group by `message.id` and take the last `usage`.
  - `usage` has `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
- **`attachment`:** `attachment{type, ...}`. These are context injections, not turns. Exclude them from turn counts.
- **`system`:** keyed by `subtype`. `stop_hook_summary` has `hookCount`, `hookInfos[{command, durationMs}]`, `hookErrors[]`, `preventedContinuation`, `stopReason`.
- **Non-chain records:** `queue-operation{operation, timestamp, content?}`, `last-prompt`, `mode`, `pr-link{prNumber, prUrl, prRepository}`, `tools-used`, and `cost-state`.
  - `cost-state` is a running snapshot; take the last one per session. Fields: `totalCostUSD`, `totalAPIDuration`, `totalToolDuration`, `totalLinesAdded`, `totalLinesRemoved`, `totalDuration`, `modelUsage{<model>:{inputTokens, outputTokens, cacheRead..., costUSD}}`.
- **Seen only in third-party docs:** `progress` (hook progress) and `file-history-snapshot`. Tolerate both.

## Detection rules
- **Tool error:** a `tool_result` with `is_error: true`, paired with its call by `tool_use_id`. Treat an absent flag as success. For Bash, also check `toolUseResult.stderr`.
- **Permission denial:** a `tool_result` with `is_error: true` plus `toolDenialKind` (seen: `"user-rejected"`). Allowed calls carry `permissionDecision.decision == "accept"`.
- **User interrupt:** user text starting with `[Request interrupted by user]` or `[Request interrupted by user for tool use]` (prefix match, case-insensitive), or `toolUseResult.interrupted`.
- **Subagent start:** an assistant `tool_use` named `Agent` (older versions: `Task`), with input `description`, `prompt`, `subagent_type`, `model`, `run_in_background`. It links to the subagent file through `.meta.json` `toolUseId`, and through `toolUseResult.agentId` = `agent-<agentId>`.
- **Subagent end:** `.meta.json` `finished: true`, or the Agent `toolUseResult.status`, or the last record in the sidechain file.
- **Compaction (best effort; not observed):** a user message starting with "This session is being continued from a previous conversation that ran out of context." Possibly also `isCompactSummary` or a system compact-boundary subtype. Report "not detected" rather than 0.
- **Model:** `assistant.message.model` and `requestedModel`.
- **Cost:** from the last `cost-state`. Per-message cost isn't recorded.

## Parsing strategy
- Stream line by line, catching errors per line.
- Read only the fields you need, with defaults. Never validate against a closed schema.
- Rebuild chains by `uuid`/`parentUuid`.
- Pair `tool_use` with `tool_result`.
- Merge assistant parts by `message.id`.
- Treat each subagent as its own episode, linked to its parent call.
- Record `version`/`entrypoint` and fall back to a generic path when they're unfamiliar.
- Make re-parsing idempotent, keyed by `sessionId` plus file size and mtime.

## Redaction (default: structure and metadata only)
- **Sensitive:**
  - message text and thinking; `lastPrompt`; `queue-operation.content`
  - `tool_use.input` (especially Bash `command`, file contents, URLs, subagent `prompt`)
  - `tool_result.content` and `toolUseResult.*` (`stdout`, `stderr`, `originalFile`, `structuredPatch`, ...)
  - `attachment.content` (including memory context)
  - `cwd`/paths/`gitBranch`/PR URLs (hash or truncate)
  - hook commands; `.meta.json` `description`; spill files
- **Default:** keep only counts, names, durations, error booleans, token counts and model. Drop free text unless opted in.
- **When text is kept:** run a secret scan (API keys, bearer tokens, private keys, JWTs, `password=`, connection strings, cloud keys) before any write.
- Never log raw lines.
