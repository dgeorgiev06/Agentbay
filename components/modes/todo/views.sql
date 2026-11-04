-- v_plate: the to-dos still to do, each in its agenda bucket, with the columns an agenda needs. It reads v_agenda of the
-- todoitem type (open, doing and waiting to-dos, ordered by priority and then due date); items.store/v2.rows reads it.
CREATE VIEW v_plate AS SELECT id, title, text, labels, threadId, priority, status, due, dueDay,
    delegationTarget, delegationStatus, delegationCallId, isOverdue, dueToday, bucket
  FROM v_agenda;
