import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openModeProject } from "../../../../tests/mode-harness.ts";

const config = {
  bindings: { "items-source": "fake-source", "items-store": "store" },
  adapter: "claude-code",
  modes: ["feed-briefing"],
  settings: {
    "feed-briefing": { selector: {}, lookback: "14d", maxItems: 100 },
    "fake-source": { baseDate: "2026-11-15T12:00:00.000Z", pageSize: 10, costPerItemUsd: 0.001 },
  },
};

test("the fake source and the feed briefing make only kernel.db and the briefing's store partition", async () => {
  const project = await openModeProject(config);
  try {
    await project.output("fake-source.describe", {});
    await project.output("feed-briefing.sync", { since: "2026-11-01T00:00:00Z" });
    const names = (await readdir(join(project.root, ".agentbay", "data"))).filter((name) => name.endsWith(".db"));
    assert.deepEqual(names, ["store--feed-briefing.db"]);
    const top = (await readdir(join(project.root, ".agentbay"))).filter((name) => name.endsWith(".db"));
    assert.deepEqual(top, ["kernel.db"]);
  } finally {
    await project.close();
  }
});
