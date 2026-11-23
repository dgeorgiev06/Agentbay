import { DatabaseSync } from "node:sqlite";
import type { NewTodo, Todo } from "./rules.ts";

type Row = {
  id: number;
  text: string;
  due: string | null;
  done: number;
  created_at: string;
};

export type Store = {
  add(todo: NewTodo, createdAt: string): Todo;
  all(): Todo[];
  find(id: number): Todo | undefined;
  markDone(id: number): void;
  close(): void;
};

function toTodo(row: Row): Todo {
  return {
    id: `t${row.id}`,
    text: row.text,
    due: row.due,
    done: row.done === 1,
    createdAt: row.created_at,
  };
}

const migrations = [
  `CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
];

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < migrations.length; version++) {
    db.exec(migrations[version]);
    db.exec(`PRAGMA user_version = ${version + 1}`);
  }
}

export function openStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  migrate(db);

  const insert = db.prepare("INSERT INTO todos (text, due, created_at) VALUES (?, ?, ?)");
  const selectAll = db.prepare("SELECT * FROM todos ORDER BY id");
  const selectOne = db.prepare("SELECT * FROM todos WHERE id = ?");
  const finish = db.prepare("UPDATE todos SET done = 1 WHERE id = ?");

  return {
    add(todo, createdAt) {
      const { lastInsertRowid } = insert.run(todo.text, todo.due, createdAt);
      return toTodo(selectOne.get(lastInsertRowid) as Row);
    },
    all() {
      return (selectAll.all() as Row[]).map(toTodo);
    },
    find(id) {
      const row = selectOne.get(id) as Row | undefined;
      return row === undefined ? undefined : toTodo(row);
    },
    markDone(id) {
      finish.run(id);
    },
    close() {
      db.close();
    },
  };
}
