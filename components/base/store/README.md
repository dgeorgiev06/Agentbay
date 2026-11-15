# store

The store keeps items for the modes that compose it. It implements `items-store@1`
(`components/base/interfaces/items-store.yaml`). Each composing mode gets a database of its own, a partition
named after the calling mode: `.agentbay/data/store--<caller>.db`. The mail briefing's items and the to-dos
never share a file, so SQL an agent writes for one cannot read the other. An action you start yourself, with no
calling mode, uses the partition `owner`.

## Actions

| action | effects | does |
|---|---|---|
| `put` | read, write | Stores the items of one source, each replacing a stored item with the same id. It refuses the whole put when an item has another source, an id without the `<source>:` prefix, or a kind that the source does not list in `kinds`. A local item (source `local`) may not take a kind a source produces. It skips ids that were deleted earlier, and items that the put's `selector` does not match, and says why. It records `cost` once per page before it stores the items, and saves `cursor` and `selector` after them. |
| `update` | read, write | Changes fields of a local item. Items from a source are replaced by their next sync, so their ids are refused. |
| `delete` | read, write, delete | Removes items. It remembers every id that is not local, so no later put stores it again. |
| `get` | read | Returns items by id, in the order asked, and the ids it does not hold. |
| `query` | read | Returns the items a selector matches, with an optional full-text `search`, newest or oldest first, at most the selector's `limit` (100 by default), and says whether more matched. |
| `sql` | read | Runs one read-only select that an agent wrote over the caller's partition, at most 200 rows and 2 seconds. It refuses a second statement, a write and `attach`. |
| `prune` | read, write, delete | Drops the items from a source that were created before `before`. It never drops local items. |
| `status` | read | Counts items and deletions. For each source it gives the kinds, the cursor, the last sync, the selector of that sync and the spend per month. |
| `allowance` | read | For one source, how much the caller may still spend on it this calendar month: the cap from `monthlyUsd`, the dollars its partition recorded for that source this month, and what is left (`null` when there is no cap; below zero when a page overspent it). |

## Settings

Given under `settings.store` in `agentbay.config.yaml` (`schemas/settings.json`):

| setting | meaning |
|---|---|
| `monthlyUsd` | A map from source name to the most US dollars one composing mode may spend on that source in a calendar month. A source without an entry has no cap. |

The cap is per composing mode and per source: each caller's partition records its own spend, so with
`monthlyUsd: { x: 20 }` the feed briefing and the mail briefing may each spend $20 a month on X. Months are
calendar months in UTC, read from the kernel's clock (`context.now()`), so the spend recorded at 23:59 UTC on
the last day of a month counts for that month. The store only answers; a briefing's sync asks `allowance` before
each fetch and stops itself.

## The selector

One matcher, `scripts/lib/selector.ts`, decides for every source which items match. A source may apply some
fields itself (its `describe` says which) and return more than they ask for, but never less. The store then
applies every field again. The fields of a selector are ANDed. Within a list, one value is enough.

- `authors`: matched while ignoring case and a leading `@`. `*` matches any run of characters, so
  `*@example.com` matches a whole domain.
- `labels`: matched while ignoring case.
- `text`: terms found in the title or the text, ignoring case.
- `kinds`, `since` (inclusive), `until` (exclusive): times are compared with their zones.
- `limit`: the most items a query returns, or a sync fetches.
- `native`: the source applies it, and the matcher ignores it.

Full-text search (`search` in `query`) treats punctuation, quotes and operators as plain text: it looks for
every word given. A search with no letters or digits is refused with a sentence that says so.

## What agents query with `sql`

| table or view | holds |
|---|---|
| `items_view` | One row per item: `id, kind, source, at, title, text, url, author, labels, data` (labels and data as JSON text) |
| `items_search` | The full-text index over title, text and author; join it to `items` on `rowid` |
| `items` | The table under `items_view`, with `at_ms` (the time in milliseconds) for comparing times |
| `deletions` | Ids remembered as deleted |
| `sync_state` | Per source: kinds, cursor, last sync and the selector of the last sync |
| `spend_by_month` | Per source and month: items billed and dollars spent |

Text that looks like a secret is removed by the kernel before any statement's values are stored, so it is in no
column and in no index.

## Example

```sh
./bay.sh call store.put '{"source":"local","kinds":["note"],"items":[{"id":"local:call-bank","kind":"note","source":"local","at":"2026-11-15T09:00:00Z","title":"Call the bank","text":"Ask about the staking reports.","url":null,"author":null,"labels":[],"data":{}}]}'
./bay.sh call store.query '{"search":"staking reports"}'
```

Called directly like this, both use the `owner` partition. A mode that requires `items-store@1` gets its own
partition.
