# feed-briefing

Keeps you briefed on what the accounts you follow post. It syncs posts from a source into the store, writes a
digest of themes in which every claim cites the posts it rests on, and answers questions from the stored posts.
It requires `items-source@1` and `items-store@1`. The project config binds each interface to a mode, for example
`fake-source` today and `x` from stage 5.

## Actions

| action | effects | runs |
|---|---|---|
| `sync` | read, write, network, spend | `scripts/sync.ts`: asks the source for its name, reads the store's status for the saved cursor, then loops page by page: `items-source.fetch`, then `items-store.put`. It stops when the source has no more or `maxItems` items were fetched. Before every fetch it asks `items-store.allowance` for the source; it stops when what the store's monthly cap leaves is less than one more page could cost (see below). It returns the counts, the cost and the cursor. When the configured selector differs from the one of the last sync, it starts again from the beginning of its window. |
| `digest` | read | `scripts/select.ts` queries the store for the lookback window. The `digest` skill (tier balanced) writes themes, and `scripts/check-citations.ts` holds each one to its input. Then `scripts/format.ts` attaches each cited post's author, time and link from the store. |
| `ask` | read | The `ask` skill (tier balanced) answers from the store through `items-store.query`, `items-store.sql` and `items-store.get`; `scripts/check-answer.ts` checks that every cited id is in the store. |

The workflow `workflows/daily.yaml` runs `sync`, then `digest`, then an approval that shows the digest. Approving
it makes the digest the output of the run.

`sync` is one script with a loop rather than a list of `call` steps, because a list of steps cannot repeat. The
run's budget still holds for every page. When a fetch overspends it, the run waits for budget before that page is
stored, and nothing of the page is stored. After `bay resume <run> --extend usd=<amount>`, the sync goes on:
the pages it already fetched are replayed from the run's records, not fetched again.

### The monthly cap

The store's setting `monthlyUsd` caps what this mode may spend on a source in a calendar month (UTC). The rule
`sync` applies before every fetch: when the allowance has a cap and what it leaves is less than the source's
`pageCostUsd` (what one full page can cost, from `describe`), the sync stops. A source that cannot say what a page
costs gives no `pageCostUsd`; then the sync stops only when nothing is left. A stopped sync stores nothing more,
does not fail, and returns `stopped: "monthly cap"` and `monthlyCap` with the month, the cap, what was spent and
what is left. The next calendar month starts from nothing spent.

### The citation check

`scripts/check-citations.ts` runs after every round of the digest skill and sends it back with feedback when:

- a theme cites no item, or cites an id that was not in its input;
- a summary copies an item's excerpt;
- a title has more than 10 words, a summary more than 60, the notes more than 80, or there are more than 7 themes;
- `period` or `selectorChanged` were not copied from the input.

The third failed round fails the run.

### When the selector changes

The store reports, for each source, the selector it was last synced with. `digest` compares it with the
configured selector and sets `selectorChanged`. The skill must then say in the notes that a sync is due. `sync`
re-reads the whole window with the new selector. The old store's stricter rule, which refused every read until
a re-sync, is not kept (see `docs/plans/0022-m1-behaviours.md`).

## Settings

Given under `settings.feed-briefing` (`schemas/settings.json`):

| setting | meaning |
|---|---|
| `selector` | Which posts to sync and brief on (authors, labels, text, kinds, since, until, limit, native); everything when not given. |
| `lookback` | How far back a digest looks, and where a first sync starts: `36h`, `7d`, `2w`; 7d when not given. |
| `maxItems` | The most posts one sync stores and one digest reads; 100 when not given. |

## Example

```yaml
modes: [feed-briefing]
bindings: { items-source: { feed-briefing: fake-source }, items-store: store }
adapter: claude-code
settings:
  feed-briefing: { selector: { labels: [staking, custody, regulation] }, lookback: 7d, maxItems: 50 }
  fake-source: { baseDate: "2026-11-15T12:00:00Z", pageSize: 10, costPerItemUsd: 0.001 }
  store: { monthlyUsd: { fake: 0.025 } }
```

A binding is either one mode for every mode that requires the interface (`items-store: store`) or a map from
requiring mode to serving mode, with an optional `default`, so the mail briefing and this one can each have
their own source.

```sh
./bay.sh call feed-briefing.sync '{"since":"2026-11-01T00:00:00Z"}'
./bay.sh call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}'
./bay.sh call --workflow feed-briefing:workflows/daily.yaml
```

`digest` stops at the skill step and prints a task with a token. The coordinator gives the task to the agent
`agentbay-feed-briefing-digest`, which submits the draft. The run then ends with the finished digest.
