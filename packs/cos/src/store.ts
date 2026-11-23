import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FactFilter, NewFact } from "./rules.ts";

export interface StoredFact {
  id: string;
  fact: string;
  topic: string | null;
  created: string;
}

export interface Store {
  add(fact: NewFact, created: string): StoredFact;
  list(filter: FactFilter, limit: number): StoredFact[];
  remove(id: string): boolean;
  close(): void;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    fact TEXT NOT NULL,
    topic TEXT,
    created TEXT NOT NULL
  )
`;

const LIST_FACTS = `
  SELECT id, fact, topic, created FROM facts
  WHERE (:topic IS NULL OR topic = :topic)
    AND (:query IS NULL OR instr(lower(fact), lower(:query)) > 0)
  ORDER BY created DESC, rowid DESC
  LIMIT :limit
`;

export function openStore(dbPath: string): Store {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(CREATE_TABLE);
  const insert = db.prepare(
    "INSERT INTO facts (id, fact, topic, created) VALUES (?, ?, ?, ?)",
  );
  const select = db.prepare(LIST_FACTS);
  const erase = db.prepare("DELETE FROM facts WHERE id = ?");

  return {
    add({ fact, topic }, created) {
      const id = randomUUID().slice(0, 8);
      insert.run(id, fact, topic, created);
      return { id, fact, topic, created };
    },
    list({ topic, query }, limit) {
      return select.all({ topic, query, limit }) as unknown as StoredFact[];
    },
    remove(id) {
      return Number(erase.run(id).changes) > 0;
    },
    close() {
      db.close();
    },
  };
}
