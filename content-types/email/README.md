# email

An email message: the item kind `email` (`email/v1`) with its addresses (`from`, `to`, `cc`), headers (`messageId`,
`inReplyTo`), the mailbox it was read from (`account`), `bulk` and its attachments. Connectors that produce it
declare `produces: [email/v1]`; modes that read it declare `reads: [email/v1]`.

- `fields.schema.json`: the fields an email adds to the base item.
- `content-type.yaml`: the version, the `attachments` child table (metadata and extracted text; the text is kept only
  in the table, its full-text index is `attachments_fts`), the derived fields and what `describe` tells agents about
  each view column.
- `derive.py`: `addr_key` (one mailbox's identity: case, +tags and Gmail dots ignored) and `derive`, which computes
  `fromMe`, `toMe` and `bulk` when the store writes a message. The values are stored, so a view reads them instead of
  computing them per query. When `deriveVersion` changes, the store recomputes them from what it holds.
- `views.sql`: `v_email` (every `v_items` column, then the message fields), `v_attachments`, `v_attachment_fts` (FTS5
  only) and, until the mail-briefing mode owns them, `v_threads` with `needsReply`.
- `fixtures/items.json`: sample messages the contract tests validate, derive over and run the views against.
