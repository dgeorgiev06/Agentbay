-- v_todos: one row per to-do, every v_items column and then the to-do fields. isOverdue and dueToday are computed
-- per query against today's local date (date('now','localtime')); the due day is date(due).
CREATE VIEW v_todos AS SELECT w.*,
    CASE WHEN w.status IN ('open', 'doing', 'waiting') AND w.due IS NOT NULL
         AND date(w.due) < date('now', 'localtime') THEN 1 ELSE 0 END AS isOverdue,
    CASE WHEN w.status IN ('open', 'doing', 'waiting') AND w.due IS NOT NULL
         AND date(w.due) = date('now', 'localtime') THEN 1 ELSE 0 END AS dueToday
  FROM (SELECT v.*,
    coalesce(json_extract(i.ext, '$.priority'), 3) AS priority,
    coalesce(json_extract(i.ext, '$.status'), 'open') AS status,
    json_extract(i.ext, '$.due') AS due, json_extract(i.ext, '$.start') AS start,
    json_extract(i.ext, '$.completedAt') AS completedAt, json_extract(i.ext, '$.droppedAt') AS droppedAt,
    json_extract(i.ext, '$.recur') AS recur, json_extract(i.ext, '$.prevId') AS prevId,
    json_extract(i.ext, '$.delegation') AS delegation,
    json_extract(i.ext, '$.delegation.target') AS delegationTarget,
    json_extract(i.ext, '$.delegation.status') AS delegationStatus,
    json_extract(i.ext, '$.delegation.callId') AS delegationCallId,
    coalesce(json_array_length(i.ext, '$.history'), 0) AS historyCount
  FROM temp.v_items v JOIN main.items i ON i.pk = v.rid WHERE i.kind = 'todoitem') w;

-- v_agenda: the to-dos still to do, each in one bucket. Delegated comes first (a to-do handed to build or
-- research whose delegation is not done or failed), then waiting, overdue, today, someday and upcoming.
CREATE VIEW v_agenda AS SELECT t.*,
    CASE WHEN t.delegationTarget IS NOT NULL AND coalesce(t.delegationStatus, '') NOT IN ('done', 'failed') THEN 'delegated'
         WHEN t.status = 'waiting' THEN 'waiting'
         WHEN t.isOverdue = 1 THEN 'overdue'
         WHEN t.dueToday = 1 THEN 'today'
         WHEN t.priority = 4 THEN 'someday'
         ELSE 'upcoming' END AS bucket
  FROM temp.v_todos t WHERE t.status IN ('open', 'doing', 'waiting')
  ORDER BY t.priority, t.due IS NULL, t.due;
