---
# Core and existing-extension paths that step 1 edits (Part A: "Proposals declare crossings").
# `slice` is the step-1 slice (HANDOFF.md); `planned: true` marks slices not built yet.
touches:
  # slice 1: quiet checks, component map, bay boundary
  - { path: framework/components.yaml, reason: the component map (Part A), slice: 1 }
  - { path: schemas/components.schema.json, reason: schema of the component map, checked by lint, slice: 1 }
  - { path: bay/boundary.py, reason: "`bay boundary`: B-1, B-2, B-3, B-11 (Part F)", slice: 1 }
  - { path: bay/proposal.py, reason: "parses a proposal's front-matter touches:", slice: 1 }
  - { path: bay/cli.py, reason: "`bay boundary`; slice 2 adds `bay auth <connector>` and `bay config example`", slice: 1 }
  - { path: bay/lint.py, reason: "validates framework/components.yaml; later slices add B-4, B-6, B-7, B-8", slice: 1 }
  # slice 2: ownership by folder, discovery, self-describing extensions, docs describe contracts only
  - { path: bay/adapters/, reason: adapters move to adapters/ (B-4), slice: 2 }
  - { path: bay/adapter.py, reason: the Adapter protocol and discovery by folder (no registry dict), slice: 2 }
  - { path: adapters/, reason: the new adapters folder, slice: 2 }
  - { path: framework/envs/framework-dev.yaml, reason: "forge.extend may write adapters/ (it could write bay/adapters/ before the move)", slice: 2 }
  - { path: framework/interfaces/, reason: core interfaces live under framework/interfaces/ (B-4), slice: 2 }
  - { path: interfaces/items.*, reason: items.* move to framework/interfaces/, slice: 2 }
  - { path: bay/model.py, reason: discovery by folder; config schemas that extend; versioned reads/produces; feature.yaml, slice: 2 }
  - { path: bay/registry.py, reason: catalog lists discovered extensions, slice: 2, planned: true }
  - { path: bay/config.py, reason: "`bay config example` assembles per-extension config.example.yaml", slice: 2 }
  - { path: schemas/, reason: config schemas extend (slice 2), versioned contracts (slice 3), feature.yaml (slice 4), slice: 2 }
  - { path: agentbay.config.example.yaml, reason: assembled from the extensions' examples, slice: 2 }
  - { path: README.md, reason: describes contracts, never instances (B-11), slice: 2, planned: true }
  - { path: docs/DESIGN.md, reason: describes contracts, never instances (B-11), slice: 2, planned: true }
  - { path: docs/INTERFACES.md, reason: describes contracts, never instances (B-11), slice: 2, planned: true }
  - { path: "connectors/*/", reason: "per-extension README.md and config.example.yaml; offline transports for contract tests (slice 6)", slice: 2 }
  - { path: "envs/*.yaml", reason: bindings follow the moved interfaces, slice: 2, planned: true }
  - { path: "modes/*/mode.yaml", reason: "per-mode README/config example (slice 2); versioned reads/produces (slice 3)", slice: 2, planned: true }
  - { path: framework/connectors/corpus-store/, reason: implements the moved items.* interfaces, slice: 2, planned: true }
  - { path: "modes/*/README.md", reason: per-extension README (Part A self-description), slice: 2 }
  - { path: "modes/*/config.example.yaml", reason: per-extension example config, assembled by `bay config example`, slice: 2 }
  - { path: framework/modes/improve/, reason: "README.md and config.example.yaml (Part A self-description)", slice: 2 }
  - { path: framework/connectors/claude-transcripts/, reason: "README.md and config.example.yaml (Part A self-description)", slice: 2 }
  - { path: framework/modes/forge/templates/, reason: "scaffolded modes and connectors get a README.md (Part A self-description)", slice: 2 }
  - { path: bay/scaffold.py, reason: "scaffolds write a README.md (slice 2); per-mode skill namespaces and touches: (slice 3)", slice: 2 }
  - { path: modes/mail-briefing/, reason: "login hints name `bay auth <connector>`, not a connector; config.schema.json holds only its own keys", slice: 2 }
  - { path: "modes/mail-briefing/features/*/playbook.md", reason: "login hints name `bay auth <connector>`, not a connector", slice: 2 }
  # slice 3: versioned reads/produces/needs/implements, no extension names another, skill namespaces
  - { path: framework/rules/conformance.yaml, reason: C-7 vocabulary, C-11, slice: 3, planned: true }
  - { path: bay/improve/, reason: "conformance checks (slice 3); `boundary-crossing` detector (slice 7)", slice: 3, planned: true }
  - { path: "modes/*/skills/", reason: per-mode skill namespaces, slice: 3, planned: true }
  # slice 4: feature.yaml and whole-feature override
  - { path: "modes/*/features/*/", reason: feature.yaml per feature (workflow, skills, uses:), slice: 4, planned: true }
  - { path: "framework/modes/*/features/*/", reason: feature.yaml per framework-mode feature, slice: 4, planned: true }
  # slice 5: per-feature uses: in the use shim (security)
  - { path: bay/use_shim.py, reason: "enforces a feature's uses: (B-9)", slice: 5, planned: true }
  - { path: bay/dispatch.py, reason: passes the step's feature to the use shim, slice: 5, planned: true }
  # slice 7: forge.extend rewrite
  - { path: framework/modes/forge/mode.yaml, reason: "extend's steps: foreach slices, code check step", slice: 7, planned: true }
  - { path: framework/modes/forge/playbook.md, reason: the shared slice-and-handoff protocol and quiet checks (Part C), slice: 7, planned: true }
  - { path: framework/modes/improve/features/audit/, reason: the boundary-crossing detector, slice: 7, planned: true }
  - { path: framework/roles/, reason: builder and reviewer briefs generated from the playbook, slice: 7, planned: true }
---
# 0006 - Components that own their contracts, and content types as plug-ins

- Status: approved by the user 2026-10-29 (revision 8: Part E, features as self-contained units, and Part F, a check for every boundary, added at the user's request). Nothing is implemented yet.
- Revision 2 follows review by the user:
  - no registration edits;
  - core components own their contracts;
  - contract tests;
  - "kind" renamed and explained.
- Revision 3: named **content type** (user decision 2026-10-29); views split between the content type
  and the mode; content types are user space, created with `forge.connect`.
- Revision 5: user decisions 2-4 recorded; steps re-sequenced because #9 merges first.
- Revision 4: Part C, a new forge.extend (slices, handoff file, check step, observable DoD), added at
  the user's request.
- PR #9 (mail-briefing) merges first (user decision 2026-10-29); step 2 then moves email into a content type with the posts.
- Feature: forge.extend (framework change)

## Problem

The first requirement for agentbay was modular components with well-defined boundaries. Adding Gmail
showed that the briefing layer does not have them, and that nothing would have caught it.

**1. Source-specific code lives in shared code.** PR #9 changes 12 shared framework files (about 660
lines) to add one source. On main, X's posts already leak in the same way.

| Shared file | What is source-specific in it |
|---|---|
| `bay/sqlsandbox.py` | the fixed view list (`v_posts`, `v_email`, `v_threads`, `v_attachments`, `v_attachment_fts`), their column docs, `MAIL_VIEWS`, the SQL function `addr_key` |
| `framework/connectors/corpus-store/corpus_store.py` | the `attachments` table, its FTS and triggers, the email author mapping, moving attachment text out of `ext` |
| `bay/selector.py` | `addr_key` with Gmail dot rules, the `label:`/`in:` prefix handling |
| `bay/model.py` | knows the `post/v1` extension by name |
| `bay/cli.py` | `bay auth gmail`, which names the `gmail-api` connector |
| `bay/adapters/__init__.py` | a hand-edited dictionary of runtime adapters |
| `modes/mail-briefing/config.schema.json` | a full copy of briefing's settings plus one key, because a child cannot extend its parent's config schema |
| README, DESIGN, INTERFACES | hand-kept lists of modes, connectors and envs |

**2. The constraint is not written down anywhere it can be checked.**
- forge.extend's rules cover review, versions, tests, docs, secrets, the approval gate and scope.
- Its playbook's DOD-4 only covers a new source of an existing type, and says nothing about shared code.
- Conformance C-8 and C-9 check mode → role → agent → env → connector, not the layering inside the framework.
- No check or improve detector looks at which files a change touches.

**3. The spec and the briefs led the builder across the boundary.**
- Proposal 0003 hard-coded per-type views into the shared store.
- 0005 followed that pattern.
- The build brief said to "add them to the SQL sandbox allowlist the same way the existing views are".
- Builders ran as plain subagents with hand-written briefs, not through `bay call forge.extend`.

**4. Builders run out of room.** forge.extend's `implement` is one builder run for a whole proposal.
The last three builders each used 370-420k tokens over about 100 tool calls. On top of that, the test
runner prints one line per test (300+ lines), and builders run it 10-20 times.

## Principle

> **An extension is a new folder that satisfies a contract. It edits nothing else.**

There are two sorts of component:
- **Core components** define contracts: the schema an extension must match, the tests it must pass, and where it is discovered. They find and load every instance. Core components change only through an approved framework proposal.
- **Extensions** (a mode, a connector, an env, an content type) are instances of a contract. Each lives in its own folder and carries its own code, docs, example config and fixtures.

There is no registration step. The core finds extensions by folder, the catalog lists them, and docs
never keep a hand-written list of them.

## A. Core components and their contracts

`framework/components.yaml` is the map. Each core component lists the paths it owns and the
contracts it defines:

```yaml
components:
  kernel:            # loader, resolver, lint, registry, dispatcher, ledger, guard, CLI
    owns: [bay/, schemas/, framework/agents/, framework/roles/, framework/rules/]
    contracts:
      mode:      { at: "modes/<name>/",           schema: schemas/mode.schema.json,        tests: tests/contracts/mode.py }
      env:       { at: "envs/<name>.yaml",        schema: schemas/environment.schema.json }
      connector: { at: "connectors/<name>/",      schema: schemas/connector.schema.json,   tests: tests/contracts/connector.py }
      interface: { at: "interfaces/<name>.yaml",  schema: schemas/interface.schema.json }
      adapter:   { at: "bay/adapters/<name>.py",  protocol: bay/adapters/base.py }
  briefing:          # corpus store, SQL sandbox, selector matcher, the briefing base mode
    owns: [framework/connectors/corpus-store/, bay/sqlsandbox.py, bay/selector.py,
           interfaces/items.*, modes/briefing/]
    contracts:
      contentType:  { at: "content-types/<name>/",      schema: schemas/content-type.schema.json,   tests: tests/contracts/content_type.py }
      source:    { implements: items.source/v1,                                           tests: tests/contracts/items_source.py }
```

Framework modes (`cos`, `forge`, `improve`) are extensions too: instances of the mode contract that
ship with the kit.

**What each contract guarantees:**
- **Discovery:** the core loads every folder found at `at:`. That removes the adapter dictionary and `bay auth gmail`: the CLI's `bay auth <connector>` calls the connector's declared `login` entry.
- **Shape:** its schema, checked by lint (as now).
- **Behaviour:** its contract tests. This is new. One shared suite runs against every discovered instance, so the rules are the same for all of them. For example, every source connector must:
  - page within its cap;
  - honour deletions;
  - never return fewer items than its selectors match;
  - make no request outside its declared hosts;
  - make no non-read call to the service.

  Because of this, every source connector must ship an offline transport with fixtures (x-api and gmail-api already do).
- **Self-description:** each extension has its own `README.md` and, if it takes settings, its own `config.example.yaml`.
  - `bay ls` and the catalog list what is installed.
  - `bay config example` assembles the example config.
  - The top-level README, DESIGN and INTERFACES describe contracts, never instances.

**Config schemas extend:** a child mode's `config:` adds properties to its parent's schema instead of
replacing it. Redefining a parent key is a lint error; defaults change through `configDefaults`.

**Proposals declare crossings.** Front matter `touches:` lists every path inside a core component
that a change edits, with one line of reason each. A pure extension has `touches: []`.

**A deterministic `boundary` check** (`bay boundary --base main --proposal <file>`, and a code step
in forge.extend before review):
- It allows changes inside new or existing extension folders, plus the paths the proposal lists.
- Anything else fails the step, naming the file and its owning component.
- Crossing a boundary is possible only by naming it in a proposal the user approves. The reviewer then focuses on each declared crossing.

**Rules:**
- **forge.extend R-10 (must):** the boundary check and the contract tests pass.
- **Conformance C-11:** an extension changes no file owned by a core component unless the approved proposal lists it. Docs never keep a hand-written list of extensions.
- **DOD-4** becomes: adding a source of a new content type is one `content-types/<name>/` folder plus its connector folder(s), with `touches: []`.

**Improve detector `boundary-crossing`:** scans git history for commits that edited core paths their
proposal did not list.

**Process:** framework builds start from `bay call forge.extend`. The builder's task envelope is
generated from extend's playbook, rules and DoD, with the proposal's `touches:`. It is not written
by hand.

## B. Content types

### What a content type is

Every message, post or article agentbay stores is an **item**. All items share one base record: id,
source, author, text, time, labels, thread. An **content type** says what one type of item looks like
beyond that base, and how agents can query it:

| Content type | Extra fields | What agents can query |
|---|---|---|
| `post` (X) | language, repost/reply/like counts, quoted post | `v_posts` |
| `email` | subject, to, cc, message ids, attachments, bulk flag, sent-by-me | `v_email`, `v_threads` (one row per conversation), `v_attachments` |

An content type is the **contract between sources and modes**:

```
connectors/gmail-api ─┐                                 ┌─ modes/mail-briefing   (reads email)
connectors/imap      ─┼─ produce ─> content-types/email <─ read ─┤
connectors/fake-mail ─┘                                 └─ (any other mode that reads email)

connectors/x-api ─┬─ produce ─> content-types/post <─ read ── modes/feed-briefing
connectors/fake  ─┘
```

mail-briefing depends on `email`, not on Gmail. Moving from Gmail to IMAP changes the connector in
the env, and the mode does not notice.

### Where it lives

`content-types/<name>/` is a top-level folder next to `connectors/` and `modes/`, because several
connectors share one type. It ships with the kit, like the connectors.

```
content-types/email/
  content-type.yaml     # name, version, docs for each field and view (what `describe` shows agents)
  fields.schema.json # the extra fields (moves from schemas/data/email.v1.schema.json)
  views.sql          # CREATE VIEW v_email, v_threads, v_attachments  (SQL only)
  derive.py          # optional: fields computed when an item is stored (fromMe, toMe, bulk)
  README.md
```

`content-type.yaml` may also declare **child tables**: rows per item built from a list in its fields,
with optional full-text columns. Email attachments are one:

```yaml
tables:
  attachments:
    from: attachments                # each list entry becomes a row; the text column moves out of the item
    columns: { name: TEXT, mime: TEXT, size: INTEGER, textChars: INTEGER, reason: TEXT, text: TEXT }
    fullText: [name, text]
```

**How the pieces refer to each other:**
- **Connectors:** `connector.yaml` declares `produces: [email]`.
- **Modes:** `mode.yaml` declares `reads: [email]`.
- **Lint checks** that the content type exists, and that the env binds at least one connector producing every type the mode reads.

### What belongs to the content type, and what belongs to the mode

A content type holds what is true of the data for **every** mode that reads it. A mode's own reading
of that data lives in the mode:

| | Example | Lives in |
|---|---|---|
| What an email is | subject, recipients, message ids, attachments, threads, sent-by-me, bulk | `content-types/email/` |
| What a mode makes of it | "needs reply" (last message from someone else, to me, not bulk), important-sender weighting, digest sections | `modes/mail-briefing/views.sql`, playbooks, config |

A mode may declare its own `views.sql`. These views are built on the views of the content types it
`reads:`, and are validated by the same rule: they read nothing else. A deal-tracking mode could then
define "needs reply" differently without touching email or mail-briefing.

### Who adds content types

Content types are user space, like connectors and modes. `content-types/post/` and
`content-types/email/` ship with the kit as ready-made examples, next to `connectors/x-api/` and
`connectors/gmail-api/`.

- **A new source of an existing type** (IMAP for email) is one connector folder.
- **A new type of content** (Slack messages, RSS articles) is one content-type folder plus its connector. `forge.connect` (proposal 0003 step 4) scaffolds both.
- **The framework owner** is needed only when the core contracts must grow, as Gmail's change-feed sync did. That goes through `forge.extend`, with a proposal the user approves.

If a mode reads a content type that nothing provides, lint names the fix: "mode mail-briefing reads
`email`, but no connector bound in env local-mail produces it; add one with `forge.connect`."

### What the briefing core does with content types, once and generically

- **The store** creates the tables of the content types the mode's sources produce: each child table with a foreign key to `items`, a delete trigger and full-text triggers. Child rows die with their item, so "the store holds exactly the mode's scope" still holds structurally.
- **The sandbox:**
  - It validates every content type's and mode's `views.sql` at build and lint.
  - Every statement must be `CREATE VIEW v_<name>`.
  - A view may read only the base tables and its own type's tables and views. This is enforced with the same SQLite authorizer used for reads.
  - The allowlist is the base views, plus the views of the content types this mode reads, plus the mode's own views.
- **`describe`** lists only those types. feed-briefing shows no mail views, with no special case.
- **Computed fields are stored, not computed at read time.** `derive.py` runs in the writer, after secret scrubbing, and may only add fields. This replaces the `addr_key` SQL function, so no extension code ever runs inside the agents' read sandbox.
- **Recompute:** each row records the `derive.py` version that produced it; on a change the store recomputes the fields locally at the next write, with no fetch.
- **Store version:** the store records its content types and versions. A mismatch is refused with "move the folder aside and sync again" (no migrations, as now).

### What stays in the briefing core, and why

The sync additions in #9 (`changeFeed`, `until`, `storedIds`, `cursorExpired`, `exactLabels`,
`removed`) are not about email:
- Any change-feed source needs them (IMAP CONDSTORE, Slack).
- They become optional, declared capabilities of `items.source/v1`, covered by the source contract tests.
- #9 lists them in `touches:`.

## C. forge.extend, rewritten

forge.extend encodes Parts A and B, so the framework's own rules govern framework changes rather
than hand-written briefs. Three things change.

- **Steps:**
  - Implementation is split into small slices, each built by a fresh builder.
  - Checks run as code.
  - The builder's brief is generated from the playbook, the DoD and the proposal.
- **Definition of Done:** every item can be checked by a command or a detector. Quality words go, since conformance C-2 forbids them; their intent is covered by review and improve's detectors.
- **Rules:** they keep only what the DoD cannot express, so the duplicates go.

### Steps

| Step | Kind | What happens |
|---|---|---|
| `propose` | builder | Writes `docs/proposals/<id>.md`: problem, change, `touches:` (core paths, a reason each) and `slices:`. Slices are ordered; each is about 40 tool calls or fewer and ends with tests green. |
| `approve` | gate | Only the user passes it, with `bay approve <callId>` in a terminal. |
| `implement` | builder, once per slice | A fresh builder per slice. It starts from the proposal section and `HANDOFF.md`, and ends with tests green, a commit, a push and `HANDOFF.md` updated. No slice continues another's conversation. |
| `check` | code (dispatcher) | The boundary checks B-1 to B-12 (Part F), the contract tests, `tests/run.py -q`, lint, validate, and build + clean in a scratch project. |
| `review` | reviewer (deep, high) | Gets the diff and the proposal only, never the builder's conversation. Checks the DoD and the rules. |
| `release` | builder | Version bump; schema apiVersion when a contract changed. |

**`HANDOFF.md`** lives on the branch and is the only state passed between slices:
- what is done (commit shas);
- decisions and why;
- what is next;
- test status;
- open problems.

Each slice also writes one ledger note, so `bay status` shows progress.

**Workflow support:** the dispatcher learns to run a role step once per entry of a list from an earlier
step's output: `foreach: $steps.propose.slices`. The step completes when every slice has.

### Definition of Done

- [DOD-1] (must) Boundary checks B-1 to B-12 (Part F) pass; the output of each is quoted.
- [DOD-2] (must) Contract tests pass for every discovered instance of a changed contract.
- [DOD-3] (must) Tests, lint, validate and build + clean pass; the `check` step's output is quoted.
- [DOD-4] (must) Adding a source of a new content type is one content-type folder plus its connector folder(s), with `touches: []`, as shown by the contract-test fixtures.
- [DOD-5] (must) Every deliverable in the proposal is marked pass/fail with a file reference.
- [DOD-6] (must) No secret value in any prompt, log, ledger line, output or committed file.
- [DOD-7] (must) DESIGN.md and INTERFACES.md describe every changed contract; no doc lists instances.
- [DOD-8] (must_not) Compatibility code: no aliases, migrations or deprecation shims.
- [DOD-9] (should) No function over improve's complexity threshold is added.

### Rules

- **R-1:** review is always on (deep, high) and never disabled.
- **R-2:** nothing is implemented before the user passes the gate.
- **R-3:** nothing outside the approved proposal changes.
- **R-4:** a breaking contract change bumps the schema apiVersion.
- **R-5:** a builder reads by search and line range, not whole files, and runs checks in quiet mode.

### Shared by every forge feature

The slice-and-handoff protocol and quiet checks go into the forge mode's playbook, not only extend's.
`forge.create` and `forge.connect` build things too, and work the same way.

## D. Four more boundary gaps (found by drawing the architecture)

1. **Skills are namespaced per mode.** Skills live in a mode's folder, so they must not leak out of it.
   - Today every mode's skills are written into one global `.claude/skills/` by name, and the last mode wins. That is how mail-briefing's skills overwrote feed-briefing's (#9 review, N-2).
   - The build writes them as `<mode>:<skill>`.
   - A child mode's skill of the same name overrides its parent's, for that child only.
   - Lint fails on any remaining clash.
2. **Adapters get their own folder.** Runtime adapters move from `bay/adapters/` (inside the kernel's folder) to a top-level `adapters/`, discovered like the other extensions. A new runtime is then a new folder, with no kernel edit.
3. **Core-owned interfaces move under `framework/interfaces/`.** These are the briefing core's `items.*` and cos's `workflow.run`. `interfaces/` holds only user interfaces, so where a file lives always tells you who owns it.
4. **Consumers name contract versions.**
   - A mode says `reads: [email/v1]`, as it already says `needs: [items.source/v1]`.
   - A connector says `produces: [email/v1]`.
   - Lint refuses a version mismatch, so a content-type change can never break a mode silently.

Two smaller additions:
- "content type" joins the fixed vocabulary in conformance rule C-7;
- the boundary check also covers skills and the generated `.claude/` layout.

## E. Inside a mode: features are self-contained

Within a mode, each feature already owns its playbook, rules, types, effects and review. Three things
still leak across features:
- **Workflows live in `mode.yaml`,** away from the feature they belong to. With `extends`, understanding one feature means merging two `mode.yaml` files and a feature folder by hand.
- **Skills belong to the mode,** so every role gets every skill in every feature.
- **Data access is per role unit** (role × mode), so the analyst in `digest` can run any SQL over the store, though the digest only needs the threads its code step gathered.

**The change:**
- **A feature is a folder with everything it owns:**
  ```
  modes/mail-briefing/
    mode.yaml              # mode-wide only: purpose, needs, reads, roles -> envs, limits, config, coordinator
    features/digest/
      feature.yaml         # in, out, effects, workflow, review, skills, uses
      playbook.md
      rules.yaml
  ```
- **`uses:` scopes data access.** It lists the read endpoints the feature's role steps may call (e.g. `ask` gets `describe`, `sql`, `get`, `thread`; `digest` gets `get` only). The use shim learns the active call from the dispatcher and allows only that feature's `uses:`. Subagents stay one per role unit; no new agents.
- **`skills:` scopes skills.** The step plan hands a role only that feature's skills, which are namespaced per mode (Part D).
- **Whole-feature override.** A child mode replaces a parent's feature by providing the whole folder, never by merging keys. A feature it does not provide is inherited unchanged. `bay show <mode> --resolved` prints the result, file by file, with the origin of each.
- **Shared on purpose, and staying shared:** types (the mode's API), the store (the mode's data), limits, the roles-to-envs map, config and the coordinator playbook.

## F. Every boundary has a check

A boundary that only a reviewer can see is not a boundary. Each one below is enforced by a
deterministic check. forge.extend's `check` step runs all of them, and so do `forge.create` and
`forge.connect`. Lint runs the static ones on every build too.

| # | Boundary | Enforced by | When |
|---|---|---|---|
| B-1 | Core vs extension: an extension changes no core path | `bay boundary` against the proposal's `touches:` | `check` step |
| B-2 | Extension vs extension: a change edits only the extension folders it creates or names | `bay boundary`: each changed folder is new or listed in `touches:` | `check` step |
| B-3 | Feature vs feature: a change to one feature edits only that feature's folder plus declared mode-wide files | `bay boundary` at feature-folder granularity | `check` step |
| B-4 | Ownership is visible: core files only under core paths; core interfaces under `framework/interfaces/`; adapters in `adapters/` | lint, from `framework/components.yaml` | every build |
| B-5 | Contracts are honoured: shape and behaviour | schemas (lint) + contract tests for every discovered instance | every build, `check` step |
| B-6 | Contracts are versioned: `reads:`/`produces:`/`needs:`/`implements:` agree | lint | every build |
| B-7 | No extension depends on another: modes never name connectors, connectors never name modes | lint (C-4, C-8) + an import scan of connector and mode code | every build |
| B-8 | Skills stay in their mode and feature | build writes `<mode>:<skill>`; lint fails on a clash or on an undeclared skill reference | every build |
| B-9 | Least privilege per feature: a role step reaches only its feature's `uses:` | use shim at runtime; contract test calls an undeclared endpoint and expects a refusal | runtime, `check` step |
| B-10 | No extension code on the read path: views are SQL only, functions from the fixed allowlist | sandbox view validation (authorizer) | every build |
| B-11 | No hand-kept lists of extensions in core docs | `bay boundary` + doc-stale detector | `check` step |
| B-12 | No compatibility code | compat-layer detector | `check` step |

**forge.extend's DoD names them:**
- DOD-1 becomes: B-1 to B-12 pass, and the `check` step's output for each is quoted.
- DOD-2 (contract tests) and DOD-4 (a new content type has `touches: []`) stay as they are.

**improve's `boundary-crossing` detector** runs B-1 to B-3 over git history, so a crossing that
slipped in some other way is still found.

## Steps (each through forge.extend: proposal → approval → build → independent review)

1. **Contracts, the boundary check and the new forge.extend, on main:**
   - the component map, the discovery changes (adapters, `bay auth <connector>`), config extension, per-extension README and example config, and docs that describe contracts only;
   - the `boundary` check (failing), R-10, C-11, the new DOD-4 and the improve detector;
   - contract tests for connector, source and mode, mandatory and run against x-api, fake, gmail-api and fake-mail;
   - the change-feed additions #9 brought (`changeFeed`, `until`, `storedIds`, `cursorExpired`, `exactLabels`, `removed`) declared as optional `items.source/v1` capabilities and covered by the source contract tests;
   - Part E: `feature.yaml` (workflow, skills, `uses:` per feature), whole-feature override, `bay show --resolved`, per-feature checks in the use shim;
   - Part F: every boundary check B-1 to B-12, run by forge.extend, forge.create and forge.connect;
   - Part D: per-mode skill namespaces, `adapters/` as its own folder, core interfaces under `framework/interfaces/`, versioned `reads:`/`produces:`, and C-7 vocabulary;
   - Part C: the new forge.extend (steps, `foreach:` slices, `HANDOFF.md`, the `check` step, DoD and rules), the shared forge protocol, and `tests/run.py -q`;
   - builder briefs generated from forge.extend.
   - Acceptance:
     - the boundary checks, run over main's current tree, list every leak in the Problem table (the to-do list for step 2);
     - a contract test shows a role step calling an endpoint outside its feature's `uses:` is refused;
     - a dry run of `bay call forge.extend` on a small sample proposal produces the per-slice step plans and a generated brief.
   - Built by hand, the last time: it is the step that creates the process. Every later step runs through it.
2. **Content types, on main:**
   - the loader, generic child tables, view validation, `produces:`/`reads:`, computed fields and mode-owned views;
   - move posts into `content-types/post/` and email into `content-types/email/`;
   - move "needs reply" and important-sender weighting into mail-briefing's own views; mail-briefing's config holds only `important`;
   - the content-type contract tests.
   - Acceptance:
     - feed-briefing's and mail-briefing's offline sync, describe and status output is identical to before the step;
     - a test asserts that no core file names a content type or connector;
     - every security test passes unchanged;
     - the boundary check, run over the whole tree, finds no leaks.
3. **forge.connect** (proposal 0003 step 4): scaffolds a content type plus a connector. It is proven by adding RSS with `touches: []`.

## Decided
- **Computed fields at store time** (user, 2026-10-29). A content type's `derive.py` runs in the writer after scrubbing; no extension code runs in the read sandbox. The store records each row's `derive.py` version and recomputes locally (no network) when it changes.
- **Strictness:** the boundary check fails the step; an approved `touches:` is the only way through (user, 2026-10-29).
- **Contract tests are mandatory** for every source connector, so each ships an offline transport with fixtures (user, 2026-10-29).
- **Order:** merge #9 now; step 2 moves email into a content type (user, 2026-10-29).
- **Name:** content type (user, 2026-10-29). The stored unit is still called an item in code and interface names (`items.source/v1`); renaming those is not part of this proposal.
