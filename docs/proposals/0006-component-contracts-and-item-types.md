# 0006 - Components that own their contracts, and item types as plug-ins

- Status: draft for approval, revision 2 (2026-10-29). Nothing is implemented.
- Revision 2 follows review by the user:
  - no registration edits;
  - core components own their contracts;
  - contract tests;
  - "kind" renamed and explained.
- Blocks: PR #9 (mail-briefing) is held until steps 1-3 land; it is then rebased onto them.
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

## Principle

> **An extension is a new folder that satisfies a contract. It edits nothing else.**

There are two kinds of component:
- **Core components** define contracts: the schema an extension must match, the tests it must pass, and where it is discovered. They find and load every instance. Core components change only through an approved framework proposal.
- **Extensions** (a mode, a connector, an env, an item type) are instances of a contract. Each lives in its own folder and carries its own code, docs, example config and fixtures.

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
      itemType:  { at: "item-types/<name>/",      schema: schemas/item-type.schema.json,   tests: tests/contracts/item_type.py }
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
- **DOD-4** becomes: adding a source of a new item type is one `item-types/<name>/` folder plus its connector folder(s), with `touches: []`.

**Improve detector `boundary-crossing`:** scans git history for commits that edited core paths their
proposal did not list.

**Process:** framework builds start from `bay call forge.extend`. The builder's task envelope is
generated from extend's playbook, rules and DoD, with the proposal's `touches:`. It is not written
by hand.

## B. Item types

### What an item type is

Every message, post or article agentbay stores is an **item**. All items share one base record: id,
source, author, text, time, labels, thread. An **item type** says what one type of item looks like
beyond that base, and how agents can query it:

| Item type | Extra fields | What agents can query |
|---|---|---|
| `post` (X) | language, repost/reply/like counts, quoted post | `v_posts` |
| `email` | subject, to, cc, message ids, attachments, bulk flag | `v_email`, `v_threads` (one row per conversation, with "needs reply"), `v_attachments` |

An item type is the **contract between sources and modes**:

```
connectors/gmail-api ─┐                                 ┌─ modes/mail-briefing   (reads email)
connectors/imap      ─┼─ produce ─> item-types/email <─ read ─┤
connectors/fake-mail ─┘                                 └─ (any other mode that reads email)

connectors/x-api ─┬─ produce ─> item-types/post <─ read ── modes/feed-briefing
connectors/fake  ─┘
```

mail-briefing depends on `email`, not on Gmail. Moving from Gmail to IMAP changes the connector in
the env, and the mode does not notice.

### Where it lives

`item-types/<name>/` is a top-level folder next to `connectors/` and `modes/`, because several
connectors share one type. It ships with the kit, like the connectors.

```
item-types/email/
  item-type.yaml     # name, version, docs for each field and view (what `describe` shows agents)
  fields.schema.json # the extra fields (moves from schemas/data/email.v1.schema.json)
  views.sql          # CREATE VIEW v_email, v_threads, v_attachments  (SQL only)
  derive.py          # optional: fields computed when an item is stored (fromMe, toMe, bulk)
  README.md
```

`item-type.yaml` may also declare **child tables**: rows per item built from a list in its fields,
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
- **Lint checks** that the item type exists, and that the env binds at least one connector producing every type the mode reads.

### What the briefing core does with item types, once and generically

- **The store** creates the tables of the item types the mode's sources produce: each child table with a foreign key to `items`, a delete trigger and full-text triggers. Child rows die with their item, so "the store holds exactly the mode's scope" still holds structurally.
- **The sandbox:**
  - It validates `views.sql` at build and lint.
  - Every statement must be `CREATE VIEW v_<name>`.
  - A view may read only the base tables and its own type's tables and views. This is enforced with the same SQLite authorizer used for reads.
  - The allowlist is the base views plus the views of the types this mode reads.
- **`describe`** lists only those types. feed-briefing shows no mail views, with no special case.
- **Computed fields are stored, not computed at read time.** `derive.py` runs in the writer, after secret scrubbing, and may only add fields. This replaces the `addr_key` SQL function, so no extension code ever runs inside the agents' read sandbox.
- **Store version:** the store records its item types and versions. A mismatch is refused with "move the folder aside and sync again" (no migrations, as now).

### What stays in the briefing core, and why

The sync additions in #9 (`changeFeed`, `until`, `storedIds`, `cursorExpired`, `exactLabels`,
`removed`) are not about email:
- Any change-feed source needs them (IMAP CONDSTORE, Slack).
- They become optional, declared capabilities of `items.source/v1`, covered by the source contract tests.
- #9 lists them in `touches:`.

## Steps (each through forge.extend: proposal → approval → build → independent review)

1. **Contracts and the boundary check, on main:**
   - the component map, the discovery changes (adapters, `bay auth <connector>`), config extension, per-extension README and example config, and docs that describe contracts only;
   - the `boundary` check, R-10, C-11, the new DOD-4 and the improve detector;
   - contract tests for connector and source (run against x-api and fake), and for mode;
   - envelopes generated from forge.extend.
   - Acceptance: run against #9 as it stands, the check fails and lists its shared-code edits.
2. **Item types, on main:**
   - the loader, generic child tables, view validation, `produces:`/`reads:` and computed fields;
   - move posts into `item-types/post/`;
   - the item-type contract tests.
   - Acceptance:
     - feed-briefing's sync, describe and status output is identical to today's;
     - a test asserts that no core file names an item type or connector;
     - every security test passes unchanged.
3. **Rebase #9:**
   - `item-types/email/`, Gmail specifics in `connectors/gmail-api/`, mail-briefing's config holding only `important`.
   - Acceptance: the contract tests pass for gmail-api and fake-mail, and `bay boundary` passes with `touches:` listing only the generic sync-protocol additions.

## Decisions needed

1. **Name:** "item type" (recommended: the framework already calls each record an item, so the name explains itself), "content type" (the CMS term), or keep "kind".
2. **Computed fields at store time** (recommended), or allow item types to add SQL functions to the read sandbox.
3. **Strictness:** the boundary check fails the step, with an approved `touches:` as the only way through (recommended), or it only warns the reviewer.
4. **Contract tests are mandatory for every source connector**, so each must ship an offline transport with fixtures (recommended), or they are optional.
5. **Order:** hold #9 until steps 1-3 are done (recommended), or merge #9 now and refactor after.
