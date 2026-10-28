# feed-briefing.digest

## Purpose
Summarize what the people I follow said in a period as a few themes, every one grounded in stored posts.

## Inputs
- `since` / `until` (optional): ISO-8601 or relative (`7d`). Default: config `lookback`.
- `author` (optional): one handle.
- `focus` (optional): a topic to emphasize.
- From previous steps: `gather.posts` (stored posts in the window) and `gather.coverage`.

## Steps
1. `refresh`: the dispatcher syncs the store if it is older than 2h.
2. `gather`: the dispatcher queries the store for the period.
3. `themes`: feed-analyst groups the gathered posts into 3-7 themes, each with a short summary and the urls of the posts it rests on, and returns a Digest.
4. `review`: the reviewer checks the digest against this Definition of Done and the rules.

## Definition of Done
- [DOD-1] (must) Every theme cites at least 2 stored posts by url, or exactly 1 when the theme is explicitly about a single post.
- [DOD-2] (must) Every cited url is the url of a stored post in the period.
- [DOD-3] (must) No theme states anything the cited posts do not say.
- [DOD-4] (must) `coverage` is copied from the store, and a coverage gap is stated in `notes`.
- [DOD-5] (should) Themes are ordered by how many distinct authors discuss them.

## Outputs
A `Digest`: `{period: {from, to}, themes: [{title, summary, citations}], coverage, notes?}`.

## Failure handling
- No posts in the period: return zero themes and say so in `notes`; do not invent themes.
- Coverage incomplete: still produce the digest for what is covered and state the gap.
