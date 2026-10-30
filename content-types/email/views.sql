-- v_email: one row per message, every v_items column and then the message fields. fromMe, toMe and bulk are
-- stored (derive.py), not computed per query.
CREATE VIEW v_email AS SELECT v.*, v.title AS subject,
    json_extract(i.ext, '$.from') AS sender, json_extract(i.ext, '$.to') AS toList,
    json_extract(i.ext, '$.cc') AS ccList, json_extract(i.ext, '$.messageId') AS messageId,
    json_extract(i.ext, '$.inReplyTo') AS inReplyTo, json_extract(i.ext, '$.account') AS account,
    coalesce(json_extract(i.ext, '$.hasAttachments'), 0) AS hasAttachments,
    coalesce(json_array_length(i.ext, '$.attachments'), 0) AS attachmentCount,
    coalesce(json_extract(i.derived, '$.fromMe'), 0) AS fromMe,
    coalesce(json_extract(i.derived, '$.toMe'), 0) AS toMe,
    coalesce(json_extract(i.derived, '$.bulk'), 0) AS bulk
  FROM temp.v_items v JOIN main.items i ON i.pk = v.rid WHERE i.kind = 'email';

-- v_attachments: one row per attachment (the attachments table), with the message's identity.
CREATE VIEW v_attachments AS SELECT
    i.source || ':' || i.ext_id AS id, i.source AS source, a.n AS n, a.name AS name, a.mime AS mime,
    a.size AS size, a.text_chars AS textChars, a.reason AS reason, a.text AS text, i.thread_id AS threadId,
    i.author AS sender, i.title AS subject, i.created_at AS createdAt, i.url AS url,
    (SELECT json_group_array(selector) FROM
       (SELECT s.selector FROM main.item_selectors s WHERE s.item = i.pk ORDER BY s.selector)) AS matched,
    a.pk AS rid
  FROM main.attachments a JOIN main.items i ON i.pk = a.item;

-- v_attachment_fts: full-text search over attachment name and text (FTS5 only).
CREATE VIEW v_attachment_fts AS SELECT v.*, f.attachments_fts AS fts, f.rank AS rank,
    snippet(attachments_fts, 1, '[', ']', '…', 16) AS snippet
  FROM main.attachments_fts f JOIN temp.v_attachments v ON v.rid = f.rowid;
