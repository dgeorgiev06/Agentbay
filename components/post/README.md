# post

A social post: the item kind `post` (`post/v1`) with an optional language (`lang`) and engagement counts
(`metrics`). Connectors that produce it declare `produces: [post/v1]`; modes that read it declare
`reads: [post/v1]`.

- `fields.schema.json`: the fields a post adds to the base item.
- `views.sql`: the view agents query, `v_posts` (every `v_items` column, then `lang`, `metrics`, `likes`,
  `reposts`, `replies`).
- `content-type.yaml`: the version and what `describe` tells agents about each column.
- `fixtures/items.json`: sample posts the contract tests validate and run the views over.
