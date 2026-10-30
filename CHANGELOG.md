# Changelog

Earlier versions: see docs/proposals/

## 0.8.0 - 2026-10-30

Content types are plug-ins now: the store knows no post or email shape of its own. Stores written by 0.7.0 are refused and must be moved aside and re-synced (see Known issues). The schema apiVersion stays `agentbay/v2` until slice 9.

### Added

- Content types as plug-ins: `content-types/post` and `content-types/email`, each with a `content-type.yaml`, a fields schema, views and a `derive.py`.
- The content-type loader.
- Contract tests for content types, a golden offline test, and a core-names test.
- Mode-owned views: mail-briefing owns `v_threads` and `needs-reply`.
- Per-feature `uses:` and `skills:`, and whole-feature override of a mode's feature.
- `bay show <mode> --resolved` prints the mode as resolved.

### Changed

- The store records its content types and its schema version (now 3). A store that does not match is refused, with the fix in the message.
- Computed email fields are stored.
- A generic `threads` reader replaces the email-specific one.
- The mail-briefing config has only `important`.
- Cost keys: `posts` is now `items`, and `costPerPostUsd` is now `costPerItemUsd`.
- Help for base columns is generic.
- improve runs one call at a time.

### Removed

- The `schemas/data/post` and `schemas/data/email` schemas.
- Email code in core, and the `addr_key` SQL function.
- The single-key feature override.

### Security

- A feature's `uses:` is the intersection of the `uses:` of the open calls on its role unit, and it fails closed.

### Known issues

- Per-call `uses:` scope is a follow-up proposal.
- The apiVersion stays `agentbay/v2` until slice 9.
- Existing stores must be moved aside and re-synced.

## 0.7.0 - 2026-10-30

Contracts changed non-additively: the mode, env and config schemas changed shape (a mode lists `features:` instead of `endpoints:` and `workflows:`; an env has an `offline:` block instead of `substitutes:`; the config has `offline: boolean` instead of an `envs:` map), and 9 CLI command names are gone. 0008 schedules the `agentbay/v3` bump for slice 9, so the schema apiVersion stays `agentbay/v2` until then (see Known issues).

### Changed

- The offline switch lives inside each env. `offline: true` in `agentbay.config.yaml` rebinds the capabilities in the env's `offline:` block (for example the fake source) and forces no network and no secrets. `lint` refuses an `offline:` block that names a network host or a secret.
- The agent profile is folded into the adapter: `profile:` in `adapters/<name>/adapter.yaml`. A role's env name is the env itself.
- There is no committed example config. `bay build` writes a minimal `agentbay.config.yaml` when the project has none, and `bay config` prints every setting from the schemas. Each extension's `config.example.yaml` stays.
- Limits are set only in envs. A config setting cannot raise an env limit: `lint` refuses it and a call that tries fails with the message.
- One feature shape. A mode lists `features:`; each feature holds its `in`, `out`, `effects` and `steps` (and optional `playbook`, `rules`, `review`, `schedule`). A feature that runs an agent needs a `playbook`; a code-only feature needs no folder.
- The CLI is cut to 16 commands. An old name is an unknown command; there are no aliases.

  | old | new |
  |---|---|
  | `validate`, `lint` | `check` |
  | `boundary --base ...` | `check --base <ref> [--head --proposal --docs --json]` |
  | `ls` | `catalog --roles` |
  | `reclaim <run>` | `show reclaim <runId>` |
  | `log -n` | `status --log -n` |
  | `task new` | `note task` |
  | `dispatched <taskId> --agent ...` | `note dispatch <taskId> --agent ...` |
  | `review-record <taskId> <json>` | `note review <taskId> <json>` |
  | `mode\|feature\|connector\|env new <name>` | `new <kind> <name>` |
  | `improve decide <id> approve\|defer\|wontfix` | `approve <F-id> [--defer\|--wontfix]` |

### Removed

- The offline env files `envs/local-feeds-offline.yaml` and `envs/local-mail-offline.yaml`, and `substitutes:` in the env schema.
- `framework/agents/` and `schemas/agent.schema.json`; `agentbay.config.example.yaml`.
- The `endpoints:` and `workflows:` shape in `mode.yaml` (and the `endpoint.yaml` and `workflow.yaml` scaffold templates).
- The old command names in the table above.
- `improve weekly`. The weekly run is the four calls in order (`improve.scan`, `improve.audit`, `improve.triage`, `improve.backlog`); `framework/modes/improve/README.md` has a cron recipe.

