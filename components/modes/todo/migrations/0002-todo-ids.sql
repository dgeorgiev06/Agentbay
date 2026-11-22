CREATE TABLE "todo-ids" (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  next_id INTEGER NOT NULL CHECK (next_id >= 1)
);
