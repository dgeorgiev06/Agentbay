CREATE TABLE "todos" (
  id INTEGER PRIMARY KEY CHECK (id >= 1),
  text TEXT NOT NULL CHECK (length(text) >= 1),
  status TEXT NOT NULL CHECK (status IN ('open', 'done'))
);
