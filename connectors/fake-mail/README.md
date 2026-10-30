# fake-mail

Offline `items.source/v1` for mail: serves `email/v1` items from a JSON fixture (or a built-in sample
mailbox) with no network and no secrets. The `offline:` block of env `local-mail` (switched on by `offline: true` in agentbay.config.yaml) binds it in place of the
real mail source, with the same selector capability table, so `bay check` judges selectors the same way.

**Settings** (`connectors.fake-mail`, all optional): `fixture`, `account`, `deleted`, `removed`, `blocked`.
See `config.example.yaml` and `connector.yaml` for the fixture shape.
