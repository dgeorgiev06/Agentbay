import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseProcess } from "../../../bay/broker/database-process.ts";
import type { ChildProcesses } from "../../../bay/ports.ts";

test("a database process whose end cannot be observed answers its waiting requests with an error", async () => {
  const childProcesses: ChildProcesses = {
    start: () => ({
      send: () => undefined,
      kill: () => undefined,
      ended: Promise.reject(new Error("the process table is gone")),
    }),
  };
  const database = new DatabaseProcess({ childProcesses, databaseFile: "/x.db", lifetimeMilliseconds: 1000 });
  const result = await database.request({ method: "query", sql: "select 1", parameters: [] });
  assert.ok(result.status === "error", JSON.stringify(result));
  assert.match(result.message, /could not be watched/);
});
