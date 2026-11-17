import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runAgentQuery } from "../../../bay/broker/agent-query.ts";
import { nodeChildProcesses } from "../../../bay/node-ports.ts";
import { withProject } from "../../broker-fixture.ts";

test("the query child opens the database read-only, so a missing file fails and is not created", async () => {
  await withProject(async (root) => {
    const databaseFile = join(root, ".agentbay", "data", "absent.db");
    await mkdir(join(root, ".agentbay", "data"), { recursive: true });
    const outcome = await runAgentQuery(nodeChildProcesses, {
      databaseFile,
      sql: "select 1",
      limits: { rows: 10, resultBytes: 10_000, milliseconds: 5000 },
    });
    assert.equal(outcome.status, "refused");
    assert.equal(existsSync(databaseFile), false);
  });
});
