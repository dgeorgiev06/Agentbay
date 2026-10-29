# x-api

`items.source/v1` for posts from X through the official X API v2: the authorized account's home timeline,
X Lists (`in: list:<id>`) and user timelines (`from: <handle>`). OAuth 2.0 user token with scopes
`tweet.read users.read offline.access` (plus `list.read` for Lists). Network: `api.x.com` only.

## Setup

1. Store `X_CLIENT_ID`, `X_CLIENT_SECRET` and `X_REFRESH_TOKEN` with `./bay.sh secret set <NAME>` (macOS
   keychain; on Linux use `secrets: {provider: env}` in agentbay.config.yaml).
2. Delete `local-feeds: local-feeds-offline` from the `envs:` line of agentbay.config.yaml.
3. Set `connectors.x-api.userId` (else it is looked up through `/2/users/me`) and rebuild.

The caps `maxItemsPerRun`, `monthlyItems` and `spendUsd` of the mode stop a sync before it exceeds one; each
post read costs `costPerPostUsd` (X pay-per-use).

**Settings** (`connectors.x-api`): `userId`, `maxPages`, `exclude` (`retweets`, `replies`); see
`config.example.yaml`. Tests with an offline transport: `tests/`.
