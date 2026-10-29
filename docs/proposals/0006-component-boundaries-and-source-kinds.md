# 0006 - Component boundaries you can check, and source kinds as plug-ins

- Status: draft for approval (2026-10-29). Nothing is implemented.
- Blocks: PR #9 (mail-briefing) is held until steps 1-3 land; it is then rebased onto them.
- Feature: forge.extend (framework change)

## Problem

The first requirement for agentbay was modular components with well-defined boundaries. Adding Gmail
showed that the briefing layer does not have them, and that nothing would have caught it.

**1. Source-specific code lives in shared code.** PR #9 changes 12 shared framework files (about 660
lines) to add one source. On main, X's posts already leak in the same way:

| Shared file | What is source-specific in it |
|---|---|
| `bay/sqlsandbox.py` | the fixed view list (`v_posts`, `v_email`, `v_threads`, `v_attachments`, `v_attachment_fts`), their column docs, `MAIL_VIEWS`, the SQL function `addr_key` |
| `framework/connectors/corpus-store/corpus_store.py` | the `attachments` table, its FTS and triggers, the email author mapping, moving attachment text out of `ext` |
| `bay/selector.py` | `addr_key` with Gmail dot rules, the `label:`/`in:` prefix handling |
| `bay/cli.py` | `bay auth gmail`, which names the `gmail-api` connector |
| `modes/mail-briefing/config.schema.json` | a full copy of briefing's settings plus one key, because a child cannot extend its parent's config schema |

**2. The constraint is not written down anywhere it can be checked.**
- forge.extend's rules cover review, versions, tests, docs, secrets, the approval gate and scope.
- Its playbook's DOD-4 only covers a new source of an existing kind, and says nothing about shared code.
- Conformance C-8 and C-9 check mode → role → agent → env → connector, not the layering inside the framework.
- No deterministic check or improve detector looks at which files a change touches.

**3. The spec and the briefs led the builder across the boundary.**
- Proposal 0003 hard-coded per-kind views into the shared store.
- 0005 followed that pattern.
- The build brief said to "add them to the SQL sandbox allowlist the same way the existing views are".
- Builders ran as plain subagents with hand-written briefs, not through `bay call forge.extend`, so even the existing rules applied only when copied into a brief.

## Change

### A. A component map, and a boundary check that fails the build

**`framework/components.yaml`** names each component, the paths it owns and its extension points:

```yaml
components:
  kernel:        { owns: [bay/, schemas/, framework/rules/, framework/agents/, framework/roles/] }
  briefing:      { owns: [framework/connectors/corpus-store/, bay/sqlsandbox.py, bay/selector.py,
                          interfaces/items.*, modes/briefing/] }
extensionPoints:            # adding one of these touches only its own folder plus the listed registration files
  kind:      { path: "kinds/<name>/" }
  connector: { path: "connectors/<name>/" }
  mode:      { path: "modes/<name>/" }
  env:       { path: "envs/<name>.yaml" }
  registration: [agentbay.config.example.yaml, README.md, docs/INTERFACES.md, docs/DESIGN.md]
```

**Proposals declare what they touch.** Front matter `touches:` lists every path outside new
extension folders, with one line of reason each. An empty list means "pure extension".

**A deterministic check `boundary`** (`bay boundary --base main --proposal <file>`, and a code step in
forge.extend before review):
- It diffs the changed paths against the proposal's `touches:` plus the new extension folders.
- Any other path fails the step and names the file and its owning component.
- Crossing a boundary is still possible, but only by naming it in a proposal the user approves.
- The reviewer then focuses on each declared crossing.

**Rules:**
- **forge.extend R-10 (must):** the boundary check passes.
- **Conformance C-11:** an extension (kind, connector, mode, env) changes no file owned by another component unless the approved proposal lists it.
- **DOD-4** becomes: adding a source of a new kind is one `kinds/<kind>/` folder plus its connector(s), with no edits to kernel or briefing files.

**Improve detector `boundary-crossing`:** scans git history for commits that touched components
their proposal did not list, so drift is found after the fact too.

**Process:** framework builds start from `bay call forge.extend`. The builder's task envelope is
generated from extend's playbook, rules and DoD (with the boundary rule and the proposal's
`touches:`), not written by hand.

### B. Source kinds as plug-ins: `kinds/<kind>/`

