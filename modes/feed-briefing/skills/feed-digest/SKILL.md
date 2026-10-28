---
name: feed-digest
description: How to turn stored feed posts into a grounded digest of themes. Use for feed-briefing.digest themes steps.
---
# Feed digest

1. Read every post in the step plan's `previous.gather.posts`. Do not use other knowledge.
2. Group posts by what they are about, not by author. 3-7 themes; fewer if the posts are few.
3. For each theme write a title (≤ 8 words) and a summary (≤ 60 words) that only restates what the posts say.
4. `citations`: the `url` of each post the theme rests on, copied exactly. At least two unless the theme is one post.
5. Copy `previous.gather.coverage` to `coverage`. If `coverage.complete` is false, put `coverage.note` in `notes`.
6. Return only the Digest JSON and submit it with the plan's `submit` command.
