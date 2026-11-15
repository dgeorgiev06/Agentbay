import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/mode-harness.ts";
import { fieldsOf } from "../scripts/lib/json.ts";
import { stopsBeforePage } from "../scripts/lib/monthly-cap.ts";

const baseDate = "2026-11-15T12:00:00.000Z";

const since = "2026-11-01T00:00:00Z";

type Caps = Readonly<Record<string, number>>;

function configOf(caps: Caps | undefined): Parameters<typeof openModeProject>[0] {
  return {
    bindings: { "items-source": "fake-source", "items-store": "store" },
    adapter: "claude-code",
    modes: ["feed-briefing"],
    settings: {
      "feed-briefing": { selector: {}, lookback: "14d", maxItems: 100 },
      "fake-source": { baseDate, pageSize: 10, costPerItemUsd: 0.001 },
      ...(caps === undefined ? {} : { store: { monthlyUsd: caps } }),
    },
  };
}

async function withCaps(caps: Caps | undefined, body: (project: ModeProject) => Promise<void>): Promise<void> {
  const project = await openModeProject(configOf(caps), { startAt: "2026-11-20T09:00:00.000Z" });
  try {
    await body(project);
  } finally {
    await project.close();
  }
}

async function synced(project: ModeProject): Promise<Readonly<Record<string, Json>>> {
  return fieldsOf(await project.output("feed-briefing.sync", { since }));
}

async function allowance(project: ModeProject, source: string, caller: string): Promise<Json> {
  return project.output("store.allowance", { source }, { caller });
}

async function storedCount(project: ModeProject): Promise<Json> {
  return fieldsOf(await project.output("store.status", {}, { caller: "feed-briefing" })).items ?? null;
}

test("with no cap set a sync fetches every page and the allowance says there is no cap", async () => {
  await withCaps(undefined, async (project) => {
    const output = await synced(project);
    assert.deepEqual([output.pages, output.fetched, output.stopped, output.monthlyCap], [3, 30, undefined, undefined]);
    assert.deepEqual(await allowance(project, "fake", "feed-briefing"), {
      source: "fake",
      month: "2026-11",
      capUsd: null,
      spentUsd: 0.03,
      remainingUsd: null,
    });
  });
});

test("a cap above what the sync needs lets every page through", async () => {
  await withCaps({ fake: 1 }, async (project) => {
    const output = await synced(project);
    assert.deepEqual([output.pages, output.fetched, output.more, output.stopped], [3, 30, false, undefined]);
    assert.equal(await storedCount(project), 30);
  });
});

test("a cap that allows two of three pages stops cleanly after two, with the reason, the cap, the spend and the month", async () => {
  await withCaps({ fake: 0.025 }, async (project) => {
    const run = await project.run("feed-briefing.sync", { since });
    if (run.state.status !== "done") {
      assert.fail(`a stop at the cap must not fail the run, got ${JSON.stringify(run.state)}`);
    }
    const output = fieldsOf(run.state.output);
    assert.deepEqual([output.pages, output.fetched, output.added, output.more], [2, 20, 20, true]);
    assert.equal(output.stopped, "monthly cap");
    assert.deepEqual(output.monthlyCap, { month: "2026-11", capUsd: 0.025, spentUsd: 0.02, remainingUsd: 0.005 });
    assert.deepEqual(output.cost, { items: 20, usd: 0.02 });
    assert.equal(await storedCount(project), 20);
  });
});

test("a second sync in the same month fetches nothing and says why, and the next month fetches again", async () => {
  await withCaps({ fake: 0.025 }, async (project) => {
    await synced(project);
    const again = await synced(project);
    assert.deepEqual([again.pages, again.fetched, again.stopped], [0, 0, "monthly cap"]);
    assert.deepEqual(again.monthlyCap, { month: "2026-11", capUsd: 0.025, spentUsd: 0.02, remainingUsd: 0.005 });
    assert.equal(await storedCount(project), 20);
    project.setTime("2026-11-30T23:59:59.999Z");
    const lastMoment = await synced(project);
    assert.deepEqual([lastMoment.pages, lastMoment.stopped], [0, "monthly cap"]);
    project.setTime("2026-12-01T00:00:00.000Z");
    const december = await synced(project);
    assert.deepEqual([december.pages, december.fetched, december.more, december.stopped], [1, 10, false, undefined]);
    assert.equal(await storedCount(project), 30);
    const left = await allowance(project, "fake", "feed-briefing");
    assert.deepEqual(left, { source: "fake", month: "2026-12", capUsd: 0.025, spentUsd: 0.01, remainingUsd: 0.015 });
  });
});

test("a cap is kept per calling mode and per source", async () => {
  await withCaps({ fake: 0.025, other: 1 }, async (project) => {
    await synced(project);
    const page = { source: "other", kinds: ["post"], items: [], cursor: null, cost: { items: 5, usd: 0.5 } };
    await project.output("store.put", page, { caller: "feed-briefing" });
    const ownFake = await allowance(project, "fake", "feed-briefing");
    const ownOther = await allowance(project, "other", "feed-briefing");
    const elsewhere = await allowance(project, "fake", "notes-briefing");
    assert.deepEqual([fieldsOf(ownFake).spentUsd, fieldsOf(ownFake).remainingUsd], [0.02, 0.005]);
    assert.deepEqual([fieldsOf(ownOther).spentUsd, fieldsOf(ownOther).remainingUsd], [0.5, 0.5]);
    assert.deepEqual([fieldsOf(elsewhere).spentUsd, fieldsOf(elsewhere).remainingUsd], [0, 0.025]);
  });
});

test("a cap of 0 fetches nothing", async () => {
  await withCaps({ fake: 0 }, async (project) => {
    const output = await synced(project);
    assert.deepEqual([output.pages, output.fetched, output.stopped], [0, 0, "monthly cap"]);
    assert.deepEqual(output.monthlyCap, { month: "2026-11", capUsd: 0, spentUsd: 0, remainingUsd: 0 });
    assert.equal(await storedCount(project), 0);
  });
});

test("a cap that leaves exactly one page's cost lets that page through, then stops at nothing left", async () => {
  await withCaps({ fake: 0.02 }, async (project) => {
    const output = await synced(project);
    assert.deepEqual([output.pages, output.fetched, output.stopped], [2, 20, "monthly cap"]);
    assert.deepEqual(output.monthlyCap, { month: "2026-11", capUsd: 0.02, spentUsd: 0.02, remainingUsd: 0 });
  });
});

test("the rule: stop when less than one page's cost is left, or, when a page's cost is unknown, when nothing is", () => {
  assert.equal(stopsBeforePage(0.01, 0.01), false);
  assert.equal(stopsBeforePage(0.009, 0.01), true);
  assert.equal(stopsBeforePage(0.001, undefined), false);
  assert.equal(stopsBeforePage(0, undefined), true);
  assert.equal(stopsBeforePage(-0.5, undefined), true);
});
