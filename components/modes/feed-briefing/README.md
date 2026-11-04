# feed-briefing

Briefings and grounded Q&A over posts from accounts you follow. `extends: store`: features `sync`,
`digest`, `ask` and `prune`, with the post content type, plus the store's `feed-briefing.query`, `feed-briefing.get`, `feed-briefing.add`,
`feed-briefing.update` and `feed-briefing.delete` (`add` and `update` refuse posts; `delete` asks first and keeps the post
from coming back).

**Setup:** bind an `items.source/v1` connector for posts in the env (the shipped `local-feeds` binds the X
API; with `offline: true` in agentbay.config.yaml it binds a fake source). Settings: `config.schema.json` (see `config.example.yaml`); `selectors`
choose what to keep, by default the home timeline.

Ask *"brief me on the last 3 days"* (`feed-briefing.digest`) or *"what did people say about custody?"*
(`feed-briefing.ask`).
