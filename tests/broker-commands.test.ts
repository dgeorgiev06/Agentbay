import assert from "node:assert/strict";
import { test } from "node:test";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect } from "../bay/contracts.ts";
import { fieldOf } from "../bay/json.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeProcesses,
  nodeThrowawayFolders,
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
  type RecordingSink,
} from "./broker-fixture.ts";
import { grantedCommand } from "./grants-fixture.ts";

type Limits = NonNullable<Parameters<typeof createBroker>[0]["limits"]>;

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const madeUpSecret = "broker-secret-3c9f1a7e";

async function withCommandBroker(
  limits: Limits,
  run: (broker: StepBroker, events: RecordingSink) => Promise<void>,
): Promise<void> {
  await withProject(async (root) => {
    const events = recordingSink();
    const broker = createBroker({
      layout: projectLayout(root),
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 200, headers: {}, body: "" })),
      secrets: await SecretStore.open({
        environment: { AGENTBAY_SECRET_BROKER_TOKEN: madeUpSecret },
        processes: noProcesses,
        platform: "linux",
        declaredBy: [permissionsIn(root, { secrets: ["BROKER_TOKEN"] }).grants],
      }),
      events,
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: nodeProcesses,
      commandSearchPath: process.env.PATH ?? "/usr/bin:/bin",
      limits,
    }).forStep(
      place,
      permissionsIn(root, {
        effects: everyEffect,
        commands: [grantedCommand("evaluate", "node -e")],
        secrets: ["BROKER_TOKEN"],
      }),
    );
    try {
      await run(broker, events);
    } finally {
      broker.close();
    }
  });
}

test("a command's time limit is cut to the broker's own limit", async () => {
  await withCommandBroker({ commandMilliseconds: 500 }, async (broker) => {
    const startedAt = Date.now();
    const asked = { name: "evaluate", arguments: ["setInterval(() => {}, 1000)"] };
    const ran = valueOf(await broker.ask("commands.run", { ...asked, folder: ".", timeLimitSeconds: 30 }));
    assert.deepEqual(ran.end, { how: "timed-out" });
    assert.ok(Date.now() - startedAt < 5000);
  });
});

test("the broker records a command's secret arguments redacted", async () => {
  await withCommandBroker({}, async (broker, events) => {
    const asked = { name: "evaluate", arguments: ["process.exit(0)", madeUpSecret] };
    valueOf(await broker.ask("commands.run", { ...asked, folder: ".", timeLimitSeconds: 30 }));
    const recorded = events.events.find((event) => event.kind === "command")?.detail ?? null;
    assert.deepEqual(fieldOf(recorded, "command"), ["node", "-e", "process.exit(0)", "[redacted:BROKER_TOKEN]"]);
  });
});
