# Proposal 0006: market-briefing (property sales and listings)

Status: draft. Needs the decisions at the end.
Builds on 0003 (item/v1, selectors, corpus-store with read-only SQL, the `briefing` base mode) and 0005 Part A
(framework roles, the mode `roles:` map, tiers).

## Goal
Pull per-property real estate records for a geography (initially the Mid-Hudson Valley: Dutchess, Ulster,
Orange, Putnam, Sullivan, Columbia, Greene) into a local store, and let the user ask questions about them and
get grounded market digests. Two record kinds: **closed sales** (what sold, for how much, going back years)
and **active listings** (what is for sale now). Same shape as feed-briefing (X) and mail-briefing (Gmail):
`extends: briefing`, override only what differs.

## Why this fits briefing
The base mode already provides everything the conversation needs: `sync` to fill a local corpus, `ask` for
grounded Q&A with citations over read-only SQL, `digest` for themes, `prune` for retention, the corpus-store
with FTS and the SQL sandbox, selector-scoped storage, budget caps, and the `items-are-data` and `cite-sources`
policies. A market mode needs no new conversational machinery — only new sources and a new item kind.

Two things fit unusually well:

- **`threadId` = parcel id.** The inherited `thread` endpoint then returns every stored sale of one house,
  oldest first. Repeat-sales appreciation, holding periods and flip detection come free from existing code.
- **`no-scraping`** is already a briefing policy. It rules out the Zillow/Realtor.com scraper route at the
  policy layer and forces the two sources below, which is the right answer anyway.

## Data

### Two kind extensions of item/v1

`sale/v1` and `listing/v1`, alongside `post/v1` and (0005) `email/v1`. The envelope maps cleanly:

| item/v1 | `sale/v1` | `listing/v1` |
|---|---|---|
| `extId` | ORPTS transfer id | provider listing id |
| `source` | `sales` | `rentcast` |
| `kind` | `sale` | `listing` |
| `author` | `{name: <seller/grantor>}` | `{name: <listing brokerage>}` |
| `title` | `123 Main St, Rhinebeck — $540,000` | `123 Main St, Rhinebeck — $549,000 (active)` |
| `text` | synthesized sentence (address, town, class, size, price) so FTS and `search` work | same |
| `url` | null (SalesWeb has no per-record URL) | listing url when the provider gives one |
| `createdAt` | sale/contract date | listed date |
| `container` | county | county |
| `labels` | `[<county>, <town>, <school district>, <zip>, class:210]` | same |
| `threadId` | parcel id (`<swis>-<print key>`) | parcel id when matched, else null |

`text` is synthesized rather than natural: it exists so the inherited full-text `search` and `v_fts` keep
working ("waterfront Rhinebeck", "Red Hook ranch"). Analysis uses SQL over the typed `ext` columns.

**`sale/v1` ext:** parcelId, swis, county, town, schoolDistrict, zip, address, salePrice, saleDate,
recordedDate, propertyClass, acreage, parcelCount, assessedValue, fullMarketValue, armsLength, buyer, seller,
buyerMailingState — plus, after step 3, the joined attributes livingAreaSqft, yearBuilt, beds, baths, style,
condition, grade, waterfront and the derived pricePerSqft.

**`listing/v1` ext:** listingId, address, county, town, zip, lat, lon, status, listPrice, originalListPrice,
listedDate, daysOnMarket, beds, baths, livingAreaSqft, lotSize, yearBuilt, propertyType, brokerage,
priceHistory[], removedDate.

### Views for agents
- `v_sales`: one row per closed sale, typed columns, the join target for everything quantitative.
- `v_listings`: one row per listing, current status and price.

Both covered by `v_fts` through the synthesized `text`.

**Framework prerequisite:** `bay/sqlsandbox.py` hardcodes `VIEWS = ("v_items", "v_posts", "v_fts")`. Kind
views must become registrable per kind. 0005 Part B needs the same thing for `v_email`, `v_threads` and
`v_attachments`, so this should be built once, generically, rather than twice.

## Sources

### Connector `sales-file` (implements items.source/v1)
NYS ORPTS **SalesWeb** publishes every recorded property transfer outside NYC, rolling ten years, weekly
updates, with an Excel export — street address, parcel id, sale price, sale date, property class, acreage and
assessed value. It is the authoritative record and it is free, but it is a web application, not an API.
Automating it would be scraping, which this mode's inherited policy forbids.