### Security

- `bay note` and `bay show` refuse an option placed before the verb, so `note dispatch`, `note review` and `show reclaim` always match their ask rules.
- The main-thread guard asks for `note dispatch`, `note review` and `show reclaim` in any spelling: quoted, escaped, after `--project`, behind env assignments or `;` and `&&`, through any launcher, and when the word after `note` or `show` holds `{`, `$`, a backtick or a newline (brace and parameter expansion, line continuation). `--agent` sessions (an agent type with no agent id) get the prompt too. Subagent decisions are unchanged.

### Known issues

- The schema apiVersion is still `agentbay/v2` although the mode, env and config shapes changed. A v2 document in the old shape is rejected, not read. The `agentbay/v3` bump is scheduled for slice 9 of 0008.

## 0.6.0 - 2026-10-30

Contracts changed only additively (a new `improve.detect/v1` endpoint, a new `forge.extend` step); no schema changed, so the schema apiVersion stays `agentbay/v2`.

### Added

- A dead-code check for framework changes. `improve.detect/v1` has a new endpoint, `change {base}`: it audits the working tree and the tree at the merge-base of `base` and HEAD (exported as plain files, never run) and returns `{new, existing, warnings}` for unused code, unused constants, compatibility layers and complexity. `forge.extend` runs it as a `deadcode` step between implement and review, and any new finding blocks the call. The extend playbook gains DOD-14 (no new unused code or compatibility layers).
- A base that does not resolve is refused with `fetch origin (git fetch origin)`. The resolved merge-base is named in `warnings`.
- improve-detect connector 0.2.0.

### Changed

- The coordinator's dispatch decides which call a taskId belongs to; a later `spawned` record cannot stand in for it.
- A role step's submit closes every run dispatched to that call and step.
- `CHANGELOG.md` is owned by the kernel.
- B-7 scans connector code only (imports and the kernel's connector and adapter keys); prose, comments and playbooks are not scanned.
- Three over-complex functions are refactored with the same behaviour: `Guard._bash`, `ClaudeCodeAdapter._settings` and `ledger_verdicts`.

### Fixed

- `bay boundary` no longer fails a repo-root file that no component owns. Owned root files still need `touches:`.

### Known issues

- If the local `origin/main` is stale, the merge-base is the stale ref and the check can block on findings that are not new. The extend playbook says to run `git fetch origin` first; the forge coordinator playbook does not yet say so.

## 0.5.0 - 2026-10-30

Contracts changed only additively (optional fields, new event types); the schema apiVersion stays `agentbay/v2`.

### Added

- Approvals from chat, behind `approvals.chat` in `agentbay.config.yaml`. They are recorded as `user@chat-via-cos` with the user's quote, and are bound to the content shown with `bay approve --sha`.
- `bay plan`: a role records its outcome and to-do list, and ticks items with `--done <n>`.
- `bay dispatched`: the coordinator logs each agent dispatch (agent, call, step, model, tier, role, mode, inputs).
- `bay review-record`: records a review run outside a framework review step, as `review.verdict/v1`. It changes no call or gate.
- `bay show` lists the agents of a call.
- `bay status --agents` groups runs by role, mode, model and tier, with usage split among agents.
- `step.started` events carry the step's inputs.
- Review verdicts carry `cites` and `recordedPlans`.
- `improve.backlog` reports cost and duration figures.
- Git episodes include commit subjects.
- Lint flags `when: stale` on role steps.
- `permissions.ask` includes `bay approve`.

### Changed

- A gate passes only by a recorded approval of the proposal's exact content.
- `forge.extend` skips propose when the proposal already exists.
- A role-step submit is refused when no plan is recorded for it.
- The kit ignores its own build output.

### Fixed

- Guard de-quoting.
- A gate skip needs the state of the prior call.
- Ledger read fixes.
- The `claude-transcripts` root.

### Known issues

- A hook `spawned` record without a callId can stand in for a plan's dispatch (to be fixed in 0008 stage 2).
- The `./bay.sh` and `python3 -m bay.cli` spellings of `dispatched` and `review-record` prompt instead of deny for non-role subagents.
