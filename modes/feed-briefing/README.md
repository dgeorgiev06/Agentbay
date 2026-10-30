# feed-briefing

Briefings and grounded Q&A over posts from accounts you follow. `extends: briefing`: features `sync`,
`digest`, `ask` and `prune`, with the post content type.

**Setup:** bind an `items.source/v1` connector for posts in the env (the shipped `local-feeds` binds the X
API; with `offline: true` in agentbay.config.yaml it binds a fake source). Settings: briefing's (see `config.example.yaml`); `selectors`
choose what to keep, by default the home timeline.

Ask *"brief me on the last 3 days"* (`feed-briefing.digest`) or *"what did people say about custody?"*
(`feed-briefing.ask`).