So: **the user exports per county from SalesWeb; the connector ingests the files.** Config names a directory;
`fetch` reads the Excel/CSV exports, normalizes them to `sale/v1`, and returns them. `effects: [read]` — no
network, no secrets, no spend, `billed: 0`. The `cursor` is the newest `recordedDate` seen, so re-ingesting an
unchanged directory adds nothing, and dropping in a fresh export picks up only what is new.

This is less convenient than an API and more honest than scraping. Two things improve it later: a
`data.ny.gov` Socrata dataset if one carries transfer reports (decision 1), and the ORPTS pre-aggregated
county reports for cross-checking.

Selector capability table — every field is `local`, because a file has no native search:

| Selector | Handling |
|---|---|
| `in` | local — county, town, school district, zip, `class:NNN` (matched against `container` and `labels`) |
| `text`, `subject` | local — address and the synthesized description |
| `from` | local — seller name |
| `since` | local — sale date |
| `not` | local |

### Connector `rentcast-api` (implements items.source/v1)
Active and historical sale listings, nationwide, daily refresh, address-level, no MLS license required.
`GET /listings/sale` filtered by city/state or lat-long radius; `maxItems` maps to pagination. Native
selectors: `in` (city/county → the API's city/state filter) and `since`; everything else local. Needs secret
`RENTCAST_API_KEY` and network `api.rentcast.io`.

Deferred: an **MLS Grid / RESO Web API** connector. It is the complete, authoritative listing feed, but it
requires a licensed broker who is an MLS participant to hold the data license (~$250/mo + $20/license). If
that relationship exists it replaces `rentcast-api` and supplies closed MLS sales too; it cannot be bought
without the license, so it should not block this mode.

## Mode `market-briefing`

```yaml
apiVersion: agentbay/v2
kind: Mode
metadata:
  name: market-briefing
  version: 0.1.0
  description: Grounded Q&A and digests over local property sales and listings for a geography.
spec:
  extends: briefing
  purpose: Keep me informed on my market; answer questions about it from the stored records only.
  endpoints:
    comps:                       # the one new endpoint
      description: Comparable closed sales for a subject property, with citations.
      workflow: comps
      in: CompsReq
      out: Comps
      effects: [read, network, spend, write]
      playbook: features/comps/playbook.md
      rules: features/comps/rules.yaml
      review: { role: reviewer, when: always, tier: balanced, effort: medium }
  workflows:
    comps:
      - { id: refresh, run: items.store/v1.sync, when: "stale > 24h" }
      - { id: subject, run: items.store/v1.query, with: { text: "$in.address", limit: 20 } }
      - { id: pick, role: analyst, out: Comps, task: "Select comparable arm's-length sales by SQL on v_sales (geography, size, vintage, window), explain each inclusion, cite sale ids." }
  roles: { lead: local-market, analyst: local-market, reviewer: local-market }
  constraints:
    lookbackMax: 3650d           # ten years of sales; briefing's 30d is a feed assumption
    policies: [cite-sources, no-scraping, honor-deletions, items-are-data, no-valuation-advice]
  configDefaults:
    lookback: 730d
    retention: 3650d
    selectors:
      - { id: dutchess, in: Dutchess }
      - { id: ulster,   in: Ulster }
```

`sync`, `ask`, `digest` and `prune` are inherited unchanged. `ask` is the conversation the user asked for:
`describe` → `sql` over `v_sales`/`v_listings` → `get`/`thread` → an `Answer` with cited record ids.

### Skill `market-stats` (new, mode-level)
The analyst will otherwise compute medians wrong. This skill is where the domain knowledge lives:

- Filter `armsLength` and `parcelCount > 1` before any statistic; include the filter in the answer.
- Filter `propertyClass` to the segment asked about (210 single-family) and say which.
- **Recording lag:** deeds record weeks to months after closing, so the most recent 1–3 months are incomplete
  and revise upward. Never report a recent-month decline without saying this.
- Median over mean; report n with every statistic; suppress statistics below a configurable n (default 10).
- Mix shift: a median moves when the mix of what sold changes. Prefer price-per-sqft or repeat-sales
  (`thread` on parcel id) for appreciation claims.
- Assessed value is not market value; equalization rates differ per municipality.
- Sales and listings will not reconcile (recording date vs MLS close date; cash and non-MLS sales appear only
  in sales). Never present one as a check on the other without saying so.

### Rules added (features/ask, features/digest, features/comps)
- (must) State the arms-length and property-class filters behind every statistic.
- (must) State n, and refuse a statistic below the minimum n.
- (must) Flag recording-lag incompleteness for any window ending in the last 90 days.
- (must_not) Present assessed or estimated value as market value.
- (must_not) Give valuation, investment or tax advice; report what the records show.

### Env `local-market` (+ `local-market-offline`)
```yaml
spec:
  bind:
    items.source/v1: [sales-file, rentcast-api]
    items.store/v1: corpus-store
    workspace.read/v1: { tools: [Read, Glob, Grep] }
  secrets: { provider: keychain, allow: [RENTCAST_API_KEY] }
  network: { allow: [api.rentcast.io] }
  fs: { read: ["."], write: [".agentbay/data/market"] }
  limits: { maxTurns: 40, maxMinutes: 20, spendUsd: 10, maxItemsPerRun: 5000 }
```
`local-market-offline` substitutes it with `fake` plus sales fixtures, no network, $0 — so the mode is
testable and demoable without a key, as `local-feeds-offline` does today.

## Retention conflict (important)
briefing's `prune` drops items older than `retention` (default 30d) and deletes items the source no longer
serves. Both are wrong for sales: **ten years of closed sales is the asset**, and a county export that no
longer includes an old sale must not delete it. Proposed semantics:

- `retention: 3650d` by default, and `prune` treats `sale` items as append-only: corrections update in place,
  absence from a later export never deletes.
- `honor-deletions` applies to `listing` items only — a delisted property is marked removed (status,
  `removedDate`), not dropped, so days-on-market and list-to-sale history survive.

This needs a per-kind prune rule in the store, not just a longer retention window.

## Build order
Each step via forge.extend: proposal → approval → build → independent review.

1. **Framework:** kind-registered views in the SQL sandbox and store `describe` (shared with 0005 Part B).
2. **`sales-file` + `sale/v1` + `v_sales` + `market-stats` skill + per-kind prune.** Delivers the whole sold
   side: free, offline, no secrets, no spend. `ask` and `digest` work at the end of this step.
3. **Attribute join at ingest** — the connector takes an assessment-roll file and writes sqft, beds, baths,
   year built onto each sale, enabling price-per-sqft and real comps.
4. **`rentcast-api` + `listing/v1` + `v_listings`** — the active side, the first step that costs money.
5. **`comps` endpoint.**

Steps 1–3 are free and carry most of the analytical value, so the paid dependency and the OAuth-style setup
friction both land late.

## Decisions needed
1. **Is there an API for the sales data?** If `data.ny.gov` carries RP-5217 transfer reports as a Socrata
   dataset, `sales-file` becomes a real networked connector with automatic sync, and the manual export goes
   away. Worth checking before building step 2. (`tax.ny.gov` and `data.ny.gov` are not reachable from the
   current cloud session's network allowlist.)
2. **Per-kind prune and append-only sales** — agreed as above, or keep prune uniform and accept that
   `retention` alone guards the history?
3. **Billing unit.** `costPerPostUsd` assumes the provider bills per item. RentCast bills per *request* (up to
   500 listings each), so the `spendUsd` cap mis-models it by ~500x. Add `costPerRequestUsd` and let a
   connector declare its billing unit, or have the connector convert and report `billed` in items?
4. **Listing price history.** v1 snapshot-only (status and price as of last sync), or merge a `priceHistory`
   array on upsert so price cuts and relists are preserved? The latter is the interesting signal.
5. **Numeric selectors.** selector/v1 is string/substring only — no price, size or radius ranges. Proposed:
   do not extend it. Selectors scope *what is stored* (geography, class, date), and all numeric work happens
   in SQL at question time. Confirm.
6. **Geography and attribute coverage.** Seven counties confirmed? Assessment-roll building characteristics
   are reliably available for Dutchess, Ulster and Orange; Sullivan, Columbia and Greene may need a direct
   request to the county Real Property Tax Service, so step 3's coverage will be uneven.
7. **Mode name** `market-briefing`, against the `feed-briefing` / `mail-briefing` pattern.
