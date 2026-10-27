# agentbay v0.2 design (approved 2026-10-26; amended 2026-10-27)

Amendments approved 2026-10-27 are folded in below: features (per-endpoint playbook,
rules, optional review declared only in mode.yaml), `bay lint`, framework vs user
content, and the `forge` framework mode. Recorded as docs/proposals/0001-v0.2-modes.md.

Replaces v0.1's AgentSpec + Layer model. Vocabulary is fixed; do not rename.

## Concepts (top to bottom)

| Concept | Is | Owns |
|---|---|---|
| **Chief of Staff** | system coordinator (the main Claude Code session) | routing user intent to mode endpoints, global status, the ledger |
| **Mode** | a job playbook: one logical job | purpose, endpoints (= features), workflows, optional coordinator role, roles used, inference settings, constraints, needed capabilities, playbook.md |
| **Feature** | one mode endpoint | in/out schemas, effects, workflow, playbook (with id'd Definition of Done), rules, optional review - all declared in mode.yaml |
| **Role** | a responsibility inside mode workflows; reusable across modes | prompt, definition of done (`doneWhen`), capabilities it uses, default agent |
| **Agent** | executor abstraction over Claude agents | runtime, default model/effort, bound environment |
| **Environment** | wiring + hard limits | capability → connector/tool bindings, secrets (names + provider), network allowlist, filesystem read/write paths, allowed models, limits |
| **Connector** | concrete tool implementing a capability interface | code, its own secrets/network usage |
| **Capability interface** | versioned contract: named endpoints with in/out JSON schemas and declared effects | — |

Agents never see connectors' secrets. Modes never name concrete tools, only capabilities.
Adding a source (e.g. Bluesky) = new connector + one binding line in an environment;
mode, roles and playbook untouched.

## Files

```
interfaces/<name>.v<N>.yaml     capability interfaces (endpoints, schemas, effects)
modes/<name>/mode.yaml          + playbook.md (coordinator), types/, skills/, config.schema.json
modes/<name>/features/<feature>/{playbook.md, rules.yaml}
roles/<name>.yaml
agents/<name>.yaml
envs/<name>.yaml
connectors/<name>/connector.yaml + code + tests/
agentbay.config.yaml            per-project user settings (validated against mode config schemas);
                                never binds capabilities - envs/ are the only place bindings live

framework/{interfaces,modes,roles,agents,envs,connectors}/   same layout, shipped and versioned with
                                the kit; users never edit it. A user name that collides with a
                                framework name is a lint error. Users add project rules via
                                agentbay.config.yaml modes.<mode>.features.<feature>.extraRules.
```

## Mode

```yaml
apiVersion: agentbay/v2
kind: Mode
metadata: { name: feed-briefing, version: 0.1.0 }
spec:
  purpose: Keep me briefed on what people I follow say; answer questions about it.
  endpoints:                     # features; interface, playbook, rules and review declared together
    sync:   { workflow: sync, in: SyncReq, effects: [network, spend, write],
              playbook: features/sync/playbook.md, rules: features/sync/rules.yaml }
    digest: { workflow: digest, in: DigestReq, out: Digest, effects: [read, network, spend, write],
              playbook: features/digest/playbook.md, rules: features/digest/rules.yaml,
              review: { role: reviewer, when: always, model: opus, effort: high } }
    ask:    { workflow: ask, in: Question, out: Answer, ... }
    prune:  { workflow: prune, schedule: daily, ... }
  coordinator: feed-lead         # optional role
  roles: [feed-lead, feed-analyst, reviewer]
  workflows:
    digest:
      - { id: refresh, run: feed.store/v1.sync, when: "stale > 2h" }   # code step, no agent
      - { id: gather,  run: feed.store/v1.query, with: { since: "$in.since|$config.lookback" } }
      - { id: themes,  role: feed-analyst, out: Digest }
      # review is injected from endpoints.digest.review (after the last step, or at `{ review: here }`)
  inference:
    default: { model: sonnet, effort: medium }
    steps: { check: { model: opus, effort: high } }
  constraints:
    lookbackMax: 30d
    monthlyPosts: 3000
    spendUsd: 5
    policies: [cite-sources, no-scraping, honor-deletions]
  needs: [feed.store/v1, feed.source/v1]
  config: config.schema.json     # what agentbay.config.yaml may set (lookback, retention, caps)
```

Step kinds: `run: <capability>/v<N>.<endpoint>` (deterministic code, no agent), `role: <role>` (agentic),
`gate: <text>` (approval: the call stops with `awaiting-approval`; resumes on `{"approved": true}`),
and the review step injected from the endpoint's `review` block. `when: "stale > 2h"` or `when: "$in.<field>"`
skips a step. `with:` substitutes `$in.x`, `$steps.<id>.x`, `$config.x`, with `a|b` fallbacks.
An endpoint may re-place a role on another agent: `agents: { builder: author }`.

## Features: playbook, rules, review

- **Playbook** (`features/<f>/playbook.md`): H2 sections in this order: Purpose, Inputs, Steps,
  Definition of Done, Outputs, Failure handling. Steps is a numbered list. Every DoD item has a stable
  id and level: `- [DOD-1] (must) Every theme cites at least 2 stored posts by url`.
- **Rules** (`features/<f>/rules.yaml`, schema `schemas/rules.schema.json`): `{id: R-n, level: must|should|must_not,
  statement, appliesTo: executor|reviewer|both, check?: <deterministic check>, refs?: [DOD ids], when?: {kind: ...}}`.
  Mode constraints, role rules, feature rules and project extraRules stack; strictest wins.
- **Review** is configured ONLY in mode.yaml: `review: { role, when: always|never, model?, effort? }`.
  Omitted or `never` = no review step. Playbooks, rules, roles, agents and envs must not contain review settings.
- **Use:** the executing role's step plan carries the playbook and the rules with appliesTo executor|both.
  Deterministic `check`s run in code before review. The reviewer gets the original task, the DoD, the rules
  with appliesTo reviewer|both and the check results, and reports per id `pass|fail|n/a` with evidence and
  severity `blocker|should-fix|nit` (`review.verdict/v1`). A failed must/must_not or any blocker => `partial`,
  and the workflow stops there.
- The framework ships one generic `reviewer` role: HOW to review. WHAT to check always comes from the
  feature's DoD and rules. Modes may define their own reviewer roles.
- **`bay lint`** (also run by `bay validate`): section presence/order, numbered steps, DoD format and unique ids,
  rules schema, unique rule ids, refs to existing DoD ids, known checks, `when.kind` values, review role exists,
  is in the mode and is placeable (agent/env/model), review settings only in mode.yaml, both files per feature,
  orphan workflows/feature folders, modes naming connectors or tools, framework/user name collisions,
  mandatory review on `forge.extend`. Errors are `file:line: message`.

## Role / Agent / Environment / Connector (shapes)

```yaml
kind: Role
spec: { prompt: ..., doneWhen: [...], uses: [feed.store/v1.query], agent: analyst }

kind: Agent
spec: { runtime: claude-code-subagent, model: sonnet, effort: medium, env: local-feeds }

kind: Environment
spec:
  bind:
    feed.source/v1: [x-api]          # connectors implementing the interface
    feed.store/v1: local-store
  secrets: { provider: keychain, allow: [X_CLIENT_ID, X_CLIENT_SECRET, X_REFRESH_TOKEN] }
  network: { allow: [api.x.com] }
  fs: { read: ["."], write: [".agentbay/data/feeds"] }
  models: [haiku, sonnet, opus]
  limits: { maxTurns: 40, maxMinutes: 20 }

kind: Connector
spec: { implements: feed.source/v1, entry: connector.py, needs: { secrets: [X_*], network: [api.x.com] } }
```

## Resolution (build time) - fail loudly with the exact gap

For every mode endpoint → workflow step:
- code step: capability bound in the environment of the mode's coordinator/agent set; connector's needs ⊆ env allows
- role step: role exists; role → agent → env; every capability the role `uses` is bound in that env; step model ∈ env.models
- effects of every endpoint used ⊆ env allows (network hosts, write paths, spend, delete)
- inference precedence: mode step > mode default > role default > agent default; env caps
- constraints stack: mode policies + role rules + feature rules + project extraRules + env hard limits; strictest wins
- review steps resolve like role steps (role exists, listed in the mode, agent -> env, model allowed)
- framework boundary: any step whose env can write the kit's `framework/`, `bay/` or `schemas/` is only
  allowed in `forge.extend`
- agents may `use` only read-only connector endpoints (via their role's use shim, which fixes the role and checks its grants);
  everything else runs as a code step in the dispatcher

## Runtime

- `bay call <mode>.<endpoint> '<json>'` is the only way to invoke endpoints. It validates input/output
  schemas, checks grants and env, runs code steps, returns agentic steps as a step plan for the coordinator,
  enforces budget, and writes ledger events (`step.started`, `step.completed` with mode, endpoint, step, role, agent, env, cost).
- Agents reach connectors only through read-only store endpoints via their role's use shim
  (`.agentbay/roles/<role>/use`); feed sources are called only by `feed.store/v1.sync`, which the dispatcher
  runs as a code step. Secrets are resolved by the dispatcher from the env's provider (keychain via
  `security find-generic-password` on macOS, env vars as fallback provider `env`), never printed or logged.
- Endpoint `schedule` is declarative only in v0.2: no runtime acts on it. Run scheduled endpoints from cron
  or a scheduler, e.g. `0 4 * * * <project>/.agentbay/bay call feed-briefing.prune '{}'`; `bay lint` warns.
- Claude Code runtime: subagents cannot spawn subagents, so a mode coordinator runs as a playbook in the
  Chief of Staff's main thread; worker roles run as generated subagents (`.claude/agents/<role>.md`).
  A future `headless` runtime (`claude -p` workers) or cloud runtime makes the coordinator a separate agent
  without changing mode files.

## Framework mode: forge

One framework mode builds agentbay itself (`framework/modes/forge/`), coordinator `forge-lead`, workers
`builder` and `reviewer`.

| endpoint | does | placement | review |
|---|---|---|---|
| `create` | `kind: mode/feature/role/connector/env` + intent: scaffold (the same templates as `bay <kind> new`), then fill; kind-scoped rules via `when: {kind}` | builder on agent `author`, env `local-authoring` (writes modes/, roles/, agents/, envs/, connectors/ only) | always (sonnet/medium) |
| `extend` | propose (docs/proposals/<id>.md) -> approval gate -> implement -> review -> release; DoD/rules hold the full code-review criteria | builder on agent `framework-builder`, env `framework-dev` (writes framework/, bay/, schemas/, docs/, tests/) | always, opus/high; lint forbids disabling it |
| `migrate` | `bay migrate` plan (dry-run diff) and apply only with `confirm: true` | code steps in `local-authoring` | always |

## Data contract

`feed.post/v1`: `{id, source, author: {handle, name}, text, url, createdAt, fetchedAt, lang?, metrics?}`.
Store: `.agentbay/data/feeds/posts.jsonl` (dedup by `source:id`), cursor state per connector,
budget usage per UTC month. Lookback: configurable (`3d`, `12h`); API covers about 7 days, the rest comes from the
store; if the request exceeds store coverage, say so.

## Approved amendments (2026-10-27)

Decided by the user after the independent review of the first implementation.

**Kept (approved as designed):**
- Role data access through per-role `use` shims: build generates `.agentbay/roles/<role>/use` for every role
  whose `uses` include read-only connector endpoints. The role is fixed inside the shim; it serves only those
  endpoints. There is no generic, caller-chosen `--role` entry point.
- Budget caps `maxPostsPerRun` and `costPerPostUsd` (default $0.005 per post), alongside `monthlyPosts` and
  `spendUsd`; strictest of mode constraint, project config and env limit wins.
- Agent `model: inherit` (used by main-thread coordinator agents).

**Removed:**
- The config-level `bindings` override. `envs/<env>.yaml` is the only place capabilities are bound; an
  `agentbay.config.yaml` containing `bindings` is rejected with a message pointing to the env. To run offline,
  bind `feed.source/v1: [fake]` in `envs/local-feeds.yaml`.
- Env `fs.base`. fs paths are always relative to the project root (the repo agents work in); an env with
  `fs.base` is rejected. The forge envs (`local-authoring`, `framework-dev`) keep the same paths (`modes`, `roles`,
  ..., `framework`, `bay`, `schemas`, ...) and resolve exactly as before because forge's project is the agentbay
  checkout itself: build the kit into itself (`./bay.sh build --project .`). The forge scaffold and migrate
  connectors refuse to run when the project is not the kit. The framework boundary check flags env write paths
  that name `framework/`, `bay/` or `schemas/` outside `forge.extend`.

**Fix-round changes (review of the first implementation):**
- Guard hook: Claude Code permission rules are session-wide and subagent `tools` take bare tool names, so a
  `PreToolUse(Bash)` hook (`bay/guard.py`, policy `.agentbay/guard.json`) scopes each generated subagent to one
  simple command at a time: its own use shim or its env's narrow command prefixes. It fails closed for subagents.
  `settings.json` carries no wildcard; the main thread is pre-approved only for `bay call|submit|status|log|note|task`.
  `bay secret set` requires a terminal; keychain values never appear in argv.
- Deletion re-checks: each sync spends up to half its read budget re-checking stored posts inside the source API
  window (x-api: official `GET /2/tweets?ids=`, batches of 100); posts the source no longer returns are removed
  and never re-stored.
- Billing on posts returned: budget usage counts every post the source returns (timeline pages and deletion
  lookups), not only posts kept; a call never requests more than its remaining read budget.
- One spelling for capability endpoints (`feed.store/v1.sync`) in run steps and role `uses`; feed.source
  connectors must declare `source` and `window`; `schedule` is declarative only (lint warns; run it from cron).

