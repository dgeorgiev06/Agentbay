# fake-source

A source of thirty made-up posts. It implements `items-source@1`
(`components/base/interfaces/items-source.yaml`), so a briefing can be built, tested and shown without an
account or a network. A real source would implement the same interface and be bound in its place; none is
built yet.

The posts live in `scripts/lib/posts.ts`. They come from eight authors, carry labels such as `staking`, `eth`,
`solana`, `custody` and `regulation`, and are spread over the two weeks before `baseDate`. Some have a URL and
some do not. One (`fake:1017`) holds a line that tries to give an agent instructions, so the briefing's rule
that item text is data gets exercised.

## Actions

| action | effects | does |
|---|---|---|
| `fetch` | read, network, spend | Returns one page of posts, oldest first, after `cursor`. It applies the selector's `authors` (plain names; a pattern with `*` is left to the store), `since`, `until` and `limit` itself, and leaves every other field to the store's matcher. The response says whether `more` is ready, and the made-up `cost` of the page is also reported to the run's budget. |
| `describe` | read | Names the source (`fake`), its kinds (`post`), the selector fields it applies itself, and `pageCostUsd`: what a full page costs (`pageSize` × `costPerItemUsd`), which a briefing's sync compares with what its monthly cap leaves. |

`fetch` declares `network` and `spend` because the interface does, so a briefing that calls it is written exactly
as it will be for X. The fake itself touches no network and spends no real money.

A cursor is the time and id of the last post returned. The next fetch returns only posts after it, so a second
sync with the cursor the store saved adds nothing.

## Settings

Given under `settings.fake-source` in `agentbay.config.yaml` (`schemas/settings.json`):

| setting | meaning |
|---|---|
| `baseDate` (required) | The ISO 8601 time the posts lead up to. A fixed date gives the same posts on every run. |
| `pageSize` | The most posts one fetch returns; 10 when not given. |
| `costPerItemUsd` | The made-up price of one post; 0.001 when not given. |

## Example

```yaml
settings:
  fake-source: { baseDate: "2026-11-15T12:00:00Z", pageSize: 10, costPerItemUsd: 0.001 }
```

```sh
./bay.sh call fake-source.fetch '{"selector":{"authors":["vitalik"]},"cursor":null}'
```

The call returns vitalik's four posts, oldest first, with `more: false` and a cost of `{ "items": 4, "usd": 0.004 }`.
