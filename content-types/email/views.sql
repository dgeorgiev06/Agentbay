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

-- v_threads: TEMPORARY HOME. Threads and needsReply belong to the mail-briefing mode (proposal 0006); until that
-- mode owns them this statement and its `views.v_threads` entry in content-type.yaml are lifted out together.
-- It reads only v_email and the base tables.
CREATE VIEW v_threads AS SELECT t.source, t.threadId, t.subject, t.messages, t.firstDate, t.lastDate, t.lastId,
    t.lastSender, t.lastFromMe, t.lastToMe, t.lastBulk,
    (t.lastFromMe = 0 AND t.lastToMe = 1 AND t.lastBulk = 0) AS needsReply,
    t.participants, t.senders, t.matched, t.hasAttachments, t.attachmentCount FROM (
  SELECT e.source AS source, e.threadId AS threadId,
    (SELECT f.title FROM main.items f WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId
       ORDER BY f.created_at, f.ext_id LIMIT 1) AS subject,
    count(*) AS messages, min(e.createdAt) AS firstDate, max(e.createdAt) AS lastDate,
    (SELECT l.id FROM temp.v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastId,
    (SELECT l.sender FROM temp.v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastSender,
    (SELECT l.fromMe FROM temp.v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastFromMe,
    (SELECT l.toMe FROM temp.v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastToMe,
    (SELECT l.bulk FROM temp.v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastBulk,
    (SELECT json_group_array(p) FROM (SELECT DISTINCT p FROM (
        SELECT lower(f.author) AS p FROM main.items f
          WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId
        UNION SELECT lower(j.value) FROM main.items f, json_each(f.ext, '$.to') j
          WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId
        UNION SELECT lower(j.value) FROM main.items f, json_each(f.ext, '$.cc') j
          WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId)
      WHERE p IS NOT NULL ORDER BY p)) AS participants,
    (SELECT json_group_array(p) FROM (SELECT DISTINCT lower(f.author) AS p FROM main.items f
      WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId AND f.author IS NOT NULL
      ORDER BY p)) AS senders,
    (SELECT json_group_array(sel) FROM (SELECT DISTINCT s.selector AS sel FROM main.items f
      JOIN main.item_selectors s ON s.item = f.pk
      WHERE f.kind = 'email' AND f.source = e.source AND f.thread_id = e.threadId ORDER BY sel)) AS matched,
    max(e.hasAttachments) AS hasAttachments, sum(e.attachmentCount) AS attachmentCount
  FROM temp.v_email e WHERE e.threadId IS NOT NULL GROUP BY e.source, e.threadId) t;

-- v_attachment_fts: full-text search over attachment name and text (FTS5 only).
CREATE VIEW v_attachment_fts AS SELECT v.*, f.attachments_fts AS fts, f.rank AS rank,
    snippet(attachments_fts, 1, '[', ']', '…', 16) AS snippet
  FROM main.attachments_fts f JOIN temp.v_attachments v ON v.rid = f.rowid;
