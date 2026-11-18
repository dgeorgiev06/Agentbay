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
import {
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  scriptedHttp,
  type RecordingSink,
  noInterfaceSchemas,
} from "../../broker-fixture.ts";

async function withBroker(
  effects: readonly Effect[],
  run: (broker: OpenStep, journal: RecordingSink) => Promise<void>,
): Promise<void> {
  const journal = recordingSink();
  const broker = openStep({
    layout: projectLayout("/project"),
    permissions: permissionsIn("/project", { effects }),
    place,
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events: journal,
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    interfaceSchemas: noInterfaceSchemas,
  });
  try {
    await run(broker, journal);
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

const marker = "MARKER-a-script-chose-this";

const shapeSentence =
  "but spending is given as items, usd and tokens, each a number of at least 0. " +
  "Report spending as { items, usd, tokens } with numbers of at least 0.";

test("spend: spending of the wrong shape is refused by naming the field, and a value a script chose is never echoed", async () => {
  const cases: readonly (readonly [Json, string])[] = [
    [marker, "The step reported spending that is not a mapping"],
    [[marker], "The step reported spending that is not a mapping"],
    [{ usd: { [marker]: marker }, items: 1 }, "The step reported spending in which the field usd is not a number"],
    [{ items: -1 }, "The step reported spending in which the field items is -1"],
    [
      { items: -2, usd: marker, tokens: -0.5, [marker]: 3 },
      "The step reported spending in which the field items is -2, the field usd is not a number " +
        "and the field tokens is -0.5",
    ],
  ];
  for (const [spending, asked] of cases) {
    await withBroker(["read", "spend"], async (broker, journal) => {
      const answer = await spentThrough(broker, spending);
      assert.ok(!answer.ok && answer.kind === "refused", JSON.stringify(answer));
      assert.equal(answer.message, `${asked}, ${shapeSentence}`);
      assert.deepEqual(
        journal.events.map((event) => event.detail),
        [{ resource: "spend", step: place.stepKey, message: `${asked}, ${shapeSentence}` }],
      );
      assert.ok(!JSON.stringify({ answer, events: journal.events }).includes(marker), JSON.stringify(spending));
    });
  }
});
