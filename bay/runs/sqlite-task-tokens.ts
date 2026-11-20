import type { DatabaseSync } from "node:sqlite";
import type { StoredTaskToken, TaskTokenStore } from "./run-store.ts";
import { answered, inTransaction, taskTokenOf } from "./sqlite-rows.ts";

export class SqliteTaskTokens implements TaskTokenStore {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  readonly replaceTaskToken = (token: StoredTaskToken): Promise<void> =>
    this.#write(() => {
      this.#database.prepare("delete from task_tokens where run_id = ?").run(token.runId);
      this.#database
        .prepare("insert into task_tokens (hash, run_id, step_key, round, issued_at) values (?, ?, ?, ?, ?)")
        .run(token.hash, token.runId, token.stepKey, token.round, token.issuedAt);
    });

  readonly taskTokens = (): Promise<readonly StoredTaskToken[]> =>
    answered(() =>
      this.#database.prepare("select * from task_tokens order by issued_at, run_id").all().map(taskTokenOf),
    );

  readonly removeTaskTokens = (runId: string): Promise<void> =>
    this.#write(() => {
      this.#database.prepare("delete from task_tokens where run_id = ?").run(runId);
    });

  #write(body: () => void): Promise<void> {
    return answered(() => {
      inTransaction(this.#database, body);
    });
  }
}
