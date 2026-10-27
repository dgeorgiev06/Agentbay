# feed-briefing.ask

## Purpose
Answer a question using only stored posts, with citations, and say when the posts do not answer it.

## Inputs
- `question` (required).
- `since` (optional, default config `lookback`), `author` (optional).
- From previous steps: `search.posts` and `search.coverage`.

## Steps
1. `refresh`: the dispatcher syncs the store if it is older than 2h.
2. `search`: the dispatcher queries the store for the window.
3. `answer`: feed-analyst reads the posts (and may narrow with `bay use ... feed.store/v1.query --text`), then answers with citations.

## Definition of Done
- [DOD-1] (must) Every factual sentence in `answer` is supported by a cited stored post.
- [DOD-2] (must) Every url in `citations` is a stored post url.
- [DOD-3] (must) When the posts do not answer the question, `answer` says so and `confidence` is `none`.
- [DOD-4] (must) `coverage` is copied from the store and any gap is mentioned in `answer`.

## Outputs
An `Answer`: `{answer, citations, confidence, coverage}`.

## Failure handling
- Nothing relevant stored: answer "The stored posts do not cover this" with `confidence: none` and empty citations.
- Question outside the lookback: suggest a wider `since`, capped by `lookbackMax`.
