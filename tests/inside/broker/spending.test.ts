import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "../../../bay/answers.ts";
import type { Effect, Json } from "../../../bay/contracts.ts";
import { openStep, type OpenStep } from "../../../bay/broker/step-broker.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../../../bay/node-ports.ts";
import { SecretStore } from "../../../bay/secrets.ts";
import { noProcesses, permissionsIn, place, projectLayout, recordingSink, scriptedHttp } from "../../broker-fixture.ts";

async function withBroker(effects: readonly Effect[], run: (broker: OpenStep) => Promise<void>): Promise<void> {
  const broker = openStep({
    layout: projectLayout("/project"),
    permissions: permissionsIn("/project", { effects }),
    place,
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events: recordingSink(),
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
  });
  try {
    await run(broker);
  } finally {
    broker.close();
  }
}

async function spentThrough(broker: OpenStep, spending: Json): Promise<Answer<Json>> {
  const answer = await broker.entries.spend({ spending });
  return answer.ok ? { ok: true, value: broker.spent() } : answer;
}

function assertRefusedFor<T>(answer: Answer<T>, effect: Effect): void {
  assert.ok(!answer.ok && answer.kind === "refused", JSON.stringify(answer));
  const needs = `(needs the ${effect} effect|needs all five effects)`;
  assert.match(answer.message, new RegExp(`${needs}; to allow it, add ${effect} to actions.look`));
}

test("spend: a report of more than nothing needs spend; a report of nothing needs no effect", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(await spentThrough(broker, { usd: 0.5 }), "spend");
    assertRefusedFor(await spentThrough(broker, { items: 1 }), "spend");
    assert.deepEqual(await spentThrough(broker, { items: 0, usd: 0 }), {
      ok: true,
      value: { items: 0, usd: 0, tokens: 0 },
    });
  });
  await withBroker(["read", "spend"], async (broker) => {
    assert.deepEqual(await spentThrough(broker, { usd: 0.5 }), { ok: true, value: { items: 0, usd: 0.5, tokens: 0 } });
  });
});
