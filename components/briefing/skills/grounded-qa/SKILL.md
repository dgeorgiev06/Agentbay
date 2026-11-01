---
name: grounded-qa
description: Answer a question strictly from stored items with citations. Use for briefing ask `answer` steps, together with corpus-sql.
---
# Grounded Q&A

1. Find candidate items with the corpus-sql skill (describe, then sql/search, then get/thread). Scope to `input.selector`, `input.author` and `input.since` when given.
2. Write the answer. Every factual sentence must be backed by at least one item you read in full; cite its `id`.
3. If the items do not answer the question: say "The stored items do not cover this", set `confidence: none`, `citations: []`.
4. Copy `previous.context.coverage` to `coverage`. If incomplete, mention the gap in the answer.
5. Return only the Answer JSON and submit it with the plan's `submit` command.
