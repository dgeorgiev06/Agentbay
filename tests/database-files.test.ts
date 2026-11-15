import assert from "node:assert/strict";
import { chmod, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openModeProject, type ModeProject } from "./mode-harness.ts";

const config = {
  bindings: { "items-source": "fake-source", "items-store": "store" },
  adapter: "claude-code",
  modes: ["feed-briefing"],
  settings: {
    "feed-briefing": { selector: {}, lookback: "14d", maxItems: 100 },
    "fake-source": { baseDate: "2026-11-15T12:00:00.000Z", pageSize: 10, costPerItemUsd: 0.001 },
  },
};

type Entry = {
  readonly path: string;
  readonly mode: number;
};

async function entriesOf(root: string): Promise<readonly Entry[]> {
  const entries: Entry[] = [];
  for (const folder of [".agentbay", join(".agentbay", "data")]) {
    entries.push({ path: folder, mode: (await stat(join(root, folder))).mode & 0o777 });
    for (const name of await readdir(join(root, folder))) {
      if (name.includes(".db")) {
        const path = join(folder, name);
        entries.push({ path, mode: (await stat(join(root, path))).mode & 0o777 });
      }
    }
  }
  return entries;
}

function assertOwnerOnly(entries: readonly Entry[]): void {
  for (const entry of entries) {
    const expected = entry.path.includes(".db") ? 0o600 : 0o700;
    assert.equal(entry.mode, expected, `${entry.path} has mode ${entry.mode.toString(8)}`);
  }
}

async function synced(project: ModeProject): Promise<void> {
  await project.output("feed-briefing.sync", { since: "2026-11-01T00:00:00Z" });
}

test("after a run and a store write the folders are 0700 and every database file is 0600", async () => {
  const project = await openModeProject(config);
  try {
    await synced(project);
    const entries = await entriesOf(project.root);
    const names = entries.map((entry) => entry.path);
    assert.ok(names.includes(join(".agentbay", "kernel.db")), names.join(", "));
    assert.ok(names.includes(join(".agentbay", "data", "store--feed-briefing.db")), names.join(", "));
    assert.ok(
      names.some((name) => name.endsWith("-wal")),
      names.join(", "),
    );
    assertOwnerOnly(entries);
  } finally {
    await project.close();
  }
});

test("a folder or database file left wider than owner-only is narrowed when the kernel next uses it", async () => {
  const first = await openModeProject(config);
  await synced(first);
  for (const entry of await entriesOf(first.root)) {
    await chmod(join(first.root, entry.path), entry.path.includes(".db") ? 0o644 : 0o755);
  }
  const widened = await entriesOf(first.root);
  assert.ok(widened.every((entry) => (entry.mode & 0o044) !== 0));
  const project = await first.reopen(config);
  try {
    await synced(project);
    assertOwnerOnly(await entriesOf(project.root));
  } finally {
    await project.close();
  }
});

test("the fake source and the feed briefing make only kernel.db and the briefing's store partition", async () => {
  const project = await openModeProject(config);
  try {
    await project.output("fake-source.describe", {});
    await synced(project);
    const names = (await readdir(join(project.root, ".agentbay", "data"))).filter((name) => name.endsWith(".db"));
    assert.deepEqual(names, ["store--feed-briefing.db"]);
    const top = (await readdir(join(project.root, ".agentbay"))).filter((name) => name.endsWith(".db"));
    assert.deepEqual(top, ["kernel.db"]);
  } finally {
    await project.close();
  }
});
