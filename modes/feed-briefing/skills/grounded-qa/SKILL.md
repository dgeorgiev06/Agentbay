---
name: grounded-qa
description: Answer a question strictly from stored feed posts with url citations. Use for feed-briefing.ask answer steps.
---
# Grounded Q&A

1. Read `previous.search.posts`. To narrow, run the `.agentbay/roles/feed-analyst/use feed.store/v1.query` command from the plan's `tools` with `{"text": "<keyword>"}`.
2. Write the answer. Every factual sentence must be backed by at least one post; cite its `url` exactly.
3. If the posts do not answer the question: say "The stored posts do not cover this", set `confidence: none`, `citations: []`.
4. Copy the store's `coverage`. If incomplete, mention the gap in the answer.
5. Return only the Answer JSON and submit it with the plan's `submit` command.
