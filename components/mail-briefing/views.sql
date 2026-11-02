-- v_threads: one row per email thread, built on the email content type's v_email (the only view this mode reads).
-- Needs-reply is this mode's own rule: the last message is from someone else, addressed to me and not bulk.
-- `senders` is what the store matches the `important` setting against (views.yaml, threads.important).
CREATE VIEW v_threads AS SELECT t.source, t.threadId, t.subject, t.messages, t.firstDate, t.lastDate, t.lastId,
    t.lastSender, t.lastFromMe, t.lastToMe, t.lastBulk,
    (t.lastFromMe = 0 AND t.lastToMe = 1 AND t.lastBulk = 0) AS needsReply,
    t.participants, t.senders, t.matched, t.hasAttachments, t.attachmentCount FROM (
  SELECT e.source AS source, e.threadId AS threadId,
    (SELECT f.subject FROM v_email f WHERE f.source = e.source AND f.threadId = e.threadId
       ORDER BY f.createdAt, f.extId LIMIT 1) AS subject,
    count(*) AS messages, min(e.createdAt) AS firstDate, max(e.createdAt) AS lastDate,
    (SELECT l.id FROM v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastId,
    (SELECT l.sender FROM v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastSender,
    (SELECT l.fromMe FROM v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastFromMe,
    (SELECT l.toMe FROM v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastToMe,
    (SELECT l.bulk FROM v_email l WHERE l.source = e.source AND l.threadId = e.threadId
       ORDER BY l.createdAt DESC, l.id DESC LIMIT 1) AS lastBulk,
    (SELECT json_group_array(p) FROM (SELECT DISTINCT p FROM (
        SELECT lower(f.author) AS p FROM v_email f WHERE f.source = e.source AND f.threadId = e.threadId
        UNION SELECT lower(j.value) FROM v_email f, json_each(f.toList) j
          WHERE f.source = e.source AND f.threadId = e.threadId
        UNION SELECT lower(j.value) FROM v_email f, json_each(f.ccList) j
          WHERE f.source = e.source AND f.threadId = e.threadId)
      WHERE p IS NOT NULL ORDER BY p)) AS participants,
    (SELECT json_group_array(p) FROM (SELECT DISTINCT lower(f.author) AS p FROM v_email f
      WHERE f.source = e.source AND f.threadId = e.threadId AND f.author IS NOT NULL
      ORDER BY p)) AS senders,
    (SELECT json_group_array(sel) FROM (SELECT DISTINCT j.value AS sel FROM v_email f, json_each(f.matched) j
      WHERE f.source = e.source AND f.threadId = e.threadId ORDER BY sel)) AS matched,
    max(e.hasAttachments) AS hasAttachments, sum(e.attachmentCount) AS attachmentCount
  FROM v_email e WHERE e.threadId IS NOT NULL GROUP BY e.source, e.threadId) t;
