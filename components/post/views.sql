-- v_posts: one row per post, every v_items column and then the post fields.
CREATE VIEW v_posts AS SELECT v.*,
    json_extract(i.ext, '$.lang') AS lang, json_extract(i.ext, '$.metrics') AS metrics,
    json_extract(i.ext, '$.metrics.like_count') AS likes,
    json_extract(i.ext, '$.metrics.retweet_count') AS reposts,
    json_extract(i.ext, '$.metrics.reply_count') AS replies
  FROM temp.v_items v JOIN main.items i ON i.pk = v.rid WHERE i.kind = 'post';
