import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Fact, FactFilter, NewFact } from "./rules.ts";

export type Store = {
  add(fact: NewFact, created: string): Fact;
  list(filter: FactFilter, limit: number): Fact[];
  remove(id: string): boolean;
  close(): void;
};

const migrations = [
  `CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    fact TEXT NOT NULL,
    topic TEXT,
    created TEXT NOT NULL
  )`,
];

const listFacts = `
  SELECT id, fact, topic, created FROM facts
  WHERE (:topic IS NULL OR topic = :topic)
    AND (:query IS NULL OR instr(lower(fact), lower(:query)) > 0)
  ORDER BY created DESC, rowid DESC
  LIMIT :limit
`;

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

  const insert = db.prepare("INSERT INTO facts (id, fact, topic, created) VALUES (?, ?, ?, ?)");
  const select = db.prepare(listFacts);
  const erase = db.prepare("DELETE FROM facts WHERE id = ?");

  return {
    add({ fact, topic }, created) {
      const id = randomUUID().slice(0, 8);
      insert.run(id, fact, topic, created);
      return { id, fact, topic, created };
    },
    list({ topic, query }, limit) {
      return select.all({ topic, query, limit }) as unknown as Fact[];
    },
    remove(id) {
      return Number(erase.run(id).changes) > 0;
    },
    close() {
      db.close();
    },
  };
}
