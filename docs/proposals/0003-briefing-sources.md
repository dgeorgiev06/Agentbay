# Proposal 0003: shared briefing infrastructure, mail-briefing, forge.connect

Status: approved (user, 2026-10-27). Step 1 (shared layer) and step 2 (feed-briefing migrated onto it) implemented on feat/briefing (amendment "shared briefing layer" in docs/proposals/0001a-design-amendments.md); steps 3-4 follow as separate PRs.

## Problem
feed-briefing hard-codes one pattern: pull items from a source, store them, summarize, and chat over them. Email needs the same pattern, as will future sources (RSS, Slack). Copying it per source would duplicate storage, query, digest and Q&A logic. Separately, the current JSONL store re-reads every file on each query (improve finding F-d70dbfd0).

## Design

### 1. Item contract
- `item/v1`: a shared envelope with these fields:
  - id, source, kind, author, title, text, url, createdAt, fetchedAt, container, threadId, matched[].
- Kind extensions:
  - `post/v1`: metrics.
  - `email/v1`: from, to, cc, subject, labels/folder, threadId, attachment metadata (not the files).

### 2. Selectors (shared vocabulary)
- **Fields:** `from`, `to`, `subject`, `text`, `in` (folder, label, list or channel), `has`, `since`, `not`.
- **Combining:** fields within a selector are ANDed; selectors are ORed; `not` excludes. Each selector has an `id`.
- **Connector declaration:** each connector says which fields its native search handles. The dispatcher splits every selector into a native query (narrows the fetch) and a local filter.
- **Shared matcher:** the store always re-applies the full selector with one shared matcher, so behaviour is the same on every source.
- **Tagging:** each item records `matched: [selector ids]`. That supports:
  - digest grouping by selector;
  - questions scoped to one selector;
  - re-matching locally when selectors change, with no refetch;
  - backfilling within the lookback window when a selector is added;
  - pruning when a selector is removed.
- **Validate:** `bay validate` errors on a field the source cannot express. It warns when a field is local-only on a paid source (e.g. `text` on X).

### 3. Interfaces
- `items.source/v1`: `fetch(since, cursor, selectors)` → items, deleted ids, next cursor.
- `items.store/v1`:

| Endpoint | Effects | Called by |
|---|---|---|
| sync | network, spend, write | dispatcher code step |
| prune | write, delete | dispatcher code step |
| describe | read | agents: views, columns, types, row counts, sample values |
| sql | read | agents: read-only SQL over approved views |
| get, thread | read | agents: full content for a few ids |
| facets, search, query, status | read | agents: shortcuts |

### 4. Corpus store (connector `corpus-store`, SQLite, stdlib)
- **Database:** one file per mode, under that mode's data folder. WAL mode. The schema version lives in `PRAGMA user_version`; data migrations run through `bay migrate --project <repo>` (the user, dry run first), never `forge.migrate`, which migrates kit content only.
- **Tables:**
  - `items` (unique on source + ext_id)
  - `item_selectors`
  - `items_fts` (FTS5 over title, body and author, kept in sync by triggers)
- **Internal state:** cursors, budget, coverage, deleted ids and the applied selectors live in `<mode>/state.json`, outside the database agents read.
- **Scope invariant:** the database holds only items of the sources bound to the mode's env that match a current selector; sync and prune delete everything else.
- **Views exposed to agents:** `v_items` (base), plus `v_email`, `v_threads` and `v_posts`.
- **Full-text check:** `bay validate` checks that FTS5 is available and falls back to LIKE matching if it is not.

### 5. Read-only SQL for agents (on by default for analyst roles)
- **Read-only:** the connection is opened with `mode=ro`, and `PRAGMA query_only` is on.
- **Authorizer:** SQLite's authorizer allows only SELECT/READ on the approved views and `items_fts`, plus a function allowlist. It denies ATTACH, PRAGMA, writes, extension loading and internal tables.
- **Limits:** a progress handler enforces a time limit, and rows and bytes returned are capped. Errors come back clear enough for the agent to fix its query and retry.
- **Output:** results pass through `vault.redact` and `secretscan`, the same as every other `use` read.
- **Guidance:** the `corpus-sql` skill provides query recipes and requires answers to cite item ids. Agents narrow with SQL, then read full content with `get`/`thread`.

### 6. `briefing` base mode and mode inheritance
- **Framework feature:** `extends: <mode>` in mode.yaml is resolved at build time. The resolver and lint always see a complete mode. A child may override endpoints, workflows, playbooks, rules, review settings and roles.
- **What `briefing` provides:**
  - features: sync, digest, ask, prune;
  - shared digest, grounded-qa and corpus-sql skills;
  - the analyst role;
  - review: prune always; digest always.
- **Spend:** C-6 spend exemption via `spendUsd`, as already decided.

### 7. Per-source modes
- **feed-briefing:** extends briefing; `x-api` moves onto `items.source/v1`. Existing posts are migrated from JSONL to SQLite with `bay migrate --project <repo>` (dry run first, `--confirm` to apply).
- **mail-briefing:** extends briefing.
  - Digest is thread-based, with action items (replies owed, deadlines) and sender weighting.
  - Connectors:
    - `gmail-api`: OAuth, `gmail.readonly` only; the history API for incremental sync; messages that leave a label or are deleted are pruned.
    - `imap` (optional): folders and UIDs.

### 8. `forge.connect`
- **Input:** a plain-language source and its criteria.
- **Output:**
  - a connector implementing `items.source/v1` (reused if one exists), with a fake-HTTP test;
  - the source's selector capability table and native translation;
  - an env binding (network host, secret names);
  - a mode that extends `briefing`.
- **Review:** always on; the result must pass lint and tests.
- **Proof:** generate one more source (RSS) with it.

## Safety (email)
- **No outbound actions:** read-only scopes only, and email modes have no `external-write` effect (no send, label or delete).
- **Prompt injection:** a rule says email content is data and instructions inside it are never followed.
- **Secrets:** the secret scan runs on everything agents read (password resets and similar).
- **Local only:** the store is local under `.agentbay/`, gitignored, and readable only by the user.

## Build steps (each via forge.extend: proposal → approval → build → independent review)
1. Shared layer: item/v1, the selectors and shared matcher, both interfaces, corpus-store with the SQL sandbox, mode inheritance, and the briefing base mode.
2. Migrate feed-briefing onto it (behaviour unchanged; data migrated).
3. mail-briefing with gmail-api.
4. forge.connect, proved by generating an RSS source.

## Decisions (user, 2026-10-27)
- Read-only SQL for analyst roles, on by default (sandboxed as in section 5).
- Mailbox: personal Gmail, via the Gmail API only. No IMAP for now.
- Attachments: keep metadata AND extracted text (PDF, docx, plain text), searchable like bodies. This comes in step 3 and adds a text-extraction dependency, which needs approval then.
- Order: migrate feed-briefing onto the shared layer first, then mail-briefing, then forge.connect.

## Deferred
- Semantic search with local embeddings (`sqlite-vec`) as an extra view.
