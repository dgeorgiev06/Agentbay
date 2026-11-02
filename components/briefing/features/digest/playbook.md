# briefing.digest

## Purpose
Summarize what my sources said in a period as a few themes, every one grounded in stored items.

## Inputs
- `since` / `until` (optional): ISO-8601 or relative (`7d`). Default: config `lookback`.
- `author` (optional): one handle or address. `selector` (optional): one selector id.
- `focus` (optional): a topic to emphasize.
- From previous steps: `gather.items` (stored items in the window, each with `matched`) and `gather.coverage`.

## Steps
1. `refresh`: the dispatcher syncs the store if it is older than 2h or the selectors changed.
2. `gather`: the dispatcher queries the store for the period (`items.store/v1.query`).
3. `themes`: the analyst groups the gathered items (narrowing with the corpus-sql skill and reading the few items it relies on in full with `get`/`thread` when the gathered ones are not enough) into 3-7 themes (or by selector when there are several), each with a short summary and the items it rests on, and returns a Digest.
4. `review`: the reviewer checks the digest against this Definition of Done and the rules.

## Definition of Done
- [DOD-1] (must) Every theme cites at least 2 stored items, or exactly 1 when the theme is explicitly about a single item.
- [DOD-2] (must) Every citation is the url or id of a stored item in the period.
- [DOD-3] (must) No theme states anything the cited items do not say.
- [DOD-4] (must) `coverage` is copied from the store, and a coverage gap is stated in `notes`.
- [DOD-5] (should) Themes are ordered by how many distinct authors discuss them.

## Outputs
A `Digest`: `{period: {from, to}, themes: [{title, summary, selector?, citations}], coverage, notes?}`.

## Failure handling
- No items in the period: return zero themes and say so in `notes`; do not invent themes.
- Coverage incomplete: still produce the digest for what is covered and state the gap.
