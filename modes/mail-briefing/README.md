# mail-briefing

Thread-based briefings and grounded Q&A over your email, read-only, kept to the selectors you set.
`extends: briefing`.

- `digest`: what needs your reply, deadlines and asks, by selector or sender (important senders first),
  notable attachments.
- `ask`: answers from stored email through read-only SQL over `v_email`, `v_threads` and `v_attachments`,
  citing messages.

**Setup:** bind a mail `items.source/v1` connector in the env (`local-mail`; with `offline: true` in agentbay.config.yaml it uses a
sample mailbox) and sign in as that connector's README says. Its sync ends `blocked` when the login has
expired, naming the `bay auth <connector>` command to run; a digest or question then still runs on stored
mail and ends `partial`.

**Views:** `views.sql` defines `v_threads` (one row per thread, with `needsReply`) over the email content type's
`v_email`; `views.yaml` documents its columns and tells `items.store/v1.threads` how to read it (window, selector,
the sender column `important` is matched against, and the per-row details).

**Settings:** briefing's plus `important` (senders whose threads are weighed first), in
`config.schema.json`; see `config.example.yaml`.
