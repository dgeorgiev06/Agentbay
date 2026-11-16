import assert from "node:assert/strict";
import { test } from "node:test";
import { Broker } from "../bay/broker.ts";
import type { Effect } from "../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeProcesses,
  systemClock,
} from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  scriptedHttp,
  valueOf,
  withProject,
} from "./broker-fixture.ts";

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

test("a command's time limit is cut to the broker's own limit", async () => {
  await withProject(async (root) => {
    const broker = new Broker({
      layout: projectLayout(root),
      permissions: permissionsIn(root, { effects: everyEffect, commands: ["node -e"] }),
      place,
      files: nodeFileSystem,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 200, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events: recordingSink(),
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: nodeProcesses,
      commandSearchPath: process.env.PATH ?? "/usr/bin:/bin",
      limits: { commandMilliseconds: 500 },
    });
    try {
      const startedAt = Date.now();
      const command = ["node", "-e", "setInterval(() => {}, 1000)"];
      const ran = valueOf(await broker.runCommand({ command, folder: ".", timeLimitSeconds: 30 }));
      assert.deepEqual(ran.end, { how: "timed-out" });
      assert.ok(Date.now() - startedAt < 5000);
    } finally {
      broker.close();
    }
  });
});