A kind is the shape of one type of item (post, email). Several connectors can emit the same kind:
`gmail-api`, a future IMAP connector and `fake-mail` all emit email. So kinds are their own
extension point, not part of a connector.

```
kinds/email/
  kind.yaml          # name, version, describe docs for its columns and views
  ext.schema.json    # was schemas/data/email.v1.schema.json
  views.sql          # CREATE VIEW v_email, v_threads, v_attachments ... (SQL only)
  derive.py          # optional, runs at ingest (writer side): fromKey, toKeys, bulk, ...
```

`kind.yaml` may also declare **child tables**: rows per item built from a list in `ext`, with optional
full-text columns:

```yaml
tables:
  attachments:
    from: ext.attachments            # each list entry becomes a row; listed text columns move out of ext
    columns: { name: TEXT, mime: TEXT, size: INTEGER, textChars: INTEGER, reason: TEXT, text: TEXT }
    fts: [name, text]
```

**What the shared layer does, once and generically:**
- **The store** creates each declared child table with a foreign key to `items`, a delete trigger and FTS triggers. Child rows die with their item, so the scope invariant holds structurally, as now.
- **The sandbox:**
  - It validates each `views.sql` at build and lint.
  - Every statement must be `CREATE VIEW v_<name>`.
  - A view may read only `items`, `item_selectors`, `items_fts` and its own kind's tables and views. This is enforced with the same SQLite authorizer used for reads.
  - Its allowlist is the base views plus the views of the kinds this mode's sources emit.
- **`describe`** lists only those kinds. Feed-briefing stops showing mail views because it never had them, with no special case needed.
- **Derived fields are computed at ingest, not at read time.** `derive.py` runs in the writer, after scrubbing. It may only add fields under `ext`. This replaces the `addr_key` SQL function, so no kind-supplied Python ever runs inside the read sandbox.
- **Store version:** the store records the set of kinds and their versions. A mismatch is refused with "move the folder aside and sync again", the same rule as today, with no migrations.

**Connectors declare what they emit:** `connector.yaml` gets `emits: [email]`, and lint checks
that the kind exists.

**What stays shared, and why:**
- The sync protocol features #9 added (`changeFeed`, `until`, `storedIds`, `cursorExpired`, `exactLabels`, `removed`) are not about email. Any change-feed source needs them (IMAP CONDSTORE, Slack).
- They stay in `items.source/v1` as optional, declared capabilities.
- #9 must list them in its `touches:`, so the crossing is visible and reviewed.

**Login becomes generic:** `bay auth <connector>` calls the connector's declared `login` entry
(TTY only, as now). The CLI names no connector.

**Config schemas extend:** a child mode's `config:` adds properties to its parent's schema instead
of replacing it. Redefining a parent key is a lint error; defaults still change through
`configDefaults`. mail-briefing's config then holds only `important`.

## Steps (each through forge.extend: proposal → approval → build → independent review)

1. **Boundary machinery on main:**
   - the component map, the `boundary` check, R-10, C-11, the new DOD-4, the improve detector, and envelopes generated from forge.extend.
   - Acceptance: run against PR #9 as it stands, the check fails and lists the 12 shared files.
2. **Kinds on main:**
   - the kind loader, generic child tables, view validation, `emits:`, derived fields, `bay auth <connector>` and config extension.
   - Move X's posts into `kinds/post/`. The base `v_items` stays shared.
   - Acceptance:
     - feed-briefing's sync, describe and status output is identical to today's;
     - a test asserts that `bay/` and `corpus-store/` contain no kind names (`post`, `email`, `attachment`);
     - every security test passes unchanged.
3. **Rebase #9 onto it:**
   - email moves to `kinds/email/`; Gmail specifics stay in `connectors/gmail-api/`; the config extends briefing's.
   - Acceptance: `bay boundary` passes, with `touches:` listing only the generic sync-protocol additions.

## Decisions needed

1. **Where kinds live:** a top-level `kinds/` folder (recommended, because several connectors share a kind), or inside the first connector that emits them.
2. **No Python in the read path:** derived fields computed at ingest (recommended), or allow kinds to register SQL functions in the sandbox.
3. **Strictness:** the boundary check fails the step, with approved `touches:` as the only way through (recommended), or it only warns the reviewer.
4. **Order:** hold #9 until steps 1-3 are done (recommended), or merge #9 now and refactor after.
