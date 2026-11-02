# briefing.ask

## Purpose
Answer a question using only stored items, found with read-only SQL, with citations, and say when the items do not answer it.

## Inputs
- `question` (required).
- `since` (optional, default config `lookback`), `author` (optional), `selector` (optional): scope hints.
- From previous steps: `context` (`items.store/v1.status`: count, per-selector counts, coverage for the window, engine).

## Steps
1. `refresh`: the dispatcher syncs the store if it is older than 2h or the selectors changed.
2. `context`: the dispatcher reads the store status for the window (`items.store/v1.status`).
3. `answer`: the analyst follows the corpus-sql skill: `describe`, then narrow with `sql` (or `search`/`facets`), then read full content of the few relevant items with `get`/`thread`, and answers citing item ids.

## Definition of Done
- [DOD-1] (must) Every factual sentence in `answer` is supported by a cited stored item.
- [DOD-2] (must) Every entry in `citations` is the id or url of a stored item.
- [DOD-3] (must) When the items do not answer the question, `answer` says so and `confidence` is `none`.
- [DOD-4] (must) `coverage` is copied from `context.coverage` and any gap is mentioned in `answer`.

## Outputs
An `Answer`: `{answer, citations, confidence, coverage}`.

## Failure handling
- Nothing relevant stored: answer "The stored items do not cover this" with `confidence: none` and empty citations.
- A query is refused or times out: the error says what to change; fix the SQL and retry.
- Question outside the lookback: suggest a wider `since`, capped by `lookbackMax`.
